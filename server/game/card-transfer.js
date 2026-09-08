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
