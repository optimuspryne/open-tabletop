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

// --- Saved-asset library (persists to disk; mount ASSETS_DIR as a volume) -----
// Layout: <ASSETS_DIR>/{uploads,decks,boards,props}/
//   <rnd>.<ext>  images, served at /assets/<kind>/<rnd>
//   <slug>.json  metadata, NEVER served (a guard blocks .json under /assets)
// Filenames are random and metadata is unserved, so unrevealed card fronts
// can't be enumerated — the hidden-info invariant survives on disk.
const ASSETS_DIR = process.env.ASSETS_DIR || './saved-assets';
const ASSET_KINDS = ['uploads', 'decks', 'boards', 'props'];
for (const k of ASSET_KINDS) fs.mkdirSync(path.join(ASSETS_DIR, k), { recursive: true });
const assetKind = k => ASSET_KINDS.includes(k) ? k : 'uploads';       // validate category
const metaFile = (kind, slug) => path.join(ASSETS_DIR, assetKind(kind), slugify(slug) + '.json'); // sink-guarded: kind allowlisted, slug stripped to [a-z0-9-] — no path traversal regardless of caller
function saveAsset(kind, buf, ext = 'jpg') { // write bytes into a category folder, return its URL
  const name = crypto.randomBytes(9).toString('hex') + '.' + String(ext).replace(/[^a-z0-9]/gi, '');
  const k = assetKind(kind);
  fs.writeFileSync(path.join(ASSETS_DIR, k, name), buf);
  return `/assets/${k}/${name}`;
}

const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const isDataURL = s => typeof s === 'string' && s.startsWith('data:image');
const deckRefOk = s => typeof s === 'string' && s.length < 200000; // a card ref: text/url/data-URL
function saveImageRef(dataURL, kind = 'decks') { // write a data-URL into a category folder, return its URL
  const m = /^data:(image\/\w+);base64,(.+)$/s.exec(dataURL);
  if (!m) return null;
  return saveAsset(kind, Buffer.from(m[2], 'base64'), m[1].split('/')[1].replace('jpeg', 'jpg'));
}
function listSavedDecks() {
  try {
    const dir = path.join(ASSETS_DIR, 'decks');
    return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
      try { const d = JSON.parse(fs.readFileSync(path.join(dir, f))); return { slug: f.slice(0, -5), name: d.name, count: d.fronts.length }; }
      catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}
// Saved boards live in the same folder with a .board.json suffix ({name,w,d,tex}).
function listSavedProps() { // saved custom-model props (props/<slug>.json = {name, props})
  try {
    const dir = path.join(ASSETS_DIR, 'props');
    return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
      try { const d = JSON.parse(fs.readFileSync(path.join(dir, f))); return { slug: f.slice(0, -5), name: d.name, props: d.props }; }
      catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}
function listSavedBoards() {
  try {
    const dir = path.join(ASSETS_DIR, 'boards');
    return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
      try { const d = JSON.parse(fs.readFileSync(path.join(dir, f)));
        const kind = d.board ? (BOARDS[d.board] ? BOARDS[d.board].name : d.board) : d.model ? 'model' : ((d.w||8) + '\u00d7' + (d.d||8));
        return { slug: f.slice(0, -5), name: d.name, kind }; }
      catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

// Collider for any kind, from its shared shape descriptor.
function buildCollider(type, props) {
  const shape = KINDS[type].shape;
  if (shape === 'die') return dieShape(props.sides || 6);
  if (shape === 'prop') {
    if (props.model && Array.isArray(props.box)) { const b = props.box.map(v => Math.max(0.05, Math.min(4, +v || 0.5))); return new CANNON.Box(new CANNON.Vec3(b[0], b[1], b[2])); }
    const c = (PROPS[props.shape] || PROPS.box).collider;
    const k = Math.max(0.3, Math.min(3, +props.scale || 1)); // universal prop scale (matches the client mesh)
    return c.sphere ? new CANNON.Sphere(c.sphere * k) : new CANNON.Box(new CANNON.Vec3(c.box[0]*k, c.box[1]*k, c.box[2]*k)); }
  if (type === 'board') {
    const bd = props.board && BOARDS[props.board];              // built-in model board
    const box = bd ? bd.box : ((props.model && Array.isArray(props.box)) ? props.box : null); // or uploaded .glb board
    if (box) { const b = box.map(v => Math.max(0.02, Math.min(2 * TABLE.x, +v || 0.05))); return new CANNON.Box(new CANNON.Vec3(b[0], b[1], b[2])); }
  }
  if (type === 'board' && (props.w || props.d)) {
    const w = Math.max(2, Math.min(2*TABLE.x - 2, props.w || 8)), d = Math.max(2, Math.min(2*TABLE.z - 2, props.d || 8));
    return new CANNON.Box(new CANNON.Vec3(w/2, 0.05, d/2));
  }
  if (type === 'card') return new CANNON.Box(new CANNON.Vec3(shape.box[0], SIM.cards.colliderThick, shape.box[2])); // thicker than the mesh for stack stability
  return new CANNON.Box(new CANNON.Vec3(...shape.box));
}

// Build a convex collider for a polyhedral die from its vertices. Hull triangles
// that share a normal are MERGED into one polygon face (each kite/pentagon
// becomes a single face) — coplanar triangles with a shared internal edge make
// cannon's contact solver jitter, which is what made the d10 bounce on its own.
const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };
function dieShape(sides) {
  if (sides === 6) return new CANNON.Box(new CANNON.Vec3(DIE_RADIUS[6], DIE_RADIUS[6], DIE_RADIUS[6]));
  const verts = dieVerts(sides, DIE_RADIUS[sides] || 1);
  if (!verts) return new CANNON.Box(new CANNON.Vec3(DIE_RADIUS[6], DIE_RADIUS[6], DIE_RADIUS[6]));
  try {
    const groups = [];
    for (const [i, j, k] of convexHull(verts)) {
      const n = norm(cross(sub(verts[j], verts[i]), sub(verts[k], verts[i])));
      let g = groups.find(g => dot(g.n, n) > 0.999);
      if (!g) { g = { n, idx: new Set() }; groups.push(g); }
      g.idx.add(i); g.idx.add(j); g.idx.add(k);
    }
    const faces = groups.map(g => {
      const idx = [...g.idx];
      const cen = idx.reduce((s, i) => [s[0]+verts[i][0], s[1]+verts[i][1], s[2]+verts[i][2]], [0,0,0]).map(x => x/idx.length);
      const u = norm(sub(verts[idx[0]], cen)), w = cross(g.n, u);
      idx.sort((p, q) => Math.atan2(dot(sub(verts[p], cen), w), dot(sub(verts[p], cen), u))
                        - Math.atan2(dot(sub(verts[q], cen), w), dot(sub(verts[q], cen), u)));
      const pn = cross(sub(verts[idx[1]], verts[idx[0]]), sub(verts[idx[2]], verts[idx[0]]));
      if (dot(pn, g.n) < 0) idx.reverse(); // outward winding
      return idx;
    });
    return new CANNON.ConvexPolyhedron({ vertices: verts.map(v => new CANNON.Vec3(v[0], v[1], v[2])), faces });
  } catch (e) {
    return new CANNON.Box(new CANNON.Vec3(DIE_RADIUS[6], DIE_RADIUS[6], DIE_RADIUS[6])); // safety net
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
function buildWorld() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, SIM.gravity, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  const mat = new CANNON.Material('s');
  world.solver.iterations = SIM.solverIterations;
  world.addContactMaterial(new CANNON.ContactMaterial(mat, mat, { friction: SIM.friction, restitution: SIM.restitution, contactEquationStiffness: SIM.contact.stiffness, contactEquationRelaxation: SIM.contact.relaxation }));

  const table = new CANNON.Body({ mass: 0, material: mat });
  table.addShape(new CANNON.Box(new CANNON.Vec3(TABLE.x, SIM.tableThick, TABLE.z)));
  table.position.set(0, -SIM.tableThick, 0);
  world.addBody(table);

  const wall = (px, pz, hx, hz) => {
    const b = new CANNON.Body({ mass: 0, material: mat });
    b.addShape(new CANNON.Box(new CANNON.Vec3(hx, SIM.wall.half, hz))); // tall so hard throws can't clear them
    b.position.set(px, SIM.wall.half, pz);
    world.addBody(b);
  };
  const t = SIM.wall.thick, o = SIM.wall.over; // half-thickness; corner overlap
  wall(0, -(TABLE.z + t), TABLE.x + o, t); wall(0, TABLE.z + t, TABLE.x + o, t);
  wall(-(TABLE.x + t), 0, t, TABLE.z + o); wall(TABLE.x + t, 0, t, TABLE.z + o);

  world.__mat = mat;
  return world;
}

const rnd = () => [(Math.random() - 0.5) * 8, SIM.spawnY, (Math.random() - 0.5) * 6];

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
// A card is identified by texture REFERENCES: 'rank:A:#111' (procedural face),
// 'back' (procedural back), or a data-URL / URL for an uploaded/file image.
// A deck = a shared back + an ordered list of front refs.
function buildDeck() { // standard 52-card deck, shuffled
  const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const blacksuites = ['♠','♣'];
  const blackcolor = '#000000';
  const redsuites = ['♥','♦'];
  const redcolor = '#bd2500';
  const cards = [];
  for (const suite of blacksuites) for (const rank of ranks) cards.push(`rank:${rank}:${suite}:${blackcolor}`);
  for (const suite of redsuites) for (const rank of ranks) cards.push(`rank:${rank}:${suite}:${redcolor}`);
  return { back: 'back', cards: shuffle(cards) };
}

/*function seedPieces(room) {
  [6, 6, 20, 8].forEach(sides => room.spawn('die', rnd(), { sides }));
  [0x4a78c9, 0xc94a4a].forEach(color => room.spawn('prop', rnd(), { shape: 'pawn', color }));
  room.spawn('deck', [-3, 0.3, 2]);
}*/

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

    this.spawn('board', [0, 0.05, 0]);
    //seedPieces(this);

    this.onMessage('grab', (client, { id }) => {
      const p = this.state.pieces.get(id);
      if (p && !p.owner && !this.flips.has(id) && KINDS[p.type].mass > 0) p.owner = client.sessionId; // claim if free & movable
    });
    this.onMessage('move', (client, m) => {
      const p = this.state.pieces.get(m.id);
      if (p && p.owner === client.sessionId) this.targets.set(m.id, { x: m.x, y: m.y, z: m.z });
    });
    this.onMessage('release', (client, m) => {
      const p = this.state.pieces.get(m.id);
      if (!p || p.owner !== client.sessionId) return;
      p.owner = ''; this.targets.delete(m.id);
      const b = this.bodies.get(m.id);
      if (b) {
        if (m.v) { // apply the hand speed the client measured -> a real throw
          let [vx, vy, vz] = m.v;
          const V = Math.hypot(vx, vy, vz), CAP = p.type === 'card' ? SIM.cards.maxThrow : SIM.throwCap, s = V > CAP ? CAP / V : 1;
          b.velocity.set(vx * s, vy * s, vz * s);
        }
        b.wakeUp();
      }
      // drop a card onto a deck -> its front goes back onto the top of the stack
      if (p.type === 'card' && b) {
        for (const [deckId, cards] of this.deckCards) {
          const db = this.bodies.get(deckId); if (!db) continue;
          if (Math.abs(b.position.x - db.position.x) < SIM.absorb.x && Math.abs(b.position.z - db.position.z) < SIM.absorb.z) {
            const front = (this.cardData.get(m.id) || {}).front || JSON.parse(p.props || '{}').front;
            if (front) cards.push(front);
            this.state.pieces.get(deckId).count = cards.length;
            this.updateDeckCollider(deckId);
            this.removePiece(m.id);
            break;
          }
        }
      }
    });
    this.onMessage('flip', (client, { id }) => {
      const p = this.state.pieces.get(id), b = this.bodies.get(id);
      if (!p || !b || p.type !== 'card') return;
      // move the FRONT between public (synced props) and private (cardData); the back stays public
      const cur = JSON.parse(p.props || '{}');
      if (cur.front) { this.cardData.set(id, { front: cur.front }); delete cur.front; p.props = JSON.stringify(cur); }      // hide
      else if (this.cardData.has(id)) { cur.front = this.cardData.get(id).front; this.cardData.delete(id); p.props = JSON.stringify(cur); } // reveal
      b.wakeUp(); b.velocity.y = SIM.flipHop; // small hop for feedback (the client swaps the visible face)
    });
    this.onMessage('dealToTable', (client, { deckId }) => { // top card -> face-down onto the table
      const p = this.state.pieces.get(deckId), cards = this.deckCards.get(deckId);
      if (!p || p.type !== 'deck' || !cards || !cards.length) return;
      const back = JSON.parse(p.props || '{}').back || 'back', front = cards.pop();
      const db = this.bodies.get(deckId);
      const id = this.spawn('card', [db.position.x + 1.7 + Math.random() * 0.4, 2.5, db.position.z + (Math.random() - 0.5) * 0.6], { back }); // only back is public
      const b = this.bodies.get(id); b.quaternion.set(0, 0, 0, 1); this.writeTransform(this.state.pieces.get(id), b); // lie flat
      this.cardData.set(id, { front }); // front stays private until taken or flipped
      p.count = cards.length;
      if (!cards.length) this.removePiece(deckId); else this.updateDeckCollider(deckId);
    });
    this.onMessage('dealDrag', (client, m) => { // deal the top card and hand control to the dealer to drag it out
      const p = this.state.pieces.get(m.deckId), cards = this.deckCards.get(m.deckId);
      if (!p || p.type !== 'deck' || !cards || !cards.length) return;
      const back = JSON.parse(p.props || '{}').back || 'back', front = cards.pop();
      const db = this.bodies.get(m.deckId);
      const id = this.spawn('card', [db.position.x, 2.5, db.position.z], { back });
      const b = this.bodies.get(id); b.quaternion.set(0, 0, 0, 1); this.writeTransform(this.state.pieces.get(id), b);
      this.cardData.set(id, { front });
      p.count = cards.length;
      if (!cards.length) this.removePiece(m.deckId); else this.updateDeckCollider(m.deckId);
      this.state.pieces.get(id).owner = client.sessionId; // dealer now drives it
      this.targets.set(id, { x: m.x, y: m.y, z: m.z });
      client.send('dealt', { id }); // tell the client which card it just picked up
    });
    this.onMessage('takeCard', (client, { id }) => { // table card -> your hidden hand
      const p = this.state.pieces.get(id); if (!p || p.type !== 'card') return;
      const cur = JSON.parse(p.props || '{}');
      const front = (this.cardData.get(id) || {}).front || cur.front, back = cur.back || 'back';
      const hand = this.hands.get(client.sessionId) || [];
      hand.push({ hid: 'h' + (this.nextHid++), front, back });
      this.hands.set(client.sessionId, hand);
      this.removePiece(id);
      this.sendHand(client);
    });
    // Draw the top card and let ONLY the drawer see its front (like a private hand of one).
    // The card sits in limbo until placed; the deck count drops for everyone (public).
    this.onMessage('drawInspect', (client, { deckId }) => {
      if (this.pendingInspect.has(client.sessionId)) return; // one draw at a time
      const p = this.state.pieces.get(deckId), cards = this.deckCards.get(deckId);
      if (!p || p.type !== 'deck' || !cards || !cards.length) return;
      const back = JSON.parse(p.props || '{}').back || 'back', front = cards.pop();
      p.count = cards.length; this.updateDeckCollider(deckId); // keep the (maybe empty) deck so the card can return
      this.pendingInspect.set(client.sessionId, { deckId, front, back });
      client.send('inspectCard', { front, back }); // PRIVATE: front goes only to the drawer
    });
    this.onMessage('inspectPlace', (client, { where }) => {
      const pend = this.pendingInspect.get(client.sessionId); if (!pend) return;
      this.pendingInspect.delete(client.sessionId);
      const { deckId, front, back } = pend;
      if (where === 'deck') { // put it back on top
        const cards = this.deckCards.get(deckId);
        if (cards) { cards.push(front); const dp = this.state.pieces.get(deckId); if (dp) dp.count = cards.length; this.updateDeckCollider(deckId); }
        return;
      }
      if (where === 'hand') {
        const hand = this.hands.get(client.sessionId) || [];
        hand.push({ hid: 'h' + (this.nextHid++), front, back });
        this.hands.set(client.sessionId, hand); this.sendHand(client);
      } else { // 'field-up' (public front) or 'field-down' (front stays private in cardData)
        const faceDown = where === 'field-down';
        const db = this.bodies.get(deckId); // drop it just beside the deck it came from
        const pos = db ? [db.position.x + 1.7 + Math.random() * 0.4, 2.5, db.position.z + (Math.random() - 0.5) * 0.6] : rnd();
        const id = this.spawn('card', pos, faceDown ? { back } : { front, back });
        const b = this.bodies.get(id); b.quaternion.set(0, 0, 0, 1); this.writeTransform(this.state.pieces.get(id), b); // lie flat
        if (faceDown) this.cardData.set(id, { front });
      }
      const cards = this.deckCards.get(deckId); // the card left the deck for good — drop an empty deck
      if (cards && cards.length === 0) this.removePiece(deckId);
    });
    this.onMessage('shuffle', (client, { deckId }) => {
      const cards = this.deckCards.get(deckId); if (cards) shuffle(cards);
    });
    // Decks are built in chunks so no single message is large (text lists can be
    // hundreds of cards): deckBegin -> deckAppend (batches) -> deckFinish.
    this.onMessage('deckBegin', (client, m) => {
      this.drafts.set(client.sessionId, { back: (m && deckRefOk(m.back)) ? m.back : 'back', cards: [] });
    });
    this.onMessage('deckAppend', (client, m) => {
      const d = this.drafts.get(client.sessionId); if (!d || !m || !Array.isArray(m.fronts)) return;
      for (const f of m.fronts) if (deckRefOk(f) && d.cards.length < 1000) d.cards.push(f);
    });
    this.onMessage('deckFinish', (client, m) => {
      const d = this.drafts.get(client.sessionId); this.drafts.delete(client.sessionId);
      if (!d || !d.cards.length) return;
      const id = this.spawn('deck', rnd(), { back: d.back, cards: d.cards });
      if (m && m.name && this.saveDeckById(id, m.name)) client.send('deckList', listSavedDecks()); // save-on-create
    });
    this.onMessage('saveDeck', (client, m) => { // persist a table deck to the shared disk library
      if (this.saveDeckById(m && m.deckId, m && m.name)) client.send('deckList', listSavedDecks());
    });
    this.onMessage('listDecks', (client) => client.send('deckList', listSavedDecks()));
    this.onMessage('loadDeck', (client, m) => { // spawn a deck from the library (refs are URLs/text)
      const file = metaFile('decks', slugify(m && m.slug));
      try { if (fs.existsSync(file)) { const d = JSON.parse(fs.readFileSync(file)); this.spawn('deck', rnd(), { back: d.back, cards: d.fronts }); } }
      catch (e) { /* ignore */ }
    });
    this.onMessage('saveBoard', (client, m) => { // persist a board's config to the shared disk library
      const name = String((m && m.name) || '').slice(0, 60); if (!name) return;
      const slug = slugify(name); if (!slug) return;
      const b = (m && m.board) || {};
      try {
        let rec;
        if (b.board && BOARDS[b.board]) rec = { name, board: b.board };                                    // built-in
        else if (b.model) rec = { name, model: String(b.model).slice(0,300), modelScale: +b.modelScale || 1, box: Array.isArray(b.box) ? b.box.map(v=>+v) : undefined }; // uploaded .glb
        else rec = { name, w: b.w, d: b.d, tex: b.tex || null };                                           // procedural
        fs.writeFileSync(metaFile('boards', slug), JSON.stringify(rec));
        client.send('boardList', listSavedBoards());
      } catch (e) { /* disk error — ignore */ }
    });
    this.onMessage('listBoards', (client) => client.send('boardList', listSavedBoards()));
    this.onMessage('saveProp', (client, m) => { // persist a custom-model prop for one-click re-spawn
      const name = String((m && m.name) || '').slice(0, 60); if (!name) return;
      const slug = slugify(name); if (!slug) return;
      const p = (m && m.props) || {}; if (!p.model) return; // only model props are saveable
      try {
        const props = { model: String(p.model).slice(0, 300), box: Array.isArray(p.box) ? p.box.map(v => +v) : undefined, stand: !!p.stand, scale: +p.scale || 1 };
        if (p.color != null) props.color = p.color | 0;
        fs.writeFileSync(metaFile('props', slug), JSON.stringify({ name, props }));
        client.send('propList', listSavedProps());
      } catch (e) { /* disk error — ignore */ }
    });
    this.onMessage('listProps', (client) => client.send('propList', listSavedProps()));
    this.onMessage('editDeck', (client, m) => { // shallow edit: swap back and/or append cards; overwrite or save-as-copy
      const slug = slugify(m && m.slug); if (!slug) return;
      try {
        const file = metaFile('decks', slug); if (!fs.existsSync(file)) return;
        const d = JSON.parse(fs.readFileSync(file));
        if (m.back && deckRefOk(m.back)) d.back = m.back;
        if (Array.isArray(m.addFronts)) for (const fr of m.addFronts) if (deckRefOk(fr) && d.fronts.length < 1000) d.fronts.push(fr);
        const targetName = String(m.name || d.name).slice(0, 60);
        const targetSlug = m.saveAs ? slugify(targetName) : slug; if (!targetSlug) return;
        fs.writeFileSync(metaFile('decks', targetSlug), JSON.stringify({ name: targetName, back: d.back, fronts: d.fronts }));
        client.send('deckList', listSavedDecks());
      } catch (e) { /* disk error — ignore */ }
    });
    this.onMessage('loadBoard', (client, m) => { // load a saved board (swaps the current one, centers it)
      const file = metaFile('boards', slugify(m && m.slug));
      try { if (fs.existsSync(file)) { const d = JSON.parse(fs.readFileSync(file));
        const olds = []; this.state.pieces.forEach((p, id) => { if (p.type === 'board') olds.push(id); }); olds.forEach(id => this.removePiece(id));
        const props = d.board ? { board: d.board } : d.model ? { model: d.model, modelScale: d.modelScale, box: d.box } : { w: d.w, d: d.d, tex: d.tex || undefined };
        const bd = props.board && BOARDS[props.board];
        const box = bd ? bd.box : (props.model && Array.isArray(props.box) ? props.box : null);
        this.spawn('board', [0, box ? box[1] : 0.05, 0], props); } }
      catch (e) { /* ignore */ }
    });
    this.onMessage('playCard', (client, { hid, faceDown, x, z }) => { // hand -> table (face-down = hidden until revealed)
      const hand = this.hands.get(client.sessionId); if (!hand) return;
      const i = hand.findIndex(c => c.hid === hid); if (i < 0) return;
      const [c] = hand.splice(i, 1);
      const pos = (typeof x === 'number' && typeof z === 'number') ? [x, 3, z] : [(Math.random() - 0.5) * 4, 3, (Math.random() - 0.5) * 3];
      const id = this.spawn('card', pos, faceDown ? { back: c.back } : { front: c.front, back: c.back });
      const b = this.bodies.get(id); b.quaternion.set(0, 0, 0, 1); this.writeTransform(this.state.pieces.get(id), b); // flat
      if (faceDown) this.cardData.set(id, { front: c.front }); // front stays private until someone flips it
      this.sendHand(client);
    });
    this.onMessage('spawn', (client, m) => {
      if (this.state.pieces.size >= SIM.maxPieces) return;
      if (m.type === 'board') { // one board at a time; new board swaps the old and centers
        const olds = []; this.state.pieces.forEach((p, id) => { if (p.type === 'board') olds.push(id); });
        olds.forEach(id => this.removePiece(id));
        const props = m.props || {}, bd = props.board && BOARDS[props.board];
        const box = bd ? bd.box : ((props.model && Array.isArray(props.box)) ? props.box : null);
        this.spawn('board', [0, box ? box[1] : 0.05, 0], props); // sit on the table by half-height
      } else this.spawn(m.type, rnd(), m.props || {});
    });
    this.onMessage('roll', () => {
      this.state.pieces.forEach((p, id) => {
        if (p.type !== 'die') return;
        const b = this.bodies.get(id); b.wakeUp();
        const r = SIM.roll;
        b.velocity.set((Math.random() - 0.5) * r.spread, r.up, (Math.random() - 0.5) * r.spread);
        b.angularVelocity.set((Math.random() - 0.5) * r.spin, (Math.random() - 0.5) * r.spin, (Math.random() - 0.5) * r.spin);
      });
    });
    this.onMessage('reset', () => { // wipe the whole room to an empty table
      const doomed = [];
      this.state.pieces.forEach((p, id) => doomed.push(id));            // every piece, boards included
      for (const id of doomed) this.removePiece(id);
      this.hands.clear(); this.pendingInspect.clear(); this.drafts.clear(); // private state not tied to a piece
      this.deckCards.clear(); this.cardData.clear(); this.flips.clear(); this.targets.clear();
      for (const c of this.clients) this.sendHand(c);                   // empty every player's hidden hand
    });
    this.onMessage('setStand', (client, { id }) => { // toggle a piece's keep-upright/flat behaviour
      const p = this.state.pieces.get(id); if (!p) return;
      const pr = JSON.parse(p.props || '{}');
      pr.stand = this.standOf(p) ? false : this.naturalStand(p); // on -> off, or off -> its natural mode
      p.props = JSON.stringify(pr);
      const b = this.bodies.get(id); if (b) b.wakeUp();
    });
    this.onMessage('snap', (client, { id }) => { // snap a held piece's facing to the nearest 90° (and upright)
      const p = this.state.pieces.get(id); if (!p || p.owner !== client.sessionId) return;
      const b = this.bodies.get(id); if (!b) return;
      const fwd = new CANNON.Vec3(0, 0, 1), wf = new CANNON.Vec3(); b.quaternion.vmult(fwd, wf);
      const yaw = Math.round(Math.atan2(wf.x, wf.z) / (Math.PI / 2)) * (Math.PI / 2);
      b.quaternion.set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)); // pure yaw = flat + cardinal
      b.angularVelocity.setZero(); b.wakeUp();
    });
    this.onMessage('nextTurn', () => this.advanceTurn());
    this.onMessage('remove', (client, { id }) => { if (this.state.pieces.has(id)) this.removePiece(id); });
    this.onMessage('setName', (client, { name }) => {
      const pl = this.state.players.get(client.sessionId);
      if (pl && typeof name === 'string') pl.name = name.trim().slice(0, 20) || pl.name;
    });
    this.onMessage('setAvatar', (client, { data }) => {
      const pl = this.state.players.get(client.sessionId);
      if (pl && typeof data === 'string' && data.startsWith('data:image') && data.length < 60000) pl.avatar = data;
    });

    this.setSimulationInterval((dt) => this.update(dt), 1000 / 60); // fixed 60Hz sim
    this.setPatchRate(1000 / 60); // 60Hz state broadcast (delta-compressed; cheap on LAN)
  }

  spawn(type, pos, props = {}) {
    const mass = type === 'prop' ? (PROPS[props.shape] || PROPS.box).mass : KINDS[type].mass;
    const body = new CANNON.Body({ mass, material: this.mat });
    body.addShape(buildCollider(type, props));
    body.position.set(pos[0], pos[1], pos[2]);
    if (KINDS[type].mass > 0 && type !== 'deck') body.quaternion.setFromEuler(Math.random() * 6, Math.random() * 6, Math.random() * 6); // board & deck stay flat
    if (type === 'card') { body.angularDamping = SIM.cards.angDamp; body.linearDamping = SIM.cards.linDamp; body.sleepSpeedLimit = SIM.cards.sleepSpeed; body.sleepTimeLimit = SIM.cards.sleepTime; }
    else body.angularDamping = (type === 'deck') ? SIM.damp.flat : SIM.damp.solid;
    this.world.addBody(body);

    const id = String(this.nextId++);
    const p = new Piece();
    p.type = type; p.owner = ''; p.count = 0; p.props = '{}';
    if (type === 'deck') {
      const def = (props.cards && props.cards.length) ? { back: props.back || 'back', cards: props.cards } : buildDeck();
      this.deckCards.set(id, def.cards.slice()); // PRIVATE — the fronts/order never enter synced state
      p.count = def.cards.length;
      p.props = JSON.stringify({ back: def.back }); // PUBLIC — only the shared back, so clients render the deck
    } else {
      p.props = JSON.stringify(props);
    }
    this.writeTransform(p, body);
    this.state.pieces.set(id, p);
    this.bodies.set(id, body);
    if (type === 'deck') this.updateDeckCollider(id); // solid body matches the visible stack height
    return id;
  }

  updateDeckCollider(deckId) { // rebuild the deck's box to match its card count
    const b = this.bodies.get(deckId), p = this.state.pieces.get(deckId);
    if (!b || !p) return;
    while (b.shapes.length) b.removeShape(b.shapes[0]);
    const dbox = KINDS.deck.shape.box; b.addShape(new CANNON.Box(new CANNON.Vec3(dbox[0], deckHeight(p.count) / 2, dbox[2])));
    b.updateBoundingRadius(); b.updateMassProperties(); b.wakeUp();
  }

  saveDeckById(deckId, name) { // write a table deck to the disk library; returns true on success
    const fronts = this.deckCards.get(deckId), p = this.state.pieces.get(deckId);
    if (!fronts || !fronts.length || !p || p.type !== 'deck') return false;
    const slug = slugify(name); if (!slug) return false;
    try {
      let back = JSON.parse(p.props || '{}').back || 'back';
      if (isDataURL(back)) back = saveImageRef(back, 'decks') || 'back';          // images -> files + URL refs
      const saved = fronts.map(f => isDataURL(f) ? (saveImageRef(f, 'decks') || f) : f);
      fs.writeFileSync(metaFile('decks', slug), JSON.stringify({ name: String(name).slice(0, 60), back, fronts: saved }));
      return true;
    } catch (e) { return false; }
  }
  standOf(p) { // effective self-right mode: true (stand tall) | 'flat' (lie flat) | falsy (off)
    const pr = JSON.parse(p.props || '{}');
    if (pr.stand !== undefined) return pr.stand;                 // per-instance override (set by the toggle)
    if (p.type === 'deck') return 'flat';                        // a deck sits flat by default
    return (PROPS[pr.shape] || {}).stand;                        // else the prop shape's default
  }
  naturalStand(p) { // which mode to enable when the toggle turns self-right ON
    if (p.type === 'deck') return 'flat';
    const pr = JSON.parse(p.props || '{}'), def = PROPS[pr.shape] || {};
    if (def.stand) return def.stand;
    const box = def.collider && def.collider.box;                // no default: flat if the collider is thin on Y
    return (box && box[1] <= box[0] && box[1] <= box[2]) ? 'flat' : true;
  }
  removePiece(id) {
    const b = this.bodies.get(id); if (b) this.world.removeBody(b);
    this.bodies.delete(id); this.targets.delete(id); this.flips.delete(id);
    this.deckCards.delete(id); this.cardData.delete(id); this.state.pieces.delete(id);
  }

  sendHand(client) {
    const h = this.hands.get(client.sessionId) || [];
    const pl = this.state.players.get(client.sessionId);
    if (pl) pl.hand = h.length;              // public count (not contents) so others can render your fan
    client.send('hand', h);                  // private contents, to you only
  }
  onJoin(client) {
    const used = new Set(); this.state.players.forEach(p => used.add(p.seat));
    let seat = 0; while (used.has(seat)) seat++;               // lowest free seat
    const pl = new Player();
    pl.seat = seat; pl.hand = 0; pl.name = 'Player ' + (seat + 1); pl.color = PALETTE[seat % PALETTE.length];
    this.state.players.set(client.sessionId, pl);
    if (!this.state.turn) this.state.turn = client.sessionId;  // first player starts
    this.sendHand(client);
  }
  advanceTurn() {
    const order = [];
    this.state.players.forEach((p, sid) => order.push([sid, p.seat]));
    order.sort((a, b) => a[1] - b[1]);
    if (!order.length) { this.state.turn = ''; return; }
    const ids = order.map(o => o[0]);
    this.state.turn = ids[(ids.indexOf(this.state.turn) + 1) % ids.length]; // -1 wraps to first
  }

  writeTransform(p, b) {
    p.x = b.position.x; p.y = b.position.y; p.z = b.position.z;
    p.qx = b.quaternion.x; p.qy = b.quaternion.y; p.qz = b.quaternion.z; p.qw = b.quaternion.w;
  }

  update(dtMs) {
    const dt = dtMs / 1000, K = SIM.servo.stiffness, MAX = SIM.servo.maxSpeed;
    // Servo held pieces toward their owner's drag target (stiff = tracks the cursor tightly)
    this.state.pieces.forEach((p, id) => {
      if (!p.owner) return;
      const t = this.targets.get(id), b = this.bodies.get(id);
      if (!t || !b) return;
      b.wakeUp();
      let vx = (t.x - b.position.x) * K, vy = (t.y - b.position.y) * K, vz = (t.z - b.position.z) * K;
      const L = Math.hypot(vx, vy, vz); if (L > MAX) { const s = MAX / L; vx *= s; vy *= s; vz *= s; }
      b.velocity.set(vx, vy, vz);
      b.angularVelocity.scale(SIM.servo.angDamp, b.angularVelocity);
      const sm = this.standOf(p);                                  // held: keep upright/flat (yaw only)
      if (sm) { const q = b.quaternion, m = Math.hypot(q.w, q.y) || 1; q.set(0, q.y / m, 0, q.w / m); b.angularVelocity.setZero(); }
    });

    // Self-righting (not held): tall pieces stand, flat pieces (decks, checkers,
    // coins…) lie flat. Same "local +Y → world-up" nudge; flat pieces right from
    // any tilt, tall pieces only when near-upright (a toppled one stays down).
    const R = SIM.propRight, wup = new CANNON.Vec3(0, 1, 0), up = new CANNON.Vec3(), axis = new CANNON.Vec3();
    this.state.pieces.forEach((p, id) => {
      if (p.owner) return;
      const sm = this.standOf(p); if (!sm) return;
      const b = this.bodies.get(id); if (!b || b.sleepState === CANNON.Body.SLEEPING) return;
      b.quaternion.vmult(wup, up);          // the piece's own up-axis, in world space
      up.cross(wup, axis);                  // axis to rotate it back toward world-up
      const tilt = axis.length();           // = sin(tilt angle)
      const cutoff = sm === 'flat' ? 1.5 : R.maxTilt; // flat: always; tall: near-upright only
      if (tilt > 0.02 && tilt < cutoff) {
        axis.scale(1 / tilt, axis);
        b.angularVelocity.x += axis.x * tilt * R.strength;
        b.angularVelocity.y += axis.y * tilt * R.strength;
        b.angularVelocity.z += axis.z * tilt * R.strength;
        b.angularVelocity.scale(R.damp, b.angularVelocity);
        b.wakeUp();
      }
    });
    // Advance any scripted card flips (kinematic slerp of a half-turn + a little arc)
    for (const [id, f] of this.flips) {
      const b = this.bodies.get(id); if (!b) { this.flips.delete(id); continue; }
      f.t += dt;
      const frac = Math.min(f.t / f.dur, 1);
      f.start.slerp(f.end, frac, b.quaternion);
      b.position.y = f.baseY + Math.sin(frac * Math.PI) * SIM.flipArc;
      if (frac >= 1) { b.type = CANNON.Body.DYNAMIC; b.wakeUp(); b.velocity.setZero(); b.angularVelocity.setZero(); this.flips.delete(id); }
    }

    this.world.step(SIM.step.fixed, dt, SIM.step.maxSub);

    // Safety net: anything that still escapes the play area gets dropped back
    // onto the table (catches rare tunneling/overshoot the walls miss).
    const OX = TABLE.x + SIM.bounds.margin, OZ = TABLE.z + SIM.bounds.margin;
    this.bodies.forEach((b) => {
      const p = b.position;
      if (p.y < SIM.bounds.floor || p.y > SIM.bounds.ceiling || Math.abs(p.x) > OX || Math.abs(p.z) > OZ) {
        p.set(Math.max(-TABLE.x + 1, Math.min(TABLE.x - 1, p.x)), 3, Math.max(-TABLE.z + 1, Math.min(TABLE.z - 1, p.z)));
        b.velocity.setZero(); b.angularVelocity.setZero(); b.wakeUp();
      }
    });

    // Publish transforms. Colyseus only ships fields that actually changed,
    // so sleeping (resting) pieces cost zero bandwidth.
    this.state.pieces.forEach((p, id) => {
      const b = this.bodies.get(id); if (b) this.writeTransform(p, b);
    });
  }

  async onLeave(client, arg) {
    // free any piece they were dragging immediately (don't leave it stuck mid-air)
    this.state.pieces.forEach((p, id) => { if (p.owner === client.sessionId) { p.owner = ''; this.targets.delete(id); } });
    const consented = arg === true || arg === 4000; // boolean (older) or CloseCode.CONSENTED
    if (!consented) {
      try { await this.allowReconnection(client, 30); return; } catch (e) { /* didn't return in time */ }
    }
    this.hands.delete(client.sessionId); // gone for good
    const pend = this.pendingInspect.get(client.sessionId); // return an un-placed drawn card to its deck
    if (pend) { const cards = this.deckCards.get(pend.deckId); if (cards) { cards.push(pend.front); const dp = this.state.pieces.get(pend.deckId); if (dp) dp.count = cards.length; this.updateDeckCollider(pend.deckId); } this.pendingInspect.delete(client.sessionId); }
    const wasTurn = this.state.turn === client.sessionId;
    this.state.players.delete(client.sessionId);
    if (wasTurn) this.advanceTurn();
  }
  onReconnect(client) { this.sendHand(client); } // resend their private hand (it isn't in shared state)
}

// --- Boot: Colyseus + Express (serves the client on the same port) ----------
const app = express();
// Security headers (clickjacking, HSTS, nosniff, referrer, hide X-Powered-By, …).
// CSP is left OFF for now: the client pulls Three.js/Colyseus from CDNs (esm.sh,
// unpkg) and uses an inline import map, which a default CSP would block. To turn
// CSP on, self-host those libs (or allowlist the CDNs) and test in a browser —
// draft directives below.
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
app.use('/assets', (req, res, next) => { if (/\.json$/i.test(req.path)) return res.sendStatus(404); next(); }, express.static(ASSETS_DIR)); // images only; .json metadata is never served

// Image upload: one resized image per request (avoids the WebSocket payload limit).
// Writes to a shared uploads folder with a random name; returns its URL ref.
app.post('/upload', express.raw({ type: 'image/*', limit: '16mb' }), (req, res) => {
  try {
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'empty' });
    const ext = ((req.headers['content-type'] || '').split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg';
    res.json({ url: saveAsset(req.query.kind, req.body, ext) }); // ?kind=uploads|decks|boards|props
  } catch (e) { res.status(500).json({ error: 'save failed' }); }
});

// Model upload: a raw .glb (any content-type). Saved into the props/ category.
app.post('/upload-model', express.raw({ type: () => true, limit: '16mb' }), (req, res) => {
  try {
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'empty' });
    res.json({ url: saveAsset(req.query.kind || 'props', req.body, 'glb') });
  } catch (e) { res.status(500).json({ error: 'save failed' }); }
});

const httpServer = createServer(app);
const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer, maxPayload: 4 * 1024 * 1024 }) });
gameServer.define('table', TableRoom);

const PORT = process.env.PORT || 2567;
gameServer.listen(PORT).then(() => console.log(`\n  Tabletop running →  http://localhost:${PORT}\n`));