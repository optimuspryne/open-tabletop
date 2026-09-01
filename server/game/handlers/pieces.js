import * as CANNON from 'cannon-es';
import { KINDS, dieSpawnProps, gridActive, snapToCell } from '../../../shared/pieces.js';
import { RANK } from '../../permissions.js';
import {
  groupIds,
  groupRecolor,
  groupRotation,
  pieceIdPayload,
  recolorPayload,
  spawnPayload,
} from '../../message-validation.js';
import { readProps, writeProps } from '../props-codec.js';
import { safeMessage } from '../safe-message.js';

// Register piece and multi-selection operations. The room remains responsible
// for constructing/removing physics bodies; this module owns message policy and
// the small body mutations that implement user intent.
export function registerPieceHandlers(
  room,
  {
    maxPieces,
    flipHop,
    roll,
    trayRoll,
    boardKeys,
    propKeys,
    dispenserKeys,
    colliders,
    geoOf,
    randomPosition,
    random = Math.random,
    logger = console,
  },
) {
  const pieceMessage = (type, handler) => safeMessage(room, type, handler, { logger });
  const idsFrom = (message) => groupIds(message, { max: maxPieces });

  pieceMessage('setStandGroup', (client, message) => {
    const ids = idsFrom(message);
    if (!ids) return;
    const anyStanding = ids.some((id) => {
      const piece = room.state.pieces.get(id);
      return piece && room.standOf(piece);
    });
    for (const id of ids) {
      const piece = room.state.pieces.get(id);
      if (!piece) continue;
      const props = readProps(piece);
      props.stand = anyStanding ? false : room.naturalStand(piece);
      writeProps(piece, props);
      room.bodies.get(id)?.wakeUp();
    }
  });

  pieceMessage('setSnapGroup', (client, message) => {
    const ids = idsFrom(message);
    if (!ids) return;
    const anySnap = ids.some((id) => readProps(room.state.pieces.get(id)).snap);
    for (const id of ids) {
      const piece = room.state.pieces.get(id);
      if (!piece) continue;
      const props = readProps(piece);
      props.snap = !anySnap;
      writeProps(piece, props);
      applySnap(room, id, props.snap);
    }
  });

  pieceMessage('rollGroup', (client, message) => {
    const ids = idsFrom(message);
    if (!ids) return;
    let count = 0;
    for (const id of ids) {
      const piece = room.state.pieces.get(id);
      const body = room.bodies.get(id);
      if (!piece || piece.type !== 'die' || !body) continue;
      rollBody(body, body.__traySeat != null ? trayRoll : roll, random);
      count++;
    }
    if (count) room.broadcast('sfx', { type: count > 1 ? 'dice-roll' : 'die-roll' });
  });

  pieceMessage('flipGroup', (client, message) => {
    const ids = idsFrom(message);
    if (!ids) return;
    let count = 0;
    for (const id of ids) {
      const piece = room.state.pieces.get(id);
      const body = room.bodies.get(id);
      if (!piece || piece.type !== 'card' || !body) continue;
      const props = readProps(piece);
      if (props.front) {
        room.cardData.set(id, { front: props.front });
        delete props.front;
      } else if (room.cardData.has(id)) {
        props.front = room.cardData.get(id).front;
        room.cardData.delete(id);
      }
      writeProps(piece, props);
      body.wakeUp();
      body.velocity.y = flipHop;
      count++;
    }
    if (count) room.broadcast('sfx', { type: 'card-flip' });
  });

  pieceMessage('takeGroup', (client, message) => {
    const ids = idsFrom(message);
    if (!ids) return;
    for (const id of ids) {
      const piece = room.state.pieces.get(id);
      if (!piece || piece.type !== 'card') continue;
      const props = readProps(piece);
      const front = room.cardData.get(id)?.front || props.front;
      room.addToHand(client, front, props.back || 'back', geoOf(props));
      room.removePiece(id);
    }
  });

  pieceMessage('rotateGroup', (client, message) => {
    const parsed = groupRotation(message, { max: maxPieces });
    if (!parsed) return;
    const rotation = parsed.angle ?? parsed.dir * (Math.PI / 4);
    const bodies = parsed.ids.flatMap((id) => {
      const piece = room.state.pieces.get(id);
      const body = room.bodies.get(id);
      return piece && body && KINDS[piece.type]?.mass > 0 ? [body] : [];
    });
    if (!bodies.length) return;
    const center = bodies.reduce(
      (sum, body) => ({
        x: sum.x + body.position.x,
        z: sum.z + body.position.z,
      }),
      { x: 0, z: 0 },
    );
    center.x /= bodies.length;
    center.z /= bodies.length;
    const sin = Math.sin(rotation);
    const cos = Math.cos(rotation);
    const delta = new CANNON.Quaternion();
    delta.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), rotation);
    for (const body of bodies) {
      const dx = body.position.x - center.x;
      const dz = body.position.z - center.z;
      body.position.x = center.x + dx * cos + dz * sin;
      body.position.z = center.z - dx * sin + dz * cos;
      const quaternion = new CANNON.Quaternion();
      delta.mult(body.quaternion, quaternion);
      body.quaternion.copy(quaternion);
      body.velocity.setZero();
      body.angularVelocity.setZero();
      body.wakeUp();
    }
  });

  pieceMessage('recolor', (client, message) => {
    const { id, ...colors } = recolorPayload(message) || {};
    if (id) room.recolorPiece(id, colors);
  });
  pieceMessage('recolorGroup', (client, message) => {
    const parsed = groupRecolor(message, { max: maxPieces });
    if (!parsed) return;
    const { ids, color, textColor, team } = parsed;
    for (const id of ids) room.recolorPiece(id, { color, textColor, team });
  });

  pieceMessage('spawn', (client, message) => {
    if (room.state.pieces.size >= maxPieces) {
      room.notifyFull(client);
      return;
    }
    const msg = spawnPayload(message, { boardKeys, propKeys, dispenserKeys, colliders });
    if (!msg) return;
    if (msg.type === 'board') {
      if (room.rank(client) >= RANK.gm) room.swapBoard(msg.props || {});
      return;
    }
    if (msg.props?.tray) {
      const seat = room.seatOf(client);
      if (msg.type !== 'die' || seat == null || !room.state.trays.get(String(seat))) return;
      room.spawn('die', room.trayDropPos(seat), { ...dieSpawnProps(msg.props), traySeat: seat });
      room.broadcast('sfx', { type: 'die-roll' });
      return;
    }
    if (room.rank(client) < RANK.helper) return;
    const props = msg.type === 'die' ? dieSpawnProps(msg.props) : msg.props || {};
    room.spawn(msg.type, randomPosition(), props);
  });

  pieceMessage('rollOne', (client, message) => {
    const msg = pieceIdPayload(message);
    if (!msg) return;
    const piece = room.state.pieces.get(msg.id);
    const body = room.bodies.get(msg.id);
    if (!piece || piece.type !== 'die' || !body) return;
    rollBody(body, body.__traySeat != null ? trayRoll : roll, random);
    room.broadcast('sfx', { type: 'die-roll' });
  });

  pieceMessage('setStand', (client, message) => {
    const msg = pieceIdPayload(message);
    if (!msg) return;
    const piece = room.state.pieces.get(msg.id);
    if (!piece) return;
    const props = readProps(piece);
    props.stand = room.standOf(piece) ? false : room.naturalStand(piece);
    writeProps(piece, props);
    room.bodies.get(msg.id)?.wakeUp();
  });

  pieceMessage('setSnap', (client, message) => {
    const msg = pieceIdPayload(message);
    if (!msg) return;
    const piece = room.state.pieces.get(msg.id);
    if (!piece) return;
    const props = readProps(piece);
    props.snap = !props.snap;
    writeProps(piece, props);
    applySnap(room, msg.id, props.snap);
  });

  pieceMessage('snap', (client, message) => {
    const msg = pieceIdPayload(message);
    if (!msg) return;
    const piece = room.state.pieces.get(msg.id);
    if (!piece || piece.owner !== client.sessionId) return;
    const body = room.bodies.get(msg.id);
    if (!body) return;
    const forward = new CANNON.Vec3(0, 0, 1);
    const worldForward = new CANNON.Vec3();
    body.quaternion.vmult(forward, worldForward);
    const step = Math.PI / 4;
    const yaw = (Math.round(Math.atan2(worldForward.x, worldForward.z) / step) + 1) * step;
    body.quaternion.set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
    body.angularVelocity.setZero();
    body.wakeUp();
  });

  pieceMessage('remove', (client, message) => {
    if (room.rank(client) < RANK.helper) return;
    const msg = pieceIdPayload(message);
    if (msg && room.state.pieces.has(msg.id)) room.removePiece(msg.id);
  });
  pieceMessage('removeGroup', (client, message) => {
    if (room.rank(client) < RANK.helper) return;
    const ids = idsFrom(message);
    if (!ids) return;
    for (const id of ids) if (room.state.pieces.has(id)) room.removePiece(id);
  });
}

function applySnap(room, id, enabled) {
  const body = room.bodies.get(id);
  if (!body) return;
  if (enabled && gridActive(room.state.scale)) {
    const position = snapToCell(body.position.x, body.position.z, room.state.scale);
    body.position.x = position.x;
    body.position.z = position.z;
    body.velocity.setZero();
    body.angularVelocity.setZero();
    room.targets.delete(id);
  } else if (body.__pinned) {
    room.unpinPiece(id);
  }
  body.wakeUp();
}

function rollBody(body, config, random) {
  body.wakeUp();
  body.velocity.set((random() - 0.5) * config.spread, config.up, (random() - 0.5) * config.spread);
  body.angularVelocity.set(
    (random() - 0.5) * config.spin,
    (random() - 0.5) * config.spin,
    (random() - 0.5) * config.spin,
  );
}
