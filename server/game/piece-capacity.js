import { DemoDiceLimitError } from './demo-dice-policy.js';

export const MAX_PIECES = 250;

export function hasPieceCapacity(room, maxPieces = MAX_PIECES) {
  return room.state.pieces.size < maxPieces;
}

// Call before consuming cards/tokens. These operations are synchronous from the
// capacity check through spawn, so another message cannot take the checked slot.
export function ensurePieceCapacity(room, client, maxPieces = MAX_PIECES, type) {
  try {
    room.dicePolicy?.assertCapacity(room.state.pieces, type);
  } catch (error) {
    if (!(error instanceof DemoDiceLimitError)) throw error;
    room.dicePolicy.notify(client, error.kind);
    return false;
  }
  if (hasPieceCapacity(room, maxPieces)) return true;
  room.notifyFull(client);
  return false;
}

// Final invariant at the actual creation boundary, including internal callers.
export function assertPieceCapacity(room, maxPieces = MAX_PIECES, type) {
  room.dicePolicy?.assertCapacity(room.state.pieces, type);
  if (!hasPieceCapacity(room, maxPieces)) throw new Error('Table piece limit reached');
}
