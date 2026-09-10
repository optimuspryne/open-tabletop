import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as CANNON from 'cannon-es';
import {
  advanceFlips,
  driveHeldPieces,
  maintainSnapPins,
  preparePieceMotion,
  selfRightPieces,
} from '../server/game/physics-update.js';

const SIM = {
  cards: { sleepSpeed: 0.5, sleepTime: 0.2 },
  flipArc: 0.7,
  propRight: { strength: 9, maxTilt: 0.85, damp: 0.82 },
  servo: { stiffness: 25, maxSpeed: 45, angDamp: 0.6 },
};

function body({ mass = 1, position = [0, 0, 0] } = {}) {
  const value = new CANNON.Body({ mass });
  value.position.set(...position);
  return value;
}

function harness() {
  const events = [];
  const room = {
    bodies: new Map(),
    flips: new Map(),
    state: {
      pieces: new Map(),
      scale: { gridStyle: 'square', cellWorld: 1, snapAnchor: 'cross' },
    },
    targets: new Map(),
    pinPiece(id) {
      events.push(['pin', id]);
      this.bodies.get(id).__pinned = true;
    },
    standOf(piece) {
      return piece.stand || false;
    },
    unpinPiece(id) {
      events.push(['unpin', id]);
      this.bodies.get(id).__pinned = false;
    },
    wantsSnap(piece) {
      return !!piece.snap;
    },
  };
  return { events, room };
}

test('driveHeldPieces unpins, servos, damps, and levels a held standing body', () => {
  const { events, room } = harness();
  const piece = { owner: 'session', stand: 'upright' };
  const held = body({ position: [0, 1, 0] });
  held.__pinned = true;
  held.addShape(new CANNON.Box(new CANNON.Vec3(1, 1, 1)), new CANNON.Vec3(0, 0.25, 0));
  held.quaternion.setFromEuler(0.3, 0.4, 0.2);
  held.angularVelocity.set(2, 3, 4);
  room.state.pieces.set('piece', piece);
  room.bodies.set('piece', held);
  room.targets.set('piece', { x: 1, y: 2, z: -1 });

  driveHeldPieces(room, SIM);

  assert.deepEqual(events, [['unpin', 'piece']]);
  assert.deepEqual([held.velocity.x, held.velocity.y, held.velocity.z], [25, 18.75, -25]);
  assert.equal(held.quaternion.x, 0);
  assert.equal(held.quaternion.z, 0);
  assert.ok(Math.abs(Math.hypot(held.quaternion.y, held.quaternion.w) - 1) < 1e-12);
  assert.deepEqual(
    [held.angularVelocity.x, held.angularVelocity.y, held.angularVelocity.z],
    [0, 0, 0],
  );
});

test('driveHeldPieces releases malformed targets before they reach Cannon', () => {
  const { room } = harness();
  const piece = { owner: 'session' };
  const held = body();
  held.velocity.set(3, 4, 5);
  room.state.pieces.set('piece', piece);
  room.bodies.set('piece', held);
  room.targets.set('piece', { x: Number.POSITIVE_INFINITY, y: 2, z: 0 });

  driveHeldPieces(room, SIM);

  assert.equal(piece.owner, '');
  assert.equal(room.targets.has('piece'), false);
  assert.deepEqual([held.velocity.x, held.velocity.y, held.velocity.z], [0, 0, 0]);
});

test('selfRightPieces nudges eligible bodies and skips offset flat colliders', () => {
  const { room } = harness();
  const upright = body();
  upright.quaternion.setFromEuler(0.4, 0, 0);
  const offset = body();
  offset.quaternion.setFromEuler(0.4, 0, 0);
  offset.addShape(new CANNON.Box(new CANNON.Vec3(1, 1, 1)), new CANNON.Vec3(0, -0.2, 0));
  room.state.pieces.set('upright', { owner: '', stand: 'upright' });
  room.state.pieces.set('offset', { owner: '', stand: 'flat' });
  room.bodies.set('upright', upright);
  room.bodies.set('offset', offset);

  selfRightPieces(room, SIM);

  assert.ok(upright.angularVelocity.length() > 0);
  assert.equal(offset.angularVelocity.length(), 0);
});

test('maintainSnapPins sets sleep tuning, snaps settled pieces, and releases stale pins', () => {
  const { events, room } = harness();
  const settled = body({ position: [0.24, 1, 1.76] });
  settled.sleep();
  const stale = body();
  stale.__pinned = true;
  room.state.pieces.set('settled', { owner: '', snap: true });
  room.state.pieces.set('stale', { owner: '', snap: false });
  room.bodies.set('settled', settled);
  room.bodies.set('stale', stale);

  maintainSnapPins(room, SIM);

  assert.equal(settled.sleepSpeedLimit, SIM.cards.sleepSpeed);
  assert.equal(settled.sleepTimeLimit, SIM.cards.sleepTime);
  assert.deepEqual([settled.position.x, settled.position.z], [0, 2]);
  assert.deepEqual(events, [
    ['pin', 'settled'],
    ['unpin', 'stale'],
  ]);
});

test('advanceFlips interpolates active flips and finalizes completed bodies', () => {
  const { room } = harness();
  const active = body();
  const complete = body();
  complete.type = CANNON.Body.KINEMATIC;
  complete.velocity.set(1, 2, 3);
  complete.angularVelocity.set(4, 5, 6);
  const start = new CANNON.Quaternion();
  const end = new CANNON.Quaternion();
  end.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI);
  room.bodies.set('active', active);
  room.bodies.set('complete', complete);
  room.flips.set('active', { t: 0, dur: 1, start, end, baseY: 2 });
  room.flips.set('complete', { t: 0.9, dur: 1, start, end, baseY: 3 });
  room.flips.set('missing', { t: 0, dur: 1, start, end, baseY: 4 });

  advanceFlips(room, 0.5, SIM);

  assert.ok(Math.abs(active.position.y - 2.7) < 1e-12);
  assert.equal(room.flips.has('active'), true);
  assert.equal(room.flips.has('complete'), false);
  assert.equal(room.flips.has('missing'), false);
  assert.equal(complete.type, CANNON.Body.DYNAMIC);
  assert.deepEqual([complete.velocity.x, complete.velocity.y, complete.velocity.z], [0, 0, 0]);
  assert.deepEqual(
    [complete.angularVelocity.x, complete.angularVelocity.y, complete.angularVelocity.z],
    [0, 0, 0],
  );
});

test('preparePieceMotion keeps snap maintenance before flip completion', () => {
  const { events, room } = harness();
  const piece = { owner: '', snap: true };
  const flipping = body({ position: [0.2, 1, 0.2] });
  flipping.sleep();
  const start = new CANNON.Quaternion();
  const end = new CANNON.Quaternion();
  end.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), Math.PI);
  room.state.pieces.set('piece', piece);
  room.bodies.set('piece', flipping);
  room.flips.set('piece', { t: 0.9, dur: 1, start, end, baseY: 1 });

  preparePieceMotion(room, 0.2, SIM);

  assert.deepEqual(events, [['pin', 'piece']]);
  assert.equal(room.flips.has('piece'), false);
  assert.equal(flipping.type, CANNON.Body.DYNAMIC);
});
