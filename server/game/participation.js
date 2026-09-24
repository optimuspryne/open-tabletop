import { freePlayerSeat } from './player-seats.js';
import { RANK, canUseRoomCapability, canManageMember } from '../permissions.js';

export function createParticipationService({ db, roomAccess }) {
  const queues = new WeakMap();
  const seatReservations = new WeakMap();
  function queue(room, userId, run) {
    let targets = queues.get(room);
    if (!targets) queues.set(room, (targets = new Map()));
    const pending = (targets.get(userId) || Promise.resolve()).catch(() => {}).then(run);
    targets.set(userId, pending);
    return pending.finally(() => {
      if (targets.get(userId) === pending) targets.delete(userId);
    });
  }
  function seatFor(room, sid) {
    const seats = seatReservations.get(room);
    return seats?.get(sid) ?? freePlayerSeat(room, seats?.values());
  }
  function setPlayerTimeout(room, client, message) {
    const { userId, timedOut } = message;
    const isLive = (targetRole) =>
      !!room.roomId &&
      canUseRoomCapability(client.auth ?? {}, 'administration') &&
      room.rank(client) >= RANK.gm &&
      (!targetRole || canManageMember(room.rank(client), targetRole)) &&
      String(client.auth?.userId) !== userId;
    const run = async () => {
      if (!isLive()) return;
      const policy = await db.setPlayerTimeout(
        {
          roomId: room.roomId,
          actorId: client.auth.userId,
          userId,
          timedOut,
        },
        isLive,
      );
      if (!policy) {
        if (!client.auth?.revoked)
          client.send('serverError', {
            operation: 'setPlayerTimeout',
            message: 'Time-out could not be changed. Check member access and try again.',
          });
        return;
      }
      // A revocation during COMMIT cannot undo a committed policy. Always publish
      // the durable result, but only acknowledge to an actor who still has access.
      roomAccess.setParticipation(room, userId, policy);
      if (isLive()) client.send('playerTimeoutSet', { userId, timedOut: policy.timedOut });
      await room.broadcastMembers();
    };
    return queue(room, userId, run);
  }
  function setParticipation(room, client, { participation }, { acknowledge = true } = {}) {
    const userId = String(client.auth?.userId);
    const isLive = () => !!room.roomId && canUseRoomCapability(client.auth, 'personal');
    return queue(room, userId, async () => {
      if (!isLive()) return false;
      const finish = roomAccess.beginParticipationChange(room, userId);
      let reserved = seatReservations.get(room);
      if (!reserved) seatReservations.set(room, (reserved = new Map()));
      const ownedReservations = [];
      try {
        if (participation === 'player') {
          for (const target of roomAccess.clientsFor(room, userId)) {
            const player = room.state.players.get(target.sessionId);
            if (!player || player.seat >= 0) continue;
            const seat = freePlayerSeat(room, reserved.values());
            if (seat < 0) {
              client.send('serverError', {
                operation: 'setParticipation',
                message:
                  'All playing seats are reserved. You are still spectating; try again when a seat is free.',
              });
              return false;
            }
            reserved.set(target.sessionId, seat);
            ownedReservations.push(target.sessionId);
          }
        }
        const policy = await db.setSelfParticipation(
          { roomId: room.roomId, userId, participation },
          isLive,
        );
        if (!policy) {
          if (isLive())
            client.send('serverError', {
              operation: 'setParticipation',
              message: 'Participation could not be changed. Check your access and try again.',
            });
          return false;
        }
        roomAccess.setParticipation(room, userId, policy);
        if (acknowledge && isLive())
          client.send('participationSet', { participation: policy.participation });
        await room.broadcastMembers();
        return true;
      } finally {
        for (const sid of ownedReservations) reserved.delete(sid);
        finish();
      }
    });
  }
  return { setPlayerTimeout, setParticipation, seatFor };
}
