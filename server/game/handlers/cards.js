import { takeTopCard } from '../../deck-state.js';
import { finitePosition } from '../../message-validation.js';

// Register the card/deck message family against a TableRoom-compatible object.
// Rendering/physics policy stays injected so this module owns orchestration only.
export function registerCardHandlers(room, { flipHop, maxPieces, spawnY, geoOf, dropSfx, randomPosition, shuffle }) {
  room.onMessage('flip', (client, message) => {
    const { id } = message || {};
    const piece = room.state.pieces.get(id);
    const body = room.bodies.get(id);
    if (!piece || !body || piece.type !== 'card') return;
    const props = JSON.parse(piece.props || '{}');
    if (props.front) {
      room.cardData.set(id, { front: props.front });
      delete props.front;
    } else if (room.cardData.has(id)) {
      props.front = room.cardData.get(id).front;
      room.cardData.delete(id);
    }
    piece.props = JSON.stringify(props);
    body.wakeUp();
    body.velocity.y = flipHop;
    room.broadcast('sfx', { type: 'card-flip' });
  });

  room.onMessage('dealToTable', (client, message) => {
    const { deckId } = message || {};
    const deck = room.state.pieces.get(deckId);
    const draw = takeTopCard(deck, room.deckCards.get(deckId));
    if (!draw) return;
    const props = JSON.parse(deck.props || '{}');
    const id = room.spawnCardFlat(room.besideDeck(room.bodies.get(deckId)), { back: props.back || 'back', ...geoOf(props) });
    room.cardData.set(id, { front: draw.front });
    finishDraw(room, deckId, draw.empty);
    room.broadcast('sfx', { type: dropSfx('card', props) });
  });

  room.onMessage('drawToHand', (client, message) => {
    const { deckId } = message || {};
    const deck = room.state.pieces.get(deckId);
    const draw = takeTopCard(deck, room.deckCards.get(deckId));
    if (!draw) return;
    const props = JSON.parse(deck.props || '{}');
    room.addToHand(client, draw.front, props.back || 'back', geoOf(props));
    finishDraw(room, deckId, draw.empty);
    room.broadcast('sfx', { type: dropSfx('card', props) });
  });

  room.onMessage('dealDrag', (client, message) => {
    const target = finitePosition(message);
    if (!target) return;
    const deckId = message.deckId;
    const deck = room.state.pieces.get(deckId);
    const deckBody = room.bodies.get(deckId);
    if (!deckBody) return;
    const draw = takeTopCard(deck, room.deckCards.get(deckId));
    if (!draw) return;
    const props = JSON.parse(deck.props || '{}');
    const id = room.spawnCardFlat([deckBody.position.x, 2.5, deckBody.position.z], { back: props.back || 'back', ...geoOf(props) });
    room.cardData.set(id, { front: draw.front });
    finishDraw(room, deckId, draw.empty);
    room.state.pieces.get(id).owner = client.sessionId;
    room.targets.set(id, target);
    client.send('dealt', { id });
  });

  room.onMessage('takeCard', (client, message) => {
    const { id } = message || {};
    const piece = room.state.pieces.get(id);
    if (!piece || piece.type !== 'card') return;
    const props = JSON.parse(piece.props || '{}');
    const front = (room.cardData.get(id) || {}).front || props.front;
    room.addToHand(client, front, props.back || 'back', geoOf(props));
    room.removePiece(id);
  });

  room.onMessage('drawInspect', (client, message) => {
    if (room.pendingInspect.has(client.sessionId)) return;
    const { deckId } = message || {};
    const deck = room.state.pieces.get(deckId);
    const draw = takeTopCard(deck, room.deckCards.get(deckId));
    if (!draw) return;
    const props = JSON.parse(deck.props || '{}');
    const geo = geoOf(props);
    room.updateDeckCollider(deckId);
    room.pendingInspect.set(client.sessionId, { deckId, front: draw.front, back: props.back || 'back', geo });
    client.send('inspectCard', { front: draw.front, back: props.back || 'back', ...geo });
  });

  room.onMessage('inspectPlace', (client, message) => {
    const pending = room.pendingInspect.get(client.sessionId);
    if (!pending) return;
    room.pendingInspect.delete(client.sessionId);
    const { deckId, front, back, geo = {} } = pending;
    const where = message && message.where;
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
      const id = room.spawnCardFlat(position, faceDown ? { back, ...geo } : { front, back, ...geo });
      if (faceDown) room.cardData.set(id, { front });
    }
    const cards = room.deckCards.get(deckId);
    if (cards && cards.length === 0) room.removePiece(deckId);
  });

  room.onMessage('shuffle', (client, message) => {
    const { deckId } = message || {};
    const cards = room.deckCards.get(deckId);
    if (!cards) return;
    shuffle(cards);
    room.broadcast('shuffled', { id: deckId });
  });

  room.onMessage('splitDeck', (client, message) => {
    const { deckId } = message || {};
    const deck = room.state.pieces.get(deckId);
    const cards = room.deckCards.get(deckId);
    if (!deck || deck.type !== 'deck' || !cards || cards.length < 2 || room.state.pieces.size >= maxPieces) return;
    const props = JSON.parse(deck.props || '{}');
    const bottom = cards.splice(Math.floor(cards.length / 2));
    deck.count = cards.length;
    room.updateDeckCollider(deckId);
    const position = room.bodies.get(deckId)?.position || { x: 0, z: 0 };
    room.spawn('deck', [position.x + 2.2, spawnY, position.z], { back: props.back || 'back', cards: bottom, ...geoOf(props) });
  });
}

function finishDraw(room, deckId, empty) {
  if (empty) room.removePiece(deckId);
  else room.updateDeckCollider(deckId);
}
