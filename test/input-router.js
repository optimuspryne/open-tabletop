import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import { createInputRouter } from '../public/table/input-router.js';
import { createPieceDrag } from '../public/table/piece-drag.js';

function fixture() {
  const calls = [],
    sent = [],
    messages = new Map(),
    selected = new Set(),
    modes = {};
  let time = 100,
    point = { clientX: 0, clientY: 0 },
    picked = 'die';
  const state = { pieces: new Map(), scale: { gridStyle: 'off' } };
  let room = {
    state,
    send: (...args) => sent.push(args),
    onMessage: (key, fn) => messages.set(key, fn),
  };
  const controls = { enabled: true },
    doc = { activeElement: null };
  const canvas = {
    setPointerCapture: (id) => calls.push(['capture', id]),
    releasePointerCapture: (id) => {
      calls.push(['releaseCapture', id]);
      if (modes.captureLost) throw Error('lost');
    },
  };
  const kinds = {
    die: { grab: 0, lclick: 'roll' },
    card: { grab: 0, lclick: 'flip', rclick: 'takeCard' },
    deck: { grab: 2, ldrag: 'deal', lclick: 'deal' },
    dispenser: { grab: 2, ldrag: 'dispense', lclick: 'dispense' },
    prop: { grab: 0 },
    mat: { grab: 0, heavy: true },
  };
  const meshes = new Map(
    Object.keys(kinds).map((type) => {
      state.pieces.set(type, { type, props: '{}' });
      return [type, { type, mesh: {} }];
    }),
  );
  const mark =
    (name) =>
    (...args) =>
      calls.push([name, ...args]);
  const selection = {
    get size() {
      return selected.size;
    },
    has: (id) => selected.has(id),
    ids: () => [...selected],
    clear: () => {
      selected.clear();
      calls.push(['selection.clear']);
    },
    beginPointer: () => {
      if (modes.selectPress) {
        calls.push(['selection.press']);
        return true;
      }
      return false;
    },
    movePointer: () => {
      if (modes.selectMove) {
        calls.push(['selection.move']);
        return true;
      }
      return false;
    },
    endPointer: () => {
      if (modes.selectEnd) {
        calls.push(['selection.end']);
        return true;
      }
      return false;
    },
    isActive: () => modes.selectActive,
    escape: () => {
      if (modes.selectEscape) {
        calls.push(['selection.escape']);
        return true;
      }
      return false;
    },
    command: () => {
      if (modes.batch) {
        calls.push(['selection.command']);
        return true;
      }
      return false;
    },
    removeSelected: () => {
      if (modes.removeSelection) {
        calls.push(['selection.remove']);
        return true;
      }
      return false;
    },
  };
  const overlays = {
    isMeasuring: () => modes.measure,
    beginMeasure: () => {
      calls.push(['measure.press']);
      return !modes.failMeasure;
    },
    updateMeasure: mark('measure.move'),
    finishMeasure: () => {
      calls.push(['measure.end']);
      return !modes.failMeasure;
    },
    beginMove: () => {
      if (modes.moveOverlay) {
        calls.push(['overlay.press']);
        return true;
      }
      return false;
    },
    isMoving: () => modes.moveOverlay,
    updateMove: mark('overlay.move'),
    finishMove: mark('overlay.end'),
    exit: mark('measure.exit'),
    hasSelection: () => modes.overlaySelected,
    select: mark('overlay.select'),
    removeSelected: () => {
      if (modes.removeOverlay) {
        calls.push(['overlay.remove']);
        return true;
      }
      return false;
    },
  };
  const whiteboard = {
    isOwning: () => modes.whiteboard,
    isDrawing: () => modes.drawing,
    beginStroke: () => {
      calls.push(['whiteboard.press']);
      return true;
    },
    extendStroke: mark('whiteboard.move'),
    endStroke: mark('whiteboard.end'),
    release: mark('whiteboard.exit'),
    claimAt: (...args) => {
      calls.push(['claim', ...args]);
      return true;
    },
  };
  const inspection = {
    isActive: () => !!modes.inspect,
    isDrawn: () => !!modes.drawn,
    beginPointer: () => {
      if (modes.inspect) {
        calls.push(['inspect.press']);
        return true;
      }
      return false;
    },
    movePointer: () => {
      if (modes.inspect) {
        calls.push(['inspect.move']);
        return true;
      }
      return false;
    },
    endPointer: () => {
      if (modes.inspect) {
        calls.push(['inspect.end']);
        return true;
      }
      return false;
    },
    releaseInspect: mark('inspect.exit'),
    placeDrawn: mark('place'),
    isInspectable: (type) => type === 'die' || type === 'prop',
    handleDeferredClick: (...args) => {
      calls.push(['deferred', ...args]);
      if (modes.enterOnClick) modes.inspect = true;
    },
  };
  const trays = {
    isViewing: () => modes.tray,
    isCameraMoving: () => modes.trayMoving,
    close: mark('tray.close'),
  };
  const setPointer = (e, lead = 0) => {
    point = e;
    calls.push(['point', lead]);
  };
  const ray = {
    setFromCamera() {},
    ray: {
      intersectPlane: (_plane, hit) => {
        if (modes.missPlane) return null;
        return hit.set(point.clientX / 10, 0, point.clientY / 10);
      },
    },
  };
  const pieces = createPieceDrag({
    THREE,
    config: {
      grab: { height: 2, touchLift: 1.5, min: 0.5, max: 6, step: 0.5, deckHeight: 4 },
      input: { dragPx: 6, touchLeadPx: 20 },
    },
    kinds,
    meshes,
    controls,
    canvas,
    ray,
    pointer: new THREE.Vector2(),
    camera: {},
    dragPlane: {},
    hit: new THREE.Vector3(),
    selection,
    getRoom: () => room,
    getInspection: () => inspection,
    setPointer,
    openPieceMenu: mark('menu'),
    playSfx: mark('sound'),
    clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    clock: () => time,
  });
  pieces.bindRoom(room);
  const router = createInputRouter({
    getRoom: () => room,
    canvas,
    controls,
    selection,
    overlays,
    whiteboard,
    inspection,
    trays,
    pieces,
    setPointer,
    pickId: (radius = 0) => {
      calls.push(['pick', radius]);
      return picked;
    },
    touchHitPx: 18,
    getPieceMeshes: () => [...meshes.values()].map((entry) => entry.mesh),
    panCamera: mark('pan'),
    openPieceMenu: mark('menu'),
    sendPing: mark('ping'),
    byId: () => (modes.panel ? { _close: mark('panel.close') } : null),
    doc,
  });
  return {
    router,
    pieces,
    calls,
    sent,
    messages,
    modes,
    controls,
    doc,
    selected,
    state,
    meshes,
    pick: (id) => {
      picked = id;
    },
    advance: (ms = 20) => {
      time += ms;
    },
    disconnect: () => {
      room = null;
    },
    key: (key, repeat = false) => router.command({ key, repeat, preventDefault: mark('prevent') }),
  };
}
const pointer = (extra = {}) => ({
  clientX: 0,
  clientY: 0,
  pointerId: 1,
  primary: true,
  secondary: false,
  touch: false,
  ...extra,
});
const names = (f) => f.calls.map(([name]) => name);
const drag = (f, id = 'die', extra = {}) => {
  f.pick(id);
  f.router.press(pointer(extra));
  f.advance();
  f.router.move(pointer({ clientX: 10, ...extra }));
};

test('press routing preserves measure, whiteboard, inspection and selection priority', () => {
  const f = fixture();
  f.pieces.armMove('deck');
  Object.assign(f.modes, { measure: true, whiteboard: true, inspect: true, selectPress: true });
  f.router.press(pointer());
  assert.deepEqual(names(f), ['measure.press', 'capture']);
  assert.equal(f.pieces.consumeArmedMove(), null);
  f.calls.length = 0;
  f.modes.measure = false;
  f.router.press(pointer());
  assert.deepEqual(names(f), ['point', 'whiteboard.press', 'capture']);
  f.calls.length = 0;
  f.modes.whiteboard = false;
  f.router.press(pointer());
  assert.deepEqual(names(f), ['inspect.press']);
  f.calls.length = 0;
  f.modes.inspect = false;
  f.router.press(pointer({ touch: true }));
  assert.deepEqual(names(f), ['point', 'pick', 'selection.press', 'capture']);
  assert.deepEqual(f.calls[1], ['pick', 18]);
  assert.equal(f.pieces.isActive(), false);
});

test('empty felt routes overlay movement or deselection without capturing an orbit gesture', () => {
  const f = fixture();
  f.pick(null);
  f.selected.add('die');
  f.router.press(pointer());
  assert.equal(f.selected.size, 0);
  assert.equal(f.controls.enabled, true);
  assert.ok(!names(f).includes('capture'));
  f.calls.length = 0;
  f.modes.moveOverlay = true;
  f.router.press(pointer());
  assert.ok(names(f).includes('overlay.press'));
  assert.equal(f.controls.enabled, false);
  assert.ok(names(f).includes('capture'));
});

test('move priority preserves marquee, measure, whiteboard, inspection, overlay then piece motion', () => {
  const f = fixture();
  Object.assign(f.modes, {
    selectMove: true,
    measure: true,
    whiteboard: true,
    drawing: true,
    inspect: true,
    moveOverlay: true,
  });
  for (const [flag, expected] of [
    ['selectMove', 'selection.move'],
    ['measure', 'measure.move'],
    ['whiteboard', 'whiteboard.move'],
    ['inspect', 'inspect.move'],
    ['moveOverlay', 'overlay.move'],
  ]) {
    f.calls.length = 0;
    f.router.move(pointer());
    assert.equal(names(f).at(-1), expected);
    f.modes[flag] = false;
  }
  assert.equal(f.sent.length, 0);
  drag(f);
  assert.equal(f.sent[0][0], 'grab');
});

test('release priority preserves capture cleanup and camera ownership, including lost capture', () => {
  const f = fixture();
  f.controls.enabled = false;
  Object.assign(f.modes, {
    selectEnd: true,
    measure: true,
    whiteboard: true,
    drawing: true,
    inspect: true,
    moveOverlay: true,
    captureLost: true,
  });
  for (const [flag, expected, enabled] of [
    ['selectEnd', 'selection.end', false],
    ['measure', 'measure.end', true],
    ['whiteboard', 'whiteboard.end', true],
    ['inspect', 'inspect.end', true],
    ['moveOverlay', 'overlay.end', true],
  ]) {
    f.calls.length = 0;
    f.router.release(pointer());
    assert.equal(names(f)[0], expected);
    assert.equal(names(f).includes('releaseCapture'), flag !== 'inspect');
    assert.equal(f.controls.enabled, enabled);
    f.modes[flag] = false;
  }
  f.calls.length = 0;
  f.router.release(pointer());
  assert.deepEqual(f.calls, []);
});

test('Escape precedes typing guard and exits modes in the established order', () => {
  const f = fixture();
  f.doc.activeElement = { tagName: 'INPUT' };
  Object.assign(f.modes, {
    tray: true,
    selectEscape: true,
    measure: true,
    panel: true,
    whiteboard: true,
    inspect: true,
    overlaySelected: true,
  });
  for (const [flag, expected] of [
    ['tray', 'tray.close'],
    ['selectEscape', 'selection.escape'],
    ['measure', 'panel.close'],
    ['whiteboard', 'whiteboard.exit'],
    ['inspect', 'inspect.exit'],
    ['overlaySelected', 'overlay.select'],
  ]) {
    f.calls.length = 0;
    f.key('Escape');
    assert.equal(names(f)[0], expected);
    f.modes[flag] = false;
  }
  f.modes.measure = true;
  f.modes.panel = false;
  f.key('Escape');
  assert.equal(names(f).at(-1), 'measure.exit');
});

test('typing never places a drawn card; placement and delete priorities survive extraction', () => {
  const f = fixture();
  f.modes.drawn = true;
  for (const tagName of ['INPUT', 'TEXTAREA']) {
    f.doc.activeElement = { tagName };
    f.key('d');
  }
  assert.deepEqual(f.calls, []);
  f.doc.activeElement = null;
  for (const [key, where] of [
    ['f', 'field-up'],
    ['D', 'field-down'],
    ['h', 'hand'],
    ['r', 'deck'],
  ]) {
    f.key(key);
    assert.deepEqual(f.calls.at(-1), ['place', where]);
  }
  f.modes.drawn = false;
  f.modes.removeOverlay = true;
  f.modes.removeSelection = true;
  f.key('Backspace');
  assert.deepEqual(f.calls.slice(-2), [['prevent'], ['overlay.remove']]);
  f.modes.removeOverlay = false;
  f.key('Delete');
  assert.equal(names(f).at(-1), 'selection.remove');
  f.modes.removeSelection = false;
  drag(f);
  f.key('Delete');
  assert.deepEqual(f.sent.at(-1), ['remove', { id: 'die' }]);
  assert.equal(f.pieces.isActive(), false);
  assert.equal(f.controls.enabled, true);
  f.key('U');
  assert.deepEqual(f.sent.at(-1), ['setStand', { id: 'die' }]);
  f.key('g');
  assert.deepEqual(f.sent.at(-1), ['setSnap', { id: 'die' }]);
  f.key('p');
  const count = f.calls.length;
  f.key('p', true);
  assert.equal(f.calls.length, count);
});

test('long-press consumes the click and opens a piece menu or pings empty felt, respecting tools', () => {
  const f = fixture();
  f.router.press(pointer());
  f.router.secondaryPress({ x: 10, y: 20 });
  assert.deepEqual(f.calls.at(-1), ['menu', 'die', { x: 10, y: 20 }]);
  f.router.move(pointer({ clientX: 20 }));
  f.router.release(pointer());
  assert.equal(f.sent.length, 0);
  assert.ok(!names(f).includes('deferred'));
  f.pick(null);
  f.router.press(pointer());
  f.router.secondaryPress({ x: 10, y: 20 });
  assert.equal(names(f).at(-1), 'ping');
  for (const flag of ['measure', 'whiteboard', 'inspect', 'selectActive']) {
    f.modes[flag] = true;
    const n = f.calls.length;
    f.router.secondaryPress({ x: 10, y: 20 });
    assert.equal(f.calls.length, n);
    f.modes[flag] = false;
  }
});

test('axis targets, pan gates and whiteboard claims keep their intent contracts', () => {
  const f = fixture();
  assert.equal(f.router.hasAxisTarget('raiseAxis'), false);
  f.selected.add('die');
  assert.equal(f.router.hasAxisTarget('rotateAxis'), true);
  assert.equal(f.router.hasAxisTarget('raiseAxis'), false);
  f.router.rotateAxis(1);
  assert.deepEqual(f.sent.at(-1), ['rotateGroup', { ids: ['die'], angle: Math.PI / 24 }]);
  f.router.panCamera(1, -1);
  assert.deepEqual(f.calls.at(-1), ['pan', 1, -1]);
  for (const flag of ['inspect', 'whiteboard', 'tray', 'trayMoving']) {
    f.modes[flag] = true;
    const n = f.calls.length;
    f.router.panCamera(1, 1);
    assert.equal(f.calls.length, n);
    f.modes[flag] = false;
  }
  assert.equal(f.router.doubleClick({ x: 4, y: 5 }), true);
  assert.equal(f.calls.at(-1)[2].length, f.meshes.size);
  f.disconnect();
  const n = f.calls.length;
  f.router.panCamera(1, 1);
  f.key('g');
  assert.equal(f.calls.length, n);
});

test('clicks stay deferred or immediate by type; a click entering inspection keeps the camera disabled', () => {
  const f = fixture();
  f.modes.enterOnClick = true;
  f.router.press(pointer());
  f.router.move(pointer({ clientX: 5 }));
  f.router.release(pointer());
  assert.deepEqual(
    f.calls.find(([name]) => name === 'deferred'),
    ['deferred', 'die', 'die', 'roll'],
  );
  assert.equal(f.controls.enabled, false);
  assert.equal(f.pieces.isActive(), false);
  f.modes.inspect = false;
  f.pick('card');
  f.router.press(pointer({ primary: false, secondary: true }));
  f.router.release(pointer());
  assert.deepEqual(f.sent.at(-1), ['takeCard', { id: 'card' }]);
  f.pick('deck');
  f.router.press(pointer({ primary: false, secondary: true }));
  f.router.release(pointer());
  assert.equal(f.calls.at(-2)[0], 'menu');
});

test('group drag preserves snapping, touch lift, transforms and release messages', () => {
  const f = fixture();
  f.selected.add('die');
  f.selected.add('prop');
  f.state.scale = { gridStyle: 'square', cellWorld: 1, gridX: 0, gridZ: 0, snapAnchor: 'cross' };
  f.state.pieces.get('die').props = '{"snap":true}';
  drag(f, 'die', { touch: true, clientX: 17 }); // press/move at same coordinate, then cross threshold
  f.advance();
  f.router.move(pointer({ clientX: 27, touch: true }));
  assert.deepEqual(f.sent[0], ['grabGroup', { ids: ['die', 'prop'], anchor: 'die' }]);
  assert.deepEqual(f.sent[1], ['moveGroup', { x: 3, y: 3, z: 0 }]);
  assert.ok(f.calls.some(([name, lead]) => name === 'point' && lead === 20));
  f.router.raiseAxis(1);
  assert.deepEqual(f.sent.at(-1), ['moveGroup', { x: 3, y: 3.5, z: 0 }]);
  f.router.snapHeld();
  assert.deepEqual(f.sent.at(-1), ['snap', { id: 'die' }]);
  f.router.release(pointer());
  assert.equal(f.sent.at(-1)[0], 'releaseGroup');
  assert.equal(f.pieces.hasHeld(), false);
  assert.equal(f.controls.enabled, true);
});

test('dealing and dispensing adopt replies only while the originating gesture remains active', () => {
  for (const [type, msg, adopted] of [
    ['deck', 'dealDrag', 'card'],
    ['dispenser', 'dispenseDrag', 'prop'],
  ]) {
    const f = fixture();
    drag(f, type);
    assert.equal(f.sent[0][0], msg);
    assert.equal(f.sent[0][1].y, 4);
    f.messages.get('dealt')({ id: 'new' });
    assert.equal(f.pieces.current().type, adopted);
    assert.deepEqual(f.sent.at(-1), ['move', { id: 'new', x: 1, y: 4, z: 0 }]);
    f.router.release(pointer());
    assert.deepEqual(f.sent.at(-1), ['release', { id: 'new', v: [0, 0, 0] }]);
    drag(f, type);
    f.router.release(pointer());
    f.messages.get('dealt')({ id: 'late' });
    assert.deepEqual(f.sent.at(-1), ['release', { id: 'late', v: [0, 0, 0] }]);
  }
});

test('two-finger transforms freeze translation, reanchor without jumping, and do not throw', () => {
  const f = fixture();
  drag(f);
  const firstMove = f.sent.find(([type]) => type === 'move')[1];
  const n = f.sent.length;
  f.advance();
  f.router.move(pointer({ clientX: 100, transforming: true }));
  assert.equal(f.sent.length, n);
  f.advance();
  f.router.move(pointer({ clientX: 100 }));
  assert.equal(f.sent.at(-1)[1].x, firstMove.x);
  f.router.release(pointer());
  assert.deepEqual(f.sent.at(-1)[1].v, [0, 0, 0]);
});

test('rotation accumulates below snap threshold and Alt rotation never becomes a throw', () => {
  const f = fixture();
  drag(f);
  let n = f.sent.length;
  f.router.rotateHeld(0.1);
  assert.equal(f.sent.length, n);
  f.router.rotateHeld(0.1);
  assert.deepEqual(f.sent.at(-1), ['rotateGroup', { ids: ['die'], angle: Math.PI / 12 }]);
  f.advance();
  f.router.move(pointer({ clientX: 50, rotate: true }));
  f.advance();
  f.router.move(pointer({ clientX: 80, rotate: true, fineRotate: true }));
  assert.equal(f.sent.at(-1)[0], 'rotateGroup');
  f.router.release(pointer());
  assert.deepEqual(f.sent.at(-1)[1].v, [0, 0, 0]);
});

test('menu Move captures the canvas, arms one-shot moves, and heavy pieces never throw', () => {
  const f = fixture();
  assert.equal(
    f.pieces.beginMoveFromMenu('deck', {
      clientX: 10,
      clientY: 20,
      pointerType: 'touch',
      pointerId: 8,
    }),
    true,
  );
  assert.deepEqual(f.sent.slice(0, 2), [
    ['grab', { id: 'deck' }],
    ['move', { id: 'deck', x: 1, y: 3, z: 2 }],
  ]);
  assert.deepEqual(f.calls.at(-1), ['capture', 8]);
  f.advance();
  f.router.move(pointer({ clientX: 100 }));
  f.router.release(pointer());
  assert.deepEqual(f.sent.at(-1)[1].v, [0, 0, 0]);
  f.pieces.armMove('deck');
  drag(f, 'deck');
  assert.equal(f.sent.at(-2)[0], 'move');
  assert.equal(f.pieces.hasHeld(), true);
  f.router.release(pointer());
  drag(f, 'mat');
  f.advance();
  f.router.move(pointer({ clientX: 100 }));
  f.router.release(pointer());
  assert.deepEqual(f.sent.at(-1)[1].v, [0, 0, 0]);
  f.modes.missPlane = true;
  assert.equal(f.pieces.beginMoveFromMenu('deck', pointer()), false);
});
