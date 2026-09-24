import { randomUUID } from 'node:crypto';
import { RANK, canUseRoomCapability } from '../permissions.js';
import { cardFrontRef, cardBackRef } from '../deck-state.js';
import { spawnTableCard } from './card-transfer.js';
import { hasPieceCapacity } from './piece-capacity.js';
import { readProps, writeProps } from './props-codec.js';
import { syncOpenCover } from './deck-sync.js';

export const BROWSE_IDLE_MS = 60_000;
export const BROWSE_STEP_MS = 80;
const MAX_RECEIPTS = 64;

// Private room-local leases. Cards stay in deckCards until a synchronous transfer commits.
export function createDeckBrowsing(room, { geoOf, maxPieces, now = Date.now, token = randomUUID }) {
  const decks = new Map(),
    sessions = new Map();
  const send = (client, type, value) => {
    // A closed socket must not retain a lease or undo committed inventory.
    try {
      if (!client.auth?.revoked) client.send(type, value);
    } catch {}
  };
  const error = (client, message) =>
    send(client, 'serverError', { operation: 'deckBrowse', message });
  const allowed = (client, piece) =>
    canUseRoomCapability(client.auth ?? {}, 'gameplay') &&
    (room.rank(client) >= RANK.gm || readProps(piece).browseAccess === 'players');
  function close(session, reason = 'Deck browsing closed.') {
    if (!session) return;
    if (decks.get(session.deckId) === session) decks.delete(session.deckId);
    sessions.delete(session.client.sessionId);
    send(session.client, 'deckBrowseClosed', { token: session.token, reason });
  }
  function cancelDeck(id, reason) {
    close(decks.get(id), reason);
  }
  function cancelClient(sid, reason) {
    close(sessions.get(sid), reason);
  }
  function sweep() {
    for (const session of sessions.values()) {
      const piece = room.state.pieces.get(session.deckId);
      if (now() >= session.expires) close(session, 'Deck browsing expired.');
      else if (!session.ended && (!piece || !allowed(session.client, piece)))
        close(session, 'Deck browsing access changed.');
    }
  }
  function blocked(client, ids) {
    sweep();
    if (!ids.some((id) => decks.has(id))) return false;
    if (client)
      error(client, 'That deck is being browsed. Close its browser before changing its contents.');
    return true;
  }
  function preview(session) {
    const piece = room.state.pieces.get(session.deckId),
      cards = room.deckCards.get(session.deckId);
    const props = readProps(piece),
      entry = cards[session.index];
    session.entryToken = token();
    session.expires = now() + BROWSE_IDLE_MS;
    send(session.client, 'deckBrowseCard', {
      token: session.token,
      deckId: session.deckId,
      revision: session.revision,
      entryToken: session.entryToken,
      position: cards.length - session.index,
      count: cards.length,
      front: cardFrontRef(entry),
      back: cardBackRef(entry) || props.back || 'back',
      ...geoOf(props),
    });
  }
  function start(client, { deckId }) {
    sweep();
    const piece = room.state.pieces.get(deckId),
      cards = room.deckCards.get(deckId);
    if (piece?.type !== 'deck' || !cards?.length || !allowed(client, piece))
      return error(client, 'You cannot browse this deck. A GM can allow player browsing.');
    if (blocked(client, [deckId])) return;
    if (
      room.pendingInspect.has(client.sessionId) ||
      [...room.pendingInspect.values()].some((p) => p.deckId === deckId)
    )
      return error(client, 'Finish the current card inspection before browsing.');
    cancelClient(client.sessionId);
    const session = {
      client,
      deckId,
      token: token(),
      revision: 0,
      index: cards.length - 1,
      expires: now() + BROWSE_IDLE_MS,
      lastStep: -Infinity,
      receipts: new Set(),
    };
    decks.set(deckId, session);
    sessions.set(client.sessionId, session);
    preview(session);
  }
  function current(client, message) {
    sweep();
    const session = sessions.get(client.sessionId);
    if (
      !session ||
      session.token !== message.token ||
      session.ended ||
      !allowed(client, room.state.pieces.get(session.deckId))
    ) {
      error(client, 'Deck browsing has ended. Open the deck browser again.');
      return null;
    }
    if (session.revision !== message.revision) {
      error(client, 'The card changed. Try again with the current preview.');
      return null;
    }
    return session;
  }
  function step(client, message) {
    const session = current(client, message);
    if (!session) return;
    if (now() - session.lastStep < BROWSE_STEP_MS)
      return error(client, 'Please browse more slowly.');
    session.lastStep = now();
    const cards = room.deckCards.get(session.deckId);
    session.index = Math.max(0, Math.min(cards.length - 1, session.index - message.direction));
    session.revision++;
    preview(session);
  }
  function keepAlive(client, message) {
    const session = current(client, message);
    if (session) session.expires = now() + BROWSE_IDLE_MS;
  }
  function action(client, message) {
    sweep();
    const prior = sessions.get(client.sessionId);
    if (
      prior?.token === message.token &&
      prior.receipts.has(message.requestId) &&
      canUseRoomCapability(client.auth ?? {}, 'gameplay')
    ) {
      send(client, 'deckBrowseActionDone', { token: prior.token, requestId: message.requestId });
      return;
    }
    const session = current(client, message);
    if (!session) return;
    if (message.entryToken !== session.entryToken)
      return error(client, 'The selected card changed.');
    const { deckId } = session,
      piece = room.state.pieces.get(deckId),
      cards = room.deckCards.get(deckId);
    const props = readProps(piece),
      entry = cards[session.index];
    if (message.action.startsWith('field-') && !hasPieceCapacity(room, maxPieces))
      return error(client, 'The table is full. The card is still in the deck.');
    const original = cards.slice(),
      oldProps = piece.props,
      oldCount = piece.count;
    const oldHand = room.hands.get(client.sessionId)?.slice(),
      oldHid = room.nextHid;
    const pieceIds = new Set(room.state.pieces.keys());
    const bodySet = new Set(room.world?.bodies || []);
    try {
      if (message.action === 'hand')
        room.addToHand(
          client,
          cardFrontRef(entry),
          cardBackRef(entry) || props.back || 'back',
          geoOf(props),
          props.open,
          { notify: false },
        );
      else if (message.action.startsWith('field-')) {
        const body = room.bodies.get(deckId);
        spawnTableCard(
          room,
          room.besideDeck(body),
          {
            front: cardFrontRef(entry),
            back: cardBackRef(entry) || props.back || 'back',
            open: props.open,
            geo: geoOf(props),
          },
          message.action === 'field-down',
        );
      }
      cards.splice(session.index, 1);
      if (message.action === 'top') cards.push(entry);
      if (message.action === 'bottom') cards.unshift(entry);
      piece.count = cards.length;
      room.updateDeckCollider(deckId);
      syncOpenCover(room, deckId);
    } catch (failure) {
      cards.splice(0, cards.length, ...original);
      piece.props = oldProps;
      piece.count = oldCount;
      if (oldHand) room.hands.set(client.sessionId, oldHand);
      else room.hands.delete(client.sessionId);
      room.nextHid = oldHid;
      for (const id of room.state.pieces.keys()) if (!pieceIds.has(id)) room.removePiece(id);
      for (const body of [...(room.world?.bodies || [])])
        if (!bodySet.has(body)) room.world.removeBody(body);
      room.updateDeckCollider(deckId);
      throw failure;
    }
    // The inventory commit is complete. Socket errors must not roll it back or permit a retry.
    session.revision++;
    session.receipts.add(message.requestId);
    if (session.receipts.size > MAX_RECEIPTS)
      session.receipts.delete(session.receipts.values().next().value);
    session.expires = now() + BROWSE_IDLE_MS;
    if (!cards.length) {
      decks.delete(deckId);
      session.ended = true;
      room.removePiece(deckId);
    } else session.index = Math.min(session.index, cards.length - 1);
    if (message.action === 'hand') room.sendHand(client);
    send(client, 'deckBrowseActionDone', { token: session.token, requestId: message.requestId });
    if (session.ended)
      send(client, 'deckBrowseClosed', { token: session.token, reason: 'The deck is empty.' });
    else preview(session);
  }
  function setAccess(client, { deckId, access }) {
    if (room.rank(client) < RANK.gm)
      return error(client, 'Only a GM can change deck browsing access.');
    const piece = room.state.pieces.get(deckId);
    if (piece?.type !== 'deck') return;
    cancelDeck(deckId, 'Deck browsing access changed.');
    const props = readProps(piece);
    props.browseAccess = access;
    writeProps(piece, props);
  }
  return {
    start,
    step,
    keepAlive,
    action,
    setAccess,
    blocked,
    sweep,
    cancelDeck,
    cancelClient,
    close(client, { token }) {
      const s = sessions.get(client.sessionId);
      if (s?.token === token) close(s);
    },
    clear() {
      for (const session of [...sessions.values()]) close(session);
    },
  };
}
