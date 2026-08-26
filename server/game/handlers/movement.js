import { finitePosition } from '../../message-validation.js';

// Exclusive piece ownership is the authority boundary for dragging. A client may
// move/release only pieces it successfully claimed; group movement applies the
// same rule independently to every selected piece.
export function registerMovementHandlers(room, { isMovable }) {
  room.onMessage('grab', (client, message) => {
    const { id } = message || {};
    const piece = room.state.pieces.get(id);
    if (piece && !piece.owner && !room.flips.has(id) && isMovable(piece)) {
      piece.owner = client.sessionId;
    }
  });

  room.onMessage('move', (client, message) => {
    const target = finitePosition(message);
    if (!target) return;
    const piece = room.state.pieces.get(message.id);
    if (piece && piece.owner === client.sessionId) room.targets.set(message.id, target);
  });

  room.onMessage('release', (client, message) => {
    const { id, v } = message || {};
    const piece = room.state.pieces.get(id);
    if (piece && piece.owner === client.sessionId) room.releasePiece(id, v);
  });

  room.onMessage('grabGroup', (client, message) => {
    const { ids, anchor } = message || {};
    if (!Array.isArray(ids)) return;
    const anchorBody = room.bodies.get(anchor);
    if (!anchorBody) return;
    const offsets = new Map();
    for (const id of ids) {
      const piece = room.state.pieces.get(id);
      const body = room.bodies.get(id);
      if (!piece || !body || piece.owner || room.flips.has(id) || !isMovable(piece)) continue;
      piece.owner = client.sessionId;
      offsets.set(id, {
        x: body.position.x - anchorBody.position.x,
        y: body.position.y - anchorBody.position.y,
        z: body.position.z - anchorBody.position.z,
      });
    }
    room.groups.set(client.sessionId, offsets);
  });

  room.onMessage('moveGroup', (client, message) => {
    const target = finitePosition(message);
    if (!target) return;
    const group = room.groups.get(client.sessionId);
    if (!group) return;
    for (const [id, offset] of group) {
      const piece = room.state.pieces.get(id);
      if (piece && piece.owner === client.sessionId) {
        room.targets.set(id, { x: target.x + offset.x, y: target.y + offset.y, z: target.z + offset.z });
      }
    }
  });

  room.onMessage('releaseGroup', (client, message) => {
    const group = room.groups.get(client.sessionId);
    if (!group) return;
    for (const [id] of group) {
      const piece = room.state.pieces.get(id);
      if (piece && piece.owner === client.sessionId) room.releasePiece(id, message && message.v);
    }
    room.groups.delete(client.sessionId);
  });
}
