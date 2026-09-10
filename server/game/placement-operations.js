import * as CANNON from 'cannon-es';
import { gridActive } from '../../shared/pieces.js';
import { readProps } from './props-codec.js';

// Publish one authoritative Cannon transform into its synchronized piece record.
export function writeTransform(piece, body) {
  piece.x = body.position.x;
  piece.y = body.position.y;
  piece.z = body.position.z;
  piece.qx = body.quaternion.x;
  piece.qy = body.quaternion.y;
  piece.qz = body.quaternion.z;
  piece.qw = body.quaternion.w;
}

// Freeze a settled dynamic piece on its snapped cell while keeping it collidable.
export function pinPiece(room, id) {
  const body = room.bodies.get(id);
  if (!body || body.__pinned || body.type !== CANNON.Body.DYNAMIC) return;
  body.__pinned = true;
  body.type = CANNON.Body.STATIC;
  body.velocity.setZero();
  body.angularVelocity.setZero();
  body.updateMassProperties();
  body.sleep();
}

// Restore a pinned body to ordinary dynamic simulation before it moves again.
export function unpinPiece(room, id) {
  const body = room.bodies.get(id);
  if (!body || !body.__pinned) return;
  body.__pinned = false;
  body.type = CANNON.Body.DYNAMIC;
  body.updateMassProperties();
  body.wakeUp();
}

export function wantsSnap(room, piece) {
  if (!gridActive(room.state.scale)) return false;
  return !!readProps(piece).snap;
}
