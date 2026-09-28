import { createNotecards, registerNotecardHandlers } from '../server/game/notecards.js';
import { createDeckBrowsing } from '../server/game/deck-browsing.js';
import { registerDeckBrowseHandlers } from '../server/game/handlers/deck-browsing.js';
import { dispensedSpec } from '../shared/pieces.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SchemaSerializer } from '@colyseus/core';
import { Reflection } from '@colyseus/schema';
import * as CANNON from 'cannon-es';
import { State } from '../server/game/schema.js';
import { createPieceVisibility, broadcastPieceEvent } from '../server/game/piece-visibility.js';
import { createPieceLifecycle } from '../server/game/piece-lifecycle.js';
import { registerMovementHandlers } from '../server/game/handlers/movement.js';
import { registerCardHandlers } from '../server/game/handlers/cards.js';
import { registerPlacementHandlers } from '../server/game/handlers/placement.js';
import { guardedMessage } from '../server/game/interaction-policy.js';
import { RANK } from '../server/permissions.js';
import { serializeScene, applyScene } from '../server/game/scene-persistence.js';
import { emptyFog } from '../shared/map-fog.js';

function harness() {
  const serializer = new SchemaSerializer(),
    handlers = new Map();
  const room = {
    state: new State(),
    clients: [],
    bodies: new Map(),
    targets: new Map(),
    groups: new Map(),
    flips: new Map(),
    _released: new Map(),
    deckCards: new Map(),
    cardData: new Map(),
    pendingInspect: new Map(),
    lastDrop: new Map(),
    hands: new Map(),
    nextId: 1,
    nextHid: 1,
    unpinPiece() {},
    stopShow() {},
    sendHand() {},
    notifyFull(client) {
      client.send('notice', { message: 'full' });
    },
    dispenserItem(piece) {
      return dispensedSpec(JSON.parse(piece.props));
    },
    afterDispense(piece) {
      piece.count--;
    },
    world: new CANNON.World({ gravity: new CANNON.Vec3(0, -10, 0) }),
    mat: new CANNON.Material(),
    rank: (client) => RANK[client.auth.role],
    onMessage: (type, fn) => handlers.set(type, fn),
    broadcast(type, value) {
      for (const client of this.clients) client.send(type, value);
    },
    updateDeckCollider() {},
    updateStackCollider() {},
    writeTransform(p, b) {
      Object.assign(p, {
        x: b.position.x,
        y: b.position.y,
        z: b.position.z,
        qx: b.quaternion.x,
        qy: b.quaternion.y,
        qz: b.quaternion.z,
        qw: b.quaternion.w,
      });
    },
    besideDeck: () => [5, 3, 0],
    addToHand(client, front) {
      this.hands.set(client.sessionId, [front]);
    },
    scaleSnapshot: () => ({}),
    buildBounds() {},
    applyScale() {},
    applyTrays() {},
    scheduleSave() {},
    clearTable() {
      for (const id of [...this.state.pieces.keys()]) this.removePiece(id);
    },
  };
  serializer.reset(room.state);
  room.visibility = createPieceVisibility(room);
  room.notecards = createNotecards(room);
  room.deckBrowsing = createDeckBrowsing(room, { geoOf: () => ({}), maxPieces: 250 });
  registerNotecardHandlers(room);
  registerDeckBrowseHandlers(room);
  const lifecycle = createPieceLifecycle({
    sim: {
      maxPieces: 250,
      cards: { colliderThick: 0.04, angDamp: 0.7, linDamp: 0.25, sleepSpeed: 0.5, sleepTime: 0.2 },
      damp: { solid: 0.15, flat: 0.5 },
      impact: { minVel: 1 },
      absorb: { x: 1, z: 1 },
    },
    deckBuilders: { buildSimpleDeck: () => ({ back: 'back', cards: ['SECRET_FACE'] }) },
    geoOf: () => ({}),
    dropSfx: () => 'drop',
    random: () => 0,
  });
  room.spawn = (...args) => lifecycle.spawn(room, ...args);
  room.removePiece = (id) => lifecycle.removePiece(room, id);
  room.releasePiece = (id, v) => lifecycle.releasePiece(room, id, v);
  room.spawnCardFlat = (pos, props, hidden) => room.spawn('card', pos, props, [0, 0, 0, 1], hidden);
  room.swapBoard = (props, hidden) => room.spawn('board', [0, 0.1, 0], props, null, hidden);
  registerMovementHandlers(room, { isMovable: () => true });
  registerCardHandlers(room, {
    maxPieces: 250,
    geoOf: () => ({}),
    dropSfx: () => 'drop',
    shuffle: (cards) => cards.reverse(),
  });
  registerPlacementHandlers(room, { randomPosition: () => [5, 3, 0], dropSfx: () => 'drop' });
  guardedMessage(room, 'setPieceVisibility', (client, message) =>
    room.visibility.setVisibility(client, message),
  );
  function client(role) {
    const decoder = Reflection.decode(Reflection.encode(serializer.encoder)),
      state = decoder.state;
    const result = {
      sessionId: String(room.clients.length),
      auth: { role },
      state: 1,
      decoded: state,
      events: [],
      packets: [],
      send(type, payload) {
        this.events.push({ type, payload });
      },
      raw(bytes) {
        this.packets.push(Buffer.from(bytes));
        decoder.decode(bytes.subarray(1));
      },
    };
    room.clients.push(result);
    room.visibility.syncClient(result);
    result.raw(serializer.getFullState(result));
    return result;
  }
  const patch = () => {
    room.visibility.sync();
    serializer.applyPatches(room.clients);
  };
  return {
    room,
    client,
    patch,
    request: (client, type, message) => handlers.get(type)(client, message),
  };
}

test('real initial state and patches omit hidden pieces and secrets; promotion, demotion, reveal and removal retain correct views', () => {
  const { room, client, patch } = harness();
  const secret = room.spawn(
    'prop',
    [0, 3, 0],
    { shape: 'box', label: 'SECRET_MONSTER' },
    null,
    true,
  );
  const visible = room.spawn('prop', [5, 3, 0], { shape: 'box' });
  const gm = client('gm'),
    player = client('player');
  assert.equal(player.decoded.pieces.has(secret), false);
  assert.equal(gm.decoded.pieces.get(secret).hidden, true);
  assert.equal(player.decoded.pieces.has(visible), true);
  patch();
  room.state.pieces.get(secret).props = '{"label":"SECRET_PATCH"}';
  patch();
  assert.equal(player.decoded.pieces.has(secret), false);
  assert.ok(player.packets.every((packet) => !packet.includes('SECRET')));
  player.auth.role = 'gm';
  patch();
  assert.equal(player.decoded.pieces.get(secret).props, '{"label":"SECRET_PATCH"}');
  player.auth.role = 'player';
  patch();
  assert.equal(player.decoded.pieces.has(secret), false);
  room.visibility.setVisibility(gm, { ids: [secret], hidden: false });
  patch();
  assert.equal(player.decoded.pieces.get(secret).hidden, false);
  room.visibility.setVisibility(gm, { ids: [secret], hidden: true });
  patch();
  assert.equal(player.decoded.pieces.has(secret), false);
  room.removePiece(secret);
  patch();
  assert.equal(gm.decoded.pieces.has(secret), false);
  const rejoined = client('player');
  assert.equal(rejoined.decoded.pieces.size, 1);
});

test('players cannot target guessed hidden IDs or mixed groups; only live GMs change visibility', async () => {
  const { room, client, request } = harness();
  const id = room.spawn('deck', [0, 3, 0], {}, null, true);
  const visible = room.spawn('prop', [5, 3, 0], { shape: 'box' });
  const player = client('player'),
    gm = client('gm');
  await request(player, 'grab', { id });
  await request(player, 'grabGroup', { ids: [id, visible], anchor: visible });
  await request(player, 'drawToHand', { deckId: id });
  await request(player, 'drawInspect', { deckId: id });
  await request(player, 'setPieceVisibility', { ids: [id], hidden: false });
  assert.equal(room.state.pieces.get(id).owner, '');
  assert.equal(room.state.pieces.get(visible).owner, '');
  assert.equal(room.deckCards.get(id).length, 1);
  assert.equal(room.hands.size, 0);
  assert.equal(room.pendingInspect.size, 0);
  gm.auth.participation = 'spectator';
  await request(gm, 'setPieceVisibility', { ids: [id], hidden: false });
  assert.equal(room.state.pieces.get(id).hidden, true);
  assert.equal(gm.decoded.pieces.has(id), true);
});

test('reflected browser schemas always receive an empty collection without hidden data in initial or later packets', () => {
  const { room, client, patch } = harness();
  const early = client('player');
  assert.equal(early.decoded.pieces.size, 0);
  room.spawn('prop', [0, 3, 0], { shape: 'box', label: 'SECRET_INITIAL' }, null, true);
  const late = client('player');
  patch();
  assert.equal(early.decoded.pieces.size, 0);
  assert.equal(late.decoded.pieces.size, 0);
  for (const viewer of [early, late])
    assert.ok(viewer.packets.every((packet) => !packet.includes('SECRET')));
  const gm = client('gm');
  assert.equal(gm.decoded.pieces.size, 1);
});

test('derived cards inherit concealment, object events are filtered, mixed combines preserve inventory', async () => {
  const { room, client, request, patch } = harness();
  const id = room.spawn('deck', [0, 3, 0], { cards: ['SECRET_FACE', 'SECRET_OTHER'] }, null, true);
  const publicId = room.spawn('deck', [8, 3, 0], {});
  const gm = client('gm'),
    player = client('player');
  await request(gm, 'shuffle', { deckId: id });
  await request(gm, 'combineIntoDeck', { ids: [id, publicId] });
  assert.equal(room.deckCards.get(id).length, 2);
  await request(gm, 'dealToTable', { deckId: id });
  patch();
  const drawn = [...room.state.pieces.values()].find((p) => p.type === 'card');
  assert.equal(drawn.hidden, true);
  assert.equal(room.cardData.size, 1);
  assert.equal(player.decoded.pieces.size, 1);
  assert.equal(
    player.events.some((e) => ['sfx', 'shuffled'].includes(e.type)),
    false,
  );
  assert.equal(
    gm.events.some((e) => e.type === 'shuffled'),
    true,
  );
  broadcastPieceEvent(room, 'sfx', { type: 'collision' }, [id]);
  assert.equal(
    player.events.some((e) => e.type === 'sfx'),
    false,
  );
});

test('hidden bodies remain parked, do not collide, can move for GMs, and reveal is atomic at occupied positions', () => {
  const { room, client } = harness();
  const id = room.spawn('prop', [0, 3, 0], { shape: 'box' }, null, true);
  const other = room.spawn('prop', [0, 3, 0], { shape: 'box' });
  const gm = client('gm'),
    body = room.bodies.get(id),
    visible = room.bodies.get(other);
  for (let i = 0; i < 60; i++) {
    room.visibility.preparePhysics();
    room.world.step(1 / 60);
  }
  assert.equal(body.position.y, 3);
  assert.ok(visible.position.y < 0);
  visible.position.copy(body.position);
  room.visibility.setVisibility(gm, { ids: [id], hidden: false });
  assert.equal(room.state.pieces.get(id).hidden, true);
  assert.match(gm.events.at(-1).payload.message, /free space/);
  room.state.pieces.get(id).owner = gm.sessionId;
  body.velocity.x = 2;
  room.visibility.preparePhysics();
  room.world.step(1 / 60);
  assert.ok(body.position.x > 0);
  room.state.pieces.get(id).owner = '';
  body.position.x = 5;
  room.visibility.setVisibility(gm, { ids: [id], hidden: false });
  assert.equal(body.type, CANNON.Body.DYNAMIC);
  assert.notEqual(body.collisionFilterMask, 0);
});

for (const gridStyle of ['square', 'hex', 'off']) {
  test(`hidden ${gridStyle} drops settle on the board without restoring collisions or player visibility`, async () => {
    const { room, client, request, patch } = harness();
    Object.assign(room.state.scale, { gridStyle, cellWorld: 1, snapAnchor: 'cross' });
    const board = room.spawn('board', [0, 0.2, 0], { w: 8, d: 8, thickness: 0.4 });
    const id = room.spawn('prop', [0.1, 3, 0.1], { shape: 'box', snap: true }, [0, 0, 0, 1]);
    const gm = client('gm'),
      player = client('player'),
      body = room.bodies.get(id);
    await request(gm, 'setPieceVisibility', { ids: [id], hidden: true });
    await request(gm, 'grab', { id });
    body.velocity.set(1, 2, 3);
    await request(gm, 'release', { id, v: [1, 2, 3] });
    body.updateAABB();
    assert.ok(Math.abs(body.aabb.lowerBound.y - 0.4) < 1e-8);
    assert.ok(Math.abs(body.position.x - (gridStyle === 'off' ? 0.1 : 0)) < 1e-8);
    assert.ok(Math.abs(body.position.z - (gridStyle === 'off' ? 0.1 : 0)) < 1e-8);
    assert.equal(body.type, CANNON.Body.KINEMATIC);
    assert.equal(body.collisionFilterMask, 0);
    assert.equal(body.velocity.length(), 0);
    assert.equal(room.bodies.get(board).position.y, 0.2);
    const landedY = body.position.y;
    for (let i = 0; i < 60; i++) {
      room.visibility.preparePhysics();
      room.world.step(1 / 60);
    }
    assert.equal(body.position.y, landedY);
    patch();
    assert.equal(player.decoded.pieces.has(id), false);
    assert.ok(Math.abs(gm.decoded.pieces.get(id).y - landedY) < 1e-6);
    await request(gm, 'setPieceVisibility', { ids: [id], hidden: false });
    assert.equal(room.state.pieces.get(id).hidden, false);
  });
}

test('group release settles hidden pieces on actual rotated compound board parts and the table', async () => {
  const { room, client, request } = harness();
  Object.assign(room.state.scale, { gridStyle: 'square', cellWorld: 1, snapAnchor: 'cross' });
  const rotation = new CANNON.Quaternion().setFromEuler(0, Math.PI / 2, 0);
  const board = room.spawn(
    'board',
    [0, 0.5, 0],
    {
      model: '/assets/boards/raised.glb',
      box: [4, 0.5, 4],
      compoundCollider: {
        version: 1,
        shapes: [
          { type: 'box', position: [0.25, 0, 0], size: [0.125, 0.125, 0.125], rotation: [0, 0, 0] },
        ],
      },
    },
    rotation.toArray(),
    true,
  );
  const onBoard = room.spawn('prop', [0.1, 4, -1.9], { snap: true }, rotation.toArray(), true);
  const inGap = room.spawn('prop', [0.1, 4, 0.1], { snap: true }, [0, 0, 0, 1], true);
  const visible = room.spawn('prop', [3, 4, 3], { snap: true }, [0, 0, 0, 1]);
  const gm = client('gm');
  await request(gm, 'grabGroup', { ids: [onBoard, inGap, visible], anchor: onBoard });
  await request(gm, 'releaseGroup', { v: [0, 0, 0] });
  for (const [id, height] of [
    [onBoard, 1],
    [inGap, 0],
  ]) {
    const body = room.bodies.get(id);
    body.updateAABB();
    assert.ok(
      Math.abs(body.aabb.lowerBound.y - height) < 1e-8,
      `${id}: ${body.aabb.lowerBound.y} vs ${height}`,
    );
    assert.equal(body.collisionFilterMask, 0);
  }
  assert.equal(room.bodies.get(board).collisionFilterMask, 0);
  assert.equal(room.bodies.get(visible).position.y, 4);
  assert.equal(room.bodies.get(visible).type, CANNON.Body.DYNAMIC);
});

test('hidden library spawns capture each request independently and recheck roles after asynchronous reads', async () => {
  const { room, client } = harness();
  const gm = client('gm'),
    player = client('player');
  let finish;
  const pending = room.visibility.runRequest(
    gm,
    'loadProp',
    { id: '1', spawnHidden: true },
    async (_, message) => {
      assert.deepEqual(message, { id: '1' });
      await new Promise((resolve) => {
        finish = resolve;
      });
      return room.spawn('prop', [0, 3, 0], { shape: 'box' });
    },
  );
  room.visibility.runRequest(player, 'spawn', { spawnHidden: true }, () =>
    assert.fail('unauthorized spawn'),
  );
  const publicId = room.visibility.runRequest(gm, 'spawn', { spawnHidden: false }, () =>
    room.spawn('prop', [5, 3, 0], { shape: 'box' }),
  );
  assert.equal(room.state.pieces.get(publicId).hidden, false);
  gm.auth.role = 'helper';
  finish();
  await assert.rejects(pending, /access changed/);
  assert.equal(room.state.pieces.size, 1);
});

test('saved scenes retain hidden state and private card fronts; legacy scenes default to visible', () => {
  const { room } = harness();
  const card = room.spawnCardFlat([0, 3, 0], { back: 'back' }, true);
  room.cardData.set(card, { front: 'SECRET_FRONT' });
  const scene = serializeScene(room);
  assert.equal(scene.pieces[0].hidden, true);
  applyScene(room, scene, {
    maxPieces: 250,
    tableLimits: { minX: 1, maxX: 30, minZ: 1, maxZ: 30 },
  });
  const restored = [...room.state.pieces.values()][0];
  assert.equal(restored.hidden, true);
  assert.equal(restored.props.includes('SECRET_FRONT'), false);
  assert.equal([...room.cardData.values()][0].front, 'SECRET_FRONT');
  delete scene.pieces[0].hidden;
  applyScene(room, scene, {
    maxPieces: 250,
    tableLimits: { minX: 1, maxX: 30, minZ: 1, maxZ: 30 },
  });
  assert.equal([...room.state.pieces.values()][0].hidden, false);
});

test('hidden notecard stacks and dispensers inherit visibility without giving players previews or inventory', async () => {
  const { room, client, request, patch } = harness();
  const stack = room.spawn('notecardStack', [0, 3, 0], { count: 4 }, null, true);
  const dispenser = room.spawn(
    'dispenser',
    [6, 3, 0],
    { disp: 'pokerStack', count: 3 },
    null,
    true,
  );
  const gm = client('gm'),
    player = client('player');
  await request(player, 'notecardEdit', { id: stack });
  await request(player, 'notecardDraw', { id: stack, destination: 'table' });
  await request(player, 'dispense', { id: dispenser });
  assert.equal(room.state.pieces.get(stack).count, 4);
  assert.equal(room.state.pieces.get(dispenser).count, 3);
  assert.equal(player.events.length, 0);
  await request(gm, 'notecardDraw', { id: stack, destination: 'table' });
  await request(gm, 'notecardSplit', { id: stack });
  await request(gm, 'dispense', { id: dispenser });
  patch();
  assert.equal(room.state.pieces.size, 5);
  assert.ok([...room.state.pieces.values()].every((piece) => piece.hidden));
  assert.equal(player.decoded.pieces.size, 0);
  assert.equal(gm.decoded.pieces.size, 5);
});

test('visibility changes close player peeks; demotion closes GM editing and browsing leases and releases hidden grabs', async () => {
  const { room, client, request, patch } = harness();
  const deck = room.spawn('deck', [0, 3, 0], { cards: ['face', 'other'] });
  const note = room.spawn('notecard', [8, 3, 0], {}, null, true);
  const prop = room.spawn('prop', [12, 3, 0], { shape: 'box' }, null, true);
  const gm = client('gm'),
    player = client('player');
  await request(player, 'drawInspect', { deckId: deck });
  assert.equal(room.pendingInspect.size, 1);
  await request(gm, 'setPieceVisibility', { ids: [deck], hidden: true });
  patch();
  assert.equal(room.pendingInspect.size, 0);
  assert.equal(room.deckCards.get(deck).length, 2);
  assert.ok(player.events.some((event) => event.type === 'inspectionClosed'));
  await request(gm, 'notecardEdit', { id: note });
  await request(gm, 'browseDeck', { deckId: deck });
  await request(gm, 'grab', { id: prop });
  assert.equal(room.notecards.isEditing(note), true);
  gm.auth.role = 'player';
  patch();
  assert.equal(room.notecards.isEditing(note), false);
  assert.equal(room.deckBrowsing.sourceFor(gm), undefined);
  assert.equal(room.state.pieces.get(prop).owner, '');
  assert.equal(gm.decoded.pieces.size, 0);
  assert.ok(gm.events.some((event) => event.type === 'deckBrowseClosed'));
});

test('supporting objects and busy pieces reject the entire hide batch; a valid batch preserves IDs and contents', async () => {
  const { room, client, request } = harness();
  const base = room.spawn('prop', [0, 0.5, 0], { shape: 'box' });
  const top = room.spawn('prop', [0, 1.5, 0], { shape: 'box' });
  const gm = client('gm');
  await request(gm, 'setPieceVisibility', { ids: [base], hidden: true });
  assert.equal(room.state.pieces.get(base).hidden, false);
  assert.match(gm.events.at(-1).payload.message, /resting/);
  room.state.pieces.get(top).owner = gm.sessionId;
  await request(gm, 'setPieceVisibility', { ids: [base, top], hidden: true });
  assert.ok([...room.state.pieces.values()].every((piece) => !piece.hidden));
  room.state.pieces.get(top).owner = '';
  await request(gm, 'setPieceVisibility', { ids: [base, top], hidden: true });
  assert.ok([...room.state.pieces.values()].every((piece) => piece.hidden));
  assert.deepEqual([...room.state.pieces.keys()], [base, top]);
});

test('dropping a public card over a hidden browsed deck neither absorbs it nor discloses the private lease', async () => {
  const { room, client, request } = harness();
  const deck = room.spawn('deck', [0, 3, 0], {}, null, true);
  const card = room.spawnCardFlat([0, 3, 0], { back: 'back' });
  room.cardData.set(card, { front: 'ace' });
  const gm = client('gm'),
    player = client('player');
  await request(gm, 'browseDeck', { deckId: deck });
  await request(player, 'grab', { id: card });
  await request(player, 'release', { id: card, v: [0, 0, 0] });
  assert.equal(room.state.pieces.has(card), true);
  assert.equal(room.deckCards.get(deck).length, 1);
  assert.equal(player.events.length, 0);
});

test('map fog follows board visibility through reflected initial state and patches', () => {
  const { room, client, patch } = harness();
  const id = room.spawn('board', [0, 0.05, 0], { w: 8, d: 8, tex: '/hidden-map.png' }, null, true);
  const board = room.state.pieces.get(id);
  board.fog = JSON.stringify({ ...emptyFog(), enabled: true });
  const player = client('player'),
    gm = client('gm');
  assert.equal(player.decoded.pieces.has(id), false);
  assert.equal(gm.decoded.pieces.get(id).fog, board.fog);
  patch();
  room.visibility.setVisibility(gm, { ids: [id], hidden: false });
  patch();
  assert.equal(player.decoded.pieces.get(id).fog, board.fog);
  board.fog = JSON.stringify({ ...emptyFog(), enabled: false, revision: 1 });
  patch();
  assert.equal(player.decoded.pieces.get(id).fog, board.fog);
  room.visibility.setVisibility(gm, { ids: [id], hidden: true });
  patch();
  assert.equal(player.decoded.pieces.has(id), false);
});

test('aura configuration follows hidden piece schema delivery and live visibility changes', () => {
  const { room, client, patch } = harness();
  const id = room.spawn('prop', [0, 2, 0], { shape: 'cube' }, null, true);
  const piece = room.state.pieces.get(id);
  piece.fogAura = JSON.stringify({ v: 1, enabled: true, radius: 3 });
  const player = client('player'),
    gm = client('gm');
  assert.equal(player.decoded.pieces.has(id), false);
  assert.equal(gm.decoded.pieces.get(id).fogAura, piece.fogAura);
  patch();
  room.visibility.setVisibility(gm, { ids: [id], hidden: false });
  patch();
  assert.equal(player.decoded.pieces.get(id).fogAura, piece.fogAura);
  piece.fogAura = JSON.stringify({ v: 1, enabled: false, radius: 3 });
  patch();
  assert.equal(player.decoded.pieces.get(id).fogAura, piece.fogAura);
  room.visibility.setVisibility(gm, { ids: [id], hidden: true });
  patch();
  assert.equal(player.decoded.pieces.has(id), false);
});
