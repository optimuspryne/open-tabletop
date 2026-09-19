import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as CANNON from 'cannon-es';
import { normalizeCompoundCollider, compoundColliderSpec } from '../shared/compound-collider.js';
import { buildCollider, attachCollider, boardSpawnHeight } from '../server/physics.js';
import { colliderSpec } from '../shared/collider-spec.js';
import { boardRecordPayload, propRecordPayload } from '../server/message-validation.js';
const part = (
  type = 'box',
  position = [0, 0, 0],
  size = [0.2, 0.2, 0.2],
  rotation = [0, 0, 0],
) => ({ type, position, size, rotation });
const layout = (...shapes) => ({ version: 1, shapes });
const props = { model: '/assets/props/test.glb', box: [1, 1, 1], scale: 1, stand: false };
const options = { cardColliderThickness: 0.04 };

test('compound records are bounded, copied, and reject malformed primitives', () => {
  const valid = layout(part());
  const copy = normalizeCompoundCollider(valid);
  assert.deepEqual(copy, valid);
  copy.shapes[0].position[0] = 1;
  assert.equal(valid.shapes[0].position[0], 0);
  for (const invalid of [
    null,
    {},
    layout(),
    layout(...Array(17).fill(part())),
    layout(part('mesh')),
    layout(part('sphere', [0, 0, 0], [1, 0.5, 1])),
    layout(part('cylinder', [0, 0, 0], [1, 1, 0.5])),
    layout(part('box', [Infinity, 0, 0])),
    layout(part('box', [0, 0, 0], [0, 1, 1])),
    layout(part('box', [0, 0, 0], [1, 1, 1], [0, 9, 0])),
  ])
    assert.equal(normalizeCompoundCollider(invalid), null);
});

test('all primitive types attach to one body with matching debug dimensions and transforms', () => {
  const compoundCollider = layout(
    ...['box', 'sphere', 'cylinder', 'cone', 'flat'].map((type, i) =>
      part(type, [i * 0.1, 0.1, 0], [0.2, 0.2, 0.2], [0, 0, Math.PI / 4]),
    ),
  );
  const record = { ...props, compoundCollider };
  const collider = buildCollider('prop', record, options);
  const body = new CANNON.Body({ mass: 1 });
  attachCollider(body, collider);
  assert.equal(body.shapes.length, 5);
  assert.deepEqual(colliderSpec('prop', record), compoundColliderSpec(compoundCollider, props.box));
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(body.shapeOffsets[i].toArray(), [i * 0.2, 0.2, 0]);
    const rotated = body.shapeOrientations[i].vmult(new CANNON.Vec3(1, 0, 0));
    assert.ok(Math.abs(rotated.y - Math.SQRT1_2) < 1e-6);
  }
  assert.deepEqual(body.shapes[0].halfExtents.toArray(), [0.2, 0.2, 0.2]);
  assert.equal(body.shapes[1].radius, 0.2);
  assert.equal(body.shapes[2].height, 0.4);
});

test('board and object validation preserves compound layouts and rejects competing colliders', () => {
  const compoundCollider = layout(part());
  assert.deepEqual(propRecordPayload({ ...props, compoundCollider }), {
    ...props,
    compoundCollider,
  });
  assert.equal(
    propRecordPayload(
      { ...props, compoundCollider, collider: 'sphere' },
      { colliders: ['sphere'] },
    ),
    null,
  );
  const board = { model: props.model, modelScale: 1, box: [1, 0.1, 1], compoundCollider };
  assert.deepEqual(boardRecordPayload(board), board);
  assert.equal(boardRecordPayload({ ...board, outline: { type: 'rectangle' } }), null);
  assert.equal(boardRecordPayload({ w: 8, d: 8, compoundCollider }), null);
});

test('uniform scaling changes offsets and primitive dimensions together', () => {
  const compoundCollider = layout(part('box', [0.25, 0, 0], [0.2, 0.4, 0.6]));
  const a = compoundColliderSpec(compoundCollider, [1, 0.5, 1]).shapes[0];
  const b = compoundColliderSpec(compoundCollider, [3, 1.5, 3]).shapes[0];
  assert.deepEqual(
    b.halfExtents,
    a.halfExtents.map((v) => v * 3),
  );
  assert.deepEqual(
    b.offset,
    a.offset.map((v) => v * 3),
  );
});

test('compound ring supports a box on its wall while a box falls through its hole', () => {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -10, 0) });
  const compoundCollider = layout(
    part('box', [-0.4, 0, 0], [0.2, 0.2, 1]),
    part('box', [0.4, 0, 0], [0.2, 0.2, 1]),
    part('box', [0, 0, -0.4], [0.6, 0.2, 0.2]),
    part('box', [0, 0, 0.4], [0.6, 0.2, 0.2]),
  );
  const board = new CANNON.Body({ mass: 0 });
  attachCollider(board, buildCollider('board', { ...props, compoundCollider }, options));
  world.addBody(board);
  const create = (x) =>
    new CANNON.Body({
      mass: 1,
      shape: new CANNON.Box(new CANNON.Vec3(0.05, 0.05, 0.05)),
      position: new CANNON.Vec3(x, 1, 0),
    });
  const wall = create(0.8),
    hole = create(0);
  world.addBody(wall);
  world.addBody(hole);
  for (let i = 0; i < 180; i++) world.step(1 / 60);
  assert.ok(Math.abs(wall.position.y - 0.25) < 0.02);
  assert.ok(hole.position.y < -5);
});

test('board placement accounts for shapes below the visible model', () => {
  const board = {
    ...props,
    box: [1, 0.1, 1],
    compoundCollider: layout(part('box', [0, -0.5, 0], [0.5, 0.2, 0.5])),
  };
  assert.equal(boardSpawnHeight(board), 1.2);
  assert.equal(boardSpawnHeight({ ...props, box: [1, 0.1, 1] }), 0.1);
});

test('outline components preserve presets and construct convex compound children', () => {
  for (const type of ['rectangle', 'triangle', 'hexagon', 'clipped', 'custom']) {
    const outline = {
      type,
      ...(type === 'clipped' ? { cut: 0.2 } : {}),
      ...(type === 'custom'
        ? {
            points: [
              [-0.5, -0.5],
              [0.5, -0.5],
              [0, 0.5],
            ],
          }
        : {}),
    };
    const child = { ...part('outline', [0.1, 0.2, 0], [0.8, 0.05, 0.6], [0, 0.4, 0]), outline };
    const record = { ...props, compoundCollider: layout(child) };
    assert.deepEqual(propRecordPayload(record).compoundCollider, layout(child));
    const spec = compoundColliderSpec(record.compoundCollider, record.box).shapes[0];
    const physics = buildCollider('prop', record, options).shapes[0];
    assert.equal(spec.type, 'convex');
    assert.deepEqual(
      physics.shape.vertices.map((v) => v.toArray()),
      spec.vertices,
    );
    assert.deepEqual(physics.shape.faces, spec.faces);
    assert.deepEqual(colliderSpec('prop', record).shapes[0], spec);
    for (let i = 0; i < physics.shape.faces.length; i++) {
      const face = physics.shape.faces[i];
      const center = face
        .reduce((v, j) => v.vadd(physics.shape.vertices[j]), new CANNON.Vec3())
        .scale(1 / face.length);
      assert.ok(center.dot(physics.shape.faceNormals[i]) > 0);
    }
  }
  assert.equal(normalizeCompoundCollider(layout(part('outline'))), null);
  assert.equal(
    normalizeCompoundCollider(
      layout({
        ...part('outline'),
        outline: {
          type: 'custom',
          points: [
            [0, 0],
            [0, 0],
            [0, 0],
          ],
        },
      }),
    ),
    null,
  );
});
