import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as CANNON from 'cannon-es';
import { createTrayOperations } from '../server/game/trays.js';
import { TRAY, seatAngle, trayCenter, trayParts, trayPlace } from '../shared/pieces.js';

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

  assert.equal(room._trayBounds.length, trayParts().length * 2);
  assert.ok(room.world.bodies.includes(unrelated));
  assert.ok(room.world.bodies.includes(die));
  assert.ok(!room.world.bodies.includes(oldTrayBody));
  assert.equal(room.world.bodies.length, room._trayBounds.length + 2);
  assert.equal(room._trayBounds.filter((body) => body.__traySeat === 0).length, 6);
  assert.equal(room._trayBounds.filter((body) => body.__traySeat === 2).length, 6);
  assert.ok(room._trayBounds.every((body) => body.material === room.world.__mat));

  const center = operations.trayCenterFor(room, 0);
  assert.deepEqual(vector(die.position), [center.x, 1, center.z]);
  assert.deepEqual(vector(die.velocity), [0, 0, 0]);
  assert.deepEqual(vector(die.angularVelocity), [0, 0, 0]);

  const floorPosition = trayPlace(trayParts()[0], center, seatAngle(0));
  assert.deepEqual(vector(room._trayBounds[0].position), [
    floorPosition.x,
    floorPosition.y,
    floorPosition.z,
  ]);

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
  const expected = trayPlace({ x: -(TRAY.hx - 0.7), y: 1.3, z: TRAY.hz - 0.7 }, center, angle);
  assert.deepEqual(operations.trayDropPos(room, seat), [expected.x, expected.y, expected.z]);
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
