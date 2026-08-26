import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerMemberHandlers } from '../server/game/handlers/members.js';
import { RANK, canManageMember, canSetMemberRole } from '../server/permissions.js';

function harness() {
  const handlers = new Map();
  const calls = [];
  const memberships = new Map();
  const users = new Map();
  const db = {
    async admitMember(roomId, userId) { calls.push(['admitMember', roomId, userId]); },
    async getMembership(roomId, userId) { calls.push(['getMembership', roomId, userId]); return memberships.get(String(userId)) || null; },
    async findUserById(userId) { calls.push(['findUserById', userId]); return users.get(String(userId)) || null; },
    async kickMember(roomId, userId) { calls.push(['kickMember', roomId, userId]); },
    async setMemberRole(roomId, userId, role) { calls.push(['setMemberRole', roomId, userId, role]); },
  };
  const room = {
    roomId: 'room-1',
    clients: [],
    pendingHands: new Map(),
    hands: new Map(),
    state: { players: new Map(), unclaimed: new Map() },
    onMessage(name, handler) { handlers.set(name, handler); },
    rank(client) { return RANK[client.auth.role] ?? RANK.player; },
    canManage: canManageMember,
    canSetRole: canSetMemberRole,
    sendMembers(client) { calls.push(['sendMembers', client.sessionId]); },
    notifyLobby(userId, method) { calls.push(['notifyLobby', userId, method]); },
    broadcastMembers() { calls.push(['broadcastMembers']); },
    clientBy(sessionId) { return this.clients.find((client) => client.sessionId === sessionId); },
    sendHand(client) { calls.push(['sendHand', client.sessionId]); },
  };
  registerMemberHandlers(room, { db });
  return { room, handlers, calls, memberships, users };
}

const actor = (role, userId = role) => ({ sessionId: `session-${userId}`, auth: { role, userId } });

test('member handler module registers its complete message family', () => {
  assert.deepEqual([...harness().handlers.keys()], ['members', 'admit', 'kick', 'setRole', 'reassignHand']);
});

test('players and helpers cannot list or mutate membership', async () => {
  const { handlers, calls } = harness();
  for (const role of ['player', 'helper']) {
    const client = actor(role);
    handlers.get('members')(client);
    await handlers.get('admit')(client, { userId: 'target' });
    await handlers.get('kick')(client, { userId: 'target' });
    await handlers.get('setRole')(client, { userId: 'target', role: 'helper' });
  }
  assert.deepEqual(calls, []);
});

test('a GM can admit a pending member and notify the waiting lobby', async () => {
  const { handlers, calls } = harness();
  await handlers.get('admit')(actor('gm'), { userId: 'target' });
  assert.deepEqual(calls, [
    ['admitMember', 'room-1', 'target'],
    ['notifyLobby', 'target', 'notifyAdmitted'],
    ['broadcastMembers'],
  ]);
});

test('GM cannot kick a GM, owner, self, or site administrator', async () => {
  const { handlers, calls, memberships, users } = harness();
  memberships.set('other-gm', { role: 'gm' });
  memberships.set('owner', { role: 'owner' });
  memberships.set('admin', { role: 'player' });
  users.set('admin', { isAdmin: true });
  const gm = actor('gm', 'acting-gm');

  await handlers.get('kick')(gm, { userId: 'acting-gm' });
  await handlers.get('kick')(gm, { userId: 'other-gm' });
  await handlers.get('kick')(gm, { userId: 'owner' });
  await handlers.get('kick')(gm, { userId: 'admin' });
  assert.equal(calls.some((call) => call[0] === 'kickMember'), false);
});

test('an owner can promote a helper to GM and live state updates immediately', async () => {
  const { room, handlers, calls, memberships } = harness();
  memberships.set('target', { role: 'helper' });
  const target = actor('helper', 'target');
  room.clients.push(target);
  room.state.players.set(target.sessionId, { role: 'helper' });

  await handlers.get('setRole')(actor('owner'), { userId: 'target', role: 'gm' });
  assert.equal(target.auth.role, 'gm');
  assert.equal(room.state.players.get(target.sessionId).role, 'gm');
  assert.equal(calls.some((call) => call[0] === 'setMemberRole' && call[3] === 'gm'), true);
});

test('hand reassignment is GM-only and merges onto the recipient hand', () => {
  const { room, handlers, calls } = harness();
  const recipient = actor('player', 'recipient');
  room.clients.push(recipient);
  room.pendingHands.set('departed', { cards: [{ front: 'ace' }] });
  room.state.unclaimed.set('departed', 'Departed Player');
  room.hands.set(recipient.sessionId, [{ front: 'king' }]);

  handlers.get('reassignHand')(actor('player'), { userId: 'departed', toSessionId: recipient.sessionId });
  assert.equal(room.pendingHands.has('departed'), true);
  handlers.get('reassignHand')(actor('gm'), { userId: 'departed', toSessionId: recipient.sessionId });
  assert.deepEqual(room.hands.get(recipient.sessionId), [{ front: 'king' }, { front: 'ace' }]);
  assert.equal(room.pendingHands.has('departed'), false);
  assert.equal(room.state.unclaimed.has('departed'), false);
  assert.equal(calls.some((call) => call[0] === 'sendHand'), true);
});

test('malformed membership messages fail closed', async () => {
  const { handlers, calls } = harness();
  const owner = actor('owner');
  await handlers.get('admit')(owner, null);
  await handlers.get('kick')(owner, null);
  await handlers.get('setRole')(owner, null);
  handlers.get('reassignHand')(owner, null);
  assert.deepEqual(calls, []);
});
