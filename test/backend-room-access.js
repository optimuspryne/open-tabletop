import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Room, matchMaker, ClientState } from '@colyseus/core';
import { WebSocketClient } from '@colyseus/ws-transport';
import { createRoomAccess } from '../server/room-access.js';

function deferred() {
  const pending = Promise.withResolvers();
  pending.promise.reject = pending.reject;
  return pending;
}

function harness() {
  const users = new Map([
    ['hash:one', { id: '1', username: 'one', isAdmin: false }],
    ['hash:other-device', { id: '1', username: 'one', isAdmin: false }],
    ['hash:two', { id: '2', username: 'two', isAdmin: false }],
    ['hash:admin', { id: '3', username: 'admin', isAdmin: true }],
  ]);
  const memberships = new Map([
    ['A:1', { status: 'admitted', role: 'owner' }],
    ['B:1', { status: 'admitted', role: 'gm' }],
    ['A:2', { status: 'admitted', role: 'player' }],
  ]);
  const db = {
    async findUserByToken(hash) {
      return users.get(hash) || null;
    },
    async findRoomByCode(code) {
      return ['A', 'B'].includes(code) ? { id: code } : null;
    },
    async getMembership(roomId, userId) {
      return memberships.get(`${roomId}:${userId}`) || null;
    },
  };
  const access = createRoomAccess({ db, hashToken: (raw) => `hash:${raw}` });
  const room = (roomCode) => ({
    roomCode,
    state: { players: new Map() },
    allowReconnection() {
      this.pending = deferred();
      return this.pending.promise;
    },
  });
  let serial = 0;
  const client = () => ({
    sessionId: `session-${++serial}`,
    notices: [],
    exits: [],
    send(type) {
      this.notices.push(type);
    },
    leave(code) {
      this.exits.push(code);
    },
  });
  async function join(target, token = 'one', kind = 'table') {
    const connection = client();
    connection.auth = await access.authorize(
      target,
      connection,
      { code: target.roomCode, token },
      kind,
    );
    target.state.players.set(connection.sessionId, { role: connection.auth.role });
    return connection;
  }
  return { access, db, users, memberships, room, client, join };
}

test('direct room-ID joins cannot borrow authorization from another room code', async () => {
  const h = harness();
  h.memberships.delete('B:1');
  for (const kind of ['table', 'lobby']) {
    await assert.rejects(
      h.access.authorize(h.room('B'), h.client(), { code: 'A', token: 'one' }, kind),
      { code: 403 },
    );
  }
  await assert.rejects(h.join(h.room('B')), { code: 403 });
  assert.equal((await h.join(h.room('A'))).auth.role, 'owner');
});

test('table, lobby and editor enforce their distinct access requirements', async () => {
  const h = harness();
  const room = h.room('A');
  for (const token of ['', null, {}, 'missing']) {
    await assert.rejects(h.access.authorize(room, h.client(), { code: 'A', token }), {
      code: 401,
    });
  }
  await assert.rejects(h.join(room, 'one', 'lobby'), { code: 403 });
  h.memberships.set('A:1', { status: 'pending', role: 'player' });
  await assert.rejects(h.join(room), { code: 403 });
  await h.join(room, 'one', 'lobby');
  await assert.rejects(h.join(h.room(null), 'one', 'editor'), { code: 403 });
  assert.equal((await h.join(h.room(null), 'admin', 'editor')).auth.isAdmin, true);
  assert.equal((await h.join(room, 'admin')).auth.role, 'owner');
});

test('role changes update every tab and pending reconnect only in the selected room', async () => {
  const h = harness();
  const a = h.room('A');
  const b = h.room('B');
  const first = await h.join(a);
  const second = await h.join(a, 'other-device');
  const elsewhere = await h.join(b);
  const otherUser = await h.join(a, 'two');
  const waiting = h.access.waitForReconnect(a, second, 30);
  h.memberships.set('A:1', { status: 'admitted', role: 'player' });
  h.access.setRole(a, '1', 'player');
  assert.equal(first.auth.role, 'player');
  assert.equal(second.auth.role, 'player');
  assert.equal(a.state.players.get(second.sessionId).role, 'player');
  assert.equal(elsewhere.auth.role, 'gm');
  assert.deepEqual(elsewhere.exits, []);
  assert.deepEqual(otherUser.exits, []);
  const reconnected = { ...h.client(), sessionId: second.sessionId, auth: second.auth };
  a.pending.resolve(reconnected);
  await waiting;
  await h.access.reconnect(a, reconnected);
  assert.equal(reconnected.auth.role, 'player');
});

test('room kicks revoke all matching tabs and cancel pending reconnects without touching other rooms', async () => {
  const h = harness();
  const a = h.room('A');
  const first = await h.join(a);
  const second = await h.join(a);
  const elsewhere = await h.join(h.room('B'));
  const otherUser = await h.join(a, 'two');
  const waiting = h.access.waitForReconnect(a, second, 30);
  const rejected = assert.rejects(waiting, { code: 403 });
  h.access.kickRoom(a, '1');
  await rejected;
  for (const client of [first, second]) {
    assert.equal(client.auth.revoked, true);
    assert.deepEqual(client.exits, [4000]);
    assert.deepEqual(client.notices, ['kicked']);
  }
  assert.deepEqual(elsewhere.exits, []);
  assert.deepEqual(otherUser.exits, []);
  await assert.rejects(h.access.reconnect(a, second), { code: 403 });
});

test('logout targets one token across rooms; logout-all also reaches other devices and lobbies', async () => {
  const h = harness();
  const a = h.room('A');
  const first = await h.join(a);
  const elsewhere = await h.join(h.room('B'));
  const otherDevice = await h.join(a, 'other-device');
  const otherUser = await h.join(a, 'two');
  h.memberships.set('B:1', { status: 'pending', role: 'player' });
  const lobby = await h.join(h.room('B'), 'other-device', 'lobby');
  h.access.revokeSession('hash:one');
  assert.deepEqual(first.exits, [4000]);
  assert.deepEqual(elsewhere.exits, [4000]);
  assert.deepEqual(otherDevice.exits, []);
  h.access.revokeUser('1');
  assert.deepEqual(otherDevice.exits, [4000]);
  assert.deepEqual(lobby.exits, [4000]);
  assert.deepEqual(otherUser.exits, []);
  assert.deepEqual(first.notices, ['accessRevoked']);
});

test('admin revocation disconnects table and editor sessions, including disconnected editors', async () => {
  const h = harness();
  const editor = h.room(null);
  const tableClient = await h.join(h.room('A'), 'admin');
  const editorClient = await h.join(editor, 'admin', 'editor');
  const waiting = h.access.waitForReconnect(editor, editorClient, 30);
  const rejected = assert.rejects(waiting, { code: 403 });
  h.users.get('hash:admin').isAdmin = false;
  h.access.revokeUser('3');
  await rejected;
  assert.deepEqual(tableClient.exits, [4000]);
  assert.deepEqual(editorClient.exits, [4000]);
  await assert.rejects(h.join(editor, 'admin', 'editor'), { code: 403 });
});

test('reconnect rechecks expired sessions and changed membership even without a local revocation event', async () => {
  for (const change of ['session', 'membership']) {
    const h = harness();
    const room = h.room('A');
    const client = await h.join(room);
    if (change === 'session') h.users.delete('hash:one');
    else h.memberships.delete('A:1');
    await assert.rejects(h.access.reconnect(room, client), {
      code: change === 'session' ? 401 : 403,
    });
    assert.equal(client.auth.revoked, true);
    await assert.rejects(h.access.waitForReconnect(room, client, 30), { code: 403 });
  }
});

test('revocation racing an authorization read cannot install stale authority', async () => {
  const h = harness();
  const pending = deferred();
  h.db.getMembership = () => pending.promise;
  const authorizing = h.join(h.room('A'));
  h.access.revokeSession('hash:one');
  pending.resolve({ status: 'admitted', role: 'owner' });
  await assert.rejects(authorizing, { code: 403 });
});

test('unrelated logouts and room-role changes cannot interrupt another room join', async () => {
  const h = harness();
  const pending = deferred();
  h.db.getMembership = () => pending.promise;
  const authorizing = h.join(h.room('B'));
  h.access.revokeSession('hash:unknown');
  h.access.revokeUser('2');
  h.access.setRole(h.room('A'), '1', 'player');
  pending.resolve({ status: 'admitted', role: 'gm' });
  assert.equal((await authorizing).auth.role, 'gm');
});

test('a broken socket does not stop revocation of the remaining connections', async () => {
  const h = harness();
  const room = h.room('A');
  const broken = await h.join(room);
  const healthy = await h.join(room);
  broken.send = broken.leave = () => {
    throw new Error('socket already gone');
  };
  h.access.kickUser('1');
  assert.equal(broken.auth.revoked, true);
  assert.deepEqual(healthy.exits, [4000]);
});

test('normal departure and room disposal remove tracked access', async () => {
  const h = harness();
  const room = h.room('A');
  const client = await h.join(room);
  h.access.forget(room, client);
  assert.equal(h.access.kickUser('1'), 0);
  await assert.rejects(h.access.reconnect(room, client), { code: 403 });
  const next = await h.join(room);
  h.access.dispose(room);
  assert.equal(h.access.kickUser('1'), 0);
  await assert.rejects(h.access.reconnect(room, next), { code: 403 });
});

test('revocation between authentication and onJoin is rejected', async () => {
  const h = harness();
  const room = h.room('A');
  const client = await h.join(room);
  h.access.revokeUser('1');
  assert.throws(() => h.access.assertActive(room, client), { code: 403 });
});

test('periodic validation catches CLI admin changes and expired active sessions', async () => {
  const h = harness();
  const admin = await h.join(h.room(null), 'admin', 'editor');
  const expired = await h.join(h.room('A'));
  const unaffected = await h.join(h.room('A'), 'two');
  h.users.get('hash:admin').isAdmin = false;
  h.users.delete('hash:one');
  await h.access.revalidate();
  assert.deepEqual(admin.exits, [4000]);
  assert.deepEqual(expired.exits, [4000]);
  assert.deepEqual(unaffected.exits, []);
});

test('periodic validation fails closed when the authorization database is unavailable', async () => {
  const h = harness();
  const client = await h.join(h.room('A'));
  h.db.findUserByToken = async () => {
    throw new Error('offline');
  };
  await h.access.revalidate();
  assert.equal(client.auth.revoked, true);
});

test('Colyseus joinById enforces room binding and cancels an actual reconnect reservation', async (t) => {
  const h = harness();
  class AccessRoom extends Room {
    onCreate(options) {
      this.roomCode = options.code;
      this.autoDispose = false;
    }
    onAuth(client, options) {
      return h.access.authorize(this, client, options);
    }
    onJoin(client) {
      h.access.assertActive(this, client);
    }
    onReconnect(client) {
      return h.access.reconnect(this, client);
    }
    async onLeave(client, code) {
      if (code !== 4000 && !client.auth.revoked) {
        try {
          await h.access.waitForReconnect(this, client, 30);
          return;
        } catch {
          // Timeout or revocation releases the reservation.
        }
      }
      h.access.forget(this, client);
    }
    onDispose() {
      h.access.dispose(this);
    }
  }
  await matchMaker.setup();
  await matchMaker.accept(true);
  matchMaker.defineRoomType('access-test', AccessRoom).filterBy(['code']);
  t.after(() => matchMaker.gracefullyShutdown());
  const listing = await matchMaker.createRoom('access-test', { code: 'B' });
  const room = matchMaker.getLocalRoomById(listing.roomId);
  const transport = (sessionId) => {
    const socket = new EventEmitter();
    socket.readyState = 1;
    socket.send = () => {};
    socket.close = (code) => {
      if (socket.readyState === 3) return;
      socket.readyState = 3;
      socket.emit('close', code);
    };
    return new WebSocketClient(sessionId, socket);
  };
  const badSeat = await matchMaker.joinById(listing.roomId, { code: 'A', token: 'one' });
  await assert.rejects(room._onJoin(transport(badSeat.sessionId), {}), { code: 403 });
  const seat = await matchMaker.joinById(listing.roomId, { code: 'B', token: 'one' });
  const client = transport(seat.sessionId);
  await room._onJoin(client, {});
  client.state = ClientState.JOINED;
  delete client._enqueuedMessages; // simulate the client's join acknowledgment
  assert.equal(client.auth.role, 'gm');
  const token = client.reconnectionToken;
  const departed = room._onLeave(client, 1006);
  assert.equal(room.checkReconnectionToken(token), client.sessionId);
  h.access.kickRoom(room, '1');
  await departed;
  assert.equal(room.checkReconnectionToken(token), undefined);
  assert.equal(room.clients.length, 0);
});
