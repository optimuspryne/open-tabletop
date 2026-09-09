import { spawnTableCard } from './card-transfer.js';
import { inspectedEntry } from '../deck-state.js';
import { hasPieceCapacity, MAX_PIECES } from './piece-capacity.js';

// Delete the pending card only after its destination has accepted it.
export function returnInspectedCard(room, sessionId, maxPieces = MAX_PIECES) {
  const pending = room.pendingInspect.get(sessionId);
  if (!pending) return true;
  const deck = room.state.pieces.get(pending.deckId);
  const cards = room.deckCards.get(pending.deckId);
  if (deck?.type === 'deck' && cards) {
    cards.push(inspectedEntry(pending));
    deck.count = cards.length;
    room.updateDeckCollider(pending.deckId);
  } else {
    if (!hasPieceCapacity(room, maxPieces)) return false;
    spawnTableCard(room, [0, 4, 0], pending);
  }
  room.pendingInspect.delete(sessionId);
  return true;
}

// Disconnected/restored inspections have no UI to retry them. Keep them private
// at capacity and retry on simulation ticks; resets clear pendingInspect too.
export function recoverPendingInspections(room, maxPieces = MAX_PIECES) {
  for (const [sessionId, pending] of room.pendingInspect) {
    if (pending.recover) returnInspectedCard(room, sessionId, maxPieces);
  }
}
