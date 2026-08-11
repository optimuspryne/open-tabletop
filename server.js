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
import { Server, Room } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Schema, MapSchema, defineTypes } from '@colyseus/schema';
import * as CANNON from 'cannon-es';
import convexHull from 'convex-hull';
import { KINDS, PROPS, BOARDS, TABLE, dieVerts, DIE_RADIUS, deckHeight } from './shared/pieces.js';

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
const ASSET_KINDS = ['uploads', 'decks', 'boards', 'props'];
for (const kind of ASSET_KINDS) fs.mkdirSync(path.join(ASSETS_DIR, kind), { recursive: true });

// Clamp a number into [min, max].
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Reduce a user-supplied name to a safe filename slug: lowercase, only [a-z0-9-],
// at most 60 chars. This also defeats path traversal — "../../etc" becomes "etc".
const slugify = (name) =>
  String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

// Keep an untrusted category name inside the allowlist (falls back to 'uploads').
const assetKind = (kind) => ASSET_KINDS.includes(kind) ? kind : 'uploads';

// Path to a category's metadata file. Both inputs are sanitised here, so no
// caller can escape the assets folder no matter what it passes in.
const metaFile = (kind, slug) => path.join(ASSETS_DIR, assetKind(kind), slugify(slug) + '.json');

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

// Read every <slug>.json in a category folder and turn each into a list entry
// via map(data, slug). A corrupt file is skipped; a missing folder yields [].
// The three wrappers below differ only in the folder and the fields they surface.
function listSaved(kind, map) {
  try {
    const folder = path.join(ASSETS_DIR, kind);
    return fs.readdirSync(folder)
      .filter(filename => filename.endsWith('.json'))
      .map(filename => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(folder, filename)));
          return map(data, filename.slice(0, -5)); // slug = filename without ".json"
        } catch {
          return null; // skip a corrupt file
        }
      })
      .filter(Boolean); // drop the skipped ones
  } catch {
    return []; // folder doesn't exist yet
  }
}

const listSavedDecks = () =>
  listSaved('decks', (data, slug) => ({ slug, name: data.name, count: data.fronts.length }));

const listSavedProps = () =>
  listSaved('props', (data, slug) => ({ slug, name: data.name, props: data.props }));

const listSavedBoards = () =>
  listSaved('boards', (data, slug) => ({ slug, name: data.name, kind: boardKindLabel(data) }));

// A short human-readable descriptor for a saved board, shown in the load menu:
// a built-in board's name, "model" for an uploaded .glb, or "WIDTH×DEPTH".
function boardKindLabel(data) {
  if (data.board) return BOARDS[data.board] ? BOARDS[data.board].name : data.board;
  if (data.model) return 'model';
  return `${data.w || 8}\u00d7${data.d || 8}`;
}

// --- Colliders ---------------------------------------------------------------
// Build the cannon-es collider for a piece from its shared shape descriptor.
// The collider is always a simple primitive (box/sphere/convex-hull); the fancy
// visual mesh is the client's job, and only needs to roughly match this.
function buildCollider(type, props) {
  const shape = KINDS[type].shape;

  if (shape === 'die') return dieShape(props.sides || 6);

  if (shape === 'prop') {
    // A .glb model prop carries its own measured half-extents; clamp them sane.
    if (props.model && Array.isArray(props.box)) {
      const [hx, hy, hz] = props.box.map(v => clamp(+v || 0.5, 0.05, 4));
      return new CANNON.Box(new CANNON.Vec3(hx, hy, hz));
    }
    // A built-in shape scales its template collider by the universal prop scale.
    const collider = (PROPS[props.shape] || PROPS.box).collider;
    const scale = clamp(+props.scale || 1, 0.3, 3); // matches the client's mesh scale
    if (collider.sphere) return new CANNON.Sphere(collider.sphere * scale);
    return new CANNON.Box(new CANNON.Vec3(collider.box[0] * scale, collider.box[1] * scale, collider.box[2] * scale));
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
defineTypes(Player, { seat: 'number', hand: 'number', name: 'string', color: 'string', avatar: 'string' });
class State extends Schema {
  constructor() { super(); this.pieces = new MapSchema(); this.players = new MapSchema(); this.turn = ''; }
}
defineTypes(State, { pieces: { map: Piece }, players: { map: Player }, turn: 'string' });

const PALETTE = ['#4a78c9', '#c94a4a', '#4ac97a', '#c9a24a', '#9a4ac9', '#4ac9c9'];

// --- Physics world (identical setup to the single-player client) ------------
// --- Physics world -----------------------------------------------------------
// Create the single cannon-es world: a static table to rest on, and four tall
// walls so a hard throw can't fling a piece off the edge. Returns the world with
// its shared contact material attached (spawn() reuses it for every piece).
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

  // The table surface sits just below y=0 so pieces rest at ~0.
  const table = new CANNON.Body({ mass: 0, material });
  table.addShape(new CANNON.Box(new CANNON.Vec3(TABLE.x, SIM.tableThick, TABLE.z)));
  table.position.set(0, -SIM.tableThick, 0);
  world.addBody(table);

  // A tall static wall centred at (px,pz) with half-extents (hx,hz).
  const addWall = (px, pz, hx, hz) => {
    const wall = new CANNON.Body({ mass: 0, material });
    wall.addShape(new CANNON.Box(new CANNON.Vec3(hx, SIM.wall.half, hz))); // tall so throws can't clear it
    wall.position.set(px, SIM.wall.half, pz);
    world.addBody(wall);
  };
  const thick = SIM.wall.thick;    // wall half-thickness
  const overlap = SIM.wall.over;   // extra length so the corners meet
  addWall(0, -(TABLE.z + thick), TABLE.x + overlap, thick); // near / far
  addWall(0,  (TABLE.z + thick), TABLE.x + overlap, thick);
  addWall(-(TABLE.x + thick), 0, thick, TABLE.z + overlap); // left / right
  addWall( (TABLE.x + thick), 0, thick, TABLE.z + overlap);

  world.__mat = material; // stash the shared material for spawn() to reuse
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
  onCreate() {
    this.setState(new State());
    this.world = buildWorld();
    this.mat = this.world.__mat;
    this.bodies = new Map();  // id -> CANNON.Body   (physics, not synced)
    this.targets = new Map(); // id -> {x,y,z}       (drag target of the owner)
    this.flips = new Map();   // id -> scripted half-flip in progress
    this.deckCards = new Map(); // id -> [frontRef]        PRIVATE: a deck's face-down cards (never synced)
    this.drafts = new Map();    // sessionId -> {back,cards} PRIVATE: a deck being built in chunks
    this.cardData = new Map();  // id -> { front }         PRIVATE: a face-down table card's hidden face
    this.hands = new Map();     // sessionId -> [{hid,front,back}]  PRIVATE: each player's hidden hand
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
    // Decks are built in chunks so no single message is large (text lists can be
    // hundreds of cards): deckBegin -> deckAppend (batches) -> deckFinish.
    // Decks are built in chunks so no single message is huge (a text list can be
    // hundreds of cards): deckBegin → deckAppend (batches) → deckFinish.
    this.onMessage('deckBegin', (client, msg) => {
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
    this.onMessage('deckFinish', (client, msg) => {
      const draft = this.drafts.get(client.sessionId);
      this.drafts.delete(client.sessionId);
      if (!draft || !draft.cards.length) return;
      const id = this.spawn('deck', rnd(), { back: draft.back, cards: draft.cards });
      // Optionally save it to the library in the same step (save-on-create).
      if (msg && msg.name && this.saveDeckById(id, msg.name)) {
        client.send('deckList', listSavedDecks());
      }
    });

    // --- Library: save / list / load decks, boards, props ---------------------
    this.onMessage('saveDeck', (client, msg) => {
      if (this.saveDeckById(msg && msg.deckId, msg && msg.name)) {
        client.send('deckList', listSavedDecks());
      }
    });
    this.onMessage('listDecks', (client) => client.send('deckList', listSavedDecks()));
    this.onMessage('loadDeck', (client, msg) => {
      const file = metaFile('decks', slugify(msg && msg.slug));
      try {
        if (fs.existsSync(file)) {
          const data = JSON.parse(fs.readFileSync(file));
          this.spawn('deck', rnd(), { back: data.back, cards: data.fronts });
        }
      } catch (e) { /* missing or corrupt file — ignore */ }
    });

    this.onMessage('saveBoard', (client, msg) => {
      const name = String((msg && msg.name) || '').slice(0, 60);
      if (!name) return;
      const slug = slugify(name);
      if (!slug) return;
      const board = (msg && msg.board) || {};
      try {
        let record;
        if (board.board && BOARDS[board.board]) {
          record = { name, board: board.board }; // a built-in board
        } else if (board.model) {
          record = { name, model: String(board.model).slice(0, 300), modelScale: +board.modelScale || 1,
                     box: Array.isArray(board.box) ? board.box.map(v => +v) : undefined }; // an uploaded .glb
        } else {
          record = { name, w: board.w, d: board.d, tex: board.tex || null }; // a procedural board
        }
        fs.writeFileSync(metaFile('boards', slug), JSON.stringify(record));
        client.send('boardList', listSavedBoards());
      } catch (e) { /* disk error — ignore */ }
    });
    this.onMessage('listBoards', (client) => client.send('boardList', listSavedBoards()));

    this.onMessage('saveProp', (client, msg) => {
      const name = String((msg && msg.name) || '').slice(0, 60);
      if (!name) return;
      const slug = slugify(name);
      if (!slug) return;
      const incoming = (msg && msg.props) || {};
      if (!incoming.model) return; // only custom-model props are saveable
      try {
        const props = {
          model: String(incoming.model).slice(0, 300),
          box: Array.isArray(incoming.box) ? incoming.box.map(v => +v) : undefined,
          stand: !!incoming.stand,
          scale: +incoming.scale || 1,
        };
        if (incoming.color != null) props.color = incoming.color | 0;
        fs.writeFileSync(metaFile('props', slug), JSON.stringify({ name, props }));
        client.send('propList', listSavedProps());
      } catch (e) { /* disk error — ignore */ }
    });
    this.onMessage('listProps', (client) => client.send('propList', listSavedProps()));

    // Shallow-edit a saved deck: swap the back and/or append cards, then either
    // overwrite it or save a copy under a new name.
    this.onMessage('editDeck', (client, msg) => {
      const slug = slugify(msg && msg.slug);
      if (!slug) return;
      try {
        const file = metaFile('decks', slug);
        if (!fs.existsSync(file)) return;
        const data = JSON.parse(fs.readFileSync(file));

        if (msg.back && deckRefOk(msg.back)) data.back = msg.back;
        if (Array.isArray(msg.addFronts)) {
          for (const front of msg.addFronts) {
            if (deckRefOk(front) && data.fronts.length < 1000) data.fronts.push(front);
          }
        }

        const targetName = String(msg.name || data.name).slice(0, 60);
        const targetSlug = msg.saveAs ? slugify(targetName) : slug; // save-as-copy vs overwrite
        if (!targetSlug) return;
        fs.writeFileSync(metaFile('decks', targetSlug), JSON.stringify({ name: targetName, back: data.back, fronts: data.fronts }));
        client.send('deckList', listSavedDecks());
      } catch (e) { /* disk error — ignore */ }
    });

    this.onMessage('loadBoard', (client, msg) => {
      const file = metaFile('boards', slugify(msg && msg.slug));
      try {
        if (!fs.existsSync(file)) return;
        const data = JSON.parse(fs.readFileSync(file));
        const props = data.board ? { board: data.board }
                    : data.model ? { model: data.model, modelScale: data.modelScale, box: data.box }
                    : { w: data.w, d: data.d, tex: data.tex || undefined };
        this.swapBoard(props);
      } catch (e) { /* missing or corrupt file — ignore */ }
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

    // --- Table-wide actions ----------------------------------------------------
    this.onMessage('spawn', (client, msg) => {
      if (this.state.pieces.size >= SIM.maxPieces) return;
      if (msg.type === 'board') {
        this.swapBoard(msg.props || {}); // only one board at a time
      } else {
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
    this.onMessage('reset', () => {
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
      for (const client of this.clients) this.sendHand(client); // clear every player's hand
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

    this.onMessage('nextTurn', () => this.advanceTurn());
    this.onMessage('remove', (client, { id }) => { if (this.state.pieces.has(id)) this.removePiece(id); });
    this.onMessage('setName', (client, { name }) => {
      const player = this.state.players.get(client.sessionId);
      if (player && typeof name === 'string') player.name = name.trim().slice(0, 20) || player.name;
    });
    this.onMessage('setAvatar', (client, { data }) => {
      const player = this.state.players.get(client.sessionId);
      // Only accept a bounded image data-URL (see the client-side XSS-safe render).
      if (player && typeof data === 'string' && data.startsWith('data:image') && data.length < 60000) {
        player.avatar = data;
      }
    });

    this.setSimulationInterval((dt) => this.update(dt), 1000 / 60); // fixed 60Hz sim
    this.setPatchRate(1000 / 60); // 60Hz state broadcast (delta-compressed; cheap on LAN)
  }

  // Create a piece: a physics body + a synced Piece record, wired together by id.
  // pos is [x,y,z]; props are the type-specific fields (shape, sides, back, …).
  spawn(type, pos, props = {}) {
    const mass = type === 'prop' ? (PROPS[props.shape] || PROPS.box).mass : KINDS[type].mass;
    const body = new CANNON.Body({ mass, material: this.mat });
    body.addShape(buildCollider(type, props));
    body.position.set(pos[0], pos[1], pos[2]);

    // Dice/props spawn at a random tumble; boards and decks stay flat.
    if (KINDS[type].mass > 0 && type !== 'deck') {
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
  saveDeckById(deckId, name) {
    const fronts = this.deckCards.get(deckId), piece = this.state.pieces.get(deckId);
    if (!fronts || !fronts.length || !piece || piece.type !== 'deck') return false;
    const slug = slugify(name);
    if (!slug) return false;
    try {
      let back = JSON.parse(piece.props || '{}').back || 'back';
      if (isDataURL(back)) back = saveImageRef(back, 'decks') || 'back';
      const savedFronts = fronts.map(front => isDataURL(front) ? (saveImageRef(front, 'decks') || front) : front);
      fs.writeFileSync(metaFile('decks', slug), JSON.stringify({ name: String(name).slice(0, 60), back, fronts: savedFronts }));
      return true;
    } catch (e) {
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
    if (player) player.hand = hand.length; // public count only
    client.send('hand', hand);             // private contents, to this client alone
  }

  onJoin(client) {
    // Give the new player the lowest free seat and a colour to match.
    const takenSeats = new Set();
    this.state.players.forEach(existing => takenSeats.add(existing.seat));
    let seat = 0;
    while (takenSeats.has(seat)) seat++;

    const player = new Player();
    player.seat = seat;
    player.hand = 0;
    player.name = 'Player ' + (seat + 1);
    player.color = PALETTE[seat % PALETTE.length];
    this.state.players.set(client.sessionId, player);

    if (!this.state.turn) this.state.turn = client.sessionId; // first player to arrive starts
    this.sendHand(client);
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
      let vy = (target.y - body.position.y) * stiffness;
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
    const limitX = TABLE.x + SIM.bounds.margin, limitZ = TABLE.z + SIM.bounds.margin;
    this.bodies.forEach((body) => {
      const pos = body.position;
      const escaped = pos.y < SIM.bounds.floor || pos.y > SIM.bounds.ceiling || Math.abs(pos.x) > limitX || Math.abs(pos.z) > limitZ;
      if (escaped) {
        pos.set(clamp(pos.x, -TABLE.x + 1, TABLE.x - 1), 3, clamp(pos.z, -TABLE.z + 1, TABLE.z - 1));
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

  // A player's hand isn't in shared state, so resend it when they reconnect.
  onReconnect(client) { this.sendHand(client); }
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

const httpServer = createServer(app);
const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer, maxPayload: 4 * 1024 * 1024 }) });
gameServer.define('table', TableRoom);

const PORT = process.env.PORT || 2567;
gameServer.listen(PORT).then(() => console.log(`\n  Tabletop running →  http://localhost:${PORT}\n`));
