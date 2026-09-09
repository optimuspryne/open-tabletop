import { LETTER_DIST, MAHJONG } from '../../shared/pieces.js';

// Build private game inventory, not textures. Share the room's shuffle routine
// through injection so deck creation and later shuffles use the same behavior.
export function createDeckBuilders({ shuffle }) {
  // A card is identified by texture REFERENCES: 'rank:A:#111' (procedural face),
  // 'back' (procedural back), or a data-URL / URL for an uploaded/file image.
  // A deck = a shared back + an ordered list of front refs.
  // A standard, shuffled 52-card deck as a list of face "refs" (see deckRefOk).
  // A ref like "rank:A:♠:#000000" tells the client how to draw that face itself,
  // so we never ship 52 images — just 52 short strings.
  function buildSimpleDeck(jokers = false) {
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const suits = [
      { symbols: ['♠', '♣'], color: '#000000' }, // black
      { symbols: ['♥', '♦'], color: '#bd2500' }, // red
    ];
    const cards = [];
    for (const { symbols, color } of suits)
      for (const symbol of symbols)
        for (const rank of ranks) cards.push(`rank:${rank}:${symbol}:${color}`);
    if (jokers) cards.push('joker:#bd2500', 'joker:#1a1a1a'); // one red, one black — a complete 54-card deck
    return { back: 'back', cards: shuffle(cards) };
  }

  // A shuffled double-six domino set as a "deck" of 28 tiles. `tile: 'domino'` rides to every card
  // so each spawned/held domino gets its 2:1 tile geometry (see cardGeom), face-down or face-up.
  function buildDominoSet() {
    const cards = [];
    for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) cards.push(`domino:${a}:${b}`);
    return { back: 'domback', cards: shuffle(cards), tile: 'domino', deckModel: 'bentwood' };
  }

  // A shuffled 100-tile letter bag for Wordy McWordface, built from LETTER_DIST (edit the bag there).
  // `tile:'letter'` gives each tile its chunky square geometry; `snap:true` rides to every drawn/played
  // tile (see geoOf) so it snaps into a board cell (see spawnCardFlat / releasePiece).
  function buildScrabbleBag() {
    const cards = [];
    for (const [L, [count, value]] of Object.entries(LETTER_DIST))
      for (let i = 0; i < count; i++) cards.push(`letter:${L}:${value}`); // blank letter '' → 'letter::0'
    return {
      back: 'lback',
      cards: shuffle(cards),
      tile: 'letter',
      snap: true,
      deckModel: 'bentwood',
    };
  }

  // The standard 144-tile Mahjong wall as a shuffled "deck", from the MAHJONG face lists. `tile:'mahjong'`
  // gives each tile its chunky geometry; the face refs are bundled image URLs (composited ivory tiles).
  function buildMahjongWall() {
    const cards = [];
    const push = (id, n) => {
      for (let i = 0; i < n; i++) cards.push(MAHJONG.base + id + '.png');
    };
    for (const suit of MAHJONG.suits) for (let r = 1; r <= 9; r++) push(suit + r, 4); // 3 suits × 1-9 × 4 = 108
    for (const h of MAHJONG.honors) push(h, 4); // winds + dragons × 4 = 28
    for (const b of MAHJONG.bonus) push(b, 1); // flowers + seasons × 1 = 8
    return { back: 'mjback', cards: shuffle(cards), tile: 'mahjong', deckModel: 'bentwood' };
  }

  return { buildSimpleDeck, buildDominoSet, buildScrabbleBag, buildMahjongWall };
}
