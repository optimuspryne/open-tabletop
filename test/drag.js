import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reanchorOffset } from '../public/drag.js';

// `hit` always arrives with the current offset already applied, so a test that wants to reason
// about the raw raycast has to add it in the same way client.js does.
const applied = (raw, offset) => ({ x: raw.x + offset.x, z: raw.z + offset.z });
const ZERO = { x: 0, z: 0 };

test('no separation leaves the offset alone', () => {
  const held = { x: 3, z: -4 };
  assert.deepEqual(reanchorOffset(held, applied(held, ZERO), ZERO), ZERO);
});

test('the new offset puts the raw hit back on the piece', () => {
  const held = { x: 2, z: 5 };
  const raw = { x: 6, z: -1 }; // the finger drifted here while the piece stayed put
  const offset = reanchorOffset(held, applied(raw, ZERO), ZERO);
  assert.deepEqual(applied(raw, offset), held);
});

test('re-anchoring twice accumulates rather than replacing', () => {
  const raw1 = { x: 10, z: 0 };
  const first = reanchorOffset({ x: 0, z: 0 }, applied(raw1, ZERO), ZERO);
  // Second transform, later in the same drag: the piece sits at (0,0) still, the finger has run
  // on to raw2, and `hit` carries the first offset.
  const raw2 = { x: 25, z: 7 };
  const second = reanchorOffset({ x: 0, z: 0 }, applied(raw2, first), first);
  assert.deepEqual(applied(raw2, second), { x: 0, z: 0 });
  assert.notDeepEqual(second, first, 'the second re-anchor must move the offset');
});

test('relative motion survives a re-anchor', () => {
  const held = { x: 1, z: 1 };
  const raw = { x: 9, z: 9 };
  const offset = reanchorOffset(held, applied(raw, ZERO), ZERO);
  // Now drag the finger 3 right and 2 back: the piece should move exactly that far, no more.
  const moved = applied({ x: raw.x + 3, z: raw.z - 2 }, offset);
  assert.deepEqual(moved, { x: held.x + 3, z: held.z - 2 });
});

test('a piece already under the finger is not nudged', () => {
  // Guards the sign: getting it backwards doubles the error instead of cancelling it.
  const held = { x: -7, z: 2 };
  const offset = reanchorOffset(held, applied({ x: -7, z: 2 }, ZERO), ZERO);
  assert.deepEqual(offset, ZERO);
});

test('the correction opposes the drift, it does not follow it', () => {
  // A finger that drifted +x needs a -x offset; the classic sign error returns +x.
  const offset = reanchorOffset({ x: 0, z: 0 }, applied({ x: 5, z: 0 }, ZERO), ZERO);
  assert.ok(offset.x < 0, `expected a negative correction, got ${offset.x}`);
});
