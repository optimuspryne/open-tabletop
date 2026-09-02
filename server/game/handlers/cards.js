import { takeTopCard } from '../../deck-state.js';
import {
  deckDragPayload,
  deckIdPayload,
  groupIds,
  inspectPlacementPayload,
  pieceIdPayload,
} from '../../message-validation.js';
import { readProps, writeProps } from '../props-codec.js';
import { safeMessage } from '../safe-message.js';

// Register the card/deck message family against a TableRoom-compatible object.
// Rendering/physics policy stays injected so this module owns orchestration only.
export function registerCardHandlers(
  room,
  { flipHop, maxPieces, spawnY, geoOf, dropSfx, randomPosition, shuffle, logger = console },
) {
  const cardMessage = (type, handler) => safeMessage(room, type, handler, { logger });

  cardMessage('flip', (client, message) => {
    const parsed = pieceIdPayload(message);
    if (!parsed) return;
    const { id } = parsed;
    const piece = room.state.pieces.get(id);
    const body = room.bodies.get(id);
    if (!piece || !body || piece.type !== 'card') return;
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
    room.broadcast('sfx', { type: 'card-flip' });
  });

  cardMessage('dealToTable', (client, message) => {
    const parsed = deckIdPayload(message);
    if (!parsed) return;
    const { deckId } = parsed;
    const deck = room.state.pieces.get(deckId);
    if (room.state.pieces.size >= maxPieces) {
      room.notifyFull(client); // check before takeTopCard so we never pull a card we can't place
      return;
    }
    const draw = takeTopCard(deck, room.deckCards.get(deckId));
    if (!draw) return;
    const props = readProps(deck);
    const id = room.spawnCardFlat(room.besideDeck(room.bodies.get(deckId)), {
      back: props.back || 'back',
      ...geoOf(props),
    });
    room.cardData.set(id, { front: draw.front });
    finishDraw(room, deckId, draw.empty);
    room.broadcast('sfx', { type: dropSfx('card', props) });
  });

  cardMessage('drawToHand', (client, message) => {
    const parsed = deckIdPayload(message);
    if (!parsed) return;
    const { deckId } = parsed;
    const deck = room.state.pieces.get(deckId);
    const draw = takeTopCard(deck, room.deckCards.get(deckId));
    if (!draw) return;
    const props = readProps(deck);
    room.addToHand(client, draw.front, props.back || 'back', geoOf(props));
    finishDraw(room, deckId, draw.empty);
    room.broadcast('sfx', { type: dropSfx('card', props) });
  });

  cardMessage('dealDrag', (client, message) => {
    const parsed = deckDragPayload(message);
    if (!parsed) return;
    const { deckId, x, y, z } = parsed;
    const target = { x, y, z };
    const deck = room.state.pieces.get(deckId);
    const deckBody = room.bodies.get(deckId);
    if (!deckBody) return;
    if (room.state.pieces.size >= maxPieces) {
      room.notifyFull(client); // check before takeTopCard so we never pull a card we can't place
      return;
    }
    const draw = takeTopCard(deck, room.deckCards.get(deckId));
    if (!draw) return;
    const props = readProps(deck);
    const id = room.spawnCardFlat([deckBody.position.x, 2.5, deckBody.position.z], {
      back: props.back || 'back',
      ...geoOf(props),
    });
    room.cardData.set(id, { front: draw.front });
    finishDraw(room, deckId, draw.empty);
    room.state.pieces.get(id).owner = client.sessionId;
    room.targets.set(id, target);
    client.send('dealt', { id });
  });

  cardMessage('takeCard', (client, message) => {
    const parsed = pieceIdPayload(message);
    if (!parsed) return;
    const { id } = parsed;
    const piece = room.state.pieces.get(id);
    if (!piece || piece.type !== 'card') return;
    const props = readProps(piece);
    const front = (room.cardData.get(id) || {}).front || props.front;
    room.addToHand(client, front, props.back || 'back', geoOf(props));
    room.removePiece(id);
  });

  cardMessage('drawInspect', (client, message) => {
    if (room.pendingInspect.has(client.sessionId)) return;
    const parsed = deckIdPayload(message);
    if (!parsed) return;
    const { deckId } = parsed;
    const deck = room.state.pieces.get(deckId);
    const draw = takeTopCard(deck, room.deckCards.get(deckId));
    if (!draw) return;
    const props = readProps(deck);
    const geo = geoOf(props);
    room.updateDeckCollider(deckId);
    room.pendingInspect.set(client.sessionId, {
      deckId,
      front: draw.front,
      back: props.back || 'back',
      geo,
    });
    client.send('inspectCard', { front: draw.front, back: props.back || 'back', ...geo });
  });

  cardMessage('inspectPlace', (client, message) => {
    const parsed = inspectPlacementPayload(message);
    if (!parsed) return;
    const pending = room.pendingInspect.get(client.sessionId);
    if (!pending) return;
    room.pendingInspect.delete(client.sessionId);
    const { deckId, front, back, geo = {} } = pending;
    const { where } = parsed;
    if (where === 'deck') {
      const cards = room.deckCards.get(deckId);
      if (cards) {
        cards.push(front);
        const deck = room.state.pieces.get(deckId);
        if (deck) deck.count = cards.length;
        room.updateDeckCollider(deckId);
      }
      return;
    }
    if (where === 'hand') {
      room.addToHand(client, front, back, geo);
    } else {
      const faceDown = where === 'field-down';
      const deckBody = room.bodies.get(deckId);
      const position = deckBody ? room.besideDeck(deckBody) : randomPosition();
      const id = room.spawnCardFlat(
        position,
        faceDown ? { back, ...geo } : { front, back, ...geo },
      );
      if (faceDown) room.cardData.set(id, { front });
    }
    const cards = room.deckCards.get(deckId);
    if (cards && cards.length === 0) room.removePiece(deckId);
  });

  cardMessage('shuffle', (client, message) => {
    const parsed = deckIdPayload(message);
    if (!parsed) return;
    const { deckId } = parsed;
    const cards = room.deckCards.get(deckId);
    if (!cards) return;
    shuffle(cards);
    room.broadcast('shuffled', { id: deckId });
  });

  cardMessage('splitDeck', (client, message) => {
    const parsed = deckIdPayload(message);
    if (!parsed) return;
    const { deckId } = parsed;
    const deck = room.state.pieces.get(deckId);
    const cards = room.deckCards.get(deckId);
    if (!deck || deck.type !== 'deck' || !cards || cards.length < 2) return;
    if (room.state.pieces.size >= maxPieces) {
      room.notifyFull(client);
      return;
    }
    const props = readProps(deck);
    const bottom = cards.splice(Math.floor(cards.length / 2));
    deck.count = cards.length;
    room.updateDeckCollider(deckId);
    const position = room.bodies.get(deckId)?.position || { x: 0, z: 0 };
    room.spawn('deck', [position.x + 2.2, spawnY, position.z], {
      back: props.back || 'back',
      cards: bottom,
      ...geoOf(props),
    });
  });

  // Consolidate a multi-selection of card-family pieces (loose cards + whole decks) into one
  // face-down deck at their centre. The inverse-and-then-some of splitDeck: it also scoops a
  // deck's discard pile back in. Homogeneous back + geometry only — a mixed selection is refused
  // outright (no partial combine); non-card pieces in the selection are ignored. Open to anyone
  // who can touch decks, like splitDeck.
  cardMessage('combineIntoDeck', (client, message) => {
    const ids = groupIds(message, { max: maxPieces });
    if (!ids) return;
    const members = [];
    for (const id of ids) {
      const piece = room.state.pieces.get(id);
      const body = room.bodies.get(id);
      if (!piece || !body || (piece.type !== 'card' && piece.type !== 'deck')) continue;
      members.push({ id, piece, body, props: readProps(piece) });
    }
    if (members.length < 2) return; // need at least two card-family pieces to consolidate
    const sig = (pr) => JSON.stringify([pr.back || 'back', pr.tile ?? null, pr.geom ?? null]);
    const target = sig(members[0].props);
    if (members.some((m) => sig(m.props) !== target)) return; // mixed back/geom → refuse
    members.sort((a, b) => b.body.position.y - a.body.position.y); // top of the table → top of deck
    const cards = [];
    let cx = 0;
    let cz = 0;
    for (const m of members) {
      cx += m.body.position.x;
      cz += m.body.position.z;
      if (m.piece.type === 'deck') {
        cards.push(...(room.deckCards.get(m.id) || [])); // whole stack, top-first
      } else {
        const front = room.cardData.get(m.id)?.front ?? m.props.front;
        if (front != null) cards.push(front);
      }
    }
    if (cards.length < 2) return; // e.g. only empty decks were selected
    cx /= members.length;
    cz /= members.length;
    const props = members[0].props;
    for (const m of members) room.removePiece(m.id); // remove first → the new deck always fits
    room.spawn('deck', [cx, spawnY, cz], {
      back: props.back || 'back',
      cards,
      ...geoOf(props),
    });
    room.broadcast('sfx', { type: dropSfx('deck', props) });
  });
}

function finishDraw(room, deckId, empty) {
  if (empty) room.removePiece(deckId);
  else room.updateDeckCollider(deckId);
}
