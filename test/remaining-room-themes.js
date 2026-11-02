import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import { createRoomBackdrop } from '../public/rendering/rooms/room-backdrop.js';
import { seatLayoutFor } from '../public/table/presence.js';
import { inTable } from '../shared/pieces.js';
import { TABLE_FINISH } from '../public/rendering/table-geometry.js';
import { REMAINING_ROOM_THEMES } from '../public/rendering/rooms/remaining-room-themes.js';
const state = () => ({
  environment: 'standard',
  tableX: 10,
  tableZ: 7,
  tableShape: 'roundedRect',
  feltColor: '#123456',
  rimWood: 'walnut',
  lighting: { preset: 'day' },
  skybox: 'saved-sky',
  players: new Map([
    ['one', { seat: 0 }],
    ['two', { seat: 2 }],
    ['observer', { seat: 3, participation: 'spectator' }],
  ]),
});

function fixture(phone = false, models = false) {
  const scene = new THREE.Scene(),
    requests = [],
    textures = [];
  class TextureLoader {
    load(url) {
      textures.push(url);
      return new THREE.Texture();
    }
  }
  const context = new Proxy(
    {},
    {
      get: (_, key) => (key === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}),
    },
  );
  const backdrop = createRoomBackdrop({
    THREE: { ...THREE, TextureLoader },
    scene,
    seatLayoutFor,
    deviceClass: () => (phone ? 'phone' : 'desktop'),
    doc: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) },
    ...(models
      ? { modelLoader: { load: (url, done, _, fail) => requests.push({ url, done, fail }) } }
      : {}),
  });
  return { scene, backdrop, requests, textures };
}

for (const theme of Object.values(REMAINING_ROOM_THEMES)) {
  test(
    theme.name + ' follows occupancy, preserves state and sizes the enclosure around every table',
    () => {
      const f = fixture(),
        saved = { ...state(), environment: theme.id },
        before = structuredClone(saved);
      f.backdrop.sync(saved);
      assert.deepEqual(saved, before);
      const original = f.scene.children[0];
      assert.equal(original.children.filter((n) => n.name === theme.playArea.chairName).length, 2);
      saved.players.delete('two');
      f.backdrop.sync(saved);
      assert.equal(f.scene.children[0], original);
      assert.equal(original.children.filter((n) => n.name === theme.playArea.chairName).length, 1);
      for (const shape of ['rect', 'roundedRect', 'round', 'oval', 'hex'])
        for (const [x, z] of [
          [2, 1.4],
          [10, 7],
          [80, 2],
          [2, 80],
        ]) {
          f.backdrop.sync({ ...saved, tableShape: shape, tableX: x, tableZ: z });
          const root = f.scene.children[0];
          if (theme.assets.paver) {
            root.updateWorldMatrix(true, true);
            const half = root.userData.halfSize,
              columns = Math.min(32, Math.ceil((half.x * 2) / 7)),
              rows = Math.min(32, Math.ceil((half.z * 2) / 7));
            const ray = new THREE.Raycaster(
                new THREE.Vector3(
                  -half.x + (half.x * 2) / columns,
                  theme.structure.floorY + 0.3,
                  -half.z + (half.z * 2) / rows,
                ),
                new THREE.Vector3(0, -1, 0),
                0,
                1,
              ),
              hits = [];
            root.traverse((n) => {
              if (n.isMesh)
                (n.isInstancedMesh ? THREE.InstancedMesh : THREE.Mesh).prototype.raycast.call(
                  n,
                  ray,
                  hits,
                );
            });
            assert.ok(hits.length, 'Tile joints must have opaque ground below them');
          }
          const supports = root.getObjectByName(theme.name + ' table supports');
          supports.updateWorldMatrix(true, true);
          const bounds = new THREE.Box3().setFromObject(supports);
          assert.ok(Math.abs(bounds.min.y - theme.structure.floorY) < 0.001);
          assert.ok(Math.abs(bounds.max.y - TABLE_FINISH.rimBase) < 0.001);
          for (const xx of [bounds.min.x, bounds.max.x])
            for (const zz of [bounds.min.z, bounds.max.z])
              assert.ok(inTable(xx, zz, shape, x, shape === 'round' ? x : z));
          root.traverse((n) => {
            assert.ok(!n.isLight);
            if (n.isMesh) {
              const hits = [];
              n.raycast(null, hits);
              assert.equal(hits.length, 0);
              if (n.isInstancedMesh) assert.ok(n.count <= 2048);
            }
          });
        }
      f.backdrop.dispose();
      assert.equal(f.scene.children.length, 0);
    },
  );
  test(theme.name + ' keeps dressing on wall and ceiling cutaways', () => {
    const f = fixture();
    f.backdrop.sync({ ...state(), environment: theme.id });
    const root = f.scene.children[0];
    for (const kind of ['north', 'south', 'west', 'east'])
      if (theme.assets[kind])
        assert.equal(
          root.getObjectByName(kind + ' slot').parent,
          root.getObjectByName(theme.name + ' ' + kind + ' wall'),
        );
    f.backdrop.update(new THREE.Vector3(0, 60, 0));
    assert.equal(root.getObjectByName(theme.name + ' ceiling').visible, false);
    f.backdrop.update(new THREE.Vector3(0, 3, -100));
    assert.equal(root.getObjectByName(theme.name + ' north wall').visible, false);
    f.backdrop.update(new THREE.Vector3(0, 3, 0));
    assert.equal(root.getObjectByName(theme.name + ' north wall').visible, true);
    f.backdrop.dispose();
  });
  test(
    theme.name + ' shares loaded sibling resources, strips phone detail and releases late loads',
    () => {
      const f = fixture(true, true),
        saved = { ...state(), environment: theme.id };
      f.backdrop.sync(saved);
      assert.equal(f.requests.length, Object.keys(theme.assets).length);
      assert.equal(new Set(f.requests.map((r) => r.url)).size, f.requests.length);
      const disposed = new Map();
      for (const request of f.requests) {
        const model = new THREE.Group(),
          geometry = new THREE.BoxGeometry(1, 1, 1),
          material = new THREE.MeshPhysicalMaterial({
            normalMap: new THREE.Texture(),
            transmission: 0.6,
          });
        geometry.addEventListener('dispose', () =>
          disposed.set(geometry, (disposed.get(geometry) || 0) + 1),
        );
        model.add(new THREE.Mesh(geometry, material));
        request.done({ scene: model });
      }
      f.scene.traverse((n) => {
        if (n.isMesh) {
          assert.ok(!n.castShadow && !n.receiveShadow);
          for (const m of [n.material].flat()) assert.ok(!m.normalMap && !m.isMeshPhysicalMaterial);
        }
      });
      saved.players.delete('two');
      f.backdrop.sync(saved);
      assert.equal(disposed.size, 0);
      f.backdrop.sync({ ...saved, environment: 'standard' });
      assert.equal(disposed.size, f.requests.length);
      assert.ok([...disposed.values()].every((n) => n === 1));
      f.backdrop.sync(saved);
      const late = f.requests.at(-1);
      f.backdrop.dispose();
      let freed = 0;
      const geometry = new THREE.BoxGeometry(1, 1, 1);
      geometry.addEventListener('dispose', () => freed++);
      const model = new THREE.Group();
      model.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));
      late.done({ scene: model });
      assert.equal(freed, 1);
    },
  );
  test(theme.name + ' remains usable if peripheral models fail', () => {
    const f = fixture(false, true);
    f.backdrop.sync({ ...state(), environment: theme.id });
    f.requests.forEach((r) => r.fail());
    assert.equal(
      f.scene.children[0].children.filter((n) => n.name === theme.playArea.chairName).length,
      2,
    );
    f.backdrop.dispose();
  });
}
