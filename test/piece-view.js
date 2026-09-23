import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deckHeight } from '../shared/pieces.js';
import {
  createPieceView,
  meshPropsOf,
  pieceProperty,
  piecePropsOf,
  syncDeckMeshHeight,
} from '../public/table/piece-view.js';

const vector = () => ({
  values: [],
  set(...values) {
    this.values = values;
    return this;
  },
});

const quaternion = () => ({
  values: [],
  fraction: null,
  set(...values) {
    this.values = values;
    return this;
  },
  copy(other) {
    this.values = [...other.values];
    return this;
  },
  slerp(other, fraction) {
    this.target = [...other.values];
    this.fraction = fraction;
    return this;
  },
});

const testMesh = () => ({
  castShadow: false,
  receiveShadow: false,
  isMesh: true,
  position: vector(),
  quaternion: quaternion(),
  scale: { y: 1 },
  userData: {},
  visible: true,
  traverse(visitor) {
    visitor(this);
  },
});

test('piece props fall back safely and add dispenser-only mesh state', () => {
  assert.deepEqual(piecePropsOf({ props: '{bad json' }), {});
  assert.deepEqual(piecePropsOf({ props: 'null' }), {});
  assert.equal(pieceProperty({ props: '{"snap":true}' }, 'snap', false), true);
  assert.equal(pieceProperty({ props: '{}' }, 'snap', false), false);
  assert.deepEqual(meshPropsOf({ type: 'dispenser', props: '{"color":7}', count: 12 }, 'stack-a'), {
    color: 7,
    count: 12,
    _seed: 'stack-a',
  });
});

test('deck count updates resize the current mesh after a props-driven replacement', () => {
  const original = testMesh();
  const replacement = testMesh();
  const meshes = new Map([['deck', { mesh: original, type: 'deck' }]]);

  assert.equal(syncDeckMeshHeight(meshes, 'deck', 40, deckHeight), true);
  assert.equal(original.scale.y, deckHeight(40));

  meshes.get('deck').mesh = replacement;
  assert.equal(syncDeckMeshHeight(meshes, 'deck', 12, deckHeight), true);
  assert.equal(replacement.scale.y, deckHeight(12));
  assert.equal(original.scale.y, deckHeight(40));
});

test('a late count update is harmless after the deck mesh is removed', () => {
  assert.equal(syncDeckMeshHeight(new Map(), 'missing', 12, deckHeight), false);
});

test('piece replacement restores the last transform and keeps inspected meshes hidden', () => {
  const oldMesh = testMesh();
  const replacement = testMesh();
  const meshes = new Map([['piece-a', { mesh: oldMesh, type: 'prop' }]]);
  const buffers = new Map([
    ['piece-a', [{ t: 1, x: 4, y: 5, z: 6, qx: 0, qy: 0.5, qz: 0, qw: 0.5 }]],
  ]);
  const removed = [];
  const added = [];
  const refreshed = [];
  const view = createPieceView({
    scene: {
      remove: (mesh) => removed.push(mesh),
      add: (mesh) => added.push(mesh),
    },
    meshes,
    buffers,
    kinds: { prop: { mesh: () => replacement } },
    physics: { prop: { mass: 1 } },
    deckHeight,
    createQuaternion: quaternion,
    refreshCollider: (id, piece) => refreshed.push([id, piece]),
    isInspected: (id) => id === 'piece-a',
  });
  const piece = { type: 'prop', props: '{"color":7}' };

  assert.equal(view.rebuildPiece('piece-a', piece), true);
  assert.deepEqual(removed, [oldMesh]);
  assert.deepEqual(added, [replacement]);
  assert.equal(meshes.get('piece-a').mesh, replacement);
  assert.deepEqual(replacement.position.values, [4, 5, 6]);
  assert.deepEqual(replacement.quaternion.values, [0, 0.5, 0, 0.5]);
  assert.equal(replacement.castShadow, true);
  assert.equal(replacement.receiveShadow, true);
  assert.equal(replacement.userData.id, 'piece-a');
  assert.equal(replacement.visible, false);
  assert.deepEqual(refreshed, [['piece-a', piece]]);
  assert.equal(view.setOriginalVisible('piece-a', true), true);
  assert.equal(replacement.visible, true);
  assert.equal(view.setOriginalVisible('missing', false), false);
});

test('deck replacement reapplies procedural height but leaves modeled skins fixed', () => {
  const procedural = testMesh();
  const modeled = testMesh();
  const replacements = [procedural, modeled];
  const meshes = new Map([['deck-a', { mesh: testMesh(), type: 'deck' }]]);
  const view = createPieceView({
    scene: { remove() {}, add() {} },
    meshes,
    buffers: new Map(),
    kinds: { deck: { mesh: () => replacements.shift() } },
    physics: { deck: { mass: 1 } },
    deckHeight,
    createQuaternion: quaternion,
    refreshCollider() {},
    isInspected: () => false,
  });

  assert.equal(view.rebuildDeck('deck-a', { type: 'deck', props: '{}', count: 30 }), true);
  assert.equal(procedural.scale.y, deckHeight(30));
  assert.equal(
    view.rebuildDeck('deck-a', { type: 'deck', props: '{"model":"bag.glb"}', count: 4 }),
    true,
  );
  assert.equal(modeled.scale.y, 1);
});

test('snapshot sampling interpolates position and orientation between buffered states', () => {
  const view = createPieceView({
    scene: { remove() {}, add() {} },
    meshes: new Map(),
    buffers: new Map(),
    kinds: {},
    physics: {},
    deckHeight,
    createQuaternion: quaternion,
    refreshCollider() {},
    isInspected: () => false,
  });
  const mesh = testMesh();
  const buffer = [
    { t: 0, x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 },
    { t: 10, x: 10, y: 20, z: 30, qx: 0, qy: 1, qz: 0, qw: 0 },
  ];

  assert.equal(view.sample(buffer, 5, mesh), true);
  assert.deepEqual(mesh.position.values, [5, 10, 15]);
  assert.deepEqual(mesh.quaternion.values, [0, 0, 0, 1]);
  assert.deepEqual(mesh.quaternion.target, [0, 1, 0, 0]);
  assert.equal(mesh.quaternion.fraction, 0.5);
});

test('room bindings hydrate pieces, follow replacement/count patches and clean up in order', () => {
  const meshes = new Map(),
    buffers = new Map(),
    listeners = new Map(),
    events = [];
  const piece = (type, props = '{}') => ({
    type,
    props,
    count: 10,
    owner: '',
    x: 1,
    y: 2,
    z: 3,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
  });
  const pieces = new Map([
    ['deck', piece('deck')],
    ['model', piece('deck', '{"model":"bag"}')],
    ['stack', piece('dispenser')],
    ['board', piece('board', '{"model":"board","box":[2,0.3,2]}')],
  ]);
  let remove,
    time = 100;
  const cb = (object) => ({
    pieces: {
      onAdd: (fn) => pieces.forEach(fn),
      onRemove: (fn) => {
        remove = fn;
      },
    },
    listen(key, fn) {
      if (!listeners.has(object)) listeners.set(object, new Map());
      listeners.get(object).set(key, fn);
    },
  });
  const view = createPieceView({
    scene: { add() {}, remove: () => events.push('scene remove') },
    meshes,
    buffers,
    kinds: Object.fromEntries(
      ['deck', 'dispenser', 'board'].map((type) => [type, { mesh: testMesh }]),
    ),
    physics: { deck: { mass: 1 }, dispenser: { mass: 0 }, board: { mass: 0 } },
    deckHeight,
    createQuaternion: quaternion,
    refreshCollider: () => events.push('collider'),
    isInspected: () => false,
    now: () => time,
  });
  view.bindRoom({ state: { pieces } }, cb, {
    onHydration: () => events.push('hydrate'),
    onOwner: (id, owner) => events.push([id, owner]),
    onBoardTop: (height) => events.push(['board top', height]),
    onRemove: (id) => {
      assert.ok(meshes.has(id));
      events.push('feature cleanup');
    },
    disposeSurface: (id) => {
      assert.equal(meshes.has(id), false);
      assert.ok(buffers.has(id));
      events.push('surface');
    },
  });
  assert.equal(meshes.size, 4);
  assert.deepEqual(events.at(-1), ['board top', 0.6]);
  assert.equal(meshes.get('deck').mesh.userData.id, 'deck');
  assert.equal(meshes.get('deck').mesh.castShadow, true);
  assert.equal(meshes.get('board').mesh.castShadow, false);
  assert.deepEqual(buffers.get('deck')[0], {
    t: 100,
    x: 1,
    y: 2,
    z: 3,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
  });
  const deck = pieces.get('deck'),
    old = meshes.get('deck').mesh;
  listeners.get(deck).get('props')();
  const current = meshes.get('deck').mesh;
  assert.notEqual(current, old);
  deck.count = 3;
  listeners.get(deck).get('count')(3);
  assert.equal(current.scale.y, deckHeight(3));
  assert.equal(old.scale.y, deckHeight(10));
  assert.equal(listeners.get(pieces.get('model')).has('count'), false);
  deck.owner = 'remote';
  listeners.get(deck).get('owner')();
  assert.deepEqual(events.at(-1), ['deck', 'remote']);
  const stack = meshes.get('stack').mesh;
  listeners.get(pieces.get('stack')).get('count')();
  assert.notEqual(meshes.get('stack').mesh, stack);
  for (let i = 0; i < 30; i++) {
    time++;
    view.recordState({ pieces });
  }
  assert.equal(buffers.get('deck').length, 24);
  assert.equal(buffers.get('deck').at(-1).t, 130);
  events.length = 0;
  remove(deck, 'deck');
  assert.deepEqual(events, ['hydrate', 'scene remove', 'feature cleanup', 'surface']);
  assert.equal(buffers.has('deck'), false);
  view.recordState({ pieces });
  assert.equal(buffers.has('deck'), false);
});
