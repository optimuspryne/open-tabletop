import {
  groupGrabPayload,
  groupMovePayload,
  groupReleasePayload,
  pieceIdPayload,
  pieceMovePayload,
  pieceReleasePayload,
} from '../../message-validation.js';
import { safeMessage } from '../safe-message.js';

// Exclusive piece ownership is the authority boundary for dragging. A client may
// move/release only pieces it successfully claimed; group movement applies the
// same rule independently to every selected piece.
export function registerMovementHandlers(room, { isMovable, maxPieces = 80, logger = console }) {
  const movementMessage = (type, handler) => safeMessage(room, type, handler, { logger });

  movementMessage('grab', (client, message) => {
    const parsed = pieceIdPayload(message);
    if (!parsed) return;
    const { id } = parsed;
    const piece = room.state.pieces.get(id);
    if (piece && !piece.owner && !room.flips.has(id) && isMovable(piece)) {
      piece.owner = client.sessionId;
    }
  });

  movementMessage('move', (client, message) => {
    const parsed = pieceMovePayload(message);
    if (!parsed) return;
    const { id, x, y, z } = parsed;
    const piece = room.state.pieces.get(id);
    if (piece && piece.owner === client.sessionId) room.targets.set(id, { x, y, z });
  });

  movementMessage('release', (client, message) => {
    const parsed = pieceReleasePayload(message);
    if (!parsed) return;
    const { id, v } = parsed;
    const piece = room.state.pieces.get(id);
    if (piece && piece.owner === client.sessionId) room.releasePiece(id, v);
  });

  movementMessage('grabGroup', (client, message) => {
    const parsed = groupGrabPayload(message, { max: maxPieces });
    if (!parsed) return;
    const { ids, anchor } = parsed;
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

  movementMessage('moveGroup', (client, message) => {
    const target = groupMovePayload(message);
    if (!target) return;
    const group = room.groups.get(client.sessionId);
    if (!group) return;
    for (const [id, offset] of group) {
      const piece = room.state.pieces.get(id);
      if (piece && piece.owner === client.sessionId) {
        room.targets.set(id, {
          x: target.x + offset.x,
          y: target.y + offset.y,
          z: target.z + offset.z,
        });
      }
    }
  });

  movementMessage('releaseGroup', (client, message) => {
    const parsed = groupReleasePayload(message);
    if (!parsed) return;
    const group = room.groups.get(client.sessionId);
    if (!group) return;
    for (const [id] of group) {
      const piece = room.state.pieces.get(id);
      if (piece && piece.owner === client.sessionId) room.releasePiece(id, parsed.v);
    }
    room.groups.delete(client.sessionId);
  });
}
