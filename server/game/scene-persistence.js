import { KINDS, MEASURE, TABLE } from '../../shared/pieces.js';
import { readProps } from './props-codec.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function serializeScene(room, { geoOf }) {
  const pieces = [];
  room.state.pieces.forEach((piece, id) => {
    let props = readProps(piece);
    if (piece.type === 'deck') {
      const cards = (room.deckCards.get(id) || []).slice();
      for (const pending of room.pendingInspect.values()) {
        if (pending.deckId === id)
          cards.unshift(
            pending.cardBack != null
              ? { front: pending.front, back: pending.cardBack }
              : pending.front,
          );
      }
      props = {
        back: props.back || 'back',
        cards,
        ...geoOf(props),
        ...(props.model ? { deckModel: props.model } : {}),
        ...(props.open ? { open: true } : {}),
      };
    } else if (piece.type === 'card') {
      const card = room.cardData.get(id);
      if (card && card.front) props = { ...props, front: card.front, faceDown: true };
    }
    pieces.push({
      type: piece.type,
      props,
      x: piece.x,
      y: piece.y,
      z: piece.z,
      q: [piece.qx, piece.qy, piece.qz, piece.qw],
    });
  });

  const overlays = [];
  room.state.overlays.forEach((overlay) =>
    overlays.push({
      kind: overlay.kind,
      color: overlay.color,
      x: overlay.x,
      z: overlay.z,
      x2: overlay.x2,
      z2: overlay.z2,
      w: overlay.w,
      ang: overlay.ang,
    }),
  );

  const trays = [];
  room.state.trays.forEach((enabled, seat) => {
    if (enabled) trays.push(+seat);
  });

  return {
    table: { x: room.state.tableX, z: room.state.tableZ },
    pieces,
    overlays,
    scale: room.scaleSnapshot(),
    trays,
  };
}

export function serializeGame(room, options) {
  const scene = serializeScene(room, options);
  const byUser = new Map();
  for (const [sessionId, cards] of room.hands) {
    if (!cards || !cards.length) continue;
    const client = room.clientBy(sessionId);
    const userId = client && client.auth && client.auth.userId;
    if (userId == null) continue;
    const player = room.state.players.get(sessionId);
    byUser.set(String(userId), {
      name: (player && player.name) || '',
      cards: cards.slice(),
    });
  }
  for (const [userId, held] of room.pendingHands) {
    byUser.set(String(userId), {
      name: held.name || '',
      cards: held.cards.slice(),
    });
  }

  const hands = [];
  for (const [userId, held] of byUser) {
    hands.push({ userId, name: held.name, cards: held.cards });
  }

  let turn = null;
  if (room.state.turn) {
    const client = room.clientBy(room.state.turn);
    if (client && client.auth && client.auth.userId != null) {
      const player = room.state.players.get(room.state.turn);
      turn = {
        userId: String(client.auth.userId),
        name: (player && player.name) || '',
      };
    }
  }
  return { ...scene, hands, turn };
}

export function applyScene(
  room,
  scene,
  { createOverlay, maxPieces, overlayKinds, overlayMax, tableLimits },
) {
  if (!scene || typeof scene !== 'object') return;
  room.clearTable();
  const tableX = clamp(
    +(scene.table && scene.table.x) || TABLE.x,
    tableLimits.minX,
    tableLimits.maxX,
  );
  const tableZ = clamp(
    +(scene.table && scene.table.z) || TABLE.z,
    tableLimits.minZ,
    tableLimits.maxZ,
  );
  room.state.tableX = tableX;
  room.state.tableZ = tableZ;
  room.buildBounds(tableX, tableZ);
  room.applyScale(scene.scale);
  room.applyTrays(scene.trays);

  for (const entry of Array.isArray(scene.pieces) ? scene.pieces : []) {
    if (room.state.pieces.size >= maxPieces) break;
    if (!entry || !KINDS[entry.type]) continue;
    const props = entry.props || {};
    if (entry.type === 'board') {
      room.swapBoard(props);
      continue;
    }
    const faceDownFront =
      entry.type === 'card' && props.faceDown && props.front ? props.front : null;
    let publicProps = props;
    if (faceDownFront) {
      publicProps = { ...props };
      delete publicProps.front;
      delete publicProps.faceDown;
    }
    const id = room.spawn(
      entry.type,
      [+entry.x || 0, Number.isFinite(+entry.y) ? +entry.y : 2, +entry.z || 0],
      publicProps,
      Array.isArray(entry.q) ? entry.q : null,
    );
    if (faceDownFront) room.cardData.set(id, { front: faceDownFront });
  }

  const coordinate = (value) => clamp(+value || 0, -MEASURE.maxLen, MEASURE.maxLen);
  for (const entry of Array.isArray(scene.overlays) ? scene.overlays : []) {
    if (room.state.overlays.size >= overlayMax) break;
    if (!entry || !overlayKinds.has(entry.kind)) continue;
    const overlay = createOverlay();
    overlay.kind = entry.kind;
    overlay.owner = '';
    overlay.color = entry.color || '#ffffff';
    overlay.x = coordinate(entry.x);
    overlay.z = coordinate(entry.z);
    overlay.x2 = coordinate(entry.x2);
    overlay.z2 = coordinate(entry.z2);
    overlay.w = clamp(+entry.w || 0, 0, MEASURE.maxLen);
    overlay.ang = +entry.ang || 0;
    room.state.overlays.set(`o${room.nextOverlayId++}`, overlay);
  }

  room.pendingHands.clear();
  room.pendingTurn = null;
  room.state.unclaimed.clear();
  room.state.turnPending = '';
  if (Array.isArray(scene.hands)) {
    for (const hand of scene.hands) {
      if (!hand || hand.userId == null || !Array.isArray(hand.cards) || !hand.cards.length)
        continue;
      room.pendingHands.set(String(hand.userId), {
        name: hand.name || '',
        cards: hand.cards.slice(),
      });
      room.state.unclaimed.set(String(hand.userId), hand.name || '');
    }
  }
  if (scene.turn && scene.turn.userId != null) {
    room.pendingTurn = String(scene.turn.userId);
    room.state.turnPending = scene.turn.name || '';
    room.state.turn = '';
  }
  room.scheduleSave();
}
