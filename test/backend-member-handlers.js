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
  registerMemberHandlers(room, { db, logger: { error() {} } });
  return { room, handlers, calls, memberships, users, db };
}

const actor = (role, userId = '1') => ({
  sessionId: `session-${userId}`, auth: { role, userId }, sent: [],
  send(type, payload) { this.sent.push({ type, payload }); },
});

test('member handler module registers its complete message family', () => {
  assert.deepEqual([...harness().handlers.keys()], ['members', 'admit', 'kick', 'setRole', 'reassignHand']);
});

test('players and helpers cannot list or mutate membership', async () => {
  const { handlers, calls } = harness();
  for (const role of ['player', 'helper']) {
    const client = actor(role);
    handlers.get('members')(client);
    await handlers.get('admit')(client, { userId: '2' });
    await handlers.get('kick')(client, { userId: '2' });
    await handlers.get('setRole')(client, { userId: '2', role: 'helper' });
  }
  assert.deepEqual(calls, []);
});

test('a GM can admit a pending member and notify the waiting lobby', async () => {
  const { handlers, calls } = harness();
  await handlers.get('admit')(actor('gm'), { userId: '2' });
  assert.deepEqual(calls, [
    ['admitMember', 'room-1', '2'],
    ['notifyLobby', '2', 'notifyAdmitted'],
    ['broadcastMembers'],
  ]);
});

test('GM cannot kick a GM, owner, self, or site administrator', async () => {
  const { handlers, calls, memberships, users } = harness();
  memberships.set('2', { role: 'gm' });
  memberships.set('3', { role: 'owner' });
  memberships.set('4', { role: 'player' });
  users.set('4', { isAdmin: true });
  const gm = actor('gm', '1');

  await handlers.get('kick')(gm, { userId: '1' });
  await handlers.get('kick')(gm, { userId: '2' });
  await handlers.get('kick')(gm, { userId: '3' });
  await handlers.get('kick')(gm, { userId: '4' });
  assert.equal(calls.some((call) => call[0] === 'kickMember'), false);
});

test('an owner can promote a helper to GM and live state updates immediately', async () => {
  const { room, handlers, calls, memberships } = harness();
  memberships.set('2', { role: 'helper' });
  const target = actor('helper', '2');
  room.clients.push(target);
  room.state.players.set(target.sessionId, { role: 'helper' });

  await handlers.get('setRole')(actor('owner'), { userId: '2', role: 'gm' });
  assert.equal(target.auth.role, 'gm');
  assert.equal(room.state.players.get(target.sessionId).role, 'gm');
  assert.equal(calls.some((call) => call[0] === 'setMemberRole' && call[3] === 'gm'), true);
});

test('hand reassignment is GM-only and merges onto the recipient hand', () => {
  const { room, handlers, calls } = harness();
  const recipient = actor('player', '2');
  room.clients.push(recipient);
  room.pendingHands.set('3', { cards: [{ front: 'ace' }] });
  room.state.unclaimed.set('3', 'Departed Player');
  room.hands.set(recipient.sessionId, [{ front: 'king' }]);

  handlers.get('reassignHand')(actor('player'), { userId: '3', toSessionId: recipient.sessionId });
  assert.equal(room.pendingHands.has('3'), true);
  handlers.get('reassignHand')(actor('gm'), { userId: '3', toSessionId: recipient.sessionId });
  assert.deepEqual(room.hands.get(recipient.sessionId), [{ front: 'king' }, { front: 'ace' }]);
  assert.equal(room.pendingHands.has('3'), false);
  assert.equal(room.state.unclaimed.has('3'), false);
  assert.equal(calls.some((call) => call[0] === 'sendHand'), true);
});

test('malformed membership messages fail closed', async () => {
  const { handlers, calls } = harness();
  const owner = actor('owner');
  await handlers.get('admit')(owner, null);
  await handlers.get('kick')(owner, null);
  await handlers.get('setRole')(owner, null);
  handlers.get('reassignHand')(owner, null);
  await handlers.get('admit')(owner, { userId: 2 });
  await handlers.get('kick')(owner, { userId: '2', unexpected: true });
  await handlers.get('setRole')(owner, { userId: '2', role: 'owner' });
  handlers.get('reassignHand')(owner, { userId: '2', toSessionId: '' });
  assert.deepEqual(calls, []);
});

test('database rejection is contained and reported without disabling later member messages', async () => {
  const { handlers, db, calls } = harness();
  const owner = actor('owner');
  const original = db.admitMember;
  db.admitMember = async () => { throw new Error('database offline'); };
  await handlers.get('admit')(owner, { userId: '2' });
  assert.deepEqual(owner.sent, [{
    type: 'serverError', payload: { operation: 'admit', message: 'Member operation unavailable. Try again.' },
  }]);
  db.admitMember = original;
  await handlers.get('admit')(owner, { userId: '2' });
  assert.equal(calls.some((call) => call[0] === 'admitMember'), true);
});
