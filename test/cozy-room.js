import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import { createCozyRoom, COZY_ROOM } from '../public/rendering/cozy-room.js';
import { ROOM_SURFACES } from '../public/rendering/cozy-room-surfaces.js';
import { seatLayoutFor } from '../public/table/presence.js';
import { inTable } from '../shared/pieces.js';

const playersAt = (...seats) =>
  new Map(seats.map((seat, i) => [`player-${i}`, { seat, participation: 'player' }]));

function fixture({ canvasAvailable = true, models = false, device = 'desktop' } = {}) {
  const scene = new THREE.Scene(),
    loads = [],
    canvases = [],
    modelLoads = [],
    shadowBounds = [];
  let changes = 0;
  const context = new Proxy(
    {},
    {
      get: (_, key) =>
        ['createLinearGradient', 'createRadialGradient'].includes(key)
          ? () => ({ addColorStop() {} })
          : () => {},
    },
  );
  class TextureLoader {
    load(url, done) {
      const texture = new THREE.Texture();
      loads.push({ url, done, texture });
      return texture;
    }
  }
  const room = createCozyRoom({
    THREE: { ...THREE, TextureLoader },
    scene,
    modelLoader: models
      ? { load: (url, done, _, fail) => modelLoads.push({ url, done, fail }) }
      : undefined,
    textureAnisotropy: 4,
    deviceClass: () => device,
    onShadowBoundsChanged: (bounds) => shadowBounds.push(bounds),
    seatLayoutFor,
    onChanged: () => changes++,
    doc: {
      createElement() {
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => (canvasAvailable ? context : null),
        };
        canvases.push(canvas);
        return canvas;
      },
    },
  });
  return { room, scene, loads, modelLoads, canvases, shadowBounds, changes: () => changes };
}

test('cozy scenery builds once per size/shape and does not mutate gameplay state or picking', () => {
  const f = fixture();
  assert.equal(f.scene.children.length, 0);
  const state = {
    tableX: 10,
    tableZ: 7,
    tableShape: 'rect',
    pieces: new Map(),
    skybox: '/sky.jpg',
    players: playersAt(0, 1, 2),
  };
  const original = structuredClone(state);
  f.room.sync(state);
  const root = f.scene.children[0];
  assert.deepEqual(state, original);
  assert.equal(root.name, 'Cozy game room prototype');
  const bounds = new THREE.Box3().setFromObject(root);
  assert.ok(bounds.min.y <= COZY_ROOM.floorY);
  assert.ok(bounds.min.x < -state.tableX && bounds.max.x > state.tableX);
  assert.equal(root.children.filter((child) => child.name === 'Upholstered chair').length, 3);
  const initialLoads = f.loads.length;
  let draws = 0;
  root.traverse((node) => {
    assert.ok(!node.isLight, 'Backdrop should not replace or add lights');
    if (!node.isMesh) return;
    draws++;
    const hits = [];
    node.raycast(null, hits);
    assert.deepEqual(hits, []);
    if (
      [
        'Oak floor',
        'Staggered oak floorboards',
        'Woven rug',
        'Clear window glazing',
        'Textured plaster panel',
      ].includes(node.name) ||
      node.userData.cozyContactShadow
    )
      assert.equal(node.castShadow, false);
  });
  assert.ok(draws <= 80, `Backdrop should remain a bounded draw budget, got ${draws}`);
  f.room.sync(state);
  assert.equal(f.loads.length, initialLoads);
  assert.equal(f.scene.children[0], root);
  f.room.sync({ tableX: NaN, tableZ: 7 });
  assert.equal(f.scene.children[0], root);
  f.room.sync({ tableX: 2, tableZ: 2, tableShape: 'round' });
  assert.equal(f.scene.children.length, 1);
  assert.equal(
    f.scene.children[0].children.filter((child) => child.name === 'Upholstered chair').length,
    0,
  );
  f.room.dispose();
});

test('occupied chairs update without rebuilding the room or releasing shared model resources', () => {
  const f = fixture({ models: true });
  const state = { tableX: 10, tableZ: 7, players: playersAt() };
  f.room.sync(state);
  const root = f.scene.children[0];
  const chairs = () => root.children.filter((n) => n.name === 'Upholstered chair');
  assert.equal(chairs().length, 0);
  const loads = f.modelLoads.length;
  const textures = f.loads.length;
  state.players = playersAt(0, 2, 7);
  f.room.sync(state);
  assert.equal(chairs().length, 3);
  state.players = playersAt(1, 3);
  f.room.sync(state);
  const model = authoredModel();
  let releases = 0;
  for (const resource of [model.mesh.geometry, model.mesh.material, model.mesh.material.map])
    resource.addEventListener('dispose', () => releases++);
  f.modelLoads.find((load) => load.url === COZY_ROOM.furnitureURLs.chair).done(model);
  assert.deepEqual(
    chairs().map((n) => n.userData.seat),
    [1, 3],
  );
  assert.ok(chairs().every((n) => n.getObjectByName('Cozy chair model')));
  const unchanged = chairs();
  const changes = f.changes();
  state.players.get('player-0').timedOut = true;
  state.players.get('player-0').name = 'Renamed';
  f.room.sync(state);
  assert.deepEqual(chairs(), unchanged);
  assert.equal(f.changes(), changes);
  state.players.get('player-0').participation = 'spectator';
  state.players.set('invalid', { seat: '2' });
  state.players.set('unseated', { seat: -1 });
  state.players.set('outside', { seat: 8 });
  state.players.set('duplicate', { seat: 3 });
  f.room.sync(state);
  assert.deepEqual(
    chairs().map((n) => n.userData.seat),
    [3],
  );
  state.players.clear();
  f.room.sync(state);
  assert.equal(chairs().length, 0);
  assert.equal(releases, 0, 'Leaving must not dispose the owned template/shared resources');
  state.players = playersAt(6);
  f.room.sync(state);
  assert.ok(chairs()[0].getObjectByName('Cozy chair model'));
  assert.equal(f.scene.children[0], root);
  assert.equal(f.modelLoads.length, loads);
  assert.equal(f.loads.length, textures);
  f.room.dispose();
  assert.equal(releases, 3);
});

test('occupied chairs clear the real table outline and face their hand positions on all shapes', () => {
  const f = fixture();
  for (const tableShape of ['rect', 'roundedRect', 'round', 'oval', 'hex']) {
    const state = { tableX: 10, tableZ: 7, tableShape, players: playersAt(0, 1, 2, 3, 4, 5, 6, 7) };
    f.room.sync(state);
    const chairs = f.scene.children[0].children.filter((n) => n.name === 'Upholstered chair');
    assert.equal(chairs.length, 8);
    const layout = seatLayoutFor(10, 7);
    for (const chair of chairs) {
      const position = chair.position.clone().setY(0);
      assert.equal(inTable(position.x, position.z, tableShape, 10, 7), false);
      const nearEdge = position
        .clone()
        .addScaledVector(position.clone().normalize(), -COZY_ROOM.chairClearance - 0.001);
      assert.ok(inTable(nearEdge.x, nearEdge.z, tableShape, 10, 7));
      const hand = new THREE.Vector3(...layout[chair.userData.seat].hand).setY(0).normalize();
      assert.ok(position.clone().normalize().dot(hand) > 0.999);
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(chair.quaternion);
      assert.ok(back.dot(position) > 0);
    }
  }
  f.room.dispose();
});

test('camera cutaways remove near walls and their furnishings across seats and overhead views', () => {
  const f = fixture();
  f.room.sync({ tableX: 10, tableZ: 7, players: playersAt(0, 1, 2, 3, 4, 5, 6, 7) });
  const root = f.scene.children[0];
  const target = new THREE.Vector3(0, 0, 0);
  const visible = (name) => root.children.find((child) => child.name === name).visible;
  f.room.update(new THREE.Vector3(0, 10, 12), target);
  assert.equal(visible('South wall'), false);
  assert.equal(visible('North wall'), true);
  const unchanged = f.changes();
  f.room.update(new THREE.Vector3(0, 10, 12), target);
  assert.equal(f.changes(), unchanged);
  f.room.update(new THREE.Vector3(-12, 10, -12), target);
  assert.equal(visible('North wall'), false);
  assert.equal(visible('West wall'), false);
  assert.equal(visible('East wall'), true);
  assert.equal(visible('South wall'), true);
  f.room.update(new THREE.Vector3(0, 40, 0), target);
  for (const name of ['North wall', 'South wall', 'East wall', 'West wall'])
    assert.equal(visible(name), false);
  f.room.dispose();
});

test('resize/disposal releases owned instance buffers, geometry, materials and canvas textures once', () => {
  const f = fixture();
  f.room.sync({ tableX: 10, tableZ: 7 });
  const root = f.scene.children[0],
    resources = new Set();
  root.traverse((node) => {
    if (node.isInstancedMesh) resources.add(node);
    if (node.geometry) resources.add(node.geometry);
    if (node.material) {
      resources.add(node.material);
      for (const value of Object.values(node.material)) if (value?.isTexture) resources.add(value);
    }
  });
  const counts = new Map([...resources].map((resource) => [resource, 0]));
  for (const resource of resources)
    resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1));
  const oldFloor = root.children.find((child) => child.name === 'Staggered oak floorboards')
    .material.map;
  const oldCanvasCount = f.canvases.length;
  f.room.sync({ tableX: 20, tableZ: 12, tableShape: 'oval' });
  for (const count of counts.values()) assert.equal(count, 1);
  for (const canvas of f.canvases.slice(0, oldCanvasCount)) assert.equal(canvas.width, 0);
  const oldVersion = oldFloor.version;
  f.loads[0].done();
  assert.equal(oldFloor.version, oldVersion, 'Late wood loads should not revive a disposed room');
  const foreign = new THREE.Group();
  f.scene.add(foreign);
  f.room.dispose();
  f.room.dispose();
  f.room.sync({ tableX: 10, tableZ: 7 });
  assert.deepEqual(f.scene.children, [foreign]);
  assert.ok(f.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));
});

test('rug detail uses bounded device resolution, angled filtering and owned canvas cleanup', () => {
  for (const device of ['desktop', 'tablet', 'phone']) {
    const f = fixture({ device });
    f.room.sync({ tableX: 10, tableZ: 7 });
    const rug = f.scene.children[0].getObjectByName('Woven rug');
    const texture = rug.material.map;
    const size = device === 'phone' ? 512 : 1024;
    assert.equal(texture.image.width, size);
    assert.equal(texture.image.height, size);
    assert.equal(texture.anisotropy, device === 'phone' ? 1 : 4);
    assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
    assert.equal(texture.generateMipmaps, true);
    assert.equal(rug.material.bumpMap, null);
    assert.equal(rug.material.normalMap, null);
    f.room.dispose();
    assert.equal(texture.image.width, 0);
    assert.equal(texture.image.height, 0);
  }
});

test('canvas allocation failure retains usable matte scenery', () => {
  const f = fixture({ canvasAvailable: false });
  f.room.sync({ tableX: 10, tableZ: 7 });
  assert.equal(f.scene.children.length, 1);
  assert.equal(
    f.scene.children[0].children.find((child) => child.name === 'Woven rug').material.map,
    null,
  );
  f.room.dispose();
});

function authoredModel() {
  const scene = new THREE.Group();
  const map = new THREE.Texture();
  const normalMap = new THREE.Texture();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.49, 0.99, 0.52),
    new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.47 }),
  );
  mesh.position.y = 0.495;
  scene.add(mesh);
  return { scene, mesh };
}

test('authored furnishings preserve materials, share chair resources and follow wall cutaways', () => {
  const f = fixture({ models: true });
  f.room.sync({ tableX: 10, tableZ: 7, players: playersAt(0, 1, 2, 3, 4, 5, 6, 7) });
  const root = f.scene.children[0];
  assert.deepEqual(
    f.modelLoads.map((x) => x.url).sort(),
    Object.values(COZY_ROOM.furnitureURLs).sort(),
  );
  const models = f.modelLoads.map(() => authoredModel());
  const chairModel =
    models[f.modelLoads.findIndex((load) => load.url === COZY_ROOM.furnitureURLs.chair)];
  f.modelLoads.forEach((load, i) => load.done({ scene: models[i].scene }));
  const chairs = [];
  root.traverse((node) => {
    if (node.name === 'Cozy chair model') chairs.push(node);
  });
  assert.equal(chairs.length, 8);
  for (const chair of chairs) {
    assert.equal(chair.scale.x, COZY_ROOM.furnitureScale);
    assert.equal(chair.children[0].material, chairModel.mesh.material);
    assert.equal(chair.children[0].geometry, chairModel.mesh.geometry);
    assert.equal(chair.children[0].material.normalMap, chairModel.mesh.material.normalMap);
    assert.equal(chair.children[0].material.map.anisotropy, 4);
    assert.equal(chair.children[0].material.normalMap.anisotropy, 4);
    const hits = [];
    chair.children[0].raycast(null, hits);
    assert.deepEqual(hits, []);
    assert.ok(
      chair.parent.children
        .filter((n) => n.isMesh && !n.userData.cozyContactShadow)
        .every((n) => !n.visible),
    );
    chair.updateWorldMatrix(true, false);
    assert.ok(
      new THREE.Box3().setFromObject(chair).max.y > 0,
      'Chair backs should rise above the tabletop',
    );
    const front = new THREE.Vector3(0, 0, 1).transformDirection(chair.matrixWorld);
    assert.ok(
      front.dot(chair.parent.position.clone().setY(0)) < 0,
      'Chairs must face the table at cardinal and diagonal seats',
    );
  }
  const east = root.children.find((n) => n.name === 'East wall');
  assert.ok(east.getObjectByName('Cozy shelf model'));
  f.room.update(new THREE.Vector3(12, 10, 0), new THREE.Vector3());
  assert.equal(east.visible, false);
  assert.ok(root.getObjectByName('Cozy lamp model'));
  const panes = [];
  root.traverse((node) => {
    if (node.name === 'Clear window glazing') panes.push(node);
  });
  assert.equal(panes.length, 4);
  assert.ok(
    panes.every((node) => node.visible),
    'Loading frames must not hide clear glazing',
  );
  const counts = models.map(({ mesh }) => {
    const resources = [mesh.geometry, mesh.material, mesh.material.map, mesh.material.normalMap];
    const events = resources.map(() => 0);
    resources.forEach((r, i) => r.addEventListener('dispose', () => events[i]++));
    return events;
  });
  f.room.dispose();
  f.room.dispose();
  for (const events of counts) assert.deepEqual(events, [1, 1, 1, 1]);
});

test('six varied plants share assets, keep the table clear and follow their supporting wall', () => {
  const f = fixture({ models: true });
  for (const tableShape of ['rect', 'round', 'oval', 'hex']) {
    f.room.sync({ tableX: 10, tableZ: 7, tableShape });
    const root = f.scene.children[0];
    const plants = [];
    root.traverse((node) => {
      if (node.name.startsWith('Potted ')) plants.push(node);
    });
    assert.equal(plants.length, 6);
    for (const kind of ['rubber', 'snake', 'pothos']) {
      const variants = plants.filter((p) => p.name === `Potted ${kind}`);
      assert.equal(variants.length, 2);
      assert.notEqual(variants[0].rotation.y, variants[1].rotation.y);
      assert.notEqual(variants[0].scale.x, variants[1].scale.x);
      const load = f.modelLoads.findLast((l) => l.url === COZY_ROOM.furnitureURLs[kind]);
      const model = authoredModel();
      load.done({ scene: model.scene });
      for (const plant of variants) {
        const copy = plant.getObjectByName(`Cozy ${kind} model`);
        assert.equal(copy.children[0].geometry, model.mesh.geometry);
        assert.equal(copy.children[0].material, model.mesh.material);
        assert.ok(plant.getObjectByName('Plant fallback').children.every((n) => !n.visible));
        const position = plant.getWorldPosition(new THREE.Vector3());
        assert.ok(Math.abs(position.x) > 12 || Math.abs(position.z) > 12);
      }
    }
    const shelf = root.getObjectByName('Authored game shelf');
    const shelfPlant = shelf.getObjectByName('Potted pothos');
    assert.equal(shelfPlant.position.y, COZY_ROOM.shelfTop);
    const west = root.getObjectByName('West wall');
    assert.ok(west.getObjectByName('Potted snake'));
    f.room.update(new THREE.Vector3(-12, 10, -12), new THREE.Vector3());
    assert.equal(west.visible, false);
    assert.equal(root.getObjectByName('North wall').visible, false);
    assert.equal(root.getObjectByName('East wall').visible, true);
  }
  f.room.dispose();
});

test('stale model completions release their resources and failed loads retain fallback furniture', () => {
  const f = fixture({ models: true });
  f.room.sync({ tableX: 10, tableZ: 7, players: playersAt(0) });
  f.room.sync({ tableX: 2, tableZ: 2, players: playersAt(0, 1) });
  const current = f.scene.children[0];
  const stale = authoredModel();
  let releases = 0;
  stale.mesh.geometry.addEventListener('dispose', () => releases++);
  stale.mesh.material.normalMap.addEventListener('dispose', () => releases++);
  const before = f.changes();
  f.modelLoads[0].done({ scene: stale.scene });
  assert.equal(releases, 2);
  assert.equal(f.changes(), before);
  assert.equal(current.getObjectByName('Cozy chair model'), undefined);
  const perBuild = Object.keys(COZY_ROOM.furnitureURLs).length;
  f.modelLoads.slice(perBuild).forEach((load) => load.fail(new Error('Missing model')));
  const chairs = current.children.filter((n) => n.name === 'Upholstered chair');
  assert.equal(chairs.length, 2);
  assert.ok(chairs.every((chair) => chair.children.every((n) => n.visible)));
  f.room.dispose();
  const late = authoredModel();
  f.modelLoads[perBuild + 1].done({ scene: late.scene });
  assert.equal(late.scene.userData.ottDisposed, true);
  assert.equal(f.scene.children.length, 0);
});

test('clear window openings expose the existing sky without a painted insert or depth occlusion', () => {
  const f = fixture();
  const sky = new THREE.Color('#73b4e0');
  f.scene.background = sky;
  f.room.sync({ tableX: 10, tableZ: 7 });
  const root = f.scene.children[0];
  root.updateMatrixWorld(true);
  const panes = [];
  root.traverse((node) => {
    if (node.name === 'Clear window glazing') panes.push(node);
  });
  assert.equal(panes.length, 4);
  assert.equal(f.scene.background, sky, 'Room materials must not replace the selected sky');
  for (const pane of panes) {
    assert.equal(pane.material.map, null);
    assert.equal(pane.material.transparent, true);
    assert.equal(pane.material.depthWrite, false);
    assert.ok(pane.material.opacity <= 0.03);
    assert.equal(pane.parent.name, 'Oak casement window');
  }
  const north = root.children.find((n) => n.name === 'North wall');
  const openingRay = new THREE.Ray(new THREE.Vector3(-7, 4.3, -16), new THREE.Vector3(0, 0, -1));
  const panels = north.children.filter((n) => n.name === 'Textured plaster panel');
  assert.ok(panels.length);
  for (const panel of panels)
    assert.equal(openingRay.intersectsBox(new THREE.Box3().setFromObject(panel)), false);
  f.room.update(new THREE.Vector3(0, 10, -12), new THREE.Vector3());
  assert.equal(north.visible, false, 'Window surround and glazing must follow wall cutaways');
  f.room.dispose();
});

test('oak boards stagger their seams, stay within the floor and have bounded instance counts', () => {
  const f = fixture();
  f.room.sync({ tableX: 10, tableZ: 7 });
  const root = f.scene.children[0];
  const boards = root.getObjectByName('Staggered oak floorboards');
  assert.ok(boards.material.normalMap && boards.material.roughnessMap);
  const rows = new Map();
  for (let i = 0; i < boards.count; i++) {
    const matrix = new THREE.Matrix4();
    boards.getMatrixAt(i, matrix);
    const position = new THREE.Vector3(),
      scale = new THREE.Vector3();
    matrix.decompose(position, new THREE.Quaternion(), scale);
    assert.ok(position.x - scale.x / 2 >= -root.userData.halfSize.x - 0.001);
    assert.ok(position.x + scale.x / 2 <= root.userData.halfSize.x + 0.001);
    const key = position.z.toFixed(3);
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push((position.x + scale.x / 2).toFixed(3));
  }
  const seams = [...rows.values()];
  assert.notDeepEqual(seams[0], seams[1]);
  f.room.sync({ tableX: 400, tableZ: 300 });
  assert.ok(
    f.scene.children[0].getObjectByName('Staggered oak floorboards').count <=
      ROOM_SURFACES.maximumBoards,
  );
  f.room.dispose();
});

test('phone scenery skips detail-map loads, physical glass and room shadow reception', () => {
  const f = fixture({ device: 'phone' });
  f.room.sync({ tableX: 10, tableZ: 7, players: playersAt(0) });
  const root = f.scene.children[0];
  assert.equal(f.loads.length, 3, 'Only the three base-color surface maps should load');
  assert.ok(f.loads.every(({ url }) => !/normal|roughness/.test(url)));
  root.traverse((node) => {
    if (!node.isMesh) return;
    assert.equal(node.receiveShadow, false);
    assert.ok(!node.material.isMeshPhysicalMaterial);
    assert.ok(!node.material.normalMap && !node.material.roughnessMap);
    if (node.name === 'Clear window glazing') assert.equal(node.visible, false);
  });
  assert.ok(root.getObjectByName('Staggered oak floorboards').material.map);
  f.room.dispose();
});

test('phone model conversion preserves art, metal tuning and sharing while releasing only unused resources', () => {
  const f = fixture({ models: true, device: 'phone' });
  f.room.sync({ tableX: 10, tableZ: 7, players: playersAt(0, 2) });
  const scene = new THREE.Group();
  const map = new THREE.Texture();
  const normal = new THREE.Texture();
  const reusedMap = new THREE.Texture();
  const physical = new THREE.MeshPhysicalMaterial({
    map,
    normalMap: normal,
    roughnessMap: reusedMap,
    clearcoat: 0.8,
    sheen: 0.5,
    alphaTest: 0.4,
  });
  const coin = new THREE.MeshStandardMaterial({
    map: reusedMap,
    color: 0xd4af37,
    metalness: 1,
    roughness: 0.3,
  });
  const geometry = new THREE.BoxGeometry();
  scene.add(
    new THREE.Mesh(geometry, physical),
    new THREE.Mesh(geometry, physical),
    new THREE.Mesh(geometry, [coin, physical]),
  );
  const resources = [map, normal, reusedMap, physical, coin, geometry];
  const disposals = resources.map(() => 0);
  resources.forEach((resource, i) => resource.addEventListener('dispose', () => disposals[i]++));
  f.modelLoads.find((load) => load.url === COZY_ROOM.furnitureURLs.chair).done({ scene });
  const chairs = f.scene.children[0].children.filter((n) => n.name === 'Upholstered chair');
  const first = chairs[0].getObjectByName('Cozy chair model');
  const second = chairs[1].getObjectByName('Cozy chair model');
  const replacement = first.children[0].material;
  const replacementCoin = first.children[2].material[0];
  assert.equal(replacement.isMeshStandardMaterial, true);
  assert.ok(!replacement.isMeshPhysicalMaterial);
  assert.equal(replacement.map, map);
  assert.equal(replacement.alphaTest, 0.4);
  assert.equal(replacement.normalMap, null);
  assert.equal(replacement.roughnessMap, null);
  assert.equal(replacement, first.children[1].material);
  assert.equal(replacement, second.children[0].material);
  assert.equal(replacementCoin.map, reusedMap);
  assert.equal(replacementCoin.color.getHex(), 0xd4af37);
  assert.equal(replacementCoin.metalness, 1);
  assert.equal(replacementCoin.roughness, 0.3);
  assert.equal(map.anisotropy, 1);
  assert.deepEqual(disposals, [0, 1, 0, 1, 1, 0]);
  const convertedDisposals = [0, 0];
  replacement.addEventListener('dispose', () => convertedDisposals[0]++);
  replacementCoin.addEventListener('dispose', () => convertedDisposals[1]++);
  f.room.sync({ tableX: 10, tableZ: 7, players: playersAt() });
  assert.deepEqual(convertedDisposals, [0, 0], 'Empty seats retain the owned resource template');
  f.room.dispose();
  f.room.dispose();
  assert.deepEqual(disposals, [1, 1, 1, 1, 1, 1]);
  assert.deepEqual(convertedDisposals, [1, 1]);
});

test('desktop and tablet scenery retain authored physical materials and detail maps', () => {
  for (const device of ['desktop', 'tablet']) {
    const f = fixture({ models: true, device });
    f.room.sync({ tableX: 10, tableZ: 7, players: playersAt(0) });
    const model = authoredModel();
    const material = new THREE.MeshPhysicalMaterial({
      map: model.mesh.material.map,
      clearcoat: 0.8,
    });
    material.normalMap = model.mesh.material.normalMap;
    model.mesh.material = material;
    f.modelLoads.find((load) => load.url === COZY_ROOM.furnitureURLs.chair).done(model);
    const loaded = f.scene.children[0].getObjectByName('Cozy chair model').children[0];
    assert.equal(loaded.material, material);
    assert.ok(material.normalMap);
    assert.equal(material.clearcoat, 0.8);
    assert.equal(loaded.receiveShadow, true);
    f.room.dispose();
  }
});

test('contact shading survives model swaps, follows occupied seats and releases shared resources once', () => {
  for (const device of ['desktop', 'phone']) {
    const f = fixture({ models: true, device });
    const state = { tableX: 10, tableZ: 7, players: playersAt(0, 2) };
    f.room.sync(state);
    const root = f.scene.children[0];
    const contacts = () => {
      const nodes = [];
      root.traverse((n) => {
        if (n.userData.cozyContactShadow) nodes.push(n);
      });
      return nodes;
    };
    const initial = contacts();
    assert.ok(initial.length > 6);
    const material = initial[0].material;
    assert.equal(material.isMeshBasicMaterial, true);
    assert.equal(material.depthWrite, false);
    assert.equal(material.map.image.width, 128);
    assert.ok(initial.every((n) => n.material === material && !n.castShadow && !n.receiveShadow));
    const resources = [material, material.map, initial[0].geometry];
    const released = [0, 0, 0];
    resources.forEach((resource, i) => resource.addEventListener('dispose', () => released[i]++));
    f.modelLoads.forEach((load) => load.done(authoredModel()));
    assert.ok(
      contacts().every((n) => n.visible),
      'Model replacement must not hide contact shading',
    );
    root.traverse((n) => {
      if (n.name.startsWith('Cozy ') && n.name.endsWith(' model'))
        n.traverse((mesh) => {
          if (mesh.isMesh) assert.equal(mesh.castShadow, device !== 'phone');
        });
    });
    state.players = playersAt(1);
    f.room.sync(state);
    assert.equal(contacts().length, initial.length - 1);
    assert.deepEqual(released, [0, 0, 0]);
    const shelf = root.getObjectByName('Authored game shelf');
    assert.ok(shelf.children.some((n) => n.userData.cozyContactShadow));
    f.room.update(new THREE.Vector3(12, 10, 0), new THREE.Vector3());
    assert.equal(root.getObjectByName('East wall').visible, false);
    if (device === 'phone') assert.ok(f.shadowBounds.every((bounds) => bounds === null));
    else assert.ok(f.shadowBounds[0].containsPoint(new THREE.Vector3(20, COZY_ROOM.floorY, 17)));
    f.room.dispose();
    assert.deepEqual(released, [1, 1, 1]);
    assert.equal(material.map.image.width, 0);
    assert.equal(f.shadowBounds.at(-1), null);
  }
});
