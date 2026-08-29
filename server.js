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
import {
  KINDS,
  PROPS,
  BOARDS,
  TABLE,
  deckHeight,
  MEASURE,
  DISPENSERS,
  stackVisible,
  gridActive,
  snapToCell,
  TRAY,
  trayCenter,
  trayParts,
  trayPlace,
  inTray,
  colorProps,
  STARTERS,
  cardGeom,
  sanitizeGeom,
  seatAngle,
  SEAT_ANGLES,
  LETTER_DIST,
  MAHJONG,
  DECK_MODELS,
} from './shared/pieces.js';
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
import { registerMemberHandlers } from './server/game/handlers/members.js';
import { registerLibraryHandlers } from './server/game/handlers/library.js';
import { registerPieceHandlers } from './server/game/handlers/pieces.js';
import {
  registerRoomStateHandlers,
  saveRoomStateNow,
  scheduleRoomSave,
} from './server/game/handlers/room-state.js';
import { registerOverlayHandlers } from './server/game/handlers/overlays.js';
import { registerRoomFeatureHandlers } from './server/game/handlers/room-features.js';
import { readProps, writeProps } from './server/game/props-codec.js';
import { bootstrapAdminFromEnvironment } from './server/bootstrap-admin.js';
import {
  boundedString,
  cardPlacementPayload,
  dispenserDragPayload,
  oneField,
  pieceIdPayload,
} from './server/message-validation.js';
import { createRateLimitStore, makeRateLimiter } from './server/rate-limit.js';
import { trustedProxyHops } from './server/redis-config.js';
import { safeMessage, safeRoomTask } from './server/game/safe-message.js';
import { buildCollider, buildWorld, COLLIDER_TYPES } from './server/physics.js';
import {
  applyScene as applyPersistedScene,
  serializeGame as serializePersistedGame,
  serializeScene as serializePersistedScene,
} from './server/game/scene-persistence.js';

// --- Simulation tuning (all the physics "feel" constants in one place) -------
const SIM = {
  gravity: -20, // world gravity (y)
  friction: 0.35,
  restitution: 0.2, // contact material
  tableThick: 0.5, // table slab half-height
  wall: { half: 4, thick: 0.5, over: 1 }, // walls: half-height (y 0..8), half-thickness, corner overlap
  servo: { stiffness: 25, maxSpeed: 45, angDamp: 0.6 }, // held-piece velocity servo (tracks cursor)
  damp: { flat: 0.5, solid: 0.15 }, // angular damping: cards/decks vs everything else
  flipHop: 1.6,
  flipArc: 0.7, // flip feedback nudge + kinematic arc height
  roll: { up: 16, spread: 8, spin: 22 }, // die roll impulse (up drives peak height ~ up^2)
  trayRoll: { up: 8, spread: 13, spin: 30 }, // tray-die roll: a real toss, kept in by the walls + lid
  impact: { minVel: 1.5 }, // min collision speed (m/s) to fire a landing sound
  spawnY: 4, // height a spawned piece drops from
  bounds: { margin: 1.5, floor: -3, ceiling: 12 }, // out-of-bounds safety net
  absorb: { x: 1.1, z: 1.4 }, // how close a dropped card must be to a deck to merge
  propRight: { strength: 9, maxTilt: 0.85, damp: 0.82 }, // self-righting for standing props (pawn/chess)
  throwCap: 40, // general release-speed clamp
  // --- global solver / contacts / timestep (stack stability vs CPU) ---
  solverIterations: 12, // contact solver passes: more = firmer stacks, more CPU
  contact: { stiffness: 1e7, relaxation: 3 }, // contact-equation firmness / relaxation
  step: { fixed: 1 / 120, maxSub: 4 }, // physics timestep: smaller fixed + more substeps = less tunneling, more CPU
  // --- CARDS: the thin-stack problem is tuned here ---------------------------
  cards: {
    colliderThick: 0.04, // HALF-thickness of the INVISIBLE card collider (the mesh stays thin). Bigger = far more
    //   stable stacks & less clip-through, but stacked cards show a small air-gap. Try 0.03–0.08.
    linDamp: 0.25, // linear damping — cards settle sooner
    angDamp: 0.7, // angular damping for cards (overrides damp.flat)
    maxThrow: 14, // clamp a card's release speed so a flung card can't tunnel through another
    sleepSpeed: 0.5, // a card goes fully static (stops jittering) below this speed...
    sleepTime: 0.2, // ...sustained for this many seconds
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
const LIBRARY_KINDS = ['deck', 'board', 'prop', 'scene', 'sky'];
for (const kind of ASSET_KINDS) fs.mkdirSync(path.join(ASSETS_DIR, kind), { recursive: true });

// Clamp a number into [min, max].
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const GRID_LIFT_MAX = 3; // how high (world units) the table grid can float above the felt
// A bounded image data-URL (the only avatar shape we accept — small enough to
// sync in state, and never an arbitrary URL/script). Used by setAvatar + /me/avatar.
const isBoundedImageDataURL = (data) =>
  typeof data === 'string' && data.startsWith('data:image') && data.length < 60000;
// A skybox reference: '' (default), a local equirect URL, or a cube descriptor
// {"t":"cube","f":[6 local urls]}. Only local /assets/sky/ or /sky/ paths, never
// external — every client loads it.
const skyUrlOk = (u) =>
  typeof u === 'string' &&
  u.length < 300 &&
  !u.includes('..') &&
  (u.startsWith('/assets/sky/') || u.startsWith('/sky/'));
const validSky = (v) => {
  if (v === '') return true;
  if (typeof v !== 'string' || v.length > 2000) return false;
  if (v[0] === '{') {
    let d;
    try {
      d = JSON.parse(v);
    } catch {
      return false;
    }
    return !!d && d.t === 'cube' && Array.isArray(d.f) && d.f.length === 6 && d.f.every(skyUrlOk);
  }
  return skyUrlOk(v);
};

// Keep an untrusted category name inside the allowlist (falls back to 'uploads').
const assetKind = (kind) => (ASSET_KINDS.includes(kind) ? kind : 'uploads');

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
const LIVE_ROOMS = new Set(); // in-process TableRoom instances (see onCreate/onDispose)
const ASSET_PATH_RE = /\/assets\/(?:uploads|decks|boards|props|sky)\/[A-Za-z0-9._-]+/g;
const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const extractAssetPaths = (str, set) => {
  const m = String(str).match(ASSET_PATH_RE);
  if (m) for (const p of m) set.add(p);
};

async function findOrphanAssets() {
  const referenced = new Set();
  for (const blob of await db.allAssetRefBlobs()) extractAssetPaths(blob, referenced); // DB refs (throws → abort)
  for (const room of LIVE_ROOMS) extractAssetPaths(JSON.stringify(room.state.toJSON()), referenced); // live tables
  const cutoff = Date.now() - ORPHAN_MIN_AGE_MS;
  const orphans = [];
  for (const kind of ASSET_KINDS) {
    let names;
    try {
      names = fs.readdirSync(path.join(ASSETS_DIR, kind));
    } catch {
      continue;
    }
    for (const name of names) {
      let st;
      try {
        st = fs.statSync(path.join(ASSETS_DIR, kind, name));
      } catch {
        continue;
      }
      if (!st.isFile() || st.mtimeMs > cutoff) continue; // skip dirs and too-new files
      if (referenced.has(`/assets/${kind}/${name}`)) continue; // still in use
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
    } catch (e) {
      console.error('[cleanup] move', o.url, e.message);
    }
  }
  return moved;
}

// --- Synced state ----------------------------------------------------------
// defineTypes() is the no-build-step way to declare schema in plain JS.
// (The modern alternative is TypeScript with @type() decorators.)
// Clients rebuild this schema automatically via reflection — no shared file.
class Piece extends Schema {}
defineTypes(Piece, {
  type: 'string',
  owner: 'string',
  props: 'string',
  count: 'number', // count = cards in a deck (0 for other pieces)
  x: 'number',
  y: 'number',
  z: 'number',
  qx: 'number',
  qy: 'number',
  qz: 'number',
  qw: 'number',
});
class Player extends Schema {} // PUBLIC per-player info: seat + how many cards they hold (never which cards)
defineTypes(Player, {
  seat: 'number',
  hand: 'number',
  name: 'string',
  color: 'string',
  avatar: 'string',
  showing: 'number',
  handBack: 'string',
  role: 'string',
}); // showing = how many hand cards this player is currently revealing (public badge; never the content); handBack = the (public) back image of their hand cards; role = their per-room role (owner/gm/helper/player)

// Per-room role ladder — the server gates privileged actions by rank, and the
// client hides tools it can't use (courtesy only; these checks are the real rule).
// PUBLIC shared timer. We sync only the anchor (running/mode/base/since), never a
// ticking number — each client computes the live value with timerLive(), the same
// way the render loop interpolates piece positions locally. base = ms frozen at
// the last pause; since = server Date.now() at the last start (0 while paused).
class Timer extends Schema {
  constructor() {
    super();
    this.running = false;
    this.mode = 'up';
    this.base = 0;
    this.since = 0;
    this.duration = 300000;
  }
}
defineTypes(Timer, {
  running: 'boolean',
  mode: 'string',
  base: 'number',
  since: 'number',
  duration: 'number',
});
// A durable scoreboard row: a free label + a number, keyed by id in State.scores.
class ScoreRow extends Schema {
  constructor(label = '', score = 0) {
    super();
    this.label = label;
    this.score = score;
  }
}
defineTypes(ScoreRow, { label: 'string', score: 'number' });
// The whiteboard is a synced singleton (like the timer), NOT a physics piece: it
// rides a circular track behind the players (angle), one person "owns" it to draw,
// and it's dark (chalkboard) or light (whiteboard). Strokes are held server-side,
// not in the schema. Ephemeral — gone on room dispose.
class Whiteboard extends Schema {
  constructor() {
    super();
    this.enabled = false;
    this.angle = 0;
    this.owner = '';
    this.dark = true;
  }
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
  constructor() {
    super();
    this.worldPerUnit = 1;
    this.unitLabel = 'u';
    this.roundStep = 0.1;
    this.cellWorld = 0;
    this.cellZ = 0;
    this.gridX = 0;
    this.gridZ = 0;
    this.gridStyle = 'off';
    this.gridColor = '#ffffff';
    this.gridLift = 0.05;
    this.snapAnchor = 'center';
    this.gridHidden = false;
  }
}
defineTypes(RoomScale, {
  worldPerUnit: 'number',
  unitLabel: 'string',
  roundStep: 'number',
  cellWorld: 'number',
  cellZ: 'number',
  gridX: 'number',
  gridZ: 'number',
  gridStyle: 'string',
  gridColor: 'string',
  gridLift: 'number',
  snapAnchor: 'string',
  gridHidden: 'boolean',
});
// PUBLIC measurement/template overlay — a flat, non-physics annotation on the felt
// (rendered via the OVERLAY registry client-side). Every overlay is two points plus
// optional scalars, so one shape + one interaction (drag A→B) covers ruler today and
// circle/cone/line next. Never enters the physics world.
class Overlay extends Schema {
  constructor() {
    super();
    this.kind = 'ruler';
    this.color = '#ffffff';
    this.owner = '';
    this.x = 0;
    this.z = 0;
    this.x2 = 0;
    this.z2 = 0;
    this.w = 0;
    this.ang = 0;
  }
}
defineTypes(Overlay, {
  kind: 'string',
  color: 'string',
  owner: 'string',
  x: 'number',
  z: 'number',
  x2: 'number',
  z2: 'number',
  w: 'number',
  ang: 'number',
});
class State extends Schema {
  constructor() {
    super();
    this.pieces = new MapSchema();
    this.players = new MapSchema();
    this.turn = '';
    this.timer = new Timer();
    this.scores = new MapSchema();
    this.notes = '';
    this.tableX = TABLE.x;
    this.tableZ = TABLE.z;
    this.whiteboard = new Whiteboard();
    this.trays = new MapSchema();
    this.skybox = '';
    this.feltColor = '#2f6b4f';
    this.roomName = '';
    this.turnPending = '';
    this.unclaimed = new MapSchema();
    this.scale = new RoomScale();
    this.overlays = new MapSchema();
  }
}
defineTypes(State, {
  pieces: { map: Piece },
  players: { map: Player },
  turn: 'string',
  timer: Timer,
  scores: { map: ScoreRow },
  notes: 'string',
  tableX: 'number',
  tableZ: 'number',
  whiteboard: Whiteboard,
  trays: { map: 'boolean' },
  skybox: 'string',
  feltColor: 'string',
  roomName: 'string',
  turnPending: 'string',
  unclaimed: { map: 'string' },
  scale: RoomScale,
  overlays: { map: Overlay },
});

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

const rnd = () => [(Math.random() - 0.5) * 8, SIM.spawnY, (Math.random() - 0.5) * 6];
// The landing/drop cue for a piece. A TILE (a card/deck carrying a `tile` kind — domino/letter/mahjong)
// clacks like a tile / thunks like its wooden box, instead of the paper card/deck sounds.
const isTilePiece = (p) => !!(p && p.tile);
const dropSfx = (t, p) =>
  t === 'card'
    ? isTilePiece(p)
      ? 'tile-drop'
      : 'card-drop'
    : t === 'deck'
      ? isTilePiece(p)
        ? 'tiledeck-drop'
        : 'deck-drop'
      : t === 'die'
        ? 'die-drop'
        : 'object-drop';

// Fisher–Yates in-place shuffle.
const shuffle = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
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

// The PUBLIC geometry/behavior a card/tile inherits from its deck: a named tile kind (`tile`), an
// explicit `geom` (custom-aspect image decks), and a `snap` flag (word tiles snap to the grid). Plain
// playing cards carry none, so this returns {} and nothing extra is stored — normal cards are
// untouched. Threaded wherever a card is dealt, drawn, held, or played, so a face-down tile still
// shows its true shape (and snap behavior) while its face is private.
const geoOf = (o) => {
  const g = {};
  if (o && o.tile) g.tile = o.tile;
  if (o && o.geom) g.geom = o.geom;
  if (o && o.snap) g.snap = true;
  return g;
};

// --- The room --------------------------------------------------------------
class TableRoom extends Room {
  async onCreate(options) {
    this.setState(new State());
    this.world = buildWorld(SIM);
    this.mat = this.world.__mat;
    LIVE_ROOMS.add(this); // so orphan cleanup can see this table's live asset references
    this.roomCode = (options && options.code) || null;
    const roomRec = this.roomCode ? await db.findRoomByCode(this.roomCode) : null;
    this.roomId = roomRec ? roomRec.id : null; // this live table's persistent room id (for membership)
    this.state.roomName = roomRec ? String(roomRec.name || '').slice(0, 60) : ''; // synced display name for the table header (empty for the code-less editor room)
    if (this.roomId) {
      // restore the durable scoreboard, notes, and table size for this room
      const rs = await db.getRoomState(this.roomId);
      for (const row of rs.scoreboard) {
        if (row && row.id)
          this.state.scores.set(
            String(row.id),
            new ScoreRow(String(row.label || '').slice(0, 40), Number(row.score) || 0),
          );
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
    this.bodies = new Map(); // id -> CANNON.Body   (physics, not synced)
    this.targets = new Map(); // id -> {x,y,z}       (drag target of the owner)
    this.groups = new Map(); // sessionId -> Map(id -> {x,y,z} offset)  (a multi-select group drag)
    this._released = new Map(); // id -> release time; first hard impact after fires a landing sound
    this.flips = new Map(); // id -> scripted half-flip in progress
    this.deckCards = new Map(); // id -> [frontRef]        PRIVATE: a deck's face-down cards (never synced)
    this.drafts = new Map(); // sessionId -> {back,cards} PRIVATE: a deck being built in chunks
    this.cardData = new Map(); // id -> { front }         PRIVATE: a face-down table card's hidden face
    this.hands = new Map(); // sessionId -> [{hid,front,back}]  PRIVATE: each player's hidden hand
    this.lastDrop = new Map(); // sessionId -> { ids:[pieceId], ts }  PRIVATE: undo for handToTable
    this.notebooks = new Map(); // user/session key -> text         PRIVATE: each player's notes (ephemeral; dies with the room)
    this.strokes = []; // whiteboard stroke history (server-held; sent to late-joiners, gone on dispose)
    this.chatLog = []; // recent public chat (server-held; last 80, sent to late-joiners, gone on dispose)
    this.shows = new Map(); // sessionId -> {to:Set,cards:[]}   PRIVATE: an active hold-to-show (who sees which of the shower's cards)
    this.pendingInspect = new Map(); // sessionId -> {deckId,front,back}  PRIVATE: a card drawn to inspect, not yet placed
    this.pendingHands = new Map(); // userId -> {name,cards}  saved-game hands awaiting their owner's return (rebind on join)
    this.pendingTurn = null; // userId whose turn it was in a saved game, awaiting their return
    this.nextId = 1;
    this.nextHid = 1;
    this.nextOverlayId = 1;
    // Scoreboard row ids: a plain counter, seeded past any rows just restored above
    // (their 's<N>' keys) so a reloaded room's next add can't collide with an old row.
    this.nextScoreId = 1;
    this.state.scores.forEach((_, id) => {
      const n = /^s(\d+)$/.exec(id);
      if (n) this.nextScoreId = Math.max(this.nextScoreId, +n[1] + 1);
    });
    if (this.savedScene) this.applyScene(this.savedScene); // rebuild the saved table state (pieces persist across an empty room)

    // Contain unexpected failures in every inline table message. Specialized
    // library handlers below override the public message while sharing the same
    // logging and recovery behavior.
    const tableMessage = (type, handler) => safeMessage(this, type, handler);

    // --- Movement: grab → drag → release (single + multi-select) ---------
    registerMovementHandlers(this, {
      isMovable: (piece) => !!(KINDS[piece.type] && KINDS[piece.type].mass > 0),
      maxPieces: SIM.maxPieces,
    });

    registerPieceHandlers(this, {
      maxPieces: SIM.maxPieces,
      flipHop: SIM.flipHop,
      roll: SIM.roll,
      trayRoll: SIM.trayRoll,
      boardKeys: Object.keys(BOARDS),
      propKeys: Object.keys(PROPS),
      dispenserKeys: Object.keys(DISPENSERS),
      colliders: COLLIDER_TYPES,
      geoOf,
      randomPosition: rnd,
    });

    // --- Cards: flip, deal, take, inspect, shuffle, split ----------------------
    registerCardHandlers(this, {
      flipHop: SIM.flipHop,
      maxPieces: SIM.maxPieces,
      spawnY: SIM.spawnY,
      geoOf,
      dropSfx,
      randomPosition: rnd,
      shuffle,
    });

    // Dispensers: hand out one item on left-click / left-drag (right-drag moves the
    // whole thing, handled by the generic grab). Uniform, public copies — no private
    // list, unlike a deck. dispense = drop beside it; dispenseDrag = drop + carry.
    tableMessage('dispense', (client, message) => {
      const parsed = pieceIdPayload(message);
      if (!parsed) return;
      const { id } = parsed;
      const disp = this.state.pieces.get(id);
      if (!disp || disp.type !== 'dispenser') return;
      const item = this.dispenserItem(disp);
      if (!item) return;
      const body = this.bodies.get(id);
      this.spawn(item.type, body ? this.besideDeck(body) : rnd(), item.props);
      this.afterDispense(disp, id);
      this.broadcast('sfx', { type: 'object-drop' });
    });
    tableMessage('dispenseDrag', (client, message) => {
      const msg = dispenserDragPayload(message);
      if (!msg) return;
      const disp = this.state.pieces.get(msg.id);
      if (!disp || disp.type !== 'dispenser') return;
      const item = this.dispenserItem(disp);
      if (!item) return;
      const body = this.bodies.get(msg.id);
      const newId = this.spawn(
        item.type,
        body ? [body.position.x, 2.5, body.position.z] : rnd(),
        item.props,
      );
      this.afterDispense(disp, msg.id);
      // Hand the new item straight to the dragger's cursor (reuses the deal-adopt path).
      this.state.pieces.get(newId).owner = client.sessionId;
      this.targets.set(newId, { x: msg.x, y: msg.y, z: msg.z });
      client.send('dealt', { id: newId });
    });

    registerLibraryHandlers(this, {
      db,
      boardKeys: Object.keys(BOARDS),
      colliders: COLLIDER_TYPES,
      libraryKinds: LIBRARY_KINDS,
      refOk: deckRefOk,
      sanitizeGeom,
      randomPosition: rnd,
      sceneMaxBytes: SCENE_MAX_BYTES,
      skyUrlOk,
    });

    registerRoomStateHandlers(this, {
      createScoreRow: (label, score) => new ScoreRow(label, score),
      tableLimits: TABLE_LIMIT,
      gridLiftMax: GRID_LIFT_MAX,
      sceneMaxBytes: SCENE_MAX_BYTES,
    });

    // Play a card from your hand onto the table, face-up or face-down.
    tableMessage('playCard', (client, message) => {
      const parsed = cardPlacementPayload(message);
      if (!parsed) return;
      const { hid, faceDown, x, z } = parsed;
      const hand = this.hands.get(client.sessionId);
      if (!hand) return;
      const index = hand.findIndex((card) => card.hid === hid);
      if (index < 0) return;
      const [card] = hand.splice(index, 1);

      const pos =
        typeof x === 'number' && typeof z === 'number'
          ? [x, 3, z] // where the client dropped it
          : [(Math.random() - 0.5) * 4, 3, (Math.random() - 0.5) * 3]; // or scattered
      const id = this.spawnCardFlat(
        pos,
        faceDown
          ? { back: card.back, ...geoOf(card) }
          : { front: card.front, back: card.back, ...geoOf(card) },
      );
      if (faceDown) this.cardData.set(id, { front: card.front }); // front private until flipped
      this.sendHand(client);
      this.broadcast('sfx', { type: dropSfx('card', card) }); // played tile clacks
    });

    // Put the player's whole hand on the table (e.g. an Uno "swap hands"), face up or
    // down, spread just in front of their marker (x/z sent by the client).
    tableMessage('handToTable', (client, message) => {
      const parsed = cardPlacementPayload(message, { wholeHand: true });
      if (!parsed) return;
      const { faceDown, x, z } = parsed;
      const hand = this.hands.get(client.sessionId);
      if (!hand || !hand.length) return;
      const cx = typeof x === 'number' ? x : 0,
        cz = typeof z === 'number' ? z : 0;
      let spawned = 0;
      const ids = []; // remember what we created, so the drop can be undone
      for (const card of hand) {
        if (this.state.pieces.size >= SIM.maxPieces) break; // respect the piece cap
        const pos = [cx + (Math.random() - 0.5) * 3, 0.1, cz + (Math.random() - 0.5) * 1.6];
        const id = this.spawnCardFlat(
          pos,
          faceDown
            ? { back: card.back, ...geoOf(card) }
            : { front: card.front, back: card.back, ...geoOf(card) },
        );
        if (faceDown) this.cardData.set(id, { front: card.front });
        ids.push(id);
        spawned++;
      }
      hand.splice(0, spawned);
      this.sendHand(client);
      if (spawned) {
        this.lastDrop.set(client.sessionId, { ids, ts: Date.now() });
        this.broadcast('sfx', { type: 'hand-drop' });
      }
    });
    tableMessage('handFromTable', (client) => {
      const batch = this.lastDrop.get(client.sessionId);
      this.lastDrop.delete(client.sessionId); // one shot, either way
      if (!batch || Date.now() - batch.ts > 30000) return; // 30s grace, matching the toast
      let restored = 0;
      for (const id of batch.ids) {
        const piece = this.state.pieces.get(id);
        if (!piece || piece.type !== 'card') continue; // moved, taken, or table reset
        const props = readProps(piece);
        const front = (this.cardData.get(id) || {}).front || props.front;
        this.addToHand(client, front, props.back || 'back', geoOf(props));
        this.removePiece(id);
        restored++;
      }
      client.send('dropUndone', { restored });
      if (restored) this.broadcast('sfx', { type: 'card-take' });
    });
    // Wipe the room back to an empty table — pieces and all private state.
    tableMessage('reset', (client) => {
      if (this.rank(client) < RANK.gm) return; // wiping the table is GM+
      this.clearTable();
      const t = this.state.timer; // stop and zero the shared timer too
      t.running = false;
      t.since = 0;
      t.base = t.mode === 'down' ? t.duration : 0;
    });

    // Load a one-click starter game — clears the table and sets up the chosen game (GM+).
    tableMessage('loadStarter', (client, message) => {
      if (this.rank(client) < RANK.gm) return; // replacing the whole table is GM+ (like scene load / reset)
      const parsed = oneField(message, 'game', (game) =>
        typeof game === 'string' && STARTERS[game] ? game : null,
      );
      if (!parsed) return;
      this.setupStarter(parsed.game);
    });

    // --- Member management (DB-backed; all mutations authorized server-side) ---
    registerMemberHandlers(this, { db });

    tableMessage('nextTurn', () => this.advanceTurn());
    tableMessage('setName', (client, message) => {
      const parsed = oneField(message, 'name', (name) => boundedString(name, { min: 1, max: 20 }));
      if (!parsed) return;
      const player = this.state.players.get(client.sessionId);
      if (player) player.name = parsed.name.trim() || player.name;
    });
    tableMessage('setAvatar', async (client, message) => {
      const parsed = oneField(message, 'data', (data) =>
        isBoundedImageDataURL(data) ? data : null,
      );
      if (!parsed) return;
      const player = this.state.players.get(client.sessionId);
      if (player) {
        // Persist to the account so it follows the user across sessions and rooms.
        if (client.auth && client.auth.userId)
          await db.setUserAvatar(client.auth.userId, parsed.data);
        player.avatar = parsed.data;
      }
    });
    registerOverlayHandlers(this, {
      createOverlay: () => new Overlay(),
      kinds: OVERLAY_KINDS,
      maxLength: MEASURE.maxLen,
      maxOverlays: OVERLAY_MAX,
      maxPerPlayer: OVERLAY_MAX_PER_PLAYER,
      maxStrokes: WHITEBOARD_MAX_STROKES,
    });

    registerRoomFeatureHandlers(this, {
      trayRoll: SIM.trayRoll,
      validSky,
    });

    this.setSimulationInterval((dt) => this.update(dt), 1000 / 60); // fixed 60Hz sim
    this.setPatchRate(1000 / 60); // 60Hz state broadcast (delta-compressed; cheap on LAN)
  }

  // Create a piece: a physics body + a synced Piece record, wired together by id.
  // pos is [x,y,z]; props are the type-specific fields (shape, sides, back, …).
  spawn(type, pos, props = {}, quat = null) {
    const mass = type === 'prop' ? (PROPS[props.shape] || PROPS.box).mass : KINDS[type].mass;
    const body = new CANNON.Body({ mass, material: this.mat });
    const collider = buildCollider(type, props, { cardColliderThickness: SIM.cards.colliderThick });
    if (collider.shape)
      body.addShape(collider.shape, collider.offset); // some colliders (flat) sit off-centre
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
      body.angularDamping = type === 'deck' ? SIM.damp.flat : SIM.damp.solid;
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
      const deckData =
        props.set === 'domino'
          ? buildDominoSet() // a domino boneyard, spawned on its own (no starter/table-clear)
          : props.set === 'letter'
            ? buildScrabbleBag() // a Wordy McWordface letter bag on its own
            : props.set === 'mahjong'
              ? buildMahjongWall() // a 144-tile mahjong wall on its own
              : props.cards && props.cards.length
                ? {
                    back: props.back || 'back',
                    cards: props.cards,
                    ...geoOf(props),
                    deckModel: props.deckModel,
                  } // pre-built cards (e.g. a starter) can carry a skin
                : buildSimpleDeck(!!props.jokers);
      this.deckCards.set(id, deckData.cards.slice());
      piece.count = deckData.cards.length;
      const deckProps = { back: deckData.back, ...geoOf(deckData) }; // deck-level tile/geom rides to its cards
      if (deckData.deckModel && DECK_MODELS[deckData.deckModel])
        deckProps.model = deckData.deckModel; // an optional 3D box/bag skin (server-set only)
      writeProps(piece, deckProps);
    } else if (type === 'dispenser') {
      const d = DISPENSERS[props.disp] || {};
      piece.count = d.infinite || !d.count ? 0 : clamp(+props.count || d.count.def, 1, d.count.max); // remaining items (0 = infinite)
      writeProps(piece, props);
    } else {
      writeProps(piece, props);
    }

    this.writeTransform(piece, body);
    this.state.pieces.set(id, piece);
    this.bodies.set(id, body);
    body.addEventListener('collide', (e) => {
      // landing sound, only for pieces a player just dropped
      const rel = this._released.get(id);
      if (rel === undefined) return; // deals/rolls/idle collisions stay silent here
      if (Date.now() - rel > 3000) {
        this._released.delete(id);
        return;
      } // never really landed — disarm
      if (Math.abs(e.contact.getImpactVelocityAlongNormal()) < SIM.impact.minVel) return; // ignore gentle grazes
      this._released.delete(id); // one cue per drop (kills multi-bounce spam)
      this.broadcast('sfx', { type: dropSfx(type, props) }); // props carries `tile` for tile pieces/decks
    });
    if (type === 'deck') this.updateDeckCollider(id); // match the collider to the stack height
    if (type === 'dispenser') this.updateStackCollider(id); // stack cylinder ∝ count (no-op for a bowl)
    return id;
  }

  // --- Small card helpers (shared by the deal/draw/play handlers) -------------

  // Spawn a card lying flat at pos (no random tumble); returns its id. Callers
  // set the private front (cardData) and/or owner afterward as needed.
  spawnCardFlat(pos, publicProps) {
    if (publicProps && publicProps.snap && gridActive(this.state.scale)) {
      // a word tile played onto the board snaps into its cell
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
    hand.push({ hid: 'h' + this.nextHid++, front, back, ...geo }); // geo = {tile}/{geom} for tile cards; nothing for plain cards
    this.hands.set(client.sessionId, hand);
    this.sendHand(client);
  }

  // Replace the current board with a new one (there's only ever one). The board
  // rests on the table by its own half-height so it sits flush, not sunk in.
  swapBoard(props) {
    const oldBoards = [];
    this.state.pieces.forEach((piece, id) => {
      if (piece.type === 'board') oldBoards.push(id);
    });
    oldBoards.forEach((id) => this.removePiece(id));

    const builtin = props.board && BOARDS[props.board];
    const box = builtin ? builtin.box : props.model && Array.isArray(props.box) ? props.box : null;
    return this.spawn('board', [0, box ? box[1] : 0.05, 0], props);
  }

  // Set the room's square grid from the current board's real size: cell = board width ÷ gaps.
  // Built-in boards store the gap count + anchor; a custom board takes them from `msg`. Returns
  // { cellX, cellZ, gaps, anchor } (or null) so a starter setup can place pieces on the squares.
  calibrateGrid(msg = {}) {
    let boardId = null;
    this.state.pieces.forEach((p, id) => {
      if (!boardId && p.type === 'board') boardId = id;
    }); // the single table board
    if (!boardId) return null;
    const spec = BOARDS[readProps(this.state.pieces.get(boardId)).board];
    let gaps, anchor;
    if (spec && spec.grid) {
      gaps = spec.grid.cells;
      anchor = spec.grid.anchor;
    } else {
      anchor = msg.anchor === 'cross' ? 'cross' : 'center';
      const count = Math.round(+msg.cells);
      gaps = anchor === 'cross' ? count - 1 : count;
    }
    if (!(gaps > 0)) return null;
    const sc = this.state.scale;
    // A board can pin its exact printed-line spacing (cellX/cellZ) — needed when a wide border
    // means the lines don't fill the collider (go). Otherwise derive cell = board width ÷ gaps.
    if (spec && spec.grid && spec.grid.cellX > 0) {
      sc.cellWorld = clamp(spec.grid.cellX, 1e-3, 1e3);
      sc.cellZ = clamp(spec.grid.cellZ > 0 ? spec.grid.cellZ : spec.grid.cellX, 1e-3, 1e3);
    } else {
      const body = this.bodies.get(boardId),
        shape = body && body.shapes[0];
      const he = shape && shape.halfExtents;
      const wx = he ? he.x * 2 : 0,
        wz = he ? he.z * 2 : 0;
      if (!(wx > 0) || !(wz > 0)) return null;
      sc.cellWorld = clamp(wx / gaps, 1e-3, 1e3);
      sc.cellZ = clamp(wz / gaps, 1e-3, 1e3);
    }
    sc.gridX = 0;
    sc.gridZ = 0; // the board is centred at the origin, so no offset
    sc.gridStyle = 'square';
    sc.snapAnchor = anchor === 'cross' ? 'cross' : 'center';
    this.scheduleSave();
    return { cellX: sc.cellWorld, cellZ: sc.cellZ, gaps, anchor: sc.snapAnchor };
  }

  // Deal `n` cards from a deck to each SEATED player's private hand (starter setups deal a
  // starting rack, e.g. dominoes). The deck's tile/geom rides along so held tiles keep their
  // shape. Trims the deck and removes it if it empties.
  dealFromDeckToSeats(deckId, n) {
    const deck = this.state.pieces.get(deckId),
      cards = this.deckCards.get(deckId);
    if (!deck || !cards) return;
    const dp = readProps(deck),
      back = dp.back || 'back',
      geo = geoOf(dp);
    for (const client of this.clients) {
      if (this.seatOf(client) == null) continue; // seated players only
      for (let i = 0; i < n && cards.length; i++) this.addToHand(client, cards.pop(), back, geo);
    }
    deck.count = cards.length;
    if (!cards.length) this.removePiece(deckId);
    else this.updateDeckCollider(deckId);
  }

  // Load a ready-to-play starter game: clear the table, then set up the board + pieces (or the
  // deck + chips) so a host has a complete game in one click. Replaces the whole table (GM+).
  setupStarter(game) {
    const def = STARTERS[game];
    if (!def) return false;
    this.clearTable();
    let gridded = false;
    if (def.board) {
      this.swapBoard({ board: def.board });
      // Turn on the board's grid: chess/checkers derive cell = width ÷ cells; go pins its exact
      // printed-line spacing (BOARDS.go.grid.cellX/cellZ) so its bordered lines line up.
      const grid = this.calibrateGrid();
      if (grid) {
        gridded = true;
        this.state.scale.gridHidden = true; // starter games snap to the grid but don't draw it
        if (def.pieces) {
          const cells = def.cells || 8,
            half = (cells - 1) / 2;
          const boardTop = (BOARDS[def.board].box[1] || 0.15) * 2; // board sits at y=box[1], half-height box[1]
          for (const p of def.pieces()) {
            if (this.state.pieces.size >= SIM.maxPieces) break;
            const x = (p.col - half) * grid.cellX,
              z = (p.row - half) * grid.cellZ;
            const box = ((PROPS[p.shape] || {}).collider || {}).box;
            const restY = boardTop + (box ? box[1] : 0.2) + 0.03; // sit it ON the board, no drop-tumble
            // Identity quaternion → spawn UPRIGHT (no random tumble), so tall pieces don't fall
            // across neighbouring squares and knock the set over as they settle.
            this.spawn(
              'prop',
              [x, restY, z],
              { shape: p.shape, team: p.team, snap: true },
              [0, 0, 0, 1],
            );
          }
        }
      }
    }
    if (!gridded) {
      this.state.scale.gridStyle = 'off';
      this.scheduleSave();
    } // board-less games (poker/dominoes): no stale grid
    for (const b of def.bowls || [])
      this.spawn('dispenser', [b.x, SIM.spawnY, b.z], { disp: b.disp, team: b.team });
    if (def.deck) {
      const d = def.deck === true ? {} : def.deck; // {set?, deal?, jokers?}
      const built =
        d.set === 'domino'
          ? buildDominoSet()
          : d.set === 'letter'
            ? buildScrabbleBag()
            : d.set === 'mahjong'
              ? buildMahjongWall()
              : buildSimpleDeck(!!d.jokers);
      const deckId = this.spawn('deck', [0, SIM.spawnY, def.deckZ ?? 0], {
        back: built.back,
        cards: built.cards,
        ...geoOf(built),
        deckModel: built.deckModel,
      }); // carry the box/bag skin, if any
      if (d.deal > 0) this.dealFromDeckToSeats(deckId, d.deal); // deal a starting rack to each seated player
    }
    for (const s of def.stacks || [])
      this.spawn('dispenser', [s.x, SIM.spawnY, s.z], { disp: s.disp, color: s.color });
    return true;
  }

  // Rebuild a deck's collider box so its height matches its current card count.
  updateDeckCollider(deckId) {
    const body = this.bodies.get(deckId),
      piece = this.state.pieces.get(deckId);
    if (!body || !piece) return;
    while (body.shapes.length) body.removeShape(body.shapes[0]);
    const props = readProps(piece);
    const skin = props.model && DECK_MODELS[props.model];
    if (skin) {
      // a modeled deck (box/bag): a fixed box, not a growing stack
      const [bx, by, bz] = skin.box;
      body.addShape(new CANNON.Box(new CANNON.Vec3(bx, by, bz)));
    } else {
      const g = cardGeom(props); // a deck of tiles is shaped like its tiles
      const hy = deckHeight(piece.count) / 2; // footprint = the card exactly (matches deckMesh)
      body.addShape(
        g.shape === 'hex'
          ? new CANNON.Cylinder(g.hh, g.hh, hy * 2, 6) // a hex deck is a hex stack (radius = circumradius)
          : new CANNON.Box(new CANNON.Vec3(g.hw, hy, g.hh)),
      );
    }
    body.updateBoundingRadius();
    body.updateMassProperties();
    body.wakeUp();
  }

  // --- Dispensers: hand out copies of a child piece (shared by dispense/dispenseDrag) ---

  // Rebuild a stack dispenser's cylinder collider to its current count (no-op for a bowl).
  updateStackCollider(id) {
    const body = this.bodies.get(id),
      piece = this.state.pieces.get(id);
    if (!body || !piece) return;
    const d = DISPENSERS[readProps(piece).disp];
    if (!d || d.body !== 'stack') return;
    const box = PROPS[d.item].collider.box,
      r = box[0],
      discH = box[1] * 2;
    while (body.shapes.length) body.removeShape(body.shapes[0]);
    body.addShape(
      new CANNON.Cylinder(r, r, Math.max(discH, stackVisible(piece.count) * discH), 16),
    );
    body.updateBoundingRadius();
    body.updateMassProperties();
    body.wakeUp();
  }

  // The spawn spec a dispenser hands out: an existing PROP, tinted (poker/coin) or
  // team-colored (go bowl) from the dispenser's own config.
  dispenserItem(piece) {
    const props = readProps(piece);
    const d = DISPENSERS[props.disp];
    if (!d) return null;
    const itemProps = { shape: d.item };
    if (d.team)
      itemProps.team = props.team ? 1 : 0; // go bowl → a team stone
    else if (props.color != null) itemProps.color = props.color | 0; // poker/coin → tint
    if (PROPS[d.item] && PROPS[d.item].team) itemProps.snap = true; // grid-game items (go stones) snap by default
    return { type: 'prop', props: itemProps };
  }

  // After a dispense: a finite dispenser shrinks and is removed when empty; an
  // infinite one (bowl) is unchanged.
  afterDispense(piece, id) {
    const d = DISPENSERS[readProps(piece).disp];
    if (!d || d.infinite) return;
    piece.count = Math.max(0, piece.count - 1);
    if (piece.count <= 0) this.removePiece(id);
    else this.updateStackCollider(id);
  }

  // Write a table deck to the disk library; returns true on success. Any inline
  // image art (data-URLs) is moved to files so the saved JSON stays small.
  async saveDeckById(deckId, name, ownerId = null) {
    const fronts = this.deckCards.get(deckId),
      piece = this.state.pieces.get(deckId);
    if (!fronts || !fronts.length || !piece || piece.type !== 'deck') return false;
    const cleanName = String(name || '')
      .slice(0, 60)
      .trim();
    if (!cleanName) return false;
    let back = readProps(piece).back || 'back';
    if (isDataURL(back)) back = saveImageRef(back, 'decks') || 'back'; // inline art -> file, store the URL
    const savedFronts = fronts.map((front) =>
      isDataURL(front) ? saveImageRef(front, 'decks') || front : front,
    );
    await db.insertDeck({ name: cleanName, back, fronts: savedFronts, ownerId }); // private by default
    return true;
  }

  // The effective self-right mode for a piece:
  //   true   → keep it standing tall (chess, tokens)
  //   'flat' → keep it lying flat (decks, checkers, coins)
  //   falsy  → don't self-right at all
  standOf(piece) {
    const props = readProps(piece);
    if (props.stand !== undefined) return props.stand; // per-instance override (the U-key toggle)
    if (piece.type === 'deck' || piece.type === 'dispenser') return 'flat'; // stacks/bowls settle flat
    return (PROPS[props.shape] || {}).stand; // else the prop shape's default
  }
  // Which mode to switch a piece INTO when the toggle turns self-right on. Uses
  // the shape's declared default, or infers "flat" when the collider is thin on Y
  // (so a coin/checker lies down) and "stand tall" otherwise.
  naturalStand(piece) {
    if (piece.type === 'deck' || piece.type === 'dispenser') return 'flat';
    const props = readProps(piece),
      spec = PROPS[props.shape] || {};
    if (spec.stand) return spec.stand;
    const box = spec.collider && spec.collider.box;
    return box && box[1] <= box[0] && box[1] <= box[2] ? 'flat' : true;
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
    const props = readProps(piece);
    const dispDef = piece.type === 'dispenser' ? DISPENSERS[props.disp] : null;
    const next = colorProps(piece.type, props, opts, dispDef);
    if (!next) return false;
    writeProps(piece, next); // synced → every client rebuilds the piece with the new tint
    return true;
  }

  // Send a player their private hand, and publish only its COUNT to everyone
  // else (so others can draw the right-sized fan without seeing the cards).
  sendHand(client) {
    const hand = this.hands.get(client.sessionId) || [];
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.hand = hand.length; // public count only
      player.handBack = hand.length ? hand[0].back || '' : ''; // public back image (the front stays private)
    }
    client.send('hand', hand); // private contents, to this client alone
  }

  clientBy(sid) {
    return this.clients.find((c) => c.sessionId === sid);
  }

  // Build (or rebuild) the table surface + four containment walls at the given
  // half-extents. Called on create and whenever the GM resizes the table.
  buildBounds(hx, hz) {
    const w = this.world,
      mat = w.__mat;
    for (const b of this._bounds || []) w.removeBody(b); // drop the previous surface + walls
    this._bounds = [];
    const add = (body) => {
      w.addBody(body);
      this._bounds.push(body);
    };
    const table = new CANNON.Body({ mass: 0, material: mat }); // surface sits just below y=0
    table.addShape(new CANNON.Box(new CANNON.Vec3(hx, SIM.tableThick, hz)));
    table.position.set(0, -SIM.tableThick, 0);
    add(table);
    const thick = SIM.wall.thick,
      overlap = SIM.wall.over;
    const wall = (px, pz, whx, whz) => {
      const b = new CANNON.Body({ mass: 0, material: mat });
      b.addShape(new CANNON.Box(new CANNON.Vec3(whx, SIM.wall.half, whz)));
      b.position.set(px, SIM.wall.half, pz);
      add(b);
    };
    wall(0, -(hz + thick), hx + overlap, thick); // near / far
    wall(0, hz + thick, hx + overlap, thick);
    wall(-(hx + thick), 0, thick, hz + overlap); // left / right
    wall(hx + thick, 0, thick, hz + overlap);
    this.buildTrays(); // the personal trays ride the same track; rebuild against the new table size
  }

  // The world-space centre of seat N's tray (on the track, behind that seat).
  trayCenterFor(seat) {
    return trayCenter(seatAngle(seat), this.state.tableX, this.state.tableZ);
  }

  // Build / rebuild the physics (floor + walls + lid) for EVERY enabled seat's tray, each at
  // its seat angle. Bodies are tagged `__traySeat` so the out-of-bounds net can send a stray
  // die back to the right tray. Called when a tray is toggled or the table is resized; before
  // rebuilding, tray dice are moved to their seat's new centre so they stay inside their walls.
  buildTrays() {
    const w = this.world,
      mat = w.__mat;
    for (const b of this._trayBounds || []) w.removeBody(b);
    this._trayBounds = [];
    this.repositionTrayDice(); // walls are about to move (resize/rebuild) — carry the dice along
    this.state.trays.forEach((on, seatKey) => {
      if (!on) return;
      const seat = +seatKey,
        angle = seatAngle(seat);
      const center = this.trayCenterFor(seat);
      const spin = new CANNON.Quaternion();
      spin.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), angle);
      for (const part of trayParts()) {
        const b = new CANNON.Body({ mass: 0, material: mat });
        b.addShape(new CANNON.Box(new CANNON.Vec3(part.hx, part.hy, part.hz)));
        const p = trayPlace(part, center, angle);
        b.position.set(p.x, p.y, p.z);
        b.quaternion.copy(spin);
        b.__traySeat = seat;
        w.addBody(b);
        this._trayBounds.push(b);
      }
    });
  }

  // Keep each tray die glued to its seat's tray as the track radius changes (table resize):
  // clamp it back inside that seat's current footprint. Cheap and only matters on resize.
  repositionTrayDice() {
    if (!this.bodies) return; // buildBounds() runs in onCreate before the bodies map exists — nothing to move yet
    this.bodies.forEach((body, _id) => {
      if (body.__traySeat == null) return;
      const seat = body.__traySeat,
        angle = seatAngle(seat),
        c = this.trayCenterFor(seat);
      if (inTray(body.position.x, body.position.z, c, angle, 0.2)) return; // still inside → leave it
      const p = trayPlace({ x: 0, y: 1, z: 0 }, c, angle);
      body.position.set(p.x, p.y, p.z);
      body.velocity.setZero();
      body.angularVelocity.setZero();
      body.wakeUp();
    });
  }

  // A drop point for a new die in SEAT's tray: a random spot inside its footprint, above the
  // floor (below the wall tops) so it tumbles in.
  trayDropPos(seat) {
    const c = this.trayCenterFor(seat),
      angle = seatAngle(seat);
    const lx = (Math.random() * 2 - 1) * (TRAY.hx - 0.7);
    const lz = (Math.random() * 2 - 1) * (TRAY.hz - 0.7);
    const p = trayPlace({ x: lx, y: 1.3, z: lz }, c, angle);
    return [p.x, p.y, p.z];
  }

  // The caller's seat, or null if they're not seated (can't own a tray).
  seatOf(client) {
    const p = this.state.players.get(client.sessionId);
    const s = p ? +p.seat : -1;
    return s >= 0 && s < SEAT_ANGLES.length ? s : null;
  }

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
      if (piece.type !== 'deck' && gridActive(this.state.scale) && readProps(piece).snap) {
        const p = snapToCell(body.position.x, body.position.z, this.state.scale); // the bag carries snap for its tiles, but shouldn't itself jump to a cell
        body.position.x = p.x;
        body.position.z = p.z;
        body.velocity.set(0, 0, 0);
        body.angularVelocity.set(0, 0, 0);
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
        const onDeck =
          Math.abs(body.position.x - deckBody.position.x) < SIM.absorb.x &&
          Math.abs(body.position.z - deckBody.position.z) < SIM.absorb.z;
        if (onDeck) {
          const front = (this.cardData.get(id) || {}).front || readProps(piece).front;
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
      const pp = readProps(piece);
      for (const [dispId, disp] of this.state.pieces) {
        if (disp.type !== 'dispenser') continue;
        const want = this.dispenserItem(disp);
        if (!want || want.props.shape !== pp.shape) continue;
        if (want.props.color != null && (pp.color | 0) !== (want.props.color | 0)) continue;
        if (want.props.team != null && (pp.team ? 1 : 0) !== want.props.team) continue;
        const dispBody = this.bodies.get(dispId);
        if (!dispBody) continue;
        const d = DISPENSERS[readProps(disp).disp];
        const fbox =
          d && (d.body === 'stack' ? PROPS[d.item].collider.box : d.collider && d.collider.box);
        const reach = (fbox ? Math.max(fbox[0], fbox[2]) : 0.5) + 0.5;
        const dx = body.position.x - dispBody.position.x,
          dz = body.position.z - dispBody.position.z;
        if (dx * dx + dz * dz < reach * reach) {
          if (d && !d.infinite) {
            disp.count = (disp.count | 0) + 1;
            this.updateStackCollider(dispId);
          }
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
    this.state.pieces.forEach((piece, id) => {
      const b = this.bodies.get(id);
      if (piece.type === 'die' && b && b.__traySeat === seat) ids.push(id);
    });
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
    for (const client of this.clients) this.sendHand(client); // clear every player's hand
    this.state.overlays.clear(); // wipe measurement/template overlays
  }

  // Serialize the current table into a scene payload: the table size, and every
  // piece with its transform. A deck's private card list rides along so it comes
  // back as a real deck; a face-down card carries its private front.
  // The per-room scale as a plain object (grid + measurement calibration), for both the
  // durable room row and the scene snapshot, so a saved scene restores its grid/units too.
  scaleSnapshot() {
    const sc = this.state.scale;
    return {
      worldPerUnit: sc.worldPerUnit,
      unitLabel: sc.unitLabel,
      roundStep: sc.roundStep,
      cellWorld: sc.cellWorld,
      cellZ: sc.cellZ,
      gridX: sc.gridX,
      gridZ: sc.gridZ,
      gridStyle: sc.gridStyle,
      gridColor: sc.gridColor,
      gridLift: sc.gridLift,
      snapAnchor: sc.snapAnchor,
      gridHidden: sc.gridHidden,
    };
  }
  // Validate + apply a scale object (from the room row or a scene). Every field is optional
  // and range-checked, so an old/partial snapshot just keeps the current defaults.
  applyScale(s) {
    if (!s || typeof s !== 'object') return;
    const sc = this.state.scale;
    if (Number.isFinite(+s.worldPerUnit) && +s.worldPerUnit > 0)
      sc.worldPerUnit = clamp(+s.worldPerUnit, 1e-3, 1e3);
    if (typeof s.unitLabel === 'string') sc.unitLabel = s.unitLabel.slice(0, 8);
    if (Number.isFinite(+s.roundStep) && +s.roundStep > 0)
      sc.roundStep = clamp(+s.roundStep, 1e-3, 1e2);
    if (Number.isFinite(+s.cellWorld) && +s.cellWorld >= 0)
      sc.cellWorld = clamp(+s.cellWorld, 0, 1e3);
    if (Number.isFinite(+s.cellZ) && +s.cellZ >= 0) sc.cellZ = clamp(+s.cellZ, 0, 1e3);
    if (Number.isFinite(+s.gridX)) sc.gridX = clamp(+s.gridX, -1e3, 1e3);
    if (Number.isFinite(+s.gridZ)) sc.gridZ = clamp(+s.gridZ, -1e3, 1e3);
    if (/^#[0-9a-f]{6}$/i.test(s.gridColor || '')) sc.gridColor = s.gridColor;
    if (Number.isFinite(+s.gridLift)) sc.gridLift = clamp(+s.gridLift, 0, GRID_LIFT_MAX);
    if (s.snapAnchor === 'center' || s.snapAnchor === 'cross') sc.snapAnchor = s.snapAnchor;
    if (s.gridStyle === 'square' || s.gridStyle === 'hex' || s.gridStyle === 'off')
      sc.gridStyle = s.gridStyle;
    if (typeof s.gridHidden === 'boolean') sc.gridHidden = s.gridHidden;
  }

  // Restore which seats' trays are out from a scene (an array of seat indices), then rebuild
  // their walls. Absent → no trays (older scenes have none). The tray DICE ride as pieces.
  applyTrays(seats) {
    this.state.trays.clear();
    for (const s of Array.isArray(seats) ? seats : []) {
      const seat = +s;
      if (seat >= 0 && seat < SEAT_ANGLES.length) this.state.trays.set(String(seat), true);
    }
    this.buildTrays();
  }

  serializeScene() {
    return serializePersistedScene(this, { geoOf });
  }

  // Full game snapshot = the portable scene PLUS the private per-player layer
  // (hands + turn), each resolved from ephemeral sessionId to a stable account id
  // so it can rebind on reload. Used by auto-save + the GM checkpoint; library
  // scenes stay hands-free (they call serializeScene directly).
  serializeGame() {
    return serializePersistedGame(this, { geoOf });
  }

  // Replace the whole table with a scene: clear, resize, then rebuild every piece
  // at its saved transform. Boards go through swapBoard; everything else keeps its
  // exact orientation via the spawn quaternion.
  applyScene(scene) {
    applyPersistedScene(this, scene, {
      createOverlay: () => new Overlay(),
      maxPieces: SIM.maxPieces,
      overlayKinds: OVERLAY_KINDS,
      overlayMax: OVERLAY_MAX,
      tableLimits: TABLE_LIMIT,
    });
  }

  // Persist the durable room state (scoreboard + notes + table size). Debounced —
  // score clicks arrive in bursts, and saveStateNow always reads the latest state.
  scheduleSave() {
    scheduleRoomSave(this);
  }
  async saveStateNow() {
    await saveRoomStateNow(this, { db });
  }
  async onDispose() {
    // safety net: snapshot the live table so progress survives an empty room even without a manual Save
    LIVE_ROOMS.delete(this);
    if (this.state.pieces.size) {
      // only overwrite the saved state when there's actually something on the table
      const snap = this.serializeGame();
      if (JSON.stringify(snap).length <= SCENE_MAX_BYTES) this.savedScene = snap;
    }
    if (this._saveTimer) clearTimeout(this._saveTimer);
    await safeRoomTask(this, 'disposeSave', null, () => this.saveStateNow(), { notify: false }); // flush — persists the snapshot + latest settings
  }

  // Send a client the library list for one asset kind. Admins get everything
  // (incl. private); everyone else gets only published (public) assets.
  async sendAssetList(client, kind) {
    const includePrivate = this.isAdmin(client);
    const config = {
      deck: ['deckList', () => db.listDecks({ includePrivate })],
      board: ['boardList', () => db.listBoards({ includePrivate })],
      prop: ['propList', () => db.listProps({ includePrivate })],
      scene: ['sceneList', () => db.listScenes({ includePrivate })],
      sky: ['skyList', () => db.listSkyboxes({ includePrivate })],
    }[kind];
    if (!config) return false;
    const list = await config[1]();
    client.send(config[0], list);
    return true;
  }

  // --- Member-management authorization + list delivery ---
  // GMs manage helpers/players; only an owner manages GMs; nobody manages the owner.
  canManage(actorRank, targetRole) {
    return canManageMember(actorRank, targetRole);
  }
  // Role changes: co-GM promote/demote is owner-only; the owner role is never set here.
  canSetRole(actorRank, currentRole, newRole) {
    return canSetMemberRole(actorRank, currentRole, newRole);
  }
  async sendMembers(client) {
    if (this.roomId) client.send('memberList', await db.listMembers(this.roomId));
  }
  async broadcastMembers() {
    // push the fresh list to every GM viewing the panel
    if (!this.roomId) return;
    const list = await db.listMembers(this.roomId);
    for (const c of this.clients) if (this.rank(c) >= RANK.gm) c.send('memberList', list);
  }
  // Tell the matching lobby (if anyone's waiting there) that a pending user's status
  // changed, so it can push + release them instead of them polling for it.
  async notifyLobby(userId, method) {
    const lobbies = await matchMaker.query({ name: 'lobby', code: this.roomCode });
    await Promise.all(
      lobbies.map((lobby) => matchMaker.remoteRoomCall(lobby.roomId, method, [userId])),
    );
  }

  // Called via the matchmaker when the owner closes the room from the lobby: tell
  // everyone why, then disconnect them all and dispose the live table. The brief
  // delay lets the 'roomClosed' notice flush before the sockets close.
  closeAndDispose() {
    this.broadcast('roomClosed');
    setTimeout(() => {
      try {
        this.disconnect();
      } catch (e) {}
    }, 300);
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
    const user =
      options && options.token ? await db.findUserByToken(hashToken(options.token)) : null;
    if (!user) throw new ServerError(401, 'Please sign in first.');
    const room = options && options.code ? await db.findRoomByCode(options.code) : null;
    if (!room) throw new ServerError(404, 'That room no longer exists.');
    const m = await db.getMembership(room.id, user.id);
    let role = m && m.status === 'admitted' ? m.role : null;
    if (user.isAdmin) role = 'owner'; // site admins get full control in any room, member or not
    if (!role)
      throw new ServerError(
        403,
        m ? 'Waiting for a GM to admit you.' : 'You are not a member of this room.',
      );
    return {
      userId: user.id,
      username: user.username,
      avatar: user.avatar,
      role,
      isAdmin: user.isAdmin,
    };
  }

  rank(client) {
    return rankOf(client.auth && client.auth.role);
  }
  isAdmin(client) {
    return !!(client.auth && client.auth.isAdmin);
  } // site admin — curates the library, spawns private assets anywhere

  async onJoin(client) {
    const auth = client.auth || {};
    // Give the new player the lowest free seat and a color to match.
    const takenSeats = new Set();
    this.state.players.forEach((existing) => takenSeats.add(existing.seat));
    let seat = 0;
    while (takenSeats.has(seat)) seat++;

    const player = new Player();
    player.seat = seat;
    player.hand = 0;
    player.showing = 0;
    player.name = auth.username || 'Player ' + (seat + 1); // identity from the account
    player.color = PALETTE[seat % PALETTE.length];
    player.avatar = auth.avatar || '';
    player.role = auth.role || 'player';
    this.state.players.set(client.sessionId, player);

    // Reclaim a saved hand / the turn if this account owned one in the loaded game.
    const uid = auth.userId != null ? String(auth.userId) : null;
    if (uid && this.pendingHands.has(uid)) {
      this.hands.set(client.sessionId, this.pendingHands.get(uid).cards);
      this.pendingHands.delete(uid);
      this.state.unclaimed.delete(uid);
    }
    if (uid && this.pendingTurn === uid) {
      this.pendingTurn = null;
      this.state.turnPending = '';
      this.state.turn = client.sessionId; // the turn was waiting for them
    }

    if (!this.state.turn) this.state.turn = client.sessionId; // first player to arrive starts
    this.sendHand(client);
    if (this.rank(client) >= RANK.gm)
      await safeRoomTask(this, 'joinMembers', client, () => this.sendMembers(client), {
        publicMessage: 'Member operation unavailable. Try again.',
      }); // GMs get the member list up front (pending pulse)
    client.send('whoami', { isAdmin: this.isAdmin(client) }); // lets the client hide library-creation UI from non-admins
  }

  // Advance the turn to the next player by seat order (wrapping around).
  advanceTurn() {
    this.pendingTurn = null;
    this.state.turnPending = ''; // advancing clears any absent-player hold
    const order = [];
    this.state.players.forEach((player, sid) => order.push([sid, player.seat]));
    order.sort((a, b) => a[1] - b[1]);
    if (!order.length) {
      this.state.turn = '';
      return;
    }
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
    body.velocity.setZero();
    body.angularVelocity.setZero();
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
    return !!readProps(piece).snap;
  }

  update(dtMs) {
    const dt = dtMs / 1000;
    const stiffness = SIM.servo.stiffness,
      maxSpeed = SIM.servo.maxSpeed;

    // Pass 1 — held pieces. Instead of teleporting a held piece to the cursor, we
    // set its VELOCITY toward the drag target ("servo"). It stays a real body, so
    // it still shoves others and gets shoved, but tracks the cursor tightly.
    this.state.pieces.forEach((piece, id) => {
      if (!piece.owner) return;
      const target = this.targets.get(id),
        body = this.bodies.get(id);
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
      if (speed > maxSpeed) {
        const scale = maxSpeed / speed;
        vx *= scale;
        vy *= scale;
        vz *= scale;
      }
      body.velocity.set(vx, vy, vz);
      body.angularVelocity.scale(SIM.servo.angDamp, body.angularVelocity);

      // While held, a "stand" piece is kept level: strip its pitch/roll and keep
      // only its yaw, so decks/chess pieces don't tumble in your hand.
      const standMode = this.standOf(piece);
      if (standMode) {
        const quat = body.quaternion,
          mag = Math.hypot(quat.w, quat.y) || 1;
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
    const worldUp = new CANNON.Vec3(0, 1, 0),
      pieceUp = new CANNON.Vec3(),
      axis = new CANNON.Vec3();
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
      pieceUp.cross(worldUp, axis); // rotation axis that brings it back to upright
      const tilt = axis.length(); // = sin(angle between them)
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
      if (piece.owner) return; // held pieces are handled (and unpinned) in Pass 1
      const body = this.bodies.get(id);
      if (!body) return;
      if (this.wantsSnap(piece)) {
        // Settle quickly (card-like sleep timing), then pin ONLY once actually ASLEEP — i.e.
        // it has fallen and come to rest on the surface. Pinning on mere low speed froze
        // pieces in mid-air the instant release zeroed their velocity, before gravity could
        // drop them onto the cell.
        if (body.sleepTimeLimit !== SIM.cards.sleepTime) {
          body.sleepSpeedLimit = SIM.cards.sleepSpeed;
          body.sleepTimeLimit = SIM.cards.sleepTime;
        }
        if (!body.__pinned && body.sleepState === CANNON.Body.SLEEPING) {
          const p = snapToCell(body.position.x, body.position.z, this.state.scale);
          body.position.x = p.x;
          body.position.z = p.z; // exact cell (a bounce may have nudged it) before freezing
          this.pinPiece(id);
        }
      } else if (body.__pinned) {
        this.unpinPiece(id); // snap turned off, or the grid was removed
      }
    });

    // Pass 3 — advance any in-progress card flips. A flip is a scripted animation
    // (a kinematic half-turn plus a little hop) rather than a physical toss.
    for (const [id, flip] of this.flips) {
      const body = this.bodies.get(id);
      if (!body) {
        this.flips.delete(id);
        continue;
      }
      flip.t += dt;
      const progress = Math.min(flip.t / flip.dur, 1);
      flip.start.slerp(flip.end, progress, body.quaternion);
      body.position.y = flip.baseY + Math.sin(progress * Math.PI) * SIM.flipArc; // arc up and back down
      if (progress >= 1) {
        // hand it back to the physics engine
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
    const tx = this.state.tableX,
      tz = this.state.tableZ;
    const limitX = tx + SIM.bounds.margin,
      limitZ = tz + SIM.bounds.margin;
    this.bodies.forEach((body) => {
      const pos = body.position;
      if (body.__traySeat != null) {
        // A tray die obeys ITS SEAT's tray footprint, not the table's — otherwise the net would
        // yank it back to the table every tick. If it somehow left the tray (a hard throw over
        // the wall, or the tray was just put away), drop it back into that tray's centre.
        const seat = body.__traySeat,
          angle = seatAngle(seat),
          c = this.trayCenterFor(seat);
        const stillOut = this.state.trays.get(String(seat));
        const out =
          pos.y < SIM.bounds.floor ||
          pos.y > SIM.bounds.ceiling ||
          !stillOut ||
          !inTray(pos.x, pos.z, c, angle, 0.5);
        if (out && stillOut) {
          const p = trayPlace({ x: 0, y: 1, z: 0 }, c, angle);
          pos.set(p.x, p.y, p.z);
          body.velocity.setZero();
          body.angularVelocity.setZero();
          body.wakeUp();
        }
        return;
      }
      const escaped =
        pos.y < SIM.bounds.floor ||
        pos.y > SIM.bounds.ceiling ||
        Math.abs(pos.x) > limitX ||
        Math.abs(pos.z) > limitZ;
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
    this.lastDrop.delete(client.sessionId);
    this.notebooks.delete(`session:${client.sessionId}`); // account-keyed notes live until the room closes
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
    const user =
      options && options.token ? await db.findUserByToken(hashToken(options.token)) : null;
    if (!user) throw new ServerError(401, 'Please sign in first.');
    if (!user.isAdmin) throw new ServerError(403, 'The library editor is for site admins only.');
    return {
      userId: user.id,
      username: user.username,
      avatar: user.avatar,
      role: 'owner',
      isAdmin: true,
    };
  }
}

// --- Boot: Colyseus + Express (both served on the same port) ----------------
const app = express();
const proxyHops = trustedProxyHops();
if (proxyHops > 0) app.set('trust proxy', proxyHops);
const rateLimitStore = await createRateLimitStore();
// Uploads: big burst (a deck's back + every front go back-to-back), ~180/min sustained.
const rateLimitUpload = makeRateLimiter({
  store: rateLimitStore,
  namespace: 'upload',
  cap: 300,
  refillPerMs: 3 / 1000,
  message: 'too many uploads — slow down',
});
// Auth: brute-force + signup-spam guard. ~20/min per IP — scrypt already slows each
// attempt; this is defense in depth and still leaves room for a few users behind one NAT.
const rateLimitAuth = makeRateLimiter({
  store: rateLimitStore,
  namespace: 'auth',
  cap: 20,
  refillPerMs: 20 / 60000,
  message: 'too many attempts — please slow down',
});
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
  "'sha256-GPCT8IS0bOltxV6o5zObSqdYe/Cpv1tKzAj9rjuR+yM='", // import map (table, editor)
];
app.use(
  helmet.contentSecurityPolicy({
    useDefaults: false,
    reportOnly: false, // ENFORCED
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", ...CSP_INLINE],
      styleSrc: ["'self'", "'unsafe-inline'"], // inline styles are pervasive + low-risk
      imgSrc: ["'self'", 'data:', 'blob:'], // avatars = data: URLs, textures = blobs
      connectSrc: ["'self'", 'ws:', 'wss:', 'data:', 'blob:'], // Colyseus ws + Three's data:/blob: buffer loaders
      workerSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      reportUri: ['/csp-report'],
    },
  }),
);
// Sink for CSP violation reports during the report-only phase — logs what WOULD block.
app.post(
  '/csp-report',
  rateLimitAuth,
  express.json({ type: () => true, limit: '64kb' }),
  (req, res) => {
    const r = req.body && req.body['csp-report'];
    // Colyseus feature-detects eval and gracefully falls back when it's blocked — a known,
    // harmless report that fires on every load, so drop it and log only real violations.
    const benign =
      r &&
      r['blocked-uri'] === 'eval' &&
      String(r['source-file'] || '').includes('/vendor/colyseus.js');
    if (!benign) console.warn('[CSP]', JSON.stringify(req.body));
    res.sendStatus(204);
  },
);

app.use(express.static('public'));
app.use('/shared', express.static('shared'));

// Serve uploaded images/models, but NEVER the .json metadata beside them — that
// keeps a hidden card front living on disk from being fetched directly.
app.use(
  '/assets',
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
app.use(
  '/auth',
  createAuthRouter({ db, rateLimitAuth, hashPassword, verifyPassword, makeToken, hashToken }),
);

// --- Admin console (site superusers only) ---------------------------------
async function disposeLive(code) {
  // shut down a running table for this code, if any
  try {
    const live = await matchMaker.query({ name: 'table', code });
    for (const r of live) await matchMaker.remoteRoomCall(r.roomId, 'closeAndDispose');
  } catch (e) {
    /* none running */
  }
}
app.use(
  createRoomsRouter({
    db,
    requireUser,
    hashPassword,
    isBoundedImageDataURL,
    matchMaker,
    disposeLive,
  }),
);

// Drop a user from EVERY live table they're currently in (admin action). Reuses the
// per-room kick's 'kicked' notice + consented leave. In-process (single-instance) scope.
function kickUserEverywhere(userId) {
  let n = 0;
  for (const room of LIVE_ROOMS) {
    const live = room.clients.find((c) => c.auth && String(c.auth.userId) === String(userId));
    if (live) {
      live.send('kicked');
      setTimeout(() => {
        try {
          live.leave(4000);
        } catch (e) {}
      }, 150);
      n++;
    }
  }
  return n;
}

app.use(
  '/admin',
  createAdminRouter({
    db,
    requireAdmin,
    findOrphanAssets,
    trashOrphans,
    disposeLive,
    kickUserEverywhere,
  }),
);

// Must be registered after every HTTP route so rejected async handlers land here.
app.use(httpErrorHandler);

const httpServer = createServer(app);
// A pending joiner holds a socket here (instead of polling) while awaiting approval.
// onAuth is the INVERSE of the table's: only PENDING members may wait — admitted users
// should join the table, non-members must request first. When a GM admits/declines,
// the table room calls notifyAdmitted/notifyDeclined here to push + release them.
class LobbyRoom extends Room {
  async onAuth(client, options) {
    const user =
      options && options.token ? await db.findUserByToken(hashToken(options.token)) : null;
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
    try {
      await this.allowReconnection(client, 20);
    } catch (e) {
      /* didn't return in time */
    }
  }
  notifyAdmitted(userId) {
    this._resolve(userId, 'admitted');
  }
  notifyDeclined(userId) {
    this._resolve(userId, 'declined');
  }
  _resolve(userId, msg) {
    const c = this.clients.find((c) => c.auth && String(c.auth.userId) === String(userId));
    if (c) {
      c.send(msg);
      setTimeout(() => {
        try {
          c.leave();
        } catch (e) {}
      }, 150);
    }
  }
}

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer, maxPayload: 4 * 1024 * 1024 }),
});
gameServer.define('table', TableRoom).filterBy(['code']); // one live table per room code
gameServer.define('editor', EditorRoom); // single shared admin-only library workshop
gameServer.define('lobby', LobbyRoom).filterBy(['code']); // transient per-code waiting room for pending joiners

const PORT = process.env.PORT || 2567;
// Apply any pending schema migrations before serving. Fails fast (exits) rather than
// booting on a half-migrated schema; no-ops when MIGRATE_DATABASE_URL isn't set.
await runMigrations();
const bootstrap = await bootstrapAdminFromEnvironment({ db, hashPassword });
if (bootstrap.status === 'created')
  console.log(`[auth] provisioned bootstrap administrator: ${bootstrap.user.username}`);
gameServer
  .listen(PORT)
  .then(() => console.log(`\n  Open Tabletop running →  http://localhost:${PORT}\n`));
