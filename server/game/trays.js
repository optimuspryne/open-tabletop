import * as CANNON from 'cannon-es';
import {
  TRAY,
  SEAT_ANGLES,
  inTray,
  seatAngle,
  trayCenter,
  trayParts,
  trayPlace,
} from '../../shared/pieces.js';

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
      if (inTray(body.position.x, body.position.z, center, angle, 0.2)) return;
      const position = trayPlace({ x: 0, y: 1, z: 0 }, center, angle);
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
      for (const part of trayParts()) {
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
    const localX = (random() * 2 - 1) * (TRAY.hx - 0.7);
    const localZ = (random() * 2 - 1) * (TRAY.hz - 0.7);
    const position = trayPlace({ x: localX, y: 1.3, z: localZ }, center, angle);
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
