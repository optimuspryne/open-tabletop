import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoomAccess } from '../server/room-access.js';
import { createParticipationService } from '../server/game/participation.js';
import { stopPlayerInteraction } from '../server/game/interaction-cleanup.js';
import { playerTimeoutPayload } from '../server/message-validation.js';

function harness() {
  const policy = new Map();
  const users = new Map([
    ['1', { id: '1', username: 'Owner' }],
    ['2', { id: '2', username: 'Player' }],
  ]);
  const db = {
    findUserByToken: async (id) => users.get(id),
    findRoomByCode: async () => ({ id: 'room' }),
    getMembership: async (_room, id) => ({
      status: 'admitted',
      role: id === '1' ? 'owner' : 'player',
      timedOut: policy.get(id) || false,
    }),
    async setPlayerTimeout({ userId, timedOut }, live) {
      if (!live()) return null;
      policy.set(userId, timedOut);
      return { timedOut, version: 1 };
    },
  };
  const roomAccess = createRoomAccess({ db, hashToken: String });
  const service = createParticipationService({ db, roomAccess });
  const cleanups = [];
  const room = {
    roomId: 'room',
    roomCode: 'ROOM',
    state: { players: new Map() },
    rank: (c) => (c.auth.role === 'owner' ? 3 : 0),
    onParticipationChanged(c) {
      if (c.auth.timedOut) cleanups.push(c.sessionId);
    },
    async broadcastMembers() {},
  };
  let serial = 0;
  async function join(userId) {
    const c = {
      sessionId: `s${serial++}`,
      sent: [],
      send(...args) {
        this.sent.push(args);
      },
    };
    c.auth = await roomAccess.authorize(room, c, { code: 'ROOM', token: userId });
    room.state.players.set(c.sessionId, { timedOut: c.auth.timedOut });
    return c;
  }
  return { policy, db, roomAccess, service, cleanups, room, join };
}

test('time-out propagates across tabs and survives reconnect and a new authorization service', async () => {
  const h = harness();
  const owner = await h.join('1'),
    first = await h.join('2'),
    second = await h.join('2');
  await h.service.setPlayerTimeout(h.room, owner, { userId: '2', timedOut: true });
  for (const target of [first, second]) {
    assert.equal(target.auth.timedOut, true);
    assert.equal(h.room.state.players.get(target.sessionId).timedOut, true);
  }
  assert.deepEqual(h.cleanups, [first.sessionId, second.sessionId]);
  await h.roomAccess.reconnect(h.room, first);
  assert.equal(first.auth.timedOut, true);
  const restarted = createRoomAccess({ db: h.db, hashToken: String });
  const auth = await restarted.authorize(
    h.room,
    { sessionId: 'fresh' },
    { code: 'ROOM', token: '2' },
  );
  assert.equal(auth.timedOut, true);
  await h.service.setPlayerTimeout(h.room, owner, { userId: '2', timedOut: false });
  assert.equal(first.auth.timedOut, false);
  assert.equal(second.auth.timedOut, false);
});

test('failed writes cannot publish or acknowledge a restriction', async () => {
  const h = harness();
  const owner = await h.join('1'),
    target = await h.join('2');
  h.db.setPlayerTimeout = async () => {
    throw Error('offline');
  };
  await assert.rejects(
    h.service.setPlayerTimeout(h.room, owner, { userId: '2', timedOut: true }),
    /offline/,
  );
  assert.equal(target.auth.timedOut, false);
  assert.deepEqual(h.cleanups, []);
  assert.deepEqual(owner.sent, []);
});

test('same-target operations serialize and recheck a queued actor after revocation', async () => {
  const h = harness();
  const owner = await h.join('1');
  let release;
  let writes = 0;
  h.db.setPlayerTimeout = async (_msg, live) => {
    writes++;
    await new Promise((resolve) => {
      release = resolve;
    });
    return live() ? { timedOut: true } : null;
  };
  const first = h.service.setPlayerTimeout(h.room, owner, { userId: '2', timedOut: true });
  const second = h.service.setPlayerTimeout(h.room, owner, { userId: '2', timedOut: false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes, 1);
  owner.auth.revoked = true;
  release();
  await Promise.all([first, second]);
  assert.equal(writes, 1);
  assert.deepEqual(owner.sent, []);
});

test('committed policy still publishes if actor is revoked during commit, without acknowledging them', async () => {
  const h = harness();
  const owner = await h.join('1'),
    target = await h.join('2');
  h.db.setPlayerTimeout = async () => {
    owner.auth.revoked = true;
    return { timedOut: true };
  };
  await h.service.setPlayerTimeout(h.room, owner, { userId: '2', timedOut: true });
  assert.equal(target.auth.timedOut, true);
  assert.deepEqual(owner.sent, []);
});

test('in-flight authorization cannot install stale unrestricted policy after a time-out', async () => {
  const h = harness();
  let resolve;
  h.db.getMembership = () =>
    new Promise((done) => {
      resolve = done;
    });
  const join = h.join('2');
  await new Promise((done) => setImmediate(done));
  h.roomAccess.setParticipation(h.room, '2', { timedOut: true });
  resolve({ role: 'player', status: 'admitted', timedOut: false });
  await assert.rejects(join, /Access changed/);
});

test('reconnect policy failures leave gameplay blocked', async () => {
  const h = harness();
  const target = await h.join('2');
  h.db.getMembership = async () => {
    throw Error('offline');
  };
  await assert.rejects(h.roomAccess.reconnect(h.room, target), /offline/);
  assert.equal(target.auth.participationReady, false);
  assert.equal(target.auth.revoked, true);
});

test('time-out cleanup releases groups without throw, stops reveals and retains recoverable inventory at capacity', () => {
  const calls = [];
  const room = {
    state: {
      pieces: new Map([['held', { owner: 'one', type: 'prop' }]]),
      whiteboard: { owner: 'one' },
      trays: new Map([['0', true]]),
    },
    targets: new Map([['held', {}]]),
    groups: new Map([['one', {}]]),
    lastDrop: new Map([['one', {}]]),
    bodies: new Map([
      [
        'held',
        {
          velocity: { set: (...v) => calls.push(v) },
          angularVelocity: { set: (...v) => calls.push(v) },
          wakeUp() {},
        },
      ],
    ]),
    pendingInspect: new Map([['one', { deckId: 'missing', front: 'secret' }]]),
    deckCards: new Map(),
    hands: new Map([['one', ['private']]]),
    stopShow: (sid) => calls.push(sid),
    broadcast: (...args) => calls.push(args),
  };
  for (let i = 1; i < 250; i++) room.state.pieces.set(`p${i}`, { owner: '', type: 'prop' });
  stopPlayerInteraction(room, 'one');
  assert.equal(room.state.pieces.get('held').owner, '');
  assert.equal(room.targets.size, 0);
  assert.equal(room.groups.size, 0);
  assert.equal(room.state.whiteboard.owner, '');
  assert.deepEqual(calls.slice(0, 2), [
    [0, 0, 0],
    [0, 0, 0],
  ]);
  assert.equal(room.pendingInspect.get('one').recover, true);
  assert.deepEqual(room.hands.get('one'), ['private']);
  assert.equal(room.state.trays.get('0'), true);
});

test('timeout requests accept only account IDs and boolean policy', () => {
  assert.deepEqual(playerTimeoutPayload({ userId: '2', timedOut: true }), {
    userId: '2',
    timedOut: true,
  });
  for (const msg of [
    null,
    { userId: '2', timedOut: 'false' },
    { userId: '2', timedOut: true, role: 'owner' },
    { userId: '../x', timedOut: true },
  ]) {
    assert.equal(playerTimeoutPayload(msg), null);
  }
});
