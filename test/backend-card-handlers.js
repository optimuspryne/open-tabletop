import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerCardHandlers } from '../server/game/handlers/cards.js';

function harness() {
  const handlers = new Map();
  const events = [];
  const room = {
    state: { pieces: new Map() },
    bodies: new Map(),
    deckCards: new Map(),
    cardData: new Map(),
    pendingInspect: new Map(),
    targets: new Map(),
    onMessage(name, handler) {
      handlers.set(name, handler);
    },
    broadcast(name, payload) {
      events.push({ name, payload });
    },
    addToHand(client, front, back, geo) {
      events.push({ name: 'hand', payload: { client, front, back, geo } });
    },
    removePiece(id) {
      this.state.pieces.delete(id);
      this.bodies.delete(id);
      events.push({ name: 'removed', payload: id });
    },
    updateDeckCollider(id) {
      events.push({ name: 'collider', payload: id });
    },
    besideDeck() {
      return [2, 1, 3];
    },
    spawnCardFlat(position, props) {
      const id = `card-${this.state.pieces.size}`;
      this.state.pieces.set(id, { type: 'card', props: JSON.stringify(props), owner: '' });
      this.bodies.set(id, { position: { x: position[0], y: position[1], z: position[2] } });
      return id;
    },
    spawn(type, position, props) {
      events.push({ name: 'spawn', payload: { type, position, props } });
    },
    notifyFull(c) {
      events.push({ name: 'full', payload: c.sessionId });
    },
  };
  registerCardHandlers(room, {
    flipHop: 1.6,
    maxPieces: 80,
    spawnY: 4,
    geoOf: (props) => (props.tile ? { tile: props.tile } : {}),
    dropSfx: () => 'card-drop',
    randomPosition: () => [0, 4, 0],
    shuffle: (cards) => cards.reverse(),
    logger: { error() {} },
  });
  return { room, handlers, events };
}

const makeClient = () => ({
  sessionId: 'client-1',
  sent: [],
  send(type, payload) {
    this.sent.push({ type, payload });
  },
});
const client = makeClient();

test('card handler module registers the complete card/deck message family', () => {
  const { handlers } = harness();
  assert.deepEqual(
    [...handlers.keys()],
    [
      'flip',
      'dealToTable',
      'drawToHand',
      'dealDrag',
      'takeCard',
      'drawInspect',
      'inspectPlace',
      'shuffle',
      'splitDeck',
      'combineIntoDeck',
    ],
  );
});

test('flipping moves a face between public props and private card data', () => {
  const { room, handlers, events } = harness();
  const body = {
    velocity: { y: 0 },
    wakeUpCalled: false,
    wakeUp() {
      this.wakeUpCalled = true;
    },
  };
  room.state.pieces.set('1', {
    type: 'card',
    props: JSON.stringify({ front: 'ace', back: 'blue' }),
  });
  room.bodies.set('1', body);

  handlers.get('flip')(client, { id: '1' });
  assert.deepEqual(JSON.parse(room.state.pieces.get('1').props), { back: 'blue' });
  assert.deepEqual(room.cardData.get('1'), { front: 'ace' });
  assert.equal(body.velocity.y, 1.6);

  handlers.get('flip')(client, { id: '1' });
  assert.deepEqual(JSON.parse(room.state.pieces.get('1').props), { back: 'blue', front: 'ace' });
  assert.equal(room.cardData.has('1'), false);
  assert.equal(events.filter((event) => event.name === 'sfx').length, 2);
});

test('drawing the final deck card adds it privately and removes the empty deck', () => {
  const { room, handlers, events } = harness();
  room.state.pieces.set('1', {
    type: 'deck',
    count: 1,
    props: JSON.stringify({ back: 'blue', tile: 'domino' }),
  });
  room.deckCards.set('1', ['hidden-front']);
  handlers.get('drawToHand')(client, { deckId: '1' });

  assert.equal(room.state.pieces.has('1'), false);
  assert.equal(room.deckCards.get('1').length, 0);
  assert.deepEqual(events.find((event) => event.name === 'hand').payload, {
    client,
    front: 'hidden-front',
    back: 'blue',
    geo: { tile: 'domino' },
  });
});

test('malformed drag messages cannot consume a card or create a physics target', () => {
  const { room, handlers } = harness();
  room.state.pieces.set('1', { type: 'deck', count: 1, props: '{}' });
  room.deckCards.set('1', ['front']);
  room.bodies.set('1', { position: { x: 0, y: 1, z: 0 } });

  for (const message of [
    null,
    { deckId: '1', x: Infinity, y: 1, z: 2 },
    { deckId: '1', x: '0', y: 1, z: 2 },
  ]) {
    handlers.get('dealDrag')(client, message);
  }
  assert.deepEqual(room.deckCards.get('1'), ['front']);
  assert.equal(room.targets.size, 0);
});

test('an inspected card returned to its deck restores count and clears pending state', () => {
  const { room, handlers } = harness();
  room.state.pieces.set('1', { type: 'deck', count: 1, props: JSON.stringify({ back: 'red' }) });
  room.deckCards.set('1', ['front']);
  handlers.get('drawInspect')(client, { deckId: '1' });
  assert.equal(room.deckCards.get('1').length, 0);
  assert.equal(room.pendingInspect.has(client.sessionId), true);

  handlers.get('inspectPlace')(client, { where: 'deck' });
  assert.deepEqual(room.deckCards.get('1'), ['front']);
  assert.equal(room.state.pieces.get('1').count, 1);
  assert.equal(room.pendingInspect.has(client.sessionId), false);
});

test('card exceptions are reported without disabling later messages', async () => {
  const { room, handlers } = harness();
  const user = makeClient();
  const body = { velocity: { y: 0 }, wakeUp() {} };
  room.state.pieces.set('1', {
    type: 'card',
    props: JSON.stringify({ front: 'ace', back: 'blue' }),
  });
  room.bodies.set('1', body);
  const broadcast = room.broadcast;
  room.broadcast = () => {
    throw new Error('broadcast failure');
  };
  await handlers.get('flip')(user, { id: '1' });
  assert.deepEqual(user.sent, [
    {
      type: 'serverError',
      payload: { operation: 'flip', message: 'Server error. Try again.' },
    },
  ]);
  room.broadcast = broadcast;
  await handlers.get('flip')(user, { id: '1' });
  assert.equal(room.cardData.has('1'), false);
});

test('dealing onto a full table is blocked and notifies the client (piece cap)', () => {
  const { room, handlers, events } = harness();
  room.state.pieces.set('1', {
    type: 'deck',
    count: 5,
    props: JSON.stringify({ back: 'blue' }),
  });
  room.deckCards.set('1', ['a', 'b', 'c', 'd', 'e']);
  room.bodies.set('1', { position: { x: 0, y: 1, z: 0 } });
  // Fill the rest of the table to the cap (harness injects maxPieces: 80).
  while (room.state.pieces.size < 80) {
    room.state.pieces.set(`filler-${room.state.pieces.size}`, { type: 'card' });
  }

  const c = makeClient();
  handlers.get('dealToTable')(c, { deckId: '1' });
  handlers.get('dealDrag')(c, { deckId: '1', x: 0, y: 1, z: 0 });

  assert.equal(room.state.pieces.size, 80, 'no card spawned onto a full table');
  assert.deepEqual(room.deckCards.get('1'), ['a', 'b', 'c', 'd', 'e'], 'no deck card consumed');
  assert.equal(room.targets.size, 0, 'dealDrag created no physics target when blocked');
  assert.equal(
    events.filter((event) => event.name === 'full').length,
    2,
    'each blocked deal told the client the table is full',
  );
});

test('combining loose cards and a deck consolidates them top-first into one deck', () => {
  const { room, handlers, events } = harness();
  // A loose face-up card sitting above a two-card deck (higher y = on top of the table).
  room.state.pieces.set('1', {
    type: 'card',
    props: JSON.stringify({ back: 'blue', front: 'ace' }),
  });
  room.bodies.set('1', { position: { x: 2, y: 3, z: 0 } });
  room.state.pieces.set('2', { type: 'deck', props: JSON.stringify({ back: 'blue' }) });
  room.bodies.set('2', { position: { x: 0, y: 1, z: 4 } });
  room.deckCards.set('2', ['king', 'queen']);

  handlers.get('combineIntoDeck')(client, { ids: ['1', '2'] });

  const spawn = events.find((e) => e.name === 'spawn');
  assert.equal(spawn.payload.type, 'deck');
  assert.deepEqual(spawn.payload.props.cards, ['ace', 'king', 'queen']); // top card first
  assert.equal(spawn.payload.props.back, 'blue');
  assert.deepEqual(spawn.payload.position, [1, 4, 2]); // centroid x/z, spawnY
  assert.equal(room.state.pieces.has('1'), false);
  assert.equal(room.state.pieces.has('2'), false);
  // the harness dropSfx mock is arg-insensitive; the point is a drop cue fired
  assert.equal(events.at(-1).name, 'sfx');
});

test('combining refuses a selection whose backs disagree (no partial combine)', () => {
  const { room, handlers, events } = harness();
  room.state.pieces.set('1', {
    type: 'card',
    props: JSON.stringify({ back: 'blue', front: 'ace' }),
  });
  room.bodies.set('1', { position: { x: 0, y: 1, z: 0 } });
  room.state.pieces.set('2', {
    type: 'card',
    props: JSON.stringify({ back: 'red', front: 'two' }),
  });
  room.bodies.set('2', { position: { x: 1, y: 1, z: 0 } });

  handlers.get('combineIntoDeck')(client, { ids: ['1', '2'] });

  assert.equal(room.state.pieces.has('1'), true, 'both cards left on the table');
  assert.equal(room.state.pieces.has('2'), true);
  assert.equal(
    events.some((e) => e.name === 'spawn'),
    false,
  );
});

test('combining ignores non-card pieces and needs two card-family members', () => {
  const { room, handlers, events } = harness();
  room.state.pieces.set('1', {
    type: 'card',
    props: JSON.stringify({ back: 'blue', front: 'ace' }),
  });
  room.bodies.set('1', { position: { x: 0, y: 1, z: 0 } });
  room.state.pieces.set('2', { type: 'die', props: '{}' });
  room.bodies.set('2', { position: { x: 1, y: 1, z: 0 } });

  handlers.get('combineIntoDeck')(client, { ids: ['1', '2'] });

  assert.equal(room.state.pieces.has('1'), true);
  assert.equal(
    events.some((e) => e.name === 'spawn'),
    false,
  ); // only one card-family piece
});
