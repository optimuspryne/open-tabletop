import {
  cardPlacementPayload,
  dispenserDragPayload,
  pieceIdPayload,
} from '../../message-validation.js';
import { safeMessage } from '../safe-message.js';
import { MAX_PIECES, ensurePieceCapacity, hasPieceCapacity } from '../piece-capacity.js';

// Capacity must be checked before consuming inventory, with no intervening await.
export function registerPlacementHandlers(
  room,
  { randomPosition, dropSfx, maxPieces = MAX_PIECES, logger = console },
) {
  const tableMessage = (type, handler) => safeMessage(room, type, handler, { logger });
  tableMessage('dispense', (client, message) => {
    const parsed = pieceIdPayload(message);
    if (!parsed) return;
    const { id } = parsed;
    const disp = room.state.pieces.get(id);
    if (!disp || disp.type !== 'dispenser') return;
    const item = room.dispenserItem(disp);
    if (!item) return;
    if (!ensurePieceCapacity(room, client, maxPieces)) return;
    const body = room.bodies.get(id);
    room.spawn(item.type, body ? room.besideDeck(body) : randomPosition(), item.props);
    room.afterDispense(disp, id);
    room.broadcast('sfx', { type: 'object-drop' });
  });
  tableMessage('dispenseDrag', (client, message) => {
    const msg = dispenserDragPayload(message);
    if (!msg) return;
    const disp = room.state.pieces.get(msg.id);
    if (!disp || disp.type !== 'dispenser') return;
    const item = room.dispenserItem(disp);
    if (!item) return;
    if (!ensurePieceCapacity(room, client, maxPieces)) return;
    const body = room.bodies.get(msg.id);
    const newId = room.spawn(
      item.type,
      body ? [body.position.x, 2.5, body.position.z] : randomPosition(),
      item.props,
    );
    room.afterDispense(disp, msg.id);
    // Hand the new item straight to the dragger's cursor (reuses the deal-adopt path).
    room.state.pieces.get(newId).owner = client.sessionId;
    room.targets.set(newId, { x: msg.x, y: msg.y, z: msg.z });
    client.send('dealt', { id: newId });
  });

  tableMessage('playCard', (client, message) => {
    const parsed = cardPlacementPayload(message);
    if (!parsed) return;
    const { hid, faceDown, x, z } = parsed;
    const hand = room.hands.get(client.sessionId);
    if (!hand) return;
    const index = hand.findIndex((card) => card.hid === hid);
    if (index < 0) return;
    if (!ensurePieceCapacity(room, client, maxPieces)) return;
    const card = hand[index];

    const pos =
      typeof x === 'number' && typeof z === 'number'
        ? [x, 3, z] // where the client dropped it
        : [(Math.random() - 0.5) * 4, 3, (Math.random() - 0.5) * 3]; // or scattered
    room.spawnHandCard(pos, card, faceDown);
    hand.splice(index, 1);
    room.sendHand(client);
    room.broadcast('sfx', { type: dropSfx('card', card) }); // played tile clacks
  });

  tableMessage('handToTable', (client, message) => {
    const parsed = cardPlacementPayload(message, { wholeHand: true });
    if (!parsed) return;
    const { faceDown, x, z } = parsed;
    const hand = room.hands.get(client.sessionId);
    if (!hand || !hand.length) return;
    const cx = typeof x === 'number' ? x : 0,
      cz = typeof z === 'number' ? z : 0;
    let spawned = 0;
    const ids = []; // remember what we created, so the drop can be undone
    for (const card of hand) {
      if (!hasPieceCapacity(room, maxPieces)) break;
      const pos = [cx + (Math.random() - 0.5) * 3, 0.1, cz + (Math.random() - 0.5) * 1.6];
      const id = room.spawnHandCard(pos, card, faceDown);
      ids.push(id);
      spawned++;
    }
    const capped = spawned < hand.length; // couldn't place the whole hand — table filled up
    hand.splice(0, spawned);
    room.sendHand(client);
    if (spawned) {
      room.lastDrop.set(client.sessionId, { ids, ts: Date.now() });
      room.broadcast('sfx', { type: 'hand-drop' });
    }
    if (capped) room.notifyFull(client);
  });
}
