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
