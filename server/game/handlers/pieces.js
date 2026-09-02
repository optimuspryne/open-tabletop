import * as CANNON from 'cannon-es';
import {
  DISPENSERS,
  KINDS,
  dieSpawnProps,
  dispensedSpec,
  dispenserForItem,
  gridActive,
  itemMatchesDispenser,
  snapToCell,
} from '../../../shared/pieces.js';
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
    spawnY,
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
      if (props.open) {
        if (props.down) delete props.down;
        else props.down = true; // double-sided tile: turn it over, both faces public
      } else if (props.front) {
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

  // Toggle double-sided (open / turn-over) flip on the selected cards & decks. On a card, turning
  // it on reveals any hidden front so BOTH faces are public — flip then turns the tile over instead
  // of concealing it. On a deck, it marks the tiles the deck deals as double-sided. Toggled as a
  // unit, like stand/snap.
  pieceMessage('setOpenGroup', (client, message) => {
    const ids = idsFrom(message);
    if (!ids) return;
    const anyOpen = ids.some((id) => {
      const piece = room.state.pieces.get(id);
      return piece && readProps(piece).open;
    });
    for (const id of ids) {
      const piece = room.state.pieces.get(id);
      if (!piece || (piece.type !== 'card' && piece.type !== 'deck')) continue;
      const props = readProps(piece);
      if (anyOpen) {
        delete props.open;
        if (piece.type === 'card' && props.down && props.front) {
          room.cardData.set(id, { front: props.front }); // was showing its back → face-down secret again
          delete props.front;
        }
        delete props.down;
      } else {
        props.open = true;
        if (piece.type === 'card' && !props.front && room.cardData.has(id)) {
          props.front = room.cardData.get(id).front; // reveal the hidden face so both are public
          room.cardData.delete(id);
          props.down = true; // it was face-down — keep showing the back, now both public
        }
      }
      writeProps(piece, props);
      room.bodies.get(id)?.wakeUp();
    }
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

  // Gather a multi-selection of like dispensers into one at their centre, summing their stacks.
  // Same kind + same tint/team only; a mixed selection is refused. Infinite bowls are skipped —
  // they are already unlimited, so there is nothing to pour together. Token total is conserved
  // even past the per-stack spawn cap (the collider height is clamped separately). Open, like the
  // deck ops.
  pieceMessage('gatherDispensers', (client, message) => {
    const ids = idsFrom(message);
    if (!ids) return;
    const members = [];
    for (const id of ids) {
      const piece = room.state.pieces.get(id);
      const body = room.bodies.get(id);
      if (!piece || !body || piece.type !== 'dispenser') continue;
      const props = readProps(piece);
      const def = DISPENSERS[props.disp];
      if (!def || def.infinite) continue; // an unlimited bowl has nothing to pour
      members.push({ id, piece, body, props });
    }
    if (members.length < 2) return;
    const sig = (m) => JSON.stringify([m.props.disp, m.props.color ?? null, m.props.team ?? null]);
    const target = sig(members[0]);
    if (members.some((m) => sig(m) !== target)) return; // mixed kind/tint → refuse
    let total = 0;
    let cx = 0;
    let cz = 0;
    for (const m of members) {
      total += m.piece.count | 0;
      cx += m.body.position.x;
      cz += m.body.position.z;
    }
    if (total <= 0) return;
    cx /= members.length;
    cz /= members.length;
    const { disp, color, team } = members[0].props;
    for (const m of members) room.removePiece(m.id); // remove first → the merged stack always fits
    const spawnProps = { disp, count: total };
    if (color != null) spawnProps.color = color;
    if (team != null) spawnProps.team = team;
    const id = room.spawn('dispenser', [cx, spawnY, cz], spawnProps);
    const merged = room.state.pieces.get(id);
    if (merged && merged.count !== total) {
      merged.count = total; // preserve the true total past the per-stack spawn clamp
      room.updateStackCollider(id);
    }
    room.broadcast('sfx', { type: 'object-drop' });
  });

  // Pour a multi-selection of loose pieces back into the one dispenser also selected. Each piece
  // matching what the stack hands out (shape + tint/team) is removed and, for a finite stack, adds
  // one to its count; an infinite bowl just swallows them. Same match rule as the drop-back absorb
  // in releasePiece, with the selection standing in for the proximity check.
  pieceMessage('absorbIntoDispenser', (client, message) => {
    const ids = idsFrom(message);
    if (!ids) return;
    let dispId = null;
    let disp = null;
    let extraDispenser = false;
    const items = [];
    for (const id of ids) {
      const piece = room.state.pieces.get(id);
      if (!piece || !room.bodies.get(id)) continue;
      if (piece.type === 'dispenser') {
        if (disp) extraDispenser = true;
        dispId = id;
        disp = piece;
      } else if (piece.type === 'prop') {
        items.push({ id, props: readProps(piece) });
      }
    }
    if (!disp || extraDispenser) return; // exactly one dispenser to pour into
    const want = dispensedSpec(readProps(disp));
    const def = DISPENSERS[readProps(disp).disp];
    let absorbed = 0;
    for (const it of items) {
      if (!itemMatchesDispenser(want, it.props)) continue;
      room.removePiece(it.id);
      if (def && !def.infinite) disp.count = (disp.count | 0) + 1;
      absorbed++;
    }
    if (!absorbed) return;
    if (def && !def.infinite) room.updateStackCollider(dispId);
    room.broadcast('sfx', { type: 'object-drop' });
  });

  // Mint a fresh dispenser from a multi-selection of loose pieces that have one (poker chips -> a
  // chip stack, go stones -> a bowl). Homogeneous shape + tint/team only, and only when no
  // dispenser is selected (that is absorbIntoDispenser's job). A finite stack starts with one item
  // per piece; an infinite bowl ignores the count.
  pieceMessage('dispenseFromPieces', (client, message) => {
    const ids = idsFrom(message);
    if (!ids) return;
    const items = [];
    for (const id of ids) {
      const piece = room.state.pieces.get(id);
      const body = room.bodies.get(id);
      if (!piece || !body) continue;
      if (piece.type === 'dispenser') return; // a dispenser present -> absorb, not mint
      if (piece.type !== 'prop') continue;
      const props = readProps(piece);
      if (!dispenserForItem(props.shape)) continue; // only pieces that have a dispenser
      items.push({ id, props, body });
    }
    if (items.length < 2) return;
    const sig = (p) => JSON.stringify([p.shape, p.color ?? null, p.team ?? null]);
    const target = sig(items[0].props);
    if (items.some((it) => sig(it.props) !== target)) return; // mixed -> refuse
    const kind = dispenserForItem(items[0].props.shape);
    const def = DISPENSERS[kind];
    let cx = 0;
    let cz = 0;
    for (const it of items) {
      cx += it.body.position.x;
      cz += it.body.position.z;
    }
    cx /= items.length;
    cz /= items.length;
    const spawnProps = { disp: kind };
    if (def.team) spawnProps.team = items[0].props.team ? 1 : 0;
    else if (items[0].props.color != null) spawnProps.color = items[0].props.color | 0;
    if (!def.infinite) spawnProps.count = items.length;
    for (const it of items) room.removePiece(it.id);
    room.spawn('dispenser', [cx, spawnY, cz], spawnProps);
    room.broadcast('sfx', { type: 'object-drop' });
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
