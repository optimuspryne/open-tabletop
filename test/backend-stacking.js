import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as CANNON from 'cannon-es';
import { buildWorld } from '../server/physics.js';
import { createDeckBuilders } from '../server/game/deck-builders.js';
import { createPieceLifecycle } from '../server/game/piece-lifecycle.js';
import { updateDeckCollider } from '../server/game/collider-maintenance.js';
import { registerMovementHandlers } from '../server/game/handlers/movement.js';
import { registerPlacementHandlers } from '../server/game/handlers/placement.js';
import { spawnTableCard } from '../server/game/card-transfer.js';
import { driveHeldPieces, maintainSnapPins } from '../server/game/physics-update.js';
import { standOf } from '../server/game/piece-operations.js';
import {
  pinPiece,
  unpinPiece,
  writeTransform,
  wantsSnap,
} from '../server/game/placement-operations.js';
import { assistStackPlacement, hasStackSupport, STACKING } from '../server/game/stacking.js';
import { readProps } from '../server/game/props-codec.js';
import {
  cardPublicProps,
  cardGeom,
  PROPS,
  gridActive,
  gridFootprintCells,
  snapToCell,
} from '../shared/pieces.js';
import { serializeScene, applyScene } from '../server/game/scene-persistence.js';
import { spawnPayload, propRecordPayload } from '../server/message-validation.js';
import { cardCompatibilityKey, deckSpawnProps } from '../server/deck-state.js';

const CARD_HALF = cardGeom().th;

const sim = {
  gravity: -20,
  friction: 0.35,
  restitution: 0.2,
  solverIterations: 12,
  servo: { stiffness: 25, maxSpeed: 45, angDamp: 0.6 },
  contact: { stiffness: 1e7, relaxation: 3 },
  absorb: { x: 1.1, z: 1.4 },
  cards: {
    angDamp: 0.7,
    colliderThick: 0,
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

function fixture() {
  const handlers = new Map();
  const lifecycle = createPieceLifecycle({
    deckBuilders: createDeckBuilders({ shuffle: (cards) => cards }),
    dropSfx: () => 'card-drop',
    geoOf: cardPublicProps,
    sim,
  });
  const room = {
    _released: new Map(),
    bodies: new Map(),
    cardData: new Map(),
    deckCards: new Map(),
    flips: new Map(),
    groups: new Map(),
    targets: new Map(),
    nextId: 1,
    state: { pieces: new Map(), scale: { gridStyle: 'off' } },
    world: buildWorld(sim),
    standOf,
    broadcast() {},
    writeTransform,
    spawn(type, position, props, q = [0, 0, 0, 1], hidden) {
      return lifecycle.spawn(this, type, position, props, q, hidden);
    },
    removePiece(id) {
      lifecycle.removePiece(this, id);
    },
    releasePiece(id, velocity) {
      lifecycle.releasePiece(this, id, velocity);
    },
    updateDeckCollider(id) {
      updateDeckCollider(this, id);
    },
    pinPiece(id) {
      pinPiece(this, id);
    },
    unpinPiece(id) {
      unpinPiece(this, id);
    },
    wantsSnap(piece) {
      return wantsSnap(this, piece);
    },
    onMessage(name, fn) {
      handlers.set(name, fn);
    },
  };
  room.mat = room.world.__mat;
  const floor = new CANNON.Body({ mass: 0, material: room.mat });
  floor.addShape(new CANNON.Box(new CANNON.Vec3(10, 0.5, 8)));
  floor.position.y = -0.5;
  room.world.addBody(floor);
  registerMovementHandlers(room, { isMovable: () => true });
  const client = { sessionId: 'alice' };
  const place = (id, point, velocity = [0, 0, 0]) => {
    handlers.get('grab')(client, { id });
    handlers.get('move')(client, { id, ...point });
    handlers.get('release')(client, { id, v: velocity });
  };
  const step = (count = 240) => {
    for (let i = 0; i < count; i++) room.world.step(1 / 120);
  };
  return { room, handlers, lifecycle, place, step, client };
}

const near = (actual, expected, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should be close to ${expected}`);

test('real movement release aligns Mahjong tiles, keeps them separate, and publishes the transform', () => {
  const { room, place } = fixture();
  const lower = room.spawn('card', [0, 0.14, 0], { tile: 'mahjong' });
  room.bodies.get(lower).quaternion.setFromEuler(0, Math.PI / 2, 0);
  const upper = room.spawn('card', [2, 1, 0], { tile: 'mahjong', back: 'concealing-back' });
  room.cardData.set(upper, { front: 'private-tile' });
  place(upper, { x: 0.08, y: 1, z: 0.05 });
  const body = room.bodies.get(upper),
    piece = room.state.pieces.get(upper);
  near(body.position.x, 0);
  near(body.position.z, 0);
  near(body.position.y, 0.42 + STACKING.gap);
  near(body.quaternion.y, Math.sin(Math.PI / 4));
  near(piece.y, body.position.y);
  assert.equal(room.state.pieces.size, 2);
  assert.deepEqual(room.cardData.get(upper), { front: 'private-tile' });
  assert.equal(readProps(piece).front, undefined);
  assert.equal(body.velocity.length(), 0);
});

test('overlapping sideways and diagonal tile drops recenter before disturbing an existing stack', () => {
  for (const [x, z] of [
    [0.3, 0],
    [0.4, 0.4],
    [-0.3, 0],
  ]) {
    const { room, place, step } = fixture();
    const lower = room.spawn('card', [0, 0.14, 0], { tile: 'mahjong' });
    const middle = room.spawn('card', [0, 0.42 + STACKING.gap, 0], { tile: 'mahjong' });
    room.bodies.get(lower).sleep();
    room.bodies.get(middle).sleep();
    const upper = room.spawn('card', [2, 1, 0], { tile: 'mahjong' });
    place(upper, { x, y: 1, z });
    near(room.bodies.get(upper).position.x, 0);
    near(room.bodies.get(upper).position.z, 0);
    near(room.bodies.get(upper).position.y, 0.7 + 2 * STACKING.gap);
    step();
    for (const id of [lower, middle, upper]) {
      near(room.bodies.get(id).position.x, 0, 0.02);
      near(room.bodies.get(id).position.z, 0, 0.02);
    }
    assert.ok(room.bodies.get(upper).position.y > room.bodies.get(middle).position.y);
  }
});

test('gentle tilted tiles level onto the pile while preserving facing and the up/down face', () => {
  for (const degrees of [10, 35, 55]) {
    for (const down of [false, true]) {
      const { room, place, step } = fixture();
      const pile = [];
      for (let i = 0; i < 3; i++) {
        const id = room.spawn('card', [0, 0.14 + i * (0.28 + STACKING.gap), 0], {
          tile: 'mahjong',
        });
        room.bodies.get(id).sleep();
        pile.push(id);
      }
      const upper = room.spawn('card', [2, 2, 0], { tile: 'mahjong' });
      room.cardData.set(upper, { front: 'concealed' });
      room.bodies
        .get(upper)
        .quaternion.setFromEuler(
          down ? Math.PI - (degrees * Math.PI) / 180 : (degrees * Math.PI) / 180,
          0.3,
          0,
          'YXZ',
        );
      place(upper, { x: 0.2, y: 1, z: 0.1 });
      const body = room.bodies.get(upper);
      near(body.position.x, 0);
      near(body.position.y, 0.98 + 3 * STACKING.gap);
      near(body.quaternion.vmult(new CANNON.Vec3(0, 1, 0)).y, down ? -1 : 1);
      assert.deepEqual(room.cardData.get(upper), { front: 'concealed' });
      step();
      for (const id of [...pile, upper]) near(room.bodies.get(id).position.x, 0, 0.02);
      assert.ok(body.position.y > room.bodies.get(pile.at(-1)).position.y);
    }
  }
});

test('tilted offset cards are leveled without losing chosen facing or horizontal placement', () => {
  const { room, place } = fixture();
  room.spawn('card', [0, CARD_HALF, 0], {});
  const upper = room.spawn('card', [2, 2, 0], {});
  room.bodies.get(upper).quaternion.setFromEuler(0.5, 0.3, 0, 'YXZ');
  place(upper, { x: 0.25, y: 1, z: -0.3 });
  const body = room.bodies.get(upper);
  near(body.position.x, 0.25);
  near(body.position.z, -0.3);
  near(body.position.y, 3 * CARD_HALF + STACKING.gap);
  near(body.quaternion.y, Math.sin(0.15));
});

test('the real held servo levels a tilted corner before it collides with the pile', () => {
  const { room, handlers, client, step } = fixture();
  const pile = [];
  for (let i = 0; i < 3; i++) {
    const id = room.spawn('card', [0, 0.14 + i * (0.28 + STACKING.gap), 0], { tile: 'mahjong' });
    room.bodies.get(id).sleep();
    pile.push(id);
  }
  const upper = room.spawn('card', [0.2, 1, 0], { tile: 'mahjong' });
  room.bodies.get(upper).quaternion.setFromEuler(0.6, 0.3, 0, 'YXZ');
  handlers.get('grab')(client, { id: upper });
  handlers.get('move')(client, { id: upper, x: 0.2, y: 1, z: 0 });
  for (let i = 0; i < 60; i++) {
    driveHeldPieces(room, sim);
    room.world.step(1 / 120);
  }
  near(room.bodies.get(upper).quaternion.vmult(new CANNON.Vec3(0, 1, 0)).y, 1);
  near(room.bodies.get(upper).quaternion.y, Math.sin(0.15));
  for (const id of pile) near(room.bodies.get(id).position.x, 0, 0.02);
  handlers.get('release')(client, { id: upper, v: [0, 0, 0] });
  near(room.bodies.get(upper).position.x, 0);
  step();
  for (const id of [...pile, upper]) near(room.bodies.get(id).position.x, 0, 0.02);
});

test('tilted throws and tilted supports keep ordinary physics instead of leveling the stack', () => {
  const { room } = fixture();
  const lower = room.spawn('card', [0, 0.14, 0], { tile: 'mahjong' });
  const upper = room.spawn('card', [0.1, 1, 0], { tile: 'mahjong' });
  const body = room.bodies.get(upper);
  body.quaternion.setFromEuler(0.5, 0, 0);
  const original = body.quaternion.clone();
  assert.equal(assistStackPlacement(room, upper, null, [5, 0, 0]), false);
  assert.deepEqual(body.quaternion, original);
  room.bodies.get(lower).quaternion.setFromEuler(0.2, 0, 0);
  assert.equal(assistStackPlacement(room, upper, null, [0, 0, 0]), false);
  assert.deepEqual(body.quaternion, original);
});

test('private-hand play reaches stacking through production card methods and preserves private faces', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  const methods = ['spawnCardFlat', 'spawnHandCard'].map((name) => {
    const start = source.indexOf('  ' + name + '(');
    const end = source.indexOf('\n  }', start) + 4;
    return source.slice(start, end);
  });
  const production = runInNewContext('({' + methods.join(',') + '})', {
    gridActive,
    gridFootprintCells,
    snapToCell,
    geoOf: cardPublicProps,
    spawnTableCard,
  });
  for (const tile of [undefined, 'mahjong']) {
    for (const faceDown of [false, true]) {
      for (const enabled of [false, true]) {
        const { room, handlers, client, step } = fixture();
        Object.assign(room, production);
        room.hands = new Map();
        room.sendHand = () => {};
        registerPlacementHandlers(room, {
          randomPosition: () => [0, 3, 0],
          dropSfx: () => 'card-drop',
        });
        const props = tile ? { tile } : {};
        const half = tile ? 0.14 : CARD_HALF;
        const lower = room.spawn('card', [0, half, 0], props);
        room.bodies.get(lower).sleep();
        room.hands.set(client.sessionId, [
          { hid: 'h1', front: 'private-front', back: 'back', ...props, stackable: enabled },
        ]);
        const x = tile ? 0.2 : 0.25;
        handlers.get('playCard')(client, { hid: 'h1', faceDown, x, z: 0 });
        const upper = [...room.state.pieces.keys()].at(-1);
        const body = room.bodies.get(upper);
        assert.equal(room.hands.get(client.sessionId).length, 0);
        assert.equal(room.state.pieces.size, 2);
        const publicProps = readProps(room.state.pieces.get(upper));
        assert.equal(publicProps.stackable, enabled);
        assert.equal(publicProps.front, faceDown ? undefined : 'private-front');
        assert.deepEqual(
          room.cardData.get(upper),
          faceDown ? { front: 'private-front' } : undefined,
        );
        near(body.position.y, enabled ? 3 * half + STACKING.gap : 3);
        near(body.position.x, enabled && tile ? 0 : x);
        if (enabled) {
          step();
          near(room.bodies.get(lower).position.x, 0, 0.02);
          assert.ok(body.position.y > room.bodies.get(lower).position.y);
        }
      }
    }
  }
});

test('inventory placement reaches a pile above the ordinary hand-spawn altitude without affecting drag height limits', () => {
  const { room } = fixture();
  for (let i = 0; i < 12; i++) {
    const id = room.spawn('card', [0, 0.14 + i * (0.28 + STACKING.gap), 0], { tile: 'mahjong' });
    room.bodies.get(id).sleep();
  }
  const upper = room.spawn('card', [0, 3, 0], { tile: 'mahjong' });
  assert.equal(assistStackPlacement(room, upper, null, [0, 0, 0]), false);
  assert.equal(assistStackPlacement(room, upper, null, [0, 0, 0], { fromInventory: true }), true);
  near(room.bodies.get(upper).position.y, 0.14 + 12 * (0.28 + STACKING.gap));
});

test('near-edge card offsets remain independent and cards outside the support stay unassisted', () => {
  const { room, place } = fixture();
  room.spawn('card', [0, CARD_HALF, 0], { geom: { w: 0.35, h: 0.49 } });
  const upper = room.spawn('card', [2, 1, 0], { geom: { w: 0.35, h: 0.49 } });
  place(upper, { x: 0.3, y: 1, z: 0 });
  near(room.bodies.get(upper).position.x, 0.3);
  near(room.bodies.get(upper).position.y, 3 * CARD_HALF + STACKING.gap);
  const outside = room.spawn('card', [2, 1, 0], { geom: { w: 0.35, h: 0.49 } });
  assert.equal(assistStackPlacement(room, outside, { x: -0.36, y: 1, z: 0 }, [0, 0, 0]), false);
});

test('widened edge capture does not pull a tile into a taller neighboring wall column', () => {
  const { room, place } = fixture();
  room.spawn('card', [0, 0.14, 0], { tile: 'mahjong' });
  room.spawn('card', [0.7, 0.14, 0], { tile: 'mahjong' });
  room.spawn('card', [0.7, 0.42 + STACKING.gap, 0], { tile: 'mahjong' });
  const upper = room.spawn('card', [2, 1, 0], { tile: 'mahjong' });
  place(upper, { x: 0.3, y: 1, z: 0 });
  near(room.bodies.get(upper).position.x, 0);
  near(room.bodies.get(upper).position.y, 0.42 + STACKING.gap);
});

test('built-in PROPS entries provide stack defaults and explicit instance settings override them', () => {
  const original = { stackable: PROPS.cylinder.stackable, stackMode: PROPS.cylinder.stackMode };
  try {
    PROPS.cylinder.stackable = true;
    PROPS.cylinder.stackMode = 'offset';
    const { room, place } = fixture();
    room.spawn('prop', [0, 0.5, 0], { shape: 'cylinder' });
    const upper = room.spawn('prop', [2, 2, 0], { shape: 'cylinder' });
    place(upper, { x: 0.1, y: 2, z: 0 });
    near(room.bodies.get(upper).position.x, 0.1);
    near(room.bodies.get(upper).position.y, 1.5 + STACKING.gap);
    const disabled = room.spawn('prop', [2, 3, 0], { shape: 'cylinder', stackable: false });
    assert.equal(assistStackPlacement(room, disabled, { x: 0, y: 2, z: 0 }, [0, 0, 0]), false);
    const aligned = room.spawn('prop', [2, 3, 0], { shape: 'cylinder', stackMode: 'aligned' });
    place(aligned, { x: 0.2, y: 3, z: 0 });
    near(room.bodies.get(aligned).position.x, 0.1);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete PROPS.cylinder[key];
      else PROPS.cylinder[key] = value;
    }
  }
});

test('offset cards retain sideways/lengthwise placement and the held face and rotation', () => {
  const { room, place } = fixture();
  room.spawn('card', [0, CARD_HALF, 0], {});
  const upper = room.spawn('card', [2, 1, 0], { back: 'blue' });
  room.bodies.get(upper).quaternion.setFromEuler(Math.PI, 0.3, 0, 'YXZ');
  const original = room.bodies.get(upper).quaternion.clone();
  place(upper, { x: 0.25, y: 1, z: -0.3 });
  const body = room.bodies.get(upper);
  near(body.position.x, 0.25);
  near(body.position.z, -0.3);
  near(body.position.y, 3 * CARD_HALF + STACKING.gap);
  near(
    Math.abs(
      body.quaternion.x * original.x +
        body.quaternion.y * original.y +
        body.quaternion.z * original.z +
        body.quaternion.w * original.w,
    ),
    1,
  );
});

test('an explicit aligned mode centers ordinary cards and a single compound child is excluded', () => {
  const { room, place } = fixture();
  room.spawn('card', [0, CARD_HALF, 0], {});
  const aligned = room.spawn('card', [2, 1, 0], { stackMode: 'aligned' });
  place(aligned, { x: 0.25, y: 1, z: 0.1 });
  near(room.bodies.get(aligned).position.x, 0);
  near(room.bodies.get(aligned).position.z, 0);
  const compound = room.spawn('prop', [0, 1, 0], {
    model: '/assets/block.glb',
    box: [0.5, 0.5, 0.5],
    stackable: true,
    compoundCollider: {
      version: 1,
      shapes: [{ type: 'box', position: [0, 0, 0], size: [0.5, 0.5, 0.5], rotation: [0, 0, 0] }],
    },
  });
  assert.equal(room.bodies.get(compound).shapes.length, 1);
  assert.equal(assistStackPlacement(room, compound, null, [0, 0, 0]), false);
});

test('offset cards above a deck remain loose, while a centered card returns to inventory', () => {
  const { room, place } = fixture();
  const deck = room.spawn('deck', [0, 0.25, 0], { back: 'blue', cards: ['stock'] });
  const loose = room.spawn('card', [2, 1, 0], { back: 'blue' });
  room.cardData.set(loose, { front: 'loose' });
  place(loose, { x: 0.3, y: 1, z: 0 });
  assert.equal(room.state.pieces.has(loose), true);
  assert.deepEqual(room.deckCards.get(deck), ['stock']);
  room.removePiece(loose);
  const returned = room.spawn('card', [0, 1, 0], { back: 'blue' });
  room.cardData.set(returned, { front: 'returned' });
  place(returned, { x: 0, y: 1, z: 0 });
  assert.equal(room.state.pieces.has(returned), false);
  assert.deepEqual(room.deckCards.get(deck), ['stock', 'returned']);
});

test('offset placement uses the highest eligible support in a multi-card pile', () => {
  const { room, place, step } = fixture();
  room.spawn('card', [0, CARD_HALF, 0], {});
  for (let i = 1; i <= 3; i++) {
    const id = room.spawn('card', [2, 1, 0], {});
    place(id, { x: i * 0.2, y: 1, z: 0 });
    near(room.bodies.get(id).position.y, CARD_HALF + i * (2 * CARD_HALF + STACKING.gap));
  }
  step();
  for (const [id, body] of room.bodies) {
    assert.equal(body.type, CANNON.Body.DYNAMIC);
    near(body.position.x, (Number(id) - 1) * 0.2, 0.04);
    assert.ok(body.position.y > 0 && Number.isFinite(body.position.y));
  }
});

test('minimum-thickness rectangle and hex cards stack on the top layer without crossing each other', () => {
  for (const shape of ['rect', 'hex']) {
    const { room, place, step } = fixture();
    const geom = { w: 0.35, h: 0.5, t: 0.005, shape };
    const ids = [room.spawn('card', [0, geom.t, 0], { geom })];
    for (let i = 1; i < 4; i++) {
      const id = room.spawn('card', [2, 1, 0], { geom });
      place(id, { x: i * 0.03, y: 1, z: 0 });
      near(room.bodies.get(id).position.y, geom.t + i * (2 * geom.t + STACKING.gap));
      ids.push(id);
    }
    step();
    for (let i = 1; i < ids.length; i++) {
      const lower = room.bodies.get(ids[i - 1]),
        upper = room.bodies.get(ids[i]);
      assert.ok(
        upper.position.y - lower.position.y > geom.t,
        `${shape} cards must retain their layer order after physics settles`,
      );
    }
  }
});

test('stacking accepts opted-in box and cylinder props, without changing ordinary props', () => {
  for (const shape of ['box', 'poker_chip']) {
    const { room, place } = fixture();
    const props = { shape, stackable: true };
    const lower = room.spawn('prop', [0, 0.5, 0], props);
    const upper = room.spawn('prop', [2, 2, 0], props);
    const support = room.bodies.get(lower);
    assert.ok(support.shapes[0] instanceof (shape === 'box' ? CANNON.Box : CANNON.Cylinder));
    support.updateAABB();
    const top = support.aabb.upperBound.y;
    place(upper, { x: 0.05, y: 2, z: 0.05 });
    near(room.bodies.get(upper).position.x, 0);
    room.bodies.get(upper).updateAABB();
    near(room.bodies.get(upper).aabb.lowerBound.y, top + STACKING.gap);
  }
  const { room } = fixture();
  room.spawn('prop', [0, 0.5, 0], { shape: 'box' });
  const upper = room.spawn('prop', [0.1, 2, 0], { shape: 'box' });
  assert.equal(assistStackPlacement(room, upper, null, [0, 0, 0]), false);
});

test('legacy offset colliders stack using their actual bottoms, not the visual/body origin', () => {
  const { room, place } = fixture();
  const props = {
    model: '/assets/block.glb',
    box: [0.5, 0.25, 0.5],
    collider: 'flat',
    stackable: true,
  };
  const lower = room.spawn('prop', [0, 0.25, 0], props);
  const upper = room.spawn('prop', [2, 1, 0], props);
  room.bodies.get(lower).updateAABB();
  const top = room.bodies.get(lower).aabb.upperBound.y;
  place(upper, { x: 0.1, y: 1, z: 0 });
  room.bodies.get(upper).updateAABB();
  near(room.bodies.get(upper).aabb.lowerBound.y, top + STACKING.gap);
  assert.equal(hasStackSupport(room, upper), true);
});

test('throws, disabled stacking, hidden/held/moving/flipping supports and unsupported shapes are excluded', () => {
  for (const scenario of [
    'throw',
    'disabled',
    'hidden',
    'held',
    'moving',
    'flipping',
    'tipped',
    'bag',
    'compound',
    'outside',
    'too-high',
  ]) {
    const { room } = fixture();
    const lower = room.spawn(
      scenario === 'bag' ? 'deck' : 'card',
      [0, 0.14, 0],
      scenario === 'bag'
        ? { deckModel: 'bag', cards: ['tile'], tile: 'mahjong' }
        : { tile: 'mahjong' },
    );
    const upper = room.spawn('card', [0.1, 1, 0], {
      tile: 'mahjong',
      ...(scenario === 'disabled' ? { stackable: false } : {}),
    });
    if (scenario === 'hidden') room.state.pieces.get(lower).hidden = true;
    if (scenario === 'held') room.state.pieces.get(lower).owner = 'bob';
    if (scenario === 'moving') room.bodies.get(lower).velocity.x = 1;
    if (scenario === 'flipping') room.flips.set(lower, {});
    if (scenario === 'tipped') room.bodies.get(lower).quaternion.setFromEuler(Math.PI / 2, 0, 0);
    if (scenario === 'compound')
      room.bodies.get(lower).addShape(new CANNON.Box(new CANNON.Vec3(1, 1, 1)));
    const target = {
      x: scenario === 'outside' ? 3 : 0.1,
      y: scenario === 'too-high' ? 6 : 1,
      z: 0,
    };
    const before = room.bodies.get(upper).position.clone();
    assert.equal(
      assistStackPlacement(room, upper, target, scenario === 'throw' ? [5, 0, 0] : [0, 0, 0]),
      false,
      scenario,
    );
    assert.deepEqual(room.bodies.get(upper).position, before);
  }
});

test('an obstructed landing retains the original pose instead of inserting into an occupied stack', () => {
  const { room } = fixture();
  room.spawn('card', [0, 0.14, 0], { tile: 'mahjong' });
  room.spawn('prop', [0, 0.45, 0], { shape: 'box' });
  const upper = room.spawn('card', [0.1, 1, 0.1], { tile: 'mahjong' });
  room.bodies.get(upper).quaternion.setFromEuler(0.3, 0.2, 0, 'YXZ');
  room.bodies.get(upper).angularVelocity.set(0.1, 0.2, 0.3);
  const before = room.bodies.get(upper).position.clone();
  const orientation = room.bodies.get(upper).quaternion.clone();
  const spin = room.bodies.get(upper).angularVelocity.clone();
  assert.equal(assistStackPlacement(room, upper, null, [0, 0, 0]), false);
  assert.deepEqual(room.bodies.get(upper).position, before);
  assert.deepEqual(room.bodies.get(upper).quaternion, orientation);
  assert.deepEqual(room.bodies.get(upper).angularVelocity, spin);
});

test('stacked grid pieces stay dynamic and wake when the lower piece is grabbed or removed', () => {
  for (const action of ['grab', 'remove']) {
    const { room, handlers, client, place, step } = fixture();
    room.state.scale = { gridStyle: 'square', cellWorld: 1, snapAnchor: 'cross' };
    const lower = room.spawn('card', [0, 0.14, 0], { tile: 'mahjong', snap: true });
    const upper = room.spawn('card', [2, 1, 0], { tile: 'mahjong', snap: true });
    place(upper, { x: 0, y: 1, z: 0 });
    assert.equal(hasStackSupport(room, upper), true);
    room.bodies.get(upper).sleep();
    maintainSnapPins(room, sim);
    assert.equal(room.bodies.get(upper).__pinned, undefined);
    if (action === 'grab') {
      handlers.get('grab')(client, { id: lower });
      assert.equal(room.bodies.get(upper).sleepState, CANNON.Body.AWAKE);
      room.bodies.get(upper).sleep();
      maintainSnapPins(room, sim);
      assert.equal(
        room.bodies.get(upper).__pinned,
        undefined,
        'pausing while holding the support must not freeze the piece above it',
      );
      room.bodies.get(upper).wakeUp();
      room.bodies.get(lower).position.x = 3;
    } else room.removePiece(lower);
    assert.equal(room.bodies.get(upper).sleepState, CANNON.Body.AWAKE);
    step();
    near(room.bodies.get(upper).position.y, 0.14, 0.02);
  }
});

test('multi-piece group release preserves arrangement instead of aligning group members independently', () => {
  const { room, handlers, client } = fixture();
  room.spawn('card', [0, 0.14, 0], { tile: 'mahjong' });
  const first = room.spawn('card', [0.1, 1, 0], { tile: 'mahjong' });
  const second = room.spawn('card', [1.1, 1, 0], { tile: 'mahjong' });
  handlers.get('grabGroup')(client, { ids: [first, second], anchor: first });
  handlers.get('releaseGroup')(client, { v: [0, 0, 0] });
  near(room.bodies.get(first).position.x, 0.1);
  near(room.bodies.get(second).position.x, 1.1);
  near(room.bodies.get(first).position.y, 1);
});

test('stacking settings are validated, inherited across card transfers, and retained by deck snapshots', () => {
  const settings = { stackable: false, stackMode: 'aligned' };
  const deck = { type: 'deck', props: settings };
  assert.deepEqual(spawnPayload(deck), deck);
  const model = {
    model: '/assets/block.glb',
    box: [0.5, 0.5, 0.5],
    scale: 1,
    stand: false,
    ...settings,
  };
  assert.deepEqual(propRecordPayload(model), model);
  assert.deepEqual(cardPublicProps({ ...settings, front: 'secret' }), settings);
  assert.deepEqual(deckSpawnProps(settings, ['secret']), {
    back: 'back',
    cards: ['secret'],
    ...settings,
  });
  for (const bad of [{ stackable: 'true' }, { stackMode: 'fan' }]) {
    assert.equal(spawnPayload({ type: 'deck', props: bad }), null);
    assert.equal(propRecordPayload({ ...model, ...bad }), null);
    assert.equal(
      spawnPayload({ type: 'prop', props: { shape: 'box', ...bad } }, { propKeys: ['box'] }),
      null,
    );
  }
  assert.notEqual(cardCompatibilityKey(settings), cardCompatibilityKey({}));
  assert.equal(
    cardCompatibilityKey({ stackable: true, stackMode: 'offset' }),
    cardCompatibilityKey({}),
  );
});

test('scene save/reload retains separate stacked transforms and private faces without attachment state', () => {
  const { room, place } = fixture();
  room.state.overlays = new Map();
  room.state.trays = new Map();
  room.pendingInspect = new Map();
  room.scaleSnapshot = () => ({ gridStyle: 'off' });
  const lower = room.spawn('card', [0, 0.14, 0], { tile: 'mahjong' });
  const upper = room.spawn('card', [2, 1, 0], { tile: 'mahjong', stackable: true });
  room.cardData.set(upper, { front: 'concealed-tile' });
  place(upper, { x: 0.05, y: 1, z: 0 });
  const snapshot = serializeScene(room);
  const restored = fixture().room;
  restored.clearTable = () => {};
  restored.buildBounds = () => {};
  restored.scheduleSave = () => {};
  restored.applyScale = (value) => {
    restored.state.scale = value;
  };
  restored.applyTrays = () => {};
  applyScene(restored, snapshot, {
    maxPieces: sim.maxPieces,
    overlayMax: 100,
    overlayKinds: new Set(),
    tableLimits: { minX: 1, maxX: 20, minZ: 1, maxZ: 20 },
  });
  assert.equal(restored.state.pieces.size, 2);
  near(restored.bodies.get(upper).position.y, room.bodies.get(upper).position.y);
  assert.equal(hasStackSupport(restored, upper), true);
  assert.equal(readProps(restored.state.pieces.get(upper)).front, undefined);
  assert.deepEqual(restored.cardData.get(upper), { front: 'concealed-tile' });
  restored.bodies.get(upper).sleep();
  restored.removePiece(lower);
  assert.equal(restored.bodies.get(upper).sleepState, CANNON.Body.AWAKE);
});
