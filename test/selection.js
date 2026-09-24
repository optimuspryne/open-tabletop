import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import {
  cardFamilySig,
  composeState,
  createSelection,
  dispenserSig,
  gatherPlan,
  selectionPalette,
} from '../public/table/selection.js';

const piece = (type, props = {}) => ({ type, props: JSON.stringify(props) });
const card = (props) => piece('card', props);
const stack = (props) => piece('dispenser', { disp: 'pokerStack', ...props });
const chip = (props) => piece('prop', { shape: 'poker_chip', ...props });
const compose = (pieces) => composeState(pieces, cardFamilySig);

test('card composition ignores unrelated/missing pieces and requires two compatible cards/decks', () => {
  assert.equal(compose([]), null);
  assert.equal(compose([card(), undefined, chip()]), null);
  assert.equal(compose([card(), piece('deck'), chip()]), 'ok');
  assert.equal(compose([card({ back: 'a' }), card({ back: 'b' })]), 'mixed');
  assert.equal(compose([card({ open: true, back: 'a' }), card({ open: true, back: 'b' })]), 'ok');
  for (const props of [{ open: true }, { snap: true }, { tile: 'square' }, { geom: [1, 2] }])
    assert.equal(compose([card(), card(props)]), 'mixed');
  assert.equal(compose([{ type: 'card', props: 'broken json' }, card()]), 'ok');
});

test('gather merges matching finite dispensers and excludes infinite bowls', () => {
  assert.equal(gatherPlan([stack(), stack()]).msg, 'gatherDispensers');
  assert.equal(gatherPlan([stack(), stack()]).state, 'ok');
  for (const props of [{ disp: 'coinStack' }, { color: 1 }, { team: 1 }, { finish: 'metal' }])
    assert.equal(gatherPlan([stack(), stack(props)]).state, 'mixed');
  assert.equal(dispenserSig(piece('dispenser', { disp: 'goBowl' })), null);
  assert.equal(gatherPlan([piece('dispenser', { disp: 'goBowl' }), stack()]).state, null);
});

test('gather chooses absorption for one dispenser, including mixed unrelated loose pieces', () => {
  assert.equal(gatherPlan([stack({ color: 1 }), chip({ color: 2 })]).state, null);
  const plan = gatherPlan([stack({ color: 1 }), chip({ color: 2 }), chip({ color: 1 }), card()]);
  assert.equal(plan.state, 'ok');
  assert.equal(plan.msg, 'absorbIntoDispenser');
  assert.equal(
    gatherPlan([
      piece('dispenser', { disp: 'goBowl', team: 1 }),
      piece('prop', { shape: 'go', team: 1 }),
    ]).state,
    'ok',
  );
});

test('gather creates a dispenser only from matching eligible loose pieces', () => {
  assert.equal(gatherPlan([chip()]).state, null);
  assert.equal(gatherPlan([chip(), chip(), undefined, card()]).msg, 'dispenseFromPieces');
  assert.equal(gatherPlan([chip(), chip()]).state, 'ok');
  assert.equal(gatherPlan([chip({ color: 1 }), chip({ color: 2 })]).state, 'mixed');
  assert.equal(gatherPlan([chip(), piece('prop', { shape: 'coin' })]).state, 'mixed');
  assert.equal(gatherPlan([{ type: 'prop', props: '{bad' }, card()]).state, null);
});

test('custom gather checks asset identity, tint and finish for creation and absorption', () => {
  const asset = { id: 'custom-a', item: { shape: 'custom' }, dispenser: { body: 'stack' } };
  const a = piece('prop', { asset, color: 1, finish: 'wood' });
  assert.equal(gatherPlan([a, a]).state, 'ok');
  for (const overrides of [
    { color: 2 },
    { finish: 'metal' },
    { asset: { ...asset, id: 'other' } },
  ]) {
    const b = piece('prop', { asset, color: 1, finish: 'wood', ...overrides });
    assert.equal(gatherPlan([a, b]).state, 'mixed');
    assert.equal(
      gatherPlan([piece('dispenser', { asset, color: 1, finish: 'wood' }), b]).state,
      null,
    );
  }
  assert.equal(
    gatherPlan([piece('dispenser', { asset, color: 1, finish: 'wood' }), a]).msg,
    'absorbIntoDispenser',
  );
});

test('selection palette agrees across free colors, separates metals/teams, and skips untintable assets', () => {
  assert.equal(selectionPalette([card(), undefined]), null);
  assert.equal(selectionPalette([piece('die'), chip(), card()]).sig, 'free');
  assert.deepEqual(selectionPalette([chip(), piece('prop', { shape: 'coin' })]), { mixed: true });
  assert.equal(
    selectionPalette([
      piece('prop', { shape: 'go', team: 0 }),
      piece('prop', { shape: 'go', team: 1 }),
    ]).team,
    true,
  );
  assert.equal(
    selectionPalette([piece('prop', { asset: { item: { tintMaterial: null } } })]),
    null,
  );
});

function fixture() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.updateMatrixWorld();
  const meshes = new Map();
  const pieces = new Map();
  const sent = [];
  let room = { state: { pieces }, send: (...args) => sent.push(args) };
  let boardTop = 2;
  const classes = new Set();
  const classList = { toggle: (key, on) => (on ? classes.add(key) : classes.delete(key)) };
  const attributes = new Map();
  const button = {
    classList,
    setAttribute: (key, value) => attributes.set(key, value),
    getAttribute: (key) => attributes.get(key),
  };
  const marquee = { style: {}, hidden: true };
  const selection = createSelection({
    THREE,
    scene,
    camera,
    meshes,
    canvas: {
      classList,
      getBoundingClientRect: () => ({ left: 20, top: 30, width: 200, height: 200 }),
    },
    marker: { inner: 0.8, outer: 1, lift: 0.01 },
    getRoom: () => room,
    getBoardTopY: () => boardTop,
    byId: (id) => (id === 'marquee' ? marquee : null),
    doc: { documentElement: {}, querySelectorAll: () => [button] },
    getStyle: () => ({ getPropertyValue: () => '#123456' }),
  });
  const add = (id, type = 'prop', x = 0, z = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    mesh.position.set(x, 0, z);
    mesh.updateMatrixWorld();
    meshes.set(id, { type, mesh });
    pieces.set(id, piece(type));
  };
  const press = (id, extra = {}) =>
    selection.beginPointer(
      { primary: true, additive: true, clientX: 100, clientY: 100, ...extra },
      id,
    );
  return {
    scene,
    meshes,
    selection,
    marquee,
    sent,
    button,
    classes,
    add,
    press,
    disconnect: () => {
      room = null;
    },
    setBoardTop: (y) => {
      boardTop = y;
    },
  };
}

test('selection toggles movable pieces, keeps private IDs, and routes only selection gestures', () => {
  const f = fixture();
  f.add('a');
  f.add('board', 'board');
  assert.equal(f.press('a', { additive: false }), false);
  assert.equal(f.press('a', { rotate: true }), false);
  assert.equal(f.press('a', { primary: false }), false);
  assert.equal(f.press('a'), true);
  f.press('board');
  f.press('missing');
  assert.deepEqual(f.selection.ids(), ['a']);
  f.selection.ids().push('external');
  assert.equal(f.selection.size, 1);
  f.press('a');
  assert.equal(f.selection.size, 0);
});

test('Select tool and Escape preserve the existing two-step exit then clear behavior', () => {
  const f = fixture();
  f.add('a');
  f.selection.bindModeControls();
  f.button.onclick();
  assert.equal(f.selection.isActive(), true);
  assert.equal(f.button.getAttribute('aria-pressed'), 'true');
  assert.equal(f.classes.has('selecting'), true);
  assert.equal(f.press('a', { additive: false, touch: true }), true);
  assert.equal(f.selection.escape(), true);
  assert.equal(f.selection.isActive(), false);
  assert.equal(f.button.getAttribute('aria-pressed'), 'false');
  assert.equal(f.selection.has('a'), true);
  assert.equal(f.selection.escape(), true);
  assert.equal(f.selection.size, 0);
  assert.equal(f.selection.escape(), false);
});

for (const touch of [false, true]) {
  test(`empty-felt ${touch ? 'tap' : 'click'} exits Select mode without clearing selected pieces`, () => {
    const f = fixture();
    f.add('a');
    f.press('a');
    f.selection.endPointer({});
    f.selection.bindModeControls();
    f.button.onclick();
    f.selection.beginPointer({ primary: true, touch, clientX: 100, clientY: 100 }, null);
    f.selection.movePointer({ clientX: 102, clientY: 103 });
    assert.equal(f.selection.isActive(), true);
    f.selection.endPointer({ clientX: 102, clientY: 103 });
    assert.equal(f.selection.isActive(), false);
    assert.equal(f.button.getAttribute('aria-pressed'), 'false');
    assert.equal(f.classes.has('selecting'), false);
    assert.equal(f.marquee.hidden, true);
    assert.deepEqual(f.selection.ids(), ['a']);
    assert.equal(f.selection.beginPointer({ primary: true, touch }, null), false);
  });
}

test('Select drags remain active at the threshold, on release-only movement and after returning to their origin', () => {
  for (const moves of [[], [{ clientX: 106, clientY: 100 }], [{ clientX: 130, clientY: 130 }]]) {
    const f = fixture();
    f.selection.bindModeControls();
    f.button.onclick();
    f.selection.beginPointer({ primary: true, clientX: 100, clientY: 100 }, null);
    for (const move of moves) f.selection.movePointer(move);
    f.selection.endPointer(
      moves.length ? { clientX: 100, clientY: 100 } : { clientX: 106, clientY: 100 },
    );
    assert.equal(f.selection.isActive(), true);
    assert.equal(f.marquee.hidden, true);
  }
});

test('piece clicks and secondary felt clicks do not exit Select mode', () => {
  const f = fixture();
  f.add('a');
  f.selection.bindModeControls();
  f.button.onclick();
  f.selection.beginPointer({ primary: true, clientX: 100, clientY: 100 }, 'a');
  f.selection.endPointer({ clientX: 100, clientY: 100 });
  assert.equal(f.selection.isActive(), true);
  assert.equal(f.selection.has('a'), true);
  assert.equal(f.selection.beginPointer({ primary: false, secondary: true }, null), false);
  assert.equal(f.selection.endPointer({ clientX: 100, clientY: 100 }), false);
  assert.equal(f.selection.isActive(), true);
});

test('marquee projects into the canvas bounds, adds to selection and excludes static/offscreen pieces', () => {
  const f = fixture();
  f.add('a');
  f.add('outside', 'prop', 5);
  f.add('behind', 'prop', 0, 20);
  f.add('board', 'board');
  f.press('outside');
  f.selection.endPointer({});
  f.press(null);
  assert.equal(f.marquee.hidden, false);
  assert.equal(f.selection.movePointer({ clientX: 140, clientY: 160 }), true);
  assert.equal(f.marquee.style.width, '40px');
  assert.equal(f.selection.endPointer({ clientX: 140, clientY: 160 }), true);
  assert.deepEqual(f.selection.ids(), ['outside', 'a']);
  assert.equal(f.marquee.hidden, true);
  assert.equal(f.selection.endPointer({}), false);
  assert.equal(f.selection.movePointer({}), false);
});

test('batch commands preserve IDs and deletion clears selection; disconnected sends are ignored', () => {
  const f = fixture();
  f.add('a');
  f.press('a');
  for (const [key, msg] of [
    ['U', 'setStandGroup'],
    ['g', 'setSnapGroup'],
    ['R', 'rollGroup'],
    ['f', 'flipGroup'],
    ['h', 'takeGroup'],
  ]) {
    assert.equal(f.selection.command(key), true);
    assert.deepEqual(f.sent.at(-1), [msg, { ids: ['a'] }]);
  }
  assert.equal(f.selection.command('['), true);
  assert.deepEqual(f.sent.at(-1), ['rotateGroup', { ids: ['a'], dir: -1 }]);
  assert.equal(f.selection.command('p'), false);
  assert.equal(f.selection.removeSelected(), true);
  assert.deepEqual(f.sent.at(-1), ['removeGroup', { ids: ['a'] }]);
  assert.equal(f.selection.size, 0);
  f.press('a');
  f.disconnect();
  assert.equal(f.selection.command('r'), false);
  assert.equal(f.selection.removeSelected(), false);
});

test('highlight rings follow meshes/board height and dispose on deselection or mesh removal', () => {
  const f = fixture();
  f.add('a');
  f.press('a');
  f.selection.update();
  const ring = f.scene.children[0];
  assert.equal(ring.material.color.getHexString(), '123456');
  assert.equal(ring.position.y, 2.022);
  f.meshes.get('a').mesh.position.x = 4;
  f.setBoardTop(3);
  f.selection.update();
  assert.equal(ring.position.x, 4);
  assert.equal(ring.position.y, 3.022);
  let disposed = 0;
  ring.geometry.addEventListener('dispose', () => disposed++);
  ring.material.addEventListener('dispose', () => disposed++);
  f.selection.remove('a');
  f.selection.update();
  assert.equal(disposed, 2);
  assert.equal(f.scene.children.length, 0);
  f.press('a');
  f.selection.update();
  f.meshes.delete('a');
  f.selection.update();
  assert.equal(f.scene.children.length, 0);
});
