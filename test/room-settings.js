import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import { createRoomSettings } from '../public/table/room-settings.js';
import { normalizeLighting } from '../shared/lighting.js';

function field() {
  return {
    value: '',
    hidden: false,
    textContent: '',
    dataset: {},
    childElementCount: 0,
    classes: new Set(),
    style: { setProperty() {} },
    classList: { toggle() {} },
    querySelectorAll: () => [],
    closest: () => null,
    setAttribute() {},
    appendChild() {},
    focus() {},
    select() {},
    blur() {},
  };
}
function fixture() {
  const scene = new THREE.Scene(),
    elements = new Map(),
    listeners = new Map();
  const byId = (id) => {
    if (!elements.has(id)) elements.set(id, field());
    return elements.get(id);
  };
  const state = {
    tableX: 10,
    tableZ: 7,
    tableShape: 'rect',
    feltColor: '#123456',
    rimWood: 'oak',
    lighting: normalizeLighting({ preset: 'neutral' }),
    whiteboard: {},
    players: new Map([['me', { role: 'owner' }]]),
    pieces: new Map(),
    scale: {
      gridStyle: 'square',
      gridLift: 0.05,
      unitLabel: 'cm',
      worldPerUnit: 2,
      roundStep: 0.10000000149,
      cellWorld: 4,
      cellZ: 6,
      gridX: 2,
      gridZ: -2,
      gridColor: '#abcdef',
    },
  };
  const sent = [],
    applied = [],
    builds = [],
    alerts = [];
  let relabeled = 0,
    resized = 0,
    whiteboardSyncs = 0;
  const room = { state, sessionId: 'me', send: (...args) => sent.push(args) };
  const listen = (object) => (key, fn, immediate) => {
    assert.equal(immediate, false);
    if (!listeners.has(object)) listeners.set(object, new Map());
    listeners.get(object).set(key, fn);
  };
  const cb = (object) => ({
    listen: listen(object),
    scale: { listen: listen(state.scale) },
    lighting: { listen: listen(state.lighting) },
  });
  const doc = { querySelectorAll: () => [], createElement: field, activeElement: null };
  const settings = createRoomSettings({
    scene,
    gridLiftFallback: 0.05,
    gridMesh: (...args) => {
      builds.push(args);
      return state.scale.gridHidden || state.scale.gridStyle === 'off'
        ? null
        : new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
    },
    resizeTable: (...args) => applied.push(['table', ...args]),
    setTableColor: (color) => applied.push(['felt', color]),
    setRimWood: (wood) => applied.push(['rim', wood]),
    applyLighting: (...args) => applied.push(['lighting', ...args]),
    getQuality: () => 'high',
    setQuality: () => {},
    getRoom: () => room,
    onTableResize: () => resized++,
    syncWhiteboardSettings: () => whiteboardSyncs++,
    relabelOverlays: () => relabeled++,
    byId,
    setIcon: () => {},
    doc,
    alertUser: (message) => alerts.push(message),
    confirmAction: () => true,
  });
  settings.bindRoom(room, cb);
  settings.bindControls();
  return {
    settings,
    scene,
    state,
    byId,
    doc,
    sent,
    applied,
    builds,
    alerts,
    resized: () => resized,
    relabeled: () => relabeled,
    whiteboardSyncs: () => whiteboardSyncs,
    change(object, key, value) {
      object[key] = value;
      listeners.get(object).get(key)();
    },
  };
}

test('hydration applies table, felt, lighting, rim and grid with cross-feature resize ordering', () => {
  const f = fixture();
  f.settings.hydrate();
  assert.deepEqual(
    f.applied.map(([kind]) => kind),
    ['table', 'felt', 'lighting', 'rim'],
  );
  assert.deepEqual(f.applied[0], ['table', 10, 7, 'rect']);
  assert.deepEqual(f.applied[2][2], { duration: 0 });
  assert.equal(f.resized(), 1);
  assert.equal(f.scene.children[0].position.y, 0.05);
  const grid = f.scene.children[0];
  let disposed = 0;
  grid.geometry.addEventListener('dispose', () => disposed++);
  grid.material.addEventListener('dispose', () => disposed++);
  f.change(f.state, 'tableX', 12);
  assert.equal(f.resized(), 2);
  assert.equal(disposed, 2);
  assert.equal(f.scene.children.length, 1);
  assert.deepEqual(f.builds.at(-1).slice(1), [12, 7, 'rect']);
});

test('grid lift moves the current grid without rebuilding, while grid changes dispose and relabel', () => {
  const f = fixture();
  f.settings.hydrate();
  const grid = f.scene.children[0];
  f.change(f.state.scale, 'gridLift', 0.4);
  assert.equal(f.scene.children[0], grid);
  assert.equal(grid.position.y, 0.4);
  assert.equal(f.builds.length, 1);
  assert.equal(f.relabeled(), 1);
  f.change(f.state.scale, 'gridHidden', true);
  assert.equal(f.scene.children.length, 0);
  f.change(f.state.scale, 'gridHidden', false);
  assert.equal(f.scene.children.length, 1);
  f.change(f.state.scale, 'gridStyle', 'off');
  assert.equal(f.scene.children.length, 0);
});

test('scale panel converts world dimensions, rounds schema floats and preserves focused fields', () => {
  const f = fixture();
  f.byId('roomSettings').onclick();
  assert.equal(f.whiteboardSyncs(), 1);
  assert.equal(f.byId('tableW').value, 20);
  assert.equal(f.byId('scaleWidthVal').value, '10');
  assert.equal(f.byId('scaleStep').value, '0.1');
  assert.equal(f.byId('gridCell').value, '2');
  assert.equal(f.byId('gridCellZ').value, '3');
  assert.equal(f.byId('gridOffZ').value, '-1');
  f.doc.activeElement = f.byId('gridCell');
  f.byId('gridCell').value = 'editing';
  f.change(f.state.scale, 'cellWorld', 8);
  assert.equal(f.byId('gridCell').value, 'editing');
  f.doc.activeElement = null;
  f.change(f.state.scale, 'unitLabel', 'hex');
  assert.equal(f.byId('scaleCustomRow').hidden, false);
  assert.equal(f.byId('scaleUnitCustom').value, 'hex');
});

test('table and scale controls send existing half-extent and world-unit messages', () => {
  const f = fixture();
  f.byId('tableW').value = '30';
  f.byId('tableD').value = '18';
  f.byId('tableW').onchange();
  assert.deepEqual(f.sent.at(-1), ['table', { x: 15, z: 9 }]);
  f.state.tableShape = 'round';
  f.byId('tableD').onchange();
  assert.deepEqual(f.sent.at(-1), ['table', { x: 15, z: 15 }]);
  f.byId('gridCell').value = '3';
  f.byId('gridCell').onchange();
  assert.deepEqual(f.sent.at(-1), ['scaleSet', { cellWorld: 6 }]);
  f.byId('gridCellZ').value = '4';
  f.byId('gridCellZ').onchange();
  assert.deepEqual(f.sent.at(-1), ['scaleSet', { cellZ: 8 }]);
  f.byId('gridOffX').value = '-2';
  f.byId('gridOffX').onchange();
  assert.deepEqual(f.sent.at(-1), ['scaleSet', { gridX: -4 }]);
  f.byId('scaleWidthVal').value = '5';
  f.byId('scaleWidthSet').onclick();
  assert.deepEqual(f.sent.at(-1), ['scaleSet', { worldPerUnit: 4 }]);
});

test('board calibration handles missing boards, known built-ins, custom counts and hex counts', () => {
  const f = fixture();
  const fit = () => f.byId('gridCalib').onclick();
  fit();
  assert.equal(f.sent.length, 0);
  assert.match(f.alerts.at(-1), /Place a board/);
  f.state.pieces.set('board', { type: 'board', props: '{"board":"chess"}' });
  fit();
  assert.deepEqual(f.sent.at(-1), ['calibrateGrid', {}]);
  f.state.scale.snapAnchor = 'cross';
  f.byId('gridCells').value = '19';
  fit();
  assert.deepEqual(f.sent.at(-1), ['calibrateGrid', { cells: 19, anchor: 'cross' }]);
  f.state.scale.gridStyle = 'hex';
  fit();
  assert.deepEqual(f.sent.at(-1), ['calibrateGrid', { cells: 19 }]);
  f.byId('gridCells').value = '';
  fit();
  assert.match(f.alerts.at(-1), /how many hexes/);
});

test('lighting previews stay local, Cancel restores synced values and Apply sends the draft', () => {
  const f = fixture();
  f.byId('roomSettings').onclick();
  f.byId('lightingAzimuth').value = '130';
  f.byId('lightingAzimuth').oninput();
  assert.equal(f.sent.length, 0);
  assert.equal(f.applied.at(-1)[1].azimuth, 130);
  f.change(f.state.lighting, 'azimuth', 40);
  assert.equal(f.byId('lightingAzimuth').value, 130); // remote patches do not overwrite editing inputs
  f.byId('lightingCancel').onclick();
  assert.equal(f.applied.at(-1)[1].azimuth, 40);
  f.byId('roomSettings').onclick();
  f.byId('lightingAzimuth').value = '210';
  f.byId('lightingAzimuth').oninput();
  f.byId('lightingApply').onclick();
  assert.equal(f.sent.at(-1)[0], 'lightingApply');
  assert.equal(f.sent.at(-1)[1].azimuth, 210);
  assert.equal(f.byId('roomSettingsModal').hidden, true);
});

test('owner-only lighting defaults and restore/factory messages retain their controls', () => {
  const f = fixture();
  f.byId('roomSettings').onclick();
  assert.equal(f.byId('lightingSaveDefault').hidden, false);
  f.byId('lightingSaveDefault').onclick();
  assert.equal(f.sent.at(-1)[0], 'lightingDefaultSave');
  f.byId('lightingRestore').onclick();
  assert.deepEqual(f.sent.at(-1), ['lightingRestore']);
  f.byId('lightingFactory').onclick();
  assert.deepEqual(f.sent.at(-1), ['lightingFactoryReset']);
  f.state.players.get('me').role = 'gm';
  f.byId('roomSettings').onclick();
  assert.equal(f.byId('lightingSaveDefault').hidden, true);
  assert.equal(f.byId('lightingFactory').hidden, true);
});
