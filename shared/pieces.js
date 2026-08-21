// =============================================================================
// SINGLE SOURCE OF TRUTH  —  every piece dimension, mass, color and proportion.
// Imported by BOTH the server (to build cannon-es colliders) and the client (to
// build Three.js meshes). Keeping it all here is what stops the physics body and
// the rendered mesh from drifting apart, and keeps magic numbers out of the code.
// =============================================================================

// --- Table ------------------------------------------------------------------
export const TABLE = { x: 10, z: 7 };            // half-extents of the play surface

// --- Colors ----------------------------------------------------------------
// Values are hex ints (Three.js materials) or CSS strings (canvas textures);
// Three.Color accepts either, so the ivory/ink strings work in both places.
export const COLORS = {
  neutralProp: 0x9aa0a6,                          // default color for neutral props
  cardSide:    0xffffff,                          // card edges
  deckEdge:    0xf2efe6,                          // deck paper edge
  boardEdge:   0x2a2a2a,                          // board rim
  felt:        ['#3a3a3a', '#d9c7a0'],            // board checker squares [dark, light]
  ivory:       '#f4f1ea',                         // blank die faces
  ink:         '#141414',                         // die numbers
  team: {                                         // fixed two-color game sets [color0, color1]
    checker: [0xb03030, 0x2a2a2a],                // red / black
    go:      [0x111111, 0xf0f0f0],                // black / white
    chess:   [0xe8e0d0, 0x2a2a2a],                // ivory / black
  },
};

// --- Kinds (physics half) ---------------------------------------------------
// mass + collider `shape`: 'die' (polyhedron from props.sides), 'prop' (per-shape
// data in PROPS below), or { box:[hx,hy,hz] }. mass 0 = static/not grabbable.
export const KINDS = {
  die:       { mass: 1,    shape: 'die' },
  card:      { mass: 0.02, shape: { box: [0.75, 0.015, 1.05] } },
  prop:      { mass: 0.5,  shape: 'prop' },
  deck:      { mass: 0.5,  shape: { box: [0.78, 0.04, 1.08] } }, // thin puck; grows via updateDeckCollider
  board:     { mass: 0,    shape: { box: [4.00, 0.05, 4.00] } },
  dispenser: { mass: 0.5,  shape: 'dispenser' }, // hands out copies of a child piece; collider from DISPENSERS
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
// palette to use; absent = neutral, uses the picked color).
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
  poker_chip:     { mass: 0.25, collider: { box: [0.45, 0.045, 0.45] }, model: '/models/pieces/misc/poker_chip.glb', modelScale: 0.18, tintMaterial: 'c1' }, // color picker tints only the body; white rim kept
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
// Ordered list for the spawn UI. team:true = fixed two-color set; else color picker.
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
// `grid` drives "calibrate grid to this board": `cells` across the playing area, and
// whether pieces sit in cell `center`s (chess/checkers squares) or on `cross`ings (go
// stones). Boards spawn centred at the world origin, which is where our grid is anchored,
// so no offset is needed — only the cell size (estimated from the footprint, GM-tunable)
// and the snap anchor.
export const BOARDS = {
  chess: { name: 'Chess / Checkers', model: '/models/boards/checker_chess_board.glb', modelScale: 1, box: [4.00, 0.15, 4.00], grid: { cells: 8,  anchor: 'center' } },
  go:    { name: 'Go',               model: '/models/boards/go_board.glb',           modelScale: 18.9, box: [4.01, 0.14, 4.29], grid: { cells: 18, anchor: 'cross'  } },
};
export const BOARD_SIZE = 8; // uploaded .glb boards are normalized so their largest footprint dimension is this wide

// --- Dispensers -------------------------------------------------------------
// A dispenser hands out copies of a child piece: left-click / left-drag spawns ONE
// item (a drag carries it out, like dealing a card); right-drag (grab:2) moves it.
// Built-in only; all config rides in the piece's props + count (no DB change). The
// dispensed item is an existing PROP. body: 'stack' = the item's .glb cloned N high
// (poker chips / coins); 'model' = a bundled bowl .glb (go bowl).
export const STACK_CAP = 18; // max discs DRAWN in a stack; the real count can exceed this (visual tops out)
export const DISPENSERS = {
  pokerStack: { name: 'Poker chips', body: 'stack', item: 'poker_chip', color: true,
                count: { def: 20, max: 100 }, mass: 0.5 },
  coinStack:  { name: 'Coins',       body: 'stack', item: 'coin', color: true, swatches: 'metals',
                count: { def: 20, max: 100 }, mass: 0.5 },
  // Go bowl: infinite, team-colored (interior stones + fill = black/white; the bowl
  // shell keeps its baked look). The .glb is normalised to MODEL_SIZE like an uploaded
  // model (modelScale multiplies that target); collider = the resulting half-extents.
  goBowl:     { name: 'Go bowl', body: 'model', item: 'go', team: 'go', infinite: true,
                model: '/models/pieces/misc/gobowl.glb', modelScale: 1, tintMaterial: 'c1',
                collider: { box: [0.8, 0.5, 0.8] }, mass: 0.5 },
};
export const DISPENSER_LIST = [{ id: 'pokerStack' }, { id: 'coinStack' }, { id: 'goBowl' }];
// Per-disc height + capped visible count for a stack — used by BOTH the client mesh
// (clone spacing) and the server collider, so the drawn stack and its body agree.
export const stackDiscH  = (item) => (PROPS[item].collider.box[1] || 0.045) * 2;
export const stackVisible = (count) => Math.min(Math.max(1, count | 0), STACK_CAP);

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

// Raw vertices scaled so the farthest sits at `radius`. null for d6/unknown.
export function dieVerts(sides, radius = dieR(sides)) {
  const raw = DIE_RAW[sides]; if (!raw) return null;
  let max = 0; for (const v of raw) max = Math.max(max, Math.hypot(v[0], v[1], v[2]));
  const k = radius / max;
  return raw.map(v => [v[0]*k, v[1]*k, v[2]*k]);
}

// --- Dice tray --------------------------------------------------------------
// A walled rolling area that rides the same circular track as the whiteboard (angle), one
// gap past the table edge. The geometry lives here so the server (cannon-es floor+walls), the
// client (Three.js mesh), and the tests all build the SAME box from one source — the tray can
// never look one size and collide at another. Everything in world units.
export const TRAY = {
  hx: 4.5, hz: 3.3,    // floor half-extents (X across the track, Z radial) — a roomy roll area
  wall: 1.65,          // wall half-height (base at y=0, so walls stand 2×this tall); the lid caps the wall tops, so this sets the roll headroom
  thick: 0.0625,       // wall half-thickness (thin rails)
  floorThick: 0.0625,    // floor half-height (its TOP sits at y=0, level with the table surface)
  lid: 0.3,            // half-thickness of an INVISIBLE ceiling that caps the box so nothing bounces out
  margin: 15,           // gap between the table edge and the track the tray centre rides
};
// Each seat's angle on the track, derived from its outward direction in seatLayoutFor()
// (θ = atan2(outX, outZ), matching the track's (sin, cos) convention). A personal tray sits
// on the track at its owner's seat angle — i.e. directly behind that player.
export const SEAT_ANGLES = [0, Math.PI, Math.PI / 2, -Math.PI / 2, Math.PI / 4, -3 * Math.PI / 4];
export const seatAngle = (seat) => SEAT_ANGLES[seat] ?? 0;

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
  const t = T.thick, wy = T.wall, top = 2 * wy, lid = T.lid;
  return [
    { hx: T.hx,     hy: T.floorThick, hz: T.hz,     x: 0,            y: -T.floorThick, z: 0 },            // floor
    { hx: T.hx + t, hy: wy,           hz: t,        x: 0,            y: wy,            z: -(T.hz + t) },   // near
    { hx: T.hx + t, hy: wy,           hz: t,        x: 0,            y: wy,            z:  (T.hz + t) },   // far
    { hx: t,        hy: wy,           hz: T.hz + t, x: -(T.hx + t),  y: wy,            z: 0 },             // left
    { hx: t,        hy: wy,           hz: T.hz + t, x:  (T.hx + t),  y: wy,            z: 0 },             // right
    { hx: T.hx + t, hy: lid,          hz: T.hz + t, x: 0,            y: top + lid,     z: 0, noMesh: true }, // invisible lid (physics only) — bottom flush with the wall tops
  ];
}
// Rotate a local (x,z) by `angle` about Y and offset to a centre — the transform both the
// physics bodies and the render meshes apply so they land in the same place.
export function trayPlace(local, center, angle) {
  const s = Math.sin(angle), c = Math.cos(angle);
  return { x: center.x + local.x * c + local.z * s, y: local.y, z: center.z - local.x * s + local.z * c };
}
// Is a world point inside the tray's footprint (+ a slack margin)? Used by the out-of-bounds
// net to contain tray dice in the tray instead of yanking them back to the table.
export function inTray(x, z, center, angle, slack = 0, T = TRAY) {
  const dx = x - center.x, dz = z - center.z;
  const s = Math.sin(angle), c = Math.cos(angle);
  const lx = dx * c - dz * s, lz = dx * s + dz * c; // world → tray-local (inverse of trayPlace)
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

// Snap a world XZ point to the nearest cell CENTRE, returning a new { x, z }.
// Square only for now; 'hex' (needs an orientation — see the grid plan) and 'off'
// return the point unchanged, so a drop can always be routed through this safely.
// Uses exact rounding (not roundToStep's display rounding), so any cell size lands
// on true multiples with no float truncation.
export function snapToCell(x, z, scale = {}) {
  const cx = +scale.cellWorld;
  if (!(cx > 0) || scale.gridStyle !== 'square') return { x, z };
  const cz = +scale.cellZ > 0 ? +scale.cellZ : cx; // rectangular grids (e.g. a go board) have cz ≠ cx
  const ox = +scale.gridX || 0, oz = +scale.gridZ || 0; // lattice offset — align to a printed map's phase
  // 'cross' snaps to the line intersections (go stones sit on crossings); the default
  // 'center' snaps to mid-cell (chess/checkers pieces sit in the squares).
  const cross = scale.snapAnchor === 'cross';
  const snap = (v, cell, o) => { const h = cross ? 0 : cell / 2; return Math.round((v - o - h) / cell) * cell + h + o; };
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
  lift: 0.05,             // height above the felt to draw an overlay (avoid z-fighting)
  labelLift: 0.6,         // height of a ruler's floating distance label
  minDrag: 0.2,           // min world length for a placement to count (shorter = ignored)
  maxLen: 80,             // clamp on any overlay coordinate/dimension (world units)
  coneAngle: Math.PI / 6, // default cone half-angle (the sector template's spread)
  lineWidth: 1,           // default width of a "line" (lane) template, in world units
};
