import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterDispense, dispenserItem } from '../server/game/dispenser-operations.js';

const dispenser = (disp, count, props = {}) => ({
  type: 'dispenser',
  count,
  props: JSON.stringify({ disp, ...props }),
});

function roomHarness() {
  const events = [];
  return {
    events,
    removePiece(id) {
      events.push(['remove', id]);
    },
    updateStackCollider(id) {
      events.push(['collider', id]);
    },
  };
}

test('dispenser items preserve tint and team identity from shared definitions', () => {
  assert.deepEqual(dispenserItem(dispenser('pokerStack', 20, { color: 0xabcdef })), {
    type: 'prop',
    props: { shape: 'poker_chip', color: 0xabcdef },
  });
  assert.deepEqual(dispenserItem(dispenser('goBowl', 0, { team: 1 })), {
    type: 'prop',
    props: { shape: 'go', team: 1, snap: true },
  });
  assert.equal(dispenserItem(dispenser('missing', 1)), null);
});

test('finite dispensers decrement and resize while inventory remains', () => {
  const room = roomHarness();
  const stack = dispenser('pokerStack', 2);
  afterDispense(room, stack, 'stack');
  assert.equal(stack.count, 1);
  assert.deepEqual(room.events, [['collider', 'stack']]);
});

test('the final finite item removes its dispenser without rebuilding its collider', () => {
  const room = roomHarness();
  const stack = dispenser('pokerStack', 1);
  afterDispense(room, stack, 'stack');
  assert.equal(stack.count, 0);
  assert.deepEqual(room.events, [['remove', 'stack']]);
});

test('infinite and unknown dispensers do not consume inventory', () => {
  const room = roomHarness();
  const bowl = dispenser('goBowl', 7);
  const unknown = dispenser('missing', 4);
  afterDispense(room, bowl, 'bowl');
  afterDispense(room, unknown, 'unknown');
  assert.equal(bowl.count, 7);
  assert.equal(unknown.count, 4);
  assert.deepEqual(room.events, []);
});
