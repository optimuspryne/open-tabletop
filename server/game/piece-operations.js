import { DISPENSERS, PROPS, colorProps } from '../../shared/pieces.js';
import { readProps, writeProps } from './props-codec.js';

// Own the server-authoritative piece appearance and self-righting policy. The room keeps small
// facades because handlers and the physics loop already express these operations in room terms.
export function standOf(piece) {
  const props = readProps(piece);
  if (props.stand !== undefined) return props.stand;
  if (piece.type === 'deck' || piece.type === 'dispenser' || piece.type === 'mat') return 'flat';
  return (PROPS[props.shape] || {}).stand;
}

export function naturalStand(piece) {
  if (piece.type === 'deck' || piece.type === 'dispenser' || piece.type === 'mat') return 'flat';
  const props = readProps(piece);
  const spec = PROPS[props.shape] || {};
  if (spec.stand) return spec.stand;
  const box = spec.collider && spec.collider.box;
  return box && box[1] <= box[0] && box[1] <= box[2] ? 'flat' : true;
}

export function recolorPiece(room, id, opts = {}) {
  const piece = room.state.pieces.get(id);
  if (!piece) return false;
  const props = readProps(piece);
  const dispDef = piece.type === 'dispenser' ? DISPENSERS[props.disp] : null;
  const next = colorProps(piece.type, props, opts, dispDef);
  if (!next) return false;
  writeProps(piece, next);
  return true;
}
