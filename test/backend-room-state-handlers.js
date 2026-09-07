import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerRoomStateHandlers,
  saveRoomStateNow,
  scheduleRoomSave,
} from '../server/game/handlers/room-state.js';

const MESSAGE_NAMES = [
  'stateSave',
  'notebook',
  'notebookSync',
  'timer',
  'score',
  'roomNotes',
  'table',
  'tableColor',
  'scaleSet',
  'calibrateGrid',
];

function harness({ rank = 3, scene = { pieces: [] }, sceneMaxBytes = 1000 } = {}) {
  const handlers = new Map();
  const events = [];
  const room = {
    roomId: 'room-1',
    savedScene: null,
    notebooks: new Map(),
    nextScoreId: 1,
    state: {
      timer: { running: false, mode: 'up', base: 0, since: 0, duration: 0 },
      scores: new Map(),
      notes: '',
      tableX: 10,
      tableZ: 7,
      tableShape: 'rect',
      rimWood: 'mahogany',
      feltColor: '#006633',
      skybox: '',
      scale: { gridStyle: 'off', cellWorld: 0 },
    },
    onMessage(name, handler) {
      handlers.set(name, handler);
    },
    rank() {
      return rank;
    },
    serializeGame() {
      return scene;
    },
    scheduleSave() {
      events.push({ name: 'save' });
    },
    buildBounds(x, z) {
      events.push({ name: 'bounds', payload: { x, z } });
    },
    calibrateGrid(payload) {
      events.push({ name: 'grid', payload });
    },
    scaleSnapshot() {
      return { ...this.state.scale };
    },
  };
  registerRoomStateHandlers(room, {
    createScoreRow: (label, score) => ({ label, score }),
    tableLimits: { minX: 4, maxX: 20, minZ: 3, maxZ: 20 },
    gridLiftMax: 3,
    sceneMaxBytes,
    now: () => 5000,
    logger: { error() {} },
  });
  return { room, handlers, events };
}

const client = () => ({
  sessionId: 'client-1',
  auth: { userId: 42 },
  sent: [],
  send(type, payload) {
    this.sent.push({ type, payload });
  },
});

test('room-state module registers the complete settings and persistence family', () => {
  assert.deepEqual([...harness().handlers.keys()], MESSAGE_NAMES);
});

test('helpers can update scores but cannot mutate GM-only room settings', async () => {
  const { room, handlers, events } = harness({ rank: 1 });
  const user = client();
  await handlers.get('score')(user, { action: 'add', label: 'Heroes' });
  await handlers.get('roomNotes')(user, { text: 'secret' });
  await handlers.get('table')(user, { x: 12, z: 8 });

  assert.deepEqual(room.state.scores.get('s1'), { label: 'Heroes', score: 0 });
  assert.equal(room.state.notes, '');
  assert.equal(room.state.tableX, 10);
  assert.deepEqual(events, [{ name: 'save' }]);
});

test('GM room settings update state, rebuild bounds, and schedule persistence', async () => {
  const { room, handlers, events } = harness({ rank: 2 });
  const user = client();
  await handlers.get('roomNotes')(user, { text: 'campaign notes' });
  await handlers.get('table')(user, { x: 12, z: 8 });
  await handlers.get('tableColor')(user, { color: '#123abc' });
  await handlers.get('scaleSet')(user, { gridStyle: 'square', cellWorld: 2 });

  assert.equal(room.state.notes, 'campaign notes');
  assert.deepEqual([room.state.tableX, room.state.tableZ], [12, 8]);
  assert.equal(room.state.feltColor, '#123abc');
  assert.equal(room.state.scale.gridStyle, 'square');
  assert.deepEqual(events[1], { name: 'bounds', payload: { x: 12, z: 8 } });
  assert.equal(events.filter(({ name }) => name === 'save').length, 4);
});

test('manual checkpoints reject oversized state without replacing the saved scene', async () => {
  const { room, handlers } = harness({ scene: { data: 'x'.repeat(200) }, sceneMaxBytes: 20 });
  const user = client();
  await handlers.get('stateSave')(user);
  assert.equal(room.savedScene, null);
  assert.equal(user.sent[0].type, 'sceneError');
});

test('private notebooks follow an account across sessions without a durable save', async () => {
  const { room, handlers, events } = harness({ rank: 0 });
  const first = client();
  await handlers.get('notebook')(first, { text: 'private' });
  const refreshed = { ...client(), sessionId: 'client-2', sent: [] };
  await handlers.get('notebookSync')(refreshed);
  assert.equal(room.notebooks.get('user:42'), 'private');
  assert.deepEqual(refreshed.sent, [{ type: 'notebook', payload: 'private' }]);
  assert.deepEqual(events, []);
});

test('durable room serialization includes settings, score rows, scene, and scale', async () => {
  const { room } = harness();
  room.savedScene = { pieces: [{ type: 'die' }] };
  room.state.notes = 'notes';
  room.state.scores.set('s1', { label: 'Heroes', score: 7 });
  const calls = [];
  await saveRoomStateNow(room, {
    db: {
      async saveRoomState(...args) {
        calls.push(args);
      },
    },
  });
  assert.deepEqual(calls, [
    [
      room.roomId,
      {
        scoreboard: [{ id: 's1', label: 'Heroes', score: 7 }],
        notes: 'notes',
        tableX: 10,
        tableZ: 7,
        tableShape: 'rect',
        rimWood: 'mahogany',
        skybox: '',
        feltColor: '#006633',
        scene: room.savedScene,
        scale: { gridStyle: 'off', cellWorld: 0 },
      },
    ],
  ]);
});

test('save scheduling is debounced until the pending callback runs', async () => {
  const { room } = harness();
  let callback;
  let saves = 0;
  room.saveStateNow = async () => {
    saves++;
  };
  const options = {
    setTimer(fn) {
      callback = fn;
      return { pending: true };
    },
    logger: { error() {} },
  };
  scheduleRoomSave(room, options);
  scheduleRoomSave(room, options);
  assert.ok(room._saveTimer);
  callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(room._saveTimer, null);
  assert.equal(saves, 1);
});
