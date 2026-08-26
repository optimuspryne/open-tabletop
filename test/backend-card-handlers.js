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
    onMessage(name, handler) { handlers.set(name, handler); },
    broadcast(name, payload) { events.push({ name, payload }); },
    addToHand(client, front, back, geo) { events.push({ name: 'hand', payload: { client, front, back, geo } }); },
    removePiece(id) { this.state.pieces.delete(id); this.bodies.delete(id); events.push({ name: 'removed', payload: id }); },
    updateDeckCollider(id) { events.push({ name: 'collider', payload: id }); },
    besideDeck() { return [2, 1, 3]; },
    spawnCardFlat(position, props) {
      const id = `card-${this.state.pieces.size}`;
      this.state.pieces.set(id, { type: 'card', props: JSON.stringify(props), owner: '' });
      this.bodies.set(id, { position: { x: position[0], y: position[1], z: position[2] } });
      return id;
    },
    spawn(type, position, props) { events.push({ name: 'spawn', payload: { type, position, props } }); },
  };
  registerCardHandlers(room, {
    flipHop: 1.6,
    maxPieces: 80,
    spawnY: 4,
    geoOf: (props) => props.tile ? { tile: props.tile } : {},
    dropSfx: () => 'card-drop',
    randomPosition: () => [0, 4, 0],
    shuffle: (cards) => cards.reverse(),
  });
  return { room, handlers, events };
}

const client = { sessionId: 'client-1', send() {} };

test('card handler module registers the complete card/deck message family', () => {
  const { handlers } = harness();
  assert.deepEqual([...handlers.keys()], [
    'flip', 'dealToTable', 'drawToHand', 'dealDrag', 'takeCard',
    'drawInspect', 'inspectPlace', 'shuffle', 'splitDeck',
  ]);
});

test('flipping moves a face between public props and private card data', () => {
  const { room, handlers, events } = harness();
  const body = { velocity: { y: 0 }, wakeUpCalled: false, wakeUp() { this.wakeUpCalled = true; } };
  room.state.pieces.set('card', { type: 'card', props: JSON.stringify({ front: 'ace', back: 'blue' }) });
  room.bodies.set('card', body);

  handlers.get('flip')(client, { id: 'card' });
  assert.deepEqual(JSON.parse(room.state.pieces.get('card').props), { back: 'blue' });
  assert.deepEqual(room.cardData.get('card'), { front: 'ace' });
  assert.equal(body.velocity.y, 1.6);

  handlers.get('flip')(client, { id: 'card' });
  assert.deepEqual(JSON.parse(room.state.pieces.get('card').props), { back: 'blue', front: 'ace' });
  assert.equal(room.cardData.has('card'), false);
  assert.equal(events.filter((event) => event.name === 'sfx').length, 2);
});

test('drawing the final deck card adds it privately and removes the empty deck', () => {
  const { room, handlers, events } = harness();
  room.state.pieces.set('deck', { type: 'deck', count: 1, props: JSON.stringify({ back: 'blue', tile: 'domino' }) });
  room.deckCards.set('deck', ['hidden-front']);
  handlers.get('drawToHand')(client, { deckId: 'deck' });

  assert.equal(room.state.pieces.has('deck'), false);
  assert.equal(room.deckCards.get('deck').length, 0);
  assert.deepEqual(events.find((event) => event.name === 'hand').payload,
    { client, front: 'hidden-front', back: 'blue', geo: { tile: 'domino' } });
});

test('malformed drag messages cannot consume a card or create a physics target', () => {
  const { room, handlers } = harness();
  room.state.pieces.set('deck', { type: 'deck', count: 1, props: '{}' });
  room.deckCards.set('deck', ['front']);
  room.bodies.set('deck', { position: { x: 0, y: 1, z: 0 } });

  for (const message of [null, { deckId: 'deck', x: Infinity, y: 1, z: 2 }, { deckId: 'deck', x: '0', y: 1, z: 2 }]) {
    handlers.get('dealDrag')(client, message);
  }
  assert.deepEqual(room.deckCards.get('deck'), ['front']);
  assert.equal(room.targets.size, 0);
});

test('an inspected card returned to its deck restores count and clears pending state', () => {
  const { room, handlers } = harness();
  room.state.pieces.set('deck', { type: 'deck', count: 1, props: JSON.stringify({ back: 'red' }) });
  room.deckCards.set('deck', ['front']);
  handlers.get('drawInspect')(client, { deckId: 'deck' });
  assert.equal(room.deckCards.get('deck').length, 0);
  assert.equal(room.pendingInspect.has(client.sessionId), true);

  handlers.get('inspectPlace')(client, { where: 'deck' });
  assert.deepEqual(room.deckCards.get('deck'), ['front']);
  assert.equal(room.state.pieces.get('deck').count, 1);
  assert.equal(room.pendingInspect.has(client.sessionId), false);
});
