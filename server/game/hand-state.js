import { handFanGroups } from '../../shared/hand-fan.js';

// Live hands belong to sessions; durable/unclaimed hands belong to accounts.
// Append every card, including identical-looking cards: these are distinct inventory.
export function appendAccountHand(byUser, userId, name, cards) {
  if (userId == null || !cards?.length) return;
  const key = String(userId);
  const previous = byUser.get(key);
  byUser.set(key, {
    name: previous?.name || name || '',
    cards: [...(previous?.cards || []), ...cards],
  });
}

export function parkHand(room, client) {
  const sid = client.sessionId;
  const userId = client.auth?.userId;
  appendAccountHand(
    room.pendingHands,
    userId,
    room.state.players.get(sid)?.name || client.auth?.username,
    room.hands.get(sid),
  );
  if (userId != null && room.pendingHands.has(String(userId)))
    room.state.unclaimed.set(String(userId), room.pendingHands.get(String(userId)).name);
  room.hands.delete(sid);
  room.handOwners.delete(sid);
}

export function claimHand(room, userId, sessionId) {
  const key = String(userId);
  const held = room.pendingHands.get(key);
  if (!held) return;
  room.hands.set(sessionId, [...(room.hands.get(sessionId) || []), ...held.cards]);
  room.pendingHands.delete(key);
  room.state.unclaimed.delete(key);
}

export function sendHand(room, client) {
  const hand = room.hands.get(client.sessionId) || [];
  const player = room.state.players.get(client.sessionId);
  if (player) {
    player.hand = hand.length;
    player.handBack = hand.length ? (hand[0].open ? 'back' : hand[0].back || '') : '';
    player.handFan = hand.length ? JSON.stringify(handFanGroups(hand)) : '';
  }
  client.send('hand', hand); // Faces/content are delivered only to the owning client.
}
