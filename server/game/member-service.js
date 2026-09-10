import { RANK } from '../permissions.js';

// Own membership-list delivery and waiting-lobby coordination. Mutation permissions remain visible
// in the handlers; live ranks are deliberately rechecked after database reads.
export function createMemberService({ db, matchMaker }) {
  const sendMembers = async (room, client) => {
    if (!room.roomId || room.rank(client) < RANK.gm) return;
    const list = await db.listMembers(room.roomId);
    if (room.rank(client) < RANK.gm) return;
    client.send('memberList', list);
  };

  const broadcastMembers = async (room) => {
    if (!room.roomId) return;
    const list = await db.listMembers(room.roomId);
    for (const client of room.clients)
      if (room.rank(client) >= RANK.gm) client.send('memberList', list);
  };

  const notifyLobby = async (room, userId, method) => {
    const lobbies = await matchMaker.query({ name: 'lobby', code: room.roomCode });
    await Promise.all(
      lobbies.map((lobby) => matchMaker.remoteRoomCall(lobby.roomId, method, [userId])),
    );
  };

  return { broadcastMembers, notifyLobby, sendMembers };
}
