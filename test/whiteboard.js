import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import { createWhiteboard } from '../public/table/whiteboard.js';

const element = (id) => {
  const classes = new Set();
  return {
    id,
    hidden: true,
    value: '',
    dataset: {},
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle(name, on) {
        if (on) classes.add(name);
        else classes.delete(name);
      },
    },
  };
};

function fixture() {
  const ids = new Map(
    [
      'wbTools',
      'wbStatus',
      'wbStatusWho',
      'wbPen',
      'wbEraser',
      'wbClearBtn',
      'wbDone',
      'wbEnabled',
      'wbAngle',
    ].map((id) => [id, element(id)]),
  );
  const styles = [element('light'), element('dark')];
  styles[0].dataset.wbstyle = 'light';
  styles[1].dataset.wbstyle = 'dark';
  const paint = {
    fills: 0,
    strokes: 0,
    fillRect() {
      this.fills++;
    },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {
      this.strokes++;
    },
  };
  const doc = {
    getElementById: (id) => ids.get(id),
    querySelectorAll: () => styles,
    createElement: (tag) => {
      assert.equal(tag, 'canvas');
      return { getContext: () => paint };
    },
  };
  const state = {
    whiteboard: { enabled: true, angle: 0, dark: false, owner: '' },
    tableX: 10,
    tableZ: 7,
    players: new Map([['other', { name: 'Ada' }]]),
  };
  const messages = [],
    handlers = new Map(),
    notices = [];
  const room = {
    state,
    send: (type, data) => messages.push({ type, data }),
    onMessage: (type, fn) => handlers.set(type, fn),
  };
  const scene = new THREE.Scene();
  const camera = { position: new THREE.Vector3(1, 2, 3) };
  const controls = { target: new THREE.Vector3(0, 0, 0), enabled: true, update() {} };
  const hits = { board: [{ uv: { x: 0.2, y: 0.75 }, distance: 2 }], pieces: [] };
  const ray = {
    setFromCamera() {},
    intersectObject: () => hits.board,
    intersectObjects: () => hits.pieces,
  };
  const pointer = new THREE.Vector2();
  const board = createWhiteboard({
    THREE,
    scene,
    camera,
    controls,
    ray,
    pointer,
    doc,
    createTexture: () => ({ needsUpdate: false }),
    getRoom: () => room,
    getSessionId: () => 'me',
    getStrokeColor: () => '#abcdef',
    setPointer: () => {},
    setIcon: (el, icon) => {
      el.icon = icon;
    },
    toast: (message, icon) => notices.push({ message, icon }),
  });
  return {
    board,
    room,
    state,
    scene,
    camera,
    controls,
    ids,
    styles,
    paint,
    messages,
    handlers,
    notices,
    hits,
  };
}

test('whiteboard owns mesh, camera mode, local strokes, replay, and cleanup', () => {
  const f = fixture();
  const { board, state, scene, camera, controls, messages, paint, hits } = f;
  board.sync(state.whiteboard);
  assert.equal(scene.children.length, 1);
  assert.equal(scene.children[0].getObjectByName('wbSurface').frustumCulled, false);
  assert.equal(messages.at(-1).type, 'wbStrokes');
  const initialPosition = camera.position.clone();

  state.whiteboard.owner = 'me';
  board.sync(state.whiteboard);
  assert.equal(board.isOwning(), true);
  assert.equal(controls.enabled, false);
  assert.equal(f.ids.get('wbTools').hidden, false);
  assert.equal(board.beginStroke(), true);
  hits.board = [{ uv: { x: 0.5, y: 0.5 }, distance: 2 }];
  board.extendStroke();
  board.endStroke();
  assert.equal(board.isDrawing(), false);
  assert.deepEqual(messages.at(-1), {
    type: 'wbStroke',
    data: { pts: [0.2, 0.25, 0.5, 0.5], color: '#abcdef', width: 0.005, erase: false },
  });
  assert.equal(paint.strokes, 1);

  board.bindControls();
  f.ids.get('wbEraser').onclick();
  board.beginStroke();
  hits.board = [{ uv: { x: 0.75, y: 0.25 }, distance: 2 }];
  board.extendStroke();
  board.endStroke();
  assert.equal(messages.at(-1).data.erase, true);
  assert.equal(messages.at(-1).data.width, 0.03);
  assert.equal(messages.at(-1).data.color, '#f4f1ea');
  assert.equal(paint.strokes, 2);

  state.whiteboard.dark = true;
  board.sync(state.whiteboard);
  assert.equal(paint.strokes, 4); // both local strokes replayed on the new background
  assert.equal(paint.strokeStyle, '#1b1b1b'); // eraser follows the new board style
  state.whiteboard.owner = '';
  board.sync(state.whiteboard);
  assert.equal(board.isOwning(), false);
  assert.equal(controls.enabled, true);
  assert.equal(f.ids.get('wbTools').hidden, true);
  assert.deepEqual(camera.position.toArray(), initialPosition.toArray());
  state.whiteboard.enabled = false;
  board.sync(state.whiteboard);
  assert.equal(scene.children.length, 0);
});

test('whiteboard binds room messages and gates claims behind visible pieces and ownership', () => {
  const f = fixture();
  const { board, state, messages, handlers, notices, hits, paint } = f;
  board.bindRoom(f.room);
  board.sync(state.whiteboard);
  handlers.get('wbStroke')({ sid: 'me', pts: [0, 0, 1, 1] });
  assert.equal(paint.strokes, 0); // own echo is ignored
  handlers.get('wbStroke')({ sid: 'other', pts: [0, 0, 1, 1] });
  assert.equal(paint.strokes, 1);
  handlers.get('wbStrokes')({ strokes: [{ pts: [0, 0, 1, 1] }] });
  assert.equal(paint.strokes, 2);
  handlers.get('wbClear')();
  assert.equal(paint.fills > 0, true);

  hits.pieces = [{ distance: 1 }];
  assert.equal(board.claimAt({ x: 10, y: 20 }, [{}]), false);
  hits.pieces = [];
  state.whiteboard.owner = 'other';
  board.sync(state.whiteboard);
  assert.equal(f.ids.get('wbStatusWho').textContent, 'Ada is drawing');
  assert.equal(board.claimAt({ x: 10, y: 20 }, []), true);
  assert.deepEqual(notices.at(-1), { message: 'Ada is using the whiteboard', icon: 'writing' });
  state.whiteboard.owner = '';
  board.sync(state.whiteboard);
  assert.equal(board.claimAt({ x: 10, y: 20 }, []), true);
  assert.equal(messages.at(-1).type, 'wbClaim');
});

test('whiteboard settings and toolbar send the existing protocol messages', () => {
  const f = fixture();
  const { board, state, ids, styles, messages } = f;
  board.bindControls();
  board.syncSettings(state.whiteboard);
  assert.equal(ids.get('wbEnabled').icon, 'eye');
  assert.equal(styles[0].classList.contains('on'), true);
  ids.get('wbEnabled').onclick();
  assert.deepEqual(messages.at(-1), { type: 'wbEnable', data: { on: false } });
  ids.get('wbAngle').value = '180';
  ids.get('wbAngle').oninput();
  assert.equal(messages.at(-1).type, 'wbSet');
  assert.equal(messages.at(-1).data.angle, Math.PI);
  styles[1].onclick();
  assert.deepEqual(messages.at(-1), { type: 'wbSet', data: { dark: true } });
  ids.get('wbEraser').onclick();
  assert.equal(ids.get('wbEraser').classList.contains('on'), true);
  ids.get('wbClearBtn').onclick();
  ids.get('wbDone').onclick();
  assert.deepEqual(
    messages.slice(-2).map((entry) => entry.type),
    ['wbClear', 'wbRelease'],
  );
});
