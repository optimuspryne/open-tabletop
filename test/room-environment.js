import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import { createRoomEnvironment } from '../public/rendering/rooms/room-environment.js';
import { getRoomTheme } from '../public/rendering/rooms/room-themes.js';

function fixture({ device = 'desktop', fail = false } = {}) {
  const scene = new THREE.Scene();
  const builds = [],
    palettes = [],
    bounds = [],
    loads = [];
  let rootCreated;
  const theme = {
    id: 'courtyard-test',
    name: 'Courtyard',
    structure: {
      floorY: -4,
      wallHeight: 0,
      clearance: 6,
      minimumHalfSize: 12,
      build({ root, layout, assembly, materials }) {
        rootCreated = root;
        builds.push(layout);
        assembly.box(
          root,
          [layout.rx * 2, 0.1, layout.rz * 2],
          [0, layout.floor, 0],
          '#ffffff',
          materials.plain,
        );
        return { anchors: new Map([['entry', root]]) };
      },
    },
    // No openings, playArea, furnishings, decoration, lights or assets are required.
    atmosphere: {
      createMaterials() {
        const palette = {
          plain: new THREE.MeshBasicMaterial(),
          unused: new THREE.MeshBasicMaterial({ map: new THREE.Texture() }),
        };
        palettes.push(palette);
        return palette;
      },
    },
    ...(fail
      ? {
          decoration: {
            build() {
              throw new Error('bad decoration');
            },
          },
        }
      : {}),
  };
  const environment = createRoomEnvironment({
    theme,
    THREE,
    scene,
    deviceClass: () => device,
    doc: {},
    modelLoader: { load: (url) => loads.push(url) },
    onShadowBoundsChanged: (box) => bounds.push(box),
  });
  return { environment, scene, builds, palettes, bounds, loads, root: () => rootCreated };
}

test('a second theme reuses lifecycle without cozy assets, optional components or table mutations', () => {
  assert.equal(getRoomTheme('cozy').id, 'cozy');
  for (const id of [null, 'unknown', '__proto__', 'constructor'])
    assert.equal(getRoomTheme(id), null);
  const f = fixture();
  const state = Object.freeze({
    tableX: 10,
    tableZ: 7,
    tableShape: 'round',
    feltColor: '#123456',
    rimWood: 'walnut',
  });
  f.environment.sync(state);
  assert.equal(f.scene.children[0].userData.roomTheme, 'courtyard-test');
  assert.deepEqual(f.scene.children[0].userData.halfSize, { x: 16, z: 16 });
  assert.deepEqual(f.loads, []);
  assert.equal(state.rimWood, 'walnut');
  assert.equal(state.feltColor, '#123456');
  const root = f.root();
  f.environment.sync({ ...state, players: new Map() });
  f.environment.update(new THREE.Vector3(10, 4, 0), new THREE.Vector3());
  assert.equal(f.root(), root);
  assert.equal(f.builds.length, 1);
  const calls = new Map();
  const old = f.palettes[0];
  for (const resource of [old.plain, old.unused, old.unused.map])
    resource.addEventListener('dispose', () => calls.set(resource, (calls.get(resource) || 0) + 1));
  f.environment.sync({ ...state, tableX: 14 });
  assert.equal(f.scene.children.length, 1);
  for (const resource of [old.plain, old.unused, old.unused.map])
    assert.equal(calls.get(resource), 1);
  f.environment.dispose();
  f.environment.dispose();
  assert.equal(f.scene.children.length, 0);
  assert.equal(f.bounds.at(-1), null);
  f.environment.sync(state);
  assert.equal(f.builds.length, 2);
});

test('framework applies phone shadow policy and ignores invalid dimensions', () => {
  const f = fixture({ device: 'phone' });
  f.environment.sync({ tableX: NaN, tableZ: 7 });
  assert.equal(f.builds.length, 0);
  f.environment.sync({ tableX: 10, tableZ: 7 });
  f.root().traverse((node) => {
    if (node.isMesh) {
      assert.equal(node.castShadow, false);
      assert.equal(node.receiveShadow, false);
    }
  });
  assert.ok(f.bounds.every((bound) => bound === null));
  f.environment.dispose();
});

test('failed component builds clean palette and hierarchy and remain retryable', () => {
  const f = fixture({ fail: true });
  const state = { tableX: 10, tableZ: 7 };
  assert.throws(() => f.environment.sync(state), /bad decoration/);
  assert.equal(f.scene.children.length, 0);
  assert.equal(f.root().userData.ottDisposed, true);
  assert.equal(f.bounds.at(-1), null);
  assert.throws(() => f.environment.sync(state), /bad decoration/);
  assert.equal(f.builds.length, 2);
  f.environment.dispose();
});
