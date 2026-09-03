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
    addToHand(client, front, back, geo, open) {
      events.push({
        name: 'hand',
        payload: { client, front, back, geo, ...(open ? { open: true } : {}) },
      });
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

test('flipping a double-sided (open) tile turns it over — both faces stay public', () => {
  const { room, handlers, events } = harness();
  room.state.pieces.set('1', {
    type: 'card',
    props: JSON.stringify({ open: true, front: 'A', back: 'B' }),
  });
  room.bodies.set('1', { wakeUp() {}, velocity: {} });

  handlers.get('flip')(client, { id: '1' });

  let cp = JSON.parse(room.state.pieces.get('1').props);
  assert.equal(cp.front, 'A'); // faces stay stable — orientation is the `down` flag
  assert.equal(cp.back, 'B');
  assert.equal(cp.down, true); // now showing the back
  assert.equal(room.cardData.has('1'), false); // nothing concealed

  handlers.get('flip')(client, { id: '1' }); // flip back
  cp = JSON.parse(room.state.pieces.get('1').props);
  assert.equal(cp.down, undefined);
  assert.deepEqual(events.at(-1), { name: 'sfx', payload: { type: 'card-flip' } });
});

test('dealing from an open deck yields a face-down double-sided tile (both faces public)', () => {
  const { room, handlers } = harness();
  room.state.pieces.set('9', {
    type: 'deck',
    props: JSON.stringify({ back: 'cover', open: true }),
  });
  room.deckCards.set('9', ['a-front']);

  handlers.get('dealToTable')(client, { deckId: '9' });

  const cardId = [...room.state.pieces.keys()].find((k) => k.startsWith('card-'));
  const cp = JSON.parse(room.state.pieces.get(cardId).props);
  assert.equal(cp.open, true);
  assert.equal(cp.down, true); // dealt face-down (the back shows), but the content stays in `front`
  assert.equal(cp.front, 'a-front');
  assert.equal(cp.back, 'cover');
  assert.equal(room.cardData.has(cardId), false); // nothing concealed
});

test('a per-tile back rides to the dealt card and wins over the shared back', () => {
  const { room, handlers } = harness();
  room.state.pieces.set('9', { type: 'deck', props: JSON.stringify({ back: 'sharedBack' }) });
  room.deckCards.set('9', [{ front: 'treeFront', back: 'treeBack' }]);

  handlers.get('dealToTable')(client, { deckId: '9' });

  const cardId = [...room.state.pieces.keys()].find((k) => k.startsWith('card-'));
  const cp = JSON.parse(room.state.pieces.get(cardId).props);
  assert.equal(cp.back, 'treeBack'); // per-tile back, not 'sharedBack'
  assert.equal(room.cardData.get(cardId).front, 'treeFront'); // secret deck → front hidden
});

test('taking a double-sided card to hand carries its open flag and both faces', () => {
  const { room, handlers, events } = harness();
  room.state.pieces.set('1', {
    type: 'card',
    props: JSON.stringify({ open: true, front: 'A', back: 'B' }),
  });

  handlers.get('takeCard')(client, { id: '1' });

  const hand = events.find((e) => e.name === 'hand').payload;
  assert.equal(hand.open, true);
  assert.equal(hand.front, 'A');
  assert.equal(hand.back, 'B');
});

test('drawing to hand from an open deck carries the open flag', () => {
  const { room, handlers, events } = harness();
  room.state.pieces.set('1', {
    type: 'deck',
    props: JSON.stringify({ back: 'cover', open: true }),
  });
  room.deckCards.set('1', ['x-front']);

  handlers.get('drawToHand')(client, { deckId: '1' });

  assert.equal(events.find((e) => e.name === 'hand').payload.open, true);
});

test("an open tile set's cover follows the new top tile as tiles are drawn", () => {
  const { room, handlers } = harness();
  room.state.pieces.set('9', {
    type: 'deck',
    props: JSON.stringify({ back: 'plain', open: true, cover: 'b2' }),
  });
  room.deckCards.set('9', [
    { front: 'f1', back: 'b1' },
    { front: 'f2', back: 'b2' }, // the current top (drawn first)
  ]);

  handlers.get('dealToTable')(client, { deckId: '9' });

  const dp = JSON.parse(room.state.pieces.get('9').props);
  assert.equal(dp.cover, 'b1'); // the newly-exposed top tile's back
});

test("shuffling repaints an open set's cover to the new top; a secret deck stays coverless", () => {
  const { room, handlers } = harness();
  room.state.pieces.set('9', {
    type: 'deck',
    props: JSON.stringify({ back: 'plain', open: true, cover: 'b2' }),
  });
  room.deckCards.set('9', [
    { front: 'f1', back: 'b1' },
    { front: 'f2', back: 'b2' },
  ]);
  handlers.get('shuffle')(client, { deckId: '9' }); // mock shuffle reverses → top becomes b1
  assert.equal(JSON.parse(room.state.pieces.get('9').props).cover, 'b1');

  room.state.pieces.set('s', { type: 'deck', props: JSON.stringify({ back: 'secret' }) });
  room.deckCards.set('s', ['x', 'y']);
  handlers.get('shuffle')(client, { deckId: 's' });
  assert.equal('cover' in JSON.parse(room.state.pieces.get('s').props), false); // never revealed
});
