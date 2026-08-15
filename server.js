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
import { Schema, MapSchema, defineTypes } from '@colyseus/schema';
import * as CANNON from 'cannon-es';
import convexHull from 'convex-hull';
import { KINDS, PROPS, BOARDS, TABLE, dieVerts, DIE_RADIUS, deckHeight, timerLive } from './shared/pieces.js';
import * as db from './db.js'; // Postgres-backed saved-asset library (metadata; files stay on disk)
import { hashPassword, verifyPassword, makeToken, hashToken } from './auth.js';

// --- Simulation tuning (all the physics "feel" constants in one place) -------
const SIM = {
  gravity: -20,                                   // world gravity (y)
  friction: 0.35, restitution: 0.2,               // contact material
  tableThick: 0.5,                                // table slab half-height
  wall: { half: 4, thick: 0.5, over: 1 },         // walls: half-height (y 0..8), half-thickness, corner overlap
  servo: { stiffness: 25, maxSpeed: 45, angDamp: 0.6 }, // held-piece velocity servo (tracks cursor)
  damp: { flat: 0.5, solid: 0.15 },               // angular damping: cards/decks vs everything else
  flipHop: 1.6, flipArc: 0.7,                     // flip feedback nudge + kinematic arc height
  roll: { up: 7, spread: 8, spin: 20 },           // die roll impulse
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
// A bounded image data-URL (the only avatar shape we accept — small enough to
// sync in state, and never an arbitrary URL/script). Used by setAvatar + /me/avatar.
const isBoundedImageDataURL = (data) => typeof data === 'string' && data.startsWith('data:image') && data.length < 60000;
// A whiteboard stroke: a flat [x0,y0,x1,y1,...] path in normalized [0,1] board UV,
// plus a colour + width. Bounded so a bad client can't push junk or a huge payload.
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

  // A card's collider is intentionally thicker than the visible card, which is
  // what keeps a stack of them stable instead of jittering apart.
  if (type === 'card') return new CANNON.Box(new CANNON.Vec3(shape.box[0], SIM.cards.colliderThick, shape.box[2]));

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
  const cubeCollider = () => new CANNON.Box(new CANNON.Vec3(DIE_RADIUS[6], DIE_RADIUS[6], DIE_RADIUS[6]));
  if (sides === 6) return cubeCollider(); // a d6 is just a cube

  const vertices = dieVerts(sides, DIE_RADIUS[sides] || 1);
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
const RANK = { player: 0, helper: 1, gm: 2, owner: 3 };
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
class State extends Schema {
  constructor() { super(); this.pieces = new MapSchema(); this.players = new MapSchema(); this.turn = ''; this.timer = new Timer(); this.scores = new MapSchema(); this.notes = ''; this.tableX = TABLE.x; this.tableZ = TABLE.z; this.whiteboard = new Whiteboard(); this.skybox = ''; }
}
defineTypes(State, { pieces: { map: Piece }, players: { map: Player }, turn: 'string', timer: Timer, scores: { map: ScoreRow }, notes: 'string', tableX: 'number', tableZ: 'number', whiteboard: Whiteboard, skybox: 'string' });

const PALETTE = ['#4a78c9', '#c94a4a', '#4ac97a', '#c9a24a', '#9a4ac9', '#4ac9c9'];

// --- Physics world (identical setup to the single-player client) ------------
// GM-resizable table: half-extent bounds (default is TABLE = 10 x 7).
const TABLE_LIMIT = { minX: 4, maxX: 20, minZ: 3, maxZ: 16 };
// Backstop against a scene inlining raw image data (the normal flow stores card/
// model art as file refs, so a real scene is tiny; this only catches the edge case).
const SCENE_MAX_BYTES = 2_000_000;
// Whiteboard: cap the server-held stroke history (a knob — raise/lower freely).
const WHITEBOARD_MAX_STROKES = 2000;
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
function buildSimpleDeck() {
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
  return { back: 'back', cards: shuffle(cards) };
}

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
    if (this.roomId) { // restore the durable scoreboard, notes, and table size for this room
      const rs = await db.getRoomState(this.roomId);
      for (const row of rs.scoreboard) {
        if (row && row.id) this.state.scores.set(String(row.id), new ScoreRow(String(row.label || '').slice(0, 40), Number(row.score) || 0));
      }
      this.state.notes = String(rs.notes || '').slice(0, 8000);
      this.state.tableX = clamp(rs.tableX, TABLE_LIMIT.minX, TABLE_LIMIT.maxX);
      this.state.tableZ = clamp(rs.tableZ, TABLE_LIMIT.minZ, TABLE_LIMIT.maxZ);
      this.state.skybox = validSky(String(rs.skybox || '')) ? String(rs.skybox || '') : '';
    }
    this.buildBounds(this.state.tableX, this.state.tableZ); // table surface + walls at the current size
    this.bodies = new Map();  // id -> CANNON.Body   (physics, not synced)
    this.targets = new Map(); // id -> {x,y,z}       (drag target of the owner)
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
    this.nextId = 1; this.nextHid = 1;

    // --- Movement: grab → drag → release --------------------------------------
    this.onMessage('grab', (client, { id }) => {
      const piece = this.state.pieces.get(id);
      // Claim the piece if it's free, movable, and not mid-flip.
      if (piece && !piece.owner && !this.flips.has(id) && KINDS[piece.type].mass > 0) {
        piece.owner = client.sessionId;
      }
    });

    this.onMessage('move', (client, msg) => {
      const piece = this.state.pieces.get(msg.id);
      // Only the owner can steer their piece; update the servo's drag target.
      if (piece && piece.owner === client.sessionId) {
        this.targets.set(msg.id, { x: msg.x, y: msg.y, z: msg.z });
      }
    });

    this.onMessage('release', (client, msg) => {
      const piece = this.state.pieces.get(msg.id);
      if (!piece || piece.owner !== client.sessionId) return;
      piece.owner = '';
      this.targets.delete(msg.id);

      const body = this.bodies.get(msg.id);
      if (body) {
        // Turn the hand-speed the client measured into a real throw, capped so a
        // frantic flick can't launch a piece across the room (cards cap lower).
        if (msg.v) {
          let [vx, vy, vz] = msg.v;
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
            const front = (this.cardData.get(msg.id) || {}).front || JSON.parse(piece.props || '{}').front;
            if (front) cards.push(front);
            this.state.pieces.get(deckId).count = cards.length;
            this.updateDeckCollider(deckId);
            this.removePiece(msg.id);
            break;
          }
        }
      }
    });

    // --- Cards: flip, deal, take ----------------------------------------------
    this.onMessage('flip', (client, { id }) => {
      const piece = this.state.pieces.get(id), body = this.bodies.get(id);
      if (!piece || !body || piece.type !== 'card') return;
      // A card's front lives in PUBLIC props when face-up, or PRIVATE cardData
      // when face-down; flipping moves it between the two. The back is always
      // public, so a face-down card's front is never sent to any client.
      const props = JSON.parse(piece.props || '{}');
      if (props.front) {                    // face-up → hide the front
        this.cardData.set(id, { front: props.front });
        delete props.front;
      } else if (this.cardData.has(id)) {   // face-down → reveal the front
        props.front = this.cardData.get(id).front;
        this.cardData.delete(id);
      }
      piece.props = JSON.stringify(props);
      body.wakeUp();
      body.velocity.y = SIM.flipHop; // a small hop; the client plays the visual flip
    });
    // Deal the top card face-down onto the table, just beside the deck.
    this.onMessage('dealToTable', (client, { deckId }) => {
      const deck = this.state.pieces.get(deckId), cards = this.deckCards.get(deckId);
      if (!deck || deck.type !== 'deck' || !cards || !cards.length) return;

      const back = JSON.parse(deck.props || '{}').back || 'back';
      const front = cards.pop();
      const id = this.spawnCardFlat(this.besideDeck(this.bodies.get(deckId)), { back }); // only the back is public
      this.cardData.set(id, { front }); // front stays private until taken or flipped

      deck.count = cards.length;
      if (!cards.length) this.removePiece(deckId);
      else this.updateDeckCollider(deckId);
    });

    // Deal the top card AND immediately give the dealer control to drag it out.
    this.onMessage('dealDrag', (client, msg) => {
      const deck = this.state.pieces.get(msg.deckId), cards = this.deckCards.get(msg.deckId);
      if (!deck || deck.type !== 'deck' || !cards || !cards.length) return;

      const back = JSON.parse(deck.props || '{}').back || 'back';
      const front = cards.pop();
      const deckBody = this.bodies.get(msg.deckId);
      const id = this.spawnCardFlat([deckBody.position.x, 2.5, deckBody.position.z], { back });
      this.cardData.set(id, { front });

      deck.count = cards.length;
      if (!cards.length) this.removePiece(msg.deckId);
      else this.updateDeckCollider(msg.deckId);

      // Hand the card straight to the dealer's cursor.
      this.state.pieces.get(id).owner = client.sessionId;
      this.targets.set(id, { x: msg.x, y: msg.y, z: msg.z });
      client.send('dealt', { id }); // tell the client which card it now holds
    });

    // Take a table card into your private hand (removing it from the table).
    this.onMessage('takeCard', (client, { id }) => {
      const piece = this.state.pieces.get(id);
      if (!piece || piece.type !== 'card') return;
      const props = JSON.parse(piece.props || '{}');
      const front = (this.cardData.get(id) || {}).front || props.front;
      const back = props.back || 'back';
      this.addToHand(client, front, back);
      this.removePiece(id);
    });

    // Draw the top card so ONLY the drawer sees its front — like a private hand of
    // one. The card sits in limbo (pendingInspect) until placed; the deck's count
    // drops for everyone, but the deck itself stays so the card can be put back.
    this.onMessage('drawInspect', (client, { deckId }) => {
      if (this.pendingInspect.has(client.sessionId)) return; // one at a time
      const deck = this.state.pieces.get(deckId), cards = this.deckCards.get(deckId);
      if (!deck || deck.type !== 'deck' || !cards || !cards.length) return;

      const back = JSON.parse(deck.props || '{}').back || 'back';
      const front = cards.pop();
      deck.count = cards.length;
      this.updateDeckCollider(deckId);

      this.pendingInspect.set(client.sessionId, { deckId, front, back });
      client.send('inspectCard', { front, back }); // PRIVATE: only the drawer sees the front
    });
    // Place a drawn-to-inspect card: back on the deck, into your hand, or onto
    // the field face-up (public front) / face-down (front stays private).
    this.onMessage('inspectPlace', (client, { where }) => {
      const pending = this.pendingInspect.get(client.sessionId);
      if (!pending) return;
      this.pendingInspect.delete(client.sessionId);
      const { deckId, front, back } = pending;

      if (where === 'deck') { // return it to the top of the deck it came from
        const cards = this.deckCards.get(deckId);
        if (cards) {
          cards.push(front);
          const deck = this.state.pieces.get(deckId);
          if (deck) deck.count = cards.length;
          this.updateDeckCollider(deckId);
        }
        return;
      }

      if (where === 'hand') {
        this.addToHand(client, front, back);
      } else { // 'field-up' (front public) or 'field-down' (front stays private)
        const faceDown = where === 'field-down';
        const deckBody = this.bodies.get(deckId);
        const pos = deckBody ? this.besideDeck(deckBody) : rnd();
        const id = this.spawnCardFlat(pos, faceDown ? { back } : { front, back });
        if (faceDown) this.cardData.set(id, { front });
      }

      // The card has left the deck for good — clean up an emptied deck.
      const cards = this.deckCards.get(deckId);
      if (cards && cards.length === 0) this.removePiece(deckId);
    });

    this.onMessage('shuffle', (client, { deckId }) => {
      const cards = this.deckCards.get(deckId);
      if (cards) {
        shuffle(cards);
        this.broadcast('shuffled', { id: deckId }); // every client plays the riffle animation
      }
    });
    // Split a deck in two: the original keeps the top half, a new (ephemeral) deck
    // with the bottom half drops in beside it. Anyone who can touch decks can split.
    this.onMessage('splitDeck', (client, { deckId } = {}) => {
      const deck = this.state.pieces.get(deckId), cards = this.deckCards.get(deckId);
      if (!deck || deck.type !== 'deck' || !cards || cards.length < 2) return;      // need 2+ cards to split
      if (this.state.pieces.size >= SIM.maxPieces) return;
      const back = JSON.parse(deck.props || '{}').back || 'back';
      const bottom = cards.splice(Math.floor(cards.length / 2));                    // original keeps the top half
      deck.count = cards.length;
      this.updateDeckCollider(deckId);
      const p = this.bodies.get(deckId)?.position || { x: 0, z: 0 };
      this.spawn('deck', [p.x + 2.2, SIM.spawnY, p.z], { back, cards: bottom });     // the bottom half, beside it
    });
    // Tint a die or built-in prop (cosmetic; anyone who can inspect can recolor).
    this.onMessage('recolor', (client, { id, color, textColor } = {}) => {
      const piece = this.state.pieces.get(id);
      if (!piece || (piece.type !== 'die' && piece.type !== 'prop')) return;
      const ok = (c) => Number.isInteger(c) && c >= 0 && c <= 0xffffff;
      const props = JSON.parse(piece.props || '{}');
      if (color != null) { const c = Number(color); if (!ok(c)) return; props.color = c; }
      if (piece.type === 'die' && textColor != null) { const t = Number(textColor); if (!ok(t)) return; props.textColor = t; } // die number colour
      piece.props = JSON.stringify(props); // synced → every client rebuilds the piece with the new tint
    });
    // Decks are built in chunks so no single message is huge (a text list can be
    // hundreds of cards): deckBegin → deckAppend (batches) → deckFinish.
    this.onMessage('deckBegin', (client, msg) => {
      if (!this.isAdmin(client)) return; // building library decks is admin-only
      const back = (msg && deckRefOk(msg.back)) ? msg.back : 'back';
      this.drafts.set(client.sessionId, { back, cards: [] });
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
      const doSpawn = !msg || msg.spawn !== false; // default: spawn onto the table (also the back-compat path)
      if (doSpawn) {
        const id = this.spawn('deck', rnd(), { back: draft.back, cards: draft.cards }); // spawn to test it live
        // Optionally save it to the library in the same step (save-on-create, private).
        if (msg && msg.name && await this.saveDeckById(id, msg.name, client.auth.userId)) {
          this.sendAssetList(client, 'deck');
        }
      } else if (msg && msg.name) {
        // Save-only: insert the built deck straight into the library, no table spawn.
        try {
          await db.insertDeck({ name: msg.name, back: draft.back, fronts: draft.cards, ownerId: client.auth.userId, isPublic: false });
          this.sendAssetList(client, 'deck');
        } catch (e) { console.error('[deckFinish save-only]', e.message); }
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
      this.spawn('deck', rnd(), { back: deck.back, cards: deck.fronts });
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
        await db.insertBoard(name, record, { ownerId: client.auth.userId }); // private by default
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
      if (['sphere', 'cylinder', 'cone', 'flat'].includes(incoming.collider)) props.collider = incoming.collider; // box is the default
      try {
        await db.insertProp(name, props, { ownerId: client.auth.userId }); // private by default
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
      const id = this.spawnCardFlat(pos, faceDown ? { back: card.back } : { front: card.front, back: card.back });
      if (faceDown) this.cardData.set(id, { front: card.front }); // front private until flipped
      this.sendHand(client);
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
        const id = this.spawnCardFlat(pos, faceDown ? { back: card.back } : { front: card.front, back: card.back });
        if (faceDown) this.cardData.set(id, { front: card.front });                    // face-down: front stays private until flipped
        spawned++;
      }
      hand.splice(0, spawned);  // remove just the cards that made it onto the table
      this.sendHand(client);    // updates the public count + sends the now-shorter private hand
    });
    this.onMessage('spawn', (client, msg) => {
      if (this.state.pieces.size >= SIM.maxPieces) return;
      if (msg.type === 'board') {
        if (this.rank(client) < RANK.gm) return;   // reshaping the table is GM+
        this.swapBoard(msg.props || {}); // only one board at a time
      } else {
        if (this.rank(client) < RANK.helper) return; // spawning pieces is Helper+
        this.spawn(msg.type, rnd(), msg.props || {});
      }
    });

    this.onMessage('roll', () => {
      const roll = SIM.roll;
      this.state.pieces.forEach((piece, id) => {
        if (piece.type !== 'die') return;
        const body = this.bodies.get(id);
        body.wakeUp();
        body.velocity.set((Math.random() - 0.5) * roll.spread, roll.up, (Math.random() - 0.5) * roll.spread);
        body.angularVelocity.set((Math.random() - 0.5) * roll.spin, (Math.random() - 0.5) * roll.spin, (Math.random() - 0.5) * roll.spin);
      });
    });

    // Wipe the room back to an empty table — pieces and all private state.
    this.onMessage('reset', (client) => {
      if (this.rank(client) < RANK.gm) return; // wiping the table is GM+
      this.clearTable();
      const t = this.state.timer; // stop and zero the shared timer too
      t.running = false; t.since = 0; t.base = t.mode === 'down' ? t.duration : 0;
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

    // Snap a held piece a quarter-turn onward, and level it (middle-click).
    this.onMessage('snap', (client, { id }) => {
      const piece = this.state.pieces.get(id);
      if (!piece || piece.owner !== client.sessionId) return;
      const body = this.bodies.get(id);
      if (!body) return;

      // Read the piece's current facing, then advance to the next 90° step.
      const forward = new CANNON.Vec3(0, 0, 1), worldForward = new CANNON.Vec3();
      body.quaternion.vmult(forward, worldForward);
      const step = Math.PI / 2;
      const yaw = (Math.round(Math.atan2(worldForward.x, worldForward.z) / step) + 1) * step;
      body.quaternion.set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)); // pure yaw = flat + cardinal
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
    this.onMessage('remove', (client, { id }) => { if (this.rank(client) < RANK.helper) return; if (this.state.pieces.has(id)) this.removePiece(id); });
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
        s.set(rnd(), new ScoreRow(String(msg.label || 'Player').slice(0, 40), 0));
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
    } else if (KINDS[type].mass > 0 && type !== 'deck') {
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
      const deckData = (props.cards && props.cards.length)
        ? { back: props.back || 'back', cards: props.cards }
        : buildSimpleDeck();
      this.deckCards.set(id, deckData.cards.slice());
      piece.count = deckData.cards.length;
      piece.props = JSON.stringify({ back: deckData.back });
    } else {
      piece.props = JSON.stringify(props);
    }

    this.writeTransform(piece, body);
    this.state.pieces.set(id, piece);
    this.bodies.set(id, body);
    if (type === 'deck') this.updateDeckCollider(id); // match the collider to the stack height
    return id;
  }

  // --- Small card helpers (shared by the deal/draw/play handlers) -------------

  // Spawn a card lying flat at pos (no random tumble); returns its id. Callers
  // set the private front (cardData) and/or owner afterward as needed.
  spawnCardFlat(pos, publicProps) {
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
  addToHand(client, front, back) {
    const hand = this.hands.get(client.sessionId) || [];
    hand.push({ hid: 'h' + (this.nextHid++), front, back });
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

  // Rebuild a deck's collider box so its height matches its current card count.
  updateDeckCollider(deckId) {
    const body = this.bodies.get(deckId), piece = this.state.pieces.get(deckId);
    if (!body || !piece) return;
    while (body.shapes.length) body.removeShape(body.shapes[0]);
    const box = KINDS.deck.shape.box;
    body.addShape(new CANNON.Box(new CANNON.Vec3(box[0], deckHeight(piece.count) / 2, box[2])));
    body.updateBoundingRadius();
    body.updateMassProperties();
    body.wakeUp();
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
    if (piece.type === 'deck') return 'flat';          // decks default to flat
    return (PROPS[props.shape] || {}).stand;           // else the prop shape's default
  }
  // Which mode to switch a piece INTO when the toggle turns self-right on. Uses
  // the shape's declared default, or infers "flat" when the collider is thin on Y
  // (so a coin/checker lies down) and "stand tall" otherwise.
  naturalStand(piece) {
    if (piece.type === 'deck') return 'flat';
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
  }

  // Serialize the current table into a scene payload: the table size, and every
  // piece with its transform. A deck's private card list rides along so it comes
  // back as a real deck; a face-down card carries its private front.
  serializeScene() {
    const pieces = [];
    this.state.pieces.forEach((piece, id) => {
      let props = JSON.parse(piece.props || '{}');
      if (piece.type === 'deck') props = { back: props.back || 'back', cards: (this.deckCards.get(id) || []).slice() };
      else if (piece.type === 'card') { const cd = this.cardData.get(id); if (cd && cd.front) props = { ...props, front: cd.front, faceDown: true }; }
      pieces.push({ type: piece.type, props, x: piece.x, y: piece.y, z: piece.z, q: [piece.qx, piece.qy, piece.qz, piece.qw] });
    });
    return { table: { x: this.state.tableX, z: this.state.tableZ }, pieces };
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
    for (const e of (Array.isArray(scene.pieces) ? scene.pieces : [])) {
      if (this.state.pieces.size >= SIM.maxPieces) break;
      if (!e || !KINDS[e.type]) continue;
      const props = e.props || {};
      if (e.type === 'board') { this.swapBoard(props); continue; }
      const id = this.spawn(e.type, [+e.x || 0, Number.isFinite(+e.y) ? +e.y : 2, +e.z || 0], props, Array.isArray(e.q) ? e.q : null);
      if (e.type === 'card' && props.faceDown && props.front) this.cardData.set(id, { front: props.front });
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
    db.saveRoomState(this.roomId, { scoreboard: rows, notes: this.state.notes, tableX: this.state.tableX, tableZ: this.state.tableZ, skybox: this.state.skybox })
      .catch(e => console.error('[saveState]', e.message));
  }
  onDispose() { LIVE_ROOMS.delete(this); if (this._saveTimer) { clearTimeout(this._saveTimer); this.saveStateNow(); } } // flush a pending save

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
  canManage(actorRank, targetRole) {
    if (targetRole === 'owner') return false;
    if (targetRole === 'gm') return actorRank >= RANK.owner;
    return actorRank >= RANK.gm;
  }
  // Role changes: co-GM promote/demote is owner-only; the owner role is never set here.
  canSetRole(actorRank, currentRole, newRole) {
    if (newRole === 'owner' || currentRole === 'owner') return false;
    if (newRole === 'gm' || currentRole === 'gm') return actorRank >= RANK.owner;
    return actorRank >= RANK.gm;
  }
  async sendMembers(client) {
    if (this.roomId) client.send('memberList', await db.listMembers(this.roomId));
  }
  async broadcastMembers() { // push the fresh list to every GM viewing the panel
    if (!this.roomId) return;
    const list = await db.listMembers(this.roomId);
    for (const c of this.clients) if (this.rank(c) >= RANK.gm) c.send('memberList', list);
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

  rank(client) { return RANK[client.auth && client.auth.role] || 0; }
  isAdmin(client) { return !!(client.auth && client.auth.isAdmin); } // site admin — curates the library, spawns private assets anywhere

  onJoin(client) {
    const auth = client.auth || {};
    // Give the new player the lowest free seat and a colour to match.
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

    if (!this.state.turn) this.state.turn = client.sessionId; // first player to arrive starts
    this.sendHand(client);
    if (this.rank(client) >= RANK.gm) this.sendMembers(client); // GMs get the member list up front (pending pulse)
    client.send('whoami', { isAdmin: this.isAdmin(client) }); // lets the client hide library-creation UI from non-admins
  }

  // Advance the turn to the next player by seat order (wrapping around).
  advanceTurn() {
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
  update(dtMs) {
    const dt = dtMs / 1000;
    const stiffness = SIM.servo.stiffness, maxSpeed = SIM.servo.maxSpeed;

    // Pass 1 — held pieces. Instead of teleporting a held piece to the cursor, we
    // set its VELOCITY toward the drag target ("servo"). It stays a real body, so
    // it still shoves others and gets shoved, but tracks the cursor tightly.
    this.state.pieces.forEach((piece, id) => {
      if (!piece.owner) return;
      const target = this.targets.get(id), body = this.bodies.get(id);
      if (!target || !body) return;
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

// Security headers (clickjacking, HSTS, nosniff, referrer, hide X-Powered-By…).
// CSP is intentionally OFF for now: the client loads Three.js/Colyseus from CDNs
// (esm.sh, unpkg) via an inline import map, which a default CSP would block. To
// enable CSP, self-host those libraries (or allowlist the CDNs) and test it in a
// browser first — draft directives are below.
app.use(helmet({ contentSecurityPolicy: false }));
// app.use(helmet.contentSecurityPolicy({ directives: {
//   defaultSrc: ["'self'"],
//   scriptSrc:  ["'self'", "https://esm.sh", "https://unpkg.com", "'unsafe-inline'"], // 'unsafe-inline' = the import map
//   styleSrc:   ["'self'", "'unsafe-inline'"],
//   imgSrc:     ["'self'", "data:", "blob:"],       // avatars are data: URLs
//   connectSrc: ["'self'", "https://esm.sh", "ws:", "wss:"], // Colyseus websocket + module fetches
//   workerSrc:  ["'self'", "blob:"],
// }}));

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

// Image upload: one image per request, sent as a raw body (this sidesteps the
// WebSocket payload cap). Saved under a random name; responds with its URL ref.
app.post('/upload', express.raw({ type: 'image/*', limit: '16mb' }), (req, res) => {
  try {
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'empty' });
    const contentType = req.headers['content-type'] || '';
    const ext = (contentType.split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg';
    res.json({ url: saveAsset(req.query.kind, req.body, ext) }); // ?kind=uploads|decks|boards|props
  } catch (e) {
    res.status(500).json({ error: 'save failed' });
  }
});

// Model upload: a raw .glb of any content-type. Saved into the props/ category.
app.post('/upload-model', express.raw({ type: () => true, limit: '16mb' }), (req, res) => {
  try {
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'empty' });
    res.json({ url: saveAsset(req.query.kind || 'props', req.body, 'glb') });
  } catch (e) {
    res.status(500).json({ error: 'save failed' });
  }
});

// --- Auth (HTTP): signup / login / token-resolve --------------------------
// The landing page talks to these before joining any room. Passwords use scrypt;
// a successful signup or login also issues a durable device token — the raw value
// is returned once (stored client-side) so return visits log in without a password.
const clientUser = (u) => u && ({ id: u.id, username: u.username, email: u.email, avatar: u.avatar, isAdmin: u.isAdmin, canOwnRooms: u.canOwnRooms, hostStatus: u.hostStatus, hasPassword: u.hasPassword });
const validUsername = (s) => typeof s === 'string' && /^[a-zA-Z0-9_-]{3,20}$/.test(s.trim());
const validEmail = (s) => typeof s === 'string' && s.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());

app.post('/auth/signup', express.json({ limit: '1kb' }), async (req, res) => {
  const { username, email, password } = req.body || {};
  if (!validUsername(username)) return res.status(400).json({ error: 'username must be 3–20 chars (letters, numbers, _ or -)' });
  if (!validEmail(email)) return res.status(400).json({ error: 'invalid email' });
  if (password != null && String(password).length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
  try {
    const passwordHash = password ? await hashPassword(String(password)) : null; // password => a GM account
    const raw = makeToken();
    const user = await db.createUser({ username: username.trim(), email: email.trim(), passwordHash, loginTokenHash: hashToken(raw) });
    res.json({ user: clientUser(user), token: raw }); // client stores `token` for auto-login
  } catch (e) {
    if (e.conflict) return res.status(409).json({ error: `that ${e.conflict} is already taken`, field: e.conflict });
    console.error('[signup]', e.message); res.status(500).json({ error: 'signup failed' });
  }
});

app.post('/auth/login', express.json({ limit: '1kb' }), async (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) return res.status(400).json({ error: 'login and password required' });
  const u = await db.findUserByLogin(String(login).trim());
  // Same response whether the account is missing, passwordless, or the password is
  // wrong — don't reveal which. (Passwordless players can't password-login.)
  if (!u || !u.passwordHash || !(await verifyPassword(String(password), u.passwordHash))) {
    return res.status(401).json({ error: 'invalid login or password' });
  }
  const raw = makeToken();
  await db.setLoginToken(u.id, hashToken(raw)); // rotate the device token on each login
  res.json({ user: clientUser(u), token: raw });
});

app.post('/auth/token', express.json({ limit: '1kb' }), async (req, res) => {
  const u = await db.findUserByToken(hashToken(String((req.body && req.body.token) || '')));
  if (!u) return res.status(401).json({ error: 'invalid or expired token' });
  res.json({ user: clientUser(u) }); // auto-login on a return visit
});

// --- Rooms (HTTP): the lobby the landing page uses -------------------------
// Token-authenticated: the client sends its device token as a Bearer header and
// we resolve it to the acting user. (Enforcing membership/roles inside the live
// table is the next slice; this just creates rooms + records who's joined.)
async function requireUser(req, res) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const user = token ? await db.findUserByToken(hashToken(token)) : null;
  if (!user) { res.status(401).json({ error: 'not signed in' }); return null; }
  return user;
}
const roomCode = () => crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 hex chars

app.get('/rooms', async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const rooms = user.isAdmin ? await db.listRoomsForAdmin(user.id) : await db.listRoomsForUser(user.id);
  res.json({ rooms });
});

app.post('/rooms', express.json({ limit: '1kb' }), async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  if (!user.canOwnRooms) {
    return res.status(403).json({ error: user.hostStatus === 'pending'
      ? 'Your host access is pending admin approval.'
      : 'You need approved host access to create rooms.' });
  }
  const name = String((req.body && req.body.name) || '').trim().slice(0, 60) || 'Untitled Table';
  const requireApproval = !(req.body && req.body.requireApproval === false); // default true
  for (let attempt = 0; attempt < 5; attempt++) { // retry the rare code collision
    try {
      const room = await db.createRoom({ ownerId: user.id, code: roomCode(), name, requireApproval });
      return res.json({ room });
    } catch (e) {
      if (e.conflict === 'code') continue;
      console.error('[create room]', e.message); return res.status(500).json({ error: 'could not create room' });
    }
  }
  res.status(500).json({ error: 'could not allocate a room code' });
});

// Set the signed-in user's avatar from the lobby (no room needed). Same bounded
// image-data-URL rule as the in-room setAvatar handler.
app.post('/me/avatar', express.json({ limit: '128kb' }), async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const data = req.body && req.body.data;
  if (!isBoundedImageDataURL(data)) {
    return res.status(400).json({ error: 'invalid image' });
  }
  try { await db.setUserAvatar(user.id, data); res.json({ ok: true, avatar: data }); }
  catch (e) { console.error('[me/avatar]', e.message); res.status(500).json({ error: 'could not save avatar' }); }
});

// A player asks to become a host. Sets host_status = pending for an admin to
// approve. A passwordless player must set a password in the same step (hosting
// needs one). No-op if they can already host.
app.post('/host/request', express.json({ limit: '1kb' }), async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  if (user.canOwnRooms) return res.json({ user: clientUser(user) });
  if (!user.hasPassword) {
    const pw = req.body && req.body.password;
    if (!pw || String(pw).length < 8) return res.status(400).json({ error: 'set a password (8+ characters) to request host access' });
    await db.setPassword(user.id, await hashPassword(String(pw)));
  }
  await db.setHostStatus(user.id, 'pending');
  res.json({ user: clientUser(await db.findUserById(user.id)) });
});

app.post('/rooms/join', express.json({ limit: '1kb' }), async (req, res) => {
  const user = await requireUser(req, res); if (!user) return;
  const code = String((req.body && req.body.code) || '').trim().toUpperCase();
  const room = await db.findRoomByCode(code);
  if (!room) return res.status(404).json({ error: 'no active room with that code' });
  const membership = await db.joinRoom({ roomId: room.id, userId: user.id, requireApproval: room.requireApproval });
  // If they land pending, nudge any live table so its GMs' Members button pulses.
  if (membership && membership.status === 'pending') {
    try {
      const live = await matchMaker.query({ name: 'table', code });
      for (const r of live) await matchMaker.remoteRoomCall(r.roomId, 'broadcastMembers');
    } catch (e) { /* no live table; GMs will see it when they open the panel */ }
  }
  res.json({ room, membership }); // membership.status is 'pending' or 'admitted'
});

// Room lifecycle (owner or site-admin only): rename, toggle join policy, close.
async function ownedRoom(req, res) {
  const user = await requireUser(req, res); if (!user) return null;
  const room = await db.getRoom(req.params.id);
  if (!room || room.deletedAt) { res.status(404).json({ error: 'room not found' }); return null; }
  if (String(room.ownerId) !== String(user.id) && !user.isAdmin) { res.status(403).json({ error: 'not your room' }); return null; }
  return { user, room };
}

app.patch('/rooms/:id', express.json({ limit: '1kb' }), async (req, res) => {
  const ctx = await ownedRoom(req, res); if (!ctx) return;
  const name = req.body && typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 60) : null;
  if (name) await db.renameRoom(ctx.room.id, name);
  if (req.body && typeof req.body.requireApproval === 'boolean') await db.setRoomPolicy(ctx.room.id, req.body.requireApproval);
  res.json({ room: await db.getRoom(ctx.room.id) });
});

app.delete('/rooms/:id', async (req, res) => {
  const ctx = await ownedRoom(req, res); if (!ctx) return;
  await db.softDeleteRoom(ctx.room.id); // soft delete: hidden + unjoinable; code frees up
  // Shut down the live table if one is running for this code (kick everyone out).
  try {
    const live = await matchMaker.query({ name: 'table', code: ctx.room.code });
    for (const r of live) await matchMaker.remoteRoomCall(r.roomId, 'closeAndDispose');
  } catch (e) { console.error('[close] dispose live room:', e.message); }
  res.json({ ok: true });
});

// --- Admin console (site superusers only) ---------------------------------
async function requireAdmin(req, res) {
  const user = await requireUser(req, res); if (!user) return null;
  if (!user.isAdmin) { res.status(403).json({ error: 'admin only' }); return null; }
  return user;
}
async function disposeLive(code) { // shut down a running table for this code, if any
  try {
    const live = await matchMaker.query({ name: 'table', code });
    for (const r of live) await matchMaker.remoteRoomCall(r.roomId, 'closeAndDispose');
  } catch (e) { /* none running */ }
}

app.get('/admin/rooms', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  res.json({ rooms: await db.listRooms({ includeDeleted: true }) }); // active + soft-deleted, with owner name
});
app.get('/admin/orphans', async (req, res) => {     // dry-run: report unreferenced files, delete nothing
  if (!await requireAdmin(req, res)) return;
  try {
    const orphans = await findOrphanAssets();
    res.json({ count: orphans.length, totalBytes: orphans.reduce((s, o) => s + o.size, 0), files: orphans.slice(0, 200).map(o => ({ url: o.url, size: o.size })) });
  } catch (e) { console.error('[orphans scan]', e.message); res.status(500).json({ error: 'scan failed — nothing was deleted' }); }
});
app.post('/admin/orphans/purge', async (req, res) => { // re-scan fresh, then move orphans to .trash
  if (!await requireAdmin(req, res)) return;
  try {
    const orphans = await findOrphanAssets();          // never trust a stale client list
    const bytes = orphans.reduce((s, o) => s + o.size, 0);
    const moved = trashOrphans(orphans);
    res.json({ moved: moved.length, totalBytes: bytes });
  } catch (e) { console.error('[orphans purge]', e.message); res.status(500).json({ error: 'scan failed — nothing was deleted' }); }
});
app.get('/admin/users', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  res.json({ users: await db.listUsers() });
});
app.get('/admin/pending-count', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  res.json({ pending: await db.countPendingHosts() }); // for the console/lobby badge
});
app.post('/admin/users/:id/host', express.json({ limit: '1kb' }), async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const status = req.body && req.body.status;
  if (!['approved', 'pending', 'none'].includes(status)) return res.status(400).json({ error: 'bad status' });
  await db.setHostStatus(req.params.id, status); // approve -> 'approved', reject/revoke -> 'none'
  res.json({ ok: true });
});
app.post('/admin/rooms/:id/restore', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  await db.restoreRoom(req.params.id); // clears deleted_at (only works if the code is still free)
  res.json({ ok: true });
});
app.delete('/admin/rooms/:id', async (req, res) => { // permanent purge (cascades members)
  if (!await requireAdmin(req, res)) return;
  const room = await db.getRoom(req.params.id);
  if (room) await disposeLive(room.code);
  await db.purgeRoom(req.params.id);
  res.json({ ok: true });
});
app.post('/admin/users/:id/admin', express.json({ limit: '1kb' }), async (req, res) => {
  const me = await requireAdmin(req, res); if (!me) return;
  const makeAdmin = !!(req.body && req.body.isAdmin);
  if (String(req.params.id) === String(me.id) && !makeAdmin) {
    return res.status(400).json({ error: 'you cannot remove your own admin rights' }); // avoid locking out the last admin
  }
  await db.setAdmin(req.params.id, makeAdmin);
  res.json({ ok: true });
});
app.delete('/admin/users/:id', async (req, res) => {
  const me = await requireAdmin(req, res); if (!me) return;
  if (String(req.params.id) === String(me.id)) return res.status(400).json({ error: 'you cannot delete your own account' });
  const target = await db.findUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'user not found' });
  for (const r of await db.roomsOwnedBy(req.params.id)) await disposeLive(r.code); // kick anyone in their live tables
  try { await db.purgeUser(req.params.id); }
  catch (e) { console.error('[purge user]', e.message); return res.status(500).json({ error: 'could not delete user' }); }
  res.json({ ok: true });
});

const httpServer = createServer(app);
const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer, maxPayload: 4 * 1024 * 1024 }) });
gameServer.define('table', TableRoom).filterBy(['code']); // one live table per room code
gameServer.define('editor', EditorRoom); // single shared admin-only library workshop

const PORT = process.env.PORT || 2567;
gameServer.listen(PORT).then(() => console.log(`\n  Open Tabletop running →  http://localhost:${PORT}\n`));
