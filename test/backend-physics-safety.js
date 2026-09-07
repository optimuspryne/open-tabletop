import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORLD_COORD_LIMIT, dragVelocity } from '../server/game/physics-safety.js';
import {
  pieceMovePayload,
  groupMovePayload,
  deckDragPayload,
  dispenserDragPayload,
  cardPlacementPayload,
} from '../server/message-validation.js';

test('every drag ingress rejects finite coordinates outside the world envelope', () => {
  for (const parse of [pieceMovePayload, dispenserDragPayload, deckDragPayload, groupMovePayload]) {
    const identity =
      parse === groupMovePayload ? {} : parse === deckDragPayload ? { deckId: '1' } : { id: '1' };
    assert.ok(parse({ ...identity, x: WORLD_COORD_LIMIT, y: 2, z: -WORLD_COORD_LIMIT }));
    for (const axis of ['x', 'y', 'z']) {
      for (const value of [WORLD_COORD_LIMIT + 1, -WORLD_COORD_LIMIT - 1, 1e308, -1e308]) {
        assert.equal(parse({ ...identity, x: 0, y: 2, z: 0, [axis]: value }), null);
      }
    }
  }
  for (const wholeHand of [false, true]) {
    const identity = wholeHand ? {} : { hid: 'h1' };
    assert.equal(
      cardPlacementPayload({ ...identity, faceDown: false, x: 1e308, z: 0 }, { wholeHand }),
      null,
    );
  }
});

test('drag servo preserves ordinary movement and bounds speed without NaN', () => {
  assert.deepEqual(dragVelocity({ x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 0 }, 1, 10, 45), {
    x: 10,
    y: 10,
    z: 0,
  });
  const velocity = dragVelocity(
    { x: -100, y: -100, z: 100 },
    { x: WORLD_COORD_LIMIT, y: WORLD_COORD_LIMIT, z: -WORLD_COORD_LIMIT },
    0,
    25,
    45,
  );
  assert.ok(Object.values(velocity).every(Number.isFinite));
  assert.ok(Math.hypot(velocity.x, velocity.y, velocity.z) <= 45.00000001);
});

test('overflow and corrupt derived physics values never become a body velocity', () => {
  const origin = { x: 0, y: 0, z: 0 };
  assert.equal(dragVelocity(origin, { x: 1e308, y: 0, z: 0 }, 0, 25, 45), null);
  assert.equal(dragVelocity({ ...origin, x: -1e308 }, origin, 0, 25, 45), null);
  assert.equal(dragVelocity(origin, origin, NaN, 25, 45), null);
});
