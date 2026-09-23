import * as CANNON from 'cannon-es';
import {
  TRAY,
  SEAT_ANGLES,
  inTray,
  seatAngle,
  trayCenter,
  trayCollisionParts,
  trayPlace,
} from '../../shared/pieces.js';

// Find non-overlapping, centre-first positions for the current dice. Use each physics body's
// bounding radius so mixed die shapes cannot be teleported into one another. If the tray is too
// full for a single layer, leave all dice where they are instead of creating new overlaps.
function scoopLayout(dice) {
  const step = Math.max(0.05, TRAY.scoopGridStep);
  const candidates = [];
  for (let ix = -Math.ceil(TRAY.hx / step); ix <= Math.ceil(TRAY.hx / step); ix++)
    for (let iz = -Math.ceil(TRAY.hz / step); iz <= Math.ceil(TRAY.hz / step); iz++) {
      const x = ix * step,
        z = iz * step;
      candidates.push({ x, z, distance2: x * x + z * z });
    }
  candidates.sort((a, b) => a.distance2 - b.distance2 || a.z - b.z || a.x - b.x);
  const placed = [];
  for (const die of dice) {
    const radius = die.radius;
    const slot = candidates.find(({ x, z }) => {
      if (Math.abs(x) + radius + TRAY.scoopGap > TRAY.hx) return false;
      if (Math.abs(z) + radius + TRAY.scoopGap > TRAY.hz) return false;
      return placed.every(
        (other) =>
          (x - other.x) ** 2 + (z - other.z) ** 2 >= (radius + other.radius + TRAY.scoopGap) ** 2,
      );
    });
    if (!slot) return null;
    placed.push({ x: slot.x, z: slot.z, radius });
  }
  return placed;
}

export function scoopTrayDice(room, seat) {
  const dice = [];
  room.state.pieces.forEach((piece, id) => {
    const body = room.bodies.get(id);
    if (piece.type !== 'die' || !body || body.__traySeat !== seat) return;
    const radius =
      Number.isFinite(body.boundingRadius) && body.boundingRadius > 0
        ? body.boundingRadius
        : TRAY.scoopRadiusFallback;
    dice.push({ id, body, radius });
  });
  if (!dice.length) return 0;
  dice.sort((a, b) => b.radius - a.radius || String(a.id).localeCompare(String(b.id)));
  const slots = scoopLayout(dice);
  const center = room.trayCenterFor(seat);
  const angle = seatAngle(seat);
  dice.forEach(({ body, radius }, index) => {
    if (slots) {
      body.updateAABB?.();
      const support = body.aabb ? body.position.y - body.aabb.lowerBound.y : radius;
      const local = {
        x: slots[index].x,
        y: Math.max(0, support) + TRAY.scoopFloorLift,
        z: slots[index].z,
      };
      const position = trayPlace(local, center, angle);
      body.position.set(position.x, position.y, position.z);
      body.previousPosition?.copy(body.position);
      body.interpolatedPosition?.copy(body.position);
      body.aabbNeedsUpdate = true;
    }
    body.velocity.setZero();
    body.angularVelocity.setZero();
    body.sleep();
  });
  return dice.length;
}

// Own the server-side physics and lifecycle operations for each seat's personal dice tray.
// The room remains responsible for synchronized state, piece removal, and exposing facades.
export function createTrayOperations({ random = Math.random } = {}) {
  const trayCenterFor = (room, seat) =>
    trayCenter(seatAngle(seat), room.state.tableX, room.state.tableZ);

  const repositionTrayDice = (room) => {
    // Table bounds are created before the room's piece-body map, so early rebuilds have no dice.
    if (!room.bodies) return;
    room.bodies.forEach((body) => {
      if (body.__traySeat == null) return;
      const seat = body.__traySeat;
      const angle = seatAngle(seat);
      const center = trayCenterFor(room, seat);
      if (inTray(body.position.x, body.position.z, center, angle, TRAY.recoverySlack)) return;
      const position = trayPlace({ x: 0, y: TRAY.recoveryY, z: 0 }, center, angle);
      body.position.set(position.x, position.y, position.z);
      body.velocity.setZero();
      body.angularVelocity.setZero();
      body.wakeUp();
    });
  };

  const buildTrays = (room) => {
    const world = room.world;
    const material = world.__mat;
    for (const body of room._trayBounds || []) world.removeBody(body);
    room._trayBounds = [];
    repositionTrayDice(room);
    room.state.trays.forEach((on, seatKey) => {
      if (!on) return;
      const seat = +seatKey;
      const angle = seatAngle(seat);
      const center = trayCenterFor(room, seat);
      const spin = new CANNON.Quaternion();
      spin.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), angle);
      for (const part of trayCollisionParts()) {
        const body = new CANNON.Body({ mass: 0, material });
        body.addShape(new CANNON.Box(new CANNON.Vec3(part.hx, part.hy, part.hz)));
        const position = trayPlace(part, center, angle);
        body.position.set(position.x, position.y, position.z);
        body.quaternion.copy(spin);
        body.__traySeat = seat;
        world.addBody(body);
        room._trayBounds.push(body);
      }
    });
  };

  const trayDropPos = (room, seat) => {
    const center = trayCenterFor(room, seat);
    const angle = seatAngle(seat);
    const localX = (random() * 2 - 1) * (TRAY.hx - TRAY.spawnInset);
    const localZ = (random() * 2 - 1) * (TRAY.hz - TRAY.spawnInset);
    const position = trayPlace({ x: localX, y: TRAY.spawnY, z: localZ }, center, angle);
    return [position.x, position.y, position.z];
  };

  const clearTraySeat = (room, seat) => {
    const ids = [];
    room.state.pieces.forEach((piece, id) => {
      const body = room.bodies.get(id);
      if (piece.type === 'die' && body && body.__traySeat === seat) ids.push(id);
    });
    for (const id of ids) room.removePiece(id);
  };

  const applyTrays = (room, seats) => {
    room.state.trays.clear();
    for (const value of Array.isArray(seats) ? seats : []) {
      const seat = +value;
      if (seat >= 0 && seat < SEAT_ANGLES.length) room.state.trays.set(String(seat), true);
    }
    buildTrays(room);
  };

  return {
    applyTrays,
    buildTrays,
    clearTraySeat,
    repositionTrayDice,
    trayCenterFor,
    trayDropPos,
  };
}
