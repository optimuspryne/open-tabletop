import { createDrawingView } from '../public/table/drawing-view.js';
import { parkHand, claimHand } from '../server/game/hand-state.js';
import { registerPlacementHandlers } from '../server/game/handlers/placement.js';
import { registerCardHandlers } from '../server/game/handlers/cards.js';
import { registerRoomFeatureHandlers } from '../server/game/handlers/room-features.js';
import { stopPlayerInteraction } from '../server/game/interaction-cleanup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as CANNON from 'cannon-es';
import { NOTECARD, normalizeNotecardDrawing } from '../shared/notecards.js';
import { colliderSpec } from '../shared/collider-spec.js';
import { createNotecards, registerNotecardHandlers } from '../server/game/notecards.js';
import { registerMovementHandlers } from '../server/game/handlers/movement.js';
import { createPieceLifecycle } from '../server/game/piece-lifecycle.js';
import {
  serializeScene,
  serializeGame,
  applyScene,
  clearGameTable,
} from '../server/game/scene-persistence.js';
import { writeTransform, unpinPiece } from '../server/game/placement-operations.js';
import { readProps } from '../server/game/props-codec.js';
import { guardedMessage } from '../server/game/interaction-policy.js';
import { spawnPayload } from '../server/message-validation.js';

const artwork = [{ pts: [0.1, 0.2, 0.4, 0.8], color: '#202830', width: 0.007, erase: false }];
function harness() {
  let time = 0,
    serial = 0;
  const handlers = new Map();
  const client = (sessionId, auth = {}) => ({
    sessionId,
    auth,
    sent: [],
    send(type, payload) {
      this.sent.push({ type, payload: structuredClone(payload) });
    },
  });
  const alice = client('alice'),
    bob = client('bob');
  const lifecycle = createPieceLifecycle({
    deckBuilders: {},
    dropSfx: () => 'tile-drop',
    geoOf: () => ({}),
    sim: {
      maxPieces: 250,
      cards: { colliderThick: 0.04, angDamp: 0.7, linDamp: 0.25, sleepSpeed: 0.5, sleepTime: 0.2 },
      damp: { flat: 0.5, solid: 0.15 },
      impact: { minVel: 1 },
    },
  });
  const room = {
    clients: [alice, bob],
    nextId: 1,
    nextHid: 1,
    handOwners: new Map([['alice', 'account-a']]),
    clientBy(sid) {
      return this.clients.find((client) => client.sessionId === sid);
    },
    spawnHandCard(pos, card, faceDown) {
      return this.notecards.placeHandCard(pos, card, faceDown);
    },
    notifyFull(client) {
      client.send('full', {});
    },
    world: new CANNON.World(),
    mat: new CANNON.Material(),
    state: {
      lighting: {},
      pieces: new Map(),
      players: new Map([
        ['alice', { name: 'Alice' }],
        ['bob', { name: 'Bob' }],
      ]),
      overlays: new Map(),
      trays: new Map(),
      unclaimed: new Map(),
      tableX: 20,
      tableZ: 20,
      tableShape: 'rect',
      whiteboard: { owner: '' },
    },
    onMessage: (type, fn) => handlers.set(type, fn),
    writeTransform,
    broadcast() {},
    scheduleSave() {},
    sendHand(client) {
      client.send('hand', this.hands.get(client.sessionId) || []);
    },
    stopShow(sid) {
      const showing = this.shows.get(sid);
      if (!showing) return;
      for (const viewer of showing.to) this.clientBy(viewer)?.send('showFan', { sid, cards: [] });
      this.shows.delete(sid);
    },
    unpinPiece(id) {
      unpinPiece(this, id);
    },
    spawn(type, position, props, quat) {
      return lifecycle.spawn(this, type, position, props, quat);
    },
    removePiece(id) {
      lifecycle.removePiece(this, id);
    },
    scaleSnapshot: () => ({}),
    buildBounds() {},
    applyScale() {},
    applyTrays() {},
    clearTable() {
      clearGameTable(this);
    },
  };
  for (const name of [
    'bodies',
    'targets',
    'flips',
    'deckCards',
    'cardData',
    '_released',
    'pendingInspect',
    'pendingHands',
    'hands',
    'drafts',
    'groups',
    'lastDrop',
    'shows',
  ])
    room[name] = new Map();
  room.notecards = createNotecards(room, { now: () => time, token: () => String(++serial) });
  registerNotecardHandlers(room);
  registerPlacementHandlers(room, { dropSfx: () => 'tile-drop' });
  registerCardHandlers(room, { geoOf: () => ({}) });
  registerRoomFeatureHandlers(room, {});
  registerMovementHandlers(room, { isMovable: () => true });
  guardedMessage(room, 'remove', (_client, { id }) => room.removePiece(id));
  const id = room.spawn('notecard', [0, 1, 0], { drawing: artwork, faceDown: true });
  const send = (type, payload, actor = alice) => handlers.get(type)(actor, payload);
  const claim = (actor = alice) => {
    send('notecardEdit', { id }, actor);
    return actor.sent.at(-1).payload;
  };
  return {
    room,
    id,
    alice,
    bob,
    send,
    claim,
    advance: () => {
      time += NOTECARD.leaseMs + 1;
      room.notecards.sweep();
    },
  };
}

test('notecard validation bounds total artwork and rejects arbitrary properties, colors and coordinates', () => {
  assert.deepEqual(normalizeNotecardDrawing(artwork), artwork);
  assert.deepEqual(normalizeNotecardDrawing([]), []);
  for (const extra of [
    { pts: [NaN, 0] },
    { pts: [0, 2] },
    { pts: [0] },
    { color: 'url(secret)' },
    { width: 1 },
    { erase: 'false' },
    { secret: true },
  ])
    assert.equal(normalizeNotecardDrawing([{ ...artwork[0], ...extra }]), null);
  assert.equal(normalizeNotecardDrawing(Array(NOTECARD.maxStrokes + 1).fill(artwork[0])), null);
  assert.equal(
    normalizeNotecardDrawing(Array(9).fill({ ...artwork[0], pts: Array(1024).fill(0.5) })),
    null,
  );
  assert.deepEqual(spawnPayload({ type: 'notecard', props: {} }), { type: 'notecard', props: {} });
  assert.equal(spawnPayload({ type: 'notecard', props: { drawing: artwork } }), null);
});

test('physical notecards share their collider dimensions and are heavier than cards', () => {
  const { room, id } = harness();
  assert.equal(room.bodies.get(id).mass, NOTECARD.mass);
  assert.deepEqual(colliderSpec('notecard'), { type: 'box', halfExtents: [2.25, 0.05, 1.5] });
  assert.deepEqual(room.bodies.get(id).quaternion.toArray(), [0, 0, 0, 1]);
});

test('private edit goes only to its owner, conceals public artwork, and reserves all movement', () => {
  const { room, id, alice, bob, claim, send } = harness();
  room.notecards.flip(id);
  assert.deepEqual(readProps(room.state.pieces.get(id)).drawing, artwork);
  const lease = claim();
  const props = readProps(room.state.pieces.get(id));
  assert.equal(props.drawing, undefined);
  assert.equal(props.editingName, 'Alice');
  assert.equal(props.faceDown, true);
  assert.deepEqual(lease.drawing, artwork);
  assert.equal(bob.sent.length, 0);
  send('grab', { id }, bob);
  send('grabGroup', { ids: [id], anchor: id }, alice);
  send('remove', { id }, alice);
  send('notecardFlip', { id }, bob);
  assert.equal(room.state.pieces.get(id).owner, '');
  assert.equal(room.bodies.get(id).type, CANNON.Body.STATIC);
  send('notecardEdit', { id }, bob);
  assert.equal(bob.sent.at(-1).type, 'serverError');
  assert.equal(
    bob.sent.some((e) => e.type === 'notecardEdit'),
    false,
  );
  send('notecardCancel', { id, token: lease.token });
  assert.deepEqual(readProps(room.state.pieces.get(id)).drawing, artwork);
  assert.equal(room.bodies.get(id).type, CANNON.Body.DYNAMIC);
});

test('commits require current owner token and gameplay access, preserve drafts on validation failure', () => {
  const { room, id, alice, bob, claim, send } = harness();
  const lease = claim();
  const payload = { id, token: lease.token, drawing: [], faceDown: false };
  send('notecardCommit', payload, bob);
  send('notecardCommit', { ...payload, token: 'stale' });
  send('notecardCommit', { ...payload, drawing: [{}] });
  assert.equal(room.notecards.isEditing(id), true);
  assert.deepEqual(room.notecards.snapshot(id).drawing, artwork);
  alice.auth.timedOut = true;
  send('notecardCommit', payload);
  assert.deepEqual(room.notecards.snapshot(id).drawing, artwork);
  alice.auth.timedOut = false;
  send('notecardCommit', payload);
  assert.equal(room.notecards.isEditing(id), false);
  assert.deepEqual(readProps(room.state.pieces.get(id)).drawing, []);
  send('notecardCommit', { ...payload, drawing: artwork });
  assert.deepEqual(room.notecards.snapshot(id).drawing, []);
});

test('face-down commits never publish artwork, and flip reveals only the committed drawing', () => {
  const { room, id, claim, send } = harness();
  const lease = claim();
  send('notecardCommit', { id, token: lease.token, drawing: artwork, faceDown: true });
  assert.equal(readProps(room.state.pieces.get(id)).drawing, undefined);
  send('notecardFlip', { id });
  assert.deepEqual(readProps(room.state.pieces.get(id)).drawing, artwork);
  send('notecardFlip', { id });
  assert.equal(readProps(room.state.pieces.get(id)).drawing, undefined);
});

test('spectators cannot request private artwork; cancellation still works after time-out', () => {
  const { room, id, alice, claim, send } = harness();
  alice.auth.participation = 'spectator';
  send('notecardEdit', { id });
  assert.equal(
    alice.sent.some((e) => e.type === 'notecardEdit'),
    false,
  );
  alice.auth.participation = 'player';
  const lease = claim();
  alice.auth.timedOut = true;
  send('notecardCancel', { id, token: lease.token });
  assert.equal(room.notecards.isEditing(id), false);
});

test('disconnect cleanup and expired leases restore committed contents and reject delayed commits', () => {
  const { room, id, alice, claim, send, advance } = harness();
  const lease = claim();
  stopPlayerInteraction(room, alice.sessionId);
  claim();
  advance();
  assert.equal(room.notecards.isEditing(id), false);
  send('notecardCommit', { id, token: lease.token, drawing: [], faceDown: false });
  assert.deepEqual(room.notecards.snapshot(id), { drawing: artwork, faceDown: true });
});

test('scene round-trip retains concealed contents and committed orientation during private editing', () => {
  const { room, id, claim } = harness();
  claim();
  const scene = serializeScene(room);
  assert.deepEqual(scene.pieces[0].props.drawing, artwork);
  assert.equal(scene.pieces[0].props.faceDown, true);
  assert.equal(scene.pieces[0].props.editing, undefined);
  applyScene(room, scene, {
    maxPieces: 250,
    tableLimits: { minX: 5, maxX: 40, minZ: 5, maxZ: 40 },
    overlayMax: 50,
    overlayKinds: new Set(),
  });
  const restoredId = [...room.state.pieces.keys()][0];
  assert.notEqual(restoredId, id);
  assert.deepEqual(room.notecards.snapshot(restoredId), { drawing: artwork, faceDown: true });
  assert.equal(readProps(room.state.pieces.get(restoredId)).drawing, undefined);
  room.notecards.flip(restoredId);
  assert.deepEqual(readProps(room.state.pieces.get(restoredId)).drawing, artwork);
  room.removePiece(restoredId);
  assert.equal(room.notecards.snapshot(restoredId), undefined);
});

test('notecard capacity and malformed restore fail before allocating physical pieces', () => {
  const { room } = harness();
  assert.throws(() => room.spawn('notecard', [0, 1, 0], { drawing: [{}] }), /Invalid/);
  for (let i = 1; i < NOTECARD.maxCards; i++) room.spawn('notecard', [0, 1, 0], {});
  const count = room.world.bodies.length;
  assert.throws(() => room.spawn('notecard', [0, 1, 0], {}), /limit/);
  assert.equal(room.world.bodies.length, count);
  room.clearTable();
  assert.equal(room.notecards.hasCapacity(), true);
});

test('invalid notecard scenes preserve the live table instead of partially replacing it', () => {
  const { room, id } = harness();
  assert.throws(
    () => applyScene(room, { pieces: [{ type: 'notecard', props: { drawing: [{}] } }] }, {}),
    /invalid/,
  );
  assert.equal(room.state.pieces.has(id), true);
  assert.deepEqual(room.notecards.snapshot(id).drawing, artwork);
});

test('saving mid-edit preserves the original public face, and keepalive only renews the owner lease', () => {
  const { room, id, bob, claim, send, advance } = harness();
  room.notecards.flip(id);
  const lease = claim();
  const scene = serializeScene(room);
  assert.equal(scene.pieces[0].props.faceDown, false);
  assert.equal(scene.pieces[0].props.editingName, undefined);
  send('notecardKeepAlive', { id, token: lease.token }, bob);
  advance();
  assert.equal(room.notecards.isEditing(id), false);
  assert.deepEqual(readProps(room.state.pieces.get(id)).drawing, artwork);
});

test('drawing zoom anchors the paper under the pointer, pans within bounds and resets without changing ink', () => {
  const view = createDrawingView();
  view.transform([0.25, 0.75], [0.25, 0.75], 2);
  assert.deepEqual(view.point(0.25, 0.75), [0.25, 0.75]);
  view.transform([0.25, 0.75], [0.35, 0.65]);
  const actual = view.point(0.35, 0.65);
  assert.ok(Math.abs(actual[0] - 0.25) < 1e-9 && Math.abs(actual[1] - 0.75) < 1e-9);
  view.transform([0.5, 0.5], [50, -50], 100);
  assert.equal(view.scale, 8);
  assert.equal(view.x, 0);
  assert.equal(view.y, -7);
  view.reset();
  assert.deepEqual(view.point(0.3, 0.7), [0.3, 0.7]);
});

test('keep in hand removes the table piece, sends art only to owner and forbids another player editing it', () => {
  const { room, id, alice, bob, claim, send } = harness();
  const lease = claim();
  send('notecardCommit', { ...lease, drawing: artwork, destination: 'hand' });
  assert.equal(room.state.pieces.has(id), false);
  const card = room.hands.get('alice')[0];
  assert.equal(card.kind, 'notecard');
  assert.deepEqual(card.drawing, artwork);
  assert.equal(bob.sent.length, 0);
  send('notecardEdit', { hid: card.hid }, bob);
  assert.equal(bob.sent.length, 0);
  send('notecardEdit', { hid: card.hid });
  const edit = alice.sent.at(-1).payload;
  send('playCard', { hid: card.hid, faceDown: false });
  send('handToTable', { faceDown: false });
  send('showStart', { hids: 'all', to: 'all' });
  assert.equal(room.hands.get('alice').length, 1);
  assert.equal(room.state.pieces.size, 0);
  assert.equal(bob.sent.length, 0);
  send('notecardCommit', { ...edit, drawing: [], destination: 'hand' });
  assert.deepEqual(room.hands.get('alice')[0].drawing, []);
});

test('passing validates live recipients, preserves rejected drafts and delivers only to the selected hand', () => {
  const { room, id, alice, bob, claim, send } = harness();
  const lease = claim();
  const message = { ...lease, drawing: [], destination: 'pass', recipient: 'bob' };
  bob.auth.participation = 'spectator';
  send('notecardCommit', message);
  assert.equal(room.state.pieces.has(id), true);
  assert.deepEqual(room.notecards.snapshot(id).drawing, artwork);
  assert.equal(room.notecards.isEditing(id), true);
  assert.equal(alice.sent.at(-1).type, 'serverError');
  bob.auth.participation = 'player';
  send('notecardCommit', message);
  assert.equal(room.state.pieces.size, 0);
  assert.deepEqual(room.hands.get('bob')[0].drawing, []);
  assert.equal(bob.sent.at(-1).type, 'hand');
  send('notecardEdit', { hid: room.hands.get('bob')[0].hid }, bob);
  const edit = bob.sent.at(-1).payload;
  send(
    'notecardCommit',
    { ...edit, drawing: artwork, destination: 'pass', recipient: 'alice' },
    bob,
  );
  assert.equal(room.hands.get('bob').length, 0);
  assert.deepEqual(room.hands.get('alice')[0].drawing, artwork);
  assert.equal(room.notecards.isEditing(edit.id), false);
});

test('hand placement checks capacity before consuming or changing committed artwork', () => {
  const { room, id, alice, send } = harness();
  send('takeCard', { id });
  const card = room.hands.get('alice')[0];
  send('notecardEdit', { hid: card.hid });
  const lease = alice.sent.at(-1).payload;
  for (let i = 0; i < 250; i++) room.state.pieces.set('dummy' + i, {});
  send('notecardCommit', { ...lease, drawing: [], destination: 'table', faceDown: false });
  assert.deepEqual(card.drawing, artwork);
  assert.equal(room.hands.get('alice').length, 1);
  assert.equal(room.notecards.isEditing(lease.id), true);
  room.state.pieces.clear();
  send('notecardCommit', { ...lease, drawing: [], destination: 'table', faceDown: true });
  assert.equal(room.hands.get('alice').length, 0);
  const restored = [...room.state.pieces.values()][0];
  assert.equal(readProps(restored).drawing, undefined);
  assert.deepEqual(room.notecards.snapshot([...room.state.pieces.keys()][0]).drawing, []);
});

test('the room notecard cap counts active and parked hands; playing a full hand preserves every card', () => {
  const { room, id, send } = harness();
  for (let i = 1; i < NOTECARD.maxCards; i++) room.spawn('notecard', [0, 1, 0], {});
  for (const pieceId of [...room.state.pieces.keys()]) send('takeCard', { id: pieceId });
  assert.equal(room.state.pieces.size, 0);
  assert.equal(room.hands.get('alice').length, 16);
  assert.throws(() => room.spawn('notecard', [0, 1, 0], {}), /limit/);
  send('handToTable', { faceDown: true });
  assert.equal(room.state.pieces.size, 16);
  assert.equal(room.hands.get('alice').length, 0);
  assert.equal(room.state.pieces.has(id), false);
  for (const piece of room.state.pieces.values()) assert.equal(readProps(piece).drawing, undefined);
});

test('park, claim and saved-game restore retain private notecards and reject malformed hand artwork before reset', () => {
  const { room, id, alice, send } = harness();
  alice.auth.userId = 'account-a';
  send('takeCard', { id });
  parkHand(room, alice);
  assert.deepEqual(room.pendingHands.get('account-a').cards[0].drawing, artwork);
  claimHand(room, 'account-a', 'alice');
  assert.deepEqual(room.hands.get('alice')[0].drawing, artwork);
  const scene = serializeGame(room);
  assert.equal(serializeScene(room).hands, undefined);
  const oldHid = scene.hands[0].cards[0].hid;
  applyScene(room, scene, {
    maxPieces: 250,
    tableLimits: { minX: 5, maxX: 40, minZ: 5, maxZ: 40 },
    overlayMax: 50,
    overlayKinds: new Set(),
  });
  const restored = room.pendingHands.get('account-a').cards[0];
  assert.notEqual(restored.hid, oldHid);
  assert.deepEqual(restored.drawing, artwork);
  assert.equal(room.state.pieces.size, 0);
  assert.throws(
    () =>
      applyScene(
        room,
        { hands: [{ userId: 'bad', cards: [{ kind: 'notecard', drawing: [{}] }] }] },
        {},
      ),
    /invalid/,
  );
  assert.deepEqual(room.pendingHands.get('account-a').cards[0], restored);
});

test('explicit Show reveals a hand notecard only to the chosen audience and does not publish it on the table', () => {
  const { room, id, bob, send } = harness();
  send('takeCard', { id });
  send('showStart', { hids: 'all', to: ['bob'] });
  assert.deepEqual(bob.sent.at(-1), {
    type: 'showFan',
    payload: { sid: 'alice', cards: [{ kind: 'notecard', drawing: artwork }] },
  });
  assert.equal(room.state.pieces.size, 0);
});

test('editing a shown notecard retracts the reveal before returning private artwork', () => {
  const { room, id, bob, send } = harness();
  send('takeCard', { id });
  send('showStart', { hids: 'all', to: ['bob'] });
  send('notecardEdit', { hid: room.hands.get('alice')[0].hid });
  assert.deepEqual(bob.sent.at(-1), { type: 'showFan', payload: { sid: 'alice', cards: [] } });
  assert.equal(room.shows.size, 0);
});

const stackCards = () => [
  { drawing: [], noteProps: { label: 'Bottom', snap: true, stand: 'flat' } },
  { drawing: artwork, noteProps: { label: 'Top' } },
];
const sceneOptions = {
  maxPieces: 250,
  tableLimits: { minX: 5, maxX: 40, minZ: 5, maxZ: 40 },
  overlayMax: 50,
  overlayKinds: new Set(),
};

test('stack spawn validates quantities, conceals every drawing and shares counted geometry', () => {
  const { room } = harness();
  for (const count of [0, 1, 17, 2.5, '8'])
    assert.equal(spawnPayload({ type: 'notecardStack', props: { count } }), null);
  assert.deepEqual(spawnPayload({ type: 'notecardStack', props: { count: 8 } }), {
    type: 'notecardStack',
    props: { count: 8 },
  });
  assert.equal(
    spawnPayload({ type: 'notecardStack', props: { count: 2, cards: stackCards() } }),
    null,
  );
  const id = room.spawn('notecardStack', [0, 1, 0], { cards: stackCards() });
  const piece = room.state.pieces.get(id),
    body = room.bodies.get(id);
  assert.equal(piece.count, 2);
  assert.equal(body.mass, NOTECARD.mass * 2);
  assert.deepEqual(
    body.shapes[0].halfExtents.toArray(),
    colliderSpec('notecardStack', {}, { count: 2 }).halfExtents,
  );
  assert.equal(readProps(piece).drawing, undefined);
  assert.equal(readProps(piece).cards, undefined);
  assert.deepEqual(room.notecards.snapshot(id).cards, stackCards());
});

test('stack edit reserves the committed top, blocks competitors and cancels without consuming it', () => {
  const { room, alice, bob, send, advance } = harness();
  const id = room.spawn('notecardStack', [0, 1, 0], { cards: stackCards() });
  send('notecardEdit', { id });
  const lease = alice.sent.at(-1).payload;
  assert.equal(lease.fromStack, true);
  assert.deepEqual(lease.drawing, artwork);
  assert.equal(bob.sent.length, 0);
  for (const type of ['notecardDraw', 'notecardShuffle', 'notecardSplit', 'grab', 'remove'])
    send(type, { id, destination: 'hand' }, bob);
  send('notecardCombine', { ids: [id, '1'] }, bob);
  assert.deepEqual(room.notecards.snapshot(id).cards, stackCards());
  assert.equal(room.state.pieces.get(id).count, 2);
  send('notecardCommit', { ...lease, destination: 'stack', drawing: [] }, bob);
  send('notecardCancel', lease);
  assert.deepEqual(room.notecards.snapshot(id).cards, stackCards());
  send('notecardEdit', { id });
  advance();
  send('notecardCommit', { ...lease, destination: 'hand', drawing: [] });
  assert.equal(room.state.pieces.get(id).count, 2);
  assert.equal(room.notecards.isEditing(id), false);
});

test('return to top saves privately; successive hand and face-down draws preserve metadata and remove empty stack', () => {
  const { room, alice, bob, send } = harness();
  const id = room.spawn('notecardStack', [0, 1, 0], { cards: stackCards() });
  send('notecardEdit', { id });
  send('notecardCommit', { ...alice.sent.at(-1).payload, destination: 'stack', drawing: [] });
  assert.equal(room.state.pieces.get(id).count, 2);
  assert.deepEqual(room.notecards.snapshot(id).cards.at(-1).drawing, []);
  assert.equal(bob.sent.length, 0);
  send('notecardDraw', { id, destination: 'hand' });
  assert.equal(room.hands.get('alice')[0].noteProps.label, 'Top');
  assert.equal(room.state.pieces.get(id).count, 1);
  send('notecardDraw', { id, destination: 'table' });
  assert.equal(room.state.pieces.has(id), false);
  const [playedId, played] = [...room.state.pieces].at(-1);
  assert.equal(readProps(played).faceDown, true);
  assert.equal(readProps(played).label, 'Bottom');
  assert.equal(readProps(played).snap, true);
  assert.equal(readProps(played).drawing, undefined);
  assert.deepEqual(room.notecards.snapshot(playedId).drawing, []);
});

test('split and combine preserve all drawings and order, work at the notecard cap and combine at physical cap', () => {
  const { room, id: loose, send } = harness();
  room.removePiece(loose);
  const cards = Array.from({ length: 16 }, (_, i) => ({
    drawing: i % 2 ? artwork : [],
    noteProps: { label: String(i) },
  }));
  const id = room.spawn('notecardStack', [0, 1, 0], { cards });
  assert.equal(room.notecards.hasCapacity(), false);
  send('notecardSplit', { id });
  const other = [...room.state.pieces.keys()].at(-1);
  assert.equal(room.state.pieces.get(id).count, 8);
  assert.equal(room.state.pieces.get(other).count, 8);
  assert.deepEqual(room.notecards.snapshot(other).cards, cards.slice(8));
  for (let i = 0; i < 248; i++) room.state.pieces.set('dummy' + i, {});
  send('notecardCombine', { ids: [id, other] });
  assert.deepEqual(room.notecards.snapshot(id).cards, cards);
  assert.equal(room.notecards.hasCapacity(), false);
  assert.equal(room.state.pieces.size, 249);
});

test('combining loose notecards reuses the anchor, conceals faces and rejects mixed or busy selections', () => {
  const { room, id, send } = harness();
  const second = room.spawn('notecard', [0, 2, 0], {
    drawing: [],
    faceDown: false,
    label: 'Second',
  });
  room.state.pieces.set('mixed', { type: 'card' });
  send('notecardCombine', { ids: [id, second, 'mixed'] });
  assert.equal(room.state.pieces.get(id).type, 'notecard');
  room.state.pieces.get(second).owner = 'bob';
  send('notecardCombine', { ids: [id, second] });
  assert.equal(room.state.pieces.get(id).type, 'notecard');
  room.state.pieces.get(second).owner = '';
  send('notecardCombine', { ids: [id, second] });
  assert.equal(room.state.pieces.get(id).type, 'notecardStack');
  assert.equal(room.state.pieces.has(second), false);
  assert.deepEqual(
    room.notecards.snapshot(id).cards.map((c) => c.drawing),
    [artwork, []],
  );
  assert.equal(readProps(room.state.pieces.get(id)).drawing, undefined);
});

test('failed stack placement/split retains cards; rejected editor placement retains the reservation and original artwork', () => {
  const { room, alice, send } = harness();
  const id = room.spawn('notecardStack', [0, 1, 0], { cards: stackCards() });
  const spawn = room.spawn;
  room.spawn = () => {
    throw new Error('injected allocation failure');
  };
  assert.throws(() => room.notecards.draw(alice, { id, destination: 'table' }), /allocation/);
  assert.throws(() => room.notecards.split(alice, { id }), /allocation/);
  assert.deepEqual(room.notecards.snapshot(id).cards, stackCards());
  room.spawn = spawn;
  for (let i = room.state.pieces.size; i < 250; i++) room.state.pieces.set('dummy' + i, {});
  send('notecardEdit', { id });
  const lease = alice.sent.at(-1).payload;
  send('notecardCommit', { ...lease, destination: 'table', faceDown: false, drawing: [] });
  assert.equal(room.notecards.isEditing(id), true);
  assert.deepEqual(room.notecards.snapshot(id).cards, stackCards());
  send('notecardCommit', { ...lease, destination: 'hand', drawing: [] });
  assert.equal(room.state.pieces.get(id).count, 1);
  assert.deepEqual(room.hands.get('alice')[0].drawing, []);
});

test('stack saves preserve committed order during editing; restore rejects malformed or excessive totals before clearing', () => {
  const { room, id: loose, send } = harness();
  const id = room.spawn('notecardStack', [0, 1, 0], { cards: stackCards() });
  send('notecardEdit', { id });
  const saved = serializeScene(room);
  assert.deepEqual(saved.pieces.at(-1).props.cards, stackCards());
  assert.equal(saved.pieces.at(-1).props.editing, undefined);
  for (const cards of [[], [{ drawing: [{}] }], Array(16).fill(stackCards()[0])]) {
    assert.throws(
      () =>
        applyScene(
          room,
          {
            pieces: [
              { type: 'notecardStack', props: { cards } },
              { type: 'notecard', props: {} },
            ],
          },
          sceneOptions,
        ),
      /invalid/,
    );
    assert.equal(room.state.pieces.has(loose), true);
  }
  applyScene(room, saved, sceneOptions);
  const restored = [...room.state.pieces.keys()].at(-1);
  assert.deepEqual(room.notecards.snapshot(restored).cards, stackCards());
  assert.equal(readProps(room.state.pieces.get(restored)).cards, undefined);
  room.clearTable();
  assert.equal(room.notecards.hasCapacity(16), true);
});

test('shuffle conserves entries and spectators cannot use any stack mutation', () => {
  const { room, alice, send } = harness();
  const id = room.spawn('notecardStack', [0, 1, 0], { cards: stackCards() });
  for (let i = 0; i < 10; i++) send('notecardShuffle', { id });
  assert.deepEqual(
    room.notecards
      .snapshot(id)
      .cards.map((c) => c.noteProps.label)
      .sort(),
    ['Bottom', 'Top'],
  );
  alice.auth.participation = 'spectator';
  const before = structuredClone(room.notecards.snapshot(id));
  for (const type of ['notecardDraw', 'notecardEdit', 'notecardSplit', 'notecardShuffle'])
    send(type, { id, destination: 'hand' });
  send('notecardCombine', { ids: ['1', id] });
  assert.deepEqual(room.notecards.snapshot(id), before);
});

test('a captured stack snapshot remains stable while later edits and draws change live inventory', () => {
  const { room, alice, send } = harness();
  const id = room.spawn('notecardStack', [0, 1, 0], { cards: stackCards() });
  const saved = serializeScene(room);
  send('notecardEdit', { id });
  send('notecardCommit', { ...alice.sent.at(-1).payload, destination: 'stack', drawing: [] });
  send('notecardDraw', { id, destination: 'hand' });
  assert.deepEqual(saved.pieces.at(-1).props.cards, stackCards());
});
