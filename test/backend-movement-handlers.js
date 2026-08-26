import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerMovementHandlers } from '../server/game/handlers/movement.js';

function harness() {
  const handlers = new Map();
  const released = [];
  const room = {
    state: { pieces: new Map() },
    bodies: new Map(),
    flips: new Map(),
    targets: new Map(),
    groups: new Map(),
    onMessage(name, handler) { handlers.set(name, handler); },
    releasePiece(id, velocity) { released.push({ id, velocity }); },
  };
  registerMovementHandlers(room, { isMovable: (piece) => piece.movable === true });
  return { room, handlers, released };
}

const alice = { sessionId: 'alice' };
const bob = { sessionId: 'bob' };

test('movement module registers the single and group movement messages', () => {
  assert.deepEqual([...harness().handlers.keys()], ['grab', 'move', 'release', 'grabGroup', 'moveGroup', 'releaseGroup']);
});

test('grab claims only free, movable pieces that are not flipping', () => {
  const { room, handlers } = harness();
  room.state.pieces.set('free', { movable: true, owner: '' });
  room.state.pieces.set('static', { movable: false, owner: '' });
  room.state.pieces.set('owned', { movable: true, owner: 'bob' });
  room.state.pieces.set('flipping', { movable: true, owner: '' });
  room.flips.set('flipping', {});

  for (const id of ['free', 'static', 'owned', 'flipping']) handlers.get('grab')(alice, { id });
  assert.equal(room.state.pieces.get('free').owner, 'alice');
  assert.equal(room.state.pieces.get('static').owner, '');
  assert.equal(room.state.pieces.get('owned').owner, 'bob');
  assert.equal(room.state.pieces.get('flipping').owner, '');
});

test('only the owner can move or release a claimed piece', () => {
  const { room, handlers, released } = harness();
  room.state.pieces.set('piece', { movable: true, owner: 'alice' });

  handlers.get('move')(bob, { id: 'piece', x: 1, y: 2, z: 3 });
  handlers.get('release')(bob, { id: 'piece', v: [4, 5, 6] });
  assert.equal(room.targets.size, 0);
  assert.deepEqual(released, []);

  handlers.get('move')(alice, { id: 'piece', x: 1, y: 2, z: 3 });
  handlers.get('release')(alice, { id: 'piece', v: [4, 5, 6] });
  assert.deepEqual(room.targets.get('piece'), { x: 1, y: 2, z: 3 });
  assert.deepEqual(released, [{ id: 'piece', velocity: [4, 5, 6] }]);
});

test('group grab records offsets and excludes pieces owned by another client', () => {
  const { room, handlers } = harness();
  room.state.pieces.set('anchor', { movable: true, owner: '' });
  room.state.pieces.set('free', { movable: true, owner: '' });
  room.state.pieces.set('owned', { movable: true, owner: 'bob' });
  room.bodies.set('anchor', { position: { x: 10, y: 2, z: 5 } });
  room.bodies.set('free', { position: { x: 13, y: 4, z: 1 } });
  room.bodies.set('owned', { position: { x: 9, y: 2, z: 5 } });

  handlers.get('grabGroup')(alice, { ids: ['anchor', 'free', 'owned'], anchor: 'anchor' });
  assert.equal(room.state.pieces.get('anchor').owner, 'alice');
  assert.equal(room.state.pieces.get('free').owner, 'alice');
  assert.equal(room.state.pieces.get('owned').owner, 'bob');
  assert.deepEqual(room.groups.get('alice').get('free'), { x: 3, y: 2, z: -4 });

  handlers.get('moveGroup')(alice, { x: 20, y: 3, z: 8 });
  assert.deepEqual(room.targets.get('free'), { x: 23, y: 5, z: 4 });
});

test('malformed movement messages fail closed without changing state', () => {
  const { room, handlers, released } = harness();
  room.state.pieces.set('piece', { movable: true, owner: 'alice' });
  for (const message of [null, {}, { id: 'piece', x: NaN, y: 0, z: 0 }, { id: 'piece', x: '1', y: 0, z: 0 }]) {
    handlers.get('move')(alice, message);
  }
  handlers.get('grab')(alice, null);
  handlers.get('release')(bob, null);
  handlers.get('grabGroup')(alice, null);
  handlers.get('releaseGroup')(alice, null);
  assert.equal(room.targets.size, 0);
  assert.deepEqual(released, []);
});
