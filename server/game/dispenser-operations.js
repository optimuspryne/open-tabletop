import { DISPENSERS, dispensedSpec } from '../../shared/pieces.js';
import { readProps } from './props-codec.js';

// Resolve the exact child spec used by dispensing and absorption without duplicating shared rules.
export function dispenserItem(piece) {
  return dispensedSpec(readProps(piece));
}

// Consume inventory only after a successful spawn. Infinite dispensers are deliberately unchanged.
export function afterDispense(room, piece, id) {
  const definition = DISPENSERS[readProps(piece).disp];
  if (!definition || definition.infinite) return;
  piece.count = Math.max(0, piece.count - 1);
  if (piece.count <= 0) room.removePiece(id);
  else room.updateStackCollider(id);
}
