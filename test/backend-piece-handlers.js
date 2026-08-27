import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerPieceHandlers } from '../server/game/handlers/pieces.js';

const MESSAGE_NAMES = [
  'setStandGroup',
  'setSnapGroup',
  'rollGroup',
  'flipGroup',
  'takeGroup',
  'rotateGroup',
  'recolor',
  'recolorGroup',
  'spawn',
  'rollOne',
  'setStand',
  'setSnap',
  'snap',
  'remove',
  'removeGroup',
];

function vector(initial = {}) {
  return {
    x: initial.x || 0,
    y: initial.y || 0,
    z: initial.z || 0,
    set(x, y, z) {
      Object.assign(this, { x, y, z });
    },
    setZero() {
      this.set(0, 0, 0);
    },
  };
}

function body(position = {}) {
  return {
    position: vector(position),
    velocity: vector(),
    angularVelocity: vector(),
    wakeCount: 0,
    wakeUp() {
      this.wakeCount++;
    },
  };
}

function harness({ rank = 3 } = {}) {
  const handlers = new Map();
  const events = [];
  const room = {
    state: {
      pieces: new Map(),
      scale: { gridStyle: 'square', cellWorld: 1, cellZ: 1, snapAnchor: 'cross' },
      trays: new Map(),
    },
    bodies: new Map(),
    targets: new Map(),
    cardData: new Map(),
    onMessage(name, handler) {
      handlers.set(name, handler);
    },
    rank() {
      return rank;
    },
    standOf(piece) {
      return JSON.parse(piece.props || '{}').stand || false;
    },
    naturalStand() {
      return 'upright';
    },
    unpinPiece(id) {
      events.push({ name: 'unpin', payload: id });
    },
    broadcast(name, payload) {
      events.push({ name, payload });
    },
    addToHand(client, front, back, geo) {
      events.push({ name: 'hand', payload: { client, front, back, geo } });
    },
    removePiece(id) {
      this.state.pieces.delete(id);
      events.push({ name: 'remove', payload: id });
    },
    recolorPiece(id, colors) {
      events.push({ name: 'recolor', payload: { id, colors } });
    },
    spawn(type, position, props) {
      events.push({ name: 'spawn', payload: { type, position, props } });
    },
    swapBoard(props) {
      events.push({ name: 'board', payload: props });
    },
    seatOf() {
      return 0;
    },
    trayDropPos() {
      return [4, 2, 5];
    },
  };
  registerPieceHandlers(room, {
    maxPieces: 80,
    flipHop: 1.6,
    roll: { up: 16, spread: 8, spin: 22 },
    trayRoll: { up: 8, spread: 13, spin: 30 },
    boardKeys: ['chess'],
    propKeys: ['pawn'],
    dispenserKeys: ['chips'],
    colliders: ['flat'],
    geoOf: (props) => (props.tile ? { tile: props.tile } : {}),
    randomPosition: () => [1, 4, 2],
    random: () => 0.5,
    logger: { error() {} },
  });
  return { room, handlers, events };
}

const client = { sessionId: 'client-1', send() {} };

test('piece handler module registers the complete piece and group family', () => {
  assert.deepEqual([...harness().handlers.keys()], MESSAGE_NAMES);
});

test('group flipping keeps hidden card fronts in private room state', async () => {
  const { room, handlers, events } = harness();
  room.state.pieces.set('1', {
    type: 'card',
    props: JSON.stringify({ front: 'ace', back: 'blue' }),
  });
  room.bodies.set('1', body());
  await handlers.get('flipGroup')(client, { ids: ['1'] });

  assert.deepEqual(JSON.parse(room.state.pieces.get('1').props), { back: 'blue' });
  assert.deepEqual(room.cardData.get('1'), { front: 'ace' });
  assert.equal(room.bodies.get('1').velocity.y, 1.6);
  assert.deepEqual(events.at(-1), { name: 'sfx', payload: { type: 'card-flip' } });
});

test('snap toggles quantize body position and release its drag target', async () => {
  const { room, handlers } = harness();
  room.state.pieces.set('1', { type: 'prop', props: '{}' });
  room.bodies.set('1', body({ x: 1.4, z: 2.6 }));
  room.targets.set('1', { x: 9, y: 9, z: 9 });
  await handlers.get('setSnap')(client, { id: '1' });

  assert.deepEqual(JSON.parse(room.state.pieces.get('1').props), { snap: true });
  assert.equal(room.bodies.get('1').position.x, 1);
  assert.equal(room.bodies.get('1').position.z, 3);
  assert.equal(room.targets.has('1'), false);
});

test('group roll affects dice only and selects tray physics when applicable', async () => {
  const { room, handlers, events } = harness();
  const die = body();
  die.__traySeat = 0;
  room.state.pieces.set('1', { type: 'die', props: '{}' });
  room.state.pieces.set('2', { type: 'prop', props: '{}' });
  room.bodies.set('1', die);
  room.bodies.set('2', body());
  await handlers.get('rollGroup')(client, { ids: ['1', '2'] });

  assert.equal(die.velocity.y, 8);
  assert.equal(room.bodies.get('2').velocity.y, 0);
  assert.deepEqual(events, [{ name: 'sfx', payload: { type: 'die-roll' } }]);
});

test('players cannot spawn or remove general table pieces', async () => {
  const { room, handlers, events } = harness({ rank: 0 });
  room.state.pieces.set('1', { type: 'prop', props: '{}' });
  await handlers.get('spawn')(client, { type: 'prop', props: { shape: 'pawn' } });
  await handlers.get('remove')(client, { id: '1' });
  assert.equal(room.state.pieces.has('1'), true);
  assert.deepEqual(events, []);
});

test('helpers can spawn validated pieces and remove a selection', async () => {
  const { room, handlers, events } = harness({ rank: 1 });
  room.state.pieces.set('1', { type: 'prop', props: '{}' });
  room.state.pieces.set('2', { type: 'prop', props: '{}' });
  await handlers.get('spawn')(client, { type: 'prop', props: { shape: 'pawn' } });
  await handlers.get('removeGroup')(client, { ids: ['1', '2'] });

  assert.deepEqual(events[0], {
    name: 'spawn',
    payload: { type: 'prop', position: [1, 4, 2], props: { shape: 'pawn' } },
  });
  assert.equal(room.state.pieces.size, 0);
});

test('malformed group messages do not mutate pieces', async () => {
  const { room, handlers, events } = harness();
  room.state.pieces.set('1', { type: 'prop', props: '{}' });
  for (const message of [null, { ids: [] }, { ids: ['1'], extra: true }]) {
    await handlers.get('removeGroup')(client, message);
  }
  assert.equal(room.state.pieces.has('1'), true);
  assert.deepEqual(events, []);
});
