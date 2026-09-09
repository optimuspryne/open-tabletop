import { readProps } from './props-codec.js';

// The same transfer for single-card and group takes, including double-sided tiles.
export function takeTableCard(room, client, id, geoOf) {
  const piece = room.state.pieces.get(id);
  if (!piece || piece.type !== 'card') return;
  const props = readProps(piece);
  const front = room.cardData.get(id)?.front ?? props.front;
  room.addToHand(client, front, props.back || 'back', geoOf(props), props.open);
  room.removePiece(id);
}

// Shared table placement for hands, deck draws, inspections, and recovery.
// Callers own capacity checks, positions, and inventory consumption. The room's
// spawnCardFlat keeps responsibility for physics orientation and grid snapping.
export function spawnTableCard(room, position, { front, back, open, geo = {} }, faceDown = true) {
  const props = { ...geo, back };
  if (open || !faceDown) props.front = front;
  if (open) {
    props.open = true;
    if (faceDown) props.down = true;
  }
  const id = room.spawnCardFlat(position, props);
  if (!open && faceDown) room.cardData.set(id, { front });
  return id;
}
