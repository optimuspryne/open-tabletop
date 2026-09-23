import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import { createOverlays } from '../public/table/overlays.js';
import { MEASURE, OVERLAY_KINDS, OVERLAY_LIMITS, WHITEBOARD_LIMITS } from '../shared/overlays.js';

test('shared overlay protocol exposes immutable kinds and limits', () => {
  assert.deepEqual(OVERLAY_KINDS, ['ruler', 'circle', 'cone', 'line']);
  assert.deepEqual(OVERLAY_LIMITS, { maxRoom: 200, maxPerPlayer: 40 });
  assert.deepEqual(WHITEBOARD_LIMITS, {
    maxStrokes: 2000,
    maxCoordinatesPerStroke: 2000,
    maxColorLength: 24,
    maxStrokeWidth: 0.2,
  });
  assert.equal(MEASURE.maxLen, 80);
  for (const value of [OVERLAY_KINDS, OVERLAY_LIMITS, WHITEBOARD_LIMITS, MEASURE])
    assert.equal(Object.isFrozen(value), true);
});

const element = (id, kind) => {
  const classes = new Set();
  return {
    id,
    dataset: kind ? { kind } : {},
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
    },
  };
};

function fixture() {
  const state = { overlays: new Map(), scale: 2 };
  const sent = [],
    messages = new Map(),
    hooks = {},
    builds = [];
  const room = {
    state,
    send: (type, data) => sent.push({ type, data }),
    onMessage: (type, fn) => messages.set(type, fn),
  };
  const cb = (target) =>
    target === state
      ? {
          overlays: {
            onAdd: (fn) => {
              hooks.add = fn;
            },
            onRemove: (fn) => {
              hooks.remove = fn;
            },
          },
        }
      : { listen() {} };
  const kinds = ['ruler', 'circle', 'cone', 'line'].map((kind) => element(kind, kind));
  const ids = new Map(
    ['measureBtn', 'measureClear', 'measureClearAll', 'measureHint'].map((id) => [id, element(id)]),
  );
  const doc = { querySelectorAll: () => kinds };
  const registry = Object.fromEntries(
    kinds.map(({ dataset }) => [
      dataset.kind,
      {
        build(overlay) {
          builds.push({ ...overlay });
          return new THREE.Group();
        },
      },
    ]),
  );
  const scene = new THREE.Scene();
  const boards = [];
  const canvas = element('canvas');
  const camera = {};
  const pointer = {};
  let hitPoint = null,
    hitOverlay = false,
    boardPoint = null,
    time = 100;
  const ray = {
    setFromCamera() {},
    intersectObject: (mesh) => {
      if (boards.includes(mesh))
        return boardPoint
          ? [{ distance: 1, point: new THREE.Vector3(boardPoint.x, boardPoint.y, boardPoint.z) }]
          : [];
      return hitOverlay ? [{ distance: 1 }] : [];
    },
    ray: {
      intersectPlane: (_plane, target) => (hitPoint ? target.set(hitPoint.x, 0, hitPoint.z) : null),
    },
  };
  let rank = 0,
    hydration = 0;
  const overlays = createOverlays({
    THREE,
    scene,
    camera,
    ray,
    pointer,
    canvas,
    registry,
    measure: { lift: 0.03, labelLift: 0.15, minDrag: 0.1, coneAngle: Math.PI / 4, lineWidth: 2 },
    labelSize: { w: 1, h: 0.4 },
    nameTag: () => new THREE.Texture(),
    formatMeasure: (distance, scale) => String(distance * scale),
    disposeSprite: (sprite) => {
      scene.remove(sprite);
      sprite.material.map.dispose();
      sprite.material.dispose();
    },
    getRoom: () => room,
    send: room.send,
    getSessionId: () => 'me',
    getRank: () => rank,
    getColor: () => '#abc123',
    getBoardMeshes: () => boards,
    setPointer: (event) => {
      hitPoint = event.hit ?? null;
    },
    byId: (id) => ids.get(id),
    doc,
    now: () => time,
  });
  overlays.bindRoom(room, cb, () => hydration++);
  return {
    overlays,
    state,
    sent,
    messages,
    hooks,
    builds,
    scene,
    canvas,
    boards,
    kinds,
    ids,
    setTime: (value) => {
      time = value;
    },
    setRank: (value) => {
      rank = value;
    },
    setPick: (value) => {
      hitOverlay = value;
    },
    setBoardPoint: (value) => {
      boardPoint = value;
    },
    hydration: () => hydration,
  };
}

test('overlay state binding builds, relabels, selects, and removes geometry', () => {
  const f = fixture();
  const overlay = { kind: 'ruler', x: 0, z: 0, x2: 3, z2: 4, color: '#abc123', owner: 'me' };
  f.state.overlays.set('r1', overlay);
  f.hooks.add(overlay, 'r1');
  assert.equal(f.hydration(), 1);
  assert.equal(f.scene.children.length, 2); // shape and label
  assert.equal(f.builds[0].kind, 'ruler');
  f.setPick(true);
  assert.equal(f.overlays.beginMove({ hit: { x: 0, z: 0 } }), true);
  assert.equal(f.overlays.hasSelection(), true);
  assert.equal(f.scene.children.length, 3); // two selection rings in one group
  f.state.scale = 3;
  f.overlays.relabel();
  f.hooks.remove(overlay, 'r1');
  f.state.overlays.delete('r1');
  assert.equal(f.hydration(), 2);
  assert.equal(f.overlays.hasSelection(), false);
  assert.equal(f.scene.children.length, 0);
});

test('measurement geometry follows the rendered board surface rather than a tall collider', () => {
  const f = fixture();
  const board = new THREE.Group(); // a GLB board before its visual mesh finishes loading
  f.boards.push(board);
  const overlay = { kind: 'ruler', x: 1, z: 1, x2: 2, z2: 1, color: '#abc123', owner: 'me' };
  f.state.overlays.set('r1', overlay);
  f.hooks.add(overlay, 'r1');
  const [shape, label] = f.scene.children;
  f.overlays.syncSurface();
  assert.equal(shape.position.y, 0.03); // no board visual yet: felt fallback

  const playingSurface = new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 8));
  playingSurface.position.y = 0.1; // visible top = 0.2
  board.add(playingSurface);
  f.overlays.syncSurface();
  assert.ok(Math.abs(shape.position.y - 0.23) < 1e-6);
  assert.ok(Math.abs(label.position.y - 0.35) < 1e-6);
  f.setPick(true);
  assert.equal(f.overlays.beginMove({}), true);
  assert.ok(Math.abs(f.scene.children[2].children[0].position.y - 0.25) < 1e-6);
  f.overlays.finishMove({});
  f.setPick(false);

  f.setBoardPoint({ x: 1, y: 0.2, z: 1 });
  f.overlays.enter();
  assert.equal(f.overlays.beginMeasure({ primary: true }), true);
  f.setBoardPoint({ x: 2, y: 0.2, z: 1 });
  f.overlays.updateMeasure({});
  assert.ok(Math.abs(f.scene.children[2].position.y - 0.23) < 1e-6);
  assert.ok(Math.abs(f.scene.children[3].position.y - 0.35) < 1e-6);
  f.overlays.exit();
  f.messages.get('overlayDrag')({
    from: 'other',
    kind: 'ruler',
    x: 1,
    z: 1,
    x2: 2,
    z2: 1,
    color: '#ffffff',
  });
  assert.ok(Math.abs(f.scene.children[2].position.y - 0.23) < 1e-6);
  assert.ok(Math.abs(f.scene.children[3].position.y - 0.35) < 1e-6);
  f.overlays.clearDragPreview('other');

  board.remove(playingSurface);
  f.overlays.syncSurface();
  assert.equal(shape.position.y, 0.03);
});

test('measurement intent previews and commits the selected shape, then clears remote ink', () => {
  const f = fixture();
  f.overlays.bindControls();
  f.kinds[3].onclick(); // line
  assert.equal(f.ids.get('measureHint').textContent.includes('lane'), true);
  f.overlays.enter();
  assert.equal(f.overlays.isMeasuring(), true);
  assert.equal(f.canvas.classList.contains('measuring'), true);
  assert.equal(f.overlays.beginMeasure({ primary: true, hit: { x: 1, z: 2 } }), true);
  f.overlays.updateMeasure({ hit: { x: 4, z: 6 } });
  assert.deepEqual(f.sent.at(-1), {
    type: 'overlayDrag',
    data: { kind: 'line', x: 1, z: 2, x2: 4, z2: 6, w: 2 },
  });
  assert.equal(f.builds.at(-1).kind, 'line');
  assert.equal(f.scene.children.length, 2); // local preview and label
  f.setTime(110);
  f.overlays.updateMeasure({ hit: { x: 5, z: 6 } });
  assert.equal(f.sent.filter(({ type }) => type === 'overlayDrag').length, 1); // throttled
  assert.equal(f.overlays.finishMeasure({ hit: { x: 4, z: 6 } }), true);
  assert.deepEqual(f.sent.slice(-2), [
    { type: 'overlayAdd', data: { kind: 'line', x: 1, z: 2, x2: 4, z2: 6, w: 2 } },
    { type: 'overlayDrag', data: {} },
  ]);
  assert.equal(f.scene.children.length, 0);
  f.overlays.beginMeasure({ primary: true, hit: { x: 1, z: 2 } });
  f.overlays.finishMeasure({ hit: { x: 1.01, z: 2 } });
  assert.equal(f.sent.filter(({ type }) => type === 'overlayAdd').length, 1); // too short
  f.messages.get('overlayDrag')({
    from: 'other',
    kind: 'circle',
    x: 0,
    z: 0,
    x2: 2,
    z2: 0,
    color: '#ffffff',
  });
  assert.equal(f.scene.children.length, 2);
  f.overlays.clearDragPreview('other');
  assert.equal(f.scene.children.length, 0);
  f.overlays.exit();
  assert.equal(f.overlays.isMeasuring(), false);
  assert.equal(f.canvas.classList.contains('measuring'), false);
});

test('only owner or GM can move/remove an overlay, with final move sent on release', () => {
  const f = fixture();
  const overlay = { kind: 'ruler', x: 1, z: 2, x2: 3, z2: 4, color: '#ffffff', owner: 'other' };
  f.state.overlays.set('r2', overlay);
  f.hooks.add(overlay, 'r2');
  f.setPick(true);
  assert.equal(f.overlays.beginMove({ hit: { x: 1, z: 2 } }), false);
  f.setRank(2);
  assert.equal(f.overlays.beginMove({ hit: { x: 1, z: 2 } }), true);
  f.setTime(200);
  f.overlays.updateMove({ hit: { x: 2, z: 4 } });
  assert.deepEqual(f.sent.at(-1), {
    type: 'overlayMove',
    data: { id: 'r2', x: 2, z: 4, x2: 4, z2: 6 },
  });
  assert.equal(f.overlays.finishMove({ hit: { x: 3, z: 5 } }), true);
  assert.deepEqual(f.sent.at(-1), {
    type: 'overlayMove',
    data: { id: 'r2', x: 3, z: 5, x2: 5, z2: 7 },
  });
  assert.equal(f.overlays.removeSelected(), true);
  assert.deepEqual(f.sent.at(-1), { type: 'overlayRemove', data: { id: 'r2' } });
  assert.equal(f.overlays.hasSelection(), false);
});
