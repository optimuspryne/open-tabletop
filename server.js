import { createDeckBuilders } from './server/game/deck-builders.js';
import {
  afterDispense as consumeDispensedItem,
  dispenserItem as resolveDispenserItem,
} from './server/game/dispenser-operations.js';
import {
  updateDeckCollider as updateRoomDeckCollider,
  updateStackCollider as updateRoomStackCollider,
} from './server/game/collider-maintenance.js';
import { createLibraryOperations } from './server/game/library.js';
import { createMemberService } from './server/game/member-service.js';
import { createPieceLifecycle } from './server/game/piece-lifecycle.js';
import {
  naturalStand as naturalPieceStand,
  recolorPiece as recolorRoomPiece,
  standOf as pieceStand,
} from './server/game/piece-operations.js';
import {
  pinPiece as pinRoomPiece,
  unpinPiece as unpinRoomPiece,
  wantsSnap as roomPieceWantsSnap,
  writeTransform as writePieceTransform,
} from './server/game/placement-operations.js';
import { createStarterSetup } from './server/game/starters.js';
import { createTableBounds } from './server/game/table-bounds.js';
import { createTableScale } from './server/game/table-scale.js';
import { createTrayOperations } from './server/game/trays.js';
import { spawnTableCard } from './server/game/card-transfer.js';
import { Player, ScoreRow, Overlay, State } from './server/game/schema.js';
import {
  returnInspectedCard,
  recoverPendingInspections,
} from './server/game/inspection-recovery.js';
// server.js  —  node server.js   (Node 20.9+; production uses Node 22)
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
import { performance } from 'node:perf_hooks';
import { Server, Room, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Encoder } from '@colyseus/schema';
Encoder.BUFFER_SIZE = 128 * 1024; // default 16KB overflows a busy table's piece map; 128KB gives ample headroom
import * as CANNON from 'cannon-es';
import {
  KINDS,
  PROPS,
  BOARDS,
  TABLE_SHAPES,
  RIM_WOODS,
  MEASURE,
  DISPENSERS,
  gridActive,
  snapToCell,
  trayPlace,
  inTray,
  STARTERS,
  sanitizeGeom,
  sanitizeMatGeom,
  seatAngle,
  SEAT_ANGLES,
  DECK_MODELS,
} from './shared/pieces.js';
import * as db from './db.js'; // Postgres-backed saved-asset library (metadata; files stay on disk)
import { hashPassword, verifyPassword, makeToken, hashToken } from './auth.js';
import { runMigrations } from './migrate.js'; // startup schema migrator (owner-role DDL)
import { RANK, rankOf, canManageMember, canSetMemberRole } from './server/permissions.js';
import { createRoomAccess } from './server/room-access.js';
import { createAssetCleanup } from './server/asset-cleanup.js';
import { httpErrorHandler } from './server/http/async-route.js';
import { createRequireUser, createRequireAdmin } from './server/http/auth-context.js';
import { createAuthRouter } from './server/http/routes/auth.js';
import { createRoomsRouter } from './server/http/routes/rooms.js';
import { createUploadRouter } from './server/http/routes/uploads.js';
import {
  createAssetTextureRouter,
  createTexturePrebuilder,
} from './server/http/routes/asset-textures.js';
import { createAdminRouter } from './server/http/routes/admin.js';
import { cardBackRef, cardFrontRef } from './server/deck-state.js';
import { parkHand, claimHand } from './server/game/hand-state.js';
import { registerPlacementHandlers } from './server/game/handlers/placement.js';
import { MAX_PIECES } from './server/game/piece-capacity.js';
import { dragVelocity } from './server/game/physics-safety.js';
import { registerCardHandlers } from './server/game/handlers/cards.js';
import { registerMovementHandlers } from './server/game/handlers/movement.js';
import { registerMemberHandlers } from './server/game/handlers/members.js';
import { registerLibraryHandlers } from './server/game/handlers/library.js';
import { registerPieceHandlers } from './server/game/handlers/pieces.js';
import {
  registerRoomStateHandlers,
  saveFinalRoomState,
  saveRoomStateNow,
  scheduleRoomSave,
} from './server/game/handlers/room-state.js';
import { registerOverlayHandlers } from './server/game/handlers/overlays.js';
import { registerRoomFeatureHandlers } from './server/game/handlers/room-features.js';
import { readProps } from './server/game/props-codec.js';
import { bootstrapAdminFromEnvironment } from './server/bootstrap-admin.js';
import { boundedString, oneField, reorderHandPayload } from './server/message-validation.js';
import { createRateLimitStore, makeRateLimiter } from './server/rate-limit.js';
import { trustedProxyHops } from './server/redis-config.js';
import { safeMessage, safeRoomTask } from './server/game/safe-message.js';
import { buildWorld, COLLIDER_TYPES } from './server/physics.js';
import {
  applyScene as applyPersistedScene,
  clearGameTable,
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
  maxPieces: MAX_PIECES,
};

// Dev profiling toggle: PERF_LOG=1 logs a per-second physics/tick summary (docs/ROADMAP.md §1).
const PERF_LOG = process.env.PERF_LOG === '1';

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
const ASSET_KINDS = ['uploads', 'decks', 'boards', 'props', 'sky', 'dice', 'mats'];
const LIBRARY_KINDS = ['deck', 'board', 'prop', 'scene', 'sky', 'dice', 'mat'];
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
// A custom dice-texture URL — a local /assets/dice/ image, no traversal. Format guard for the
// dice library (mirrors skyUrlOk); the file just landed via /upload?kind=dice.
const diceUrlOk = (u) =>
  typeof u === 'string' && u.length < 300 && !u.includes('..') && u.startsWith('/assets/dice/');
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

const { saveDeckById: saveRoomDeckById, sendAssetList: sendRoomAssetList } =
  createLibraryOperations({ db, saveImageRef });
const {
  broadcastMembers: broadcastRoomMembers,
  notifyLobby: notifyRoomLobby,
  sendMembers: sendRoomMembers,
} = createMemberService({ db, matchMaker });

// Track rooms through their final persistence flush so cleanup can protect their data.
const LIVE_ROOMS = new Set();
const roomAccess = createRoomAccess({ db, hashToken });
setInterval(() => void roomAccess.revalidate(), 30_000).unref();
const { findOrphanAssets, trashOrphans } = createAssetCleanup({
  assetsDir: ASSETS_DIR,
  assetKinds: ASSET_KINDS,
  allAssetRefBlobs: db.allAssetRefBlobs,
  liveRooms: LIVE_ROOMS,
});
const texturePrebuilder = createTexturePrebuilder({
  assetsDir: ASSETS_DIR,
  assetKinds: ASSET_KINDS,
});

const PALETTE = [
  '#4a78c9',
  '#c94a4a',
  '#4ac97a',
  '#c9a24a',
  '#9a4ac9',
  '#4ac9c9',
  '#e8793a',
  '#d85ca8',
];

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
const deckBuilders = createDeckBuilders({ shuffle });

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
const {
  releasePiece: releaseRoomPiece,
  removePiece: removeRoomPiece,
  spawn: spawnRoomPiece,
} = createPieceLifecycle({ deckBuilders, dropSfx, geoOf, sim: SIM });
const setupStarterGame = createStarterSetup({
  deckBuilders,
  geoOf,
  maxPieces: SIM.maxPieces,
  spawnY: SIM.spawnY,
});
const buildTableBounds = createTableBounds({
  tableThickness: SIM.tableThick,
  wall: SIM.wall,
});
const {
  applyTrays: applyRoomTrays,
  buildTrays: buildRoomTrays,
  clearTraySeat: clearRoomTraySeat,
  repositionTrayDice: repositionRoomTrayDice,
  trayCenterFor: roomTrayCenter,
  trayDropPos: roomTrayDropPos,
} = createTrayOperations();
const {
  applyScale: applyRoomScale,
  calibrateGrid: calibrateRoomGrid,
  scaleSnapshot: snapshotRoomScale,
} = createTableScale({ gridLiftMax: GRID_LIFT_MAX });

// --- The room --------------------------------------------------------------
class TableRoom extends Room {
  async onCreate(options) {
    this.maxClients = SEAT_ANGLES.length;
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
      if (TABLE_SHAPES.includes(rs.tableShape)) this.state.tableShape = rs.tableShape;
      if (RIM_WOODS.includes(rs.rimWood)) this.state.rimWood = rs.rimWood;
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
    this.handOwners = new Map(); // session -> account, retained through the reconnect window
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
      spawnY: SIM.spawnY,
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
    registerPlacementHandlers(this, { randomPosition: rnd, dropSfx, maxPieces: SIM.maxPieces });

    registerLibraryHandlers(this, {
      db,
      boardKeys: Object.keys(BOARDS),
      colliders: COLLIDER_TYPES,
      libraryKinds: LIBRARY_KINDS,
      refOk: deckRefOk,
      sanitizeGeom,
      sanitizeMatGeom,
      deckModels: Object.keys(DECK_MODELS),
      randomPosition: rnd,
      sceneMaxBytes: SCENE_MAX_BYTES,
      skyUrlOk,
      diceUrlOk,
    });

    registerRoomStateHandlers(this, {
      createScoreRow: (label, score) => new ScoreRow(label, score),
      tableLimits: TABLE_LIMIT,
      gridLiftMax: GRID_LIFT_MAX,
      sceneMaxBytes: SCENE_MAX_BYTES,
    });

    // Reorder a player's own hand (drag-to-rearrange / sort). The order must be a permutation of
    // the current hand — never adds or drops a card — so any drift (e.g. a card played mid-drag)
    // just resyncs. Private, so it only re-sends to this client.
    tableMessage('reorderHand', (client, message) => {
      const parsed = reorderHandPayload(message);
      if (!parsed) return;
      const hand = this.hands.get(client.sessionId);
      if (!hand || !hand.length) return;
      if (parsed.order.length !== hand.length) return this.sendHand(client); // drift → resync
      const byHid = new Map(hand.map((card) => [card.hid, card]));
      const next = [];
      for (const hid of parsed.order) {
        const card = byHid.get(hid);
        if (!card) return this.sendHand(client); // unknown hid → resync
        next.push(card);
      }
      this.hands.set(client.sessionId, next); // length + uniqueness + all-present ⇒ a permutation
      this.sendHand(client);
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
        this.addToHand(client, front, props.back || 'back', geoOf(props), props.open);
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
    registerMemberHandlers(this, { db, roomAccess });

    tableMessage('nextTurn', () => this.advanceTurn());
    tableMessage('turnOrder', (client, message) => {
      if (this.rank(client) < RANK.gm) return;
      const parsed = oneField(message, 'order', (value) => {
        if (!Array.isArray(value) || value.length !== this.state.players.size) return null;
        const ids = value.every(
          (sid) => typeof sid === 'string' && sid.length <= 64 && this.state.players.has(sid),
        )
          ? [...value]
          : null;
        return ids && new Set(ids).size === ids.length ? ids : null;
      });
      if (!parsed) return;
      parsed.order.forEach((sid, order) => {
        this.state.players.get(sid).order = order;
      });
    });
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
    return spawnRoomPiece(this, type, pos, props, quat);
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
  addToHand(client, front, back, geo = {}, open = false) {
    const hand = this.hands.get(client.sessionId) || [];
    const entry = { hid: 'h' + this.nextHid++, front, back, ...geo }; // geo = {tile}/{geom} for tile cards; nothing for plain cards
    if (open) entry.open = true; // a double-sided tile: both faces are real, flip turns it over
    hand.push(entry);
    this.hands.set(client.sessionId, hand);
    this.sendHand(client);
  }

  // Place a hand card on the table, honoring double-sided (open) cards. An open card keeps BOTH
  // faces public and lands with the chosen side up (face-down = the back face up); a normal card
  // lands face-up (front+back) or face-down (back shown, front hidden in cardData until flipped).
  spawnHandCard(pos, card, faceDown) {
    return spawnTableCard(this, pos, { ...card, geo: geoOf(card) }, !!faceDown);
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
  // Built-in boards store the gap count + anchor; a custom board takes them from `msg`. For a hex
  // grid we derive the hex size from the board width ÷ the hex count instead. Returns a small
  // result object (or null) so a starter setup can react.
  calibrateGrid(msg = {}) {
    return calibrateRoomGrid(this, msg);
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
      for (let i = 0; i < n && cards.length; i++) {
        const entry = cards.pop();
        this.addToHand(client, cardFrontRef(entry), cardBackRef(entry) || back, geo, dp.open);
      }
    }
    deck.count = cards.length;
    if (!cards.length) this.removePiece(deckId);
    else this.updateDeckCollider(deckId);
  }

  // Load a ready-to-play starter game: clear the table, then set up the board + pieces (or the
  // deck + chips) so a host has a complete game in one click. Replaces the whole table (GM+).
  setupStarter(game) {
    return setupStarterGame(this, game);
  }

  // Rebuild a deck's collider box so its height matches its current card count.
  updateDeckCollider(deckId) {
    return updateRoomDeckCollider(this, deckId);
  }

  // --- Dispensers: hand out copies of a child piece (shared by dispense/dispenseDrag) ---

  // Rebuild a stack dispenser's cylinder collider to its current count (no-op for a bowl).
  updateStackCollider(id) {
    return updateRoomStackCollider(this, id);
  }

  // The spawn spec a dispenser hands out: an existing PROP, tinted (poker/coin) or
  // team-colored (go bowl) from the dispenser's own config.
  dispenserItem(piece) {
    return resolveDispenserItem(piece); // shape + tint/team the stack hands out (shared rule)
  }

  // After a dispense: a finite dispenser shrinks and is removed when empty; an
  // infinite one (bowl) is unchanged.
  afterDispense(piece, id) {
    consumeDispensedItem(this, piece, id);
  }

  // Write a table deck to the disk library; returns true on success. Any inline
  // image art (data-URLs) is moved to files so the saved JSON stays small.
  async saveDeckById(deckId, name, ownerId = null) {
    return saveRoomDeckById(this, deckId, name, ownerId);
  }

  // The effective self-right mode for a piece:
  //   true   → keep it standing tall (chess, tokens)
  //   'flat' → keep it lying flat (decks, checkers, coins)
  //   falsy  → don't self-right at all
  standOf(piece) {
    return pieceStand(piece);
  }
  // Which mode to switch a piece INTO when the toggle turns self-right on. Uses
  // the shape's declared default, or infers "flat" when the collider is thin on Y
  // (so a coin/checker lies down) and "stand tall" otherwise.
  naturalStand(piece) {
    return naturalPieceStand(piece);
  }

  // Delete a piece everywhere: physics body, synced state, and every private map.
  removePiece(id) {
    return removeRoomPiece(this, id);
  }

  // Apply a color to one piece, validating by type (shared by the single `recolor` message and
  // the `recolorGroup` batch). Returns true if it changed. A die takes body + number color; a
  // prop takes body; a poker/coin dispenser takes its tint; a team bowl takes a team flag.
  // Anything else — cards, boards — is left untouched. Writing props re-syncs it to every client.
  recolorPiece(id, opts = {}) {
    return recolorRoomPiece(this, id, opts); // synced → every client rebuilds the piece
  }

  // Send a player their private hand, and publish only its COUNT to everyone
  // else (so others can draw the right-sized fan without seeing the cards).
  sendHand(client) {
    const hand = this.hands.get(client.sessionId) || [];
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.hand = hand.length; // public count only
      player.handBack = hand.length ? (hand[0].open ? 'back' : hand[0].back || '') : ''; // public back image; a double-sided card shows a generic cover (its faces are public elsewhere)
    }
    client.send('hand', hand); // private contents, to this client alone
  }

  clientBy(sid) {
    return this.clients.find((c) => c.sessionId === sid);
  }

  // Build (or rebuild) the table surface + four containment walls at the given
  // half-extents. Called on create and whenever the GM resizes the table.
  buildBounds(hx, hz, shape = (this.state && this.state.tableShape) || 'rect') {
    buildTableBounds(this, hx, hz, shape);
  }

  // The world-space centre of seat N's tray (on the track, behind that seat).
  trayCenterFor(seat) {
    return roomTrayCenter(this, seat);
  }

  // Build / rebuild the physics (floor + walls + lid) for EVERY enabled seat's tray, each at
  // its seat angle. Bodies are tagged `__traySeat` so the out-of-bounds net can send a stray
  // die back to the right tray. Called when a tray is toggled or the table is resized; before
  // rebuilding, tray dice are moved to their seat's new centre so they stay inside their walls.
  buildTrays() {
    buildRoomTrays(this);
  }

  // Keep each tray die glued to its seat's tray as the track radius changes (table resize):
  // clamp it back inside that seat's current footprint. Cheap and only matters on resize.
  repositionTrayDice() {
    repositionRoomTrayDice(this);
  }

  // A drop point for a new die in SEAT's tray: a random spot inside its footprint, above the
  // floor (below the wall tops) so it tumbles in.
  trayDropPos(seat) {
    return roomTrayDropPos(this, seat);
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
    return releaseRoomPiece(this, id, v);
  }

  // Remove every die belonging to seat N's tray (used by Clear and by putting the tray away).
  clearTraySeat(seat) {
    clearRoomTraySeat(this, seat);
  }

  // Wipe every piece + its private bookkeeping (shared by Reset and scene load).
  // Leaves the timer, scoreboard, notes, and table size alone.
  clearTable() {
    clearGameTable(this);
  }

  // Serialize the current table into a scene payload: the table size, and every
  // piece with its transform. A deck's private card list rides along so it comes
  // back as a real deck; a face-down card carries its private front.
  // The per-room scale as a plain object (grid + measurement calibration), for both the
  // durable room row and the scene snapshot, so a saved scene restores its grid/units too.
  scaleSnapshot() {
    return snapshotRoomScale(this);
  }
  // Validate + apply a scale object (from the room row or a scene). Every field is optional
  // and range-checked, so an old/partial snapshot just keeps the current defaults.
  applyScale(s) {
    applyRoomScale(this, s);
  }

  // Restore which seats' trays are out from a scene (an array of seat indices), then rebuild
  // their walls. Absent → no trays (older scenes have none). The tray DICE ride as pieces.
  applyTrays(seats) {
    applyRoomTrays(this, seats);
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
    roomAccess.dispose(this);
    await safeRoomTask(
      this,
      'disposeSave',
      null,
      () => saveFinalRoomState(this, { sceneMaxBytes: SCENE_MAX_BYTES }),
      { notify: false },
    );
    LIVE_ROOMS.delete(this);
  }

  // Send a client the library list for one asset kind. Admins get everything
  // (incl. private); everyone else gets only published (public) assets.
  async sendAssetList(client, kind) {
    return sendRoomAssetList(this, client, kind);
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
    return sendRoomMembers(this, client);
  }
  async broadcastMembers() {
    return broadcastRoomMembers(this);
  }
  // Tell the matching lobby (if anyone's waiting there) that a pending user's status
  // changed, so it can push + release them instead of them polling for it.
  async notifyLobby(userId, method) {
    return notifyRoomLobby(this, userId, method);
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

  // Bind authorization to this room, including joins made directly by room ID.
  async onAuth(client, options) {
    return roomAccess.authorize(this, client, options);
  }

  async onReconnect(client) {
    await roomAccess.reconnect(this, client);
    client.send('whoami', { isAdmin: client.auth.isAdmin });
  }

  rank(client) {
    if (client.auth?.revoked) return -1;
    return rankOf(client.auth && client.auth.role);
  }
  isAdmin(client) {
    return !!(client.auth && !client.auth.revoked && client.auth.isAdmin);
  } // site admin — curates the library, spawns private assets anywhere

  async onJoin(client) {
    roomAccess.assertActive(this, client);
    const auth = client.auth || {};
    // Give the new player the lowest free seat and a color to match.
    const takenSeats = new Set();
    this.state.players.forEach((existing) => takenSeats.add(existing.seat));
    let seat = 0;
    while (takenSeats.has(seat)) seat++;

    const player = new Player();
    player.seat = seat;
    player.order = this.state.players.size;
    player.hand = 0;
    player.showing = 0;
    player.name = auth.username || 'Player ' + (seat + 1); // identity from the account
    player.color = PALETTE[seat % PALETTE.length];
    player.avatar = auth.avatar || '';
    player.role = auth.role || 'player';
    this.state.players.set(client.sessionId, player);

    // Reclaim a saved hand / the turn if this account owned one in the loaded game.
    const uid = auth.userId != null ? String(auth.userId) : null;
    if (uid != null) {
      this.handOwners.set(client.sessionId, uid);
      claimHand(this, uid, client.sessionId);
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
    this.state.players.forEach((player, sid) => order.push([sid, player.order, player.seat]));
    order.sort((a, b) => a[1] - b[1] || a[2] - b[2]);
    if (!order.length) {
      this.state.turn = '';
      return;
    }
    const ids = order.map(([sid]) => sid);
    this.state.turn = ids[(ids.indexOf(this.state.turn) + 1) % ids.length]; // indexOf -1 wraps to the first
  }

  // Copy a physics body's position + orientation into its synced Piece record.
  // --- Dev profiling (docs/ROADMAP.md §1) ------------------------------------
  // Gated behind PERF_LOG=1. Fed the just-measured world.step duration and the real
  // inter-tick delta each tick; logs a rolling ~1s summary. The awake count is the
  // server-side "real scale" signal: settled bodies sleep (and cost no bandwidth, see the
  // writeTransform loop in update), so step + net cost spike with how many are awake at once.
  _perfTick(stepMs, dtMs) {
    if (!this._perf)
      this._perf = { n: 0, stepSum: 0, stepMax: 0, dtSum: 0, awakeMax: 0, t: performance.now() };
    const p = this._perf;
    let awake = 0;
    this.bodies.forEach((b) => {
      if (b.sleepState !== CANNON.Body.SLEEPING) awake++;
    });
    p.n++;
    p.stepSum += stepMs;
    if (stepMs > p.stepMax) p.stepMax = stepMs;
    p.dtSum += dtMs;
    if (awake > p.awakeMax) p.awakeMax = awake;
    const now = performance.now();
    if (now - p.t < 1000) return; // one summary line per second
    console.log(
      `[perf ${this.roomId}] step ${(p.stepSum / p.n).toFixed(2)}ms avg / ${p.stepMax.toFixed(2)}ms max · ` +
        `awake ${p.awakeMax}/${this.bodies.size} bodies · tick ${(p.dtSum / p.n).toFixed(1)}ms (target 16.7) · ` +
        `${p.n} ticks/s`,
    );
    this._perf = { n: 0, stepSum: 0, stepMax: 0, dtSum: 0, awakeMax: 0, t: now };
  }

  // Tell one client their action was dropped because the table hit the piece cap (SIM.maxPieces).
  // The client shows a toast (see onMessage 'notice' in client.js). One #toast slot, so repeats
  // from a rapid drag just refresh the same notice rather than stacking up.
  notifyFull(client) {
    if (!client) return;
    client.send('notice', {
      text: `Table is full (${SIM.maxPieces} pieces) — clear some to add more.`,
      icon: 'x',
    });
  }

  writeTransform(piece, body) {
    return writePieceTransform(piece, body);
  }

  // The simulation heartbeat, run 60×/second. Three passes over the pieces
  // (drive held ones, self-right the rest, advance flips), then step the world
  // and publish the results. dtMs is the real time since the last tick.
  // --- Pin-when-snapped: freeze a settled snap-to-grid piece so neighbours can't
  // nudge it off its cell (chess/checkers). It stays collidable and grabbable; a grab
  // unpins it (see update Pass 1). Only ever touches pieces that are DYNAMIC to begin
  // with, so boards and other static bodies are never affected.
  pinPiece(id) {
    return pinRoomPiece(this, id);
  }
  unpinPiece(id) {
    return unpinRoomPiece(this, id);
  }
  wantsSnap(piece) {
    return roomPieceWantsSnap(this, piece);
  }

  update(dtMs) {
    recoverPendingInspections(this);
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

      // Drive the collider footprint at the requested height. Reject a bad derived
      // velocity before it can introduce Infinity/NaN into the physics world.
      const velocity = dragVelocity(
        body.position,
        target,
        body.shapeOffsets[0]?.y ?? 0,
        stiffness,
        maxSpeed,
      );
      if (!velocity) {
        this.targets.delete(id);
        piece.owner = '';
        body.velocity.setZero();
        return;
      }
      body.velocity.set(velocity.x, velocity.y, velocity.z);
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

    let __perfT0 = 0;
    if (PERF_LOG) __perfT0 = performance.now();
    this.world.step(SIM.step.fixed, dt, SIM.step.maxSub);
    if (PERF_LOG) this._perfTick(performance.now() - __perfT0, dtMs);

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
    if (!consented && !client.auth?.revoked) {
      try {
        await roomAccess.waitForReconnect(this, client, 30);
        return; // they reconnected — keep everything
      } catch (e) {
        /* didn't return in time — fall through and clean up */
      }
    }

    roomAccess.forget(this, client);

    // Park a departing player's hand as unclaimed so it survives to a save and can be
    // reclaimed on their return or reassigned by a GM (fires only after the reconnect window).
    parkHand(this, client);
    this.lastDrop.delete(client.sessionId);
    this.notebooks.delete(`session:${client.sessionId}`); // account-keyed notes live until the room closes
    this.stopShow(client.sessionId); // clear any hold-to-show they had live

    // Return an inspection to its deck, or recover it as a face-down table card.
    const pending = this.pendingInspect.get(client.sessionId);
    if (pending) {
      pending.recover = true;
      returnInspectedCard(this, client.sessionId);
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
    return roomAccess.authorize(this, client, options, 'editor');
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
// so scripts lock to 'self' plus the known inline-script hashes (currently the
// import map used by both table and editor modes). data:/blob: are allowed in connect-src for
// Three's loaders (embedded model buffers + object URLs). No 'unsafe-eval': Colyseus
// feature-detects eval and falls back to its non-inline decoder when it's blocked.
// Violations still POST to /csp-report so real ones surface in the logs.
const CSP_INLINE = [
  "'sha256-nAG3xy0rRET2ecuPDHRx6qjQE+p+98x1xfv8G0NqT2c='", // import map (table, editor)
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

// Bundled Mahjong faces keep stable paths within a release. Let repeat room entries reuse them
// without 42 conditional requests, while the general public tree (including JS) still revalidates.
app.use('/mahjong/faces', express.static('public/mahjong/faces', { maxAge: '1d' }));
app.use(express.static('public'));
app.use('/shared', express.static('shared'));

// Card/tile faces use a display-sized WebP derivative. Originals remain untouched for library
// editing and future reprocessing; the derivative is generated once and then cached immutably.
app.use(createAssetTextureRouter({ assetsDir: ASSETS_DIR, assetKinds: ASSET_KINDS }));

// Serve uploaded images/models, but NEVER the .json metadata beside them — that
// keeps a hidden card front living on disk from being fetched directly.
app.use(
  '/assets',
  (req, res, next) => {
    if (/\.json$/i.test(req.path)) return res.sendStatus(404);
    next();
  },
  // Uploaded files receive random names and are never overwritten; edits create a new URL.
  express.static(ASSETS_DIR, { maxAge: '1y', immutable: true }),
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
  createAuthRouter({
    db,
    rateLimitAuth,
    hashPassword,
    verifyPassword,
    makeToken,
    hashToken,
    roomAccess,
  }),
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
  return roomAccess.kickUser(userId);
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
    roomAccess,
    texturePrebuilder,
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
  onCreate(options) {
    this.roomCode = options?.code || null;
  }
  async onAuth(client, options) {
    return roomAccess.authorize(this, client, options, 'lobby');
  }
  onJoin(client) {
    roomAccess.assertActive(this, client);
  }
  async onReconnect(client) {
    await roomAccess.reconnect(this, client);
  }
  onDispose() {
    roomAccess.dispose(this);
  }
  async onLeave(client, consented) {
    // A pending joiner who dropped (tab close / flaky net): hold their spot briefly so a
    // reconnect keeps them waiting. Admit/decline leave consented → no hold (clean exit).
    if (consented !== true && consented !== 4000 && !client.auth?.revoked) {
      try {
        await roomAccess.waitForReconnect(this, client, 20);
        return;
      } catch (e) {
        /* didn't return in time or access was revoked */
      }
    }
    roomAccess.forget(this, client);
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
