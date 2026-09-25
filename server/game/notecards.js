import { updateNotecardStackCollider } from './collider-maintenance.js';
import { canUseRoomCapability } from '../permissions.js';
import { hasPieceCapacity } from './piece-capacity.js';
import { randomUUID } from 'node:crypto';
import * as CANNON from 'cannon-es';
import {
  NOTECARD,
  normalizeNotecardDrawing,
  normalizeNotecardPaper,
  normalizeNotecardStack,
} from '../../shared/notecards.js';
import { pieceIdPayload, isPlainObject } from '../message-validation.js';
import { readProps, writeProps } from './props-codec.js';
import { guardedMessage } from './interaction-policy.js';

// Artwork is authoritative here, never in public props while concealed or being edited.
export function createNotecards(room, { now = Date.now, token = randomUUID } = {}) {
  const documents = new Map();
  const stacks = new Map();
  const leases = new Map();
  const transferring = new Set();
  const handCard = (sid, hid) =>
    room.hands?.get(sid)?.find((card) => card.hid === hid && card.kind === 'notecard');
  function count() {
    let total = documents.size;
    for (const cards of stacks.values())
      total += cards.filter((card) => !transferring.has(card)).length;
    for (const cards of room.hands?.values() || [])
      total += cards.filter((card) => card.kind === 'notecard' && !transferring.has(card)).length;
    for (const held of room.pendingHands?.values() || [])
      total += held.cards.filter((card) => card.kind === 'notecard').length;
    return total;
  }
  function give(client, drawing, paper, props = {}) {
    const hand = room.hands.get(client.sessionId) || [];
    hand.push({
      hid: 'h' + room.nextHid++,
      kind: 'notecard',
      back: 'back',
      drawing,
      paper,
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
        paper: card.paper,
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
    give(client, doc.drawing, doc.paper, readProps(piece));
    room.removePiece(id);
    return true;
  }
  function publish(id) {
    const piece = room.state.pieces.get(id),
      doc = documents.get(id);
    if (!piece || (!doc && !stacks.has(id))) return;
    const props = readProps(piece);
    delete props.drawing;
    delete props.paper;
    delete props.editing;
    delete props.editingName;
    delete props.cards;
    props.faceDown = stacks.has(id) || doc.faceDown || leases.has(id);
    if (!props.faceDown) {
      props.drawing = doc.drawing;
      props.paper = doc.paper;
    }
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
    const paper = normalizeNotecardPaper(props.paper);
    if (!drawing || !paper) throw new Error('Invalid notecard drawing or paper.');
    documents.set(id, { drawing, paper, faceDown: props.faceDown === true });
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
      client.send('notecardEdit', {
        id,
        hid: card.hid,
        token: lease.token,
        drawing: card.drawing,
        paper: card.paper,
      });
      return;
    }
    const parsed = pieceIdPayload(message);
    if (!parsed || (!documents.has(parsed.id) && !stacks.has(parsed.id))) return;
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
    client.send('notecardEdit', {
      id,
      token: lease.token,
      drawing: (stacks.get(id)?.at(-1) || documents.get(id)).drawing,
      paper: (stacks.get(id)?.at(-1) || documents.get(id)).paper,
      fromStack: stacks.has(id),
    });
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
    const source = lease.hid
      ? handCard(lease.sid, lease.hid)
      : stacks.get(message.id)?.at(-1) || documents.get(message.id);
    const paper = normalizeNotecardPaper(
      message.paper === undefined ? source?.paper : message.paper,
    );
    const destination = message.destination ?? 'table';
    const fail = (text) =>
      client.send('serverError', { operation: 'notecardCommit', message: text });
    if (
      !drawing ||
      !paper ||
      !['table', 'hand', 'pass', ...(stacks.has(message.id) ? ['stack'] : [])].includes(
        destination,
      ) ||
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
    if (stacks.has(message.id)) {
      const cards = stacks.get(message.id),
        top = cards.at(-1);
      if (destination === 'stack') {
        top.drawing = drawing;
        top.paper = paper;
      } else {
        if (destination === 'table') {
          if (!hasPieceCapacity(room)) {
            fail('The table is full. Return to top or keep the notecard in hand.');
            return;
          }
          placeStackCard(message.id, top, drawing, paper, message.faceDown);
        } else give(recipient, drawing, paper, top.noteProps);
        cards.pop();
      }
      close(message.id);
      syncStack(message.id);
      return;
    }
    if (destination === 'table' && card) {
      if (!hasPieceCapacity(room)) {
        fail('The table is full. Keep the notecard in hand or try again later.');
        return;
      }
      // Keep inventory and committed artwork intact if creation fails.
      const previous = { drawing: card.drawing, paper: card.paper };
      card.drawing = drawing;
      card.paper = paper;
      try {
        placeHandCard([0, 3, 0], card, message.faceDown);
      } catch (error) {
        Object.assign(card, previous);
        throw error;
      }
      room.hands.get(lease.sid).splice(room.hands.get(lease.sid).indexOf(card), 1);
      room.sendHand(client);
    } else if (destination === 'table') {
      documents.set(message.id, { drawing, paper, faceDown: message.faceDown });
    } else if (destination === 'hand' && card) {
      card.drawing = drawing;
      card.paper = paper;
      room.sendHand(client);
    } else {
      const props = card?.noteProps || readProps(room.state.pieces.get(message.id));
      give(recipient, drawing, paper, props);
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

  // Stack order and artwork share the existing edit leases and inventory accounting.
  function syncStack(id) {
    const cards = stacks.get(id),
      piece = room.state.pieces.get(id);
    if (!piece || !cards) return;
    if (!cards.length) {
      room.removePiece(id);
      return;
    }
    piece.count = cards.length;
    publish(id);
    updateNotecardStackCollider(room, id);
  }
  function restoreStack(id, cards) {
    stacks.set(id, cards);
    syncStack(id);
  }
  function availableStack(client, message) {
    const parsed = pieceIdPayload(message);
    if (!parsed || !stacks.has(parsed.id)) return null;
    const piece = room.state.pieces.get(parsed.id);
    if (!piece || piece.owner || room.flips.has(parsed.id) || blocked(client, message)) return null;
    return parsed.id;
  }
  function placeStackCard(id, top, drawing, paper, faceDown) {
    const body = room.bodies.get(id);
    transferring.add(top);
    try {
      return room.spawn(
        'notecard',
        [body.position.x + NOTECARD.width + 0.3, body.position.y + 0.5, body.position.z],
        {
          ...top.noteProps,
          drawing,
          paper,
          faceDown,
        },
      );
    } finally {
      transferring.delete(top);
    }
  }
  function draw(client, message) {
    if (!isPlainObject(message) || !['hand', 'table'].includes(message.destination)) return;
    const id = availableStack(client, { id: message.id });
    if (!id) return;
    const cards = stacks.get(id),
      top = cards.at(-1);
    if (message.destination === 'table') {
      if (!hasPieceCapacity(room)) {
        room.notifyFull(client);
        return;
      }
      placeStackCard(id, top, top.drawing, top.paper, true);
    } else give(client, top.drawing, top.paper, top.noteProps);
    cards.pop();
    syncStack(id);
  }
  function shuffle(client, message) {
    const id = availableStack(client, message);
    if (!id) return;
    const cards = stacks.get(id);
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    room.broadcast('sfx', { type: 'shuffle' });
  }
  function split(client, message) {
    const id = availableStack(client, message);
    if (!id) return;
    const cards = stacks.get(id);
    if (cards.length < 2) return;
    if (!hasPieceCapacity(room)) {
      room.notifyFull(client);
      return;
    }
    const top = cards.slice(Math.floor(cards.length / 2)),
      body = room.bodies.get(id);
    for (const card of top) transferring.add(card);
    try {
      room.spawn(
        'notecardStack',
        [body.position.x + NOTECARD.width + 0.3, body.position.y, body.position.z],
        {
          ...readProps(room.state.pieces.get(id)),
          cards: top,
        },
      );
    } finally {
      for (const card of top) transferring.delete(card);
    }
    cards.splice(cards.length - top.length);
    syncStack(id);
  }
  function combine(client, message) {
    if (
      !isPlainObject(message) ||
      !Array.isArray(message.ids) ||
      message.ids.length < 2 ||
      message.ids.length > NOTECARD.maxCards
    )
      return;
    const ids = [...new Set(message.ids)];
    if (ids.length !== message.ids.length || ids.some((id) => typeof id !== 'string')) return;
    // Reject a mixed selection rather than silently consuming just part of it.
    if (
      ids.some((id) => {
        const piece = room.state.pieces.get(id);
        return (
          !piece ||
          !room.bodies.has(id) ||
          piece.owner ||
          room.flips.has(id) ||
          (!documents.has(id) && !stacks.has(id))
        );
      }) ||
      blocked(client, message)
    )
      return;
    ids.sort((a, b) => room.bodies.get(a).position.y - room.bodies.get(b).position.y);
    const cards = normalizeNotecardStack(
      ids.flatMap(
        (id) =>
          stacks.get(id) || [
            {
              drawing: documents.get(id).drawing,
              paper: documents.get(id).paper,
              noteProps: readProps(room.state.pieces.get(id)),
            },
          ],
      ),
    );
    if (!cards) return;
    const anchor = ids[0],
      piece = room.state.pieces.get(anchor);
    // Reuse one physical piece: combining remains possible at the table piece cap.
    // Prepare the replacement collider before consuming any source inventory.
    const previousCount = piece.count;
    piece.count = cards.length;
    try {
      updateNotecardStackCollider(room, anchor);
    } catch (error) {
      piece.count = previousCount;
      throw error;
    }
    room.unpinPiece(anchor);
    documents.delete(anchor);
    stacks.set(anchor, cards);
    piece.type = 'notecardStack';
    publish(anchor);
    for (const id of ids.slice(1)) room.removePiece(id);
  }

  return {
    restoreStack,
    draw,
    shuffle,
    split,
    combine,
    restore,
    take,
    placeHandCard,
    claim,
    commit,
    flip,
    blocked,
    cancelClient,
    hasCapacity: (amount = 1) => count() + amount <= NOTECARD.maxCards,
    isEditing: (id) => leases.has(id),
    snapshot: (id) =>
      stacks.has(id) ? { cards: structuredClone(stacks.get(id)) } : documents.get(id),
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
      stacks.delete(id);
    },
    clear: () => {
      for (const id of [...leases.keys()]) close(id, 'The table was reset.');
      documents.clear();
      stacks.clear();
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
    notecardDraw: 'draw',
    notecardShuffle: 'shuffle',
    notecardSplit: 'split',
    notecardCombine: 'combine',
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
