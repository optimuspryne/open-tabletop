import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import { createInspection } from '../public/table/inspection.js';

function fixture({ appearance = false } = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const controls = { enabled: true };
  const deckButton = { hidden: false };
  const elements = new Map([
    ['inspectHint', { hidden: true }],
    ['drawActions', { hidden: true, querySelector: () => deckButton }],
  ]);
  if (appearance) {
    elements.set('inspectColorRow', { hidden: true });
    elements.set('inspectBodyLab', { hidden: true, firstChild: { nodeValue: '' } });
    elements.set('inspectTextLab', { hidden: true });
    elements.set('inspectColorBody', { value: '' });
    elements.set('inspectColorText', { value: '' });
  }
  const places = ['field-up', 'field-down', 'hand', 'deck'].map((place) => ({
    dataset: { place },
  }));
  const sent = [];
  const pieces = new Map();
  const visuals = new Map();
  const visibility = [];
  const room = { state: { pieces }, send: (type, payload) => sent.push([type, payload]) };
  const pending = new Map();
  let time = 0;
  let nextTimer = 0;
  let handRenders = 0;
  const singles = [];
  const capture = [];
  const cardMesh = () =>
    new THREE.Mesh(new THREE.BoxGeometry(1, 0.02, 1.5), new THREE.MeshBasicMaterial());
  const inspection = createInspection({
    THREE,
    scene,
    camera,
    controls,
    canvas: {
      setPointerCapture: (id) => capture.push(['set', id]),
      releasePointerCapture: (id) => capture.push(['release', id]),
    },
    kinds: { die: { mesh: () => cardMesh() } },
    config: {
      inspect: { fit: 2, drop: 0, dist: 3 },
      input: { dblMs: 300, clickMs: 320, inspectPx: 4 },
    },
    deviceClass: () => 'desktop',
    getRoom: () => room,
    getPieceVisual: (id) => visuals.get(id),
    setOriginalVisible: (id, visible) => {
      const entry = visuals.get(id);
      if (entry) entry.mesh.visible = visible;
      visibility.push([id, visible]);
    },
    meshPropsOf: () => ({}),
    byId: (id) => elements.get(id),
    queryAll: () => places,
    setBtnLabel: () => {},
    buildTextureChips: () => {},
    saveDiceDefault: () => {},
    clearDiceDefault: () => {},
    onReleaseHand: () => handRenders++,
    onSingleClick: (...args) => singles.push(args),
    doc: { createElement: () => ({}) },
    now: () => time,
    delay: (fn) => {
      const id = ++nextTimer;
      pending.set(id, fn);
      return id;
    },
    cancelDelay: (id) => pending.delete(id),
  });
  return {
    inspection,
    camera,
    controls,
    deckButton,
    elements,
    places,
    sent,
    pieces,
    visuals,
    visibility,
    pending,
    singles,
    capture,
    cardMesh,
    setTime: (value) => (time = value),
    handRenders: () => handRenders,
  };
}

test('table card inspection hides only its original and restores it on click release', () => {
  const f = fixture();
  const mesh = f.cardMesh();
  f.visuals.set('card-1', { type: 'card', mesh });
  f.pieces.set('card-1', { props: '{}' });
  f.inspection.enterInspect('card-1');
  assert.equal(f.inspection.isInspecting('card-1'), true);
  assert.equal(mesh.visible, false);
  assert.equal(f.controls.enabled, false);
  assert.equal(f.elements.get('inspectHint').hidden, false);
  assert.equal(
    f.inspection.beginPointer({ primary: true, clientX: 0, clientY: 0, pointerId: 7 }),
    true,
  );
  assert.equal(f.inspection.endPointer({ pointerId: 7 }), true);
  assert.equal(f.inspection.isActive(), false);
  assert.equal(mesh.visible, true);
  assert.equal(f.controls.enabled, true);
  assert.deepEqual(f.visibility, [
    ['card-1', false],
    ['card-1', true],
  ]);
  assert.deepEqual(f.capture, [
    ['set', 7],
    ['release', 7],
  ]);
});

test('inspect drag rotates without closing, while an unplaced drawn card returns to deck', () => {
  const f = fixture();
  f.inspection.inspectMesh(f.cardMesh(), { type: 'card', drawn: true });
  const pivot = f.camera.children[0];
  const before = pivot.quaternion.clone();
  f.inspection.beginPointer({ primary: true, clientX: 0, clientY: 0, pointerId: 4 });
  f.inspection.movePointer({ clientX: 12, clientY: 8 });
  f.inspection.endPointer({ pointerId: 4 });
  assert.equal(f.inspection.isActive(), true);
  assert.equal(pivot.quaternion.equals(before), false);
  f.inspection.releaseInspect();
  assert.deepEqual(f.sent, [['inspectPlace', { where: 'deck' }]]);
});

test('hand-card placement uses playCard and restores the hand; deck option stays hidden', () => {
  const f = fixture();
  f.inspection.inspectMesh(f.cardMesh(), { type: 'card', drawn: true, hid: 'h1' });
  assert.equal(f.deckButton.hidden, true);
  f.places[0].onclick();
  assert.deepEqual(f.sent, [['playCard', { hid: 'h1', faceDown: false }]]);
  assert.equal(f.handRenders(), 1);
  assert.equal(f.inspection.isActive(), false);
});

test('a second click inspects a piece or draws a deck instead of sending the single click', () => {
  const f = fixture();
  f.visuals.set('card-1', { type: 'card', mesh: f.cardMesh() });
  f.pieces.set('card-1', { props: '{}' });
  f.inspection.handleDeferredClick('card-1', 'card', 'flip');
  f.setTime(100);
  f.inspection.handleDeferredClick('card-1', 'card', 'flip');
  assert.equal(f.pending.size, 0);
  assert.deepEqual(f.singles, []);
  assert.equal(f.inspection.isInspecting('card-1'), true);
  f.inspection.releaseInspect();
  f.inspection.handleDeferredClick('deck-1', 'deck', 'deal');
  f.setTime(200);
  f.inspection.handleDeferredClick('deck-1', 'deck', 'deal');
  assert.deepEqual(f.sent, [['drawInspect', { deckId: 'deck-1' }]]);
  f.setTime(1000);
  f.inspection.handleDeferredClick('card-1', 'card', 'flip');
  f.pending.values().next().value();
  assert.deepEqual(f.singles, [['flip', 'card-1']]);
});

test('inspected die color changes update the preview and send the same recolor message', () => {
  const f = fixture({ appearance: true });
  const original = f.cardMesh();
  f.visuals.set('die-1', { type: 'die', mesh: original });
  f.pieces.set('die-1', { props: '{"sides":6,"color":255}' });
  f.inspection.enterInspect('die-1');
  const before = f.camera.children[0].children[0];
  const body = f.elements.get('inspectColorBody');
  body.value = '#336699';
  body.onchange();
  assert.equal(f.camera.children[0].children[0] === before, false);
  assert.equal(original.visible, false);
  assert.deepEqual(f.sent, [['recolor', { id: 'die-1', color: 0x336699, textColor: 0xf4f1ea }]]);
});
