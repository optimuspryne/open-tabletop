import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as CANNON from 'cannon-es';
import {
  pinPiece,
  unpinPiece,
  wantsSnap,
  writeTransform,
} from '../server/game/placement-operations.js';

function roomWith(body, scale = { gridStyle: 'square', cellWorld: 1 }) {
  return {
    bodies: new Map(body ? [['piece', body]] : []),
    state: { scale },
  };
}

test('writeTransform publishes the complete authoritative position and orientation', () => {
  const piece = {};
  const body = {
    position: { x: 1, y: 2, z: 3 },
    quaternion: { x: 0.1, y: 0.2, z: 0.3, w: 0.9 },
  };

  writeTransform(piece, body);

  assert.deepEqual(piece, {
    x: 1,
    y: 2,
    z: 3,
    qx: 0.1,
    qy: 0.2,
    qz: 0.3,
    qw: 0.9,
  });
});

test('pinPiece freezes only an ordinary dynamic body and clears its motion', () => {
  const body = new CANNON.Body({ mass: 2 });
  body.velocity.set(1, 2, 3);
  body.angularVelocity.set(4, 5, 6);
  const room = roomWith(body);

  pinPiece(room, 'piece');

  assert.equal(body.__pinned, true);
  assert.equal(body.type, CANNON.Body.STATIC);
  assert.deepEqual([body.velocity.x, body.velocity.y, body.velocity.z], [0, 0, 0]);
  assert.deepEqual(
    [body.angularVelocity.x, body.angularVelocity.y, body.angularVelocity.z],
    [0, 0, 0],
  );
  assert.equal(body.sleepState, CANNON.Body.SLEEPING);
});

test('unpinPiece restores a pinned body to awake dynamic simulation', () => {
  const body = new CANNON.Body({ mass: 2, type: CANNON.Body.STATIC });
  body.__pinned = true;
  body.sleep();
  const room = roomWith(body);

  unpinPiece(room, 'piece');

  assert.equal(body.__pinned, false);
  assert.equal(body.type, CANNON.Body.DYNAMIC);
  assert.equal(body.invMass, 0.5);
  assert.equal(body.sleepState, CANNON.Body.AWAKE);
});

test('pin and unpin ignore missing, static, and already-settled body states', () => {
  const missing = roomWith();
  assert.doesNotThrow(() => pinPiece(missing, 'piece'));
  assert.doesNotThrow(() => unpinPiece(missing, 'piece'));

  const authoredStatic = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC });
  pinPiece(roomWith(authoredStatic), 'piece');
  assert.equal(authoredStatic.__pinned, undefined);

  const dynamic = new CANNON.Body({ mass: 1 });
  dynamic.__pinned = true;
  pinPiece(roomWith(dynamic), 'piece');
  assert.equal(dynamic.type, CANNON.Body.DYNAMIC);

  dynamic.__pinned = false;
  unpinPiece(roomWith(dynamic), 'piece');
  assert.equal(dynamic.type, CANNON.Body.DYNAMIC);
});

test('wantsSnap requires both an active grid and the synchronized snap flag', () => {
  const snapped = { props: JSON.stringify({ snap: true }) };
  const ordinary = { props: JSON.stringify({ snap: false }) };
  assert.equal(wantsSnap(roomWith(), snapped), true);
  assert.equal(wantsSnap(roomWith(), ordinary), false);
  assert.equal(wantsSnap(roomWith(undefined, { gridStyle: 'off', cellWorld: 0 }), snapped), false);
  assert.equal(wantsSnap(roomWith(), { props: '{bad json' }), false);
});
