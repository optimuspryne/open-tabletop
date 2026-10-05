import { geomFromImage } from './pieces.js';

// Mesmedir's CC0 bridge deck: stable image references also carry card identity for
// hand labels/sorting. Originals remain unmodified (one-pixel size variations).
const base = '/cards/bridge/';
export const PLAYING_CARD_BACKS = Object.freeze([
  Object.freeze({ id: 'blue', name: 'Blue', ref: base + 'Back-B.png' }),
  Object.freeze({ id: 'red', name: 'Red', ref: base + 'Back-R.png' }),
]);
export const PLAYING_CARD_DEFAULT_BACK = 'blue';
// Preserve bridge aspect at the standard card length. Alpha corners measure
// roughly 4–5% of image width; both rendering and physics use this geometry.
export const PLAYING_CARD_GEOM = Object.freeze({
  ...geomFromImage(486, 758, 0.045),
  shape: 'rect',
});
const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const PLAYING_CARD_FACES = Object.freeze(
  [
    ['S', '♠', '#000000'],
    ['C', '♣', '#000000'],
    ['H', '♥', '#bd2500'],
    ['D', '♦', '#bd2500'],
  ].flatMap(([file, suit, color]) =>
    ranks.map((rank, index) =>
      Object.freeze({ kind: 'rank', rank, suit, color, ref: `${base}${file}-${index + 1}.png` }),
    ),
  ),
);
export const PLAYING_CARD_JOKERS = Object.freeze([
  Object.freeze({ kind: 'joker', color: '#bd2500', ref: base + 'X-R.png' }),
  Object.freeze({ kind: 'joker', color: '#1a1a1a', ref: base + 'X-B.png' }),
]);
const faces = new Map(
  [...PLAYING_CARD_FACES, ...PLAYING_CARD_JOKERS].map((face) => [face.ref, face]),
);
export const playingCardFace = (ref) => faces.get(ref) || null;
// Exact catalog membership, never arbitrary static paths or network references.
export const bundledPlayingCardReference = (ref) =>
  faces.has(ref) || PLAYING_CARD_BACKS.some((back) => back.ref === ref);
