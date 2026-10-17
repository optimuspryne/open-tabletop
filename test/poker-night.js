import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import { createRoomBackdrop } from '../public/rendering/rooms/room-backdrop.js';
import { POKER_NIGHT } from '../public/rendering/rooms/poker-night-theme.js';
import { seatLayoutFor } from '../public/table/presence.js';

function fixture(device = 'desktop') {
  const scene = new THREE.Scene(),
    loads = [],
    canvases = [];
  const context = new Proxy(
    {},
    {
      get: (_, key) => (key === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}),
    },
  );
  class TextureLoader {
    load(url) {
      loads.push(url);
      return new THREE.Texture();
    }
  }
  const backdrop = createRoomBackdrop({
    THREE: { ...THREE, TextureLoader },
    scene,
    seatLayoutFor,
    deviceClass: () => device,
    doc: {
      createElement() {
        const canvas = { width: 0, height: 0, getContext: () => context };
        canvases.push(canvas);
        return canvas;
      },
    },
  });
  return { scene, backdrop, loads, canvases };
}

const state = (shape = 'roundedRect') => ({
  environment: 'poker-night',
  tableX: 10,
  tableZ: 7,
  tableShape: shape,
  rimWood: 'birch',
  feltColor: '#123456',
  skybox: 'saved-sky',
  lighting: { preset: 'day' },
  players: new Map([
    ['a', { seat: 0 }],
    ['b', { seat: 2 }],
    ['watcher', { seat: 4, participation: 'spectator' }],
  ]),
});

test('registered Poker Night preserves gameplay settings, reconciles seats and releases resources on switches', () => {
  const f = fixture();
  const saved = state(),
    original = structuredClone(saved);
  f.backdrop.sync(saved);
  const root = f.scene.children[0];
  assert.equal(root.userData.roomTheme, 'poker-night');
  assert.deepEqual(saved, original);
  assert.equal(root.children.filter((child) => child.name === 'Poker leather chair').length, 2);
  const resources = new Set();
  root.traverse((node) => {
    assert.ok(!node.isLight, 'Room must retain the independently saved lighting');
    if (!node.isMesh) return;
    const hits = [];
    node.raycast(null, hits);
    assert.deepEqual(hits, [], 'Scenery must not intercept gameplay picking');
    resources.add(node.geometry);
    for (const material of [node.material].flat()) {
      resources.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
    }
  });
  const disposed = new Map();
  for (const resource of resources)
    resource.addEventListener('dispose', () =>
      disposed.set(resource, (disposed.get(resource) || 0) + 1),
    );
  const loads = f.loads.length;
  saved.players.delete('b');
  f.backdrop.sync(saved);
  assert.ok(f.scene.children[0] === root, 'Seat changes must retain the room root');
  assert.equal(f.loads.length, loads);
  assert.equal(root.children.filter((child) => child.name === 'Poker leather chair').length, 1);
  assert.equal(disposed.size, 0, 'Departing chairs must retain shared template resources');
  f.backdrop.sync({ ...saved, environment: 'standard' });
  assert.equal(f.scene.children.length, 0);
  for (const resource of resources) assert.equal(disposed.get(resource), 1);
  assert.ok(f.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));
  f.backdrop.sync(saved);
  assert.ok(f.scene.children[0] !== root, 'Returning to Poker Night must create a fresh root');
  f.backdrop.dispose();
  f.backdrop.dispose();
});

test('Poker Night walls, ceiling and pendant keep seated views and cut away above or outside the room', () => {
  const f = fixture();
  f.backdrop.sync(state());
  const root = f.scene.children[0];
  const ceiling = root.getObjectByName('Poker ceiling');
  const north = root.getObjectByName('Poker north wall');
  f.backdrop.update(new THREE.Vector3(0, 3, 13));
  assert.equal(ceiling.visible, true);
  for (const wall of ['north', 'south', 'east', 'west'])
    assert.equal(root.getObjectByName(`Poker ${wall} wall`).visible, true);
  const bounds = root.userData.halfSize;
  f.backdrop.update(new THREE.Vector3(0, 3, -bounds.z - 1));
  assert.equal(north.visible, false);
  assert.ok(
    root.getObjectByName('Poker folded curtain').parent.parent === north,
    'The window fallback and its curtains must follow the north wall cutaway',
  );
  f.backdrop.update(new THREE.Vector3(0, 40, 0));
  assert.equal(ceiling.visible, false);
  assert.ok(
    root.getObjectByName('Poker pendant').parent === ceiling,
    'The pendant must follow the ceiling cutaway',
  );
  const roof = ceiling.children.find((node) => node.isMesh && !node.isInstancedMesh);
  assert.equal(roof.castShadow, false, 'Opaque roof must not block the independent sun');
  f.backdrop.update(new THREE.Vector3(0, 3, 0));
  assert.equal(north.visible, true);
  assert.equal(ceiling.visible, true);
  f.backdrop.dispose();
});

test('Poker Night stays bounded across table shapes/sizes and uses phone-safe materials and maps', () => {
  for (const device of ['desktop', 'phone']) {
    const f = fixture(device);
    for (const shape of ['rect', 'roundedRect', 'round', 'oval', 'hex']) {
      for (const size of [2, 10, 80]) {
        f.backdrop.sync({ ...state(shape), tableX: size, tableZ: size * 0.7 });
        const root = f.scene.children[0];
        let meshes = 0;
        root.traverse((node) => {
          if (!node.isMesh) return;
          meshes++;
          assert.ok(node.geometry.attributes.position.count > 0);
          if (device === 'phone') {
            assert.equal(node.castShadow, false);
            assert.equal(node.receiveShadow, false);
            for (const material of [node.material].flat()) {
              assert.ok(!material.isMeshPhysicalMaterial && !material.normalMap);
            }
          }
        });
        assert.ok(meshes < 85, `Room mesh budget exceeded: ${meshes}`);
        const rug = root.getObjectByName('Poker woven rug');
        assert.equal(
          rug.material.map.image.width,
          device === 'phone' ? POKER_NIGHT.phoneTextureSize : POKER_NIGHT.textureSize,
        );
      }
    }
    if (device === 'phone') assert.ok(f.loads.every((url) => !url.includes('normal')));
    f.backdrop.dispose();
  }
});

test('Poker rear door clips plaster, wainscot and trim and follows the south cutaway', () => {
  const f = fixture();
  f.backdrop.sync(state());
  const root = f.scene.children[0],
    south = root.getObjectByName('Poker south wall');
  const door = root.getObjectByName('Poker windowed door');
  assert.ok(
    door.parent === south && door.position.x > 0,
    'The approved offset keeps the door clear of the central pendant',
  );
  root.updateWorldMatrix(true, true);
  for (const height of [0.05, 3, 5.7, 12.6, 15.5]) {
    const origin = new THREE.Vector3(door.position.x, POKER_NIGHT.floorY + height, 3).applyMatrix4(
      south.matrixWorld,
    );
    const ray = new THREE.Raycaster(
      origin,
      new THREE.Vector3(0, 0, -1).transformDirection(south.matrixWorld),
    );
    const hits = [];
    for (const mesh of south.children.filter((o) => o.isMesh))
      (mesh.isInstancedMesh ? THREE.InstancedMesh : THREE.Mesh).prototype.raycast.call(
        mesh,
        ray,
        hits,
      );
    assert.equal(hits.length, 0, 'Opaque dressing closes the door at ' + height);
  }
  f.backdrop.update(new THREE.Vector3(0, 3, root.userData.halfSize.z + 1));
  assert.equal(south.visible, false);
  f.backdrop.dispose();
});
