import {
  PROPS,
  colorProps,
  dispenserDefinition,
  tileAppearanceOf,
  tileAppearanceProps,
  tileModelFamily,
} from '../../shared/pieces.js';
import { readProps, writeProps } from './props-codec.js';

// Own the server-authoritative piece appearance and self-righting policy. The room keeps small
// facades because handlers and the physics loop already express these operations in room terms.
export function standOf(piece) {
  const props = readProps(piece);
  if (props.stand !== undefined) return props.stand;
  if (
    piece.type === 'deck' ||
    piece.type === 'dispenser' ||
    piece.type === 'mat' ||
    piece.type === 'notecard' ||
    piece.type === 'notecardStack'
  )
    return 'flat';
  return (PROPS[props.shape] || {}).stand;
}

export function naturalStand(piece) {
  if (
    piece.type === 'deck' ||
    piece.type === 'dispenser' ||
    piece.type === 'mat' ||
    piece.type === 'notecard' ||
    piece.type === 'notecardStack'
  )
    return 'flat';
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
  const dispDef = piece.type === 'dispenser' ? dispenserDefinition(props) : null;
  const next = colorProps(piece.type, props, opts, dispDef);
  if (!next) return false;
  const patch = opts.tileAppearance ?? opts.dominoAppearance;
  const family = tileModelFamily(props);
  if (piece.type === 'deck' && patch && family) {
    const cards = room.deckCards?.get(id);
    if (cards)
      for (let i = 0; i < cards.length; i++) {
        const entry = cards[i];
        const appearance = tileAppearanceProps(props, entry);
        // Bare entries inherit the new deck style. Explicit overrides retain their
        // other fields while the same validated patch changes the requested field.
        if (entry && typeof entry === 'object' && entry[family.appearanceKey]) {
          cards[i] = {
            ...entry,
            [family.appearanceKey]: {
              ...tileAppearanceOf({ ...props, ...appearance }),
              ...patch,
            },
          };
        }
      }
  }
  writeProps(piece, next);
  return true;
}
