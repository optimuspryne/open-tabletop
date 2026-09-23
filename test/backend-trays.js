import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as CANNON from 'cannon-es';
import { createTrayOperations, scoopTrayDice } from '../server/game/trays.js';
import { TRAY, seatAngle, trayCenter, trayCollisionParts, trayPlace } from '../shared/pieces.js';

function makeRoom() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) });
  world.__mat = new CANNON.Material('surface');
  return {
    world,
    state: {
      tableX: 10,
      tableZ: 7,
      trays: new Map(),
      pieces: new Map(),
    },
    bodies: new Map(),
    removed: [],
    removePiece(id) {
      this.removed.push(id);
      this.state.pieces.delete(id);
      const body = this.bodies.get(id);
      if (body) this.world.removeBody(body);
      this.bodies.delete(id);
    },
  };
}

const vector = (value) => [value.x, value.y, value.z];

test('building enabled trays replaces only old tray bounds and repositions stranded dice', () => {
  const room = makeRoom();
  const operations = createTrayOperations();
  const unrelated = new CANNON.Body({ mass: 0 });
  const oldTrayBody = new CANNON.Body({ mass: 0 });
  const die = new CANNON.Body({ mass: 1 });
  die.__traySeat = 0;
  die.position.set(0, 5, 0);
  die.velocity.set(3, 4, 5);
  die.angularVelocity.set(6, 7, 8);
  room.world.addBody(unrelated);
  room.world.addBody(oldTrayBody);
  room.world.addBody(die);
  room._trayBounds = [oldTrayBody];
  room.bodies.set('die-0', die);
  room.state.pieces.set('die-0', { type: 'die' });
  room.state.trays.set('0', true);
  room.state.trays.set('2', true);

  operations.buildTrays(room);

  assert.equal(room._trayBounds.length, trayCollisionParts().length * 2);
  assert.ok(room.world.bodies.includes(unrelated));
  assert.ok(room.world.bodies.includes(die));
  assert.ok(!room.world.bodies.includes(oldTrayBody));
  assert.equal(room.world.bodies.length, room._trayBounds.length + 2);
  assert.equal(room._trayBounds.filter((body) => body.__traySeat === 0).length, 6);
  assert.equal(room._trayBounds.filter((body) => body.__traySeat === 2).length, 6);
  assert.ok(room._trayBounds.every((body) => body.material === room.world.__mat));

  const center = operations.trayCenterFor(room, 0);
  assert.deepEqual(vector(die.position), [center.x, TRAY.recoveryY, center.z]);
  assert.deepEqual(vector(die.velocity), [0, 0, 0]);
  assert.deepEqual(vector(die.angularVelocity), [0, 0, 0]);

  const floorPosition = trayPlace(trayCollisionParts()[0], center, seatAngle(0));
  assert.deepEqual(vector(room._trayBounds[0].position), [
    floorPosition.x,
    floorPosition.y,
    floorPosition.z,
  ]);
  const wall = room._trayBounds[1];
  assert.equal(wall.shapes[0].halfExtents.y, TRAY.wall * TRAY.collisionWallScale);
  assert.equal(wall.position.y, TRAY.wall * TRAY.collisionWallScale);
  const ceiling = room._trayBounds[5];
  assert.equal(
    ceiling.position.y - ceiling.shapes[0].halfExtents.y,
    2 * TRAY.wall * TRAY.collisionWallScale,
  );

  const firstBuild = [...room._trayBounds];
  operations.buildTrays(room);
  assert.equal(room._trayBounds.length, 12);
  assert.ok(firstBuild.every((body) => !room.world.bodies.includes(body)));
  assert.equal(room.world.bodies.length, 14);
});

test('tray centers and injected-random drop positions preserve shared placement geometry', () => {
  const room = makeRoom();
  const values = [0, 1];
  const operations = createTrayOperations({ random: () => values.shift() });
  const seat = 3;
  const angle = seatAngle(seat);
  const center = trayCenter(angle, room.state.tableX, room.state.tableZ);

  assert.deepEqual(operations.trayCenterFor(room, seat), center);
  const expected = trayPlace(
    { x: -(TRAY.hx - TRAY.spawnInset), y: TRAY.spawnY, z: TRAY.hz - TRAY.spawnInset },
    center,
    angle,
  );
  assert.deepEqual(operations.trayDropPos(room, seat), [expected.x, expected.y, expected.z]);
});

test('Scoop separates mixed-size dice, settles them on the floor, and leaves other seats alone', () => {
  const room = makeRoom();
  room.world.gravity.set(0, -20, 0);
  const operations = createTrayOperations();
  room.trayCenterFor = (seat) => operations.trayCenterFor(room, seat);
  room.state.trays.set('0', true);
  operations.buildTrays(room);
  const center = room.trayCenterFor(0);
  const dice = [0.35, 0.45, 0.55, 0.4].map((halfExtent, index) => {
    const body = new CANNON.Body({ mass: 1 });
    body.addShape(new CANNON.Box(new CANNON.Vec3(halfExtent, halfExtent, halfExtent)));
    body.position.set(center.x, 1, center.z);
    body.velocity.set(2, 3, 4);
    body.angularVelocity.set(1, 2, 3);
    body.__traySeat = 0;
    room.world.addBody(body);
    room.bodies.set(`mine-${index}`, body);
    room.state.pieces.set(`mine-${index}`, { type: 'die' });
    return body;
  });
  const other = new CANNON.Body({ mass: 1 });
  other.addShape(new CANNON.Box(new CANNON.Vec3(0.4, 0.4, 0.4)));
  other.position.set(100, 2, 100);
  other.__traySeat = 1;
  room.bodies.set('other', other);
  room.state.pieces.set('other', { type: 'die' });

  assert.equal(scoopTrayDice(room, 0), dice.length);
  assert.deepEqual(vector(other.position), [100, 2, 100]);
  for (const [index, die] of dice.entries()) {
    die.updateAABB();
    assert.ok(die.aabb.lowerBound.y >= 0, 'scooped die rests above the floor');
    assert.equal(die.sleepState, CANNON.Body.SLEEPING);
    assert.deepEqual(vector(die.velocity), [0, 0, 0]);
    assert.deepEqual(vector(die.angularVelocity), [0, 0, 0]);
    for (const otherDie of dice.slice(index + 1)) {
      const distance = Math.hypot(
        die.position.x - otherDie.position.x,
        die.position.z - otherDie.position.z,
      );
      assert.ok(
        distance >= die.boundingRadius + otherDie.boundingRadius + TRAY.scoopGap - 1e-8,
        'scooped colliders do not overlap',
      );
    }
  }
  const settled = dice.map((die) => vector(die.position));
  for (let step = 0; step < 60; step++) room.world.step(1 / 60);
  dice.forEach((die, index) => assert.deepEqual(vector(die.position), settled[index]));
});

test('clearing a seat removes only dice assigned to that personal tray', () => {
  const room = makeRoom();
  const operations = createTrayOperations();
  for (const [id, type, seat] of [
    ['mine', 'die', 1],
    ['other-seat', 'die', 2],
    ['tagged-prop', 'prop', 1],
    ['table-die', 'die', null],
  ]) {
    const body = new CANNON.Body({ mass: 1 });
    body.__traySeat = seat;
    room.world.addBody(body);
    room.bodies.set(id, body);
    room.state.pieces.set(id, { type });
  }

  operations.clearTraySeat(room, 1);

  assert.deepEqual(room.removed, ['mine']);
  assert.deepEqual([...room.state.pieces.keys()], ['other-seat', 'tagged-prop', 'table-die']);
  assert.deepEqual([...room.bodies.keys()], ['other-seat', 'tagged-prop', 'table-die']);
});

test('applying restored seats validates indices and rebuilds without duplicate bodies', () => {
  const room = makeRoom();
  const operations = createTrayOperations();
  room.state.trays.set('7', true);

  operations.applyTrays(room, [0, '2', 2, -1, 8, 'bad']);

  assert.deepEqual(
    [...room.state.trays.entries()],
    [
      ['0', true],
      ['2', true],
    ],
  );
  assert.equal(room._trayBounds.length, 12);
  const firstBuild = [...room._trayBounds];

  operations.applyTrays(room, null);

  assert.equal(room.state.trays.size, 0);
  assert.equal(room._trayBounds.length, 0);
  assert.ok(firstBuild.every((body) => !room.world.bodies.includes(body)));
});

test('tray rebuilding is safe before the room piece-body map exists', () => {
  const room = makeRoom();
  delete room.bodies;
  room.state.trays.set('4', true);

  createTrayOperations().buildTrays(room);

  assert.equal(room._trayBounds.length, 6);
});
