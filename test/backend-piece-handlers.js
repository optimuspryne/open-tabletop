import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerPieceHandlers } from '../server/game/handlers/pieces.js';

const MESSAGE_NAMES = [
  'setStandGroup',
  'setSnapGroup',
  'rollGroup',
  'flipGroup',
  'setOpenGroup',
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
  'gatherDispensers',
  'absorbIntoDispenser',
  'dispenseFromPieces',
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
    updateStackCollider(id) {
      events.push({ name: 'stackCollider', payload: id });
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
    spawnY: 4,
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

const dispenser = (disp, count, extra = {}) => ({
  type: 'dispenser',
  count,
  props: JSON.stringify({ disp, ...extra }),
});

test('gathering like dispensers sums their stacks into one at the centre', async () => {
  const { room, handlers, events } = harness();
  room.state.pieces.set('1', dispenser('pokerStack', 20, { color: 0xd14b4b }));
  room.bodies.set('1', body({ x: 0, z: 0 }));
  room.state.pieces.set('2', dispenser('pokerStack', 30, { color: 0xd14b4b }));
  room.bodies.set('2', body({ x: 2, z: 0 }));

  await handlers.get('gatherDispensers')(client, { ids: ['1', '2'] });

  const spawn = events.find((e) => e.name === 'spawn');
  assert.equal(spawn.payload.type, 'dispenser');
  assert.deepEqual(spawn.payload.props, { disp: 'pokerStack', count: 50, color: 0xd14b4b });
  assert.deepEqual(spawn.payload.position, [1, 4, 0]); // centroid x/z, spawnY
  assert.equal(room.state.pieces.has('1'), false);
  assert.equal(room.state.pieces.has('2'), false);
  assert.deepEqual(events.at(-1), { name: 'sfx', payload: { type: 'object-drop' } });
});

test('gathering preserves the true token total past the per-stack spawn cap', async () => {
  const { room, handlers } = harness();
  // Simulate the real spawn clamping the stack to its max on the way in.
  room.spawn = (type, position, props) => {
    room.state.pieces.set('merged', {
      type,
      count: Math.min(props.count, 100),
      props: JSON.stringify(props),
    });
    return 'merged';
  };
  room.state.pieces.set('1', dispenser('pokerStack', 100));
  room.bodies.set('1', body({ x: 0, z: 0 }));
  room.state.pieces.set('2', dispenser('pokerStack', 100));
  room.bodies.set('2', body({ x: 0, z: 0 }));

  await handlers.get('gatherDispensers')(client, { ids: ['1', '2'] });

  assert.equal(room.state.pieces.get('merged').count, 200); // restored past the clamp
});

test('gathering refuses a mix of dispenser kinds', async () => {
  const { room, handlers, events } = harness();
  room.state.pieces.set('1', dispenser('pokerStack', 20, { color: 0xd14b4b }));
  room.bodies.set('1', body({ x: 0, z: 0 }));
  room.state.pieces.set('2', dispenser('coinStack', 20, { color: 0xd4af37 }));
  room.bodies.set('2', body({ x: 2, z: 0 }));

  await handlers.get('gatherDispensers')(client, { ids: ['1', '2'] });

  assert.equal(room.state.pieces.has('1'), true);
  assert.equal(room.state.pieces.has('2'), true);
  assert.equal(
    events.some((e) => e.name === 'spawn'),
    false,
  );
});

test('gathering excludes infinite bowls (nothing to pour)', async () => {
  const { room, handlers, events } = harness();
  room.state.pieces.set('1', dispenser('goBowl', 0, { team: 0 }));
  room.bodies.set('1', body({ x: 0, z: 0 }));
  room.state.pieces.set('2', dispenser('goBowl', 0, { team: 0 }));
  room.bodies.set('2', body({ x: 2, z: 0 }));

  await handlers.get('gatherDispensers')(client, { ids: ['1', '2'] });

  assert.equal(room.state.pieces.has('1'), true);
  assert.equal(
    events.some((e) => e.name === 'spawn'),
    false,
  );
});

const chip = (color) => ({ type: 'prop', props: JSON.stringify({ shape: 'poker_chip', color }) });
const stone = (team) => ({ type: 'prop', props: JSON.stringify({ shape: 'go', team }) });

test('absorbing loose pieces pours matching ones back into the one dispenser', async () => {
  const { room, handlers, events } = harness();
  room.state.pieces.set('9', dispenser('pokerStack', 20, { color: 0xd14b4b }));
  room.bodies.set('9', body({ x: 0, z: 0 }));
  room.state.pieces.set('1', chip(0xd14b4b));
  room.bodies.set('1', body({ x: 1, z: 0 }));
  room.state.pieces.set('2', chip(0xd14b4b));
  room.bodies.set('2', body({ x: 2, z: 0 }));
  room.state.pieces.set('3', chip(0x5b8ad6)); // a blue chip — does not match
  room.bodies.set('3', body({ x: 3, z: 0 }));

  await handlers.get('absorbIntoDispenser')(client, { ids: ['9', '1', '2', '3'] });

  assert.equal(room.state.pieces.get('9').count, 22); // two red chips absorbed
  assert.equal(room.state.pieces.has('1'), false);
  assert.equal(room.state.pieces.has('2'), false);
  assert.equal(room.state.pieces.has('3'), true, 'the mismatched chip is left');
  assert.deepEqual(events.at(-1), { name: 'sfx', payload: { type: 'object-drop' } });
});

test('absorbing an infinite bowl swallows stones without touching a count', async () => {
  const { room, handlers } = harness();
  room.state.pieces.set('9', dispenser('goBowl', 0, { team: 0 }));
  room.bodies.set('9', body({ x: 0, z: 0 }));
  room.state.pieces.set('1', stone(0));
  room.bodies.set('1', body({ x: 1, z: 0 }));

  await handlers.get('absorbIntoDispenser')(client, { ids: ['9', '1'] });

  assert.equal(room.state.pieces.has('1'), false);
  assert.equal(room.state.pieces.get('9').count, 0); // infinite → unchanged
});

test('absorbing refuses when more than one dispenser is selected', async () => {
  const { room, handlers, events } = harness();
  room.state.pieces.set('8', dispenser('pokerStack', 20, { color: 0xd14b4b }));
  room.bodies.set('8', body({ x: 0, z: 0 }));
  room.state.pieces.set('9', dispenser('pokerStack', 20, { color: 0xd14b4b }));
  room.bodies.set('9', body({ x: 2, z: 0 }));
  room.state.pieces.set('1', chip(0xd14b4b));
  room.bodies.set('1', body({ x: 1, z: 0 }));

  await handlers.get('absorbIntoDispenser')(client, { ids: ['8', '9', '1'] });

  assert.equal(room.state.pieces.has('1'), true);
  assert.equal(
    events.some((e) => e.name === 'stackCollider'),
    false,
  );
});

test('minting a dispenser from loose pieces sums them into a new stack', async () => {
  const { room, handlers, events } = harness();
  room.state.pieces.set('1', chip(0xd14b4b));
  room.bodies.set('1', body({ x: 0, z: 0 }));
  room.state.pieces.set('2', chip(0xd14b4b));
  room.bodies.set('2', body({ x: 2, z: 0 }));
  room.state.pieces.set('3', chip(0xd14b4b));
  room.bodies.set('3', body({ x: 4, z: 0 }));

  await handlers.get('dispenseFromPieces')(client, { ids: ['1', '2', '3'] });

  const spawn = events.find((e) => e.name === 'spawn');
  assert.equal(spawn.payload.type, 'dispenser');
  assert.deepEqual(spawn.payload.props, { disp: 'pokerStack', color: 0xd14b4b, count: 3 });
  assert.deepEqual(spawn.payload.position, [2, 4, 0]); // centroid x/z, spawnY
  assert.equal(room.state.pieces.size, 0);
});

test('minting from go stones makes an infinite bowl with no count', async () => {
  const { room, handlers, events } = harness();
  room.state.pieces.set('1', stone(0));
  room.bodies.set('1', body({ x: 0, z: 0 }));
  room.state.pieces.set('2', stone(0));
  room.bodies.set('2', body({ x: 2, z: 0 }));

  await handlers.get('dispenseFromPieces')(client, { ids: ['1', '2'] });

  const spawn = events.find((e) => e.name === 'spawn');
  assert.deepEqual(spawn.payload.props, { disp: 'goBowl', team: 0 }); // no count on an infinite bowl
});

test('minting refuses mixed pieces and refuses when a dispenser is present', async () => {
  const { room, handlers, events } = harness();
  room.state.pieces.set('1', chip(0xd14b4b));
  room.bodies.set('1', body({ x: 0, z: 0 }));
  room.state.pieces.set('2', chip(0x5b8ad6)); // different color → mixed
  room.bodies.set('2', body({ x: 2, z: 0 }));
  await handlers.get('dispenseFromPieces')(client, { ids: ['1', '2'] });
  assert.equal(
    events.some((e) => e.name === 'spawn'),
    false,
  );

  room.state.pieces.set('9', dispenser('pokerStack', 20, { color: 0xd14b4b }));
  room.bodies.set('9', body({ x: 1, z: 0 }));
  room.state.pieces.set('4', chip(0xd14b4b));
  room.bodies.set('4', body({ x: 3, z: 0 }));
  await handlers.get('dispenseFromPieces')(client, { ids: ['1', '4', '9'] });
  assert.equal(
    events.some((e) => e.name === 'spawn'),
    false,
  ); // a dispenser present → not mint
});

test('setOpenGroup turns cards double-sided, revealing a hidden front, and toggles back off', async () => {
  const { room, handlers } = harness();
  room.state.pieces.set('1', { type: 'card', props: JSON.stringify({ back: 'cover' }) });
  room.bodies.set('1', body());
  room.cardData.set('1', { front: 'secretFace' });

  await handlers.get('setOpenGroup')(client, { ids: ['1'] });
  let cp = JSON.parse(room.state.pieces.get('1').props);
  assert.equal(cp.open, true);
  assert.equal(cp.front, 'secretFace'); // hidden face revealed → both public
  assert.equal(cp.back, 'cover');
  assert.equal(room.cardData.has('1'), false);

  await handlers.get('setOpenGroup')(client, { ids: ['1'] }); // toggle off
  assert.equal(JSON.parse(room.state.pieces.get('1').props).open, undefined);
});

test('group flip turns over open tiles without concealing', async () => {
  const { room, handlers } = harness();
  room.state.pieces.set('1', {
    type: 'card',
    props: JSON.stringify({ open: true, front: 'A', back: 'B' }),
  });
  room.bodies.set('1', body());

  await handlers.get('flipGroup')(client, { ids: ['1'] });

  const cp = JSON.parse(room.state.pieces.get('1').props);
  assert.equal(cp.front, 'B');
  assert.equal(cp.back, 'A');
  assert.equal(room.cardData.has('1'), false);
});
