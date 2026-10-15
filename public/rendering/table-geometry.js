import { tableOutline, offsetOutline } from '../../shared/pieces.js';

// Visual finish only: the felt outline remains the shared playable boundary.
export const TABLE_FINISH = Object.freeze({
  rimWidth: 0.4,
  rimLip: 0.35,
  rimBase: -1,
  rimOverlap: 0.06,
  bevel: 0.04,
  grainLength: 7,
  grainCrossSection: 1.6,
  feltRepeat: 0.8,
  feltBump: 0.025,
  rimRoughness: 0.4,
  smoothCornerAngle: Math.PI / 6,
});

export function createTableGeometry(THREE, hx, hz, shape = 'rect') {
  const outline = tableOutline(shape, hx, hz);
  const path = new THREE.Shape();
  outline.forEach((p, i) => (i ? path.lineTo(p.x, p.z) : path.moveTo(p.x, p.z)));
  path.closePath();
  const geometry = new THREE.ExtrudeGeometry(path, { depth: 1, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -0.5, 0);
  // Planar cap UVs in world units: cloth density does not depend on table size.
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < position.count; i++)
    if (Math.abs(normal.getY(i)) > 0.5) uv.setXY(i, position.getX(i), position.getZ(i));
  return geometry;
}

export function createRimGeometry(THREE, hx, hz, shape = 'rect') {
  const f = TABLE_FINISH;
  const outline = tableOutline(shape, hx, hz);
  const profile = [
    [f.rimWidth - f.bevel, f.rimBase],
    [f.rimWidth, f.rimBase + f.bevel],
    [f.rimWidth, f.rimLip - f.bevel * 1.5],
    [f.rimWidth - f.bevel * 0.75, f.rimLip],
    [-f.rimOverlap + f.bevel * 0.75, f.rimLip],
    [-f.rimOverlap, f.rimLip - f.bevel * 1.5],
    [-f.rimOverlap, f.rimBase],
  ];
  const rings = profile.map(([offset]) => offsetOutline(outline, offset));
  const n = outline.length;
  const p = profile.length;
  const perimeter = [0];
  const crossSection = [0];
  const edgeNormals = outline.map((point, i) => {
    const next = outline[(i + 1) % n];
    const dx = next.x - point.x;
    const dz = next.z - point.z;
    perimeter.push(perimeter[i] + Math.hypot(dx, dz));
    return new THREE.Vector2(dz, -dx).normalize();
  });
  const profileNormals = profile.map((point, j) => {
    const prev = profile[(j - 1 + p) % p];
    const next = profile[(j + 1) % p];
    crossSection.push(crossSection[j] + Math.hypot(next[0] - point[0], next[1] - point[1]));
    return new THREE.Vector2(point[1] - prev[1], prev[0] - point[0])
      .normalize()
      .add(new THREE.Vector2(next[1] - point[1], point[0] - next[0]).normalize())
      .normalize();
  });
  const radialNormal = (vertex, edge) => {
    const a = edgeNormals[(vertex - 1 + n) % n];
    const b = edgeNormals[vertex % n];
    // Preserve genuinely sharp rect/hex corners; smooth only sampled curves.
    if (a.dot(b) < Math.cos(f.smoothCornerAngle)) return edgeNormals[edge];
    return a.clone().add(b).normalize();
  };
  const positions = [],
    normals = [],
    uvs = [],
    indices = [];
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    for (let j = 0; j < p; j++) {
      const after = (j + 1) % p;
      const first = positions.length / 3;
      for (const [vertex, row, distance, cross] of [
        [i, j, perimeter[i], crossSection[j]],
        [next, j, perimeter[i + 1], crossSection[j]],
        [next, after, perimeter[i + 1], crossSection[j + 1]],
        [i, after, perimeter[i], crossSection[j + 1]],
      ]) {
        const radial = radialNormal(vertex, i);
        const normal = profileNormals[row];
        positions.push(rings[row][vertex].x, profile[row][1], rings[row][vertex].z);
        normals.push(radial.x * normal.x, normal.y, radial.y * normal.x);
        // Source wood grain is vertical in the image: V follows the rail's length.
        uvs.push(cross / f.grainCrossSection, distance / f.grainLength);
      }
      indices.push(first, first + 2, first + 1, first, first + 3, first + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}
