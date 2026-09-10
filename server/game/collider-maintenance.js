import * as CANNON from 'cannon-es';
import {
  DECK_MODELS,
  DISPENSERS,
  PROPS,
  cardGeom,
  deckHeight,
  stackVisible,
} from '../../shared/pieces.js';
import { readProps } from './props-codec.js';

const replaceShape = (body, shape) => {
  while (body.shapes.length) body.removeShape(body.shapes[0]);
  body.addShape(shape);
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
  const skin = props.model && DECK_MODELS[props.model];
  if (skin) {
    const [x, y, z] = skin.box;
    replaceShape(body, new CANNON.Box(new CANNON.Vec3(x, y, z)));
    return;
  }

  const geometry = cardGeom(props);
  const halfHeight = deckHeight(piece.count) / 2;
  replaceShape(
    body,
    geometry.shape === 'hex'
      ? new CANNON.Cylinder(geometry.hh, geometry.hh, halfHeight * 2, 6)
      : new CANNON.Box(new CANNON.Vec3(geometry.hw, halfHeight, geometry.hh)),
  );
}

// Rebuild only finite chip/coin stack dispensers. Bowls and modeled dispensers keep their authored
// collider because their visible body does not grow with inventory.
export function updateStackCollider(room, id) {
  const body = room.bodies.get(id);
  const piece = room.state.pieces.get(id);
  if (!body || !piece) return;
  const dispenser = DISPENSERS[readProps(piece).disp];
  if (!dispenser || dispenser.body !== 'stack') return;
  const box = PROPS[dispenser.item].collider.box;
  const radius = box[0];
  const itemHeight = box[1] * 2;
  replaceShape(
    body,
    new CANNON.Cylinder(
      radius,
      radius,
      Math.max(itemHeight, stackVisible(piece.count) * itemHeight),
      16,
    ),
  );
}
