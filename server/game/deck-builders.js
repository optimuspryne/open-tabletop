import { LETTER_DIST, MAHJONG } from '../../shared/pieces.js';
import {
  PLAYING_CARD_BACKS,
  PLAYING_CARD_DEFAULT_BACK,
  PLAYING_CARD_FACES,
  PLAYING_CARD_JOKERS,
  PLAYING_CARD_GEOM,
} from '../../shared/playing-cards.js';

// Build private game inventory, not textures. Share the room's shuffle routine
// through injection so deck creation and later shuffles use the same behavior.
export function createDeckBuilders({ shuffle }) {
  // The server retains the shuffled image refs privately; browsers load only
  // revealed faces. Existing procedural refs still render in older snapshots.
  function buildSimpleDeck(jokers = false, backDesign = PLAYING_CARD_DEFAULT_BACK) {
    const back =
      PLAYING_CARD_BACKS.find((entry) => entry.id === backDesign) || PLAYING_CARD_BACKS[0];
    const cards = PLAYING_CARD_FACES.map((face) => face.ref);
    if (jokers) cards.push(...PLAYING_CARD_JOKERS.map((face) => face.ref));
    return { back: back.ref, cards: shuffle(cards), geom: { ...PLAYING_CARD_GEOM } };
  }

  // A shuffled double-six domino set as a "deck" of 28 tiles. `tile: 'domino'` rides to every card
  // so each spawned/held domino gets its 2:1 tile geometry (see cardGeom), face-down or face-up.
  function buildDominoSet() {
    const cards = [];
    for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) cards.push(`domino:${a}:${b}`);
    return { back: 'domback', cards: shuffle(cards), tile: 'domino', deckModel: 'bag' };
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
      deckModel: 'bag',
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
    return { back: 'mjback', cards: shuffle(cards), tile: 'mahjong', deckModel: 'bag' };
  }

  return { buildSimpleDeck, buildDominoSet, buildScrabbleBag, buildMahjongWall };
}
