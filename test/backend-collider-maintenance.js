import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as CANNON from 'cannon-es';
import {
  DECK_MODELS,
  DISPENSERS,
  PROPS,
  cardGeom,
  deckHeight,
  stackVisible,
} from '../shared/pieces.js';
import { updateDeckCollider, updateStackCollider } from '../server/game/collider-maintenance.js';

function harness(props, count = 1) {
  const body = new CANNON.Body({ mass: 1 });
  const original = new CANNON.Box(new CANNON.Vec3(0.1, 0.1, 0.1));
  body.addShape(original);
  body.sleep();
  const room = {
    bodies: new Map([['piece', body]]),
    state: {
      pieces: new Map([['piece', { count, props: JSON.stringify(props) }]]),
    },
  };
  return { body, original, room };
}

test('ordinary deck colliders follow shared rectangular card geometry and live count', () => {
  const props = { geom: { w: 0.7, h: 1.2, t: 0.08 } };
  const count = 24;
  const { body, original, room } = harness(props, count);

  updateDeckCollider(room, 'piece');

  const shape = body.shapes[0];
  const geometry = cardGeom(props);
  assert.notEqual(shape, original);
  assert.equal(shape instanceof CANNON.Box, true);
  assert.deepEqual(
    [shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z],
    [geometry.hw, deckHeight(count) / 2, geometry.hh],
  );
  assert.equal(body.sleepState, CANNON.Body.AWAKE);
});

test('hex deck colliders retain their six-sided shared footprint', () => {
  const props = { geom: { w: 1, h: 0.9, t: 0.08, shape: 'hex' } };
  const count = 8;
  const { body, room } = harness(props, count);

  updateDeckCollider(room, 'piece');

  const shape = body.shapes[0];
  const geometry = cardGeom(props);
  assert.equal(shape instanceof CANNON.Cylinder, true);
  assert.equal(shape.radiusTop, geometry.hh);
  assert.equal(shape.radiusBottom, geometry.hh);
  assert.equal(shape.height, deckHeight(count));
  assert.equal(shape.numSegments, 6);
});

test('modeled decks use their authored fixed collider regardless of card count', () => {
  for (const count of [1, 100]) {
    const { body, room } = harness({ model: 'bag' }, count);
    updateDeckCollider(room, 'piece');
    const shape = body.shapes[0];
    assert.equal(shape instanceof CANNON.Box, true);
    assert.deepEqual(
      [shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z],
      DECK_MODELS.bag.box,
    );
  }
});

test('finite stack colliders follow item radius and capped visible inventory height', () => {
  const count = 100;
  const { body, room } = harness({ disp: 'pokerStack' }, count);

  updateStackCollider(room, 'piece');

  const definition = DISPENSERS.pokerStack;
  const box = PROPS[definition.item].collider.box;
  const itemHeight = box[1] * 2;
  const shape = body.shapes[0];
  assert.equal(shape instanceof CANNON.Cylinder, true);
  assert.equal(shape.radiusTop, box[0]);
  assert.equal(shape.radiusBottom, box[0]);
  assert.equal(shape.height, stackVisible(count) * itemHeight);
  assert.equal(shape.numSegments, 16);
  assert.equal(body.sleepState, CANNON.Body.AWAKE);
});

test('modeled and infinite dispensers retain their authored collider', () => {
  for (const disp of ['trainStack', 'goBowl', 'unknown']) {
    const { body, original, room } = harness({ disp }, 20);
    updateStackCollider(room, 'piece');
    assert.equal(body.shapes[0], original);
    assert.equal(body.sleepState, CANNON.Body.SLEEPING);
  }
});

test('collider updates tolerate missing synchronized pieces or bodies', () => {
  const { room } = harness({}, 1);
  assert.doesNotThrow(() => updateDeckCollider(room, 'missing'));
  assert.doesNotThrow(() => updateStackCollider(room, 'missing'));
  room.bodies.delete('piece');
  assert.doesNotThrow(() => updateDeckCollider(room, 'piece'));
  assert.doesNotThrow(() => updateStackCollider(room, 'piece'));
});
