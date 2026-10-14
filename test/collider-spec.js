import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colliderSpec, primitiveColliderSpec } from '../shared/collider-spec.js';
import {
  BOARDS,
  DECK_MODELS,
  DISPENSERS,
  PROPS,
  cardGeom,
  deckHeight,
  stackVisible,
} from '../shared/pieces.js';
import { buildCollider } from '../server/physics.js';

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
  const geometry = cardGeom({});
  assert.deepEqual(colliderSpec('deck', {}, { count: 12 }), {
    type: 'box',
    halfExtents: [geometry.hw, deckHeight(12) / 2, geometry.hh],
  });
  assert.equal(colliderSpec('die', { sides: 20 }).type, 'convex');
  const stack = DISPENSERS.pokerStack;
  const itemBox = PROPS[stack.item].collider.box;
  assert.deepEqual(colliderSpec('dispenser', { disp: 'pokerStack' }, { count: 4 }), {
    type: 'cylinder',
    radiusTop: itemBox[0],
    radiusBottom: itemBox[0],
    height: stackVisible(4) * itemBox[1] * 2,
    sides: 16,
  });
  const { box, type, sides, top } = DISPENSERS.goBowl.collider;
  assert.deepEqual(
    colliderSpec('dispenser', { disp: 'goBowl' }),
    primitiveColliderSpec(type, ...box, { sides, top }),
  );
});

test('modeled board and deck colliders honor their current shared bounds', () => {
  for (const [type, catalog, prop] of [
    ['board', BOARDS, 'board'],
    ['deck', DECK_MODELS, 'model'],
  ]) {
    for (const [key, definition] of Object.entries(catalog)) {
      const props = { [prop]: key };
      assert.deepEqual(colliderSpec(type, props).halfExtents, definition.box, `${type}:${key}`);
      assert.deepEqual(buildCollider(type, props).halfExtents.toArray(), definition.box);
    }
  }
});

test('retuned dispenser definitions reach both diagnostics and real physics', () => {
  const item = PROPS[DISPENSERS.pokerStack.item];
  const originalBox = item.collider.box;
  const originalBowl = DISPENSERS.goBowl.collider;
  try {
    // Synthetic authoring changes expose stale constants without depending on a GLB export.
    item.collider.box = [0.47, 0.13, 0.58];
    DISPENSERS.goBowl.collider = { type: 'sphere', box: [0.45, 0.72, 0.93] };
    const stack = colliderSpec('dispenser', { disp: 'pokerStack' }, { count: 4 });
    const body = buildCollider('dispenser', { disp: 'pokerStack' }, { count: 4 });
    assert.equal(stack.radiusTop, 0.47);
    assert.equal(stack.height, 0.13 * 2 * stackVisible(4));
    assert.equal(body.radiusTop, stack.radiusTop);
    assert.equal(body.height, stack.height);
    assert.deepEqual(colliderSpec('dispenser', { disp: 'goBowl' }), {
      type: 'sphere',
      radius: 0.93,
    });
    assert.equal(buildCollider('dispenser', { disp: 'goBowl' }).radius, 0.93);
  } finally {
    item.collider.box = originalBox;
    DISPENSERS.goBowl.collider = originalBowl;
  }
});

test('default debug geometry uses visible card thickness and independent mat padding', () => {
  for (const props of [
    {},
    { tile: 'domino' },
    { tile: 'letter' },
    { tile: 'mahjong' },
    { geom: { w: 0.35, h: 0.5, t: 0.005 } },
    { geom: { w: 0.35, h: 0.5, t: 0.1 } },
    { geom: { w: 0.35, h: 0.5, t: 0.005, shape: 'hex' } },
  ]) {
    const geometry = cardGeom(props),
      spec = colliderSpec('card', props);
    assert.equal(geometry.shape === 'hex' ? spec.height / 2 : spec.halfExtents[1], geometry.th);
  }
  assert.equal(colliderSpec('mat', { geom: { w: 2, h: 3, t: 0.005 } }).halfExtents[1], 0.04);
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
