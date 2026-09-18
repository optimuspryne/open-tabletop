import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as CANNON from 'cannon-es';
import { boardGeometry, normalizeBoardOutline } from '../shared/board-geometry.js';
import { colliderSpec } from '../shared/collider-spec.js';
import { buildCollider } from '../server/physics.js';
import { boardRecordPayload } from '../server/message-validation.js';

const options = { cardColliderThickness: 0.04 };
for (const type of ['rectangle', 'circle', 'hexagon', 'clipped', 'custom']) {
  test(`${type} board collider matches geometry and debug overlay`, () => {
    const outline = {
      type,
      cut: 0.2,
      points: [
        [-0.5, -0.5],
        [0.5, -0.5],
        [0, 0.5],
      ],
    };
    const props = boardRecordPayload({ w: 12, d: 8, thickness: 0.4, outline });
    assert.ok(props);
    const shape = buildCollider('board', props, options);
    const geometry = boardGeometry(props);
    if (type !== 'rectangle') {
      assert.deepEqual(
        shape.vertices.map((v) => v.toArray()),
        geometry.vertices,
      );
      assert.deepEqual(colliderSpec('board', props).vertices, geometry.vertices);
      for (let i = 0; i < shape.faces.length; i++) {
        const face = shape.faces[i];
        const center = face
          .reduce((v, j) => v.vadd(shape.vertices[j]), new CANNON.Vec3())
          .scale(1 / face.length);
        // All faces face outward; this is essential for Cannon contact generation.
        assert.ok(center.dot(shape.faceNormals[i]) > 0);
      }
    } else assert.deepEqual(shape.halfExtents.toArray(), [6, 0.2, 4]);
  });
}

test('clipped board supports pieces on its surface but not in removed corners', () => {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -10, 0) });
  world.addBody(
    new CANNON.Body({
      mass: 0,
      shape: buildCollider(
        'board',
        { w: 10, d: 10, thickness: 0.4, outline: { type: 'clipped', cut: 0.25 } },
        options,
      ),
    }),
  );
  const center = new CANNON.Body({
    mass: 1,
    shape: new CANNON.Box(new CANNON.Vec3(0.1, 0.1, 0.1)),
    position: new CANNON.Vec3(0, 2, 0),
  });
  const corner = new CANNON.Body({
    mass: 1,
    shape: new CANNON.Box(new CANNON.Vec3(0.1, 0.1, 0.1)),
    position: new CANNON.Vec3(4.8, 2, 4.8),
  });
  world.addBody(center);
  world.addBody(corner);
  for (let i = 0; i < 180; i++) world.step(1 / 60);
  assert.ok(Math.abs(center.position.y - 0.3) < 0.02);
  assert.ok(corner.position.y < -5);
});

test('outlines reject invalid, crossed, concave, oversized and degenerate paths', () => {
  for (const points of [
    [],
    [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
    [
      [-0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
      [0.5, -0.5],
    ],
    [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0, 0],
      [0.5, 0.5],
      [-0.5, 0.5],
    ],
    [
      [Infinity, 0],
      [0, 0],
      [0, 0.5],
    ],
    Array(33).fill([0, 0]),
  ]) {
    assert.equal(normalizeBoardOutline({ type: 'custom', points }), null);
    assert.equal(boardRecordPayload({ w: 8, d: 8, outline: { type: 'custom', points } }), null);
  }
  const points = [
    [-0.5, -0.5],
    [0, 0.5],
    [0.5, -0.5],
  ];
  const result = normalizeBoardOutline({ type: 'custom', points });
  assert.ok(result);
  assert.notEqual(result.points, points);
  assert.equal(boardRecordPayload({ w: 8, d: 8, thickness: 0 }), null);
});

test('GLB size and outline survive serialization without old collider clamping', () => {
  const record = {
    model: '/assets/boards/test.glb',
    modelScale: 2,
    box: [35, 0.25, 20],
    outline: { type: 'clipped', cut: 0.15 },
  };
  const parsed = boardRecordPayload(JSON.parse(JSON.stringify(record)));
  assert.deepEqual(parsed, record);
  const shape = buildCollider('board', parsed, options);
  assert.equal(Math.max(...shape.vertices.map((v) => v.x)), 35);
  assert.deepEqual(boardRecordPayload({ w: 8, d: 6 }), { w: 8, d: 6 });
});
