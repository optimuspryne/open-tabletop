import { RANK } from '../../permissions.js';
import { handReassignmentPayload, memberRolePayload, memberUserPayload } from '../../message-validation.js';

// Database-backed room membership controls. Client-side visibility is only a
// convenience; every mutation is independently authorized here.
export function registerMemberHandlers(room, { db }) {
  room.onMessage('members', (client) => {
    if (room.rank(client) < RANK.gm) return;
    room.sendMembers(client);
  });

  room.onMessage('admit', async (client, message) => {
    if (room.rank(client) < RANK.gm || !room.roomId) return;
    const parsed = memberUserPayload(message); if (!parsed) return;
    const { userId } = parsed;
    await db.admitMember(room.roomId, userId);
    room.notifyLobby(userId, 'notifyAdmitted');
    room.broadcastMembers();
  });

  room.onMessage('kick', async (client, message) => {
    if (room.rank(client) < RANK.gm || !room.roomId) return;
    const parsed = memberUserPayload(message); if (!parsed) return;
    const { userId } = parsed;
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
    if (room.rank(client) < RANK.gm || !room.roomId) return;
    const parsed = memberRolePayload(message); if (!parsed) return;
    const { userId, role } = parsed;
    if (String(userId) === String(client.auth && client.auth.userId)) return;
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
    if (room.rank(client) < RANK.gm) return;
    const parsed = handReassignmentPayload(message); if (!parsed) return;
    const { userId, toSessionId } = parsed;
    if (!room.pendingHands.has(userId)) return;
    const target = room.clientBy(toSessionId);
    if (!target) return;
    const held = room.pendingHands.get(userId);
    room.hands.set(toSessionId, (room.hands.get(toSessionId) || []).concat(held.cards));
    room.pendingHands.delete(userId);
    room.state.unclaimed.delete(userId);
    room.sendHand(target);
  });
}
