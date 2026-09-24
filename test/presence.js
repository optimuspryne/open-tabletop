import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import { seatAngle } from '../shared/pieces.js';
import { createPresence, seatLayoutFor } from '../public/table/presence.js';

const player = (overrides = {}) => ({
  seat: 0,
  order: 0,
  name: 'Me',
  role: 'player',
  avatar: '',
  color: '#123456',
  hand: 2,
  handBack: 'blue-back',
  showing: 0,
  ...overrides,
});

function fixture(initialPlayers = []) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  const controls = {
    target: new THREE.Vector3(),
    update() {
      camera.lookAt(this.target);
    },
  };
  const state = {
    players: new Map(initialPlayers),
    tableX: 10,
    tableZ: 7,
    turn: '',
    turnPending: '',
    roomName: '',
  };
  const sent = [],
    events = [],
    cards = [],
    markerPlayers = [],
    resized = [];
  const revealed = new Map(),
    messages = new Map(),
    visuals = new Map(),
    listeners = new Map();
  const elements = new Map(
    [
      'myName',
      'myAv',
      'mySeatBtn',
      'birdsEyeBtn',
      'turnBtn',
      'turnMini',
      'roomTitle',
      'avatarInput',
    ].map((id) => {
      const classes = new Set(),
        handlers = new Map();
      return [
        id,
        {
          textContent: '',
          style: {},
          hidden: false,
          classes,
          handlers,
          classList: { toggle: (key, on) => (on ? classes.add(key) : classes.delete(key)) },
          setAttribute(key, value) {
            this[key] = value;
          },
          addEventListener: (key, fn) => handlers.set(key, fn),
          click() {
            this.onclick?.();
          },
        },
      ];
    }),
  );
  const room = {
    state,
    send: (...args) => sent.push(args),
    onMessage: (key, fn) => messages.set(key, fn),
  };
  let added,
    removed,
    rank = 0;
  const cb = (object) => ({
    players: {
      onAdd(fn) {
        added = fn;
        state.players.forEach(fn);
      },
      onRemove(fn) {
        removed = fn;
      },
    },
    listen(key, fn, immediate) {
      assert.equal(immediate, false);
      if (!listeners.has(object)) listeners.set(object, new Map());
      listeners.get(object).set(key, fn);
    },
  });
  const presence = createPresence({
    THREE,
    scene,
    camera,
    controls,
    seatAngle,
    label: { w: 2, h: 0.5, lift: 1 },
    cardMesh: (props) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 0.02, 1.5));
      mesh.userData.card = props;
      cards.push(mesh);
      return mesh;
    },
    makePlayerTexture: (p) => {
      markerPlayers.push({ ...p });
      return new THREE.Texture();
    },
    makeYouChipTexture: () => new THREE.Texture(),
    nameTag: (name, color) => {
      const texture = new THREE.Texture();
      texture.userData = { name, color };
      return texture;
    },
    disposeSprite: (sprite) => {
      scene.remove(sprite);
      sprite.material.map.dispose();
      sprite.material.dispose();
    },
    resizeToCanvas: async (...args) => {
      resized.push(args);
      return { toDataURL: () => 'data:image/jpeg;base64,avatar' };
    },
    setSeatCameraReady: () => events.push('cameraReady'),
    getRoom: () => room,
    getSessionId: () => 'me',
    getRank: () => rank,
    getPieceVisual: (id) => visuals.get(id),
    getRevealed: (sid) => revealed.get(sid) || [],
    setRevealed: (sid, value) => revealed.set(sid, value),
    clearRevealed: (sid) => revealed.delete(sid),
    onLocalRole: (role) => {
      rank = role === 'gm' ? 2 : 0;
      events.push(['role', role]);
    },
    onPlayersChanged: () => events.push('playersChanged'),
    onPlayerRemoved: (sid) => events.push(['removed', sid]),
    onHydration: () => events.push('hydration'),
    byId: (id) => elements.get(id),
    doc: {},
  });
  presence.bindMessages(room);
  presence.bindRoom(room, cb);
  presence.bindControls();
  return {
    presence,
    scene,
    camera,
    controls,
    state,
    sent,
    events,
    cards,
    markerPlayers,
    revealed,
    messages,
    visuals,
    elements,
    resized,
    add(sid, p) {
      state.players.set(sid, p);
      added(p, sid);
    },
    remove(sid) {
      const p = state.players.get(sid);
      state.players.delete(sid);
      removed(p, sid);
    },
    change(object, key, value) {
      object[key] = value;
      listeners.get(object).get(key)();
    },
  };
}

test('seat layout scales all eight cameras and keeps hand positions inside table edges', () => {
  const base = seatLayoutFor(10, 7),
    wide = seatLayoutFor(20, 7);
  assert.equal(base.length, 8);
  assert.deepEqual(base[0].hand, [0, 0.25, 6.2]);
  assert.deepEqual(base[1].out, [0, 0, -1]);
  assert.deepEqual(base[2].out, [1, 0, 0]);
  assert.deepEqual(base[3].out, [-1, 0, 0]);
  for (let i = 0; i < 8; i++) {
    assert.equal(wide[i].cam.pos[0], base[i].cam.pos[0] * 2);
    assert.equal(wide[i].cam.pos[1], base[i].cam.pos[1] * 1.5);
    assert.equal(wide[i].cam.pos[2], base[i].cam.pos[2]);
    assert.ok(Math.abs(wide[i].hand[0]) < 20 && Math.abs(wide[i].hand[2]) < 7);
  }
});

test('late hydration creates the local fan and YOU chip, applies role and signals camera readiness', () => {
  const f = fixture();
  assert.equal(f.scene.children.length, 0);
  f.add('me', player({ seat: 4, role: 'gm', avatar: 'data:image/png;base64,a' }));
  assert.equal(f.presence.getSeat(), 4);
  assert.equal(f.presence.seatName(), 'Front-right');
  assert.deepEqual(f.camera.position.toArray(), seatLayoutFor(10, 7)[4].cam.pos);
  assert.deepEqual(f.events, ['hydration', 'cameraReady', ['role', 'gm'], 'playersChanged']);
  assert.equal(f.elements.get('myName').textContent, 'Me');
  assert.equal(f.elements.get('myAv').style.backgroundImage, 'url(data:image/png;base64,a)');
  assert.equal(f.markerPlayers.length, 0); // never place our standing avatar in our own view
  assert.equal(f.scene.children.length, 2);
  assert.deepEqual(f.presence.handDropPosition(), { x: 4.6000000000000005, z: 2.83 });
});

test('existing players replay on refresh and seat changes reframe without duplicate scene groups', () => {
  const me = player(),
    other = player({ seat: 1, name: 'Other' });
  const f = fixture([
    ['me', me],
    ['other', other],
  ]);
  assert.equal(f.scene.children.length, 4);
  assert.equal(f.markerPlayers.length, 1);
  f.change(me, 'seat', 3);
  assert.deepEqual(f.camera.position.toArray(), seatLayoutFor(10, 7)[3].cam.pos);
  assert.equal(f.presence.getSeat(), 3);
  assert.equal(f.scene.children.length, 4);
  f.change(other, 'seat', 6);
  assert.equal(f.scene.children.length, 4);
  assert.equal(f.presence.getSeat(), 3);
});

test('resize repositions fans and YOU chip without moving the camera; My Seat uses new framing', () => {
  const f = fixture([
    ['me', player()],
    ['other', player({ seat: 2 })],
  ]);
  const original = f.camera.position.clone();
  f.state.tableX = 20;
  f.state.tableZ = 14;
  f.presence.rebuildSeats();
  assert.ok(f.camera.position.equals(original));
  assert.equal(f.scene.children.length, 4);
  const ownFan = f.scene.children.find((node) => node.isGroup && node.children[0]?.userData.card);
  assert.equal(ownFan.children[0].position.z, 13.2);
  assert.deepEqual(f.presence.handDropPosition(), { x: 0, z: 11.2 });
  f.elements.get('mySeatBtn').click();
  assert.deepEqual(f.camera.position.toArray(), seatLayoutFor(20, 14)[0].cam.pos);
  f.camera.aspect = 0.5;
  f.elements.get('birdsEyeBtn').click();
  assert.deepEqual(f.controls.target.toArray(), [0, 0, 0]);
  assert.equal(f.camera.position.z, 0.001);
  assert.ok(f.camera.position.y >= 20 / (Math.tan(Math.PI / 6) * 0.5));
});

test('public fans cap at twelve, refresh backs, and reveal only supplied face-up cards', () => {
  const p = player({ seat: 1, hand: 20 });
  const f = fixture([['other', p]]);
  const fan = f.scene.children.find((node) => node.children[0]?.userData.card);
  assert.equal(fan.children.length, 12);
  assert.ok(
    fan.children.every((m) => m.userData.card.back === 'blue-back' && !m.userData.card.front),
  );
  f.change(p, 'handBack', 'red-back');
  assert.equal(fan.children[0].userData.card.back, 'red-back');
  f.messages.get('showFan')({ sid: 'other', cards: [{ front: 'ace', back: 'blue-back' }] });
  assert.deepEqual(fan.children[0].userData.card, { front: 'ace', back: 'blue-back' });
  assert.deepEqual(fan.children[1].userData.card, { back: 'red-back' });
  assert.ok(fan.children[1].position.y > fan.children[0].position.y);
  f.messages.get('showFan')({ sid: 'other', cards: [] });
  assert.ok(!fan.children[0].userData.card.front);
  f.change(p, 'hand', 0);
  assert.equal(fan.children.length, 0);
});

test('player property listeners refresh local chrome and remote markers', () => {
  const me = player(),
    other = player({ seat: 1 });
  const f = fixture([
    ['me', me],
    ['other', other],
  ]);
  f.change(me, 'name', '<b>Alice</b>');
  assert.equal(f.elements.get('myName').textContent, '<b>Alice</b>');
  f.change(me, 'avatar', '');
  assert.equal(f.elements.get('myAv').style.backgroundImage, 'none');
  f.change(me, 'role', 'gm');
  assert.deepEqual(f.events.at(-1), ['role', 'gm']);
  for (const [key, value] of [
    ['name', 'Bob'],
    ['avatar', 'data:image/png;base64,b'],
    ['color', '#ffffff'],
    ['showing', 3],
  ]) {
    f.change(other, key, value);
    assert.equal(f.markerPlayers.at(-1)[key], value);
  }
  const count = f.scene.children.length;
  f.change(me, 'color', '#ffffff');
  assert.equal(f.scene.children.length, count);
});

test('turn state, pending players, room title and next-turn controls stay synchronized', () => {
  const f = fixture([
    ['me', player({ role: 'owner' })],
    ['other', player({ name: 'Bob', seat: 1 })],
  ]);
  assert.equal(f.elements.get('roomTitle').textContent, 'Me’s Table');
  f.change(f.state, 'turn', 'me');
  assert.equal(f.elements.get('turnMini').textContent, 'Your Turn');
  assert.ok(f.elements.get('turnBtn').classes.has('myturn'));
  f.change(f.state, 'turn', 'other');
  assert.equal(f.elements.get('turnMini').textContent, "Bob's turn");
  f.change(f.state, 'turnPending', 'Absent');
  assert.equal(f.elements.get('turnMini').textContent, '⏳ Absent');
  f.change(f.state, 'roomName', 'Our Game');
  assert.equal(f.elements.get('roomTitle').textContent, 'Our Game');
  f.elements.get('turnBtn').click();
  assert.deepEqual(f.sent.at(-1), ['nextTurn']);
});

test('player removal removes fans and markers, clears reveals, and notifies other features', () => {
  const f = fixture([
    ['me', player()],
    ['other', player({ seat: 1 })],
  ]);
  f.revealed.set('other', [{ front: 'ace' }]);
  f.remove('other');
  assert.equal(f.scene.children.length, 2);
  assert.equal(f.revealed.has('other'), false);
  assert.deepEqual(f.events.slice(-3), ['hydration', ['removed', 'other'], 'playersChanged']);
});

test('held-piece labels skip local/unknown owners, follow live meshes and dispose on release', () => {
  const f = fixture([['other', player({ name: 'Bob' })]]);
  const mesh = new THREE.Mesh();
  mesh.position.set(2, 3, 4);
  f.visuals.set('piece', { mesh });
  f.presence.updateHeldLabel('piece', 'me');
  f.presence.updateHeldLabel('piece', 'missing');
  assert.equal(f.scene.children.filter((node) => node.isSprite).length, 0);
  f.presence.updateHeldLabel('piece', 'other');
  f.presence.update();
  const sprite = f.scene.children.find((node) => node.isSprite);
  assert.deepEqual(sprite.position.toArray(), [2, 4, 4]);
  assert.equal(sprite.material.map.userData.name, 'Bob');
  let disposed = 0;
  sprite.material.map.addEventListener('dispose', () => disposed++);
  sprite.material.addEventListener('dispose', () => disposed++);
  f.presence.updateHeldLabel('piece', '');
  assert.equal(disposed, 2);
  assert.equal(sprite.parent, null);
});

test('avatar control resizes the chosen image and sends the existing setAvatar protocol', async () => {
  const f = fixture();
  const file = { name: 'avatar.png' };
  await f.elements.get('avatarInput').handlers.get('change')({ target: { files: [file] } });
  assert.deepEqual(f.resized, [[file, 512, 512]]);
  assert.deepEqual(f.sent.at(-1), ['setAvatar', { data: 'data:image/jpeg;base64,avatar' }]);
});

test('placard replacement and departure dispose their owned model and texture resources', () => {
  const f = fixture();
  const other = player({ seat: 1 });
  f.add('other', other);
  const marker = f.scene.children.find(
    (node) =>
      node.isGroup && node.children.some((child) => child.geometry?.type === 'PlaneGeometry'),
  );
  let disposed = 0;
  marker.traverse((node) => {
    node.geometry?.addEventListener('dispose', () => disposed++);
    node.material?.addEventListener('dispose', () => disposed++);
    node.material?.map?.addEventListener('dispose', () => disposed++);
  });
  f.change(other, 'name', 'Updated');
  assert.equal(disposed, 5);
  assert.ok(!f.scene.children.includes(marker));
  const replacement = f.scene.children.find(
    (node) =>
      node.isGroup && node.children.some((child) => child.geometry?.type === 'PlaneGeometry'),
  );
  replacement.traverse((node) => {
    node.geometry?.addEventListener('dispose', () => disposed++);
    node.material?.addEventListener('dispose', () => disposed++);
    node.material?.map?.addEventListener('dispose', () => disposed++);
  });
  f.remove('other');
  assert.equal(disposed, 10);
  assert.ok(!f.scene.children.includes(replacement));
});
