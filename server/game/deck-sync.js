import { cardBackRef } from '../deck-state.js';
import { readProps, writeProps } from './props-codec.js';

// An OPEN tile set shows its current top tile's back as the stack cover; keep that in sync as the
// top changes (draw / shuffle / combine). Writes props (→ every client rebuilds the deck) only when
// the cover actually changes, and only for open decks. No-op for secret decks and bare-back stacks.
export function syncOpenCover(room, deckId) {
  const piece = room.state.pieces.get(deckId);
  if (!piece) return;
  const props = readProps(piece);
  if (!props.open) return;
  const cards = room.deckCards.get(deckId);
  if (!cards || !cards.length) return;
  const cover = cardBackRef(cards[cards.length - 1]); // the top tile's own back (undefined → shared)
  const next = cover ?? props.back;
  if ((props.cover ?? props.back) === next) return; // nothing to repaint
  if (cover) props.cover = cover;
  else delete props.cover;
  writeProps(piece, props);
}
