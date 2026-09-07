import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerPlacementHandlers } from '../server/game/handlers/placement.js';
import { MAX_PIECES, assertPieceCapacity } from '../server/game/piece-capacity.js';

function harness(count = 0) {
  const handlers = new Map();
  const events = [];
  let next = count;
  const room = {
    state: {
      pieces: new Map(Array.from({ length: count }, (_, i) => [String(i), { type: 'die' }])),
    },
    hands: new Map(),
    bodies: new Map(),
    targets: new Map(),
    lastDrop: new Map(),
    onMessage: (type, handler) => handlers.set(type, handler),
    notifyFull: () => events.push('full'),
    broadcast: () => {},
    sendHand: () => {},
    dispenserItem: () => ({ type: 'prop', props: {} }),
    afterDispense: (piece) => {
      piece.count--;
    },
    spawn(type) {
      assertPieceCapacity(this);
      const id = String(next++);
      this.state.pieces.set(id, { type });
      return id;
    },
    spawnHandCard() {
      return this.spawn('card');
    },
  };
  const client = { sessionId: 'player', send: (type) => events.push(type) };
  registerPlacementHandlers(room, {
    randomPosition: () => [0, 2, 0],
    dropSfx: () => 'card-drop',
    logger: { error() {} },
  });
  return { room, client, handlers, events };
}

test('all placement messages register and direct creation refuses a full room', () => {
  const h = harness(MAX_PIECES);
  assert.deepEqual([...h.handlers.keys()], ['dispense', 'dispenseDrag', 'playCard', 'handToTable']);
  assert.throws(() => h.room.spawn('die'), /piece limit/);
  assert.equal(h.room.state.pieces.size, MAX_PIECES);
});

test('repeated dispenser messages stop at capacity without consuming remaining inventory', () => {
  const h = harness(1);
  const dispenser = { type: 'dispenser', count: 1000 };
  h.room.state.pieces.set('0', dispenser);
  for (let i = 0; i < 1000; i++) h.handlers.get('dispense')(h.client, { id: '0' });
  assert.equal(h.room.state.pieces.size, MAX_PIECES);
  assert.equal(dispenser.count, 1000 - (MAX_PIECES - 1));
  const remaining = dispenser.count;
  h.handlers.get('dispenseDrag')(h.client, { id: '0', x: 1, y: 2, z: 3 });
  assert.equal(dispenser.count, remaining);
  assert.equal(h.room.targets.size, 0);
  assert.equal(h.events.includes('dealt'), false);
});

test('a full table preserves a played card and the entire unplaced hand', () => {
  const h = harness(MAX_PIECES);
  const hand = [
    { hid: 'h1', front: 'ace' },
    { hid: 'h2', front: 'king' },
  ];
  h.room.hands.set('player', hand);
  h.handlers.get('playCard')(h.client, { hid: 'h1', faceDown: true });
  h.handlers.get('handToTable')(h.client, { faceDown: false });
  assert.equal(hand.length, 2);
  assert.deepEqual(h.events, ['full', 'full']);
});

test('placing a whole hand uses the final slot and preserves the remainder for retry', () => {
  const h = harness(MAX_PIECES - 1);
  const hand = [
    { hid: 'h1', front: 'ace' },
    { hid: 'h2', front: 'king' },
  ];
  h.room.hands.set('player', hand);
  h.handlers.get('handToTable')(h.client, { faceDown: false });
  assert.equal(h.room.state.pieces.size, MAX_PIECES);
  assert.deepEqual(hand, [{ hid: 'h2', front: 'king' }]);
  assert.equal(h.room.lastDrop.get('player').ids.length, 1);
});

test('oversized placement/drag coordinates are rejected before inventory changes', () => {
  const h = harness(1);
  const dispenser = { type: 'dispenser', count: 10 };
  h.room.state.pieces.set('0', dispenser);
  const hand = [{ hid: 'h1', front: 'ace' }];
  h.room.hands.set('player', hand);
  h.handlers.get('dispenseDrag')(h.client, { id: '0', x: 1e308, y: 2, z: 3 });
  h.handlers.get('playCard')(h.client, { hid: 'h1', faceDown: false, x: 1e308, z: 0 });
  assert.equal(dispenser.count, 10);
  assert.equal(hand.length, 1);
  assert.equal(h.room.state.pieces.size, 1);
});
