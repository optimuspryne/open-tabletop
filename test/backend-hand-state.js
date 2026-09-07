import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendAccountHand, parkHand, claimHand } from '../server/game/hand-state.js';

test('multiple tabs park every card once and one returning tab reclaims the account inventory', () => {
  const card = { hid: 'h1', front: 'same', back: 'back', open: true };
  const room = {
    hands: new Map([
      ['a', [card]],
      ['b', [{ ...card, hid: 'h2' }]],
    ]),
    handOwners: new Map([
      ['a', '7'],
      ['b', '7'],
    ]),
    pendingHands: new Map([['7', { name: 'Player', cards: [{ ...card, hid: 'h0' }] }]]),
    state: { players: new Map(), unclaimed: new Map() },
  };
  const client = (sessionId) => ({ sessionId, auth: { userId: 7 } });
  parkHand(room, client('b'));
  parkHand(room, client('a'));
  parkHand(room, client('a')); // duplicate cleanup cannot duplicate inventory
  assert.deepEqual(
    room.pendingHands.get('7').cards.map((c) => c.hid),
    ['h0', 'h2', 'h1'],
  );
  assert.equal(room.handOwners.size, 0);
  assert.equal(room.hands.size, 0);
  claimHand(room, 7, 'returning');
  claimHand(room, 7, 'other-tab');
  assert.equal(room.hands.get('returning').length, 3);
  assert.equal(room.hands.has('other-tab'), false);
  assert.equal(room.pendingHands.size, 0);
  assert.equal(room.state.unclaimed.size, 0);
});

test('account aggregation preserves duplicates, metadata, and room-local ownership', () => {
  const first = new Map(),
    second = new Map();
  const cards = [{ front: 'same', back: 'custom', geom: { w: 2 }, open: true }];
  appendAccountHand(first, 7, 'Name', cards);
  appendAccountHand(first, '7', 'Other tab', cards);
  appendAccountHand(second, 7, 'Name', [{ front: 'different' }]);
  assert.equal(first.get('7').cards.length, 2);
  assert.deepEqual(first.get('7').cards[1], cards[0]);
  assert.equal(cards.length, 1);
  assert.equal(second.get('7').cards.length, 1);
});
