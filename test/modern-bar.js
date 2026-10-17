import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import { createRoomBackdrop } from '../public/rendering/rooms/room-backdrop.js';
import { seatLayoutFor } from '../public/table/presence.js';
import { inTable, tableOutline } from '../shared/pieces.js';
import { TABLE_FINISH } from '../public/rendering/table-geometry.js';
import { MODERN_BAR } from '../public/rendering/rooms/modern-bar-theme.js';

const state = () => ({
  environment: 'modern-bar',
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

test('Modern follows occupancy and table shapes without changing saved gameplay or lighting', () => {
  const f = fixture(),
    saved = state(),
    original = structuredClone(saved);
  f.backdrop.sync(saved);
  assert.deepEqual(saved, original);
  const root = f.scene.children[0];
  const chairs = () => root.children.filter((o) => o.name === 'Modern occupied chair');
  assert.equal(chairs().length, 2);
  saved.players.delete('two');
  f.backdrop.sync(saved);
  assert.ok(f.scene.children[0] === root, 'Roster updates retain the owned scenery');
  assert.equal(chairs().length, 1);
  for (const tableShape of ['rect', 'roundedRect', 'round', 'oval', 'hex'])
    for (const tableX of [2, 10, 80]) {
      f.backdrop.sync({ ...saved, tableShape, tableX, tableZ: tableX * 0.7 });
      let meshes = 0;
      f.scene.traverse((o) => {
        assert.ok(!o.isLight, 'Scenery must preserve independent room lighting');
        if (!o.isMesh) return;
        meshes++;
        const hits = [];
        o.raycast(null, hits);
        assert.equal(hits.length, 0);
        assert.ok(o.geometry.attributes.position.count > 0);
        if (o.isInstancedMesh) assert.ok(o.count <= 2048, 'Repeated scenery stays bounded');
      });
      assert.ok(meshes < 100, `Fallback draw budget: ${meshes}`);
    }
  f.backdrop.dispose();
});

test('Modern furnishings follow exterior/overhead cutaways and restore from inside', () => {
  const f = fixture();
  f.backdrop.sync(state());
  const root = f.scene.children[0],
    north = root.getObjectByName('Modern north wall');
  const west = root.getObjectByName('Modern west wall'),
    ceiling = root.getObjectByName('Modern ceiling');
  f.backdrop.update(new THREE.Vector3(0, 3, 12));
  assert.ok(north.visible && west.visible && ceiling.visible);
  assert.ok(root.getObjectByName('Modern bar slot').parent === north);
  assert.ok(root.getObjectByName('Modern city window').parent === west);
  assert.ok(
    root.getObjectByName('Modern stool slot').parent === root.getObjectByName('Modern north wall'),
  );
  assert.ok(root.getObjectByName('Modern table-pendant slot').parent === ceiling);
  f.backdrop.update(new THREE.Vector3(0, 60, 0));
  assert.equal(ceiling.visible, false);
  f.backdrop.update(new THREE.Vector3(0, 3, -root.userData.halfSize.z - 1));
  assert.equal(north.visible, false);
  f.backdrop.update(new THREE.Vector3(0, 3, 0));
  assert.ok(north.visible && ceiling.visible);
  f.backdrop.dispose();
});

test('Authored Modern loads each kind once, retains sibling resources and releases stale callbacks', () => {
  const f = fixture(true, true),
    saved = state();
  f.backdrop.sync(saved);
  assert.equal(f.requests.length, 13);
  assert.equal(new Set(f.requests.map((r) => r.url)).size, 13);
  const disposed = new Map();
  for (const request of f.requests) {
    const model = new THREE.Group(),
      geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshPhysicalMaterial({
      normalMap: new THREE.Texture(),
      transmission: 0.6,
    });
    material.name = /window|door/.test(request.url)
      ? 'Modern Bar clear glazing runtime'
      : 'Modern authored material';
    geometry.addEventListener('dispose', () =>
      disposed.set(geometry, (disposed.get(geometry) || 0) + 1),
    );
    model.add(new THREE.Mesh(geometry, material));
    request.done({ scene: model });
  }
  const root = f.scene.children[0];
  assert.ok(root.getObjectByName('Modern chair model'));
  assert.equal(root.getObjectByName('Modern clear glazing').visible, false);
  assert.equal(root.getObjectByName('Modern door glazing').visible, false);
  root.traverse((o) => {
    if (!o.isMesh) return;
    assert.equal(o.castShadow, false);
    assert.equal(o.receiveShadow, false);
    for (const m of [o.material].flat()) assert.ok(!m.isMeshPhysicalMaterial && !m.normalMap);
  });
  assert.ok(f.textures.every((url) => !url.includes('normal')));
  saved.players.delete('two');
  f.backdrop.sync(saved);
  assert.equal(disposed.size, 0);
  f.backdrop.sync({ ...saved, environment: 'standard' });
  assert.equal(disposed.size, 13);
  assert.ok([...disposed.values()].every((n) => n === 1));
  f.backdrop.sync(saved);
  const late = f.requests.at(-1);
  f.backdrop.dispose();
  const geometry = new THREE.BoxGeometry(1, 1, 1),
    material = new THREE.MeshStandardMaterial();
  let freed = 0;
  geometry.addEventListener('dispose', () => freed++);
  const model = new THREE.Group();
  model.add(new THREE.Mesh(geometry, material));
  late.done({ scene: model });
  assert.equal(freed, 1);
  assert.equal(f.scene.children.length, 0);
});

test('Missing Modern models retain usable fallback furnishings', () => {
  const f = fixture(false, true);
  f.backdrop.sync(state());
  f.requests.forEach((r) => r.fail());
  assert.ok(f.scene.children[0].getObjectByName('Modern occupied chair'));
  f.backdrop.dispose();
});

test('Modern pedestals connect floor to tabletop inside every outline and release on switches', () => {
  for (const phone of [false, true]) {
    const f = fixture(phone);
    for (const shape of ['rect', 'roundedRect', 'round', 'oval', 'hex'])
      for (const [hx, z] of [
        [2, 1.4],
        [10, 7],
        [80, 56],
        [80, 2],
        [2, 80],
      ]) {
        f.backdrop.sync({
          ...state(),
          tableShape: shape,
          tableX: hx,
          tableZ: z,
          players: new Map(),
        });
        const hz = shape === 'round' ? hx : z;
        const supports = f.scene.children[0].getObjectByName('Modern table supports');
        assert.ok(supports, 'The base must exist without occupied seats or loaded models');
        supports.updateWorldMatrix(true, true);
        const bounds = new THREE.Box3();
        supports.traverse((o) => {
          if (o.isMesh && !o.userData.cozyContactShadow)
            bounds.union(new THREE.Box3().setFromObject(o));
        });
        assert.ok(
          Math.abs(bounds.min.y - MODERN_BAR.floorY) < 1e-5,
          `Base floor ${bounds.min.y} for ${shape} ${hx}×${hz}`,
        );
        assert.ok(Math.abs(bounds.max.y - TABLE_FINISH.rimBase) < 1e-5);
        for (const x of [bounds.min.x, bounds.max.x])
          for (const depth of [bounds.min.z, bounds.max.z])
            assert.ok(
              inTable(x, depth, shape, hx, hz),
              `Base protrudes beyond ${shape} ${hx}×${hz}`,
            );
        const resources = new Set();
        supports.traverse((o) => {
          if (!o.isMesh) return;
          resources.add(o.geometry);
          if (phone) assert.ok(!o.castShadow && !o.receiveShadow);
        });
        let released = 0;
        for (const resource of resources) resource.addEventListener('dispose', () => released++);
        f.backdrop.sync({ ...state(), environment: 'standard' });
        assert.equal(released, resources.size);
      }
    f.backdrop.dispose();
  }
});

test('Modern enclosure follows the real outline for width-sized hex and round tables', () => {
  const f = fixture();
  for (const tableShape of ['hex', 'round', 'oval', 'rect', 'roundedRect']) {
    f.backdrop.sync({ ...state(), tableShape, tableX: 80, tableZ: 2 });
    const halfDepth = Math.max(
      ...tableOutline(tableShape, 80, 2).map((point) => Math.abs(point.z)),
    );
    assert.ok(f.scene.children[0].userData.halfSize.z >= halfDepth + MODERN_BAR.clearance);
  }
  f.backdrop.dispose();
});

test('Modern rear door and left nook keep their wall ownership and clear the playable area', () => {
  const f = fixture();
  for (const tableShape of ['rect', 'round', 'hex', 'oval']) {
    f.backdrop.sync({ ...state(), tableShape, tableX: 2, tableZ: 80 });
    const root = f.scene.children[0],
      south = root.getObjectByName('Modern south wall');
    const door = root.getObjectByName('Modern glass door'),
      nook = root.getObjectByName('Modern nook slot');
    assert.ok(door.parent === south && nook.parent === south);
    root.updateWorldMatrix(true, true);
    assert.ok(
      nook.getWorldPosition(new THREE.Vector3()).x > 0,
      'Nook belongs in the reverse viewer left corner',
    );
    for (const height of [1, 8, 15]) {
      const origin = new THREE.Vector3(door.position.x, MODERN_BAR.floorY + height, 3).applyMatrix4(
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
      assert.equal(hits.length, 0, 'Wall/skirting must not close the glazed entrance');
    }
    f.backdrop.update(new THREE.Vector3(0, 3, root.userData.halfSize.z + 1));
    assert.equal(south.visible, false);
  }
  f.backdrop.dispose();
});
