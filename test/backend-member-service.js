import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemberService } from '../server/game/member-service.js';

const actor = (rank = 0) => ({
  auth: { rank },
  sent: [],
  send(type, payload) {
    this.sent.push([type, payload]);
  },
});

function harness() {
  const calls = [];
  const db = {
    async listMembers(roomId) {
      calls.push(['listMembers', roomId]);
      return [{ id: 'member' }];
    },
  };
  const matchMaker = {
    async query(query) {
      calls.push(['query', query]);
      return [];
    },
    async remoteRoomCall(...args) {
      calls.push(['remoteRoomCall', ...args]);
    },
  };
  const service = createMemberService({ db, matchMaker });
  const room = {
    roomId: 'room-1',
    roomCode: 'CODE',
    clients: [],
    rank(client) {
      return client.auth.revoked ? -1 : client.auth.rank;
    },
  };
  return { calls, db, matchMaker, room, service };
}

test('member lists require a persistent room and a live GM rank', async () => {
  const { calls, room, service } = harness();
  await service.sendMembers(room, actor(1));
  room.roomId = null;
  await service.sendMembers(room, actor(3));
  assert.deepEqual(calls, []);
});

test('a pending member list is suppressed after revocation or demotion', async () => {
  for (const change of ['revoke', 'demote', 'unchanged']) {
    const { db, room, service } = harness();
    let finishRead;
    db.listMembers = () => new Promise((resolve) => (finishRead = resolve));
    const gm = actor(2);
    const pending = service.sendMembers(room, gm);
    if (change === 'revoke') gm.auth.revoked = true;
    if (change === 'demote') gm.auth.rank = 0;
    finishRead([{ privateData: true }]);
    await pending;
    assert.equal(gm.sent.length, change === 'unchanged' ? 1 : 0, change);
  }
});

test('member broadcasts deliver only to clients who are currently GMs', async () => {
  const { db, room, service } = harness();
  let finishRead;
  db.listMembers = () => new Promise((resolve) => (finishRead = resolve));
  const owner = actor(3);
  const gm = actor(2);
  const demoted = actor(2);
  const player = actor(0);
  const revoked = actor(3);
  revoked.auth.revoked = true;
  room.clients.push(owner, gm, demoted, player, revoked);
  const pending = service.broadcastMembers(room);
  demoted.auth.rank = 0;
  finishRead([{ id: 'member' }]);
  await pending;
  assert.equal(owner.sent.length, 1);
  assert.equal(gm.sent.length, 1);
  assert.equal(demoted.sent.length, 0);
  assert.equal(player.sent.length, 0);
  assert.equal(revoked.sent.length, 0);
});

test('lobby notifications fan out to every matching waiting room', async () => {
  const { calls, matchMaker, room, service } = harness();
  matchMaker.query = async (query) => {
    calls.push(['query', query]);
    return [{ roomId: 'lobby-1' }, { roomId: 'lobby-2' }];
  };
  await service.notifyLobby(room, 'user-1', 'notifyAdmitted');
  assert.deepEqual(calls, [
    ['query', { name: 'lobby', code: 'CODE' }],
    ['remoteRoomCall', 'lobby-1', 'notifyAdmitted', ['user-1']],
    ['remoteRoomCall', 'lobby-2', 'notifyAdmitted', ['user-1']],
  ]);
});

test('database and matchmaker failures propagate to the existing safe boundaries', async () => {
  const { db, matchMaker, room, service } = harness();
  db.listMembers = async () => {
    throw new Error('database unavailable');
  };
  matchMaker.query = async () => {
    throw new Error('matchmaker unavailable');
  };
  await assert.rejects(service.sendMembers(room, actor(2)), /database unavailable/);
  await assert.rejects(
    service.notifyLobby(room, 'user-1', 'notifyAdmitted'),
    /matchmaker unavailable/,
  );
});
