// server.js  —  node server.js   (Node 18+)
// Authoritative physics server. One cannon-es world is the single source of
// truth for every piece. Clients send intent (grab / move-target / release /
// flip / spawn); the server simulates and Colyseus syncs the resulting
// transforms to everyone via delta-compressed Schema state.

import express from 'express';
import helmet from 'helmet';
import { createServer } from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Server, Room, ServerError, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Schema, MapSchema, defineTypes, Encoder } from '@colyseus/schema';
Encoder.BUFFER_SIZE = 128 * 1024; // default 16KB overflows a busy table's piece map; 128KB gives ample headroom
import * as CANNON from 'cannon-es';
import convexHull from 'convex-hull';
import { KINDS, PROPS, BOARDS, TABLE, dieVerts, dieR, deckHeight, timerLive, MEASURE, DISPENSERS, stackVisible, gridActive, snapToCell, TRAY, trayCenter, trayParts, trayPlace, inTray, dieSpawnProps, colorProps, STARTERS, cardGeom, sanitizeGeom, seatAngle, SEAT_ANGLES, LETTER_DIST, MAHJONG, DECK_MODELS } from './shared/pieces.js';
import * as db from './db.js'; // Postgres-backed saved-asset library (metadata; files stay on disk)
import { hashPassword, verifyPassword, makeToken, hashToken } from './auth.js';
import { runMigrations } from './migrate.js'; // startup schema migrator (owner-role DDL)
import { RANK, rankOf, canManageMember, canSetMemberRole } from './server/permissions.js';
import { httpErrorHandler } from './server/http/async-route.js';
import { createRequireUser, createRequireAdmin } from './server/http/auth-context.js';
import { createAuthRouter } from './server/http/routes/auth.js';
import { createRoomsRouter } from './server/http/routes/rooms.js';
import { createUploadRouter } from './server/http/routes/uploads.js';
import { createAdminRouter } from './server/http/routes/admin.js';
import { registerCardHandlers } from './server/game/handlers/cards.js';
import { registerMovementHandlers } from './server/game/handlers/movement.js';

// --- Simulation tuning (all the physics "feel" constants in one place) -------
const SIM = {
  gravity: -20,                                   // world gravity (y)
  friction: 0.35, restitution: 0.2,               // contact material
  tableThick: 0.5,                                // table slab half-height
  wall: { half: 4, thick: 0.5, over: 1 },         // walls: half-height (y 0..8), half-thickness, corner overlap
  servo: { stiffness: 25, maxSpeed: 45, angDamp: 0.6 }, // held-piece velocity servo (tracks cursor)
  damp: { flat: 0.5, solid: 0.15 },               // angular damping: cards/decks vs everything else
  flipHop: 1.6, flipArc: 0.7,                     // flip feedback nudge + kinematic arc height
  roll: { up: 16, spread: 8, spin: 22 },          // die roll impulse (up drives peak height ~ up^2)
  trayRoll: { up: 8, spread: 13, spin: 30 },      // tray-die roll: a real toss, kept in by the walls + lid
  impact: { minVel: 1.5 },                        // min collision speed (m/s) to fire a landing sound
  spawnY: 4,                                       // height a spawned piece drops from
  bounds: { margin: 1.5, floor: -3, ceiling: 12 },// out-of-bounds safety net
  absorb: { x: 1.1, z: 1.4 },                     // how close a dropped card must be to a deck to merge
  propRight: { strength: 9, maxTilt: 0.85, damp: 0.82 }, // self-righting for standing props (pawn/chess)
  throwCap: 40,                                    // general release-speed clamp
  // --- global solver / contacts / timestep (stack stability vs CPU) ---
  solverIterations: 12,                            // contact solver passes: more = firmer stacks, more CPU
  contact: { stiffness: 1e7, relaxation: 3 },      // contact-equation firmness / relaxation
  step: { fixed: 1/120, maxSub: 4 },               // physics timestep: smaller fixed + more substeps = less tunneling, more CPU
  // --- CARDS: the thin-stack problem is tuned here ---------------------------
  cards: {
    colliderThick: 0.04, // HALF-thickness of the INVISIBLE card collider (the mesh stays thin). Bigger = far more
                         //   stable stacks & less clip-through, but stacked cards show a small air-gap. Try 0.03–0.08.
    linDamp: 0.25,       // linear damping — cards settle sooner
    angDamp: 0.7,        // angular damping for cards (overrides damp.flat)
    maxThrow: 14,        // clamp a card's release speed so a flung card can't tunnel through another
    sleepSpeed: 0.5,     // a card goes fully static (stops jittering) below this speed...
    sleepTime: 0.2,      // ...sustained for this many seconds
  },
  maxPieces: 80,
};

// --- Saved-asset library -----------------------------------------------------
// A shared, on-disk library of decks / boards / props that survives restarts
// (mount ASSETS_DIR as a Docker volume to persist it). Layout:
//
//   <ASSETS_DIR>/{uploads,decks,boards,props}/
//     <random>.<ext>   uploaded images / models, served at /assets/<kind>/<random>
//     <slug>.json       metadata, NEVER web-served (a route guard blocks .json)
//
// Because filenames are random and the .json metadata is never served, a card
// front that's meant to stay hidden can't be discovered by poking at /assets.
const ASSETS_DIR = process.env.ASSETS_DIR || './saved-assets';
const ASSET_KINDS = ['uploads', 'decks', 'boards', 'props', 'sky'];
for (const kind of ASSET_KINDS) fs.mkdirSync(path.join(ASSETS_DIR, kind), { recursive: true });

// Clamp a number into [min, max].
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const GRID_LIFT_MAX = 3; // how high (world units) the table grid can float above the felt
// A bounded image data-URL (the only avatar shape we accept — small enough to
// sync in state, and never an arbitrary URL/script). Used by setAvatar + /me/avatar.
const isBoundedImageDataURL = (data) => typeof data === 'string' && data.startsWith('data:image') && data.length < 60000;
// A whiteboard stroke: a flat [x0,y0,x1,y1,...] path in normalized [0,1] board UV,
// plus a color + width. Bounded so a bad client can't push junk or a huge payload.
const validStroke = (s) => s && Array.isArray(s.pts) && s.pts.length >= 2 && s.pts.length <= 2000
  && s.pts.every(n => typeof n === 'number' && n >= 0 && n <= 1)
  && typeof s.color === 'string' && s.color.length <= 24
  && typeof s.width === 'number' && isFinite(s.width) && s.width > 0 && s.width <= 0.2;
// A skybox reference: '' (default), a local equirect URL, or a cube descriptor
// {"t":"cube","f":[6 local urls]}. Only local /assets/sky/ or /sky/ paths, never
// external — every client loads it.
const skyUrlOk = (u) => typeof u === 'string' && u.length < 300 && !u.includes('..') && (u.startsWith('/assets/sky/') || u.startsWith('/sky/'));
const validSky = (v) => {
  if (v === '') return true;
  if (typeof v !== 'string' || v.length > 2000) return false;
  if (v[0] === '{') { let d; try { d = JSON.parse(v); } catch { return false; } return !!d && d.t === 'cube' && Array.isArray(d.f) && d.f.length === 6 && d.f.every(skyUrlOk); }
  return skyUrlOk(v);
};

// Keep an untrusted category name inside the allowlist (falls back to 'uploads').
const assetKind = (kind) => ASSET_KINDS.includes(kind) ? kind : 'uploads';

const isDataURL = (value) => typeof value === 'string' && value.startsWith('data:image');

// A card "ref" is whatever string the client sends for a card face: procedural
// text, a URL, or an inline data-URL. We only bound its length here.
const deckRefOk = (value) => typeof value === 'string' && value.length < 200000;

// Write raw bytes into a category folder under a random name; return its URL.
function saveAsset(kind, bytes, ext = 'jpg') {
  const validKind = assetKind(kind);
  const name = crypto.randomBytes(9).toString('hex') + '.' + String(ext).replace(/[^a-z0-9]/gi, '');
  fs.writeFileSync(path.join(ASSETS_DIR, validKind, name), bytes);
  return `/assets/${validKind}/${name}`;
}

// Move an inline base64 image (data-URL) onto disk and return its URL, or null
// if the string isn't a data-URL. Used when saving a deck whose art was pasted
// inline rather than uploaded as a file.
function saveImageRef(dataURL, kind = 'decks') {
  const match = /^data:(image\/\w+);base64,(.+)$/s.exec(dataURL);
  if (!match) return null;
  const [, mimeType, base64] = match;
  const ext = mimeType.split('/')[1].replace('jpeg', 'jpg');
  return saveAsset(kind, Buffer.from(base64, 'base64'), ext);
}

// ---- Orphaned-asset cleanup (admin) ---------------------------------------
// Files under saved-assets/ that nothing references anymore. "Referenced" is
// gathered conservatively (broad regex over every library row + room skybox +
// every LIVE table's state), and we skip anything newer than a day so an
// in-progress upload can't be swept. public/ is never touched (built-ins live there).
const LIVE_ROOMS = new Set();                 // in-process TableRoom instances (see onCreate/onDispose)
const ASSET_PATH_RE = /\/assets\/(?:uploads|decks|boards|props|sky)\/[A-Za-z0-9._-]+/g;
const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const extractAssetPaths = (str, set) => { const m = String(str).match(ASSET_PATH_RE); if (m) for (const p of m) set.add(p); };

async function findOrphanAssets() {
  const referenced = new Set();
  for (const blob of await db.allAssetRefBlobs()) extractAssetPaths(blob, referenced); // DB refs (throws → abort)
  for (const room of LIVE_ROOMS) extractAssetPaths(JSON.stringify(room.state.toJSON()), referenced); // live tables
  const cutoff = Date.now() - ORPHAN_MIN_AGE_MS;
  const orphans = [];
  for (const kind of ASSET_KINDS) {
    let names = [];
    try { names = fs.readdirSync(path.join(ASSETS_DIR, kind)); } catch { continue; }
    for (const name of names) {
      let st; try { st = fs.statSync(path.join(ASSETS_DIR, kind, name)); } catch { continue; }
      if (!st.isFile() || st.mtimeMs > cutoff) continue;               // skip dirs and too-new files
      if (referenced.has(`/assets/${kind}/${name}`)) continue;         // still in use
      orphans.push({ url: `/assets/${kind}/${name}`, kind, name, size: st.size });
    }
  }
  return orphans;
}
function trashOrphans(orphans) {
  const moved = [];
  for (const o of orphans) {
    try {
      const destDir = path.join(ASSETS_DIR, '.trash', o.kind);
      fs.mkdirSync(destDir, { recursive: true });
      fs.renameSync(path.join(ASSETS_DIR, o.kind, o.name), path.join(destDir, o.name));
      moved.push(o.url);
    } catch (e) { console.error('[cleanup] move', o.url, e.message); }
  }
  return moved;
}

// --- Colliders ---------------------------------------------------------------
// Build the cannon-es collider for a piece from its shared shape descriptor.
// The collider is always a simple primitive (box/sphere/convex-hull); the fancy
// visual mesh is the client's job, and only needs to roughly match this.
// Turn a collider type + half-extents into a CANNON shape. Off-centre shapes (flat)
// return { shape, offset }. Shared by uploaded and built-in props, so every type —
// box | sphere | cylinder | cone | flat — behaves identically for both.
const COLLIDER_TYPES = ['sphere', 'cylinder', 'cone', 'flat']; // shapes colliderShape understands (box = default); reused to validate uploads
function colliderShape(type, hx, hy, hz, opts = {}) {
  if (type === 'sphere') return new CANNON.Sphere(Math.max(hx, hy, hz));
  if (type === 'cylinder' || type === 'cone') {
    const r = Math.max(hx, hz);                                                   // horizontal radius
    const sides = Math.max(3, (opts.sides | 0) || 16);                            // 16 = round; 3/6/… = prisms & N-gon pyramids
    const top = type === 'cone' ? r * 0.05 : (opts.top != null ? r * opts.top : r); // cone = tiny apex; top < 1 = truncated cone
    return new CANNON.Cylinder(top, r, hy * 2, sides);                            // Y-oriented in cannon-es
  }
  if (type === 'flat') {
    const t = 0.06;                                                               // thin base footprint so pieces slide over it
    return { shape: new CANNON.Box(new CANNON.Vec3(hx, t, hz)), offset: new CANNON.Vec3(0, -(hy - t), 0) };
  }
  return new CANNON.Box(new CANNON.Vec3(hx, hy, hz));                             // default: box
}

function buildCollider(type, props) {
  const shape = KINDS[type].shape;

  if (shape === 'die') return dieShape(props.sides || 6);

  if (shape === 'prop') {
    // Uploaded .glb: measured half-extents + an optional collider type (default box).
    if (props.model && Array.isArray(props.box)) {
      const [hx, hy, hz] = props.box.map(v => clamp(+v || 0.5, 0.05, 4));
      return colliderShape(props.collider, hx, hy, hz);
    }
    // Built-in shape: authored half-extents (scaled by the universal prop scale) + an optional type.
    const spec = (PROPS[props.shape] || PROPS.box).collider;
    const scale = clamp(+props.scale || 1, 0.3, 3); // matches the client's mesh scale
    const [bx, by, bz] = spec.box.map(v => v * scale);
    return colliderShape(spec.type, bx, by, bz, { sides: spec.sides, top: spec.top });
  }

  if (type === 'board') {
    // A built-in model board or an uploaded .glb board — both supply a box.
    const builtin = props.board && BOARDS[props.board];
    const box = builtin ? builtin.box
              : (props.model && Array.isArray(props.box)) ? props.box
              : null;
    if (box) {
      const [hx, hy, hz] = box.map(v => clamp(+v || 0.05, 0.02, 2 * TABLE.x));
      return new CANNON.Box(new CANNON.Vec3(hx, hy, hz));
    }
    // A plain procedural board, sized by width/depth.
    if (props.w || props.d) {
      const width = clamp(props.w || 8, 2, 2 * TABLE.x - 2);
      const depth = clamp(props.d || 8, 2, 2 * TABLE.z - 2);
      return new CANNON.Box(new CANNON.Vec3(width / 2, 0.05, depth / 2));
    }
  }

  if (shape === 'dispenser') {
    const d = DISPENSERS[props.disp];
    if (!d) return new CANNON.Box(new CANNON.Vec3(0.4, 0.2, 0.4));
    if (d.body === 'stack') { // a growing cylinder, height ∝ visible count (see updateStackCollider)
      const box = PROPS[d.item].collider.box, r = box[0], discH = box[1] * 2;
      const n = stackVisible(props.count ?? d.count.def);
      return new CANNON.Cylinder(r, r, Math.max(discH, n * discH), 16);
    }
    const [hx, hy, hz] = d.collider.box; // 'model' bowl — a fixed box
    return new CANNON.Box(new CANNON.Vec3(hx, hy, hz));
  }

  // A card's collider is intentionally thicker than the visible card, which is
  // what keeps a stack of them stable instead of jittering apart.
  if (type === 'card') {
    const g = cardGeom(props), hy = Math.max(g.th, SIM.cards.colliderThick);         // thickness at least the card collider
    // A hexagon card gets a matching 6-gon prism (Y-oriented cylinder = flat hex), so it collides —
    // and will snap to a future hex grid — as the shape it looks like. Others keep the box footprint.
    return g.shape === 'hex'
      ? new CANNON.Cylinder(g.hh, g.hh, hy * 2, 6)         // radius = circumradius (pointy-top); cannon's 6-gon aligns with the mesh
      : new CANNON.Box(new CANNON.Vec3(g.hw, hy, g.hh));
  }

  return new CANNON.Box(new CANNON.Vec3(...shape.box));
}

// --- Small 3-vector helpers (plain [x, y, z] arrays) -------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const norm = (a) => { const length = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0]/length, a[1]/length, a[2]/length]; };
const averagePoint = (points) => {
  const sum = points.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
  return sum.map(component => component / points.length);
};

// Build the physics collider for a polyhedral die from the SAME vertices the
// client uses for its mesh, so the two can never drift apart.
//
// We take the convex hull, then merge hull triangles that share a face-normal
// into a single polygon face (a d10's kite faces become one face each). This
// matters for stability: leaving a face as several coplanar triangles makes
// cannon's contact solver jitter — that's what once made a resting d10 slowly
// wander across the table on its own.
function dieShape(sides) {
  const cubeCollider = () => new CANNON.Box(new CANNON.Vec3(dieR(6), dieR(6), dieR(6)));
  if (sides === 6) return cubeCollider(); // a d6 is just a cube

  const vertices = dieVerts(sides);
  if (!vertices) return cubeCollider(); // unknown die → fall back to a cube

  try {
    // 1. Group the hull's triangles by shared normal — each group is one flat face.
    const faceGroups = [];
    for (const [a, b, c] of convexHull(vertices)) {
      const normal = norm(cross(sub(vertices[b], vertices[a]), sub(vertices[c], vertices[a])));
      let group = faceGroups.find(existing => dot(existing.normal, normal) > 0.999);
      if (!group) {
        group = { normal, indices: new Set() };
        faceGroups.push(group);
      }
      group.indices.add(a);
      group.indices.add(b);
      group.indices.add(c);
    }

    // 2. For each face, order its vertices around the centre, wound outward.
    const faces = faceGroups.map(group => {
      const indices = [...group.indices];
      const centroid = averagePoint(indices.map(i => vertices[i]));

      // Sort vertices by their angle within the face's own 2D plane.
      const refAxis = norm(sub(vertices[indices[0]], centroid));
      const perpAxis = cross(group.normal, refAxis);
      const angleOf = (i) => Math.atan2(dot(sub(vertices[i], centroid), perpAxis), dot(sub(vertices[i], centroid), refAxis));
      indices.sort((i, j) => angleOf(i) - angleOf(j));

      // cannon needs faces wound so their normal points outward; flip if not.
      const woundNormal = cross(sub(vertices[indices[1]], vertices[indices[0]]), sub(vertices[indices[2]], vertices[indices[0]]));
      if (dot(woundNormal, group.normal) < 0) indices.reverse();
      return indices;
    });

    return new CANNON.ConvexPolyhedron({
      vertices: vertices.map(v => new CANNON.Vec3(v[0], v[1], v[2])),
      faces,
    });
  } catch (e) {
    return cubeCollider(); // any hull failure → a safe cube
  }
}

// --- Synced state ----------------------------------------------------------
// defineTypes() is the no-build-step way to declare schema in plain JS.
// (The modern alternative is TypeScript with @type() decorators.)
// Clients rebuild this schema automatically via reflection — no shared file.
class Piece extends Schema {}
defineTypes(Piece, {
  type: 'string', owner: 'string', props: 'string', count: 'number', // count = cards in a deck (0 for other pieces)
  x: 'number', y: 'number', z: 'number',
  qx: 'number', qy: 'number', qz: 'number', qw: 'number',
});
class Player extends Schema {} // PUBLIC per-player info: seat + how many cards they hold (never which cards)
defineTypes(Player, { seat: 'number', hand: 'number', name: 'string', color: 'string', avatar: 'string', showing: 'number', handBack: 'string', role: 'string' }); // showing = how many hand cards this player is currently revealing (public badge; never the content); handBack = the (public) back image of their hand cards; role = their per-room role (owner/gm/helper/player)

// Per-room role ladder — the server gates privileged actions by rank, and the
// client hides tools it can't use (courtesy only; these checks are the real rule).
// PUBLIC shared timer. We sync only the anchor (running/mode/base/since), never a
// ticking number — each client computes the live value with timerLive(), the same
// way the render loop interpolates piece positions locally. base = ms frozen at
// the last pause; since = server Date.now() at the last start (0 while paused).
class Timer extends Schema {
  constructor() { super(); this.running = false; this.mode = 'up'; this.base = 0; this.since = 0; this.duration = 300000; }
}
defineTypes(Timer, { running: 'boolean', mode: 'string', base: 'number', since: 'number', duration: 'number' });
// A durable scoreboard row: a free label + a number, keyed by id in State.scores.
class ScoreRow extends Schema {
  constructor(label = '', score = 0) { super(); this.label = label; this.score = score; }
}
defineTypes(ScoreRow, { label: 'string', score: 'number' });
// The whiteboard is a synced singleton (like the timer), NOT a physics piece: it
// rides a circular track behind the players (angle), one person "owns" it to draw,
// and it's dark (chalkboard) or light (whiteboard). Strokes are held server-side,
// not in the schema. Ephemeral — gone on room dispose.
class Whiteboard extends Schema {
  constructor() { super(); this.enabled = false; this.angle = 0; this.owner = ''; this.dark = true; }
}
defineTypes(Whiteboard, { enabled: 'boolean', angle: 'number', owner: 'string', dark: 'boolean' });
// Dice trays are PERSONAL: one physics-walled box per seat, on the track directly behind that
// player (angle from SEAT_ANGLES). `State.trays` maps seat index → true for each tray that's
// out; the dice inside are ordinary `die` pieces tagged `props.traySeat = N`, so they ride
// scene save/load and the physics/net/roll all key on the owning seat. Each player toggles
// only their own tray. (Replaced the old single shared `DiceTray` singleton.)
// PUBLIC per-room measurement scale — a DISPLAY/snap layer over the FIXED world
// scale; it never rescales physics or piece sizes. worldPerUnit converts a world
// distance into display units; unitLabel is freeform ("in"/"cm"/"hex"/…). roundStep
// is the display rounding, in display units. cellWorld/gridStyle/gridColor/gridLift
// are the grid: cell size (world units), 'off'|'square'|'hex', the line colour (so it
// reads on any felt), and the grid's height above the felt. GM-set, durable.
class RoomScale extends Schema {
  constructor() { super(); this.worldPerUnit = 1; this.unitLabel = 'u'; this.roundStep = 0.1; this.cellWorld = 0; this.cellZ = 0; this.gridX = 0; this.gridZ = 0; this.gridStyle = 'off'; this.gridColor = '#ffffff'; this.gridLift = 0.05; this.snapAnchor = 'center'; this.gridHidden = false; }
}
defineTypes(RoomScale, { worldPerUnit: 'number', unitLabel: 'string', roundStep: 'number', cellWorld: 'number', cellZ: 'number', gridX: 'number', gridZ: 'number', gridStyle: 'string', gridColor: 'string', gridLift: 'number', snapAnchor: 'string', gridHidden: 'boolean' });
// PUBLIC measurement/template overlay — a flat, non-physics annotation on the felt
// (rendered via the OVERLAY registry client-side). Every overlay is two points plus
// optional scalars, so one shape + one interaction (drag A→B) covers ruler today and
// circle/cone/line next. Never enters the physics world.
class Overlay extends Schema {
  constructor() { super(); this.kind = 'ruler'; this.color = '#ffffff'; this.owner = ''; this.x = 0; this.z = 0; this.x2 = 0; this.z2 = 0; this.w = 0; this.ang = 0; }
}
defineTypes(Overlay, { kind: 'string', color: 'string', owner: 'string', x: 'number', z: 'number', x2: 'number', z2: 'number', w: 'number', ang: 'number' });
class State extends Schema {
  constructor() { super(); this.pieces = new MapSchema(); this.players = new MapSchema(); this.turn = ''; this.timer = new Timer(); this.scores = new MapSchema(); this.notes = ''; this.tableX = TABLE.x; this.tableZ = TABLE.z; this.whiteboard = new Whiteboard(); this.trays = new MapSchema(); this.skybox = ''; this.feltColor = '#2f6b4f'; this.roomName = ''; this.turnPending = ''; this.unclaimed = new MapSchema(); this.scale = new RoomScale(); this.overlays = new MapSchema(); }
}
defineTypes(State, { pieces: { map: Piece }, players: { map: Player }, turn: 'string', timer: Timer, scores: { map: ScoreRow }, notes: 'string', tableX: 'number', tableZ: 'number', whiteboard: Whiteboard, trays: { map: 'boolean' }, skybox: 'string', feltColor: 'string', roomName: 'string', turnPending: 'string', unclaimed: { map: 'string' }, scale: RoomScale, overlays: { map: Overlay } });

const PALETTE = ['#4a78c9', '#c94a4a', '#4ac97a', '#c9a24a', '#9a4ac9', '#4ac9c9'];

// --- Physics world (identical setup to the single-player client) ------------
// GM-resizable table: half-extent bounds (default is TABLE = 10 x 7).
const TABLE_LIMIT = { minX: 4, maxX: 20, minZ: 3, maxZ: 16 };
// Backstop against a scene inlining raw image data (the normal flow stores card/
// model art as file refs, so a real scene is tiny; this only catches the edge case).
const SCENE_MAX_BYTES = 2_000_000;
// Whiteboard: cap the server-held stroke history (a knob — raise/lower freely).
const WHITEBOARD_MAX_STROKES = 2000;
// Overlays: cap the room total and each player's share, so the map can't be spammed
// unbounded (mirrors the whiteboard/score caps). Both are free knobs.
const OVERLAY_MAX = 200;
const OVERLAY_MAX_PER_PLAYER = 40;
const OVERLAY_KINDS = new Set(['ruler', 'circle', 'cone', 'line']); // valid overlay kinds (add here + in the client OVERLAY registry)
const TWO_PI = Math.PI * 2;

// --- Physics world -----------------------------------------------------------
// Create the single cannon-es world. The table surface + containment walls are
// added separately by buildBounds() so the GM can resize them at runtime.
// Returns the world with its shared contact material attached (spawn() reuses it).
function buildWorld() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, SIM.gravity, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true; // let resting pieces sleep — cheap, and they sync nothing
  world.solver.iterations = SIM.solverIterations;

  // One material shared by everything; the contact settings tune how firm/bouncy
  // collisions feel (see SIM.contact for the stack-stability trade-offs).
  const material = new CANNON.Material('surface');
  world.addContactMaterial(new CANNON.ContactMaterial(material, material, {
    friction: SIM.friction,
    restitution: SIM.restitution,
    contactEquationStiffness: SIM.contact.stiffness,
    contactEquationRelaxation: SIM.contact.relaxation,
  }));

  world.__mat = material; // stash the shared material for spawn() and buildBounds() to reuse
  return world;
}

const rnd = () => [(Math.random() - 0.5) * 8, SIM.spawnY, (Math.random() - 0.5) * 6];
// The landing/drop cue for a piece. A TILE (a card/deck carrying a `tile` kind — domino/letter/mahjong)
// clacks like a tile / thunks like its wooden box, instead of the paper card/deck sounds.
const isTilePiece = (p) => !!(p && p.tile);
const dropSfx = (t, p) => t === 'card' ? (isTilePiece(p) ? 'tile-drop' : 'card-drop')
  : t === 'deck' ? (isTilePiece(p) ? 'tiledeck-drop' : 'deck-drop')
  : t === 'die' ? 'die-drop' : 'object-drop';

// Fisher–Yates in-place shuffle.
const shuffle = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.random() * (i + 1) | 0;
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};
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
      for (const rank of ranks)
        cards.push(`rank:${rank}:${symbol}:${color}`);
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
  return { back: 'lback', cards: shuffle(cards), tile: 'letter', snap: true, deckModel: 'bentwood' };
}

// The standard 144-tile Mahjong wall as a shuffled "deck", from the MAHJONG face lists. `tile:'mahjong'`
// gives each tile its chunky geometry; the face refs are bundled image URLs (composited ivory tiles).
function buildMahjongWall() {
  const cards = [];
  const push = (id, n) => { for (let i = 0; i < n; i++) cards.push(MAHJONG.base + id + '.png'); };
  for (const suit of MAHJONG.suits) for (let r = 1; r <= 9; r++) push(suit + r, 4); // 3 suits × 1-9 × 4 = 108
  for (const h of MAHJONG.honors) push(h, 4);                                        // winds + dragons × 4 = 28
  for (const b of MAHJONG.bonus) push(b, 1);                                         // flowers + seasons × 1 = 8
  return { back: 'mjback', cards: shuffle(cards), tile: 'mahjong', deckModel: 'bentwood' };
}

// The PUBLIC geometry/behavior a card/tile inherits from its deck: a named tile kind (`tile`), an
// explicit `geom` (custom-aspect image decks), and a `snap` flag (word tiles snap to the grid). Plain
// playing cards carry none, so this returns {} and nothing extra is stored — normal cards are
// untouched. Threaded wherever a card is dealt, drawn, held, or played, so a face-down tile still
// shows its true shape (and snap behavior) while its face is private.
const geoOf = (o) => { const g = {}; if (o && o.tile) g.tile = o.tile; if (o && o.geom) g.geom = o.geom; if (o && o.snap) g.snap = true; return g; };

// --- The room --------------------------------------------------------------
class TableRoom extends Room {
  async onCreate(options) {
    this.setState(new State());
    this.world = buildWorld();
    this.mat = this.world.__mat;
    LIVE_ROOMS.add(this); // so orphan cleanup can see this table's live asset references
    this.roomCode = (options && options.code) || null;
    const roomRec = this.roomCode ? await db.findRoomByCode(this.roomCode) : null;
    this.roomId = roomRec ? roomRec.id : null; // this live table's persistent room id (for membership)
    this.state.roomName = roomRec ? String(roomRec.name || '').slice(0, 60) : ''; // synced display name for the table header (empty for the code-less editor room)
    if (this.roomId) { // restore the durable scoreboard, notes, and table size for this room
      const rs = await db.getRoomState(this.roomId);
      for (const row of rs.scoreboard) {
        if (row && row.id) this.state.scores.set(String(row.id), new ScoreRow(String(row.label || '').slice(0, 40), Number(row.score) || 0));
      }
      this.state.notes = String(rs.notes || '').slice(0, 8000);
      this.state.tableX = clamp(rs.tableX, TABLE_LIMIT.minX, TABLE_LIMIT.maxX);
      this.state.tableZ = clamp(rs.tableZ, TABLE_LIMIT.minZ, TABLE_LIMIT.maxZ);
      if (/^#[0-9a-f]{6}$/i.test(rs.feltColor || '')) this.state.feltColor = rs.feltColor;
      this.applyScale(rs.scale); // grid + measurement calibration (seeded defaults survive a null column)
      this.state.skybox = validSky(String(rs.skybox || '')) ? String(rs.skybox || '') : '';
      this.savedScene = rs.scene || null; // GM's last saved table state — applied below, once physics maps exist
    }
    this.buildBounds(this.state.tableX, this.state.tableZ); // table surface + walls at the current size
    this.bodies = new Map();  // id -> CANNON.Body   (physics, not synced)
    this.targets = new Map(); // id -> {x,y,z}       (drag target of the owner)
    this.groups = new Map();  // sessionId -> Map(id -> {x,y,z} offset)  (a multi-select group drag)
    this._released = new Map(); // id -> release time; first hard impact after fires a landing sound
    this.flips = new Map();   // id -> scripted half-flip in progress
    this.deckCards = new Map(); // id -> [frontRef]        PRIVATE: a deck's face-down cards (never synced)
    this.drafts = new Map();    // sessionId -> {back,cards} PRIVATE: a deck being built in chunks
    this.cardData = new Map();  // id -> { front }         PRIVATE: a face-down table card's hidden face
    this.hands = new Map();     // sessionId -> [{hid,front,back}]  PRIVATE: each player's hidden hand
    this.notebooks = new Map(); // sessionId -> text               PRIVATE: each player's private notes (ephemeral; dies with the room)
    this.strokes = [];          // whiteboard stroke history (server-held; sent to late-joiners, gone on dispose)
    this.chatLog = [];          // recent public chat (server-held; last 80, sent to late-joiners, gone on dispose)
    this.shows = new Map();     // sessionId -> {to:Set,cards:[]}   PRIVATE: an active hold-to-show (who sees which of the shower's cards)
    this.pendingInspect = new Map(); // sessionId -> {deckId,front,back}  PRIVATE: a card drawn to inspect, not yet placed
    this.pendingHands = new Map(); // userId -> {name,cards}  saved-game hands awaiting their owner's return (rebind on join)
    this.pendingTurn = null;       // userId whose turn it was in a saved game, awaiting their return
    this.nextId = 1; this.nextHid = 1; this.nextOverlayId = 1;
    // Scoreboard row ids: a plain counter, seeded past any rows just restored above
    // (their 's<N>' keys) so a reloaded room's next add can't collide with an old row.
    this.nextScoreId = 1;
    this.state.scores.forEach((_, id) => { const n = /^s(\d+)$/.exec(id); if (n) this.nextScoreId = Math.max(this.nextScoreId, +n[1] + 1); });
    if (this.savedScene) this.applyScene(this.savedScene); // rebuild the saved table state (pieces persist across an empty room)

    // --- Movement: grab → drag → release (single + multi-select) ---------
    registerMovementHandlers(this, {
      isMovable: (piece) => !!(KINDS[piece.type] && KINDS[piece.type].mass > 0),
    });

    // --- Group batch ops (multi-select): the existing per-piece actions applied across a
    // selection. Stand/snap toggle the group as a UNIT (if any is on, turn all off, else all on);
    // roll/flip/take act on the relevant subset (dice / cards) and ignore the rest.
    this.onMessage('setStandGroup', (client, { ids } = {}) => {
      if (!Array.isArray(ids)) return;
      const anyStanding = ids.some(id => { const p = this.state.pieces.get(id); return p && this.standOf(p); });
      for (const id of ids) {
        const piece = this.state.pieces.get(id); if (!piece) continue;
        const props = JSON.parse(piece.props || '{}');
        props.stand = anyStanding ? false : this.naturalStand(piece);
        piece.props = JSON.stringify(props);
        const b = this.bodies.get(id); if (b) b.wakeUp();
      }
    });
    this.onMessage('setSnapGroup', (client, { ids } = {}) => {
      if (!Array.isArray(ids)) return;
      const anySnap = ids.some(id => { const p = this.state.pieces.get(id); try { return !!(p && JSON.parse(p.props || '{}').snap); } catch { return false; } });
      for (const id of ids) {
        const piece = this.state.pieces.get(id); if (!piece) continue;
        const props = JSON.parse(piece.props || '{}');
        props.snap = !anySnap;
        piece.props = JSON.stringify(props);
        const b = this.bodies.get(id);
        if (b) {
          if (props.snap && gridActive(this.state.scale)) { const p = snapToCell(b.position.x, b.position.z, this.state.scale); b.position.x = p.x; b.position.z = p.z; b.velocity.setZero(); b.angularVelocity.setZero(); this.targets.delete(id); }
          else if (b.__pinned) this.unpinPiece(id);
          b.wakeUp();
        }
      }
    });
    this.onMessage('rollGroup', (client, { ids } = {}) => { // R with dice selected → roll them all
      if (!Array.isArray(ids)) return;
      let n = 0;
      for (const id of ids) { const p = this.state.pieces.get(id), b = this.bodies.get(id); if (p && p.type === 'die' && b) { rollDie(id, b.__traySeat != null ? SIM.trayRoll : SIM.roll); n++; } }
      if (n) this.broadcast('sfx', { type: n > 1 ? 'dice-roll' : 'die-roll' });
    });
    this.onMessage('flipGroup', (client, { ids } = {}) => { // F with cards selected → flip them all
      if (!Array.isArray(ids)) return;
      let n = 0;
      for (const id of ids) {
        const piece = this.state.pieces.get(id), b = this.bodies.get(id);
        if (!piece || !b || piece.type !== 'card') continue;
        const props = JSON.parse(piece.props || '{}');
        if (props.front) { this.cardData.set(id, { front: props.front }); delete props.front; }        // face-up → hide
        else if (this.cardData.has(id)) { props.front = this.cardData.get(id).front; this.cardData.delete(id); } // face-down → reveal
        piece.props = JSON.stringify(props);
        b.wakeUp(); b.velocity.y = SIM.flipHop; n++;
      }
      if (n) this.broadcast('sfx', { type: 'card-flip' });
    });
    this.onMessage('takeGroup', (client, { ids } = {}) => { // H with cards selected → take them all to hand
      if (!Array.isArray(ids)) return;
      for (const id of ids) {
        const piece = this.state.pieces.get(id); if (!piece || piece.type !== 'card') continue;
        const props = JSON.parse(piece.props || '{}');
        const front = (this.cardData.get(id) || {}).front || props.front;
        this.addToHand(client, front, props.back || 'back', geoOf(props));
        this.removePiece(id);
      }
    });
    this.onMessage('rotateGroup', (client, { ids, dir, angle } = {}) => { // [ / ] step ±45° (dir), or a continuous drag/dial (angle, radians)
      if (!Array.isArray(ids) || !ids.length) return;
      const rot = (typeof angle === 'number' && isFinite(angle)) ? Math.max(-Math.PI, Math.min(Math.PI, angle)) : (dir < 0 ? -1 : 1) * (Math.PI / 4);
      const bodies = [];
      for (const id of ids) { const p = this.state.pieces.get(id), b = this.bodies.get(id); if (p && b && KINDS[p.type].mass > 0) bodies.push(b); } // skip static boards
      if (!bodies.length) return;
      let cx = 0, cz = 0; for (const b of bodies) { cx += b.position.x; cz += b.position.z; } cx /= bodies.length; cz /= bodies.length;
      const s = Math.sin(rot), c = Math.cos(rot);
      const dq = new CANNON.Quaternion(); dq.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), rot);
      for (const b of bodies) {
        const dx = b.position.x - cx, dz = b.position.z - cz;
        b.position.x = cx + dx * c + dz * s;   // rotate each position about the centroid (same convention as trayPlace)
        b.position.z = cz - dx * s + dz * c;
        const nq = new CANNON.Quaternion(); dq.mult(b.quaternion, nq); b.quaternion.copy(nq); // and turn each piece's facing to match
        b.velocity.setZero(); b.angularVelocity.setZero(); b.wakeUp();
      }
    });

    // --- Cards: flip, deal, take, inspect, shuffle, split ----------------------
    registerCardHandlers(this, {
      flipHop: SIM.flipHop, maxPieces: SIM.maxPieces, spawnY: SIM.spawnY,
      geoOf, dropSfx, randomPosition: rnd, shuffle,
    });

    // Dispensers: hand out one item on left-click / left-drag (right-drag moves the
    // whole thing, handled by the generic grab). Uniform, public copies — no private
    // list, unlike a deck. dispense = drop beside it; dispenseDrag = drop + carry.
    this.onMessage('dispense', (client, { id } = {}) => {
      const disp = this.state.pieces.get(id);
      if (!disp || disp.type !== 'dispenser') return;
      const item = this.dispenserItem(disp); if (!item) return;
      const body = this.bodies.get(id);
      this.spawn(item.type, body ? this.besideDeck(body) : rnd(), item.props);
      this.afterDispense(disp, id);
      this.broadcast('sfx', { type: 'object-drop' });
    });
    this.onMessage('dispenseDrag', (client, msg = {}) => {
      const disp = this.state.pieces.get(msg.id);
      if (!disp || disp.type !== 'dispenser') return;
      const item = this.dispenserItem(disp); if (!item) return;
      const body = this.bodies.get(msg.id);
      const newId = this.spawn(item.type, body ? [body.position.x, 2.5, body.position.z] : rnd(), item.props);
      this.afterDispense(disp, msg.id);
      // Hand the new item straight to the dragger's cursor (reuses the deal-adopt path).
      this.state.pieces.get(newId).owner = client.sessionId;
      this.targets.set(newId, { x: msg.x, y: msg.y, z: msg.z });
      client.send('dealt', { id: newId });
    });

    // Tint a die or built-in prop (cosmetic; anyone who can inspect can recolor).
    this.onMessage('recolor', (client, { id, color, textColor, team } = {}) => {
      this.recolorPiece(id, { color, textColor, team });
    });
    // Recolor a whole multi-selection at once. One color/textColor is applied to every id it
    // fits: dice + props take `color` (dice also `textColor`), poker/coin dispensers take
    // `color`; anything it doesn't fit (cards, boards, team bowls) is silently skipped.
    this.onMessage('recolorGroup', (client, { ids, color, textColor, team } = {}) => {
      if (!Array.isArray(ids)) return;
      for (const id of ids) this.recolorPiece(id, { color, textColor, team }); // color XOR team; each piece takes what fits
    });
    // Decks are built in chunks so no single message is huge (a text list can be
    // hundreds of cards): deckBegin → deckAppend (batches) → deckFinish.
    this.onMessage('deckBegin', (client, msg) => {
      if (!this.isAdmin(client)) return; // building library decks is admin-only
      const back = (msg && deckRefOk(msg.back)) ? msg.back : 'back';
      const geom = sanitizeGeom(msg && msg.geom);      // optional custom card shape (fit-to-image decks)
      this.drafts.set(client.sessionId, { back, cards: [], geom });
    });
    this.onMessage('deckAppend', (client, msg) => {
      const draft = this.drafts.get(client.sessionId);
      if (!draft || !msg || !Array.isArray(msg.fronts)) return;
      for (const front of msg.fronts) {
        if (deckRefOk(front) && draft.cards.length < 1000) draft.cards.push(front);
      }
    });
    this.onMessage('deckFinish', async (client, msg) => {
      if (!this.isAdmin(client)) return;
      const draft = this.drafts.get(client.sessionId);
      this.drafts.delete(client.sessionId);
      if (!draft || !draft.cards.length) return;
      const geo = draft.geom ? { geom: draft.geom } : {};
      const doSpawn = !msg || msg.spawn !== false; // default: spawn onto the table (also the back-compat path)
      if (doSpawn) this.spawn('deck', rnd(), { back: draft.back, cards: draft.cards, ...geo }); // spawn to test it live
      if (msg && msg.name) {
        try {
          if (msg.editId) await db.updateDeck(msg.editId, msg.name, draft.back, draft.cards, draft.geom); // edit an existing deck in place
          else await db.insertDeck({ name: msg.name, back: draft.back, fronts: draft.cards, geom: draft.geom, ownerId: client.auth.userId, isPublic: false });
          this.sendAssetList(client, 'deck');
        } catch (e) { console.error('[deckFinish]', e.message); }
      }
    });

    // --- Library: save / list / load decks, boards, props ---------------------
    this.onMessage('saveDeck', async (client, msg) => {
      if (!this.isAdmin(client)) return;
      if (await this.saveDeckById(msg && msg.deckId, msg && msg.name, client.auth.userId)) {
        this.sendAssetList(client, 'deck');
      }
    });
    this.onMessage('listDecks', (client) => this.sendAssetList(client, 'deck'));
    this.onMessage('loadDeck', async (client, msg) => {
      if (this.rank(client) < RANK.helper) return;
      const deck = await db.getDeck(msg && msg.id);
      if (!deck) return;
      if (!deck.isPublic && !this.isAdmin(client)) return; // private assets: admins only
      this.spawn('deck', rnd(), { back: deck.back, cards: deck.fronts, ...(deck.geom ? { geom: deck.geom } : {}) });
    });

    this.onMessage('saveBoard', async (client, msg) => {
      if (!this.isAdmin(client)) return; // library curation is admin-only
      const name = String((msg && msg.name) || '').slice(0, 60).trim();
      if (!name) return;
      const board = (msg && msg.board) || {};
      let record;
      if (board.board && BOARDS[board.board]) {
        record = { board: board.board }; // a built-in board
      } else if (board.model) {
        record = { model: String(board.model).slice(0, 300), modelScale: +board.modelScale || 1,
                   box: Array.isArray(board.box) ? board.box.map(v => +v) : undefined }; // an uploaded .glb
      } else {
        record = { w: board.w, d: board.d, tex: board.tex || null }; // a procedural board
      }
      try {
        if (msg.editId) await db.updateBoard(msg.editId, name, record); // edit an existing board in place
        else await db.insertBoard(name, record, { ownerId: client.auth.userId }); // private by default
        this.sendAssetList(client, 'board');
      } catch (e) { console.error('[saveBoard]', e.message); }
    });
    this.onMessage('listBoards', (client) => this.sendAssetList(client, 'board'));

    this.onMessage('saveProp', async (client, msg) => {
      if (!this.isAdmin(client)) return;
      const name = String((msg && msg.name) || '').slice(0, 60).trim();
      if (!name) return;
      const incoming = (msg && msg.props) || {};
      if (!incoming.model) return; // only custom-model props are saveable
      const props = {
        model: String(incoming.model).slice(0, 300),
        box: Array.isArray(incoming.box) ? incoming.box.map(v => +v) : undefined,
        stand: !!incoming.stand,
        scale: +incoming.scale || 1,
      };
      if (incoming.color != null) props.color = incoming.color | 0;
      if (COLLIDER_TYPES.includes(incoming.collider)) props.collider = incoming.collider; // box is the default
      try {
        if (msg.editId) await db.updateProp(msg.editId, name, props); // edit an existing prop in place
        else await db.insertProp(name, props, { ownerId: client.auth.userId }); // private by default
        this.sendAssetList(client, 'prop');
      } catch (e) { console.error('[saveProp]', e.message); }
    });
    this.onMessage('listProps', (client) => this.sendAssetList(client, 'prop'));

    // --- Asset admin (site admins): toggle visibility, rename, delete ----------
    this.onMessage('assetPublic', async (client, msg) => {
      if (!this.isAdmin(client) || !msg) return;
      try { await db.setAssetPublic(msg.kind, msg.id, !!msg.isPublic); this.sendAssetList(client, msg.kind); }
      catch (e) { console.error('[assetPublic]', e.message); }
    });
    this.onMessage('assetRename', async (client, msg) => {
      if (!this.isAdmin(client) || !msg) return;
      const name = String(msg.name || '').slice(0, 60).trim(); if (!name) return;
      try { await db.renameAsset(msg.kind, msg.id, name); this.sendAssetList(client, msg.kind); }
      catch (e) { console.error('[assetRename]', e.message); }
    });
    this.onMessage('getDeck', async (client, msg) => { // fetch a deck's full cards/back for the editor to pre-fill
      if (!this.isAdmin(client) || !msg) return;
      const d = await db.getDeck(msg.id);
      if (d) client.send('deckData', { id: msg.id, name: d.name, back: d.back, fronts: d.fronts, geom: d.geom });
    });
    this.onMessage('assetDelete', async (client, msg) => {
      if (!this.isAdmin(client) || !msg) return;
      try { await db.deleteAsset(msg.kind, msg.id); this.sendAssetList(client, msg.kind); }
      catch (e) { console.error('[assetDelete]', e.message); }
    });

    // --- Scenes: a saved whole-table setup ------------------------------------
    this.onMessage('listScenes', (client) => this.sendAssetList(client, 'scene'));
    this.onMessage('sceneSave', async (client, msg = {}) => {
      if (!this.isAdmin(client)) return; // scenes are curated in the editor (admin-only)
      const name = String(msg.name || '').slice(0, 60).trim(); if (!name) return;
      const payload = this.serializeScene();
      if (JSON.stringify(payload).length > SCENE_MAX_BYTES) { // don't let inline art bloat the row
        client.send('sceneError', { message: 'Scene is too large to save. Save its decks to the library first so their card art is stored as files, then try again.' });
        return;
      }
      try {
        await db.insertScene({ name, payload, ownerId: client.auth.userId }); // private by default
        this.sendAssetList(client, 'scene');
      } catch (e) { console.error('[sceneSave]', e.message); }
    });
    this.onMessage('sceneLoad', async (client, msg = {}) => {
      if (this.rank(client) < RANK.gm) return; // replacing the whole table is GM+
      const scene = await db.getScene(msg.id);
      if (!scene) return;
      if (!scene.isPublic && !this.isAdmin(client)) return; // private scenes: admins only
      this.applyScene(scene.payload);
    });
    this.onMessage('stateSave', (client) => { // GM checkpoints the live table so it survives an empty room
      if (this.rank(client) < RANK.gm) return;
      const payload = this.serializeGame();
      if (JSON.stringify(payload).length > SCENE_MAX_BYTES) {
        client.send('sceneError', { message: 'Table state is too large to save. Save any table-built decks to the library first so their art is stored as files.' });
        return;
      }
      this.savedScene = payload;
      this.scheduleSave();
      client.send('stateSaved', {});
    });

    this.onMessage('loadBoard', async (client, msg) => {
      if (this.rank(client) < RANK.gm) return; // changing the board reshapes the table: GM+
      const data = await db.getBoard(msg && msg.id);
      if (!data) return;
      if (!data.isPublic && !this.isAdmin(client)) return; // private assets: admins only
      const rec = data.rec;
      const props = rec.board ? { board: rec.board }
                  : rec.model ? { model: rec.model, modelScale: rec.modelScale, box: rec.box }
                  : { w: rec.w, d: rec.d, tex: rec.tex || undefined };
      this.swapBoard(props);
    });
    // Play a card from your hand onto the table, face-up or face-down.
    this.onMessage('playCard', (client, { hid, faceDown, x, z }) => {
      const hand = this.hands.get(client.sessionId);
      if (!hand) return;
      const index = hand.findIndex(card => card.hid === hid);
      if (index < 0) return;
      const [card] = hand.splice(index, 1);

      const pos = (typeof x === 'number' && typeof z === 'number')
        ? [x, 3, z]                                        // where the client dropped it
        : [(Math.random() - 0.5) * 4, 3, (Math.random() - 0.5) * 3]; // or scattered
      const id = this.spawnCardFlat(pos, faceDown ? { back: card.back, ...geoOf(card) } : { front: card.front, back: card.back, ...geoOf(card) });
      if (faceDown) this.cardData.set(id, { front: card.front }); // front private until flipped
      this.sendHand(client);
      this.broadcast('sfx', { type: dropSfx('card', card) }); // played tile clacks
    });

    // Put the player's whole hand on the table (e.g. an Uno "swap hands"), face up or
    // down, spread just in front of their marker (x/z sent by the client).
    this.onMessage('handToTable', (client, { faceDown, x, z } = {}) => {
      const hand = this.hands.get(client.sessionId);
      if (!hand || !hand.length) return;
      const cx = typeof x === 'number' ? x : 0, cz = typeof z === 'number' ? z : 0;
      let spawned = 0;
      for (const card of hand) {
        if (this.state.pieces.size >= SIM.maxPieces) break;                            // respect the piece cap
        const pos = [cx + (Math.random() - 0.5) * 3, 0.1, cz + (Math.random() - 0.5) * 1.6]; // small spread in front of them
        const id = this.spawnCardFlat(pos, faceDown ? { back: card.back, ...geoOf(card) } : { front: card.front, back: card.back, ...geoOf(card) });
        if (faceDown) this.cardData.set(id, { front: card.front });                    // face-down: front stays private until flipped
        spawned++;
      }
      hand.splice(0, spawned);  // remove just the cards that made it onto the table
      this.sendHand(client);    // updates the public count + sends the now-shorter private hand
      if (spawned) this.broadcast('sfx', { type: 'hand-drop' });
    });
    this.onMessage('spawn', (client, msg) => {
      if (this.state.pieces.size >= SIM.maxPieces) return;
      if (msg.type === 'board') {
        if (this.rank(client) < RANK.gm) return;   // reshaping the table is GM+
        this.swapBoard(msg.props || {}); // only one board at a time
      } else if (msg.props && msg.props.tray) {
        // A die into the caller's OWN tray: any player, only a die, only when their tray is out.
        // The server owns the seat and the drop spot (client can't spoof another seat's tray).
        const seat = this.seatOf(client);
        if (msg.type !== 'die' || seat == null || !this.state.trays.get(String(seat))) return;
        this.spawn('die', this.trayDropPos(seat), { ...dieSpawnProps(msg.props), traySeat: seat });
        this.broadcast('sfx', { type: 'die-roll' }); // a little clack as it lands in the tray
      } else {
        if (this.rank(client) < RANK.helper) return; // spawning pieces is Helper+
        const props = msg.type === 'die' ? dieSpawnProps(msg.props) : (msg.props || {}); // validate a table die's color too
        this.spawn(msg.type, rnd(), props);
      }
    });

    const rollDie = (id, roll) => { // fling one die: random horizontal spread + upward pop + tumble
      const body = this.bodies.get(id); if (!body) return;
      body.wakeUp();
      body.velocity.set((Math.random() - 0.5) * roll.spread, roll.up, (Math.random() - 0.5) * roll.spread);
      body.angularVelocity.set((Math.random() - 0.5) * roll.spin, (Math.random() - 0.5) * roll.spin, (Math.random() - 0.5) * roll.spin);
    };
    // The Roll button hops you to YOUR tray; "Roll all" flings only your seat's dice, with a
    // gentler impulse so they tumble inside the walls instead of leaping out.
    this.onMessage('roll', (client) => {
      const seat = this.seatOf(client); if (seat == null) return;
      let n = 0;
      this.state.pieces.forEach((piece, id) => { const b = this.bodies.get(id); if (piece.type === 'die' && b && b.__traySeat === seat) { rollDie(id, SIM.trayRoll); n++; } });
      if (n) this.broadcast('sfx', { type: n > 1 ? 'dice-roll' : 'die-roll' });
    });
    this.onMessage('rollOne', (client, msg = {}) => { const p = this.state.pieces.get(msg.id); const b = this.bodies.get(msg.id); if (p && p.type === 'die') { rollDie(msg.id, b && b.__traySeat != null ? SIM.trayRoll : SIM.roll); this.broadcast('sfx', { type: 'die-roll' }); } }); // right-click a single die
    // Scoop: gather the caller's tray dice back to the middle (a light re-rack).
    this.onMessage('trayScoop', (client) => {
      const seat = this.seatOf(client); if (seat == null || !this.state.trays.get(String(seat))) return;
      const c = this.trayCenterFor(seat), angle = seatAngle(seat);
      let n = 0;
      this.state.pieces.forEach((piece, id) => {
        const b = this.bodies.get(id); if (piece.type !== 'die' || !b || b.__traySeat !== seat) return;
        const p = trayPlace({ x: (Math.random() - 0.5) * 1.4, y: 0.6, z: (Math.random() - 0.5) * 1.0 }, c, angle);
        b.position.set(p.x, p.y, p.z); b.velocity.setZero(); b.angularVelocity.setZero(); b.wakeUp(); n++;
      });
      if (n) this.broadcast('sfx', { type: 'die-roll' });
    });
    this.onMessage('trayClear', (client) => { const seat = this.seatOf(client); if (seat != null) this.clearTraySeat(seat); }); // remove just your tray's dice

    // Wipe the room back to an empty table — pieces and all private state.
    this.onMessage('reset', (client) => {
      if (this.rank(client) < RANK.gm) return; // wiping the table is GM+
      this.clearTable();
      const t = this.state.timer; // stop and zero the shared timer too
      t.running = false; t.since = 0; t.base = t.mode === 'down' ? t.duration : 0;
    });

    // Load a one-click starter game — clears the table and sets up the chosen game (GM+).
    this.onMessage('loadStarter', (client, { game } = {}) => {
      if (this.rank(client) < RANK.gm) return;   // replacing the whole table is GM+ (like scene load / reset)
      if (STARTERS[game]) this.setupStarter(game);
    });

    // Toggle a piece's keep-upright/flat behaviour (the U key).
    this.onMessage('setStand', (client, { id }) => {
      const piece = this.state.pieces.get(id);
      if (!piece) return;
      const props = JSON.parse(piece.props || '{}');
      props.stand = this.standOf(piece) ? false : this.naturalStand(piece); // on → off, or off → its natural mode
      piece.props = JSON.stringify(props);
      const body = this.bodies.get(id);
      if (body) body.wakeUp();
    });

    // Per-piece snap-to-grid flag (mirrors setStand). Toggling it ON snaps the piece to
    // its nearest cell right away (when a grid is active); from then on every drop lands
    // on a cell. OFF restores free placement.
    this.onMessage('setSnap', (client, { id } = {}) => {
      const piece = this.state.pieces.get(id);
      if (!piece) return;
      const props = JSON.parse(piece.props || '{}');
      props.snap = !props.snap;
      piece.props = JSON.stringify(props);
      const body = this.bodies.get(id);
      if (body) {
        if (props.snap && gridActive(this.state.scale)) {
          const p = snapToCell(body.position.x, body.position.z, this.state.scale);
          body.position.x = p.x; body.position.z = p.z;
          body.velocity.set(0, 0, 0); body.angularVelocity.set(0, 0, 0);
          this.targets.delete(id);
        } else if (body.__pinned) {
          this.unpinPiece(id); // snap turned off → free it right away
        }
        body.wakeUp();
      }
    });

    // Snap a held piece a quarter-turn onward, and level it (middle-click).
    this.onMessage('snap', (client, { id }) => {
      const piece = this.state.pieces.get(id);
      if (!piece || piece.owner !== client.sessionId) return;
      const body = this.bodies.get(id);
      if (!body) return;

      // Read the piece's current facing, then advance to the next 45° step.
      const forward = new CANNON.Vec3(0, 0, 1), worldForward = new CANNON.Vec3();
      body.quaternion.vmult(forward, worldForward);
      const step = Math.PI / 4;
      const yaw = (Math.round(Math.atan2(worldForward.x, worldForward.z) / step) + 1) * step;
      body.quaternion.set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)); // pure yaw = flat + 45° step
      body.angularVelocity.setZero();
      body.wakeUp();
    });

    // --- Member management (GM tools): admit pending joiners, kick, promote ----
    // Pending joiners aren't connected (onAuth turned them away), so the list comes
    // from the DB, not the live room. All gated server-side; the client only shows
    // the panel to GMs.
    this.onMessage('members', (client) => {
      if (this.rank(client) < RANK.gm) return;
      this.sendMembers(client);
    });
    this.onMessage('admit', async (client, { userId } = {}) => {
      if (this.rank(client) < RANK.gm || !this.roomId || !userId) return;
      await db.admitMember(this.roomId, userId);
      this.notifyLobby(userId, 'notifyAdmitted'); // push to them if they're waiting in the lobby
      this.broadcastMembers();
    });
    this.onMessage('kick', async (client, { userId } = {}) => {
      if (this.rank(client) < RANK.gm || !this.roomId || !userId) return;
      if (String(userId) === String(client.auth.userId)) return; // no kicking yourself
      const m = await db.getMembership(this.roomId, userId);
      if (!m || !this.canManage(this.rank(client), m.role)) return;
      const target = await db.findUserById(userId);
      if (target && target.isAdmin) return; // site admins can't be kicked
      await db.kickMember(this.roomId, userId);
      const live = this.clients.find(c => c.auth && String(c.auth.userId) === String(userId));
      if (live) { live.send('kicked'); setTimeout(() => { try { live.leave(4000); } catch (e) {} }, 150); } // notice, then drop (consented → no reconnection)
      this.notifyLobby(userId, 'notifyDeclined'); // a pending joiner is waiting in the lobby, not the table
      this.broadcastMembers();
    });
    this.onMessage('setRole', async (client, { userId, role } = {}) => {
      if (this.rank(client) < RANK.gm || !this.roomId || !userId) return;
      if (String(userId) === String(client.auth.userId)) return; // no changing your own role
      if (!['helper', 'player', 'gm'].includes(role)) return;
      const m = await db.getMembership(this.roomId, userId);
      if (!m || !this.canSetRole(this.rank(client), m.role, role)) return;
      const target = await db.findUserById(userId);
      if (target && target.isAdmin) return; // site admins keep full control — can't be demoted
      await db.setMemberRole(this.roomId, userId, role);
      const live = this.clients.find(c => c.auth && String(c.auth.userId) === String(userId));
      if (live) { // reflect the change live so their tools update immediately
        const p = this.state.players.get(live.sessionId);
        if (p) p.role = role;
        if (live.auth) live.auth.role = role;
      }
      this.broadcastMembers();
    });

    this.onMessage('nextTurn', () => this.advanceTurn());
    this.onMessage('reassignHand', (client, { userId, toSessionId } = {}) => { // GM hands an unclaimed hand to a present player
      if (this.rank(client) < RANK.gm) return;
      const uid = userId != null ? String(userId) : null;
      if (!uid || !this.pendingHands.has(uid)) return;
      const target = this.clientBy(toSessionId);
      if (!target) return; // must land on someone present
      const held = this.pendingHands.get(uid);
      this.hands.set(toSessionId, (this.hands.get(toSessionId) || []).concat(held.cards)); // merge onto any hand they hold
      this.pendingHands.delete(uid); this.state.unclaimed.delete(uid);
      this.sendHand(target);
    });
    this.onMessage('remove', (client, { id }) => { if (this.rank(client) < RANK.helper) return; if (this.state.pieces.has(id)) this.removePiece(id); });
    this.onMessage('removeGroup', (client, { ids } = {}) => { // delete a whole multi-selection at once (helper+)
      if (this.rank(client) < RANK.helper || !Array.isArray(ids)) return;
      for (const id of ids) if (this.state.pieces.has(id)) this.removePiece(id);
    });
    this.onMessage('setName', (client, { name }) => {
      const player = this.state.players.get(client.sessionId);
      if (player && typeof name === 'string') player.name = name.trim().slice(0, 20) || player.name;
    });
    this.onMessage('setAvatar', (client, { data }) => {
      const player = this.state.players.get(client.sessionId);
      if (player && isBoundedImageDataURL(data)) {
        player.avatar = data;
        // Persist to the account so it follows the user across sessions and rooms.
        if (client.auth && client.auth.userId) db.setUserAvatar(client.auth.userId, data).catch(e => console.error('[setAvatar]', e.message));
      }
    });
    this.onMessage('notebook', (client, { text }) => {
      // Private per-player notes: never synced, just held so they survive a reconnect.
      if (typeof text === 'string') this.notebooks.set(client.sessionId, text.slice(0, 4000));
    });
    this.onMessage('timer', (client, msg = {}) => {
      const t = this.state.timer, now = Date.now();
      if (t.running) { t.base = timerLive(t, now); t.running = false; t.since = 0; } // freeze at the live value first
      if (msg.action === 'start') { t.since = now; t.running = true; }
      else if (msg.action === 'reset') { t.base = t.mode === 'down' ? t.duration : 0; }
      else if (msg.action === 'set') {
        if (msg.mode === 'up' || msg.mode === 'down') t.mode = msg.mode;
        if (typeof msg.duration === 'number' && isFinite(msg.duration)) t.duration = clamp(msg.duration, 0, 86400000);
        t.base = t.mode === 'down' ? t.duration : 0; // switching mode / duration resets to the start value
      }
      // 'pause' needs nothing more — the freeze above already did it.
    });

    // Durable scoreboard (helper+): add / remove / rename / adjust / set / clear.
    // Its own clear action — the table Reset deliberately leaves it alone.
    this.onMessage('score', (client, msg = {}) => {
      if (this.rank(client) < RANK.helper) return;
      const s = this.state.scores;
      if (msg.action === 'add') {
        if (s.size >= 50) return; // cap the scoreboard so it can't be spammed unbounded
        s.set('s' + (this.nextScoreId++), new ScoreRow(String(msg.label || 'Player').slice(0, 40), 0));
      } else if (msg.action === 'remove') {
        s.delete(String(msg.id));
      } else if (msg.action === 'label') {
        const row = s.get(String(msg.id)); if (row) row.label = String(msg.label || '').slice(0, 40);
      } else if (msg.action === 'adjust') {
        const row = s.get(String(msg.id)); if (row && isFinite(msg.delta)) row.score = clamp(row.score + Math.trunc(msg.delta), -1e9, 1e9);
      } else if (msg.action === 'set') {
        const row = s.get(String(msg.id)); if (row && isFinite(msg.score)) row.score = clamp(Math.trunc(msg.score), -1e9, 1e9);
      } else if (msg.action === 'clear') {
        s.clear();
      } else return;
      this.scheduleSave();
    });

    // Durable room notes (GM only): the shared free-text field. GM-only editing
    // sidesteps concurrent-edit merges (effectively one writer).
    this.onMessage('roomNotes', (client, { text } = {}) => {
      if (this.rank(client) < RANK.gm || typeof text !== 'string') return;
      this.state.notes = text.slice(0, 8000);
      this.scheduleSave();
    });

    // Resize the play surface (GM+): rebuild the physics bounds + sync the new
    // size so clients rebuild the felt. Durable; the out-of-bounds net nudges any
    // now-outside pieces back in on the next tick.
    this.onMessage('table', (client, msg = {}) => {
      if (this.rank(client) < RANK.gm) return;
      const hx = clamp(+msg.x, TABLE_LIMIT.minX, TABLE_LIMIT.maxX);
      const hz = clamp(+msg.z, TABLE_LIMIT.minZ, TABLE_LIMIT.maxZ);
      if (!isFinite(hx) || !isFinite(hz)) return;
      this.state.tableX = hx; this.state.tableZ = hz;
      this.buildBounds(hx, hz);
      this.scheduleSave();
    });
    this.onMessage('tableColor', (client, msg = {}) => {
      if (this.rank(client) < RANK.gm) return;
      const c = String(msg.color || '');
      if (!/^#[0-9a-f]{6}$/i.test(c)) return;
      this.state.feltColor = c;
      this.scheduleSave();
    });
    // Per-room measurement scale (GM+, durable). A display/snap layer only — it never
    // touches physics or piece sizes. Partial: only provided, valid fields change.
    this.onMessage('scaleSet', (client, msg = {}) => {
      if (this.rank(client) < RANK.gm) return;
      const sc = this.state.scale;
      if (msg.worldPerUnit !== undefined && Number.isFinite(+msg.worldPerUnit) && +msg.worldPerUnit > 0)
        sc.worldPerUnit = clamp(+msg.worldPerUnit, 1e-3, 1e3);
      if (typeof msg.unitLabel === 'string')
        sc.unitLabel = msg.unitLabel.replace(/[\x00-\x1f]/g, '').trim().slice(0, 8);
      if (msg.roundStep !== undefined && Number.isFinite(+msg.roundStep) && +msg.roundStep > 0)
        sc.roundStep = clamp(+msg.roundStep, 1e-3, 1e2);
      if (msg.cellWorld !== undefined && Number.isFinite(+msg.cellWorld) && +msg.cellWorld >= 0)
        sc.cellWorld = clamp(+msg.cellWorld, 0, 1e3);           // cell width (X spacing)
      if (msg.cellZ !== undefined && Number.isFinite(+msg.cellZ) && +msg.cellZ >= 0)
        sc.cellZ = clamp(+msg.cellZ, 0, 1e3);                   // cell depth (Z spacing); 0 = square (= cellWorld)
      if (msg.gridX !== undefined && Number.isFinite(+msg.gridX)) sc.gridX = clamp(+msg.gridX, -1e3, 1e3); // lattice offset X
      if (msg.gridZ !== undefined && Number.isFinite(+msg.gridZ)) sc.gridZ = clamp(+msg.gridZ, -1e3, 1e3); // lattice offset Z
      if (msg.gridStyle === 'square' || msg.gridStyle === 'hex' || msg.gridStyle === 'off')
        sc.gridStyle = msg.gridStyle;
      if (typeof msg.gridHidden === 'boolean') sc.gridHidden = msg.gridHidden; // grid still snaps, just isn't drawn
      if (typeof msg.gridColor === 'string' && /^#[0-9a-f]{6}$/i.test(msg.gridColor))
        sc.gridColor = msg.gridColor;                            // grid line colour (reads on any felt)
      if (msg.gridLift !== undefined && Number.isFinite(+msg.gridLift))
        sc.gridLift = clamp(+msg.gridLift, 0, GRID_LIFT_MAX);    // grid height above the felt
      if (msg.snapAnchor === 'center' || msg.snapAnchor === 'cross')
        sc.snapAnchor = msg.snapAnchor;                          // snap to cell centres or line crossings
      this.scheduleSave();
    });

    // Match the grid to a board on the table: cell size from its footprint ÷ cell count,
    // square style, and the board's snap anchor (chess → cell centres, go → crossings).
    // Boards spawn centred at the origin where the grid is anchored, so no offset needed;
    // the GM can nudge the cell size afterward to account for any border in the model.
    this.onMessage('calibrateGrid', (client, msg = {}) => {
      if (this.rank(client) < RANK.gm) return;
      this.calibrateGrid(msg);
    });

    // --- Overlays: flat measurement/template annotations (not physics) --------
    // Public geometry. They ride the scene snapshot (see serializeScene), so a saved
    // or auto-saved table restores them. Any seated player adds/removes their own;
    // a GM removes any. Capped per-room and per-player so the map can't be spammed.
    const clampCoord = (v) => clamp(+v || 0, -MEASURE.maxLen, MEASURE.maxLen);
    this.onMessage('overlayAdd', (client, msg = {}) => {
      if (!OVERLAY_KINDS.has(msg.kind)) return;
      if (this.state.overlays.size >= OVERLAY_MAX) return;       // room total cap
      let mine = 0;
      this.state.overlays.forEach(o => { if (o.owner === client.sessionId) mine++; });
      if (mine >= OVERLAY_MAX_PER_PLAYER) return;                // per-player cap
      const player = this.state.players.get(client.sessionId);
      const o = new Overlay();
      o.kind = msg.kind;
      o.owner = client.sessionId;
      o.color = (player && player.color) || '#ffffff';
      o.x = clampCoord(msg.x); o.z = clampCoord(msg.z);
      o.x2 = clampCoord(msg.x2); o.z2 = clampCoord(msg.z2);
      o.w = clamp(+msg.w || 0, 0, MEASURE.maxLen);
      o.ang = +msg.ang || 0;
      this.state.overlays.set('o' + (this.nextOverlayId++), o);
    });
    this.onMessage('overlayMove', (client, msg = {}) => {       // reposition (owner or GM) — used from Step 4+
      const o = this.state.overlays.get(String(msg.id));
      if (!o || (o.owner !== client.sessionId && this.rank(client) < RANK.gm)) return;
      if (msg.x !== undefined) o.x = clampCoord(msg.x);
      if (msg.z !== undefined) o.z = clampCoord(msg.z);
      if (msg.x2 !== undefined) o.x2 = clampCoord(msg.x2);
      if (msg.z2 !== undefined) o.z2 = clampCoord(msg.z2);
      if (msg.w !== undefined) o.w = clamp(+msg.w || 0, 0, MEASURE.maxLen);
      if (msg.ang !== undefined) o.ang = +msg.ang || 0;
    });
    this.onMessage('overlayRemove', (client, msg = {}) => {     // delete one (owner or GM)
      const o = this.state.overlays.get(String(msg.id));
      if (!o || (o.owner !== client.sessionId && this.rank(client) < RANK.gm)) return;
      this.state.overlays.delete(String(msg.id));
    });
    this.onMessage('overlayClear', (client, msg = {}) => {     // scope 'all' (GM only) wipes every overlay; anything else clears just your own
      const all = msg.scope === 'all' && this.rank(client) >= RANK.gm, del = [];
      this.state.overlays.forEach((o, id) => { if (all || o.owner === client.sessionId) del.push(id); });
      for (const id of del) this.state.overlays.delete(id);
    });
    // Live measurement preview: a transient relay (NOT synced state), so everyone
    // sees a ruler/template as it's dragged out. A missing/invalid kind means the
    // drag ended — clear the sender's preview. Stamps the sender's id + seat color.
    this.onMessage('overlayDrag', (client, msg = {}) => {
      const player = this.state.players.get(client.sessionId);
      const color = (player && player.color) || '#ffffff';
      const kind = OVERLAY_KINDS.has(msg.kind) ? msg.kind : null;
      const out = kind
        ? { from: client.sessionId, kind, color, x: clampCoord(msg.x), z: clampCoord(msg.z), x2: clampCoord(msg.x2), z2: clampCoord(msg.z2), w: clamp(+msg.w || 0, 0, MEASURE.maxLen), ang: +msg.ang || 0 }
        : { from: client.sessionId, kind: null };
      this.broadcast('overlayDrag', out, { except: client });
    });

    // --- Whiteboard: a synced singleton on a track behind the players ----------
    this.onMessage('wbEnable', (client, { on } = {}) => {
      if (this.rank(client) < RANK.gm) return;             // spawn/enable is GM+
      this.state.whiteboard.enabled = !!on;
      if (!on) { this.strokes = []; this.state.whiteboard.owner = ''; this.broadcast('wbClear'); }
    });
    this.onMessage('wbSet', (client, msg = {}) => {         // slide on the track / flip dark<->light (GM+)
      if (this.rank(client) < RANK.gm) return;
      const wb = this.state.whiteboard;
      if (isFinite(msg.angle)) wb.angle = ((msg.angle % TWO_PI) + TWO_PI) % TWO_PI;
      if (typeof msg.dark === 'boolean') wb.dark = msg.dark;
    });
    this.onMessage('wbClaim', (client) => {                 // double-click to own it (must be enabled + free)
      const wb = this.state.whiteboard;
      if (wb.enabled && !wb.owner) wb.owner = client.sessionId;
    });
    this.onMessage('wbRelease', (client) => {               // exit inspect -> release
      const wb = this.state.whiteboard;
      if (wb.owner === client.sessionId) wb.owner = '';
    });
    this.onMessage('wbStroke', (client, stroke) => {        // owner draws; everyone else replays it
      if (this.state.whiteboard.owner !== client.sessionId || !validStroke(stroke)) return;
      stroke.sid = client.sessionId;                        // tag the drawer so their own echo is ignored client-side
      this.strokes.push(stroke);
      if (this.strokes.length > WHITEBOARD_MAX_STROKES) this.strokes.shift();
      this.broadcast('wbStroke', stroke);                   // to everyone (matches ping/wbClear, which deliver reliably)
    });
    this.onMessage('wbClear', (client) => {                 // owner or GM+ wipes it
      if (this.state.whiteboard.owner !== client.sessionId && this.rank(client) < RANK.gm) return;
      this.strokes = [];
      this.broadcast('wbClear');
    });
    this.onMessage('wbStrokes', (client) => client.send('wbStrokes', { strokes: this.strokes })); // late-join replay

    // --- Dice trays: one PERSONAL physics box per seat, on the track behind that player -----
    // No rank gate — a player toggles only their OWN tray. Putting it away clears its dice too.
    this.onMessage('trayShow', (client, { on } = {}) => {
      const seat = this.seatOf(client); if (seat == null) return;
      if (on) this.state.trays.set(String(seat), true);
      else { this.state.trays.delete(String(seat)); this.clearTraySeat(seat); }
      this.buildTrays();
    });

    // Public text chat — broadcast to the room, keep a small rolling history for late joiners.
    this.onMessage('chat', (client, { text } = {}) => {
      const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 400);
      if (!t) return;
      const player = this.state.players.get(client.sessionId);
      const msg = { from: (player && player.name) || 'Player', text: t, ts: Date.now() };
      this.chatLog.push(msg);
      if (this.chatLog.length > 80) this.chatLog.shift();
      this.broadcast('chatMsg', msg);
    });
    this.onMessage('chatLog', (client) => client.send('chatLog', { log: this.chatLog })); // late-join replay

    // --- Skybox: per-room panorama, GM-applied + synced; library is admin-only ---
    this.onMessage('skybox', (client, { url } = {}) => {
      if (this.rank(client) < RANK.gm) return;             // changing the room's skybox is GM+
      const u = url == null ? '' : String(url);
      if (!validSky(u)) return;
      this.state.skybox = u;
      this.scheduleSave();                                 // durable, like the board/table
    });
    this.onMessage('listSkyboxes', (client) => this.sendAssetList(client, 'sky'));
    this.onMessage('handSync', (client) => this.sendHand(client)); // re-send private hand (e.g. after a page refresh/reconnect)
    this.onMessage('saveSkybox', async (client, msg = {}) => {
      if (!this.isAdmin(client)) return;                   // curating the library is admin-only
      const fail = (message) => client.send('skyError', { message });
      const name = String(msg.name || '').slice(0, 60).trim();
      if (!name) return fail('Give it a name.');
      let ref;                                             // the stored reference: an equirect URL or a cube descriptor
      if (msg.type === 'cube') {
        const faces = Array.isArray(msg.faces) ? msg.faces.map(String) : [];
        if (faces.length !== 6) return fail('A cubemap needs exactly six faces.');
        if (!faces.every(u => u.startsWith('/assets/sky/') && skyUrlOk(u))) return fail('Each face must be an uploaded image.');
        ref = JSON.stringify({ t: 'cube', f: faces });
      } else {
        const url = String(msg.url || '');
        if (!url.startsWith('/assets/sky/') || !skyUrlOk(url)) return fail('Upload a panorama image first.');
        ref = url;
      }
      try { await db.insertSkybox({ name, url: ref, ownerId: client.auth.userId, isPublic: msg.isPublic !== false }); this.sendAssetList(client, 'sky'); }
      catch (e) { console.error('[saveSkybox]', e.message); fail('Server error saving the skybox.'); }
    });
    // Hold-to-show: reveal some of your hand, face-up in your seat fan, but only
    // to the chosen audience. Content goes out privately (like a hand); everyone
    // else just sees the public 'showing' count as a badge. Released → showStop.
    this.onMessage('showStart', (client, { to, hids } = {}) => {
      const sid = client.sessionId;
      const hand = this.hands.get(sid) || [];
      if (!hand.length) return;
      const cards = hids === 'all' ? hand.slice()
                  : Array.isArray(hids) ? hand.filter(c => hids.includes(c.hid))
                  : null;
      if (!cards || !cards.length) return;
      const audience = new Set();
      if (to === 'all') this.state.players.forEach((_, s) => { if (s !== sid) audience.add(s); });
      else if (Array.isArray(to)) for (const s of to) { if (s !== sid && this.state.players.has(s)) audience.add(s); }
      if (!audience.size) return;

      this.stopShow(sid); // replace any prior show
      this.shows.set(sid, { to: audience, cards });
      const player = this.state.players.get(sid);
      if (player) player.showing = cards.length; // public badge (count only)
      const payload = cards.map(c => ({ front: c.front, back: c.back }));
      for (const viewer of audience) {
        const cl = this.clientBy(viewer);
        if (cl) cl.send('showFan', { sid, cards: payload }); // private content, to the audience alone
      }
    });
    this.onMessage('showStop', (client) => this.stopShow(client.sessionId));
    this.onMessage('ping', (client, { x, z } = {}) => {
      // A transient "look here" marker. Public by nature, so just clamp to the
      // table and broadcast to everyone (the sender sees their own ping too).
      if (!isFinite(x) || !isFinite(z)) return;
      this.broadcast('ping', { sid: client.sessionId, x: clamp(x, -this.state.tableX, this.state.tableX), z: clamp(z, -this.state.tableZ, this.state.tableZ) });
    });

    this.setSimulationInterval((dt) => this.update(dt), 1000 / 60); // fixed 60Hz sim
    this.setPatchRate(1000 / 60); // 60Hz state broadcast (delta-compressed; cheap on LAN)
  }

  // Create a piece: a physics body + a synced Piece record, wired together by id.
  // pos is [x,y,z]; props are the type-specific fields (shape, sides, back, …).
  spawn(type, pos, props = {}, quat = null) {
    const mass = type === 'prop' ? (PROPS[props.shape] || PROPS.box).mass : KINDS[type].mass;
    const body = new CANNON.Body({ mass, material: this.mat });
    const collider = buildCollider(type, props);
    if (collider.shape) body.addShape(collider.shape, collider.offset); // some colliders (flat) sit off-centre
    else body.addShape(collider);
    body.position.set(pos[0], pos[1], pos[2]);

    // An exact orientation (scene load) wins; otherwise dice/props tumble, boards/decks stay flat.
    if (quat && quat.length === 4) {
      body.quaternion.set(quat[0], quat[1], quat[2], quat[3]);
    } else if (KINDS[type].mass > 0 && type !== 'deck' && type !== 'dispenser') {
      body.quaternion.setFromEuler(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    }
    // Cards get their own damping/sleep tuning so stacks settle nicely.
    if (type === 'card') {
      body.angularDamping = SIM.cards.angDamp;
      body.linearDamping = SIM.cards.linDamp;
      body.sleepSpeedLimit = SIM.cards.sleepSpeed;
      body.sleepTimeLimit = SIM.cards.sleepTime;
    } else {
      body.angularDamping = (type === 'deck') ? SIM.damp.flat : SIM.damp.solid;
    }
    if (props.traySeat != null) body.__traySeat = +props.traySeat; // a tray die obeys its seat's tray bounds, not the table's
    this.world.addBody(body);

    const id = String(this.nextId++);
    const piece = new Piece();
    piece.type = type;
    piece.owner = '';
    piece.count = 0;
    piece.props = '{}';

    if (type === 'deck') {
      // A deck's cards + order are PRIVATE (deckCards); only the shared back is
      // published, which is all a client needs to render the face-down stack.
      const deckData = props.set === 'domino'
        ? buildDominoSet()                                              // a domino boneyard, spawned on its own (no starter/table-clear)
        : props.set === 'letter'
          ? buildScrabbleBag()                                          // a Wordy McWordface letter bag on its own
          : props.set === 'mahjong'
            ? buildMahjongWall()                                        // a 144-tile mahjong wall on its own
            : (props.cards && props.cards.length)
            ? { back: props.back || 'back', cards: props.cards, ...geoOf(props), deckModel: props.deckModel } // pre-built cards (e.g. a starter) can carry a skin
            : buildSimpleDeck(!!props.jokers);
      this.deckCards.set(id, deckData.cards.slice());
      piece.count = deckData.cards.length;
      const deckProps = { back: deckData.back, ...geoOf(deckData) }; // deck-level tile/geom rides to its cards
      if (deckData.deckModel && DECK_MODELS[deckData.deckModel]) deckProps.model = deckData.deckModel; // an optional 3D box/bag skin (server-set only)
      piece.props = JSON.stringify(deckProps);
    } else if (type === 'dispenser') {
      const d = DISPENSERS[props.disp] || {};
      piece.count = (d.infinite || !d.count) ? 0 : clamp(+props.count || d.count.def, 1, d.count.max); // remaining items (0 = infinite)
      piece.props = JSON.stringify(props);
    } else {
      piece.props = JSON.stringify(props);
    }

    this.writeTransform(piece, body);
    this.state.pieces.set(id, piece);
    this.bodies.set(id, body);
    body.addEventListener('collide', (e) => {                       // landing sound, only for pieces a player just dropped
      const rel = this._released.get(id);
      if (rel === undefined) return;                                 // deals/rolls/idle collisions stay silent here
      if (Date.now() - rel > 3000) { this._released.delete(id); return; } // never really landed — disarm
      if (Math.abs(e.contact.getImpactVelocityAlongNormal()) < SIM.impact.minVel) return; // ignore gentle grazes
      this._released.delete(id);                                     // one cue per drop (kills multi-bounce spam)
      this.broadcast('sfx', { type: dropSfx(type, props) });         // props carries `tile` for tile pieces/decks
    });
    if (type === 'deck') this.updateDeckCollider(id); // match the collider to the stack height
    if (type === 'dispenser') this.updateStackCollider(id); // stack cylinder ∝ count (no-op for a bowl)
    return id;
  }

  // --- Small card helpers (shared by the deal/draw/play handlers) -------------

  // Spawn a card lying flat at pos (no random tumble); returns its id. Callers
  // set the private front (cardData) and/or owner afterward as needed.
  spawnCardFlat(pos, publicProps) {
    if (publicProps && publicProps.snap && gridActive(this.state.scale)) { // a word tile played onto the board snaps into its cell
      const p = snapToCell(pos[0], pos[2], this.state.scale);
      pos = [p.x, pos[1], p.z];
    }
    const id = this.spawn('card', pos, publicProps);
    const body = this.bodies.get(id);
    body.quaternion.set(0, 0, 0, 1);
    this.writeTransform(this.state.pieces.get(id), body);
    return id;
  }

  // A drop spot just to the side of a deck, with a little random scatter.
  besideDeck(deckBody) {
    return [
      deckBody.position.x + 1.7 + Math.random() * 0.4,
      2.5,
      deckBody.position.z + (Math.random() - 0.5) * 0.6,
    ];
  }

  // Add a card to a player's private hand and push the update to them alone.
  addToHand(client, front, back, geo = {}) {
    const hand = this.hands.get(client.sessionId) || [];
    hand.push({ hid: 'h' + (this.nextHid++), front, back, ...geo }); // geo = {tile}/{geom} for tile cards; nothing for plain cards
    this.hands.set(client.sessionId, hand);
    this.sendHand(client);
  }

  // Replace the current board with a new one (there's only ever one). The board
  // rests on the table by its own half-height so it sits flush, not sunk in.
  swapBoard(props) {
    const oldBoards = [];
    this.state.pieces.forEach((piece, id) => { if (piece.type === 'board') oldBoards.push(id); });
    oldBoards.forEach(id => this.removePiece(id));

    const builtin = props.board && BOARDS[props.board];
    const box = builtin ? builtin.box
              : (props.model && Array.isArray(props.box)) ? props.box
              : null;
    return this.spawn('board', [0, box ? box[1] : 0.05, 0], props);
  }

  // Set the room's square grid from the current board's real size: cell = board width ÷ gaps.
  // Built-in boards store the gap count + anchor; a custom board takes them from `msg`. Returns
  // { cellX, cellZ, gaps, anchor } (or null) so a starter setup can place pieces on the squares.
  calibrateGrid(msg = {}) {
    let boardId = null;
    this.state.pieces.forEach((p, id) => { if (!boardId && p.type === 'board') boardId = id; }); // the single table board
    if (!boardId) return null;
    const spec = BOARDS[JSON.parse(this.state.pieces.get(boardId).props || '{}').board];
    let gaps, anchor;
    if (spec && spec.grid) { gaps = spec.grid.cells; anchor = spec.grid.anchor; }
    else { anchor = msg.anchor === 'cross' ? 'cross' : 'center'; const count = Math.round(+msg.cells); gaps = anchor === 'cross' ? count - 1 : count; }
    if (!(gaps > 0)) return null;
    const sc = this.state.scale;
    // A board can pin its exact printed-line spacing (cellX/cellZ) — needed when a wide border
    // means the lines don't fill the collider (go). Otherwise derive cell = board width ÷ gaps.
    if (spec && spec.grid && spec.grid.cellX > 0) {
      sc.cellWorld = clamp(spec.grid.cellX, 1e-3, 1e3);
      sc.cellZ = clamp(spec.grid.cellZ > 0 ? spec.grid.cellZ : spec.grid.cellX, 1e-3, 1e3);
    } else {
      const body = this.bodies.get(boardId), shape = body && body.shapes[0];
      const he = shape && shape.halfExtents;
      const wx = he ? he.x * 2 : 0, wz = he ? he.z * 2 : 0;
      if (!(wx > 0) || !(wz > 0)) return null;
      sc.cellWorld = clamp(wx / gaps, 1e-3, 1e3);
      sc.cellZ = clamp(wz / gaps, 1e-3, 1e3);
    }
    sc.gridX = 0; sc.gridZ = 0;              // the board is centred at the origin, so no offset
    sc.gridStyle = 'square';
    sc.snapAnchor = anchor === 'cross' ? 'cross' : 'center';
    this.scheduleSave();
    return { cellX: sc.cellWorld, cellZ: sc.cellZ, gaps, anchor: sc.snapAnchor };
  }

  // Deal `n` cards from a deck to each SEATED player's private hand (starter setups deal a
  // starting rack, e.g. dominoes). The deck's tile/geom rides along so held tiles keep their
  // shape. Trims the deck and removes it if it empties.
  dealFromDeckToSeats(deckId, n) {
    const deck = this.state.pieces.get(deckId), cards = this.deckCards.get(deckId);
    if (!deck || !cards) return;
    const dp = JSON.parse(deck.props || '{}'), back = dp.back || 'back', geo = geoOf(dp);
    for (const client of this.clients) {
      if (this.seatOf(client) == null) continue;                        // seated players only
      for (let i = 0; i < n && cards.length; i++) this.addToHand(client, cards.pop(), back, geo);
    }
    deck.count = cards.length;
    if (!cards.length) this.removePiece(deckId); else this.updateDeckCollider(deckId);
  }

  // Load a ready-to-play starter game: clear the table, then set up the board + pieces (or the
  // deck + chips) so a host has a complete game in one click. Replaces the whole table (GM+).
  setupStarter(game) {
    const def = STARTERS[game]; if (!def) return false;
    this.clearTable();
    let gridded = false;
    if (def.board) {
      this.swapBoard({ board: def.board });
      // Turn on the board's grid: chess/checkers derive cell = width ÷ cells; go pins its exact
      // printed-line spacing (BOARDS.go.grid.cellX/cellZ) so its bordered lines line up.
      const grid = this.calibrateGrid();
      if (grid) {
        gridded = true;
        this.state.scale.gridHidden = true;                     // starter games snap to the grid but don't draw it
        if (def.pieces) {
          const cells = def.cells || 8, half = (cells - 1) / 2;
          const boardTop = (BOARDS[def.board].box[1] || 0.15) * 2; // board sits at y=box[1], half-height box[1]
          for (const p of def.pieces()) {
            if (this.state.pieces.size >= SIM.maxPieces) break;
            const x = (p.col - half) * grid.cellX, z = (p.row - half) * grid.cellZ;
            const box = ((PROPS[p.shape] || {}).collider || {}).box;
            const restY = boardTop + (box ? box[1] : 0.2) + 0.03;  // sit it ON the board, no drop-tumble
            // Identity quaternion → spawn UPRIGHT (no random tumble), so tall pieces don't fall
            // across neighbouring squares and knock the set over as they settle.
            this.spawn('prop', [x, restY, z], { shape: p.shape, team: p.team, snap: true }, [0, 0, 0, 1]);
          }
        }
      }
    }
    if (!gridded) { this.state.scale.gridStyle = 'off'; this.scheduleSave(); } // board-less games (poker/dominoes): no stale grid
    for (const b of (def.bowls || [])) this.spawn('dispenser', [b.x, SIM.spawnY, b.z], { disp: b.disp, team: b.team });
    if (def.deck) {
      const d = def.deck === true ? {} : def.deck;                       // {set?, deal?, jokers?}
      const built = d.set === 'domino' ? buildDominoSet() : d.set === 'letter' ? buildScrabbleBag() : d.set === 'mahjong' ? buildMahjongWall() : buildSimpleDeck(!!d.jokers);
      const deckId = this.spawn('deck', [0, SIM.spawnY, def.deckZ ?? 0], { back: built.back, cards: built.cards, ...geoOf(built), deckModel: built.deckModel }); // carry the box/bag skin, if any
      if (d.deal > 0) this.dealFromDeckToSeats(deckId, d.deal);          // deal a starting rack to each seated player
    }
    for (const s of (def.stacks || [])) this.spawn('dispenser', [s.x, SIM.spawnY, s.z], { disp: s.disp, color: s.color });
    return true;
  }

  // Rebuild a deck's collider box so its height matches its current card count.
  updateDeckCollider(deckId) {
    const body = this.bodies.get(deckId), piece = this.state.pieces.get(deckId);
    if (!body || !piece) return;
    while (body.shapes.length) body.removeShape(body.shapes[0]);
    const props = JSON.parse(piece.props || '{}');
    const skin = props.model && DECK_MODELS[props.model];
    if (skin) {                                            // a modeled deck (box/bag): a fixed box, not a growing stack
      const [bx, by, bz] = skin.box;
      body.addShape(new CANNON.Box(new CANNON.Vec3(bx, by, bz)));
    } else {
      const g = cardGeom(props);                           // a deck of tiles is shaped like its tiles
      const hy = deckHeight(piece.count) / 2;              // footprint = the card exactly (matches deckMesh)
      body.addShape(g.shape === 'hex'
        ? new CANNON.Cylinder(g.hh, g.hh, hy * 2, 6)       // a hex deck is a hex stack (radius = circumradius)
        : new CANNON.Box(new CANNON.Vec3(g.hw, hy, g.hh)));
    }
    body.updateBoundingRadius();
    body.updateMassProperties();
    body.wakeUp();
  }

  // --- Dispensers: hand out copies of a child piece (shared by dispense/dispenseDrag) ---

  // Rebuild a stack dispenser's cylinder collider to its current count (no-op for a bowl).
  updateStackCollider(id) {
    const body = this.bodies.get(id), piece = this.state.pieces.get(id);
    if (!body || !piece) return;
    const d = DISPENSERS[JSON.parse(piece.props || '{}').disp];
    if (!d || d.body !== 'stack') return;
    const box = PROPS[d.item].collider.box, r = box[0], discH = box[1] * 2;
    while (body.shapes.length) body.removeShape(body.shapes[0]);
    body.addShape(new CANNON.Cylinder(r, r, Math.max(discH, stackVisible(piece.count) * discH), 16));
    body.updateBoundingRadius();
    body.updateMassProperties();
    body.wakeUp();
  }

  // The spawn spec a dispenser hands out: an existing PROP, tinted (poker/coin) or
  // team-colored (go bowl) from the dispenser's own config.
  dispenserItem(piece) {
    const props = JSON.parse(piece.props || '{}');
    const d = DISPENSERS[props.disp]; if (!d) return null;
    const itemProps = { shape: d.item };
    if (d.team) itemProps.team = props.team ? 1 : 0;          // go bowl → a team stone
    else if (props.color != null) itemProps.color = props.color | 0; // poker/coin → tint
    if (PROPS[d.item] && PROPS[d.item].team) itemProps.snap = true;   // grid-game items (go stones) snap by default
    return { type: 'prop', props: itemProps };
  }

  // After a dispense: a finite dispenser shrinks and is removed when empty; an
  // infinite one (bowl) is unchanged.
  afterDispense(piece, id) {
    const d = DISPENSERS[JSON.parse(piece.props || '{}').disp];
    if (!d || d.infinite) return;
    piece.count = Math.max(0, piece.count - 1);
    if (piece.count <= 0) this.removePiece(id);
    else this.updateStackCollider(id);
  }

  // Write a table deck to the disk library; returns true on success. Any inline
  // image art (data-URLs) is moved to files so the saved JSON stays small.
  async saveDeckById(deckId, name, ownerId = null) {
    const fronts = this.deckCards.get(deckId), piece = this.state.pieces.get(deckId);
    if (!fronts || !fronts.length || !piece || piece.type !== 'deck') return false;
    const cleanName = String(name || '').slice(0, 60).trim();
    if (!cleanName) return false;
    try {
      let back = JSON.parse(piece.props || '{}').back || 'back';
      if (isDataURL(back)) back = saveImageRef(back, 'decks') || 'back';   // inline art -> file, store the URL
      const savedFronts = fronts.map(front => isDataURL(front) ? (saveImageRef(front, 'decks') || front) : front);
      await db.insertDeck({ name: cleanName, back, fronts: savedFronts, ownerId }); // private by default
      return true;
    } catch (e) {
      console.error('[saveDeckById]', e.message);
      return false;
    }
  }

  // The effective self-right mode for a piece:
  //   true   → keep it standing tall (chess, tokens)
  //   'flat' → keep it lying flat (decks, checkers, coins)
  //   falsy  → don't self-right at all
  standOf(piece) {
    const props = JSON.parse(piece.props || '{}');
    if (props.stand !== undefined) return props.stand; // per-instance override (the U-key toggle)
    if (piece.type === 'deck' || piece.type === 'dispenser') return 'flat'; // stacks/bowls settle flat
    return (PROPS[props.shape] || {}).stand;           // else the prop shape's default
  }
  // Which mode to switch a piece INTO when the toggle turns self-right on. Uses
  // the shape's declared default, or infers "flat" when the collider is thin on Y
  // (so a coin/checker lies down) and "stand tall" otherwise.
  naturalStand(piece) {
    if (piece.type === 'deck' || piece.type === 'dispenser') return 'flat';
    const props = JSON.parse(piece.props || '{}'), spec = PROPS[props.shape] || {};
    if (spec.stand) return spec.stand;
    const box = spec.collider && spec.collider.box;
    return (box && box[1] <= box[0] && box[1] <= box[2]) ? 'flat' : true;
  }

  // Delete a piece everywhere: physics body, synced state, and every private map.
  removePiece(id) {
    const body = this.bodies.get(id);
    if (body) this.world.removeBody(body);
    this.bodies.delete(id);
    this.targets.delete(id);
    this.flips.delete(id);
    this.deckCards.delete(id);
    this.cardData.delete(id);
    this.state.pieces.delete(id);
  }

  // Apply a color to one piece, validating by type (shared by the single `recolor` message and
  // the `recolorGroup` batch). Returns true if it changed. A die takes body + number color; a
  // prop takes body; a poker/coin dispenser takes its tint; a team bowl takes a team flag.
  // Anything else — cards, boards — is left untouched. Writing props re-syncs it to every client.
  recolorPiece(id, opts = {}) {
    const piece = this.state.pieces.get(id);
    if (!piece) return false;
    const props = JSON.parse(piece.props || '{}');
    const dispDef = piece.type === 'dispenser' ? DISPENSERS[props.disp] : null;
    const next = colorProps(piece.type, props, opts, dispDef);
    if (!next) return false;
    piece.props = JSON.stringify(next); // synced → every client rebuilds the piece with the new tint
    return true;
  }

  // Send a player their private hand, and publish only its COUNT to everyone
  // else (so others can draw the right-sized fan without seeing the cards).
  sendHand(client) {
    const hand = this.hands.get(client.sessionId) || [];
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.hand = hand.length;                                    // public count only
      player.handBack = hand.length ? (hand[0].back || '') : '';    // public back image (the front stays private)
    }
    client.send('hand', hand);             // private contents, to this client alone
  }

  clientBy(sid) { return this.clients.find(c => c.sessionId === sid); }

  // Build (or rebuild) the table surface + four containment walls at the given
  // half-extents. Called on create and whenever the GM resizes the table.
  buildBounds(hx, hz) {
    const w = this.world, mat = w.__mat;
    for (const b of (this._bounds || [])) w.removeBody(b); // drop the previous surface + walls
    this._bounds = [];
    const add = (body) => { w.addBody(body); this._bounds.push(body); };
    const table = new CANNON.Body({ mass: 0, material: mat }); // surface sits just below y=0
    table.addShape(new CANNON.Box(new CANNON.Vec3(hx, SIM.tableThick, hz)));
    table.position.set(0, -SIM.tableThick, 0);
    add(table);
    const thick = SIM.wall.thick, overlap = SIM.wall.over;
    const wall = (px, pz, whx, whz) => { const b = new CANNON.Body({ mass: 0, material: mat }); b.addShape(new CANNON.Box(new CANNON.Vec3(whx, SIM.wall.half, whz))); b.position.set(px, SIM.wall.half, pz); add(b); };
    wall(0, -(hz + thick), hx + overlap, thick); // near / far
    wall(0,  (hz + thick), hx + overlap, thick);
    wall(-(hx + thick), 0, thick, hz + overlap); // left / right
    wall( (hx + thick), 0, thick, hz + overlap);
    this.buildTrays(); // the personal trays ride the same track; rebuild against the new table size
  }

  // The world-space centre of seat N's tray (on the track, behind that seat).
  trayCenterFor(seat) { return trayCenter(seatAngle(seat), this.state.tableX, this.state.tableZ); }

  // Build / rebuild the physics (floor + walls + lid) for EVERY enabled seat's tray, each at
  // its seat angle. Bodies are tagged `__traySeat` so the out-of-bounds net can send a stray
  // die back to the right tray. Called when a tray is toggled or the table is resized; before
  // rebuilding, tray dice are moved to their seat's new centre so they stay inside their walls.
  buildTrays() {
    const w = this.world, mat = w.__mat;
    for (const b of (this._trayBounds || [])) w.removeBody(b);
    this._trayBounds = [];
    this.repositionTrayDice(); // walls are about to move (resize/rebuild) — carry the dice along
    this.state.trays.forEach((on, seatKey) => {
      if (!on) return;
      const seat = +seatKey, angle = seatAngle(seat);
      const center = this.trayCenterFor(seat);
      const spin = new CANNON.Quaternion(); spin.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), angle);
      for (const part of trayParts()) {
        const b = new CANNON.Body({ mass: 0, material: mat });
        b.addShape(new CANNON.Box(new CANNON.Vec3(part.hx, part.hy, part.hz)));
        const p = trayPlace(part, center, angle);
        b.position.set(p.x, p.y, p.z);
        b.quaternion.copy(spin);
        b.__traySeat = seat;
        w.addBody(b); this._trayBounds.push(b);
      }
    });
  }

  // Keep each tray die glued to its seat's tray as the track radius changes (table resize):
  // clamp it back inside that seat's current footprint. Cheap and only matters on resize.
  repositionTrayDice() {
    if (!this.bodies) return; // buildBounds() runs in onCreate before the bodies map exists — nothing to move yet
    this.bodies.forEach((body, id) => {
      if (body.__traySeat == null) return;
      const seat = body.__traySeat, angle = seatAngle(seat), c = this.trayCenterFor(seat);
      if (inTray(body.position.x, body.position.z, c, angle, 0.2)) return; // still inside → leave it
      const p = trayPlace({ x: 0, y: 1, z: 0 }, c, angle);
      body.position.set(p.x, p.y, p.z); body.velocity.setZero(); body.angularVelocity.setZero(); body.wakeUp();
    });
  }

  // A drop point for a new die in SEAT's tray: a random spot inside its footprint, above the
  // floor (below the wall tops) so it tumbles in.
  trayDropPos(seat) {
    const c = this.trayCenterFor(seat), angle = seatAngle(seat);
    const lx = (Math.random() * 2 - 1) * (TRAY.hx - 0.7);
    const lz = (Math.random() * 2 - 1) * (TRAY.hz - 0.7);
    const p = trayPlace({ x: lx, y: 1.3, z: lz }, c, angle);
    return [p.x, p.y, p.z];
  }

  // The caller's seat, or null if they're not seated (can't own a tray).
  seatOf(client) { const p = this.state.players.get(client.sessionId); const s = p ? +p.seat : -1; return (s >= 0 && s < SEAT_ANGLES.length) ? s : null; }

  // Release one piece: clear ownership, then snap it to its grid cell (snap flag) or turn the
  // hand-speed `v` into a capped throw; finally absorb a card back onto a deck, or a chip/stone
  // back onto its dispenser, if it was dropped there. Shared by single `release` and `releaseGroup`.
  releasePiece(id, v) {
    const piece = this.state.pieces.get(id);
    if (!piece) return;
    piece.owner = '';
    this.targets.delete(id);
    this._released.set(id, Date.now()); // arm a one-shot landing cue on its next hard impact

    const body = this.bodies.get(id);
    if (body) {
      if (piece.type !== 'deck' && gridActive(this.state.scale) && JSON.parse(piece.props || '{}').snap) {
        const p = snapToCell(body.position.x, body.position.z, this.state.scale); // the bag carries snap for its tiles, but shouldn't itself jump to a cell
        body.position.x = p.x; body.position.z = p.z;
        body.velocity.set(0, 0, 0); body.angularVelocity.set(0, 0, 0);
      } else if (v) {
        let [vx, vy, vz] = v;
        const speed = Math.hypot(vx, vy, vz);
        const cap = piece.type === 'card' ? SIM.cards.maxThrow : SIM.throwCap;
        const scale = speed > cap ? cap / speed : 1;
        body.velocity.set(vx * scale, vy * scale, vz * scale);
      }
      body.wakeUp();
    }

    // If a card is dropped on top of a deck, absorb it back onto the stack.
    if (piece.type === 'card' && body) {
      for (const [deckId, cards] of this.deckCards) {
        const deckBody = this.bodies.get(deckId);
        if (!deckBody) continue;
        const onDeck = Math.abs(body.position.x - deckBody.position.x) < SIM.absorb.x
                    && Math.abs(body.position.z - deckBody.position.z) < SIM.absorb.z;
        if (onDeck) {
          const front = (this.cardData.get(id) || {}).front || JSON.parse(piece.props || '{}').front;
          if (front) cards.push(front);
          this.state.pieces.get(deckId).count = cards.length;
          this.updateDeckCollider(deckId);
          this.removePiece(id);
          break;
        }
      }
    }

    // A chip/coin/stone dropped on its matching dispenser rejoins it (finite → count++; the
    // infinite bowl just takes it back). Match by the exact item the stack hands out.
    if (piece.type === 'prop' && body) {
      const pp = JSON.parse(piece.props || '{}');
      for (const [dispId, disp] of this.state.pieces) {
        if (disp.type !== 'dispenser') continue;
        const want = this.dispenserItem(disp); if (!want || want.props.shape !== pp.shape) continue;
        if (want.props.color != null && (pp.color | 0) !== (want.props.color | 0)) continue;
        if (want.props.team != null && (pp.team ? 1 : 0) !== want.props.team) continue;
        const dispBody = this.bodies.get(dispId);
        if (!dispBody) continue;
        const d = DISPENSERS[JSON.parse(disp.props || '{}').disp];
        const fbox = d && (d.body === 'stack' ? (PROPS[d.item].collider.box) : (d.collider && d.collider.box));
        const reach = (fbox ? Math.max(fbox[0], fbox[2]) : 0.5) + 0.5;
        const dx = body.position.x - dispBody.position.x, dz = body.position.z - dispBody.position.z;
        if (dx * dx + dz * dz < reach * reach) {
          if (d && !d.infinite) { disp.count = (disp.count | 0) + 1; this.updateStackCollider(dispId); }
          this.removePiece(id);
          this.broadcast('sfx', { type: 'object-drop' });
          break;
        }
      }
    }
  }

  // Remove every die belonging to seat N's tray (used by Clear and by putting the tray away).
  clearTraySeat(seat) {
    const ids = [];
    this.state.pieces.forEach((piece, id) => { const b = this.bodies.get(id); if (piece.type === 'die' && b && b.__traySeat === seat) ids.push(id); });
    for (const id of ids) this.removePiece(id);
  }

  // Wipe every piece + its private bookkeeping (shared by Reset and scene load).
  // Leaves the timer, scoreboard, notes, and table size alone.
  clearTable() {
    const ids = [];
    this.state.pieces.forEach((piece, id) => ids.push(id));
    for (const id of ids) this.removePiece(id);
    this.hands.clear();
    this.pendingInspect.clear();
    this.drafts.clear();
    this.deckCards.clear();
    this.cardData.clear();
    this.flips.clear();
    this.targets.clear();
    for (const sid of [...this.shows.keys()]) this.stopShow(sid); // end any live reveals
    for (const client of this.clients) this.sendHand(client);      // clear every player's hand
    this.state.overlays.clear();                                   // wipe measurement/template overlays
  }

  // Serialize the current table into a scene payload: the table size, and every
  // piece with its transform. A deck's private card list rides along so it comes
  // back as a real deck; a face-down card carries its private front.
  // The per-room scale as a plain object (grid + measurement calibration), for both the
  // durable room row and the scene snapshot, so a saved scene restores its grid/units too.
  scaleSnapshot() {
    const sc = this.state.scale;
    return { worldPerUnit: sc.worldPerUnit, unitLabel: sc.unitLabel, roundStep: sc.roundStep,
             cellWorld: sc.cellWorld, cellZ: sc.cellZ, gridX: sc.gridX, gridZ: sc.gridZ,
             gridStyle: sc.gridStyle, gridColor: sc.gridColor, gridLift: sc.gridLift, snapAnchor: sc.snapAnchor, gridHidden: sc.gridHidden };
  }
  // Validate + apply a scale object (from the room row or a scene). Every field is optional
  // and range-checked, so an old/partial snapshot just keeps the current defaults.
  applyScale(s) {
    if (!s || typeof s !== 'object') return;
    const sc = this.state.scale;
    if (Number.isFinite(+s.worldPerUnit) && +s.worldPerUnit > 0) sc.worldPerUnit = clamp(+s.worldPerUnit, 1e-3, 1e3);
    if (typeof s.unitLabel === 'string') sc.unitLabel = s.unitLabel.slice(0, 8);
    if (Number.isFinite(+s.roundStep) && +s.roundStep > 0) sc.roundStep = clamp(+s.roundStep, 1e-3, 1e2);
    if (Number.isFinite(+s.cellWorld) && +s.cellWorld >= 0) sc.cellWorld = clamp(+s.cellWorld, 0, 1e3);
    if (Number.isFinite(+s.cellZ) && +s.cellZ >= 0) sc.cellZ = clamp(+s.cellZ, 0, 1e3);
    if (Number.isFinite(+s.gridX)) sc.gridX = clamp(+s.gridX, -1e3, 1e3);
    if (Number.isFinite(+s.gridZ)) sc.gridZ = clamp(+s.gridZ, -1e3, 1e3);
    if (/^#[0-9a-f]{6}$/i.test(s.gridColor || '')) sc.gridColor = s.gridColor;
    if (Number.isFinite(+s.gridLift)) sc.gridLift = clamp(+s.gridLift, 0, GRID_LIFT_MAX);
    if (s.snapAnchor === 'center' || s.snapAnchor === 'cross') sc.snapAnchor = s.snapAnchor;
    if (s.gridStyle === 'square' || s.gridStyle === 'hex' || s.gridStyle === 'off') sc.gridStyle = s.gridStyle;
    if (typeof s.gridHidden === 'boolean') sc.gridHidden = s.gridHidden;
  }

  // Restore which seats' trays are out from a scene (an array of seat indices), then rebuild
  // their walls. Absent → no trays (older scenes have none). The tray DICE ride as pieces.
  applyTrays(seats) {
    this.state.trays.clear();
    for (const s of (Array.isArray(seats) ? seats : [])) {
      const seat = +s; if (seat >= 0 && seat < SEAT_ANGLES.length) this.state.trays.set(String(seat), true);
    }
    this.buildTrays();
  }

  serializeScene() {
    const pieces = [];
    this.state.pieces.forEach((piece, id) => {
      let props = JSON.parse(piece.props || '{}');
      if (piece.type === 'deck') {
        const cards = (this.deckCards.get(id) || []).slice();
        for (const pend of this.pendingInspect.values()) if (pend.deckId === id) cards.unshift(pend.front); // fold a mid-inspect draw back onto its deck so a save never loses it
        // Serialize the box/bag skin as `deckModel` (the spawn-input name) so it round-trips on restore.
        props = { back: props.back || 'back', cards, ...geoOf(props), ...(props.model ? { deckModel: props.model } : {}) };
      }
      else if (piece.type === 'card') { const cd = this.cardData.get(id); if (cd && cd.front) props = { ...props, front: cd.front, faceDown: true }; }
      pieces.push({ type: piece.type, props, x: piece.x, y: piece.y, z: piece.z, q: [piece.qx, piece.qy, piece.qz, piece.qw] });
    });
    // Overlays are public geometry, so they ride the scene by value (no owner — a
    // saved session's sessionIds are meaningless on reload; restored overlays are
    // table-owned and GM-managed). Color is kept so they look the same on load.
    const overlays = [];
    this.state.overlays.forEach(o => overlays.push({ kind: o.kind, color: o.color, x: o.x, z: o.z, x2: o.x2, z2: o.z2, w: o.w, ang: o.ang }));
    // Which seats have a personal tray out rides the scene (an array of seat indices); the tray
    // DICE are ordinary pieces carrying `traySeat`, so they're already in `pieces` above.
    const trays = [];
    this.state.trays.forEach((on, seat) => { if (on) trays.push(+seat); });
    return { table: { x: this.state.tableX, z: this.state.tableZ }, pieces, overlays,
             scale: this.scaleSnapshot(), trays };
  }

  // Full game snapshot = the portable scene PLUS the private per-player layer
  // (hands + turn), each resolved from ephemeral sessionId to a stable account id
  // so it can rebind on reload. Used by auto-save + the GM checkpoint; library
  // scenes stay hands-free (they call serializeScene directly).
  serializeGame() {
    const scene = this.serializeScene();
    const byUser = new Map();
    for (const [sid, cards] of this.hands) {       // players still connected (e.g. a GM manual checkpoint)
      if (!cards || !cards.length) continue;
      const c = this.clientBy(sid);
      const uid = c && c.auth && c.auth.userId;
      if (uid == null) continue;
      const p = this.state.players.get(sid);
      byUser.set(String(uid), { name: (p && p.name) || '', cards: cards.slice() });
    }
    for (const [uid, held] of this.pendingHands)   // already-departed hands (the only ones left on dispose)
      byUser.set(String(uid), { name: held.name || '', cards: held.cards.slice() });
    const hands = [];
    for (const [uid, held] of byUser) hands.push({ userId: uid, name: held.name, cards: held.cards });
    let turn = null;
    if (this.state.turn) {
      const tc = this.clientBy(this.state.turn);
      if (tc && tc.auth && tc.auth.userId != null) {
        const tp = this.state.players.get(this.state.turn);
        turn = { userId: String(tc.auth.userId), name: (tp && tp.name) || '' };
      }
    }
    return { ...scene, hands, turn };
  }

  // Replace the whole table with a scene: clear, resize, then rebuild every piece
  // at its saved transform. Boards go through swapBoard; everything else keeps its
  // exact orientation via the spawn quaternion.
  applyScene(scene) {
    if (!scene || typeof scene !== 'object') return;
    this.clearTable();
    const tx = clamp(+(scene.table && scene.table.x) || TABLE.x, TABLE_LIMIT.minX, TABLE_LIMIT.maxX);
    const tz = clamp(+(scene.table && scene.table.z) || TABLE.z, TABLE_LIMIT.minZ, TABLE_LIMIT.maxZ);
    this.state.tableX = tx; this.state.tableZ = tz; this.buildBounds(tx, tz);
    this.applyScale(scene.scale); // grid + measurement calibration ride the scene (no-op if absent)
    this.applyTrays(scene.trays); // restore which seats' trays are out BEFORE their dice spawn, so the walls exist
    for (const e of (Array.isArray(scene.pieces) ? scene.pieces : [])) {
      if (this.state.pieces.size >= SIM.maxPieces) break;
      if (!e || !KINDS[e.type]) continue;
      const props = e.props || {};
      if (e.type === 'board') { this.swapBoard(props); continue; }
      const fdFront = (e.type === 'card' && props.faceDown && props.front) ? props.front : null;
      let sp = props;
      if (fdFront) { sp = { ...props }; delete sp.front; delete sp.faceDown; } // face-down: keep the front OUT of public props, or it renders face-up
      const id = this.spawn(e.type, [+e.x || 0, Number.isFinite(+e.y) ? +e.y : 2, +e.z || 0], sp, Array.isArray(e.q) ? e.q : null);
      if (fdFront) this.cardData.set(id, { front: fdFront });
    }
    // Restore saved overlays (public geometry). clearTable() already emptied the map;
    // rebuild each as table-owned (owner '') so it's GM-managed, not tied to a gone session.
    const cc = (v) => clamp(+v || 0, -MEASURE.maxLen, MEASURE.maxLen);
    for (const e of (Array.isArray(scene.overlays) ? scene.overlays : [])) {
      if (this.state.overlays.size >= OVERLAY_MAX) break;
      if (!e || !OVERLAY_KINDS.has(e.kind)) continue;
      const o = new Overlay();
      o.kind = e.kind; o.owner = ''; o.color = e.color || '#ffffff';
      o.x = cc(e.x); o.z = cc(e.z); o.x2 = cc(e.x2); o.z2 = cc(e.z2);
      o.w = clamp(+e.w || 0, 0, MEASURE.maxLen); o.ang = +e.ang || 0;
      this.state.overlays.set('o' + (this.nextOverlayId++), o);
    }
    // Stage any saved private layer (hands + turn) for account-rebinding as owners return.
    this.pendingHands.clear(); this.pendingTurn = null;
    this.state.unclaimed.clear(); this.state.turnPending = '';
    if (Array.isArray(scene.hands)) {
      for (const h of scene.hands) {
        if (!h || h.userId == null || !Array.isArray(h.cards) || !h.cards.length) continue;
        this.pendingHands.set(String(h.userId), { name: h.name || '', cards: h.cards.slice() });
        this.state.unclaimed.set(String(h.userId), h.name || '');
      }
    }
    if (scene.turn && scene.turn.userId != null) {
      this.pendingTurn = String(scene.turn.userId);
      this.state.turnPending = scene.turn.name || '';
      this.state.turn = ''; // no live session holds it yet; a rebind or GM-advance resolves it
    }
    this.scheduleSave(); // the new table size is durable
  }

  // Persist the durable room state (scoreboard + notes + table size). Debounced —
  // score clicks arrive in bursts, and saveStateNow always reads the latest state.
  scheduleSave() {
    if (!this.roomId || this._saveTimer) return;
    this._saveTimer = setTimeout(() => { this._saveTimer = null; this.saveStateNow(); }, 800);
  }
  saveStateNow() {
    if (!this.roomId) return;
    const rows = [];
    this.state.scores.forEach((row, id) => rows.push({ id, label: row.label, score: row.score }));
    db.saveRoomState(this.roomId, { scoreboard: rows, notes: this.state.notes, tableX: this.state.tableX, tableZ: this.state.tableZ, skybox: this.state.skybox, feltColor: this.state.feltColor, scene: this.savedScene,
      scale: this.scaleSnapshot() })
      .catch(e => console.error('[saveState]', e.message));
  }
  onDispose() { // safety net: snapshot the live table so progress survives an empty room even without a manual Save
    LIVE_ROOMS.delete(this);
    if (this.state.pieces.size) { // only overwrite the saved state when there's actually something on the table
      const snap = this.serializeGame();
      if (JSON.stringify(snap).length <= SCENE_MAX_BYTES) this.savedScene = snap;
    }
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this.saveStateNow(); // flush — persists the snapshot + latest settings
  }

  // Send a client the library list for one asset kind. Admins get everything
  // (incl. private); everyone else gets only published (public) assets.
  async sendAssetList(client, kind) {
    const includePrivate = this.isAdmin(client);
    if (kind === 'deck') client.send('deckList', await db.listDecks({ includePrivate }));
    else if (kind === 'board') client.send('boardList', await db.listBoards({ includePrivate }));
    else if (kind === 'prop') client.send('propList', await db.listProps({ includePrivate }));
    else if (kind === 'scene') client.send('sceneList', await db.listScenes({ includePrivate }));
    else if (kind === 'sky') client.send('skyList', await db.listSkyboxes({ includePrivate }));
  }

  // --- Member-management authorization + list delivery ---
  // GMs manage helpers/players; only an owner manages GMs; nobody manages the owner.
  canManage(actorRank, targetRole) { return canManageMember(actorRank, targetRole); }
  // Role changes: co-GM promote/demote is owner-only; the owner role is never set here.
  canSetRole(actorRank, currentRole, newRole) { return canSetMemberRole(actorRank, currentRole, newRole); }
  async sendMembers(client) {
    if (this.roomId) client.send('memberList', await db.listMembers(this.roomId));
  }
  async broadcastMembers() { // push the fresh list to every GM viewing the panel
    if (!this.roomId) return;
    const list = await db.listMembers(this.roomId);
    for (const c of this.clients) if (this.rank(c) >= RANK.gm) c.send('memberList', list);
  }
  // Tell the matching lobby (if anyone's waiting there) that a pending user's status
  // changed, so it can push + release them instead of them polling for it.
  async notifyLobby(userId, method) {
    try {
      const lobbies = await matchMaker.query({ name: 'lobby', code: this.roomCode });
      for (const l of lobbies) matchMaker.remoteRoomCall(l.roomId, method, [userId]);
    } catch (e) { /* no lobby up for this code */ }
  }

  // Called via the matchmaker when the owner closes the room from the lobby: tell
  // everyone why, then disconnect them all and dispose the live table. The brief
  // delay lets the 'roomClosed' notice flush before the sockets close.
  closeAndDispose() {
    this.broadcast('roomClosed');
    setTimeout(() => { try { this.disconnect(); } catch (e) {} }, 300);
  }

  // End a player's active hold-to-show: clear the public badge and tell every
  // audience member to flip those cards back to face-down in the shower's fan.
  stopShow(sid) {
    const show = this.shows.get(sid);
    if (!show) return;
    this.shows.delete(sid);
    const player = this.state.players.get(sid);
    if (player) player.showing = 0;
    for (const viewer of show.to) {
      const client = this.clientBy(viewer);
      if (client) client.send('showFan', { sid, cards: [] });
    }
  }

  // The door. Runs before onJoin: resolve the device token to a user, confirm
  // they're an ADMITTED member of the room this code belongs to, and hand their
  // role to onJoin as client.auth. Anyone else is turned away. (Site admins may
  // enter any room.) filterBy(['code']) already segregates the live rooms; this is
  // the authorization on top of that segregation.
  async onAuth(client, options) {
    const user = options && options.token ? await db.findUserByToken(hashToken(options.token)) : null;
    if (!user) throw new ServerError(401, 'Please sign in first.');
    const room = options && options.code ? await db.findRoomByCode(options.code) : null;
    if (!room) throw new ServerError(404, 'That room no longer exists.');
    const m = await db.getMembership(room.id, user.id);
    let role = (m && m.status === 'admitted') ? m.role : null;
    if (user.isAdmin) role = 'owner'; // site admins get full control in any room, member or not
    if (!role) throw new ServerError(403, m ? 'Waiting for a GM to admit you.' : 'You are not a member of this room.');
    return { userId: user.id, username: user.username, avatar: user.avatar, role, isAdmin: user.isAdmin };
  }

  rank(client) { return rankOf(client.auth && client.auth.role); }
  isAdmin(client) { return !!(client.auth && client.auth.isAdmin); } // site admin — curates the library, spawns private assets anywhere

  onJoin(client) {
    const auth = client.auth || {};
    // Give the new player the lowest free seat and a color to match.
    const takenSeats = new Set();
    this.state.players.forEach(existing => takenSeats.add(existing.seat));
    let seat = 0;
    while (takenSeats.has(seat)) seat++;

    const player = new Player();
    player.seat = seat;
    player.hand = 0;
    player.showing = 0;
    player.name = auth.username || ('Player ' + (seat + 1)); // identity from the account
    player.color = PALETTE[seat % PALETTE.length];
    player.avatar = auth.avatar || '';
    player.role = auth.role || 'player';
    this.state.players.set(client.sessionId, player);

    // Reclaim a saved hand / the turn if this account owned one in the loaded game.
    const uid = auth.userId != null ? String(auth.userId) : null;
    if (uid && this.pendingHands.has(uid)) {
      this.hands.set(client.sessionId, this.pendingHands.get(uid).cards);
      this.pendingHands.delete(uid); this.state.unclaimed.delete(uid);
    }
    if (uid && this.pendingTurn === uid) {
      this.pendingTurn = null; this.state.turnPending = '';
      this.state.turn = client.sessionId; // the turn was waiting for them
    }

    if (!this.state.turn) this.state.turn = client.sessionId; // first player to arrive starts
    this.sendHand(client);
    if (this.rank(client) >= RANK.gm) this.sendMembers(client); // GMs get the member list up front (pending pulse)
    client.send('whoami', { isAdmin: this.isAdmin(client) }); // lets the client hide library-creation UI from non-admins
  }

  // Advance the turn to the next player by seat order (wrapping around).
  advanceTurn() {
    this.pendingTurn = null; this.state.turnPending = ''; // advancing clears any absent-player hold
    const order = [];
    this.state.players.forEach((player, sid) => order.push([sid, player.seat]));
    order.sort((a, b) => a[1] - b[1]);
    if (!order.length) { this.state.turn = ''; return; }
    const ids = order.map(([sid]) => sid);
    this.state.turn = ids[(ids.indexOf(this.state.turn) + 1) % ids.length]; // indexOf -1 wraps to the first
  }

  // Copy a physics body's position + orientation into its synced Piece record.
  writeTransform(piece, body) {
    piece.x = body.position.x;
    piece.y = body.position.y;
    piece.z = body.position.z;
    piece.qx = body.quaternion.x;
    piece.qy = body.quaternion.y;
    piece.qz = body.quaternion.z;
    piece.qw = body.quaternion.w;
  }

  // The simulation heartbeat, run 60×/second. Three passes over the pieces
  // (drive held ones, self-right the rest, advance flips), then step the world
  // and publish the results. dtMs is the real time since the last tick.
  // --- Pin-when-snapped: freeze a settled snap-to-grid piece so neighbours can't
  // nudge it off its cell (chess/checkers). It stays collidable and grabbable; a grab
  // unpins it (see update Pass 1). Only ever touches pieces that are DYNAMIC to begin
  // with, so boards and other static bodies are never affected.
  pinPiece(id) {
    const body = this.bodies.get(id);
    if (!body || body.__pinned || body.type !== CANNON.Body.DYNAMIC) return;
    body.__pinned = true;
    body.type = CANNON.Body.STATIC;
    body.velocity.setZero(); body.angularVelocity.setZero();
    body.updateMassProperties(); // STATIC → invMass 0: immovable but still collidable
    body.sleep();
  }
  unpinPiece(id) {
    const body = this.bodies.get(id);
    if (!body || !body.__pinned) return;
    body.__pinned = false;
    body.type = CANNON.Body.DYNAMIC;
    body.updateMassProperties();
    body.wakeUp();
  }
  wantsSnap(piece) {
    if (!gridActive(this.state.scale)) return false;
    try { return !!JSON.parse(piece.props || '{}').snap; } catch { return false; }
  }

  update(dtMs) {
    const dt = dtMs / 1000;
    const stiffness = SIM.servo.stiffness, maxSpeed = SIM.servo.maxSpeed;

    // Pass 1 — held pieces. Instead of teleporting a held piece to the cursor, we
    // set its VELOCITY toward the drag target ("servo"). It stays a real body, so
    // it still shoves others and gets shoved, but tracks the cursor tightly.
    this.state.pieces.forEach((piece, id) => {
      if (!piece.owner) return;
      const target = this.targets.get(id), body = this.bodies.get(id);
      if (!body) return;
      if (body.__pinned) this.unpinPiece(id); // grabbing a pinned piece frees it to move
      if (!target) return;
      body.wakeUp();

      let vx = (target.x - body.position.x) * stiffness;
      // A flat-collider piece hangs its footprint below the body center; drive the body so
      // that FOOTPRINT (not the center) hovers at the drag height, so it clears pieces
      // resting on a raised board instead of plowing through them.
      const holdY = target.y - (body.shapeOffsets[0] ? body.shapeOffsets[0].y : 0);
      let vy = (holdY - body.position.y) * stiffness;
      let vz = (target.z - body.position.z) * stiffness;
      const speed = Math.hypot(vx, vy, vz);
      if (speed > maxSpeed) { const scale = maxSpeed / speed; vx *= scale; vy *= scale; vz *= scale; }
      body.velocity.set(vx, vy, vz);
      body.angularVelocity.scale(SIM.servo.angDamp, body.angularVelocity);

      // While held, a "stand" piece is kept level: strip its pitch/roll and keep
      // only its yaw, so decks/chess pieces don't tumble in your hand.
      const standMode = this.standOf(piece);
      if (standMode) {
        const quat = body.quaternion, mag = Math.hypot(quat.w, quat.y) || 1;
        quat.set(0, quat.y / mag, 0, quat.w / mag);
        body.angularVelocity.setZero();
      }
    });

    // Pass 2 — self-righting for pieces that aren't held. We nudge the piece's
    // local +Y back toward world-up. For a tall piece that stands it upright; for
    // a flat piece (deck, checker, coin) the thin axis IS +Y, so it lies flat.
    // The only difference is the cutoff: a tall piece that has fully toppled is
    // left down, but a flat piece is righted from any angle (it should always
    // settle flat).
    const right = SIM.propRight;
    const worldUp = new CANNON.Vec3(0, 1, 0), pieceUp = new CANNON.Vec3(), axis = new CANNON.Vec3();
    this.state.pieces.forEach((piece, id) => {
      if (piece.owner) return;
      const standMode = this.standOf(piece);
      if (!standMode) return;
      const body = this.bodies.get(id);
      if (!body || body.sleepState === CANNON.Body.SLEEPING) return;
      // A flat-collider piece rests on a thin footprint offset below its center, so it
      // already lies flat on its own. Self-righting would spin it about that center and
      // drag the offset footprint sideways (a slow drift on a board) — so skip it here.
      if (body.shapeOffsets[0] && Math.abs(body.shapeOffsets[0].y) > 0.01) return;

      body.quaternion.vmult(worldUp, pieceUp); // the piece's up-axis, in world space
      pieceUp.cross(worldUp, axis);            // rotation axis that brings it back to upright
      const tilt = axis.length();              // = sin(angle between them)
      const cutoff = standMode === 'flat' ? 1.5 : right.maxTilt; // flat: any tilt; tall: near-upright only
      if (tilt > 0.02 && tilt < cutoff) {
        axis.scale(1 / tilt, axis); // normalise
        body.angularVelocity.x += axis.x * tilt * right.strength;
        body.angularVelocity.y += axis.y * tilt * right.strength;
        body.angularVelocity.z += axis.z * tilt * right.strength;
        body.angularVelocity.scale(right.damp, body.angularVelocity);
        body.wakeUp();
      }
    });

    // Pass 2.5 — pin snapped pieces once they settle (and unpin if their flag/grid goes
    // away). Freezing them STATIC keeps a bumped neighbour from sliding them off a cell.
    this.state.pieces.forEach((piece, id) => {
      if (piece.owner) return;                    // held pieces are handled (and unpinned) in Pass 1
      const body = this.bodies.get(id);
      if (!body) return;
      if (this.wantsSnap(piece)) {
        // Settle quickly (card-like sleep timing), then pin ONLY once actually ASLEEP — i.e.
        // it has fallen and come to rest on the surface. Pinning on mere low speed froze
        // pieces in mid-air the instant release zeroed their velocity, before gravity could
        // drop them onto the cell.
        if (body.sleepTimeLimit !== SIM.cards.sleepTime) { body.sleepSpeedLimit = SIM.cards.sleepSpeed; body.sleepTimeLimit = SIM.cards.sleepTime; }
        if (!body.__pinned && body.sleepState === CANNON.Body.SLEEPING) {
          const p = snapToCell(body.position.x, body.position.z, this.state.scale);
          body.position.x = p.x; body.position.z = p.z; // exact cell (a bounce may have nudged it) before freezing
          this.pinPiece(id);
        }
      } else if (body.__pinned) {
        this.unpinPiece(id);                       // snap turned off, or the grid was removed
      }
    });

    // Pass 3 — advance any in-progress card flips. A flip is a scripted animation
    // (a kinematic half-turn plus a little hop) rather than a physical toss.
    for (const [id, flip] of this.flips) {
      const body = this.bodies.get(id);
      if (!body) { this.flips.delete(id); continue; }
      flip.t += dt;
      const progress = Math.min(flip.t / flip.dur, 1);
      flip.start.slerp(flip.end, progress, body.quaternion);
      body.position.y = flip.baseY + Math.sin(progress * Math.PI) * SIM.flipArc; // arc up and back down
      if (progress >= 1) { // hand it back to the physics engine
        body.type = CANNON.Body.DYNAMIC;
        body.wakeUp();
        body.velocity.setZero();
        body.angularVelocity.setZero();
        this.flips.delete(id);
      }
    }

    this.world.step(SIM.step.fixed, dt, SIM.step.maxSub);

    // Safety net: if anything still escaped the walls (rare tunnelling on a very
    // hard throw), drop it back onto the table instead of losing it into the void.
    const tx = this.state.tableX, tz = this.state.tableZ;
    const limitX = tx + SIM.bounds.margin, limitZ = tz + SIM.bounds.margin;
    this.bodies.forEach((body) => {
      const pos = body.position;
      if (body.__traySeat != null) {
        // A tray die obeys ITS SEAT's tray footprint, not the table's — otherwise the net would
        // yank it back to the table every tick. If it somehow left the tray (a hard throw over
        // the wall, or the tray was just put away), drop it back into that tray's centre.
        const seat = body.__traySeat, angle = seatAngle(seat), c = this.trayCenterFor(seat);
        const stillOut = this.state.trays.get(String(seat));
        const out = pos.y < SIM.bounds.floor || pos.y > SIM.bounds.ceiling
                 || !stillOut || !inTray(pos.x, pos.z, c, angle, 0.5);
        if (out && stillOut) {
          const p = trayPlace({ x: 0, y: 1, z: 0 }, c, angle);
          pos.set(p.x, p.y, p.z);
          body.velocity.setZero(); body.angularVelocity.setZero(); body.wakeUp();
        }
        return;
      }
      const escaped = pos.y < SIM.bounds.floor || pos.y > SIM.bounds.ceiling || Math.abs(pos.x) > limitX || Math.abs(pos.z) > limitZ;
      if (escaped) {
        pos.set(clamp(pos.x, -tx + 1, tx - 1), 3, clamp(pos.z, -tz + 1, tz - 1));
        body.velocity.setZero();
        body.angularVelocity.setZero();
        body.wakeUp();
      }
    });

    // Publish transforms into synced state. Colyseus only ships fields that
    // actually changed, so pieces sitting still (asleep) cost no bandwidth.
    this.state.pieces.forEach((piece, id) => {
      const body = this.bodies.get(id);
      if (body) this.writeTransform(piece, body);
    });
  }

  async onLeave(client, arg) {
    // Immediately free any piece they were dragging, so it doesn't hang mid-air.
    this.state.pieces.forEach((piece, id) => {
      if (piece.owner === client.sessionId) {
        piece.owner = '';
        this.targets.delete(id);
      }
    });
    this.groups.delete(client.sessionId); // drop any in-progress group drag they held
    // Free the whiteboard right away if they were drawing — don't hold it locked
    // through the reconnection window (others should be able to claim it at once).
    if (this.state.whiteboard.owner === client.sessionId) this.state.whiteboard.owner = '';

    // On an unexpected drop (not a deliberate leave), hold their seat briefly in
    // case they reconnect. allowReconnection resolves if they come back in time.
    const consented = arg === true || arg === 4000; // true/4000 = a deliberate leave
    if (!consented) {
      try {
        await this.allowReconnection(client, 30);
        return; // they reconnected — keep everything
      } catch (e) {
        /* didn't return in time — fall through and clean up */
      }
    }

    // Park a departing player's hand as unclaimed so it survives to a save and can be
    // reclaimed on their return or reassigned by a GM (fires only after the reconnect window).
    const _uid = client.auth && client.auth.userId != null ? String(client.auth.userId) : null;
    const _hand = this.hands.get(client.sessionId);
    if (_uid && _hand && _hand.length) {
      const _p = this.state.players.get(client.sessionId);
      const _nm = (_p && _p.name) || (client.auth && client.auth.username) || '';
      this.pendingHands.set(_uid, { name: _nm, cards: _hand });
      this.state.unclaimed.set(_uid, _nm);
    }
    this.hands.delete(client.sessionId);
    this.notebooks.delete(client.sessionId);
    this.stopShow(client.sessionId); // clear any hold-to-show they had live

    // If they'd drawn a card to inspect but never placed it, return it to its deck.
    const pending = this.pendingInspect.get(client.sessionId);
    if (pending) {
      const cards = this.deckCards.get(pending.deckId);
      if (cards) {
        cards.push(pending.front);
        const deck = this.state.pieces.get(pending.deckId);
        if (deck) deck.count = cards.length;
        this.updateDeckCollider(pending.deckId);
      }
      this.pendingInspect.delete(client.sessionId);
    }

    // Put away their personal dice tray + its dice — a tray belongs to whoever's seated there,
    // so it shouldn't linger for the next person. (Done after the reconnect window, so a brief
    // drop doesn't clear it.) Read the seat before the player row is removed below.
    const _seat = this.seatOf(client);
    if (_seat != null && this.state.trays.get(String(_seat))) {
      this.state.trays.delete(String(_seat));
      this.clearTraySeat(_seat);
      this.buildTrays();
    }

    const wasTurn = this.state.turn === client.sessionId;
    this.state.players.delete(client.sessionId);
    if (wasTurn) this.advanceTurn(); // don't strand the turn on a player who left
  }
}

// The library editor: a full table (physics, spawning, asset CRUD — all inherited)
// that only SITE ADMINS may enter. It has no DB room row, so roomId stays null and
// the member-management handlers no-op; it's a shared admin sandbox for building and
// testing library assets live. The admin joins at max role + admin rights.
class EditorRoom extends TableRoom {
  async onAuth(client, options) {
    const user = options && options.token ? await db.findUserByToken(hashToken(options.token)) : null;
    if (!user) throw new ServerError(401, 'Please sign in first.');
    if (!user.isAdmin) throw new ServerError(403, 'The library editor is for site admins only.');
    return { userId: user.id, username: user.username, avatar: user.avatar, role: 'owner', isAdmin: true };
  }
}

// --- Boot: Colyseus + Express (both served on the same port) ----------------
const app = express();

// Per-IP token-bucket rate limiter (in-memory; resets on restart, single-instance).
// A burst allowance that refills over time — tuned per use below.
function makeRateLimiter({ cap, refillPerMs, message }) {
  const buckets = new Map(); // ip -> { tokens, last }
  return (req, res, next) => {
    const ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    const now = Date.now();
    const b = buckets.get(ip) || { tokens: cap, last: now };
    b.tokens = Math.min(cap, b.tokens + (now - b.last) * refillPerMs);
    b.last = now;
    if (b.tokens < 1) { buckets.set(ip, b); return res.status(429).json({ error: message }); }
    b.tokens -= 1; buckets.set(ip, b);
    next();
  };
}
// Uploads: big burst (a deck's back + every front go back-to-back), ~180/min sustained.
const rateLimitUpload = makeRateLimiter({ cap: 300, refillPerMs: 3 / 1000, message: 'too many uploads — slow down' });
// Auth: brute-force + signup-spam guard. ~20/min per IP — scrypt already slows each
// attempt; this is defense in depth and still leaves room for a few users behind one NAT.
const rateLimitAuth = makeRateLimiter({ cap: 20, refillPerMs: 20 / 60000, message: 'too many attempts — please slow down' });
const requireUser = createRequireUser({ db, hashToken });
const requireAdmin = createRequireAdmin(requireUser);

// Security headers: helmet's defaults (HSTS, nosniff, frame-deny, referrer, hide
// X-Powered-By…) minus its built-in CSP — we define our own below.
app.use(helmet({ contentSecurityPolicy: false }));

// Content-Security-Policy — ENFORCED. Three + Colyseus are self-hosted under /vendor,
// so scripts lock to 'self' plus the three known inline-script hashes (accent
// bootstrap, import map, OTT_EDITOR flag). data:/blob: are allowed in connect-src for
// Three's loaders (embedded model buffers + object URLs). No 'unsafe-eval': Colyseus
// feature-detects eval and falls back to its non-inline decoder when it's blocked.
// Violations still POST to /csp-report so real ones surface in the logs.
const CSP_INLINE = [
  "'sha256-i/yI+mRMoFQQ4YqK4dbxQlxozrQncj7xjpWdHUUvfns='", // accent-color bootstrap (all pages)
  "'sha256-GPCT8IS0bOltxV6o5zObSqdYe/Cpv1tKzAj9rjuR+yM='", // import map (table, editor)
  "'sha256-C+qoepFpRED4aJXCZO8fNnC4cmFGPYrKJqdMHxsEub4='", // window.OTT_EDITOR flag (editor)
];
app.use(helmet.contentSecurityPolicy({
  useDefaults: false,
  reportOnly: false, // ENFORCED
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc:  ["'self'", ...CSP_INLINE],
    styleSrc:   ["'self'", "'unsafe-inline'"], // inline styles are pervasive + low-risk
    imgSrc:     ["'self'", 'data:', 'blob:'],  // avatars = data: URLs, textures = blobs
    connectSrc: ["'self'", 'ws:', 'wss:', 'data:', 'blob:'], // Colyseus ws + Three's data:/blob: buffer loaders
    workerSrc:  ["'self'", 'blob:'],
    objectSrc:  ["'none'"],
    baseUri:    ["'self'"],
    reportUri:  ['/csp-report'],
  },
}));
// Sink for CSP violation reports during the report-only phase — logs what WOULD block.
app.post('/csp-report', rateLimitAuth, express.json({ type: () => true, limit: '64kb' }), (req, res) => {
  const r = req.body && req.body['csp-report'];
  // Colyseus feature-detects eval and gracefully falls back when it's blocked — a known,
  // harmless report that fires on every load, so drop it and log only real violations.
  const benign = r && r['blocked-uri'] === 'eval' && String(r['source-file'] || '').includes('/vendor/colyseus.js');
  if (!benign) console.warn('[CSP]', JSON.stringify(req.body));
  res.sendStatus(204);
});

app.use(express.static('public'));
app.use('/shared', express.static('shared'));

// Serve uploaded images/models, but NEVER the .json metadata beside them — that
// keeps a hidden card front living on disk from being fetched directly.
app.use('/assets',
  (req, res, next) => {
    if (/\.json$/i.test(req.path)) return res.sendStatus(404);
    next();
  },
  express.static(ASSETS_DIR),
);

// Raw image/model uploads are authenticated, byte-validated, and throttled in
// their own router. saveAsset retains the allowlisted destination policy.
app.use(createUploadRouter({ rateLimitUpload, requireAdmin, saveAsset }));

// --- Auth (HTTP): signup / login / token-resolve --------------------------
// The landing page talks to these before joining any room. Passwords use scrypt;
// a successful signup or login also issues a durable device token — the raw value
// is returned once (stored client-side) so return visits log in without a password.
app.use('/auth', createAuthRouter({ db, rateLimitAuth, hashPassword, verifyPassword, makeToken, hashToken }));

// --- Admin console (site superusers only) ---------------------------------
async function disposeLive(code) { // shut down a running table for this code, if any
  try {
    const live = await matchMaker.query({ name: 'table', code });
    for (const r of live) await matchMaker.remoteRoomCall(r.roomId, 'closeAndDispose');
  } catch (e) { /* none running */ }
}
app.use(createRoomsRouter({ db, requireUser, hashPassword, isBoundedImageDataURL, matchMaker, disposeLive }));

// Drop a user from EVERY live table they're currently in (admin action). Reuses the
// per-room kick's 'kicked' notice + consented leave. In-process (single-instance) scope.
function kickUserEverywhere(userId) {
  let n = 0;
  for (const room of LIVE_ROOMS) {
    const live = room.clients.find(c => c.auth && String(c.auth.userId) === String(userId));
    if (live) { live.send('kicked'); setTimeout(() => { try { live.leave(4000); } catch (e) {} }, 150); n++; }
  }
  return n;
}

app.use('/admin', createAdminRouter({
  db, requireAdmin, findOrphanAssets, trashOrphans, disposeLive, kickUserEverywhere,
}));

// Must be registered after every HTTP route so rejected async handlers land here.
app.use(httpErrorHandler);

const httpServer = createServer(app);
// A pending joiner holds a socket here (instead of polling) while awaiting approval.
// onAuth is the INVERSE of the table's: only PENDING members may wait — admitted users
// should join the table, non-members must request first. When a GM admits/declines,
// the table room calls notifyAdmitted/notifyDeclined here to push + release them.
class LobbyRoom extends Room {
  async onAuth(client, options) {
    const user = options && options.token ? await db.findUserByToken(hashToken(options.token)) : null;
    if (!user) throw new ServerError(401, 'Please sign in first.');
    const room = options && options.code ? await db.findRoomByCode(options.code) : null;
    if (!room) throw new ServerError(404, 'That room no longer exists.');
    const m = await db.getMembership(room.id, user.id);
    if (!m) throw new ServerError(403, 'Request to join this room first.');
    if (m.status === 'admitted') throw new ServerError(409, 'Already admitted — join the table.');
    return { userId: user.id };
  }
  async onLeave(client, consented) {
    // A pending joiner who dropped (tab close / flaky net): hold their spot briefly so a
    // reconnect keeps them waiting. Admit/decline leave consented → no hold (clean exit).
    if (consented) return;
    try { await this.allowReconnection(client, 20); } catch (e) { /* didn't return in time */ }
  }
  notifyAdmitted(userId) { this._resolve(userId, 'admitted'); }
  notifyDeclined(userId) { this._resolve(userId, 'declined'); }
  _resolve(userId, msg) {
    const c = this.clients.find(c => c.auth && String(c.auth.userId) === String(userId));
    if (c) { c.send(msg); setTimeout(() => { try { c.leave(); } catch (e) {} }, 150); }
  }
}

const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer, maxPayload: 4 * 1024 * 1024 }) });
gameServer.define('table', TableRoom).filterBy(['code']); // one live table per room code
gameServer.define('editor', EditorRoom); // single shared admin-only library workshop
gameServer.define('lobby', LobbyRoom).filterBy(['code']); // transient per-code waiting room for pending joiners

const PORT = process.env.PORT || 2567;
// Apply any pending schema migrations before serving. Fails fast (exits) rather than
// booting on a half-migrated schema; no-ops when MIGRATE_DATABASE_URL isn't set.
await runMigrations();
gameServer.listen(PORT).then(() => console.log(`\n  Open Tabletop running →  http://localhost:${PORT}\n`));
