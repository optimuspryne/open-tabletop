import { returnInspectedCard } from './inspection-recovery.js';

// Shared by time-out and departure. A restriction preserves seats, trays, hands
// and membership; those belong to the separate final-departure lifecycle.
export function stopPlayerInteraction(room, sessionId, { recoverInspection = true } = {}) {
  room.notecards?.cancelClient(sessionId);
  room.deckBrowsing?.cancelClient(
    sessionId,
    'Deck browsing ended because your table access changed.',
  );
  room.state.pieces.forEach((piece, id) => {
    if (piece.owner !== sessionId) return;
    piece.owner = '';
    room.targets.delete(id);
    const body = room.bodies.get(id);
    if (body) {
      body.velocity.set(0, 0, 0);
      body.angularVelocity.set(0, 0, 0);
      body.wakeUp();
    }
  });
  room.groups.delete(sessionId);
  room.broadcast('overlayDrag', { from: sessionId, kind: null });
  if (room.state.whiteboard.owner === sessionId) room.state.whiteboard.owner = '';
  room.stopShow(sessionId);
  room.lastDrop.delete(sessionId);
  if (recoverInspection) {
    const pending = room.pendingInspect.get(sessionId);
    if (pending) {
      pending.recover = true; // stays recoverable if full or recovery throws
      returnInspectedCard(room, sessionId);
    }
  }
}
