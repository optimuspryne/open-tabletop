import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as CANNON from 'cannon-es';
import { cardGeom, cardPublicProps, TABLE } from '../shared/pieces.js';
import { createDeckBuilders } from '../server/game/deck-builders.js';
import { createPieceLifecycle } from '../server/game/piece-lifecycle.js';
import { createMahjongWall } from '../server/game/mahjong-wall.js';
import { createStarterSetup } from '../server/game/starters.js';
import { mahjongWallLayout } from '../shared/mahjong-wall.js';
import { writeTransform } from '../server/game/placement-operations.js';
import { spawnPayload } from '../server/message-validation.js';
import { registerPieceHandlers } from '../server/game/handlers/pieces.js';
import { readProps } from '../server/game/props-codec.js';
import { RANK } from '../server/permissions.js';
import { serializeScene, applyScene } from '../server/game/scene-persistence.js';

function harness() {
  const builders = createDeckBuilders({ shuffle: (cards) => cards.reverse() });
  const lifecycle = createPieceLifecycle({
    deckBuilders: builders,
    geoOf: cardPublicProps,
    dropSfx: () => 'tile-drop',
    sim: {
      maxPieces: 250,
      cards: { colliderThick: 0, linDamp: 0.5, angDamp: 0.8, sleepSpeed: 0.1, sleepTime: 0.1 },
      damp: { flat: 0.5, solid: 0.1 },
      impact: { minVel: 1.5 },
    },
  });
  const room = {
    state: {
      pieces: new Map(),
      tableX: TABLE.x,
      tableZ: TABLE.z,
      tableShape: 'rect',
      scale: { gridStyle: 'square', cellWorld: 1 },
    },
    world: new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0), allowSleep: true }),
    bodies: new Map(),
    cardData: new Map(),
    deckCards: new Map(),
    flips: new Map(),
    targets: new Map(),
    _released: new Map(),
    mat: new CANNON.Material(),
    nextId: 1,
    saves: 0,
    spawnCardFlat(position, props, hidden) {
      return lifecycle.spawn(this, 'card', position, props, [0, 0, 0, 1], hidden);
    },
    spawn(type, position, props, quaternion, hidden) {
      return lifecycle.spawn(this, type, position, props, quaternion, hidden);
    },
    removePiece(id) {
      lifecycle.removePiece(this, id);
    },
    writeTransform(piece, body) {
      writeTransform(piece, body);
    },
    updateDeckCollider() {},
    updateStackCollider() {},
    broadcast() {},
    scheduleSave() {
      this.saves++;
    },
  };
  room.world.addBody(
    new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(new CANNON.Vec3(20, 0.1, 20)),
      position: new CANNON.Vec3(0, -0.1, 0),
    }),
  );
  const buildWall = createMahjongWall({
    buildInventory: builders.buildMahjongWall,
    maxPieces: 250,
  });
  return { room, builders, buildWall };
}

for (const bonusTiles of [false, true])
  test(`wall creation keeps ${bonusTiles ? 144 : 136} faces private and each layer independently movable`, () => {
    const { room, buildWall, builders } = harness();
    const result = buildWall(room, bonusTiles);
    const count = bonusTiles ? 144 : 136;
    assert.equal(result.ok, true);
    assert.equal(room.state.pieces.size, count);
    assert.equal(room.bodies.size, count);
    assert.equal(room.cardData.size, count);
    assert.equal(room.deckCards.size, 0);
    assert.deepEqual(
      [...room.cardData.values()].map((entry) => entry.front),
      builders.buildMahjongWall(bonusTiles).cards,
    );
    for (const [id, piece] of room.state.pieces) {
      const props = readProps(piece),
        body = room.bodies.get(id);
      assert.equal(piece.type, 'card');
      assert.equal(props.tile, 'mahjong');
      assert.equal(props.snap, false); // active room grid must not pull the wall apart
      assert.equal(props.front, undefined);
      assert.equal(props.open, undefined);
      assert.equal(body.type, CANNON.Body.DYNAMIC);
      assert.equal(body.sleepState, CANNON.Body.SLEEPING);
      assert.equal(piece.y, body.position.y);
    }
    const lower = result.ids[0],
      upper = result.ids[1];
    const neighboring = room.bodies.get(result.ids[3]);
    const oldNeighbor = neighboring.position.clone();
    room.removePiece(lower);
    assert.notEqual(room.bodies.get(upper).sleepState, CANNON.Body.SLEEPING);
    for (let frame = 0; frame < 120; frame++) room.world.step(1 / 60);
    assert.ok(
      Math.abs(room.bodies.get(upper).position.y - cardGeom({ tile: 'mahjong' }).th) < 0.02,
    );
    assert.ok(neighboring.position.distanceTo(oldNeighbor) < 0.01);
    assert.equal(room.cardData.has(lower), false);
  });

for (const [game, count] of [
  ['mahjong', 136],
  ['mahjong-bonus', 144],
])
  test(`${game} starter uses the production wall and dice lifecycle and keeps the wall stable`, () => {
    const { room, builders, buildWall } = harness();
    let dealt = 0;
    room.clearTable = () => {
      for (const id of [...room.state.pieces.keys()]) room.removePiece(id);
    };
    room.dealFromDeckToSeats = () => dealt++;
    room.spawn('prop', [0, 0.5, 0], { shape: 'box' });
    const setup = createStarterSetup({
      deckBuilders: builders,
      spawnMahjongWall: buildWall,
      geoOf: cardPublicProps,
      maxPieces: 250,
      spawnY: 4,
    });
    assert.equal(setup(room, game), true);
    assert.equal(room.state.pieces.size, count + 2);
    assert.equal(room.cardData.size, count);
    assert.equal(room.deckCards.size, 0);
    assert.equal(dealt, 0);
    const tiles = [...room.state.pieces].filter(([, piece]) => piece.type === 'card');
    const initial = tiles.map(([id]) => room.bodies.get(id).position.clone());
    const dice = [...room.state.pieces].filter(([, piece]) => piece.type === 'die');
    assert.equal(dice.length, 2);
    for (const [id, piece] of dice) {
      assert.deepEqual(readProps(piece), { sides: 6, model: 'pip-round' });
      const body = room.bodies.get(id);
      assert.ok(Math.abs(body.position.x) < 1 && body.position.z === 0);
      assert.equal(body.type, CANNON.Body.DYNAMIC);
    }
    for (let frame = 0; frame < 120; frame++) room.world.step(1 / 60);
    for (const [index, [id, piece]] of tiles.entries()) {
      assert.ok(room.bodies.get(id).position.distanceTo(initial[index]) < 0.01);
      assert.equal(readProps(piece).front, undefined);
    }
    for (const [id] of dice) assert.ok(room.bodies.get(id).position.y > 0.35);
  });

test('wall preflight preserves existing objects on capacity, table-fit and obstruction failures', () => {
  for (const failure of ['capacity', 'size', 'obstruction']) {
    const { room, buildWall } = harness();
    if (failure === 'capacity')
      for (let i = 0; i < 107; i++) room.state.pieces.set('existing-' + i, { type: 'prop' });
    if (failure === 'size') room.state.tableZ = 3;
    if (failure === 'obstruction')
      room.spawn('prop', mahjongWallLayout(144).tiles[1].position, { shape: 'box' });
    const existing = [...room.state.pieces.keys()],
      bodies = room.world.bodies.slice();
    const result = buildWall(room, true);
    assert.equal(result.ok, false);
    assert.ok(result.message);
    assert.deepEqual([...room.state.pieces.keys()], existing);
    assert.deepEqual(room.world.bodies, bodies);
    assert.equal(room.cardData.size, 0);
  }
});

test('an unexpected spawn failure rolls back bodies, synchronized pieces and private faces', () => {
  const { room, buildWall } = harness();
  const existing = room.spawn('prop', [0, 0.5, 0], { shape: 'box' });
  const spawn = room.spawnCardFlat.bind(room);
  let calls = 0;
  room.spawnCardFlat = (...args) => {
    const id = spawn(...args);
    if (++calls === 8) throw Error('Injected spawn failure');
    return id;
  };
  assert.throws(() => buildWall(room), /Injected spawn failure/);
  assert.deepEqual([...room.state.pieces.keys()], [existing]);
  assert.deepEqual([...room.bodies.keys()], [existing]);
  assert.equal(room.cardData.size, 0);
  assert.equal(room.world.bodies.length, 2); // original floor and original prop
});

test('validated wall spawns follow the real helper permission gate and selected tile count', async () => {
  const { room, buildWall } = harness(),
    handlers = new Map(),
    errors = [];
  let rank = RANK.helper;
  room.rank = () => rank;
  room.onMessage = (type, handler) => handlers.set(type, handler);
  room.notifyFull = () => errors.push('full');
  registerPieceHandlers(room, {
    maxPieces: 250,
    boardKeys: [],
    propKeys: [],
    dispenserKeys: [],
    colliders: [],
    spawnMahjongWall: buildWall,
    geoOf: cardPublicProps,
    randomPosition: () => [0, 1, 0],
    logger: { error() {} },
  });
  const client = { sessionId: 'builder', send: (type, payload) => errors.push([type, payload]) };
  rank = RANK.player;
  await handlers.get('spawn')(client, {
    type: 'deck',
    props: { set: 'mahjong', bonusTiles: true, layout: 'wall' },
  });
  assert.equal(room.state.pieces.size, 0);
  rank = RANK.helper;
  await handlers.get('spawn')(client, {
    type: 'deck',
    props: { set: 'mahjong', bonusTiles: true, layout: 'wall' },
  });
  assert.equal(room.state.pieces.size, 144);
  assert.deepEqual(errors, []);
  for (const props of [
    { set: 'mahjong', layout: 'unknown' },
    { set: 'domino', layout: 'wall' },
    { layout: 'wall' },
    { set: 'mahjong', layout: true },
  ])
    assert.equal(spawnPayload({ type: 'deck', props }), null);
});

test('rollback also removes an orphan body from a spawn that failed before publishing a piece', () => {
  const { room, buildWall } = harness();
  room.spawnCardFlat = () => {
    room.world.addBody(
      new CANNON.Body({ mass: 1, shape: new CANNON.Box(new CANNON.Vec3(0.34, 0.14, 0.473)) }),
    );
    throw Error('Incomplete body spawn');
  };
  assert.throws(() => buildWall(room), /Incomplete body spawn/);
  assert.equal(room.state.pieces.size, 0);
  assert.equal(room.bodies.size, 0);
  assert.equal(room.cardData.size, 0);
  assert.equal(room.world.bodies.length, 1);
});

test('public obstruction checks ignore parked hidden objects while GM-hidden layouts check them', () => {
  for (const hidden of [false, true]) {
    const { room, buildWall } = harness();
    const id = room.spawn('prop', mahjongWallLayout(144).tiles[1].position, { shape: 'box' });
    room.state.pieces.get(id).hidden = true;
    room.bodies.get(id).collisionFilterMask = 0;
    room.bodies.get(id).type = CANNON.Body.KINEMATIC;
    room.visibility = { spawnHidden: () => hidden, prepareBody() {} };
    const result = buildWall(room, true);
    assert.equal(result.ok, !hidden);
    assert.equal(room.state.pieces.has(id), true);
    if (hidden) assert.equal(room.state.pieces.size, 1);
    else assert.equal(room.state.pieces.size, 145);
  }
});

test('a wall survives production snapshot/restore with positions, orientations and private faces intact', () => {
  const { room, buildWall } = harness();
  room.state.overlays = new Map();
  room.state.trays = new Map();
  room.pendingInspect = new Map();
  room.scaleSnapshot = () => ({ ...room.state.scale });
  room.clearTable = () => {
    for (const id of [...room.state.pieces.keys()]) room.removePiece(id);
  };
  room.buildBounds = () => {};
  room.applyScale = (scale) => Object.assign(room.state.scale, scale);
  room.applyTrays = () => {};
  buildWall(room, true);
  const scene = JSON.parse(JSON.stringify(serializeScene(room)));
  assert.equal(scene.pieces.length, 144);
  assert.equal(
    scene.pieces.every((piece) => piece.props.faceDown && piece.props.front),
    true,
  );
  applyScene(room, scene, {
    maxPieces: 250,
    overlayKinds: new Set(),
    overlayMax: 0,
    tableLimits: { minX: 2, maxX: 30, minZ: 2, maxZ: 30 },
  });
  assert.equal(room.cardData.size, 144);
  assert.equal(
    [...room.state.pieces.values()].every((piece) => !readProps(piece).front),
    true,
  );
  assert.deepEqual(serializeScene(room).pieces, scene.pieces);
  const positions = [...room.bodies.values()].map((body) => body.position.clone());
  for (let frame = 0; frame < 120; frame++) room.world.step(1 / 60);
  for (const [index, body] of [...room.bodies.values()].entries())
    assert.ok(body.position.distanceTo(positions[index]) < 0.03, 'Restored wall destabilized');
});
