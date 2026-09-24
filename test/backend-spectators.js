import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoomAccess } from '../server/room-access.js';
import { createParticipationService } from '../server/game/participation.js';
import {
  createJoinedPlayer,
  applyPlayerParticipation,
  advancePlayerTurn,
  turnPlayers,
  MAX_ROOM_CLIENTS,
} from '../server/game/player-seats.js';
import { canUseRoomCapability } from '../server/permissions.js';
import { participationPayload } from '../server/message-validation.js';

function harness() {
  const policies = new Map();
  const db = {
    findUserByToken: async (id) => ({ id, username: id }),
    findRoomByCode: async () => ({ id: 'room' }),
    getMembership: async (_, id) => ({ status: 'admitted', role: 'player', ...policies.get(id) }),
    async setSelfParticipation({ userId, participation }, live) {
      if (!live()) return null;
      const policy = { timedOut: false, ...policies.get(userId), participation };
      policies.set(userId, policy);
      return policy;
    },
    async setPlayerTimeout({ userId, timedOut }, live) {
      if (!live()) return null;
      const policy = { participation: 'player', ...policies.get(userId), timedOut };
      policies.set(userId, policy);
      return policy;
    },
  };
  const access = createRoomAccess({ db, hashToken: String });
  const service = createParticipationService({ db, roomAccess: access });
  const seatOptions = { seatFor: service.seatFor, palette: ['red', 'blue'] };
  const room = {
    roomCode: 'CODE',
    roomId: 'room',
    connectionLimit: MAX_ROOM_CLIENTS,
    state: {
      players: new Map(),
      pieces: new Map(),
      whiteboard: { owner: '' },
      turn: '',
      turnPending: '',
      trays: new Map(),
    },
    targets: new Map(),
    bodies: new Map(),
    groups: new Map(),
    lastDrop: new Map(),
    pendingInspect: new Map(),
    hands: new Map(),
    pendingTurn: null,
    rank: () => 3,
    broadcast() {},
    stopShow() {},
    async broadcastMembers() {},
    onParticipationChanged(client) {
      applyPlayerParticipation(this, client, seatOptions);
    },
  };
  let serial = 0;
  async function join(userId, mode) {
    if (mode) policies.set(userId, { timedOut: false, participation: mode });
    const client = {
      sessionId: 's' + serial++,
      sent: [],
      send(...args) {
        this.sent.push(args);
      },
      leave() {},
    };
    client.auth = await access.authorize(room, client, { code: 'CODE', token: userId });
    createJoinedPlayer(room, client, seatOptions);
    return client;
  }
  return { db, room, access, service, policies, join, seatOptions };
}

test('self-service spectating retains seats/hands/trays, skips turns and cannot lift time-out', async () => {
  const h = harness();
  const a = await h.join('1'),
    b = await h.join('2');
  const player = h.room.state.players.get(a.sessionId);
  h.room.state.turn = a.sessionId;
  h.room.hands.set(a.sessionId, [{ hid: 'private' }]);
  h.room.state.trays.set(String(player.seat), true);
  const seat = player.seat;
  await h.service.setParticipation(h.room, a, { participation: 'spectator' });
  assert.equal(player.seat, seat);
  assert.equal(h.room.state.turn, b.sessionId);
  assert.equal(h.room.hands.get(a.sessionId)[0].hid, 'private');
  assert.equal(h.room.state.trays.get(String(seat)), true);
  assert.equal(canUseRoomCapability(a.auth, 'gameplay'), false);
  h.policies.get('1').timedOut = true;
  await h.service.setParticipation(h.room, a, { participation: 'player' });
  assert.equal(player.timedOut, true);
  assert.equal(canUseRoomCapability(a.auth, 'gameplay'), false);
  assert.equal(player.seat, seat);
});

test('seatless joins and all-spectator turns do not consume seat zero; returning allocates a seat', async () => {
  const h = harness();
  const viewer = await h.join('1', 'spectator');
  const second = await h.join('2', 'spectator');
  assert.equal(h.room.state.players.get(viewer.sessionId).seat, -1);
  assert.deepEqual(turnPlayers(h.room), []);
  advancePlayerTurn(h.room);
  assert.equal(h.room.state.turn, '');
  await h.service.setParticipation(h.room, viewer, { participation: 'player' });
  assert.equal(h.room.state.players.get(viewer.sessionId).seat, 0);
  assert.equal(h.room.state.players.get(second.sessionId).seat, -1);
  assert.equal(h.room.state.turn, viewer.sessionId);
});

test('full seats reject return before writing and preserve spectator policy', async () => {
  const h = harness();
  for (let i = 0; i < 8; i++) await h.join(String(i));
  const viewer = await h.join('view', 'spectator');
  assert.equal(
    await h.service.setParticipation(h.room, viewer, { participation: 'player' }),
    false,
  );
  assert.equal(h.policies.get('view').participation, 'spectator');
  assert.equal(viewer.auth.participation, 'spectator');
  assert.match(viewer.sent.at(-1)[1].message, /seats are reserved/);
});

test('return reserves seats across asynchronous writes and releases reservations on failure', async () => {
  const h = harness();
  for (let i = 0; i < 7; i++) await h.join(String(i));
  const viewer = await h.join('view', 'spectator');
  let reject;
  h.db.setSelfParticipation = () =>
    new Promise((_, no) => {
      reject = no;
    });
  const pending = h.service.setParticipation(h.room, viewer, { participation: 'player' });
  await new Promise((done) => setImmediate(done));
  assert.equal(h.service.seatFor(h.room, 'new'), -1, 'reserved seat cannot be stolen by a join');
  await assert.rejects(h.join('view'), /Access changed/);
  reject(Error('DB failed'));
  await assert.rejects(pending, /DB failed/);
  assert.equal(h.service.seatFor(h.room, 'new'), 7);
  assert.equal(viewer.auth.participation, 'spectator');
  assert.equal(
    viewer.sent.some(([type]) => type === 'participationSet'),
    false,
  );
});

test('duplicate tabs reserve distinct seats atomically and retain policy on reconnect', async () => {
  const h = harness();
  const a = await h.join('same', 'spectator'),
    b = await h.join('same');
  await h.service.setParticipation(h.room, a, { participation: 'player' });
  assert.equal(a.auth.participation, 'player');
  assert.equal(b.auth.participation, 'player');
  assert.deepEqual(
    [...h.room.state.players.values()].map((p) => p.seat),
    [0, 1],
  );
  await h.service.setParticipation(h.room, a, { participation: 'spectator' });
  await h.access.reconnect(h.room, b);
  assert.equal(b.auth.participation, 'spectator');
  assert.equal(h.room.state.players.get(b.sessionId).seat, 1);
  const freshAccess = createRoomAccess({ db: h.db, hashToken: String });
  assert.equal(
    (await freshAccess.authorize(h.room, { sessionId: 'fresh' }, { code: 'CODE', token: 'same' }))
      .participation,
    'spectator',
  );
});

test('partial capacity cannot switch just one of two spectator tabs into play', async () => {
  const h = harness();
  for (let i = 0; i < 7; i++) await h.join(String(i));
  const a = await h.join('same', 'spectator'),
    b = await h.join('same');
  await h.service.setParticipation(h.room, a, { participation: 'player' });
  assert.equal(a.auth.participation, 'spectator');
  assert.equal(b.auth.participation, 'spectator');
  assert.equal(h.service.seatFor(h.room, 'new'), 7);
});

test('room connection limit rejects extra spectators without occupying a playing seat', async () => {
  const h = harness();
  for (let i = 0; i < MAX_ROOM_CLIENTS; i++) await h.join(String(i), 'spectator');
  await assert.rejects(h.join('extra', 'spectator'), /participant limit/);
  assert.equal(h.service.seatFor(h.room, 'new'), 0);
});

test('self-service payload accepts only explicit modes and cannot target another account', () => {
  for (const participation of ['player', 'spectator'])
    assert.deepEqual(participationPayload({ participation }), { participation });
  for (const message of [
    {},
    null,
    { participation: true },
    { participation: 'owner' },
    { participation: 'player', userId: '2' },
    { participation: 'player', timedOut: false },
  ])
    assert.equal(participationPayload(message), null);
});

test('spectating during a middle turn advances to the next playing participant in order', async () => {
  const h = harness();
  await h.join('1');
  const middle = await h.join('2'),
    next = await h.join('3');
  h.room.state.turn = middle.sessionId;
  await h.service.setParticipation(h.room, middle, { participation: 'spectator' });
  assert.equal(h.room.state.turn, next.sessionId);
});
