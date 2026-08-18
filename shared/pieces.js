// =============================================================================
// SINGLE SOURCE OF TRUTH  —  every piece dimension, mass, colour and proportion.
// Imported by BOTH the server (to build cannon-es colliders) and the client (to
// build Three.js meshes). Keeping it all here is what stops the physics body and
// the rendered mesh from drifting apart, and keeps magic numbers out of the code.
// =============================================================================

// --- Table ------------------------------------------------------------------
export const TABLE = { x: 10, z: 7 };            // half-extents of the play surface

// --- Colours ----------------------------------------------------------------
// Values are hex ints (Three.js materials) or CSS strings (canvas textures);
// Three.Color accepts either, so the ivory/ink strings work in both places.
export const COLORS = {
  neutralProp: 0x9aa0a6,                          // default colour for neutral props
  cardSide:    0xffffff,                          // card edges
  deckEdge:    0xf2efe6,                          // deck paper edge
  boardEdge:   0x2a2a2a,                          // board rim
  felt:        ['#3a3a3a', '#d9c7a0'],            // board checker squares [dark, light]
  ivory:       '#f4f1ea',                         // blank die faces
  ink:         '#141414',                         // die numbers
  team: {                                         // fixed two-colour game sets [color0, color1]
    checker: [0xb03030, 0x2a2a2a],                // red / black
    go:      [0x111111, 0xf0f0f0],                // black / white
    chess:   [0xe8e0d0, 0x2a2a2a],                // ivory / black
  },
};

// --- Kinds (physics half) ---------------------------------------------------
// mass + collider `shape`: 'die' (polyhedron from props.sides), 'prop' (per-shape
// data in PROPS below), or { box:[hx,hy,hz] }. mass 0 = static/not grabbable.
export const KINDS = {
  die:   { mass: 1,    shape: 'die' },
  card:  { mass: 0.02, shape: { box: [0.75, 0.015, 1.05] } },
  prop:  { mass: 0.5,  shape: 'prop' },
  deck:  { mass: 0.5,  shape: { box: [0.78, 0.04, 1.08] } }, // thin puck; grows via updateDeckCollider
  board: { mass: 0,    shape: { box: [4.00, 0.05, 4.00] } },
};

// --- Deck -------------------------------------------------------------------
export const DECK_VISUAL = [1.56, 0.06, 2.16];   // unit stack box; y scaled by deckHeight(count)
export const CARD_ROUND = 0.08;                  // card & deck corner radius, as a fraction of card width (0 = square)
// Deck stack height from card count — used by BOTH the client visual and the
// server collider, so a flipped deck has a solid body where it's drawn.
export const deckHeight = c => Math.max(0.06, Math.min(1.2, c * 0.02));

// --- Props ------------------------------------------------------------------
// Each preset: mass, a coarse proxy `collider` (box or sphere), a `render`
// descriptor the client dispatches on, and optional `team` (which COLORS.team
// palette to use; absent = neutral, uses the picked colour).
// render.prim: box | sphere | cone | cyl | lens. (glb-model props use `model` instead.)
export const PROPS = {
  box:             { mass: 0.6, collider: { box: [0.5, 0.5, 0.5] },                             render: { prim: 'box', size: [1, 1, 1] } },
  pyramid:         { mass: 0.6, collider: { box: [0.55, 0.5, 0.55] },                           render: { prim: 'cone', r: 0.72, h: 1, seg: 4 } },
  sphere:          { mass: 0.6, collider: { box: [0.5, 0.5, 0.5], type: 'sphere' },             render: { prim: 'sphere', r: 0.5 } },
  cuboid:          { mass: 0.6, collider: { box: [0.7, 0.4, 0.5] },                             render: { prim: 'box', size: [1.4, 0.8, 1.0] } },
  cone:            { mass: 0.6, collider: { box: [0.6, 0.5, 0.6], type: 'cone' },               render: { prim: 'cone', r: 0.6, h: 1 } },
  cylinder:        { mass: 0.6, collider: { box: [0.45, 0.5, 0.45], type: 'cylinder' },         render: { prim: 'cyl', r: 0.45, h: 1 } },
  frustum:         { mass: 0.6, collider: { box: [0.5, 0.5, 0.5], type: 'cylinder', top: 0.5 }, render: { prim: 'cyl', r: 0.5, rTop: 0.25, h: 1 } },
  hex_prism:       { mass: 0.6, collider: { box: [0.5, 0.5, 0.5], type: 'cylinder', sides: 6 }, render: { prim: 'cyl', r: 0.5, h: 1, seg: 6 } },
  tri_prism:       { mass: 0.6, collider: { box: [0.5, 0.5, 0.5], type: 'cylinder', sides: 3 }, render: { prim: 'cyl', r: 0.5, h: 1, seg: 3 } },
  hex_pyramid:     { mass: 0.6, collider: { box: [0.6, 0.5, 0.6], type: 'cone', sides: 6 },     render: { prim: 'cone', r: 0.6, h: 1, seg: 6 } },
  checker:         { mass: 0.6, collider: { box: [0.3, 0.05, 0.3], type: 'cylinder' },          render: { prim: 'cyl', r: 0.3, h: 0.1 }, team: 'checker', stand: 'flat'},
  crowned_checker: { mass: 0.6, collider: { box: [0.3, 0.1,  0.3], type: 'cylinder' },          render: { prim: 'cyl', r: 0.3, h: 0.2 }, team: 'checker', stand: 'flat'},
  // Bundled .glb models (public/models/pieces). worldSizes differ wildly, so each has its own modelScale.
  coin:           { mass: 0.3, collider: { box: [0.21, 0.021, 0.21], type: 'cylinder' }, model: '/models/pieces/misc/coin.glb', modelScale: 0.3, ownMaterial: false }, // rotated flat; keeps its own look
  poker_chip:     { mass: 0.25, collider: { box: [0.45, 0.045, 0.45] }, model: '/models/pieces/misc/poker_chip.glb', modelScale: 0.18, tintMaterial: 'c1' }, // colour picker tints only the body; white rim kept
  token:          { mass: 0.4, collider: { box: [0.17, 0.50, 0.17] }, model: '/models/pieces/misc/token.glb', modelScale: 0.84, stand: true }, //Generic token to represent a player, for use in various games.
  go:             { mass: 0.2, collider: { box: [0.15, 0.075, 0.15], type: 'flat' }, render: { prim: 'lens', r: 0.2, sy: 0.375 }, team: 'go', stand: 'flat' }, // ~0.4 wide, fits the go board grid
  // Chess pieces are bundled .glb models (public/models/pieces/chess), CC0 by rehcub.
  // Models carry a baked 0.1 node scale, so their true loaded height is ~0.66 (king); modelScale 2.124
  // brings the king to ~1.4 tall. One uniform scale keeps relative heights; colliders are precomputed.
  'chess-pawn':   { mass: 0.4, collider: { box: [0.28, 0.50, 0.24] }, model: '/models/pieces/chess/pawn.glb',   modelScale: 2.124, team: 'chess', stand: true },
  'chess-rook':   { mass: 0.5, collider: { box: [0.31, 0.59, 0.27] }, model: '/models/pieces/chess/rook.glb',   modelScale: 2.124, team: 'chess', stand: true },
  'chess-knight': { mass: 0.5, collider: { box: [0.32, 0.54, 0.36] }, model: '/models/pieces/chess/knight.glb', modelScale: 2.124, team: 'chess', stand: true },
  'chess-bishop': { mass: 0.5, collider: { box: [0.31, 0.64, 0.27] }, model: '/models/pieces/chess/bishop.glb', modelScale: 2.124, team: 'chess', stand: true },
  'chess-queen':  { mass: 0.6, collider: { box: [0.31, 0.70, 0.27] }, model: '/models/pieces/chess/queen.glb',  modelScale: 2.124, team: 'chess', stand: true },
  'chess-king':   { mass: 0.6, collider: { box: [0.31, 0.70, 0.27] }, model: '/models/pieces/chess/king.glb',   modelScale: 2.124, team: 'chess', stand: true },
};
// Ordered list for the spawn UI. team:true = fixed two-colour set; else colour picker.
export const PROP_LIST = [
  { id: 'box', name: 'Box' }, { id: 'pyramid', name: 'Pyramid' }, { id: 'sphere', name: 'Sphere' },
  { id: 'cuboid', name: 'Cuboid' }, { id: 'cone', name: 'Cone' }, { id: 'cylinder', name: 'Cylinder' },
  { id: 'frustum', name: 'Truncated cone' }, { id: 'hex_prism', name: 'Hex prism' },
  { id: 'tri_prism', name: 'Triangular prism' }, { id: 'hex_pyramid', name: 'Hex pyramid' },
  { id: 'coin', name: 'Coin', swatches: 'metals' }, { id: 'poker_chip', name: 'Poker chip' }, { id: 'token', name: 'Token' },
  { id: 'checker', name: 'Checker', team: true }, { id: 'crowned_checker', name: 'Checker - Crowned', team: true }, { id: 'go', name: 'Go stone', team: true },
  { id: 'chess-pawn', name: 'Chess · Pawn', team: true }, { id: 'chess-rook', name: 'Chess · Rook', team: true },
  { id: 'chess-knight', name: 'Chess · Knight', team: true }, { id: 'chess-bishop', name: 'Chess · Bishop', team: true },
  { id: 'chess-queen', name: 'Chess · Queen', team: true }, { id: 'chess-king', name: 'Chess · King', team: true },
];
// Built-in board models (public/models/boards), CC0. Modeled ~0.43 units, so a
// large modelScale fills the table; colliders precomputed (worldSize*scale/2).
// box[1] (half-thickness) also sets how high the board sits so it rests on the table.
export const BOARDS = {
  chess: { name: 'Chess / Checkers', model: '/models/boards/checker_chess_board.glb', modelScale: 18.7, box: [4.00, 0.22, 4.00] },
  go:    { name: 'Go',               model: '/models/boards/go_board.glb',           modelScale: 18.9, box: [4.01, 0.14, 4.29] },
};
export const BOARD_SIZE = 8; // uploaded .glb boards are normalized so their largest footprint dimension is this wide

// --- Dice family ------------------------------------------------------------
// Only raw vertices live here; both sides derive shape from them (client:
// ConvexGeometry mesh, server: ConvexPolyhedron collider). d6 stays a pipped box.
const PHI = (1 + Math.sqrt(5)) / 2, IPHI = 1 / PHI;
const DIE_RAW = {
  4:  [[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]],                                   // tetrahedron
  8:  [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]],                      // octahedron
  20: [[-1,PHI,0],[1,PHI,0],[-1,-PHI,0],[1,-PHI,0],[0,-1,PHI],[0,1,PHI],         // icosahedron
       [0,-1,-PHI],[0,1,-PHI],[PHI,0,-1],[PHI,0,1],[-PHI,0,-1],[-PHI,0,1]],
  12: [[1,1,1],[1,1,-1],[1,-1,1],[1,-1,-1],[-1,1,1],[-1,1,-1],[-1,-1,1],[-1,-1,-1], // dodecahedron
       [0,IPHI,PHI],[0,IPHI,-PHI],[0,-IPHI,PHI],[0,-IPHI,-PHI],
       [IPHI,PHI,0],[IPHI,-PHI,0],[-IPHI,PHI,0],[-IPHI,-PHI,0],
       [PHI,0,IPHI],[PHI,0,-IPHI],[-PHI,0,IPHI],[-PHI,0,-IPHI]],
  10: (() => { const c = Math.cos(Math.PI/5), z0 = 0.115, h = z0*(c+1)/(1-c);  // pentagonal trapezohedron
    const v = [[0,0,h],[0,0,-h]];                                              // apexes; h keeps kites planar
    for (let i = 0; i < 5; i++) { const a = i*2*Math.PI/5;
      v.push([Math.cos(a), Math.sin(a), z0]); v.push([Math.cos(a+Math.PI/5), Math.sin(a+Math.PI/5), -z0]); }
    return v; })(),
};
export const DIE_RADIUS = { 4: 0.84, 6: 0.6, 8: 0.8, 10: 0.8, 12: 0.76, 20: 0.76 }; // 20% smaller
export const DIE_SIDES = [4, 6, 8, 10, 12, 20];

// Raw vertices scaled so the farthest sits at `radius`. null for d6/unknown.
export function dieVerts(sides, radius = DIE_RADIUS[sides] || 1) {
  const raw = DIE_RAW[sides]; if (!raw) return null;
  let max = 0; for (const v of raw) max = Math.max(max, Math.hypot(v[0], v[1], v[2]));
  const k = radius / max;
  return raw.map(v => [v[0]*k, v[1]*k, v[2]*k]);
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
  const s = String(step), dot = s.indexOf('.');
  return dot < 0 ? 0 : Math.min(4, s.length - dot - 1);
}

// Round a value to the nearest multiple of step (step ≤ 0 → unchanged). A step is a
// size, so "nearest 0.5" works where a decimal-places count can't. The toFixed pass
// clears binary-float dust (e.g. 5.4000000000000004 → 5.4).
export function roundToStep(value, step) {
  if (!(step > 0) || !Number.isFinite(value)) return value;
  return +(Math.round(value / step) * step).toFixed(decimalsForStep(step));
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
  lift: 0.05,             // height above the felt to draw an overlay (avoid z-fighting)
  labelLift: 0.6,         // height of a ruler's floating distance label
  minDrag: 0.2,           // min world length for a placement to count (shorter = ignored)
  maxLen: 80,             // clamp on any overlay coordinate/dimension (world units)
  coneAngle: Math.PI / 6, // default cone half-angle (used from Step 4)
};
