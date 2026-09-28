import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import { fogWallPositions } from '../public/table/map-fog-volume.js';
import { MAP_FOG, emptyFog, decodeFogMask, paintFog } from '../shared/map-fog.js';
import { boardGeometry } from '../shared/board-geometry.js';

const size = { w: 12, d: 6 },
  outline = [
    [-6, -3],
    [6, -3],
    [6, 3],
    [-6, 3],
  ];
function walls(mask, points = outline) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(fogWallPositions(mask, size, points), 3),
  );
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
}
function hits(mesh, origin, direction) {
  mesh.updateMatrixWorld(true);
  return new THREE.Raycaster(
    new THREE.Vector3(...origin),
    new THREE.Vector3(...direction).normalize(),
  ).intersectObject(mesh);
}
test('fog walls close the outer perimeter and reveal boundaries at low camera angles', () => {
  const mask = decodeFogMask(emptyFog().mask);
  let mesh = walls(mask);
  assert.equal(mesh.geometry.attributes.position.count, 24, 'full map should merge to four walls');
  for (const [origin, direction] of [
    [
      [-8, 0.5, 0],
      [1, 0, 0],
    ],
    [
      [8, 0.5, 0],
      [-1, 0, 0],
    ],
    [
      [0, 0.5, -8],
      [0, 0, 1],
    ],
    [
      [0, 0.5, 8],
      [0, 0, -1],
    ],
  ])
    assert.ok(hits(mesh, origin, direction).length, 'covered board leaked through perimeter');
  // Reveal the entire left half. Looking across it must meet a wall at the covered half.
  const n = MAP_FOG.resolution;
  for (let z = 0; z < n; z++)
    for (let x = 0; x < n / 2; x++) {
      const bit = z * n + x;
      mask[bit >> 3] &= ~(1 << (bit & 7));
    }
  mesh = walls(mask);
  assert.equal(hits(mesh, [-8, 0.5, 0], [1, 0, 0])[0].point.x, 0);
  assert.equal(hits(mesh, [-3, 0.5, -8], [0, 0, 1]).length, 0, 'reveal retained an outer wall');
  mesh.scale.y = 5;
  mesh.position.y = -1;
  assert.equal(hits(mesh, [-8, 3, 0], [1, 0, 0])[0].point.x, 0, 'thicker wall opened a side gap');
  mask.fill(0);
  assert.equal(walls(mask).geometry.attributes.position.count, 0);
});
test('fog seals circular reveal holes and clips walls to fitted convex board outlines', () => {
  const mask = decodeFogMask(emptyFog().mask);
  paintFog(mask, { mode: 'reveal', radius: 1, points: [[0, 0]] }, size);
  const mesh = walls(mask);
  for (const direction of [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
  ]) {
    const hit = hits(mesh, [0, 0.5, 0], direction)[0];
    assert.ok(hit && hit.distance > 0.9 && hit.distance < 1.1, 'reveal hole is missing its wall');
  }
  const { vertices, faces } = boardGeometry({
    ...size,
    outline: { type: 'triangle', fit: { scale: [1.2, 0.9], rotation: 0.4 } },
  });
  const points = faces[0].map((i) => [vertices[i][0], vertices[i][2]]);
  const positions = fogWallPositions(mask, size, points);
  const area = points.reduce((a, p, i) => {
    const q = points[(i + 1) % points.length];
    return a + p[0] * q[1] - q[0] * p[1];
  }, 0);
  for (let i = 0; i < positions.length; i += 3)
    for (let j = 0; j < points.length; j++) {
      const a = points[j],
        b = points[(j + 1) % points.length];
      assert.ok(
        Math.sign(area) *
          ((b[0] - a[0]) * (positions[i + 2] - a[1]) - (b[1] - a[1]) * (positions[i] - a[0])) >=
          -1e-5,
        'wall escaped authored outline',
      );
    }
  const reversed = fogWallPositions(mask, size, [...points].reverse());
  assert.equal(reversed.length, positions.length, 'outline winding changed coverage');
});
