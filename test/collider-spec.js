import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colliderSpec, primitiveColliderSpec } from '../shared/collider-spec.js';

test('collider debug primitives preserve server dimensions and flat offsets', () => {
  assert.deepEqual(primitiveColliderSpec('sphere', 1, 2, 1), { type: 'sphere', radius: 2 });
  assert.deepEqual(primitiveColliderSpec('flat', 2, 1, 3), {
    type: 'box',
    halfExtents: [2, 0.06, 3],
    offset: [0, -0.94, 0],
  });
  assert.deepEqual(primitiveColliderSpec('cone', 2, 3, 1), {
    type: 'cylinder',
    radiusBottom: 2,
    radiusTop: 0.1,
    height: 6,
    sides: 16,
  });
});

test('collider debug specs track live boards, decks, dice, and dispensers', () => {
  assert.deepEqual(colliderSpec('board', { w: 20, d: 14 }), {
    type: 'box',
    halfExtents: [10, 0.05, 7],
  });
  assert.deepEqual(colliderSpec('deck', {}, { count: 12 }), {
    type: 'box',
    halfExtents: [0.75, 0.12, 1.05],
  });
  assert.equal(colliderSpec('die', { sides: 20 }).type, 'convex');
  assert.deepEqual(colliderSpec('dispenser', { disp: 'pokerStack' }, { count: 4 }), {
    type: 'cylinder',
    radiusTop: 0.45,
    radiusBottom: 0.45,
    height: 0.36,
    sides: 16,
  });
  assert.deepEqual(colliderSpec('dispenser', { disp: 'goBowl' }), {
    type: 'cylinder',
    radiusTop: 0.8,
    radiusBottom: 0.8,
    height: 0.8718,
    sides: 16,
  });
});

test('uploaded object collider specs apply the same clamps and primitive choices as physics', () => {
  assert.deepEqual(
    colliderSpec('prop', {
      model: '/assets/props/model.glb',
      box: [10, 0, 2],
      collider: 'sphere',
    }),
    { type: 'sphere', radius: 4 },
  );
});
