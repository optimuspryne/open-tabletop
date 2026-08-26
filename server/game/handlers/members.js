import { RANK } from '../../permissions.js';

// Database-backed room membership controls. Client-side visibility is only a
// convenience; every mutation is independently authorized here.
export function registerMemberHandlers(room, { db }) {
  room.onMessage('members', (client) => {
    if (room.rank(client) < RANK.gm) return;
    room.sendMembers(client);
  });

  room.onMessage('admit', async (client, message) => {
    const { userId } = message || {};
    if (room.rank(client) < RANK.gm || !room.roomId || !userId) return;
    await db.admitMember(room.roomId, userId);
    room.notifyLobby(userId, 'notifyAdmitted');
    room.broadcastMembers();
  });

  room.onMessage('kick', async (client, message) => {
    const { userId } = message || {};
    if (room.rank(client) < RANK.gm || !room.roomId || !userId) return;
    if (String(userId) === String(client.auth && client.auth.userId)) return;
    const membership = await db.getMembership(room.roomId, userId);
    if (!membership || !room.canManage(room.rank(client), membership.role)) return;
    const targetUser = await db.findUserById(userId);
    if (targetUser && targetUser.isAdmin) return;
    await db.kickMember(room.roomId, userId);
    const live = room.clients.find((candidate) => candidate.auth && String(candidate.auth.userId) === String(userId));
    if (live) {
      live.send('kicked');
      setTimeout(() => { try { live.leave(4000); } catch {} }, 150);
    }
    room.notifyLobby(userId, 'notifyDeclined');
    room.broadcastMembers();
  });

  room.onMessage('setRole', async (client, message) => {
    const { userId, role } = message || {};
    if (room.rank(client) < RANK.gm || !room.roomId || !userId) return;
    if (String(userId) === String(client.auth && client.auth.userId)) return;
    if (!['helper', 'player', 'gm'].includes(role)) return;
    const membership = await db.getMembership(room.roomId, userId);
    if (!membership || !room.canSetRole(room.rank(client), membership.role, role)) return;
    const targetUser = await db.findUserById(userId);
    if (targetUser && targetUser.isAdmin) return;
    await db.setMemberRole(room.roomId, userId, role);
    const live = room.clients.find((candidate) => candidate.auth && String(candidate.auth.userId) === String(userId));
    if (live) {
      const player = room.state.players.get(live.sessionId);
      if (player) player.role = role;
      if (live.auth) live.auth.role = role;
    }
    room.broadcastMembers();
  });

  room.onMessage('reassignHand', (client, message) => {
    const { userId, toSessionId } = message || {};
    if (room.rank(client) < RANK.gm) return;
    const normalizedUserId = userId == null ? null : String(userId);
    if (!normalizedUserId || !room.pendingHands.has(normalizedUserId)) return;
    const target = room.clientBy(toSessionId);
    if (!target) return;
    const held = room.pendingHands.get(normalizedUserId);
    room.hands.set(toSessionId, (room.hands.get(toSessionId) || []).concat(held.cards));
    room.pendingHands.delete(normalizedUserId);
    room.state.unclaimed.delete(normalizedUserId);
    room.sendHand(target);
  });
}
