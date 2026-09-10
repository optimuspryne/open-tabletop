import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as CANNON from 'cannon-es';
import { createPieceLifecycle } from '../server/game/piece-lifecycle.js';
import { readProps } from '../server/game/props-codec.js';

const SIM = {
  absorb: { x: 1.1, z: 1.4 },
  cards: {
    angDamp: 0.7,
    colliderThick: 0.04,
    linDamp: 0.25,
    maxThrow: 14,
    sleepSpeed: 0.5,
    sleepTime: 0.2,
  },
  damp: { flat: 0.5, solid: 0.15 },
  impact: { minVel: 1.5 },
  maxPieces: 250,
  throwCap: 40,
};

const geoOf = (value) => {
  const geometry = {};
  if (value?.tile) geometry.tile = value.tile;
  if (value?.geom) geometry.geom = value.geom;
  if (value?.snap) geometry.snap = true;
  return geometry;
};

function harness() {
  const colliderUpdates = [];
  const broadcasts = [];
  const lifecycle = createPieceLifecycle({
    deckBuilders: {
      buildDominoSet: () => ({ back: 'domino-back', cards: ['domino'] }),
      buildMahjongWall: () => ({ back: 'mahjong-back', cards: ['mahjong'] }),
      buildScrabbleBag: () => ({ back: 'letter-back', cards: ['letter'] }),
      buildSimpleDeck: () => ({ back: 'card-back', cards: ['card'] }),
    },
    dropSfx: () => 'object-drop',
    geoOf,
    now: () => 1234,
    random: () => 0.25,
    sim: SIM,
  });
  const room = {
    _released: new Map(),
    bodies: new Map(),
    broadcasts,
    cardData: new Map(),
    deckCards: new Map(),
    flips: new Map(),
    mat: new CANNON.Material(),
    nextId: 1,
    state: { pieces: new Map(), scale: { gridStyle: 'off', cellWorld: 0 } },
    targets: new Map(),
    world: new CANNON.World(),
    broadcast(type, payload) {
      broadcasts.push([type, payload]);
    },
    removePiece(id) {
      lifecycle.removePiece(this, id);
    },
    updateDeckCollider(id) {
      colliderUpdates.push(['deck', id]);
    },
    updateStackCollider(id) {
      colliderUpdates.push(['stack', id]);
    },
    writeTransform() {},
  };
  return { colliderUpdates, lifecycle, room };
}

test('spawn creates one synchronized deck/body pair and keeps card order private', () => {
  const { colliderUpdates, lifecycle, room } = harness();
  const cards = ['front-one', { front: 'front-two', back: 'back-two' }];

  const id = lifecycle.spawn(
    room,
    'deck',
    [1, 2, 3],
    { back: 'shared-back', cards, open: true, tile: 'domino' },
    [0, 0, 0, 1],
  );

  const piece = room.state.pieces.get(id);
  const body = room.bodies.get(id);
  assert.equal(id, '1');
  assert.equal(piece.type, 'deck');
  assert.equal(piece.count, 2);
  assert.deepEqual(room.deckCards.get(id), cards);
  assert.notEqual(room.deckCards.get(id), cards);
  assert.deepEqual(readProps(piece), {
    back: 'shared-back',
    tile: 'domino',
    open: true,
    cover: 'back-two',
  });
  assert.deepEqual([body.position.x, body.position.y, body.position.z], [1, 2, 3]);
  assert.equal(room.world.bodies.includes(body), true);
  assert.deepEqual(colliderUpdates, [['deck', id]]);
});

test('removePiece clears the body, synchronized state, and every private piece map', () => {
  const { lifecycle, room } = harness();
  const id = lifecycle.spawn(room, 'card', [0, 1, 0], { back: 'blue' });
  room.targets.set(id, {});
  room.flips.set(id, {});
  room.cardData.set(id, { front: 'ace' });

  lifecycle.removePiece(room, id);

  assert.equal(room.world.bodies.length, 0);
  for (const map of [
    room.bodies,
    room.targets,
    room.flips,
    room.deckCards,
    room.cardData,
    room.state.pieces,
  ]) {
    assert.equal(map.has(id), false);
  }
});

test('release clears ownership, arms the landing cue, and caps card throws', () => {
  const { lifecycle, room } = harness();
  const id = lifecycle.spawn(room, 'card', [0, 1, 0], { back: 'blue' });
  const piece = room.state.pieces.get(id);
  const body = room.bodies.get(id);
  piece.owner = 'session';
  room.targets.set(id, {});

  lifecycle.releasePiece(room, id, [100, 0, 0]);

  assert.equal(piece.owner, '');
  assert.equal(room.targets.has(id), false);
  assert.equal(room._released.get(id), 1234);
  assert.ok(Math.abs(body.velocity.x - SIM.cards.maxThrow) < 1e-9);
  assert.equal(body.velocity.y, 0);
  assert.equal(body.velocity.z, 0);
});

test('release snaps flagged non-decks before applying throw velocity', () => {
  const { lifecycle, room } = harness();
  room.state.scale = { gridStyle: 'square', cellWorld: 1 };
  const id = lifecycle.spawn(room, 'prop', [0.2, 1, 0.2], { shape: 'box', snap: true });
  const body = room.bodies.get(id);

  lifecycle.releasePiece(room, id, [10, 10, 10]);

  assert.deepEqual([body.position.x, body.position.z], [0.5, 0.5]);
  assert.deepEqual([body.velocity.x, body.velocity.y, body.velocity.z], [0, 0, 0]);
  assert.deepEqual(
    [body.angularVelocity.x, body.angularVelocity.y, body.angularVelocity.z],
    [0, 0, 0],
  );
});
