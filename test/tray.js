// Dice tray — the shared geometry (pure) plus cannon-es containment checks. Personal trays:
// one per seat, each at its seat angle; a die belongs to its seat's tray. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as CANNON from 'cannon-es';
import {
  TRAY,
  trayCenter,
  trayParts,
  trayPlace,
  inTray,
  dieR,
  SEAT_ANGLES,
  seatAngle,
} from '../shared/pieces.js';

// Build seat N's tray as static bodies in `world` (mirrors the server's buildTrays for one seat).
function buildSeatTray(world, seat, tableX, tableZ, mat) {
  const angle = seatAngle(seat),
    center = trayCenter(angle, tableX, tableZ);
  const spin = new CANNON.Quaternion();
  spin.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), angle);
  for (const part of trayParts()) {
    const b = new CANNON.Body({ mass: 0, material: mat });
    b.addShape(new CANNON.Box(new CANNON.Vec3(part.hx, part.hy, part.hz)));
    const p = trayPlace(part, center, angle);
    b.position.set(p.x, p.y, p.z);
    b.quaternion.copy(spin);
    world.addBody(b);
  }
  return { angle, center };
}

test('trayCenter: rides a circle of radius max(tableX,tableZ)+margin', () => {
  const c0 = trayCenter(0, 10, 7); // angle 0 → +Z
  assert.ok(Math.abs(c0.x) < 1e-9);
  assert.ok(Math.abs(c0.z - (10 + TRAY.margin)) < 1e-9);
  const c90 = trayCenter(Math.PI / 2, 10, 7); // angle 90° → +X
  assert.ok(Math.abs(c90.x - (10 + TRAY.margin)) < 1e-9);
  assert.ok(Math.abs(c90.z) < 1e-9);
});

test('trayParts: a floor (top at y=0) + four walls + an invisible lid', () => {
  const parts = trayParts();
  assert.equal(parts.length, 6);
  const floor = parts[0];
  assert.ok(Math.abs(floor.y + floor.hy - 0) < 1e-9, 'floor top sits at y=0');
  const walls = parts.slice(1, 5);
  assert.ok(
    walls.every((w) => Math.abs(w.y - TRAY.wall) < 1e-9),
    'walls stand on the floor',
  );
  const lid = parts[5];
  assert.equal(lid.noMesh, true, 'the lid is physics-only (never drawn)');
  assert.ok(
    Math.abs(lid.y - lid.hy - 2 * TRAY.wall) < 1e-9,
    'lid bottom sits flush with the wall tops',
  );
});

test('trayPlace / inTray: the tray centre is inside; the table centre is not', () => {
  for (const angle of [0, 0.7, Math.PI, 2.5]) {
    const c = trayCenter(angle, 10, 7);
    assert.equal(inTray(c.x, c.z, c, angle), true, 'centre is inside');
    // The table origin is a full track-radius away — must never count as "in the tray".
    assert.equal(inTray(0, 0, c, angle), false, 'table centre is outside');
    // A point just past a corner of the footprint is outside.
    const corner = trayPlace({ x: TRAY.hx + TRAY.thick + 0.5, y: 0, z: 0 }, c, angle);
    assert.equal(inTray(corner.x, corner.z, c, angle), false, 'past the wall is outside');
  }
});

test('inTray round-trips trayPlace for interior points at any angle', () => {
  for (const angle of [0, 1.1, 3.9, 5.7]) {
    const c = trayCenter(angle, 12, 9);
    for (const [lx, lz] of [
      [0, 0],
      [1.5, -1],
      [-2, 1.5],
      [TRAY.hx - 0.1, TRAY.hz - 0.1],
    ]) {
      const w = trayPlace({ x: lx, y: 0.3, z: lz }, c, angle);
      assert.equal(inTray(w.x, w.z, c, angle), true, `local (${lx},${lz}) @${angle}`);
    }
  }
});

test('physics: a die dropped into the walled tray stays contained', () => {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });
  world.broadphase = new CANNON.NaiveBroadphase();
  const angle = 0.8,
    center = trayCenter(angle, 10, 7);
  const spin = new CANNON.Quaternion();
  spin.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), angle);
  for (const part of trayParts()) {
    // build the tray exactly as the server does
    const b = new CANNON.Body({ mass: 0 });
    b.addShape(new CANNON.Box(new CANNON.Vec3(part.hx, part.hy, part.hz)));
    const p = trayPlace(part, center, angle);
    b.position.set(p.x, p.y, p.z);
    b.quaternion.copy(spin);
    world.addBody(b);
  }
  const r = dieR(6); // a d6-sized cube die
  const die = new CANNON.Body({ mass: 1 });
  die.addShape(new CANNON.Box(new CANNON.Vec3(r, r, r)));
  const start = trayPlace({ x: 0.4, y: 1.6, z: -0.3 }, center, angle);
  die.position.set(start.x, start.y, start.z);
  die.velocity.set(3, 2, -2); // a lateral toss toward a wall
  world.addBody(die);
  for (let i = 0; i < 240; i++) world.step(1 / 60); // ~4s to settle

  assert.equal(
    inTray(die.position.x, die.position.z, center, angle, 0.2),
    true,
    'die stayed within the walls',
  );
  assert.ok(
    die.position.y > -0.1 && die.position.y < 2 * TRAY.wall + 1,
    'die rests on the floor, not through it or over the wall',
  );
});

test('physics: a "Roll all" of several tray dice keeps them all in the tray', () => {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });
  world.broadphase = new CANNON.NaiveBroadphase();
  const angle = 2.1,
    center = trayCenter(angle, 12, 8);
  const spin = new CANNON.Quaternion();
  spin.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), angle);
  for (const part of trayParts()) {
    const b = new CANNON.Body({ mass: 0 });
    b.addShape(new CANNON.Box(new CANNON.Vec3(part.hx, part.hy, part.hz)));
    const p = trayPlace(part, center, angle);
    b.position.set(p.x, p.y, p.z);
    b.quaternion.copy(spin);
    world.addBody(b);
  }
  const R = { up: 8, spread: 13, spin: 30 }; // SIM.trayRoll
  const r = dieR(20),
    dice = [];
  for (let i = 0; i < 5; i++) {
    // a handful of d20-sized dice
    const d = new CANNON.Body({ mass: 1 });
    d.addShape(new CANNON.Box(new CANNON.Vec3(r, r, r)));
    const p = trayPlace({ x: (i - 2) * 0.8, y: 0.6 + i * 0.2, z: 0 }, center, angle);
    d.position.set(p.x, p.y, p.z);
    d.velocity.set(Math.sin(i * 9) * R.spread, R.up, Math.cos(i * 7) * R.spread); // deterministic pseudo-spread
    d.angularVelocity.set(R.spin, R.spin, R.spin);
    world.addBody(d);
    dice.push(d);
  }
  for (let i = 0; i < 300; i++) world.step(1 / 60); // ~5s to settle after the toss

  for (const d of dice) {
    assert.equal(
      inTray(d.position.x, d.position.z, center, angle, 0.3),
      true,
      'a rolled die stayed in the tray',
    );
    assert.ok(d.position.y < 2 * TRAY.wall + 1.2, 'a rolled die did not leap the wall');
  }
});

test('seatAngle: six distinct seat angles, out of range → 0', () => {
  assert.equal(SEAT_ANGLES.length, 6);
  assert.equal(seatAngle(0), 0);
  assert.equal(new Set(SEAT_ANGLES).size, 6, 'every seat faces a different way');
  assert.equal(seatAngle(99), 0, 'unknown seat falls back to 0');
});

test("personal trays: two seats' dice each stay in their OWN tray", () => {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });
  world.broadphase = new CANNON.NaiveBroadphase();
  const tableX = 10,
    tableZ = 7;
  const a = buildSeatTray(world, 2, tableX, tableZ); // right seat (+X)
  const b = buildSeatTray(world, 4, tableX, tableZ); // front-right seat
  const R = { up: 8, spread: 13, spin: 30 };
  const r = dieR(20);
  const make = (frame, i) => {
    const d = new CANNON.Body({ mass: 1 });
    d.addShape(new CANNON.Box(new CANNON.Vec3(r, r, r)));
    const p = trayPlace({ x: (i - 1) * 1.2, y: 0.7, z: 0 }, frame.center, frame.angle);
    d.position.set(p.x, p.y, p.z);
    d.velocity.set(Math.sin(i * 5) * R.spread, R.up, Math.cos(i * 3) * R.spread);
    d.angularVelocity.set(R.spin, R.spin, R.spin);
    world.addBody(d);
    return d;
  };
  const aDice = [0, 1, 2].map((i) => make(a, i));
  const bDice = [0, 1, 2].map((i) => make(b, i));
  for (let i = 0; i < 300; i++) world.step(1 / 60);
  for (const d of aDice)
    assert.equal(
      inTray(d.position.x, d.position.z, a.center, a.angle, 0.3),
      true,
      "seat-2 die stayed in seat 2's tray",
    );
  for (const d of bDice)
    assert.equal(
      inTray(d.position.x, d.position.z, b.center, b.angle, 0.3),
      true,
      "seat-4 die stayed in seat 4's tray",
    );
  // and they never wandered into each other's tray
  for (const d of aDice)
    assert.equal(
      inTray(d.position.x, d.position.z, b.center, b.angle, 0.3),
      false,
      "seat-2 die did not end up in seat 4's tray",
    );
});
