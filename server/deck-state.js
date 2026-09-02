// A deck card entry is either a bare front ref (legacy: shares the deck's back) or a
// `{ front, back }` pair (per-tile back — a tree tile wearing a tree-back inside a
// forageable stack, or a double-sided tile whose other face is real art). These accessors
// read either shape so the rest of the server never has to care which it is.
export const cardFrontRef = (entry) => (entry && typeof entry === 'object' ? entry.front : entry);
export const cardBackRef = (entry) => (entry && typeof entry === 'object' ? entry.back : undefined);

// Apply the state mutation shared by every way of drawing the top card. Callers
// retain responsibility for where the card goes and whether an empty deck is
// removed immediately (inspect mode intentionally leaves it until placement).
// Returns the card's front, its per-tile back (or undefined → use the deck's shared back),
// and whether the deck is now empty.
export function takeTopCard(deck, cards) {
  if (!deck || deck.type !== 'deck' || !Array.isArray(cards) || cards.length === 0) return null;
  const entry = cards.pop();
  deck.count = cards.length;
  return { front: cardFrontRef(entry), back: cardBackRef(entry), empty: cards.length === 0 };
}
