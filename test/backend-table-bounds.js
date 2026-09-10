import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as CANNON from 'cannon-es';
import { createTableBounds } from '../server/game/table-bounds.js';
import { TABLE_SHAPES, tableOutline } from '../shared/pieces.js';

const TUNING = {
  tableThickness: 0.5,
  wall: { half: 4, thick: 0.5, over: 1 },
};
const buildTableBounds = createTableBounds(TUNING);

function makeRoom(shape = 'rect') {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) });
  const material = new CANNON.Material('surface');
  world.__mat = material;
  world.addContactMaterial(
    new CANNON.ContactMaterial(material, material, { friction: 0, restitution: 1 }),
  );
  return {
    world,
    state: { tableShape: shape },
    trayBuilds: 0,
    buildTrays() {
      this.trayBuilds++;
    },
  };
}

const vector = (value) => [value.x, value.y, value.z];

test('rectangular bounds preserve the floor and four outside wall dimensions', () => {
  const room = makeRoom();
  buildTableBounds(room, 6, 4);

  assert.equal(room._bounds.length, 5);
  assert.deepEqual(room.world.bodies, room._bounds);
  assert.equal(room.trayBuilds, 1);
  const [floor, near, far, left, right] = room._bounds;
  assert.equal(floor.mass, 0);
  assert.equal(floor.material, room.world.__mat);
  assert.deepEqual(vector(floor.position), [0, -0.5, 0]);
  assert.deepEqual(vector(floor.shapes[0].halfExtents), [6, 0.5, 4]);
  assert.deepEqual(vector(near.position), [0, 4, -4.5]);
  assert.deepEqual(vector(far.position), [0, 4, 4.5]);
  assert.deepEqual(vector(left.position), [-6.5, 4, 0]);
  assert.deepEqual(vector(right.position), [6.5, 4, 0]);
  assert.deepEqual(vector(near.shapes[0].halfExtents), [7, 4, 0.5]);
  assert.deepEqual(vector(left.shapes[0].halfExtents), [0.5, 4, 5]);
});

test('every supported shape builds one sealed wall segment per shared-outline edge', () => {
  for (const shape of TABLE_SHAPES) {
    const room = makeRoom(shape);
    buildTableBounds(room, 5, 3);
    const outline = tableOutline(shape, 5, 3);
    const expectedWalls = shape === 'rect' ? 4 : outline.length;
    assert.equal(room._bounds.length, 1 + expectedWalls, `${shape} body count`);
    assert.deepEqual(vector(room._bounds[0].shapes[0].halfExtents), [5, 0.5, 3]);
    if (shape === 'rect') continue;
    for (let index = 0; index < outline.length; index++) {
      const a = outline[index];
      const b = outline[(index + 1) % outline.length];
      const wallBody = room._bounds[index + 1];
      assert.deepEqual(vector(wallBody.position), [
        (a.x + b.x) / 2,
        TUNING.wall.half,
        (a.z + b.z) / 2,
      ]);
      assert.deepEqual(vector(wallBody.shapes[0].halfExtents), [
        Math.hypot(b.x - a.x, b.z - a.z) / 2 + TUNING.wall.thick,
        TUNING.wall.half,
        TUNING.wall.thick,
      ]);
    }
  }
});

test('resizing removes every old boundary body, preserves unrelated bodies, and rebuilds trays', () => {
  const room = makeRoom();
  const unrelated = new CANNON.Body({ mass: 1 });
  room.world.addBody(unrelated);
  buildTableBounds(room, 6, 4, 'rect');
  const oldBounds = [...room._bounds];

  buildTableBounds(room, 5, 5, 'hex');

  assert.equal(room.trayBuilds, 2);
  assert.ok(room.world.bodies.includes(unrelated));
  assert.ok(oldBounds.every((body) => !room.world.bodies.includes(body)));
  assert.equal(room._bounds.length, 7);
  assert.equal(room.world.bodies.length, 8);
});

test('the generated wall rings physically contain moving pieces for every table shape', () => {
  for (const shape of TABLE_SHAPES) {
    const room = makeRoom(shape);
    buildTableBounds(room, 5, 3, shape);
    const piece = new CANNON.Body({ mass: 1, material: room.world.__mat });
    piece.addShape(new CANNON.Sphere(0.25));
    piece.position.set(0, 0.5, 0);
    piece.velocity.set(6, 0, 2);
    piece.linearDamping = 0;
    piece.allowSleep = false;
    room.world.addBody(piece);

    for (let step = 0; step < 720; step++) room.world.step(1 / 240);

    const outline = tableOutline(shape, 5, 3);
    const maxX = Math.max(...outline.map((point) => Math.abs(point.x)));
    const maxZ = Math.max(...outline.map((point) => Math.abs(point.z)));
    assert.ok(Math.abs(piece.position.x) <= maxX + 0.75, `${shape} contained on x`);
    assert.ok(Math.abs(piece.position.z) <= maxZ + 0.75, `${shape} contained on z`);
  }
});
