import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import { createTrays } from '../public/table/trays.js';
import { seatAngle, trayCenter } from '../shared/pieces.js';

function fixture() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(2, 8, 12);
  const controls = {
    target: new THREE.Vector3(0, 0, 0),
    enabled: true,
    updates: 0,
    update() {
      this.updates++;
    },
  };
  const state = {
    feltColor: '#123456',
    tableX: 10,
    tableZ: 7,
    trays: new Map(),
    pieces: new Map(),
  };
  const sent = [];
  const room = { state, send: (type, data) => sent.push({ type, data }) };
  const ids = new Map(
    ['trayTools', 'trayBack', 'trayAway', 'trayRoll', 'trayScoop', 'trayClearBtn'].map((id) => [
      id,
      { hidden: id === 'trayTools' },
    ]),
  );
  const rollButtons = [{}, {}];
  const dieButtons = [
    { dataset: { sides: '6' } },
    { dataset: { sides: '6', model: 'pip-square' } },
  ];
  const doc = {
    querySelectorAll: (selector) =>
      selector === '.rollBtn' ? rollButtons : selector === '#trayTools .trayDie' ? dieButtons : [],
  };
  let time = 1000,
    seat = 0,
    built = 0;
  const trays = createTrays({
    THREE,
    scene,
    camera,
    controls,
    trayMesh: (color) => {
      assert.equal(color, state.feltColor);
      built++;
      return new THREE.Group();
    },
    trayCenter,
    seatAngle,
    getRoom: () => room,
    getSeat: () => seat,
    getDieProps: (sides) => ({ sides, color: 42 }),
    byId: (id) => ids.get(id),
    doc,
    now: () => time,
  });
  return {
    trays,
    scene,
    camera,
    controls,
    state,
    sent,
    ids,
    rollButtons,
    dieButtons,
    setTime: (value) => (time = value),
    setSeat: (value) => (seat = value),
    built: () => built,
  };
}

test('personal trays follow synced seats and table resizing without duplicate meshes', () => {
  const f = fixture();
  f.state.trays.set('0', true);
  f.state.trays.set('2', true);
  f.trays.sync(f.state.trays);
  f.trays.sync(f.state.trays);
  assert.equal(f.built(), 2);
  assert.equal(f.scene.children.length, 2);
  const mine = f.scene.children[0];
  const other = f.scene.children[1];
  const oldX = other.position.x;
  f.state.tableX = 12;
  f.trays.position();
  const expected = trayCenter(seatAngle(2), 12, 7);
  assert.equal(other.position.x, expected.x);
  assert.equal(other.position.z, expected.z);
  assert.notEqual(other.position.x, oldX);
  assert.equal(mine.rotation.y, seatAngle(0));
  f.state.trays.delete('2');
  f.trays.sync(f.state.trays);
  assert.deepEqual(f.scene.children, [mine]);
});

test('show-then-visit and Back preserve the original camera through both tweens', () => {
  const f = fixture();
  const original = f.camera.position.clone();
  f.trays.open();
  assert.deepEqual(f.sent.at(-1), { type: 'trayShow', data: { on: true } });
  assert.equal(f.trays.isViewing(), false);
  f.state.trays.set('0', true);
  f.trays.sync(f.state.trays);
  assert.equal(f.trays.isViewing(), true);
  assert.equal(f.trays.isCameraMoving(), true);
  assert.equal(f.ids.get('trayTools').hidden, false);
  assert.equal(f.controls.enabled, false);
  f.setTime(1550);
  assert.equal(f.trays.updateCamera(), true);
  assert.equal(f.trays.isCameraMoving(), false);
  assert.equal(f.controls.enabled, true);
  assert.equal(f.camera.position.y, 12);
  f.trays.close();
  assert.equal(f.ids.get('trayTools').hidden, true);
  f.setTime(2100);
  assert.equal(f.trays.updateCamera(), true);
  assert.ok(f.camera.position.distanceTo(original) < 1e-9);
  assert.equal(f.trays.updateCamera(), false);
  assert.equal(f.controls.updates, 2);
});

test('putting away my tray removes its mesh and returns from the tray view', () => {
  const f = fixture();
  const original = f.camera.position.clone();
  f.state.trays.set('0', true);
  f.trays.sync(f.state.trays);
  f.trays.open();
  f.setTime(1550);
  f.trays.updateCamera();
  f.state.trays.delete('0');
  f.trays.sync(f.state.trays);
  assert.equal(f.scene.children.length, 0);
  assert.equal(f.trays.isViewing(), false);
  assert.equal(f.ids.get('trayTools').hidden, true);
  f.setTime(2100);
  f.trays.updateCamera();
  assert.ok(f.camera.position.distanceTo(original) < 1e-9);
});

test('tray controls send the existing protocol and die lookup keeps only my dice', () => {
  const f = fixture();
  f.state.pieces.set('mine', { type: 'die', props: '{"traySeat":0}' });
  f.state.pieces.set('other', { type: 'die', props: '{"traySeat":2}' });
  f.state.pieces.set('bad', { type: 'die', props: '{broken' });
  f.state.pieces.set('card', { type: 'card', props: '{"traySeat":0}' });
  assert.deepEqual(f.trays.dieIds(), ['mine']);
  f.setSeat(2);
  assert.deepEqual(f.trays.dieIds(), ['other']);
  f.setSeat(0);

  f.trays.bindControls();
  f.dieButtons[0].onclick();
  f.dieButtons[1].onclick();
  f.ids.get('trayRoll').onclick();
  f.ids.get('trayScoop').onclick();
  f.ids.get('trayClearBtn').onclick();
  f.ids.get('trayAway').onclick();
  assert.deepEqual(f.sent, [
    { type: 'spawn', data: { type: 'die', props: { sides: 6, color: 42, tray: true } } },
    {
      type: 'spawn',
      data: { type: 'die', props: { sides: 6, color: 42, model: 'pip-square', tray: true } },
    },
    { type: 'roll', data: undefined },
    { type: 'trayScoop', data: undefined },
    { type: 'trayClear', data: undefined },
    { type: 'trayShow', data: { on: false } },
  ]);
  f.rollButtons[0].onclick();
  assert.deepEqual(f.sent.at(-1), { type: 'trayShow', data: { on: true } });
});

test('seatless spectators cannot open or create a seat-zero tray', () => {
  const h = fixture();
  h.setSeat(-1);
  h.state.trays.set('0', true);
  h.trays.open();
  assert.equal(h.trays.isViewing(), false);
  assert.deepEqual(h.sent, []);
});
