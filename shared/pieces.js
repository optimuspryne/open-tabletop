// =============================================================================
// SINGLE SOURCE OF TRUTH  —  every piece dimension, mass, color and proportion.
// Imported by BOTH the server (to build cannon-es colliders) and the client (to
// build Three.js meshes). Keeping it all here is what stops the physics body and
// the rendered mesh from drifting apart, and keeps magic numbers out of the code.
// =============================================================================

// --- Table ------------------------------------------------------------------
export const TABLE = { x: 10, z: 7 }; // half-extents of the play surface

// --- Colors ----------------------------------------------------------------
// Values are hex ints (Three.js materials) or CSS strings (canvas textures);
// Three.Color accepts either, so the ivory/ink strings work in both places.
export const COLORS = {
  neutralProp: 0x9aa0a6, // default color for neutral props
  cardSide: 0xffffff, // card edges
  deckEdge: 0xf2efe6, // deck paper edge
  boardEdge: 0x2a2a2a, // board rim
  felt: ['#3a3a3a', '#d9c7a0'], // board checker squares [dark, light]
  ivory: '#f4f1ea', // blank die faces
  ink: '#141414', // die numbers
  team: {
    // fixed two-color game sets [color0, color1]
    checker: [0xb03030, 0x2a2a2a], // red / black
    go: [0x111111, 0xf0f0f0], // black / white
    chess: [0xe8e0d0, 0x2a2a2a], // ivory / black
  },
};

// --- Kinds (physics half) ---------------------------------------------------
// mass + collider `shape`: 'die' (polyhedron from props.sides), 'prop' (per-shape
// data in PROPS below), or { box:[hx,hy,hz] }. mass 0 = static/not grabbable.
export const KINDS = {
  die: { mass: 1, shape: 'die' },
  card: { mass: 0.02, shape: { box: [0.75, 0.015, 1.05] } },
  prop: { mass: 0.5, shape: 'prop' },
  deck: { mass: 0.5, shape: { box: [0.78, 0.04, 1.08] } }, // thin puck; grows via updateDeckCollider
  board: { mass: 0, shape: { box: [4.0, 0.05, 4.0] } },
  dispenser: { mass: 0.5, shape: 'dispenser' }, // hands out copies of a child piece; collider from DISPENSERS
  mat: { mass: 4, shape: 'mat' }, // a large single-faced surface others rest on; collider from cardGeom (props.geom)
};

// --- Deck -------------------------------------------------------------------
export const DECK_VISUAL = [1.56, 0.06, 2.16]; // unit stack box; y scaled by deckHeight(count)
export const CARD_ROUND = 0.08; // card & deck corner radius, as a fraction of card width (0 = square)

// --- Card / tile geometry ---------------------------------------------------
// A "tile" is a card with a different footprint + thickness (domino, scrabble, mahjong, …). The
// standard card is just the default entry. Values are WORLD HALF-EXTENTS: w (half-width), h
// (half-height/length), t (half-thickness); `round` is the corner radius as a fraction of width.
export const TILES = {
  card: {
    w: KINDS.card.shape.box[0],
    h: KINDS.card.shape.box[2],
    t: KINDS.card.shape.box[1],
    round: CARD_ROUND,
  }, // the standard playing card
  domino: { w: 0.5, h: 1.0, t: 0.09, round: 0.08 }, // a chunky 2:1 tile (1.0 × 2.0 full, pips on top)
  letter: { w: 0.3, h: 0.3, t: 0.06, round: 0.16 }, // a chunky square word-tile (0.6 × 0.6, fits a Wordy board cell)
  mahjong: { w: 0.34, h: 0.473, t: 0.14, round: 0.06 }, // a chunky mahjong tile (~0.68 × 0.95, image face at the art's 0.72 aspect)
};
// The single source of a card/tile's geometry — read by BOTH the client mesh (cardMesh) and the
// server collider, so rendered size and physics footprint can never drift (same guarantee dieR()
// gives dice). Resolves in priority order:
//   1. props.geom = { w, h, t?, round? } — an EXPLICIT geometry (custom uploads, custom-aspect image
//      decks: the card is sized to the art, no crop/stretch). Half-extents.
//   2. props.tile — a named kind in TILES (a built-in tile's fixed footprint).
//   3. the standard card.
// Returns { hw, hh, th, round } in world half-extents. `geom`/`tile` are PUBLIC props, so a
// face-down tile still shows its true shape while its face stays private.
export function cardGeom(props = {}) {
  const std = TILES.card;
  const g = props.geom;
  if (g && +g.w > 0 && +g.h > 0) {
    const shape = g.shape === 'hex' ? 'hex' : 'rect';
    const th = +g.t > 0 ? +g.t : std.t,
      round = g.round >= 0 ? +g.round : std.round;
    // A regular POINTY-TOP hexagon: circumradius R = the half-height (points at top & bottom); pin the
    // half-width to R·√3/2 so the mesh and the 6-gon collider (cannon's default hexagon also points
    // along ±Z) are always regular and aligned — no collider rotation needed.
    if (shape === 'hex') {
      const R = +g.h;
      return { hw: +(R * HEX_HH).toFixed(4), hh: R, th, round, shape };
    }
    return { hw: +g.w, hh: +g.h, th, round, shape: 'rect' };
  }
  const spec = (props.tile && TILES[props.tile]) || std;
  return { hw: spec.w, hh: spec.h, th: spec.t, round: spec.round, shape: 'rect' };
}
// Half-width of a regular pointy-top hexagon as a fraction of its half-height (circumradius): √3/2.
export const HEX_HH = Math.sqrt(3) / 2;

// A card geometry that matches an image's pixel aspect, so uploaded card art is neither cropped
// nor stretched. The image's LONGER side maps to the standard card's longer half-extent, so a
// standard-proportioned image yields the standard card and any other aspect is preserved. Stays a
// thin card (standard thickness). `round` is the corner radius (fraction of width) MEASURED from the
// art's own alpha — so the card mesh and the deck round to the SAME corner the art uses, matching the
// provided image exactly (0 = a square-cornered / fully-opaque image). Omitted → the standard card
// radius. Half-extents.
export function geomFromImage(pw, ph, round) {
  const std = TILES.card,
    L = std.h; // longer half-extent = the card's length
  const a = +pw > 0 && +ph > 0 ? +pw / +ph : std.w / std.h; // width : height
  const [w, h] = a >= 1 ? [L, L / a] : [L * a, L]; // landscape → width=L; portrait → height=L
  const r = round >= 0 && +round <= 0.5 ? +round : std.round; // from the art's alpha; else standard
  return { w: +w.toFixed(4), h: +h.toFixed(4), t: std.t, round: +r.toFixed(4) };
}
// Bound a client-supplied card geometry to sane table sizes, or null if unusable. Trusted before a
// geom is stored on a deck/card.
export function sanitizeGeom(g, { maxWH = 3, maxT = 0.4 } = {}) {
  if (!g || typeof g !== 'object') return null;
  const clampNum = (v, lo, hi) => {
    v = +v;
    return Number.isFinite(v) && v >= lo && v <= hi ? v : null;
  };
  const w = clampNum(g.w, 0.1, maxWH),
    h = clampNum(g.h, 0.1, maxWH);
  if (w == null || h == null) return null;
  const t = clampNum(g.t, 0.005, maxT) ?? TILES.card.t;
  const round = clampNum(g.round, 0, 0.5) ?? TILES.card.round;
  const shape = g.shape === 'hex' ? 'hex' : 'rect';
  return { w, h, t, round, shape };
}
// A player MAT's geometry cap — a large flat surface others rest on, so far bigger than a card.
export const MAT_MAX_HALF = 9; // half-extent cap — covers the 8x size slider (8 x 1.05 card-length = 8.4)
export const sanitizeMatGeom = (g) => sanitizeGeom(g, { maxWH: MAT_MAX_HALF, maxT: 0.4 });
// Deck stack height from card count — used by BOTH the client visual and the
// server collider, so a flipped deck has a solid body where it's drawn.
export const deckHeight = (c) => Math.max(0.06, Math.min(1.2, c * 0.02));

// --- Props ------------------------------------------------------------------
// Each preset: mass, a coarse proxy `collider` (box or sphere), a `render`
// descriptor the client dispatches on, and optional `team` (which COLORS.team
// palette to use; absent = neutral, uses the picked color).
// render.prim: box | sphere | cone | cyl | lens. (glb-model props use `model` instead.)
export const PROPS = {
  box: { mass: 0.6, collider: { box: [0.5, 0.5, 0.5] }, render: { prim: 'box', size: [1, 1, 1] } },
  pyramid: {
    mass: 0.6,
    collider: { box: [0.55, 0.5, 0.55] },
    render: { prim: 'cone', r: 0.72, h: 1, seg: 4 },
  },
  sphere: {
    mass: 0.6,
    collider: { box: [0.5, 0.5, 0.5], type: 'sphere' },
    render: { prim: 'sphere', r: 0.5 },
  },
  cuboid: {
    mass: 0.6,
    collider: { box: [0.7, 0.4, 0.5] },
    render: { prim: 'box', size: [1.4, 0.8, 1.0] },
  },
  cone: {
    mass: 0.6,
    collider: { box: [0.6, 0.5, 0.6], type: 'cone' },
    render: { prim: 'cone', r: 0.6, h: 1 },
  },
  cylinder: {
    mass: 0.6,
    collider: { box: [0.45, 0.5, 0.45], type: 'cylinder' },
    render: { prim: 'cyl', r: 0.45, h: 1 },
  },
  frustum: {
    mass: 0.6,
    collider: { box: [0.5, 0.5, 0.5], type: 'cylinder', top: 0.5 },
    render: { prim: 'cyl', r: 0.5, rTop: 0.25, h: 1 },
  },
  hex_prism: {
    mass: 0.6,
    collider: { box: [0.5, 0.5, 0.5], type: 'cylinder', sides: 6 },
    render: { prim: 'cyl', r: 0.5, h: 1, seg: 6 },
  },
  tri_prism: {
    mass: 0.6,
    collider: { box: [0.5, 0.5, 0.5], type: 'cylinder', sides: 3 },
    render: { prim: 'cyl', r: 0.5, h: 1, seg: 3 },
  },
  hex_pyramid: {
    mass: 0.6,
    collider: { box: [0.6, 0.5, 0.6], type: 'cone', sides: 6 },
    render: { prim: 'cone', r: 0.6, h: 1, seg: 6 },
  },
  checker: {
    mass: 0.6,
    collider: { box: [0.3, 0.05, 0.3], type: 'cylinder' },
    render: { prim: 'cyl', r: 0.3, h: 0.1 },
    team: 'checker',
    stand: 'flat',
  },
  crowned_checker: {
    mass: 0.6,
    collider: { box: [0.3, 0.1, 0.3], type: 'cylinder' },
    render: { prim: 'cyl', r: 0.3, h: 0.2 },
    team: 'checker',
    stand: 'flat',
  },
  // Bundled .glb models (public/models/pieces). worldSizes differ wildly, so each has its own modelScale.
  coin: {
    mass: 0.3,
    collider: { box: [0.21, 0.021, 0.21], type: 'cylinder' },
    model: '/models/pieces/misc/coin.glb',
    modelScale: 0.3,
    ownMaterial: false,
    metal: true,
  }, // rotated flat; keeps its own look
  poker_chip: {
    mass: 0.25,
    collider: { box: [0.45, 0.045, 0.45] },
    model: '/models/pieces/misc/poker_chip.glb',
    modelScale: 0.18,
    tintMaterial: 'c1',
    glossy: true, // the tinted body gets a glossy sheen; the white rim stays matte
  }, // color picker tints only the body; white rim kept
  token: {
    mass: 0.4,
    collider: { box: [0.17, 0.5, 0.17] },
    model: '/models/pieces/misc/token.glb',
    modelScale: 0.84,
    stand: true,
    glossy: true,
  }, //Generic token to represent a player, for use in various games.
  go: {
    mass: 0.2,
    collider: { box: [0.15, 0.075, 0.15], type: 'flat' },
    render: { prim: 'lens', r: 0.2, sy: 0.375 },
    team: 'go',
    stand: 'flat',
    glossy: true,
  }, // ~0.4 wide, fits the go board grid
  train_piece: {
    mass: 0.4,
    collider: { box: [0.08, 0.1, 0.3] },
    model: '/models/pieces/misc/train_piece.glb',
    modelScale: 0.12,
    ownMaterial: false,
    stand: true,
    glossy: true,
  },
  // Chess pieces are bundled .glb models (public/models/pieces/chess), CC0 by rehcub.
  // Models carry a baked 0.1 node scale, so their true loaded height is ~0.66 (king); modelScale 2.124
  // brings the king to ~1.4 tall. One uniform scale keeps relative heights; colliders are precomputed.
  'chess-pawn': {
    mass: 0.4,
    collider: { box: [0.28, 0.5, 0.24] },
    model: '/models/pieces/chess/pawn.glb',
    modelScale: 2.124,
    team: 'chess',
    stand: true,
    glossy: true,
  },
  'chess-rook': {
    mass: 0.5,
    collider: { box: [0.31, 0.59, 0.27] },
    model: '/models/pieces/chess/rook.glb',
    modelScale: 2.124,
    team: 'chess',
    stand: true,
    glossy: true,
  },
  'chess-knight': {
    mass: 0.5,
    collider: { box: [0.32, 0.54, 0.36] },
    model: '/models/pieces/chess/knight.glb',
    modelScale: 2.124,
    team: 'chess',
    stand: true,
    glossy: true,
  },
  'chess-bishop': {
    mass: 0.5,
    collider: { box: [0.31, 0.64, 0.27] },
    model: '/models/pieces/chess/bishop.glb',
    modelScale: 2.124,
    team: 'chess',
    stand: true,
    glossy: true,
  },
  'chess-queen': {
    mass: 0.6,
    collider: { box: [0.31, 0.7, 0.27] },
    model: '/models/pieces/chess/queen.glb',
    modelScale: 2.124,
    team: 'chess',
    stand: true,
    glossy: true,
  },
  'chess-king': {
    mass: 0.6,
    collider: { box: [0.31, 0.7, 0.27] },
    model: '/models/pieces/chess/king.glb',
    modelScale: 2.124,
    team: 'chess',
    stand: true,
    glossy: true,
  },
};
// Ordered list for the spawn UI. team:true = fixed two-color set; else color picker.
export const PROP_LIST = [
  { id: 'box', name: 'Box' },
  { id: 'pyramid', name: 'Pyramid' },
  { id: 'sphere', name: 'Sphere' },
  { id: 'cuboid', name: 'Cuboid' },
  { id: 'cone', name: 'Cone' },
  { id: 'cylinder', name: 'Cylinder' },
  { id: 'frustum', name: 'Truncated cone' },
  { id: 'hex_prism', name: 'Hex prism' },
  { id: 'tri_prism', name: 'Triangular prism' },
  { id: 'hex_pyramid', name: 'Hex pyramid' },
  { id: 'coin', name: 'Coin', swatches: 'metals' },
  { id: 'poker_chip', name: 'Poker chip' },
  { id: 'token', name: 'Token' },
  { id: 'checker', name: 'Checker', team: true },
  { id: 'crowned_checker', name: 'Checker - Crowned', team: true },
  { id: 'go', name: 'Go stone', team: true },
  { id: 'chess-pawn', name: 'Chess · Pawn', team: true },
  { id: 'chess-rook', name: 'Chess · Rook', team: true },
  { id: 'chess-knight', name: 'Chess · Knight', team: true },
  { id: 'chess-bishop', name: 'Chess · Bishop', team: true },
  { id: 'chess-queen', name: 'Chess · Queen', team: true },
  { id: 'chess-king', name: 'Chess · King', team: true },
  { id: 'train_piece', name: 'Train Piece' },
];
// The orientation a built-in shape "stands" in — `true` (upright, e.g. chess) or `'flat'` (lies
// down, e.g. checker/coin). Mirrors the server's naturalStand for props, so the spawn card can
// offer a Stand toggle that spawns a piece in its natural orientation. A shape with no explicit
// `stand` is flat when it's short (a disc/cube) and upright when it's tall.
export const standMode = (shape) => {
  const spec = PROPS[shape] || {};
  if (spec.stand) return spec.stand;
  const box = spec.collider && spec.collider.box;
  return box && box[1] <= box[0] && box[1] <= box[2] ? 'flat' : true;
};
// Built-in board models (public/models/boards), CC0. Modeled ~0.43 units, so a
// large modelScale fills the table; colliders precomputed (worldSize*scale/2).
// box[1] (half-thickness) also sets how high the board sits so it rests on the table.
// `grid` drives "calibrate grid to this board": `cells` across the playing area, and
// whether pieces sit in cell `center`s (chess/checkers squares) or on `cross`ings (go
// stones). Boards spawn centred at the world origin, which is where our grid is anchored,
// so no offset is needed — only the cell size (estimated from the footprint, GM-tunable)
// and the snap anchor.
// The 15×15 premium-square layout for Wordy McWordface (one char per cell, row-major, top row first):
//   T = triple word · D = double word · t = triple letter · d = double letter · * = centre (double word) · . = plain
// The classic symmetric layout — a game mechanic, drawn in our own colours (see WORDY_COLORS). Defined
// above BOARDS because the wordy board entry references it.
export const WORDY_PREMIUM = [
  'T..d...T...d..T',
  '.D...t...t...D.',
  '..D...d.d...D..',
  'd..D...d...D..d',
  '....D.....D....',
  '.t...t...t...t.',
  '..d...d.d...d..',
  'T..d...*...d..T',
  '..d...d.d...d..',
  '.t...t...t...t.',
  '....D.....D....',
  'd..D...d...D..d',
  '..D...d.d...D..',
  '.D...t...t...D.',
  'T..d...T...d..T',
];
// Our own premium-square palette (legally distinct), plus the board base + grid line + tile ink.
export const WORDY_COLORS = {
  base: '#e9ddc2',
  line: '#c3b184',
  ink: '#2c2115',
  T: '#c65d4b',
  D: '#e6a2a0',
  t: '#3f74b8',
  d: '#a9c8e6',
  star: '#e6a2a0',
};

// A board is a built-in .glb model (`model`), an uploaded .glb, a plain slab, or a PROCEDURAL board
// (`proc`) whose top is drawn from data by a client painter (see BOARD_PAINTERS in graphics.js). A
// proc board needs no art file: it carries its world `box`, a `grid` for calibration, and a `paint`
// spec the painter reads. This is the reusable procedural-board framework — add a painter + an entry
// here and any new grid/premium/battlemap board travels the same swapBoard/calibrateGrid plumbing.
export const BOARDS = {
  chess: {
    name: 'Chess / Checkers',
    model: '/models/boards/checker_chess_board.glb',
    modelScale: 1,
    box: [4.0, 0.15, 4.0],
    grid: { cells: 8, anchor: 'center' },
  },
  go: {
    name: 'Go',
    model: '/models/boards/go_board.glb',
    modelScale: 18.9,
    box: [4.01, 0.14, 4.29],
    grid: { cells: 18, anchor: 'cross', cellX: 0.42, cellZ: 0.45 },
  },
  wordy: {
    name: 'Wordy McWordface',
    proc: 'wordgrid',
    box: [5.5, 0.1, 5.5],
    // 15 cells across an 11-unit board → cell = 11/15. `anchor:'cross'` puts a cell CENTRE at
    // every k·cell (k=-7..7), i.e. the odd (15×15) grid's centre cell sits on the origin, so a
    // played tile snaps into a painted square. cells=15 → calibrateGrid derives cell = width/15.
    grid: { cells: 15, anchor: 'cross' },
    paint: { cells: 15, premium: WORDY_PREMIUM, colors: WORDY_COLORS },
  },
};
export const BOARD_SIZE = 8; // uploaded .glb boards are normalized so their largest footprint dimension is this wide

// Optional 3D "skins" a deck can wear INSTEAD of the extruded card stack — a bag / box / pile model
// that still functions as a draw pile (draw / deal / shuffle / hidden order all unchanged). An entry
// carries the model URL, a fixed modelScale, and the resulting collider half-extents (`box`). The skin
// is STATIC — it doesn't grow or shrink with the card count (a box looks full whether it holds 5 or 50).
// A set builder opts a deck in via `deckModel: '<key>'`; add an entry here to offer another skin.
export const DECK_MODELS = {
  bentwood: {
    name: 'Bentwood box',
    model: '/models/decks/bentwood_box.glb',
    modelScale: 1.5,
    box: [0.88, 0.544, 1.3],
  },
  // A drawstring pouch — a concealing "bag" skin for a shuffled tile set. Two tintable material
  // slots: the sack ('bag' → the deck's `color`) and the drawstring ('string' → `textColor`), each
  // defaulting to the values here when the deck carries no color.
  bag: {
    name: 'Pouch',
    model: '/models/decks/bag.glb',
    modelScale: 0.85,
    // The pouch is modeled upright (drawstring at +y, flattened along z); tip it a quarter-turn
    // about X so it rests on a flat face. box = the reoriented collider half-extents (y/z swapped).
    modelRot: [Math.PI / 2, 0, 0],
    box: [0.45, 0.2, 0.46],
    tints: { bag: 'color', string: 'textColor' },
    color: 0x7a5a3a, // sack: warm leather brown
    textColor: 0xc8b06a, // drawstring: tan
  },
};

// --- Word tiles (Wordy McWordface — a legally-distinct Scrabble) -------------
// Standard English 100-tile letter distribution: LETTER → [count, point value]. '' is the blank
// (2 tiles, 0 points). Public-domain game data — edit freely to change the bag.
export const LETTER_DIST = {
  A: [9, 1],
  B: [2, 3],
  C: [2, 3],
  D: [4, 2],
  E: [12, 1],
  F: [2, 4],
  G: [3, 2],
  H: [2, 4],
  I: [9, 1],
  J: [1, 8],
  K: [1, 5],
  L: [4, 1],
  M: [2, 3],
  N: [6, 1],
  O: [8, 1],
  P: [2, 3],
  Q: [1, 10],
  R: [6, 1],
  S: [4, 1],
  T: [6, 1],
  U: [4, 1],
  V: [2, 4],
  W: [2, 4],
  X: [1, 8],
  Y: [2, 4],
  Z: [1, 10],
  '': [2, 0],
};

// --- Mahjong -----------------------------------------------------------------
// The standard 144-tile wall, built from bundled CC0 face art (public/mahjong/faces/*.png, composited
// onto ivory tiles). Each face id → its image URL; buildMahjongWall() (server) stamps the counts:
//   3 suits × ranks 1-9 × 4  +  4 winds × 4  +  3 dragons × 4  +  4 flowers  +  4 seasons  = 144.
// The white dragon (dragW) is a generated blue-frame blank (its art wasn't in the set). Edit the lists
// to change the wall.
export const MAHJONG = {
  base: '/mahjong/faces/',
  suits: ['char', 'bam', 'cir'], // each rank 1..9, ×4
  honors: ['windE', 'windS', 'windW', 'windN', 'dragR', 'dragG', 'dragW'], // ×4
  bonus: [
    'flowChrys',
    'flowLotus',
    'flowOrchid',
    'flowPeony', // ×1 (flowers + seasons)
    'seasSpring',
    'seasSummer',
    'seasFall',
    'seasWinter',
  ],
};

// --- Dispensers -------------------------------------------------------------
// A dispenser hands out copies of a child piece: left-click / left-drag spawns ONE
// item (a drag carries it out, like dealing a card); right-drag (grab:2) moves it.
// Built-in only; all config rides in the piece's props + count (no DB change). The
// dispensed item is an existing PROP. body: 'stack' = the item's .glb cloned N high
// (poker chips / coins); 'model' = a bundled bowl .glb (go bowl).
export const STACK_CAP = 18; // max discs DRAWN in a stack; the real count can exceed this (visual tops out)
export const DISPENSERS = {
  pokerStack: {
    name: 'Poker chips',
    body: 'stack',
    item: 'poker_chip',
    color: true,
    count: { def: 20, max: 100 },
    mass: 0.5,
  },
  coinStack: {
    name: 'Coins',
    body: 'stack',
    item: 'coin',
    color: true,
    swatches: 'metals',
    count: { def: 20, max: 100 },
    mass: 0.5,
  },
  trainStack: {
    name: 'Trains',
    body: 'model',
    item: 'train_piece',
    color: true,
    model: '/models/pieces/misc/train_dispenser.glb',
    modelScale: 0.75,
    count: { def: 41, max: 100 },
    collider: { box: [0.2, 0.2, 0.6] },
    mass: 0.5,
  },
  // Go bowl: infinite, team-colored (interior stones + fill = black/white; the bowl
  // shell keeps its baked look). The .glb is normalised to MODEL_SIZE like an uploaded
  // model (modelScale multiplies that target); collider = the resulting half-extents.
  goBowl: {
    name: 'Go bowl',
    body: 'model',
    item: 'go',
    team: 'go',
    infinite: true,
    model: '/models/pieces/misc/gobowl.glb',
    modelScale: 1,
    tintMaterial: 'c1',
    collider: { box: [0.8, 0.5, 0.8] },
    mass: 0.5,
  },
};
export const DISPENSER_LIST = [
  { id: 'pokerStack' },
  { id: 'coinStack' },
  { id: 'trainStack' },
  { id: 'goBowl' },
];

// The prop a dispenser hands out: its item shape plus the stack's own tint (poker/coin) or team
// (go bowl). Shared by the server (spawn spec, absorb-on-drop) and the client (compose
// eligibility) so the match rule can't drift between them.
export const dispensedSpec = (dispProps = {}) => {
  const d = DISPENSERS[dispProps.disp];
  if (!d) return null;
  const props = { shape: d.item };
  if (d.team) props.team = dispProps.team ? 1 : 0;
  else if (dispProps.color != null) props.color = dispProps.color | 0;
  if (PROPS[d.item] && PROPS[d.item].team) props.snap = true;
  return { type: 'prop', props };
};

// Does a loose piece's props match what a dispenser hands out? `want` is a dispensedSpec() result.
export const itemMatchesDispenser = (want, props = {}) =>
  !!want &&
  want.props.shape === props.shape &&
  (want.props.color == null || (props.color | 0) === (want.props.color | 0)) &&
  (want.props.team == null || (props.team ? 1 : 0) === want.props.team);

// The dispenser kind whose item is this prop shape (poker_chip -> pokerStack, go -> goBowl), or
// null when a loose piece has no dispenser to pour into or mint from.
export const dispenserForItem = (shape) => {
  for (const key of Object.keys(DISPENSERS)) if (DISPENSERS[key].item === shape) return key;
  return null;
};

// One-click starter games. The server's setupStarter() clears the table, then builds one of
// these: a `board` + placed `pieces()`, and/or a `deck` and `bowls`/`stacks` of dispensers.
// `pieces()` returns { shape, team, col, row } placements on a `cells`×`cells` grid whose (0,0)
// is a corner square; the server maps col/row → world using the board's real cell size. All data
// references existing shapes/boards/dispensers — no new assets. Add or edit games freely.
const _chessBack = [
  'chess-rook',
  'chess-knight',
  'chess-bishop',
  'chess-queen',
  'chess-king',
  'chess-bishop',
  'chess-knight',
  'chess-rook',
];
export const STARTERS = {
  chess: {
    name: 'Chess',
    board: 'chess',
    cells: 8,
    pieces: () => {
      const out = [];
      for (let c = 0; c < 8; c++) {
        out.push({ shape: _chessBack[c], team: 0, col: c, row: 0 });
        out.push({ shape: 'chess-pawn', team: 0, col: c, row: 1 });
      }
      for (let c = 0; c < 8; c++) {
        out.push({ shape: 'chess-pawn', team: 1, col: c, row: 6 });
        out.push({ shape: _chessBack[c], team: 1, col: c, row: 7 });
      }
      return out;
    },
  },
  checkers: {
    name: 'Checkers',
    board: 'chess',
    cells: 8,
    pieces: () => {
      const out = [];
      for (let row = 0; row < 3; row++)
        for (let c = 0; c < 8; c++)
          if ((row + c) % 2 === 1) out.push({ shape: 'checker', team: 0, col: c, row });
      for (let row = 5; row < 8; row++)
        for (let c = 0; c < 8; c++)
          if ((row + c) % 2 === 1) out.push({ shape: 'checker', team: 1, col: c, row });
      return out;
    },
  },
  go: {
    name: 'Go',
    board: 'go',
    bowls: [
      { disp: 'goBowl', x: -6, z: 0, team: 0 },
      { disp: 'goBowl', x: 6, z: 0, team: 1 },
    ], // one black bowl, one white; stones dispensed from them
  },
  dominoes: {
    name: 'Dominoes',
    deck: { set: 'domino', deal: 7 }, // boneyard = 28 shuffled tiles; deal 7 to each seated player
  },
  wordy: {
    name: 'Wordy McWordface',
    board: 'wordy', // 15×15 procedural board; snap-to-cell on
    deck: { set: 'letter', deal: 7 },
    deckZ: 6.6, // the 100-tile bag sits just past the board's near edge; deal a 7-tile rack
  },
  mahjong: {
    name: 'Mahjong',
    deck: { set: 'mahjong', deal: 13 }, // the 144-tile wall; deal a 13-tile starting hand to each seated player
  },
  poker: {
    name: 'Poker night',
    deck: true,
    stacks: [
      { disp: 'pokerStack', x: -3.2, z: -2.4, color: 0xd14b4b }, // red
      { disp: 'pokerStack', x: 0, z: -3.0, color: 0x5b8ad6 }, // blue
      { disp: 'pokerStack', x: 3.2, z: -2.4, color: 0x2a2a2a }, // black
    ],
  },
};
export const STARTER_LIST = [
  { id: 'chess', name: 'Chess' },
  { id: 'checkers', name: 'Checkers' },
  { id: 'go', name: 'Go' },
  { id: 'dominoes', name: 'Dominoes' },
  { id: 'wordy', name: 'Wordy McWordface' },
  { id: 'mahjong', name: 'Mahjong' },
  { id: 'poker', name: 'Poker night' },
];
// Per-disc height + capped visible count for a stack — used by BOTH the client mesh
// (clone spacing) and the server collider, so the drawn stack and its body agree.
export const stackDiscH = (item) => (PROPS[item].collider.box[1] || 0.045) * 2;
export const stackVisible = (count) => Math.min(Math.max(1, count | 0), STACK_CAP);

// --- Dice family ------------------------------------------------------------
// Only raw vertices live here; both sides derive shape from them (client:
// ConvexGeometry mesh, server: ConvexPolyhedron collider). d6 stays a pipped box.
const PHI = (1 + Math.sqrt(5)) / 2,
  IPHI = 1 / PHI;
const DIE_RAW = {
  4: [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ], // tetrahedron
  8: [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ], // octahedron
  20: [
    [-1, PHI, 0],
    [1, PHI, 0],
    [-1, -PHI, 0],
    [1, -PHI, 0],
    [0, -1, PHI],
    [0, 1, PHI], // icosahedron
    [0, -1, -PHI],
    [0, 1, -PHI],
    [PHI, 0, -1],
    [PHI, 0, 1],
    [-PHI, 0, -1],
    [-PHI, 0, 1],
  ],
  12: [
    [1, 1, 1],
    [1, 1, -1],
    [1, -1, 1],
    [1, -1, -1],
    [-1, 1, 1],
    [-1, 1, -1],
    [-1, -1, 1],
    [-1, -1, -1], // dodecahedron
    [0, IPHI, PHI],
    [0, IPHI, -PHI],
    [0, -IPHI, PHI],
    [0, -IPHI, -PHI],
    [IPHI, PHI, 0],
    [IPHI, -PHI, 0],
    [-IPHI, PHI, 0],
    [-IPHI, -PHI, 0],
    [PHI, 0, IPHI],
    [PHI, 0, -IPHI],
    [-PHI, 0, IPHI],
    [-PHI, 0, -IPHI],
  ],
  10: (() => {
    const c = Math.cos(Math.PI / 5),
      z0 = 0.115,
      h = (z0 * (c + 1)) / (1 - c); // pentagonal trapezohedron
    const v = [
      [0, 0, h],
      [0, 0, -h],
    ]; // apexes; h keeps kites planar
    for (let i = 0; i < 5; i++) {
      const a = (i * 2 * Math.PI) / 5;
      v.push([Math.cos(a), Math.sin(a), z0]);
      v.push([Math.cos(a + Math.PI / 5), Math.sin(a + Math.PI / 5), -z0]);
    }
    return v;
  })(),
};
// Base per-die sizes, hand-tuned so every die reads as ROUGHLY THE SAME footprint on the
// table. Note the units differ by geometry: d6 is a half-EDGE (the cube is 2× this across),
// the polyhedra are a circumradius (farthest vertex) — so the numbers aren't directly
// comparable, they're matched by eye (see the size-parity render).
export const DIE_RADIUS = { 4: 0.82, 6: 0.46, 8: 0.72, 10: 0.72, 12: 0.7, 20: 0.7 };
// ONE knob for overall dice size: turn this and EVERY die scales together — mesh AND
// collider, d6 included — because both sides build their geometry from dieR() below.
// Lower = smaller. (Colliders are always derived from size, never entered by hand.)
export const DIE_SCALE = 0.82;
// How large the printed numbers are, relative to their face (polyhedral dice only; the d6's
// pipped-box numbers are separate). 1 = the original size; higher = bigger/more legible.
export const DIE_GLYPH = 1.42;
// The size a die is actually built at: its base radius × the global scale. The single source
// both the client mesh and the server collider read, so they can never disagree on size.
export const dieR = (sides) => (DIE_RADIUS[sides] || 1) * DIE_SCALE;
export const DIE_SIDES = [4, 6, 8, 10, 12, 20];

// Clamp a value to a valid 24-bit color int, else null. Used to sanitize a color that
// arrives from a client (a die's body/number color) before it's trusted into piece props.
export const clampColor = (c) => {
  c = Number(c);
  return Number.isInteger(c) && c >= 0 && c <= 0xffffff ? c : null;
};
// Sanitize the props for a spawned die: a valid `sides` (defaulting to d6), plus optional
// body/number colors clamped to real colors. This is what lets a client spawn a die already
// in the player's saved default color without being able to inject arbitrary props.
// Dice finishes (ROADMAP §9): a material look layered on the die color. 'matte' is the default
// (omitted from props). The client UI reads this list; the renderer maps each key to material params.
export const DICE_FINISHES = [
  { key: 'matte', name: 'Matte' },
  { key: 'satin', name: 'Satin' },
  { key: 'glossy', name: 'Glossy' },
  { key: 'metallic', name: 'Metallic' },
  { key: 'brushed', name: 'Brushed' },
  { key: 'pearl', name: 'Pearl' },
  { key: 'translucent', name: 'Translucent' },
  { key: 'glow', name: 'Glow' },
  { key: 'marbled', name: 'Marbled' },
  { key: 'custom', name: 'Custom' }, // needs a finishImg (an uploaded /assets/dice/ texture)
];
export const DICE_FINISH_KEYS = new Set(DICE_FINISHES.map((f) => f.key));
// Finishes whose shaders a low-end mobile GPU (some Android phones) black-screens on — physical
// materials, transparency, extra sampler maps. On a phone the renderer substitutes the safe value
// and the picker hides these; capable devices show the real thing.
export const DICE_FINISH_FALLBACK = { brushed: 'metallic', translucent: 'satin', pearl: 'glossy' };

// Built-in pipped d6 dice — bundled .glb models whose two materials (body `Ivory`, pips `Dots`)
// are tinted by the die's `color` and `textColor`. Physics and value are a normal d6 (unit cube,
// same box collider), so only the mesh differs; carried in `props.model`.
export const DICE_MODELS = {
  'pip-round': { model: '/models/pieces/dice/pip-round.glb', name: 'Rounded Pips' },
  'pip-square': { model: '/models/pieces/dice/pip-square.glb', name: 'Square Pips' },
};
export const DICE_MODEL_KEYS = new Set(Object.keys(DICE_MODELS));

export function dieSpawnProps(raw = {}) {
  const p = { sides: DIE_SIDES.includes(+raw.sides) ? +raw.sides : 6 };
  const b = clampColor(raw.color);
  if (b != null) p.color = b;
  const t = clampColor(raw.textColor);
  if (t != null) p.textColor = t;
  if (
    typeof raw.finish === 'string' &&
    DICE_FINISH_KEYS.has(raw.finish) &&
    raw.finish !== 'matte'
  ) {
    if (raw.finish === 'custom') {
      // 'custom' is only meaningful with an uploaded texture; drop it if the image is missing/bad.
      if (typeof raw.finishImg === 'string' && raw.finishImg.startsWith('/assets/dice/')) {
        p.finish = 'custom';
        p.finishImg = raw.finishImg;
      }
    } else {
      p.finish = raw.finish; // matte is the default look → left out of props
    }
  }
  if (typeof raw.model === 'string' && DICE_MODEL_KEYS.has(raw.model)) {
    p.sides = 6; // pipped models are d6 only
    p.model = raw.model;
    delete p.finish; // a modeled die is coloured by body + pips, not the finish system
    delete p.finishImg;
  }
  return p;
}

// Validate + apply a recolor to a piece's props, by type — the single source both the `recolor`
// message and the `recolorGroup` batch trust. Returns a NEW props object, or null if the change
// doesn't fit this piece (wrong type, missing/out-of-range color, a team bowl without a team flag).
// `dispDef` is the piece's DISPENSERS entry (dispensers only); pass null otherwise.
export function colorProps(
  type,
  props,
  { color, textColor, team, finish, finishImg } = {},
  dispDef = null,
) {
  const out = { ...props };
  if (type === 'die') {
    // dice are unconstrained (any color)
    if (color != null) {
      const c = clampColor(color);
      if (c == null) return null;
      out.color = c;
    }
    if (textColor != null) {
      const t = clampColor(textColor);
      if (t == null) return null;
      out.textColor = t;
    } // die number color
    if (finish != null) {
      if (!DICE_FINISH_KEYS.has(finish)) return null;
      if (finish === 'custom') {
        // custom needs its uploaded texture; without a valid one the change is rejected
        if (typeof finishImg !== 'string' || !finishImg.startsWith('/assets/dice/')) return null;
        out.finish = 'custom';
        out.finishImg = finishImg;
      } else {
        delete out.finishImg; // leaving custom → drop the texture
        if (finish === 'matte') delete out.finish;
        else out.finish = finish;
      }
    }
    return out;
  }
  // Props & dispensers share one rule: the object's allowed palette (recolorPalette) decides
  // whether a swatch sets a fixed team set, must come from a limited palette, or is freeform.
  const opt = recolorPalette(type, props, dispDef);
  if (!opt) return null; // cards, boards, unknown dispensers
  if (opt.team) {
    if (team == null) return null;
    out.team = team ? 1 : 0;
  } // team piece: switch set, not a color
  else {
    if (color == null) return null;
    const c = clampColor(color);
    if (c == null) return null;
    if (!opt.free && !opt.swatches.some((s) => s.hex === c)) return null; // limited palette (coins): color must be in it
    out.color = c;
  }
  return out;
}

// Named dice sets — shipped body-color presets. Applying a set makes it a player's default
// across every die type at once; the swatch row in the die inspector uses the same list to
// quick-color a single die. A set is just a name + body color — the number color is derived
// automatically for legibility (see readableInk), so there's only one value to tune per set.
// Add, remove, or recolor entries freely; the UI reads this list at load.
export const DICE_SETS = [
  { name: 'Ivory', color: 0xf4f1ea }, // the plain default
  { name: 'Bone', color: 0xe8e0cc },
  { name: 'Slate', color: 0x556070 },
  { name: 'Onyx', color: 0x1c1c1e },
  { name: 'Ruby', color: 0x9b1c2e },
  { name: 'Amber', color: 0xc7761f },
  { name: 'Gold', color: 0xc79a3a },
  { name: 'Emerald', color: 0x1f7a4d },
  { name: 'Sapphire', color: 0x1f4e8c },
  { name: 'Amethyst', color: 0x5b3a8c },
  { name: 'Rose', color: 0xc85c8e },
];

// The general color palette shared by the library spawn cards and the recolor/inspect swatches
// (props, dispensers, and multi-select). First entry is Neutral (no tint) — the UI maps it to
// COLORS.neutralProp when a real color is needed. Team pieces use COLORS.team instead.
export const PALETTE = [
  { name: 'Neutral', hex: null },
  { name: 'Red', hex: 0xd14b4b },
  { name: 'Orange', hex: 0xd98a3a },
  { name: 'Yellow', hex: 0xd9c24b },
  { name: 'Green', hex: 0x5fae5f },
  { name: 'Blue', hex: 0x5b8ad6 },
  { name: 'Purple', hex: 0x9a6fc0 },
  { name: 'White', hex: 0xf4f1ea },
  { name: 'Black', hex: 0x2a2a2a },
];
// Named alternate palettes a shape opts into via PROP_LIST / DISPENSERS `swatches` (e.g. coins
// → metals). These REPLACE the general palette for that object — no Neutral, no freeform picker.
export const METALS = [
  { name: 'Gold', hex: 0xd4af37 },
  { name: 'Silver', hex: 0xc0c0c0 },
  { name: 'Copper', hex: 0xb87333 },
  { name: 'Bronze', hex: 0x9c6b3f },
];
export const PALETTES = { metals: METALS };

// What colors an object is ALLOWED in the recolor UI — the same rule the spawn cards use, so an
// object can't be tinted off its intended set. Returns a descriptor, or null for a non-colorable
// piece (cards/boards/decks). `dispDef` is the DISPENSERS entry for a dispenser, else null.
//   { team:true,  free:false, swatches:[{name,hex}×2] } — fixed two-color set (checker/chess/go, go bowl)
//   { team:false, free:false, swatches:[{name,hex}]   } — a limited palette (coins → metals)
//   { team:false, free:true,  swatches: PALETTE        } — general palette + freeform picker
// `team:true` means a swatch sets the piece's team index (0/1), not a freeform color.
const _teamSwatches = (name) =>
  (COLORS.team[name] || []).map((hex, i) => ({ name: 'Set ' + (i + 1), hex }));
export function recolorPalette(type, props = {}, dispDef = null) {
  if (type === 'prop') {
    const spec = PROPS[props.shape] || {};
    if (spec.team) return { team: true, free: false, swatches: _teamSwatches(spec.team) };
    const entry = PROP_LIST.find((e) => e.id === props.shape);
    const alt = entry && entry.swatches ? PALETTES[entry.swatches] : null;
    return alt
      ? { team: false, free: false, swatches: alt }
      : { team: false, free: true, swatches: PALETTE };
  }
  if (type === 'dispenser') {
    if (!dispDef) return null;
    if (dispDef.team) return { team: true, free: false, swatches: _teamSwatches(dispDef.team) };
    const alt = dispDef.swatches ? PALETTES[dispDef.swatches] : null;
    return alt
      ? { team: false, free: false, swatches: alt }
      : { team: false, free: true, swatches: PALETTE };
  }
  return null;
}

// The two number inks a die can wear: near-black for light bodies, off-white for dark ones.
export const DIE_INK = 0x141414,
  DIE_INK_LIGHT = 0xf4f1ea;
const _srgbLin = (c) => {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const _relLum = (color) =>
  0.2126 * _srgbLin((color >> 16) & 255) +
  0.7152 * _srgbLin((color >> 8) & 255) +
  0.0722 * _srgbLin(color & 255);
const _contrast = (a, b) => {
  const la = _relLum(a),
    lb = _relLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
// Pick the number ink (dark or light) that reads best on a given body color — whichever
// yields the higher WCAG contrast ratio. Keeps auto-colored dice legible on any body.
export function readableInk(color) {
  return _contrast(color, DIE_INK) >= _contrast(color, DIE_INK_LIGHT) ? DIE_INK : DIE_INK_LIGHT;
}

// Raw vertices scaled so the farthest sits at `radius`. null for d6/unknown.
export function dieVerts(sides, radius = dieR(sides)) {
  const raw = DIE_RAW[sides];
  if (!raw) return null;
  let max = 0;
  for (const v of raw) max = Math.max(max, Math.hypot(v[0], v[1], v[2]));
  const k = radius / max;
  return raw.map((v) => [v[0] * k, v[1] * k, v[2] * k]);
}

// --- Dice tray --------------------------------------------------------------
// A walled rolling area that rides the same circular track as the whiteboard (angle), one
// gap past the table edge. The geometry lives here so the server (cannon-es floor+walls), the
// client (Three.js mesh), and the tests all build the SAME box from one source — the tray can
// never look one size and collide at another. Everything in world units.
export const TRAY = {
  hx: 4.5,
  hz: 3.3, // floor half-extents (X across the track, Z radial) — a roomy roll area
  wall: 1.65, // wall half-height (base at y=0, so walls stand 2×this tall); the lid caps the wall tops, so this sets the roll headroom
  thick: 0.0625, // wall half-thickness (thin rails)
  floorThick: 0.0625, // floor half-height (its TOP sits at y=0, level with the table surface)
  lid: 0.3, // half-thickness of an INVISIBLE ceiling that caps the box so nothing bounces out
  margin: 15, // gap between the table edge and the track the tray centre rides
};
// Each seat's angle on the track, derived from its outward direction in seatLayoutFor()
// (θ = atan2(outX, outZ), matching the track's (sin, cos) convention). A personal tray sits
// on the track at its owner's seat angle — i.e. directly behind that player.
export const SEAT_ANGLES = [
  0,
  Math.PI,
  Math.PI / 2,
  -Math.PI / 2,
  Math.PI / 4,
  (-3 * Math.PI) / 4,
  -Math.PI / 4,
  (3 * Math.PI) / 4,
];
export const seatAngle = (seat) => SEAT_ANGLES[seat] ?? 0;

// The set of table shapes; 'rect' is the historical default. Interpreted against tableX/tableZ.
export const TABLE_SHAPES = ['rect', 'round', 'oval', 'hex', 'roundedRect'];
// Wooden-rim textures (public/textures/wood-*.jpg); 'mahogany' is the default.
export const RIM_WOODS = ['mahogany', 'walnut', 'birch', 'green'];

// The table's outline as a closed polygon of {x,z} perimeter points, for a shape + half-extents.
// One source of truth for the three consumers that must agree: the physics wall ring (one box
// per edge), the surface mesh (extruded outline), and the grid clip. 'rect' returns its four
// corners; 'round'/'oval' sample the (elliptical) rim; 'hex' is a flat-top hexagon (flat edges
// facing ±Z, the near/far seats) sized to hx; 'roundedRect' is straight edges plus sampled corner
// arcs. 'round' and 'hex' use hx and ignore hz (the UI locks depth to width for them).
export function tableOutline(shape, hx, hz) {
  if (shape === 'round' || shape === 'oval') {
    const a = hx,
      b = shape === 'round' ? hx : hz;
    const n = Math.max(24, Math.min(96, Math.round((Math.PI * (a + b)) / 0.8))); // ~0.8u segments
    const pts = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      pts.push({ x: Math.cos(t) * a, z: Math.sin(t) * b });
    }
    return pts;
  }
  if (shape === 'hex') {
    const r = hx,
      pts = [];
    for (let i = 0; i < 6; i++) {
      const t = (i * Math.PI) / 3; // vertices at 0,60,…,300 → flat edges facing ±Z
      pts.push({ x: Math.cos(t) * r, z: Math.sin(t) * r });
    }
    return pts;
  }
  if (shape === 'roundedRect') {
    const r = Math.min(hx, hz) * 0.2, // corner radius
      per = 4, // segments per 90° corner arc
      pts = [];
    const corners = [
      { cx: hx - r, cz: hz - r, a0: 0 },
      { cx: -(hx - r), cz: hz - r, a0: Math.PI / 2 },
      { cx: -(hx - r), cz: -(hz - r), a0: Math.PI },
      { cx: hx - r, cz: -(hz - r), a0: (3 * Math.PI) / 2 },
    ];
    for (const c of corners)
      for (let i = 0; i <= per; i++) {
        const t = c.a0 + (i / per) * (Math.PI / 2);
        pts.push({ x: c.cx + Math.cos(t) * r, z: c.cz + Math.sin(t) * r });
      }
    return pts;
  }
  // rect (default): four corners
  return [
    { x: hx, z: hz },
    { x: -hx, z: hz },
    { x: -hx, z: -hz },
    { x: hx, z: -hz },
  ];
}

// Offset a convex, origin-centred outline by a constant width — outward (w>0) or inward (w<0) —
// with a mitre at each vertex. Used for the table's wooden rim (an outer ring, plus a slight
// inward overlap onto the felt). Every table shape is convex and contains the origin, which is
// what lets \"outward\" be read off each vertex.
export function offsetOutline(outline, w) {
  const n = outline.length,
    out = [];
  const unit = (dx, dz) => {
    const l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l };
  };
  const outward = (e, p) => {
    let nx = e.z,
      nz = -e.x; // a perpendicular to the edge
    if (nx * p.x + nz * p.z < 0) {
      nx = -nx;
      nz = -nz;
    } // face away from the origin
    return { x: nx, z: nz };
  };
  for (let i = 0; i < n; i++) {
    const prev = outline[(i - 1 + n) % n],
      cur = outline[i],
      next = outline[(i + 1) % n];
    const n1 = outward(unit(cur.x - prev.x, cur.z - prev.z), cur);
    const n2 = outward(unit(next.x - cur.x, next.z - cur.z), cur);
    let mx = n1.x + n2.x,
      mz = n1.z + n2.z;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
    const cos = Math.max(mx * n1.x + mz * n1.z, 0.2); // clamp the mitre at sharp corners
    const s = w / cos;
    out.push({ x: cur.x + mx * s, z: cur.z + mz * s });
  }
  return out;
}

// The tray's centre on the track, for a given angle and table size. Same radius formula as the
// whiteboard (max half-extent + a margin), so the tray hugs the table edge at any table size.
export function trayCenter(angle, tableX, tableZ, T = TRAY) {
  const R = Math.max(tableX, tableZ) + T.margin;
  return { x: Math.sin(angle) * R, z: Math.cos(angle) * R };
}
// The five boxes that make a tray — floor + four walls — as LOCAL specs { hx, hy, hz, x, y, z }
// (tray-local: centred at origin, floor top at y=0, unrotated). Callers translate to trayCenter
// and rotate by `angle` about Y so a rectangular tray sits tangent to the track.
export function trayParts(T = TRAY) {
  const t = T.thick,
    wy = T.wall,
    top = 2 * wy,
    lid = T.lid;
  return [
    { hx: T.hx, hy: T.floorThick, hz: T.hz, x: 0, y: -T.floorThick, z: 0 }, // floor
    { hx: T.hx + t, hy: wy, hz: t, x: 0, y: wy, z: -(T.hz + t) }, // near
    { hx: T.hx + t, hy: wy, hz: t, x: 0, y: wy, z: T.hz + t }, // far
    { hx: t, hy: wy, hz: T.hz + t, x: -(T.hx + t), y: wy, z: 0 }, // left
    { hx: t, hy: wy, hz: T.hz + t, x: T.hx + t, y: wy, z: 0 }, // right
    { hx: T.hx + t, hy: lid, hz: T.hz + t, x: 0, y: top + lid, z: 0, noMesh: true }, // invisible lid (physics only) — bottom flush with the wall tops
  ];
}
// Rotate a local (x,z) by `angle` about Y and offset to a centre — the transform both the
// physics bodies and the render meshes apply so they land in the same place.
export function trayPlace(local, center, angle) {
  const s = Math.sin(angle),
    c = Math.cos(angle);
  return {
    x: center.x + local.x * c + local.z * s,
    y: local.y,
    z: center.z - local.x * s + local.z * c,
  };
}
// Is a world point inside the tray's footprint (+ a slack margin)? Used by the out-of-bounds
// net to contain tray dice in the tray instead of yanking them back to the table.
export function inTray(x, z, center, angle, slack = 0, T = TRAY) {
  const dx = x - center.x,
    dz = z - center.z;
  const s = Math.sin(angle),
    c = Math.cos(angle);
  const lx = dx * c - dz * s,
    lz = dx * s + dz * c; // world → tray-local (inverse of trayPlace)
  return Math.abs(lx) <= T.hx + T.thick + slack && Math.abs(lz) <= T.hz + T.thick + slack;
}
// The shared timer's live value in ms, computed from its synced anchor (used by
// both the server and every client, so the number never has to be synced tick by
// tick). base = ms frozen at the last pause; since = start timestamp (0 = paused).
export function timerLive(t, now) {
  if (!t.running) return t.base;
  const elapsed = now - t.since;
  return t.mode === 'down' ? Math.max(0, t.base - elapsed) : t.base + elapsed;
}

// --- Measurement: a raw world distance → the label a ruler shows -------------
// A DISPLAY layer over the FIXED world scale (see RoomScale). Pure, and shared by
// both sides so a measurement reads identically on every screen — the same instinct
// as timerLive above. Rounding is display-only; callers keep the exact geometry.

// Decimal places implied by a round step (a *size*, not a digit count): 0.5 → 1,
// 0.25 → 2, 1 → 0. Capped at 4. Steps are clamped to 0.001–100, so String() never
// hits scientific notation.
function decimalsForStep(step) {
  if (!(step > 0)) return 0;
  const s = String(step),
    dot = s.indexOf('.');
  return dot < 0 ? 0 : Math.min(4, s.length - dot - 1);
}

// Round a value to the nearest multiple of step (step ≤ 0 → unchanged). A step is a
// size, so "nearest 0.5" works where a decimal-places count can't. The toFixed pass
// clears binary-float dust (e.g. 5.4000000000000004 → 5.4).
export function roundToStep(value, step) {
  if (!(step > 0) || !Number.isFinite(value)) return value;
  return +(Math.round(value / step) * step).toFixed(decimalsForStep(step));
}

// --- Grid & snap-to-grid ------------------------------------------------------
// A table-wide grid carried on the room's scale: `cellWorld` is the cell size in
// world units and `gridStyle` is 'off' | 'square' | 'hex'. The grid is anchored at
// world origin (0,0) with LINES on integer multiples of the cell (so a line runs
// through the table centre) and cell CENTRES on the half-offsets between them.
// These are pure and shared, so the client's snap preview and the server's
// authoritative placement always agree (the classic snap bug is quantising twice).

// Is there a grid to draw / snap to? (style 'off' or a zero cell size = none.)
export function gridActive(scale = {}) {
  return !!scale && scale.gridStyle !== 'off' && +scale.cellWorld > 0;
}

// Round fractional axial hex coords (q, r) to the nearest hex centre, via cube
// rounding (the coordinate with the largest rounding error is recomputed from the
// other two so the cube constraint x+y+z=0 always holds).
function hexRound(q, r) {
  const x = q,
    z = r,
    y = -x - z;
  let rx = Math.round(x),
    rz = Math.round(z);
  const ry = Math.round(y);
  const dx = Math.abs(rx - x),
    dy = Math.abs(ry - y),
    dz = Math.abs(rz - z);
  // Recompute the coord with the largest rounding error from the other two. Only q (rx)
  // and r (rz) are returned, so when y carries the largest error, rx/rz already stand.
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dz >= dy) rz = -rx - ry;
  return { q: rx, r: rz };
}

// Snap an XZ point (already offset-relative) to the nearest hex CENTRE for a hex
// grid whose size `s` is the centre-to-vertex circumradius (= cellWorld, matching
// the hex TILE convention). `flat` = flat-top; default is pointy-top (points at
// ±Z, like the hex tiles). Pixel↔axial per the standard hex layout, so the
// centres tile the plane with no gaps or overlaps.
function snapToHexCentre(x, z, s, flat) {
  const S3 = 2 * HEX_HH, // √3
    T3 = (2 / 3) * HEX_HH; // √3/3
  let q, r;
  if (flat) {
    q = ((2 / 3) * x) / s;
    r = (-(1 / 3) * x + T3 * z) / s;
  } else {
    q = (T3 * x - (1 / 3) * z) / s;
    r = ((2 / 3) * z) / s;
  }
  const h = hexRound(q, r);
  if (flat) return { x: s * ((3 / 2) * h.q), z: s * (HEX_HH * h.q + S3 * h.r) };
  return { x: s * (S3 * h.q + HEX_HH * h.r), z: s * ((3 / 2) * h.r) };
}

// Snap a world XZ point to the nearest cell CENTRE, returning a new { x, z }.
// Handles 'square' (rectangular cells; 'center' or 'cross' anchor) and 'hex'
// (centres only, pointy- or flat-top per hexOrient). 'off' or a zero cell size
// returns the point unchanged, so a drop can always be routed through this safely.
// Uses exact rounding (not roundToStep's display rounding), so any cell size lands
// on true multiples with no float truncation.
export function snapToCell(x, z, scale = {}) {
  const cx = +scale.cellWorld;
  if (!(cx > 0)) return { x, z };
  const ox = +scale.gridX || 0,
    oz = +scale.gridZ || 0; // lattice offset — align to a printed map's phase
  if (scale.gridStyle === 'hex') {
    const c = snapToHexCentre(x - ox, z - oz, cx, scale.hexOrient === 'flat');
    return { x: c.x + ox, z: c.z + oz };
  }
  if (scale.gridStyle !== 'square') return { x, z };
  const cz = +scale.cellZ > 0 ? +scale.cellZ : cx; // rectangular grids (e.g. a go board) have cz ≠ cx
  // 'cross' snaps to the line intersections (go stones sit on crossings); the default
  // 'center' snaps to mid-cell (chess/checkers pieces sit in the squares).
  const cross = scale.snapAnchor === 'cross';
  const snap = (v, cell, o) => {
    const h = cross ? 0 : cell / 2;
    return Math.round((v - o - h) / cell) * cell + h + o;
  };
  return { x: snap(x, cx, ox), z: snap(z, cz, oz) };
}

// A world distance as a display string: worldDist ÷ worldPerUnit → round to
// roundStep → append unitLabel, e.g. "5.5 in". `scale` is a RoomScale (or any
// {worldPerUnit, roundStep, unitLabel}); a missing/invalid scale falls back to raw
// world units. Consistent decimals (from the step) so labels don't jitter in width.
export function formatMeasure(worldDist, scale = {}) {
  const per = +scale.worldPerUnit > 0 ? +scale.worldPerUnit : 1;
  const step = +scale.roundStep > 0 ? +scale.roundStep : 0.1;
  const label = scale.unitLabel || 'u';
  const units = roundToStep((+worldDist || 0) / per, step);
  return units.toFixed(decimalsForStep(step)) + ' ' + label;
}

// --- Overlays (measurement + templates): flat, non-physics annotations -------
// Shared knobs for the overlay layer (see the OVERLAY registry in graphics.js).
// Kept here so server validation and client rendering agree on the same limits.
export const MEASURE = {
  lift: 0.05, // height above the felt to draw an overlay (avoid z-fighting)
  labelLift: 0.6, // height of a ruler's floating distance label
  minDrag: 0.2, // min world length for a placement to count (shorter = ignored)
  maxLen: 80, // clamp on any overlay coordinate/dimension (world units)
  coneAngle: Math.PI / 6, // default cone half-angle (the sector template's spread)
  lineWidth: 1, // default width of a "line" (lane) template, in world units
};
