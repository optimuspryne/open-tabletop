import * as CANNON from 'cannon-es';
import { inTable, inTray, seatAngle, snapToCell, trayPlace } from '../../shared/pieces.js';
import { dragVelocity } from './physics-safety.js';

// Drive held bodies toward their validated cursor targets while preserving physical collisions.
export function driveHeldPieces(room, sim) {
  const { stiffness, maxSpeed, angDamp } = sim.servo;
  room.state.pieces.forEach((piece, id) => {
    if (!piece.owner) return;
    const target = room.targets.get(id);
    const body = room.bodies.get(id);
    if (!body) return;
    if (body.__pinned) room.unpinPiece(id);
    if (!target) return;
    body.wakeUp();

    const velocity = dragVelocity(
      body.position,
      target,
      body.shapeOffsets[0]?.y ?? 0,
      stiffness,
      maxSpeed,
    );
    if (!velocity) {
      room.targets.delete(id);
      piece.owner = '';
      body.velocity.setZero();
      return;
    }
    body.velocity.set(velocity.x, velocity.y, velocity.z);
    body.angularVelocity.scale(angDamp, body.angularVelocity);

    if (room.standOf(piece)) {
      const quat = body.quaternion;
      const magnitude = Math.hypot(quat.w, quat.y) || 1;
      quat.set(0, quat.y / magnitude, 0, quat.w / magnitude);
      body.angularVelocity.setZero();
    }
  });
}

// Nudge the local up-axis of eligible unheld bodies toward world-up before the physics step.
export function selfRightPieces(room, sim) {
  const right = sim.propRight;
  const worldUp = new CANNON.Vec3(0, 1, 0);
  const pieceUp = new CANNON.Vec3();
  const axis = new CANNON.Vec3();
  room.state.pieces.forEach((piece, id) => {
    if (piece.owner) return;
    const standMode = room.standOf(piece);
    if (!standMode) return;
    const body = room.bodies.get(id);
    if (!body || body.sleepState === CANNON.Body.SLEEPING) return;
    if (body.shapeOffsets[0] && Math.abs(body.shapeOffsets[0].y) > 0.01) return;

    body.quaternion.vmult(worldUp, pieceUp);
    pieceUp.cross(worldUp, axis);
    const tilt = axis.length();
    const cutoff = standMode === 'flat' ? 1.5 : right.maxTilt;
    if (tilt > 0.02 && tilt < cutoff) {
      axis.scale(1 / tilt, axis);
      body.angularVelocity.x += axis.x * tilt * right.strength;
      body.angularVelocity.y += axis.y * tilt * right.strength;
      body.angularVelocity.z += axis.z * tilt * right.strength;
      body.angularVelocity.scale(right.damp, body.angularVelocity);
      body.wakeUp();
    }
  });
}

// Freeze snap-enabled pieces only after they settle; release stale pins immediately.
export function maintainSnapPins(room, sim) {
  room.state.pieces.forEach((piece, id) => {
    if (piece.owner) return;
    const body = room.bodies.get(id);
    if (!body) return;
    if (room.wantsSnap(piece)) {
      if (body.sleepTimeLimit !== sim.cards.sleepTime) {
        body.sleepSpeedLimit = sim.cards.sleepSpeed;
        body.sleepTimeLimit = sim.cards.sleepTime;
      }
      if (!body.__pinned && body.sleepState === CANNON.Body.SLEEPING) {
        const position = snapToCell(body.position.x, body.position.z, room.state.scale);
        body.position.x = position.x;
        body.position.z = position.z;
        room.pinPiece(id);
      }
    } else if (body.__pinned) {
      room.unpinPiece(id);
    }
  });
}

// Advance scripted card flips, returning completed bodies to dynamic simulation.
export function advanceFlips(room, dt, sim) {
  for (const [id, flip] of room.flips) {
    const body = room.bodies.get(id);
    if (!body) {
      room.flips.delete(id);
      continue;
    }
    flip.t += dt;
    const progress = Math.min(flip.t / flip.dur, 1);
    flip.start.slerp(flip.end, progress, body.quaternion);
    body.position.y = flip.baseY + Math.sin(progress * Math.PI) * sim.flipArc;
    if (progress >= 1) {
      body.type = CANNON.Body.DYNAMIC;
      body.wakeUp();
      body.velocity.setZero();
      body.angularVelocity.setZero();
      room.flips.delete(id);
    }
  }
}

// Preserve the established pre-step order: held servo, self-righting, snap pins, then flips.
export function preparePieceMotion(room, dt, sim) {
  driveHeldPieces(room, sim);
  selfRightPieces(room, sim);
  maintainSnapPins(room, sim);
  advanceFlips(room, dt, sim);
}

// Recover bodies that escaped either the shared table bounds or their assigned personal tray.
export function recoverEscapedBodies(room, sim) {
  const tableX = room.state.tableX;
  const tableZ = room.state.tableZ;
  const tableShape = room.state.tableShape || 'rect';
  const shapeDepth = tableShape === 'round' || tableShape === 'hex' ? tableX : tableZ;
  const maxInset = Math.max(0, Math.min(tableX, shapeDepth) - 0.25);
  room.bodies.forEach((body) => {
    const position = body.position;
    if (body.__traySeat != null) {
      const seat = body.__traySeat;
      const angle = seatAngle(seat);
      const center = room.trayCenterFor(seat);
      const trayEnabled = room.state.trays.get(String(seat));
      const escaped =
        position.y < sim.bounds.floor ||
        position.y > sim.bounds.ceiling ||
        !trayEnabled ||
        !inTray(position.x, position.z, center, angle, 0.5);
      if (escaped && trayEnabled) {
        const recovered = trayPlace({ x: 0, y: 1, z: 0 }, center, angle);
        position.set(recovered.x, recovered.y, recovered.z);
        body.velocity.setZero();
        body.angularVelocity.setZero();
        body.aabbNeedsUpdate = true;
        body.wakeUp();
      }
      return;
    }

    // Most bodies are well inside the table, so their bounding radius gives a cheap safe-zone
    // check. Only bodies near an edge need an exact current AABB footprint.
    const verticalEscape = position.y < sim.bounds.floor || position.y > sim.bounds.ceiling;
    let inset = Math.min((body.boundingRadius || 0) + 0.1, maxInset);
    let verticalHalf = 0;
    if (verticalEscape || !inTable(position.x, position.z, tableShape, tableX, tableZ, inset)) {
      if (body.shapes.length && body.aabbNeedsUpdate) body.updateAABB();
      if (body.shapes.length) {
        const lower = body.aabb.lowerBound;
        const upper = body.aabb.upperBound;
        inset = Math.min(
          Math.max(
            position.x - lower.x,
            upper.x - position.x,
            position.z - lower.z,
            upper.z - position.z,
          ) + 0.1,
          maxInset,
        );
        verticalHalf = Math.max(position.y - lower.y, upper.y - position.y);
      }
    }
    const escaped =
      verticalEscape || !inTable(position.x, position.z, tableShape, tableX, tableZ, inset);
    if (escaped) {
      // Every supported table is convex and centred at the origin. Binary-searching the ray back
      // toward the centre preserves as much of the escaped position as the real surface permits.
      let low = 0;
      let high = 1;
      if (inTable(0, 0, tableShape, tableX, tableZ, inset)) {
        for (let i = 0; i < 24; i++) {
          const middle = (low + high) / 2;
          if (inTable(position.x * middle, position.z * middle, tableShape, tableX, tableZ, inset))
            low = middle;
          else high = middle;
        }
      }
      position.set(position.x * low, Math.max(3, verticalHalf + 0.5), position.z * low);
      body.velocity.setZero();
      body.angularVelocity.setZero();
      body.aabbNeedsUpdate = true;
      body.wakeUp();
    }
  });
}

// Publish final authoritative body transforms after stepping and escape recovery.
export function publishTransforms(room) {
  room.state.pieces.forEach((piece, id) => {
    const body = room.bodies.get(id);
    if (body) room.writeTransform(piece, body);
  });
}
