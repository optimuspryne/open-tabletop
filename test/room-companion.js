import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import { createRoomBackdrop } from '../public/rendering/rooms/room-backdrop.js';
import { ROOM_COMPANION_ASSETS } from '../public/rendering/rooms/room-companion.js';
import { getRoomTheme } from '../public/rendering/rooms/room-themes.js';
import { seatLayoutFor } from '../public/table/presence.js';
import { TABLE_SHAPES, tableOutline } from '../shared/pieces.js';

const themes = ['cozy', 'poker-night', 'medieval-tavern', 'modern-bar'];
const players = new Map(Array.from({ length: 8 }, (_, seat) => [String(seat), { seat }]));

function fixture(device = 'desktop') {
  const scene = new THREE.Scene();
  const loads = [];
  const context = new Proxy(
    {},
    { get: (_, key) => (key.includes('Gradient') ? () => ({ addColorStop() {} }) : () => {}) },
  );
  const backdrop = createRoomBackdrop({
    THREE: {
      ...THREE,
      TextureLoader: class {
        load() {
          return new THREE.Texture();
        }
      },
    },
    scene,
    seatLayoutFor,
    deviceClass: () => device,
    modelLoader: { load: (url, done, _, fail) => loads.push({ url, done, fail }) },
    doc: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) },
  });
  return { scene, loads, backdrop };
}

function dogModel() {
  const scene = new THREE.Group();
  const geometry = new THREE.BoxGeometry(0.6314, 0.28491, 0.5478);
  const material = new THREE.MeshStandardMaterial({ normalMap: new THREE.Texture() });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 0.28491 / 2;
  scene.add(mesh);
  return { scene, geometry, material };
}

for (const device of ['desktop', 'phone']) {
  test(`all furnished rooms own one corner dog across sizes/shapes on ${device}`, () => {
    const f = fixture(device);
    for (const environment of themes) {
      assert.equal(getRoomTheme(environment).assets.pup.url, ROOM_COMPANION_ASSETS.pup.url);
      for (const tableShape of TABLE_SHAPES) {
        for (const [tableX, tableZ] of [
          [2, 2],
          [10, 7],
          [30, 2],
          [30, 30],
        ]) {
          const state = { environment, tableShape, tableX, tableZ, players };
          const unchanged = structuredClone(state);
          const start = f.loads.length;
          f.backdrop.sync(state);
          assert.deepEqual(state, unchanged);
          const root = f.scene.children[0];
          const slot = root.getObjectByName('Resting gray dog');
          assert.ok(slot);
          assert.equal(root.children.filter((n) => n.name === slot.name).length, 1);
          const pending = f.loads
            .slice(start)
            .filter((l) => l.url === ROOM_COMPANION_ASSETS.pup.url);
          assert.equal(pending.length, 1);
          const model = dogModel();
          pending[0].done(model);
          f.scene.updateMatrixWorld(true);
          const loaded = slot.children.find(
            (n) => n.name === getRoomTheme(environment).assets.pup.name,
          );
          const bounds = new THREE.Box3().setFromObject(loaded);
          const half = root.userData.halfSize;
          assert.ok(bounds.min.x > -half.x + 0.5);
          assert.ok(bounds.max.z < half.z - 0.5);
          assert.ok(bounds.max.x < -tableX, 'Bed must stay outside the play surface');
          const tableFront = Math.max(...tableOutline(tableShape, tableX, tableZ).map((p) => p.z));
          assert.ok(bounds.min.z > tableFront);
          assert.ok(Math.abs(bounds.min.y - getRoomTheme(environment).structure.floorY) < 0.001);
          const fallback = slot.getObjectByName('Dog bed fallback');
          fallback.traverse((node) => {
            if (node.isMesh) assert.equal(node.visible, false);
          });
          slot.traverse((node) => {
            if (!node.isMesh) return;
            const hits = [];
            node.raycast(null, hits);
            assert.deepEqual(hits, []);
            if (device === 'phone') assert.equal(node.castShadow || node.receiveShadow, false);
          });
          assert.equal(loaded.scale.x, 7);
          if (device === 'phone') assert.equal(loaded.children[0].material.normalMap, null);
          const count = f.loads.length;
          f.backdrop.sync(state);
          assert.equal(f.loads.length, count, 'Unchanged layouts must not reload the dog');
        }
      }
    }
    f.backdrop.sync({ environment: 'standard', tableX: 10, tableZ: 7 });
    assert.equal(f.scene.children.length, 0);
    f.backdrop.dispose();
  });
}

test('missing dog retains a usable bed; retired model callbacks release resources once', () => {
  const f = fixture();
  const state = { environment: 'cozy', tableX: 10, tableZ: 7, players };
  f.backdrop.sync(state);
  const pending = f.loads.find((l) => l.url === ROOM_COMPANION_ASSETS.pup.url);
  pending.fail(new Error('missing optional scenery'));
  const root = f.scene.children[0];
  root.getObjectByName('Dog bed fallback').traverse((n) => {
    if (n.isMesh) assert.equal(n.visible, true);
  });
  f.backdrop.sync({ ...state, environment: 'standard' });
  const stale = dogModel();
  let released = 0;
  stale.geometry.addEventListener('dispose', () => released++);
  pending.done(stale);
  assert.equal(released, 1);
  assert.equal(f.scene.children.length, 0);
  f.backdrop.sync(state);
  const live = dogModel();
  let liveReleased = 0;
  live.geometry.addEventListener('dispose', () => liveReleased++);
  f.loads.findLast((l) => l.url === ROOM_COMPANION_ASSETS.pup.url).done(live);
  assert.equal(liveReleased, 0);
  f.backdrop.dispose();
  f.backdrop.dispose();
  assert.equal(liveReleased, 1);
});
