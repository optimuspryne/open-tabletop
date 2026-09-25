import { canUseRoomCapability } from '../permissions.js';
import { hasPieceCapacity } from './piece-capacity.js';
import { randomUUID } from 'node:crypto';
import * as CANNON from 'cannon-es';
import { NOTECARD, normalizeNotecardDrawing } from '../../shared/notecards.js';
import { pieceIdPayload, isPlainObject } from '../message-validation.js';
import { readProps, writeProps } from './props-codec.js';
import { guardedMessage } from './interaction-policy.js';

// Artwork is authoritative here, never in public props while concealed or being edited.
export function createNotecards(room, { now = Date.now, token = randomUUID } = {}) {
  const documents = new Map();
  const leases = new Map();
  const transferring = new Set();
  const handCard = (sid, hid) =>
    room.hands?.get(sid)?.find((card) => card.hid === hid && card.kind === 'notecard');
  function count() {
    let total = documents.size;
    for (const cards of room.hands?.values() || [])
      total += cards.filter((card) => card.kind === 'notecard' && !transferring.has(card)).length;
    for (const held of room.pendingHands?.values() || [])
      total += held.cards.filter((card) => card.kind === 'notecard').length;
    return total;
  }
  function give(client, drawing, props = {}) {
    const hand = room.hands.get(client.sessionId) || [];
    hand.push({
      hid: 'h' + room.nextHid++,
      kind: 'notecard',
      back: 'back',
      drawing,
      noteProps: Object.fromEntries(
        ['snap', 'stand', 'label']
          .filter((key) => props[key] !== undefined)
          .map((key) => [key, props[key]]),
      ),
    });
    room.hands.set(client.sessionId, hand);
    room.sendHand(client);
  }
  function placeHandCard(position, card, faceDown) {
    transferring.add(card);
    try {
      return room.spawn('notecard', position, {
        ...card.noteProps,
        drawing: card.drawing,
        faceDown,
      });
    } finally {
      transferring.delete(card);
    }
  }
  function take(client, id) {
    const doc = documents.get(id),
      piece = room.state.pieces.get(id);
    if (
      !doc ||
      !piece ||
      leases.has(id) ||
      (piece.owner && piece.owner !== client.sessionId) ||
      room.flips.has(id)
    )
      return false;
    give(client, doc.drawing, readProps(piece));
    room.removePiece(id);
    return true;
  }
  function publish(id) {
    const piece = room.state.pieces.get(id),
      doc = documents.get(id);
    if (!piece || !doc) return;
    const props = readProps(piece);
    delete props.drawing;
    delete props.editing;
    delete props.editingName;
    props.faceDown = doc.faceDown || leases.has(id);
    if (!props.faceDown) props.drawing = doc.drawing;
    if (leases.has(id)) {
      props.editing = leases.get(id).sid;
      props.editingName = String(room.state.players.get(props.editing)?.name || 'Someone').slice(
        0,
        60,
      );
    }
    writeProps(piece, props);
  }
  function restore(id, props) {
    if (documents.size >= NOTECARD.maxCards) throw new Error('The notecard limit was reached.');
    const drawing = normalizeNotecardDrawing(props.drawing ?? []);
    if (!drawing) throw new Error('Invalid notecard drawing.');
    documents.set(id, { drawing, faceDown: props.faceDown === true });
    publish(id);
  }
  function close(id, reason = '') {
    const lease = leases.get(id);
    if (!lease) return;
    leases.delete(id);
    const body = room.bodies.get(id);
    if (body) {
      body.type = CANNON.Body.DYNAMIC;
      body.updateMassProperties();
      body.wakeUp();
    }
    publish(id);
    room.clients
      .find((client) => client.sessionId === lease.sid)
      ?.send('notecardClosed', {
        id,
        token: lease.token,
        reason,
      });
  }
  function cancelClient(sid, reason = 'Drawing ended because your table access changed.') {
    for (const [id, lease] of leases) if (lease.sid === sid) close(id, reason);
  }
  function blocked(client, message, type) {
    const handBusy = [...leases.values()].some(
      (lease) =>
        lease.sid === client.sessionId &&
        lease.hid &&
        (['handToTable', 'showStart'].includes(type) || message?.hid === lease.hid),
    );
    if (!isPlainObject(message) && !handBusy) return false;
    message ||= {};
    const ids = [message.id, message.anchor, ...(Array.isArray(message.ids) ? message.ids : [])];
    if (!handBusy && !ids.some((id) => typeof id === 'string' && leases.has(id))) return false;
    client?.send('serverError', {
      operation: 'notecardBusy',
      message: 'Someone is drawing on that notecard.',
    });
    return true;
  }
  function claim(client, message) {
    if (isPlainObject(message) && typeof message.hid === 'string') {
      const card = handCard(client.sessionId, message.hid);
      if (!card) return;
      cancelClient(client.sessionId, 'Another notecard was opened.');
      room.stopShow(client.sessionId);
      const id = 'hand:' + card.hid;
      const lease = {
        sid: client.sessionId,
        hid: card.hid,
        token: token(),
        expires: now() + NOTECARD.leaseMs,
      };
      leases.set(id, lease);
      client.send('notecardEdit', { id, hid: card.hid, token: lease.token, drawing: card.drawing });
      return;
    }
    const parsed = pieceIdPayload(message);
    if (!parsed || !documents.has(parsed.id)) return;
    const { id } = parsed,
      piece = room.state.pieces.get(id),
      body = room.bodies.get(id);
    if (!piece || !body) return;
    if (leases.has(id) || piece.owner || room.flips.has(id)) {
      client.send('serverError', {
        operation: 'notecardEdit',
        message: 'That notecard is in use. Try again when it is released.',
      });
      return;
    }
    cancelClient(client.sessionId, 'Another notecard was opened.');
    room.unpinPiece(id);
    const lease = { sid: client.sessionId, token: token(), expires: now() + NOTECARD.leaseMs };
    leases.set(id, lease);
    room.targets.delete(id);
    body.velocity.setZero();
    body.angularVelocity.setZero();
    body.type = CANNON.Body.STATIC;
    body.updateMassProperties();
    body.sleep();
    publish(id);
    client.send('notecardEdit', { id, token: lease.token, drawing: documents.get(id).drawing });
  }
  function owned(client, message) {
    if (
      !isPlainObject(message) ||
      typeof message.id !== 'string' ||
      typeof message.token !== 'string'
    )
      return null;
    const lease = leases.get(message.id);
    if (lease && now() >= lease.expires) {
      close(message.id, 'The drawing session expired. Your previous artwork was kept.');
      return null;
    }
    return lease && lease.sid === client.sessionId && lease.token === message.token ? lease : null;
  }
  function commit(client, message) {
    const lease = owned(client, message);
    if (!lease) return;
    const drawing = normalizeNotecardDrawing(message.drawing);
    const destination = message.destination ?? 'table';
    const fail = (text) =>
      client.send('serverError', { operation: 'notecardCommit', message: text });
    if (
      !drawing ||
      !['table', 'hand', 'pass'].includes(destination) ||
      (destination === 'table' && typeof message.faceDown !== 'boolean')
    ) {
      fail('The drawing could not be saved. Undo some strokes and try again.');
      return;
    }
    const card = lease.hid ? handCard(lease.sid, lease.hid) : null;
    if (lease.hid && !card) {
      close(message.id, 'The notecard is no longer in your hand.');
      return;
    }
    const recipient =
      destination === 'pass'
        ? room.clients.find(
            (other) =>
              other.sessionId === message.recipient &&
              other !== client &&
              room.state.players.has(other.sessionId) &&
              canUseRoomCapability(other.auth, 'gameplay'),
          )
        : client;
    if (!recipient) {
      fail('Choose an active player. Your drawing is still here.');
      return;
    }
    if (destination === 'table' && card) {
      if (!hasPieceCapacity(room)) {
        fail('The table is full. Keep the notecard in hand or try again later.');
        return;
      }
      // Keep inventory and committed artwork intact if creation fails.
      const previous = card.drawing;
      card.drawing = drawing;
      try {
        placeHandCard([0, 3, 0], card, message.faceDown);
      } catch (error) {
        card.drawing = previous;
        throw error;
      }
      room.hands.get(lease.sid).splice(room.hands.get(lease.sid).indexOf(card), 1);
      room.sendHand(client);
    } else if (destination === 'table') {
      documents.set(message.id, { drawing, faceDown: message.faceDown });
    } else if (destination === 'hand' && card) {
      card.drawing = drawing;
      room.sendHand(client);
    } else {
      const props = card?.noteProps || readProps(room.state.pieces.get(message.id));
      give(recipient, drawing, props);
      if (card) {
        room.hands.get(lease.sid).splice(room.hands.get(lease.sid).indexOf(card), 1);
        room.sendHand(client);
      } else {
        close(message.id);
        room.removePiece(message.id);
        return;
      }
    }
    close(message.id);
  }
  function flip(id) {
    const doc = documents.get(id);
    if (!doc || leases.has(id)) return false;
    doc.faceDown = !doc.faceDown;
    publish(id);
    return true;
  }
  return {
    restore,
    take,
    placeHandCard,
    claim,
    commit,
    flip,
    blocked,
    cancelClient,
    hasCapacity: () => count() < NOTECARD.maxCards,
    isEditing: (id) => leases.has(id),
    snapshot: (id) => documents.get(id),
    cancel: (client, message) => {
      if (owned(client, message)) close(message.id);
    },
    keepAlive: (client, message) => {
      const lease = owned(client, message);
      if (lease) lease.expires = now() + NOTECARD.leaseMs;
    },
    remove: (id) => {
      close(id, 'The notecard was removed.');
      documents.delete(id);
    },
    clear: () => {
      for (const id of [...leases.keys()]) close(id, 'The table was reset.');
      documents.clear();
    },
    sweep: () => {
      for (const [id, lease] of leases)
        if (now() >= lease.expires)
          close(id, 'The drawing session expired. Your previous artwork was kept.');
    },
  };
}

export function registerNotecardHandlers(room) {
  for (const [type, method] of Object.entries({
    notecardEdit: 'claim',
    notecardCommit: 'commit',
    notecardCancel: 'cancel',
    notecardKeepAlive: 'keepAlive',
  }))
    guardedMessage(room, type, (client, message) => room.notecards[method](client, message));
  guardedMessage(room, 'notecardFlip', (client, message) => {
    const parsed = pieceIdPayload(message);
    if (parsed) room.notecards.flip(parsed.id);
  });
}
