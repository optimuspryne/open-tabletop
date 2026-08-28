import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerRoomFeatureHandlers } from '../server/game/handlers/room-features.js';

const MESSAGE_NAMES = [
  'roll',
  'trayScoop',
  'trayClear',
  'trayShow',
  'chat',
  'chatLog',
  'skybox',
  'handSync',
  'whoami',
  'showStart',
  'showStop',
  'ping',
];

function vector() {
  return {
    x: 0,
    y: 0,
    z: 0,
    set(x, y, z) {
      Object.assign(this, { x, y, z });
    },
    setZero() {
      this.set(0, 0, 0);
    },
  };
}

function dieBody(seat = 0) {
  return {
    __traySeat: seat,
    position: vector(),
    velocity: vector(),
    angularVelocity: vector(),
    wakeCount: 0,
    wakeUp() {
      this.wakeCount++;
    },
  };
}

function makeClient(sessionId) {
  return {
    sessionId,
    sent: [],
    send(type, payload) {
      this.sent.push({ type, payload });
    },
  };
}

function harness({ rank = 0 } = {}) {
  const handlers = new Map();
  const events = [];
  const clients = new Map([
    ['client-1', makeClient('client-1')],
    ['client-2', makeClient('client-2')],
    ['client-3', makeClient('client-3')],
  ]);
  const room = {
    chatLog: [],
    hands: new Map(),
    shows: new Map(),
    bodies: new Map(),
    state: {
      pieces: new Map(),
      players: new Map([
        ['client-1', { name: 'Alice', showing: 0 }],
        ['client-2', { name: 'Bob', showing: 0 }],
        ['client-3', { name: 'Cara', showing: 0 }],
      ]),
      trays: new Map(),
      skybox: '',
      tableX: 10,
      tableZ: 7,
    },
    onMessage(name, handler) {
      handlers.set(name, handler);
    },
    rank() {
      return rank;
    },
    seatOf(client) {
      return client.sessionId === 'client-1' ? 0 : 1;
    },
    trayCenterFor() {
      return { x: 0, z: 0 };
    },
    clearTraySeat(seat) {
      events.push({ name: 'clearTray', payload: seat });
    },
    buildTrays() {
      events.push({ name: 'buildTrays' });
    },
    broadcast(name, payload) {
      events.push({ name, payload });
    },
    scheduleSave() {
      events.push({ name: 'save' });
    },
    sendHand(client) {
      events.push({ name: 'hand', payload: client.sessionId });
    },
    stopShow(sid) {
      events.push({ name: 'stopShow', payload: sid });
    },
    clientBy(sid) {
      return clients.get(sid);
    },
  };
  registerRoomFeatureHandlers(room, {
    trayRoll: { up: 8, spread: 13, spin: 30 },
    validSky: (url) => url === '' || url.startsWith('/sky/'),
    now: () => 1234,
    random: () => 0.5,
    logger: { error() {} },
  });
  return { room, handlers, events, clients };
}

test('room-feature module registers the complete chat, tray, and sharing family', () => {
  assert.deepEqual([...harness().handlers.keys()], MESSAGE_NAMES);
});

test('chat normalizes whitespace, broadcasts, and replays history', async () => {
  const { room, handlers, events } = harness();
  const alice = makeClient('client-1');
  await handlers.get('chat')(alice, { text: '  hello\n   table  ' });
  await handlers.get('chatLog')(alice);
  const entry = { from: 'Alice', text: 'hello table', ts: 1234 };
  assert.deepEqual(room.chatLog, [entry]);
  assert.deepEqual(events, [{ name: 'chatMsg', payload: entry }]);
  assert.deepEqual(alice.sent, [{ type: 'chatLog', payload: { log: [entry] } }]);
});

test('tray actions affect only the caller seat and its dice', async () => {
  const { room, handlers, events } = harness();
  const alice = makeClient('client-1');
  const mine = dieBody(0);
  const theirs = dieBody(1);
  room.state.pieces.set('1', { type: 'die' });
  room.state.pieces.set('2', { type: 'die' });
  room.bodies.set('1', mine);
  room.bodies.set('2', theirs);
  await handlers.get('trayShow')(alice, { on: true });
  await handlers.get('roll')(alice);
  await handlers.get('trayScoop')(alice);
  await handlers.get('trayClear')(alice);

  assert.equal(room.state.trays.get('0'), true);
  assert.equal(mine.velocity.y, 0); // scoop settles the die after the roll
  assert.equal(mine.wakeCount, 2);
  assert.equal(theirs.wakeCount, 0);
  assert.equal(events.filter(({ name }) => name === 'clearTray').length, 1);
});

test('skybox changes are GM-only and durable', async () => {
  const player = harness({ rank: 0 });
  await player.handlers.get('skybox')(makeClient('client-1'), { url: '/sky/night.png' });
  assert.equal(player.room.state.skybox, '');

  const gm = harness({ rank: 2 });
  await gm.handlers.get('skybox')(makeClient('client-1'), { url: '/sky/night.png' });
  assert.equal(gm.room.state.skybox, '/sky/night.png');
  assert.deepEqual(gm.events, [{ name: 'save' }]);
});

test('showing cards sends faces only to the selected audience', async () => {
  const { room, handlers, clients, events } = harness();
  room.hands.set('client-1', [
    { hid: 'h1', front: 'ace', back: 'blue' },
    { hid: 'h2', front: 'king', back: 'blue' },
  ]);
  await handlers.get('showStart')(makeClient('client-1'), { to: ['client-2'], hids: ['h2'] });

  assert.equal(room.state.players.get('client-1').showing, 1);
  assert.deepEqual([...room.shows.get('client-1').to], ['client-2']);
  assert.deepEqual(clients.get('client-2').sent, [
    {
      type: 'showFan',
      payload: { sid: 'client-1', cards: [{ front: 'king', back: 'blue' }] },
    },
  ]);
  assert.deepEqual(clients.get('client-3').sent, []);
  assert.deepEqual(events, [{ name: 'stopShow', payload: 'client-1' }]);
});

test('pings are clamped to the current table bounds', async () => {
  const { handlers, events } = harness();
  await handlers.get('ping')(makeClient('client-1'), { x: 50, z: -50 });
  assert.deepEqual(events, [
    {
      name: 'ping',
      payload: { sid: 'client-1', x: 10, z: -7 },
    },
  ]);
});
