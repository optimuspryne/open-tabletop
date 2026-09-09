import { inspectedEntry, deckSpawnProps } from '../deck-state.js';
import { KINDS, MEASURE, TABLE, TABLE_SHAPES, RIM_WOODS } from '../../shared/pieces.js';
import { appendAccountHand } from './hand-state.js';
import { readProps } from './props-codec.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Reset game contents, including private state that may have no visible piece.
// Room configuration, timer, notes, chat, whiteboard and personal notebooks survive.
export function clearGameTable(room) {
  for (const id of [...room.state.pieces.keys()]) room.removePiece(id);
  for (const map of [
    room.hands,
    room.pendingHands,
    room.pendingInspect,
    room.drafts,
    room.deckCards,
    room.cardData,
    room.flips,
    room.targets,
    room.groups,
    room._released,
    room.lastDrop,
  ])
    map.clear();
  room.pendingTurn = null;
  room.state.turn = '';
  room.state.turnPending = '';
  room.state.unclaimed.clear();
  for (const sid of [...room.shows.keys()]) room.stopShow(sid);
  for (const client of room.clients) room.sendHand(client);
  room.state.overlays.clear();
  // A reset must invalidate an old checkpoint even before the room empties.
  room.savedScene = null;
  room.scheduleSave();
}

export function serializeScene(room) {
  const pieces = [];
  room.state.pieces.forEach((piece, id) => {
    let props = readProps(piece);
    if (piece.type === 'deck') {
      const cards = (room.deckCards.get(id) || []).slice();
      // Last popped is returned first; the first inspected card was the original top.
      for (const pending of [...room.pendingInspect.values()].reverse()) {
        if (pending.deckId === id) cards.push(inspectedEntry(pending));
      }
      props = deckSpawnProps(props, cards);
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

  // Orphaned inspections cannot be appended to a missing deck. Store them
  // separately so a full snapshot never truncates recovery cards at the piece cap.
  const recoveryCards = [...room.pendingInspect.values()]
    .filter((pending) => room.state.pieces.get(pending.deckId)?.type !== 'deck')
    .map(({ front, back, open, geo }) => ({ front, back, open, geo }));

  return {
    ...(recoveryCards.length ? { recoveryCards } : {}),
    table: {
      x: room.state.tableX,
      z: room.state.tableZ,
      shape: room.state.tableShape,
      rimWood: room.state.rimWood,
    },
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
    const userId = room.handOwners?.get(sessionId) ?? client?.auth?.userId;
    if (userId == null) continue;
    const player = room.state.players.get(sessionId);
    appendAccountHand(byUser, userId, player?.name, cards);
  }
  for (const [userId, held] of room.pendingHands) {
    appendAccountHand(byUser, userId, held.name, held.cards);
  }

  const hands = [];
  for (const [userId, held] of byUser) {
    hands.push({ userId, name: held.name, cards: held.cards });
  }

  let turn =
    room.pendingTurn != null
      ? { userId: String(room.pendingTurn), name: room.state.turnPending || '' }
      : null;
  if (!turn && room.state.turn) {
    const client = room.clientBy(room.state.turn);
    if (client && client.auth && client.auth.userId != null) {
      const player = room.state.players.get(room.state.turn);
      turn = {
        userId: String(client.auth.userId),
        name: (player && player.name) || '',
      };
    } else {
      // Disconnected player: fall back to retained account identity
      const userId = room.handOwners?.get(room.state.turn);
      if (userId != null) {
        const player = room.state.players.get(room.state.turn);
        turn = {
          userId: String(userId),
          name: (player && player.name) || '',
        };
      }
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
  const shape =
    scene.table && TABLE_SHAPES.includes(scene.table.shape) ? scene.table.shape : 'rect';
  const rimWood =
    scene.table && RIM_WOODS.includes(scene.table.rimWood) ? scene.table.rimWood : 'mahogany';
  room.state.tableX = tableX;
  room.state.tableZ = tableZ;
  room.state.tableShape = shape;
  room.state.rimWood = rimWood;
  room.buildBounds(tableX, tableZ, shape);
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

  for (const card of Array.isArray(scene.recoveryCards) ? scene.recoveryCards : []) {
    if (!card || typeof card.front !== 'string' || typeof card.back !== 'string') continue;
    room.pendingInspect.set(Symbol('recovered-inspection'), {
      ...card,
      deckId: null,
      recover: true,
    });
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

  if (Array.isArray(scene.hands)) {
    for (const hand of scene.hands) {
      if (!hand || hand.userId == null || !Array.isArray(hand.cards) || !hand.cards.length)
        continue;
      // Saved IDs belong to the previous room lifetime. Assign fresh IDs before
      // these cards can be mixed with newly drawn cards or other restored hands.
      const cards = hand.cards.map((card) =>
        typeof card === 'object' && card !== null ? { ...card, hid: 'h' + room.nextHid++ } : card,
      );
      appendAccountHand(room.pendingHands, hand.userId, hand.name, cards);
      room.state.unclaimed.set(String(hand.userId), hand.name || '');
    }
  }
  if (scene.turn && scene.turn.userId != null) {
    room.pendingTurn = String(scene.turn.userId);
    room.state.turnPending = scene.turn.name || '';
    room.state.turn = '';
  }
  room.savedScene = scene;
  room.scheduleSave();
}
