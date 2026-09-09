import { returnInspectedCard } from '../inspection-recovery.js';
import { spawnTableCard, takeTableCard } from '../card-transfer.js';
import {
  absorbedEntry,
  cardFrontRef,
  cardBackRef,
  takeTopCard,
  deckSpawnProps,
} from '../../deck-state.js';
import {
  deckDragPayload,
  deckIdPayload,
  groupIds,
  inspectPlacementPayload,
  pieceIdPayload,
} from '../../message-validation.js';
import { readProps, writeProps } from '../props-codec.js';
import { safeMessage } from '../safe-message.js';
import { ensurePieceCapacity } from '../piece-capacity.js';

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
    if (props.open) {
      if (props.down)
        delete props.down; // a double-sided tile: turn it over (which face is up), both public
      else props.down = true;
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
    room.broadcast('sfx', { type: 'card-flip' });
  });

  cardMessage('dealToTable', (client, message) => {
    const parsed = deckIdPayload(message);
    if (!parsed) return;
    const { deckId } = parsed;
    const deck = room.state.pieces.get(deckId);
    if (!ensurePieceCapacity(room, client, maxPieces)) return;
    const draw = takeTopCard(deck, room.deckCards.get(deckId));
    if (!draw) return;
    const props = readProps(deck);
    spawnTableCard(room, room.besideDeck(room.bodies.get(deckId)), {
      front: draw.front,
      back: draw.back || props.back || 'back',
      open: props.open,
      geo: geoOf(props),
    });
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
    room.addToHand(client, draw.front, draw.back || props.back || 'back', geoOf(props), props.open);
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
    if (!ensurePieceCapacity(room, client, maxPieces)) return;
    const draw = takeTopCard(deck, room.deckCards.get(deckId));
    if (!draw) return;
    const props = readProps(deck);
    const id = spawnTableCard(room, [deckBody.position.x, 2.5, deckBody.position.z], {
      front: draw.front,
      back: draw.back || props.back || 'back',
      open: props.open,
      geo: geoOf(props),
    });
    finishDraw(room, deckId, draw.empty);
    room.state.pieces.get(id).owner = client.sessionId;
    room.targets.set(id, target);
    client.send('dealt', { id });
  });

  cardMessage('takeCard', (client, message) => {
    const parsed = pieceIdPayload(message);
    if (!parsed) return;
    const { id } = parsed;
    takeTableCard(room, client, id, geoOf);
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
    const back = draw.back || props.back || 'back';
    room.pendingInspect.set(client.sessionId, {
      deckId,
      front: draw.front,
      back,
      cardBack: draw.back, // the per-tile back (undefined → shares the deck's back)
      open: props.open,
      geo,
    });
    client.send('inspectCard', { front: draw.front, back, ...geo });
  });

  cardMessage('inspectPlace', (client, message) => {
    const parsed = inspectPlacementPayload(message);
    if (!parsed) return;
    const pending = room.pendingInspect.get(client.sessionId);
    if (!pending) return;
    if (parsed.where.startsWith('field-') && !ensurePieceCapacity(room, client, maxPieces)) {
      // The browser closes the inspection optimistically when choosing a destination.
      // Reopen it so the retained card can still go to the hand/deck or be retried.
      client.send('inspectCard', { front: pending.front, back: pending.back, ...pending.geo });
      return;
    }
    if (parsed.where === 'deck') {
      if (!returnInspectedCard(room, client.sessionId, maxPieces)) {
        room.notifyFull(client);
        client.send('inspectCard', { front: pending.front, back: pending.back, ...pending.geo });
      }
      return;
    }
    room.pendingInspect.delete(client.sessionId);
    const { deckId, front, back, open, geo = {} } = pending;
    const { where } = parsed;
    if (where === 'hand') {
      room.addToHand(client, front, back, geo, open);
    } else {
      const deckBody = room.bodies.get(deckId);
      const position = deckBody ? room.besideDeck(deckBody) : randomPosition();
      spawnTableCard(room, position, { front, back, open, geo }, where === 'field-down');
    }
    const cards = room.deckCards.get(deckId);
    if (cards && cards.length === 0) room.removePiece(deckId);
    else syncOpenCover(room, deckId); // the peeked tile left the top → repaint an open set's cover
  });

  cardMessage('shuffle', (client, message) => {
    const parsed = deckIdPayload(message);
    if (!parsed) return;
    const { deckId } = parsed;
    const cards = room.deckCards.get(deckId);
    if (!cards) return;
    shuffle(cards);
    syncOpenCover(room, deckId); // a new tile is on top → repaint an open set's cover
    room.broadcast('shuffled', { id: deckId });
  });

  cardMessage('splitDeck', (client, message) => {
    const parsed = deckIdPayload(message);
    if (!parsed) return;
    const { deckId } = parsed;
    const deck = room.state.pieces.get(deckId);
    const cards = room.deckCards.get(deckId);
    if (!deck || deck.type !== 'deck' || !cards || cards.length < 2) return;
    if (!ensurePieceCapacity(room, client, maxPieces)) return;
    const props = readProps(deck);
    const bottom = cards.splice(Math.floor(cards.length / 2));
    deck.count = cards.length;
    room.updateDeckCollider(deckId);
    syncOpenCover(room, deckId); // the source stack lost its top half → repaint its cover
    const position = room.bodies.get(deckId)?.position || { x: 0, z: 0 };
    room.spawn('deck', [position.x + 2.2, spawnY, position.z], deckSpawnProps(props, bottom));
  });

  // Consolidate a multi-selection of card-family pieces (loose cards + whole decks) into one
  // face-down deck at their centre. The inverse-and-then-some of splitDeck: it also scoops a
  // deck's discard pile back in. Matching geometry, visibility and snap behavior only — a mixed selection is refused
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
    const sig = (pr) =>
      JSON.stringify([
        pr.open ? null : pr.back || 'back',
        pr.tile ?? null,
        pr.geom ?? null,
        !!pr.open,
        !!pr.snap,
      ]);
    const target = sig(members[0].props);
    if (members.some((m) => sig(m.props) !== target)) return; // incompatible card behavior → refuse
    if ([...room.pendingInspect.values()].some((p) => members.some((m) => m.id === p.deckId)))
      return;
    members.sort((a, b) => a.body.position.y - b.body.position.y); // top of the table → top of deck
    const props = (members.find((m) => m.piece.type === 'deck') || members[0]).props;
    const cards = [];
    let cx = 0;
    let cz = 0;
    for (const m of members) {
      cx += m.body.position.x;
      cz += m.body.position.z;
      if (m.piece.type === 'deck') {
        cards.push(
          ...(room.deckCards.get(m.id) || []).map((entry) =>
            absorbedEntry(
              cardFrontRef(entry),
              cardBackRef(entry) ?? m.props.back ?? 'back',
              props.back || 'back',
            ),
          ),
        ); // bottom-first, matching pop()
      } else {
        const front = room.cardData.get(m.id)?.front ?? m.props.front;
        if (front != null)
          cards.push(absorbedEntry(front, m.props.back || 'back', props.back || 'back'));
      }
    }
    if (cards.length < 2) return; // e.g. only empty decks were selected
    cx /= members.length;
    cz /= members.length;
    for (const m of members) room.removePiece(m.id); // remove first → the new deck always fits
    room.spawn('deck', [cx, spawnY, cz], deckSpawnProps(props, cards));
    room.broadcast('sfx', { type: dropSfx('deck', props) });
  });
}

function finishDraw(room, deckId, empty) {
  if (empty) room.removePiece(deckId);
  else {
    room.updateDeckCollider(deckId);
    syncOpenCover(room, deckId); // the top tile changed → repaint the stack's visible cover
  }
}

// An OPEN tile set shows its current top tile's back as the stack cover; keep that in sync as the
// top changes (draw / shuffle / combine). Writes props (→ every client rebuilds the deck) only when
// the cover actually changes, and only for open decks. No-op for secret decks and bare-back stacks.
function syncOpenCover(room, deckId) {
  const piece = room.state.pieces.get(deckId);
  if (!piece) return;
  const props = readProps(piece);
  if (!props.open) return;
  const cards = room.deckCards.get(deckId);
  if (!cards || !cards.length) return;
  const cover = cardBackRef(cards[cards.length - 1]); // the top tile's own back (undefined → shared)
  const next = cover ?? props.back;
  if ((props.cover ?? props.back) === next) return; // nothing to repaint
  if (cover) props.cover = cover;
  else delete props.cover;
  writeProps(piece, props);
}
