// Apply the state mutation shared by every way of drawing the top card. Callers
// retain responsibility for where the card goes and whether an empty deck is
// removed immediately (inspect mode intentionally leaves it until placement).
export function takeTopCard(deck, cards) {
  if (!deck || deck.type !== 'deck' || !Array.isArray(cards) || cards.length === 0) return null;
  const front = cards.pop();
  deck.count = cards.length;
  return { front, empty: cards.length === 0 };
}
