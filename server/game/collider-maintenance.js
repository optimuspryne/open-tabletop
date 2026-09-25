import { NOTECARD } from '../../shared/notecards.js';
import { dispenserDefinition } from '../../shared/pieces.js';
import { attachCollider, buildCollider } from '../physics.js';
import { readProps } from './props-codec.js';

const replaceCollider = (body, collider) => {
  while (body.shapes.length) body.removeShape(body.shapes[0]);
  attachCollider(body, collider);
  body.updateBoundingRadius();
  body.updateMassProperties();
  body.wakeUp();
};

// Rebuild a deck collider from its current count and public geometry. Modeled deck skins retain
// their authored fixed box instead of growing and shrinking with the hidden card inventory.
export function updateDeckCollider(room, deckId) {
  const body = room.bodies.get(deckId);
  const piece = room.state.pieces.get(deckId);
  if (!body || !piece) return;
  const props = readProps(piece);
  replaceCollider(body, buildCollider('deck', props, { count: piece.count }));
}

// Rebuild only finite chip/coin stack dispensers. Bowls and modeled dispensers keep their authored
// collider because their visible body does not grow with inventory.
export function updateStackCollider(room, id) {
  const body = room.bodies.get(id);
  const piece = room.state.pieces.get(id);
  if (!body || !piece) return;
  const props = readProps(piece);
  const dispenser = dispenserDefinition(props);
  if (!dispenser) return;
  const changesWithCount = props.asset
    ? dispenser.appearance === 'automatic'
    : dispenser.body === 'stack';
  if (!changesWithCount) return;
  replaceCollider(body, buildCollider('dispenser', props, { count: piece.count }));
}

export function updateNotecardStackCollider(room, id) {
  const piece = room.state.pieces.get(id),
    body = room.bodies.get(id);
  if (!piece || !body) return;
  body.mass = NOTECARD.mass * piece.count;
  replaceCollider(body, buildCollider('notecardStack', {}, { count: piece.count }));
}
