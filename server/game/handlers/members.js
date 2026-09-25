import { normalizePlacard } from '../../../shared/placards.js';
import { RANK } from '../../permissions.js';
import {
  handReassignmentPayload,
  memberRolePayload,
  memberUserPayload,
  playerTimeoutPayload,
  participationPayload,
} from '../../message-validation.js';
import { guardedMessage, allowRoomCapability } from '../interaction-policy.js';

// Database-backed room membership controls. Client-side visibility is only a
// convenience; every mutation is independently authorized here.
export function registerMemberHandlers(room, { db, roomAccess, logger = console }) {
  const memberMessage = (type, handler) =>
    guardedMessage(room, type, handler, {
      logger,
      publicMessage: 'Member operation unavailable. Try again.',
    });

  memberMessage('setPlacard', async (client, message) => {
    const settings = normalizePlacard(message);
    const player = room.state.players.get(client.sessionId);
    const userId = client.auth?.userId;
    if (!settings || !player || !userId) return;
    const isActive = () =>
      allowRoomCapability(client, 'personal', 'setPlacard') &&
      client.auth.userId === userId &&
      room.state.players.get(client.sessionId) === player;
    const saved = await roomAccess.savePlacard(userId, settings, isActive);
    if (saved && isActive()) client.send('placardSaved', settings);
  });

  memberMessage('setParticipation', (client, message) => {
    const parsed = participationPayload(message);
    if (parsed) return room.setParticipation(client, parsed);
  });

  memberMessage('setPlayerTimeout', (client, message) => {
    const parsed = playerTimeoutPayload(message);
    if (parsed) return room.setPlayerTimeout(client, parsed);
  });

  memberMessage('members', async (client) => {
    if (room.rank(client) < RANK.gm) return;
    await room.sendMembers(client);
  });

  memberMessage('admit', async (client, message) => {
    if (room.rank(client) < RANK.gm || !room.roomId) return;
    const parsed = memberUserPayload(message);
    if (!parsed) return;
    const { userId } = parsed;
    await db.admitMember(room.roomId, userId);
    await Promise.all([room.notifyLobby(userId, 'notifyAdmitted'), room.broadcastMembers()]);
  });

  memberMessage('kick', async (client, message) => {
    if (room.rank(client) < RANK.gm || !room.roomId) return;
    const parsed = memberUserPayload(message);
    if (!parsed) return;
    const { userId } = parsed;
    if (String(userId) === String(client.auth && client.auth.userId)) return;
    const membership = await db.getMembership(room.roomId, userId);
    if (!allowRoomCapability(client, 'administration', 'kick')) return;
    if (!membership || !room.canManage(room.rank(client), membership.role)) return;
    const targetUser = await db.findUserById(userId);
    if (targetUser && targetUser.isAdmin) return;
    if (
      !allowRoomCapability(client, 'administration', 'kick') ||
      !room.canManage(room.rank(client), membership.role)
    )
      return;
    await db.kickMember(room.roomId, userId);
    roomAccess.kickRoom(room, userId);
    await Promise.all([room.notifyLobby(userId, 'notifyDeclined'), room.broadcastMembers()]);
  });

  memberMessage('setRole', async (client, message) => {
    if (room.rank(client) < RANK.gm || !room.roomId) return;
    const parsed = memberRolePayload(message);
    if (!parsed) return;
    const { userId, role } = parsed;
    if (String(userId) === String(client.auth && client.auth.userId)) return;
    const membership = await db.getMembership(room.roomId, userId);
    if (!allowRoomCapability(client, 'administration', 'setRole')) return;
    if (!membership || !room.canSetRole(room.rank(client), membership.role, role)) return;
    const targetUser = await db.findUserById(userId);
    if (targetUser && targetUser.isAdmin) return;
    if (
      !allowRoomCapability(client, 'administration', 'setRole') ||
      !room.canSetRole(room.rank(client), membership.role, role)
    )
      return;
    await db.setMemberRole(room.roomId, userId, role);
    roomAccess.setRole(room, userId, role);
    await room.broadcastMembers();
  });

  memberMessage('reassignHand', (client, message) => {
    if (room.rank(client) < RANK.gm) return;
    const parsed = handReassignmentPayload(message);
    if (!parsed) return;
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
