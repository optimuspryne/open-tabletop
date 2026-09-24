import { RANK, canUseRoomCapability, canManageMember } from '../permissions.js';

export function createParticipationService({ db, roomAccess }) {
  const queues = new WeakMap();
  function setPlayerTimeout(room, client, message) {
    let targets = queues.get(room);
    if (!targets) queues.set(room, (targets = new Map()));
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
    const pending = (targets.get(userId) || Promise.resolve()).catch(() => {}).then(run);
    targets.set(userId, pending);
    return pending.finally(() => {
      if (targets.get(userId) === pending) targets.delete(userId);
    });
  }
  return { setPlayerTimeout };
}
