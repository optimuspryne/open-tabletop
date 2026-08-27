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
    onMessage(name, handler) {
      handlers.set(name, handler);
    },
    releasePiece(id, velocity) {
      released.push({ id, velocity });
    },
  };
  registerMovementHandlers(room, {
    isMovable: (piece) => piece.movable === true,
    logger: { error() {} },
  });
  return { room, handlers, released };
}

const actor = (sessionId) => ({
  sessionId,
  sent: [],
  send(type, payload) {
    this.sent.push({ type, payload });
  },
});
const alice = actor('alice');
const bob = actor('bob');

test('movement module registers the single and group movement messages', () => {
  assert.deepEqual(
    [...harness().handlers.keys()],
    ['grab', 'move', 'release', 'grabGroup', 'moveGroup', 'releaseGroup'],
  );
});

test('grab claims only free, movable pieces that are not flipping', () => {
  const { room, handlers } = harness();
  room.state.pieces.set('1', { movable: true, owner: '' });
  room.state.pieces.set('2', { movable: false, owner: '' });
  room.state.pieces.set('3', { movable: true, owner: 'bob' });
  room.state.pieces.set('4', { movable: true, owner: '' });
  room.flips.set('4', {});

  for (const id of ['1', '2', '3', '4']) handlers.get('grab')(alice, { id });
  assert.equal(room.state.pieces.get('1').owner, 'alice');
  assert.equal(room.state.pieces.get('2').owner, '');
  assert.equal(room.state.pieces.get('3').owner, 'bob');
  assert.equal(room.state.pieces.get('4').owner, '');
});

test('only the owner can move or release a claimed piece', () => {
  const { room, handlers, released } = harness();
  room.state.pieces.set('1', { movable: true, owner: 'alice' });

  handlers.get('move')(bob, { id: '1', x: 1, y: 2, z: 3 });
  handlers.get('release')(bob, { id: '1', v: [4, 5, 6] });
  assert.equal(room.targets.size, 0);
  assert.deepEqual(released, []);

  handlers.get('move')(alice, { id: '1', x: 1, y: 2, z: 3 });
  handlers.get('release')(alice, { id: '1', v: [4, 5, 6] });
  assert.deepEqual(room.targets.get('1'), { x: 1, y: 2, z: 3 });
  assert.deepEqual(released, [{ id: '1', velocity: [4, 5, 6] }]);
});

test('group grab records offsets and excludes pieces owned by another client', () => {
  const { room, handlers } = harness();
  room.state.pieces.set('1', { movable: true, owner: '' });
  room.state.pieces.set('2', { movable: true, owner: '' });
  room.state.pieces.set('3', { movable: true, owner: 'bob' });
  room.bodies.set('1', { position: { x: 10, y: 2, z: 5 } });
  room.bodies.set('2', { position: { x: 13, y: 4, z: 1 } });
  room.bodies.set('3', { position: { x: 9, y: 2, z: 5 } });

  handlers.get('grabGroup')(alice, { ids: ['1', '2', '3'], anchor: '1' });
  assert.equal(room.state.pieces.get('1').owner, 'alice');
  assert.equal(room.state.pieces.get('2').owner, 'alice');
  assert.equal(room.state.pieces.get('3').owner, 'bob');
  assert.deepEqual(room.groups.get('alice').get('2'), { x: 3, y: 2, z: -4 });

  handlers.get('moveGroup')(alice, { x: 20, y: 3, z: 8 });
  assert.deepEqual(room.targets.get('2'), { x: 23, y: 5, z: 4 });
});

test('malformed movement messages fail closed without changing state', () => {
  const { room, handlers, released } = harness();
  room.state.pieces.set('1', { movable: true, owner: 'alice' });
  for (const message of [
    null,
    {},
    { id: '1', x: NaN, y: 0, z: 0 },
    { id: '1', x: '1', y: 0, z: 0 },
  ]) {
    handlers.get('move')(alice, message);
  }
  handlers.get('grab')(alice, null);
  handlers.get('release')(bob, null);
  handlers.get('grabGroup')(alice, null);
  handlers.get('releaseGroup')(alice, null);
  assert.equal(room.targets.size, 0);
  assert.deepEqual(released, []);
});

test('movement exceptions are reported without disabling later messages', async () => {
  const { room, handlers } = harness();
  const user = actor('moving-client');
  room.state.pieces.set('1', { movable: true, owner: user.sessionId });
  room.releasePiece = () => {
    throw new Error('physics failure');
  };
  await handlers.get('release')(user, { id: '1', v: [0, 0, 0] });
  assert.deepEqual(user.sent, [
    {
      type: 'serverError',
      payload: { operation: 'release', message: 'Server error. Try again.' },
    },
  ]);
  room.state.pieces.set('2', { movable: true, owner: '' });
  await handlers.get('grab')(user, { id: '2' });
  assert.equal(room.state.pieces.get('2').owner, user.sessionId);
});
