// Phase 1 grid primitives — pure, so they're unit-testable with no server/DOM.
// Run: `node --test`  (Node's built-in runner; no dependencies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridActive, snapToCell } from '../shared/pieces.js';

test('gridActive: true only for a real style + positive cell', () => {
  assert.equal(gridActive({ gridStyle: 'square', cellWorld: 1 }), true);
  assert.equal(gridActive({ gridStyle: 'hex', cellWorld: 2 }), true); // exists for rendering, even pre-hex-snap
  assert.equal(gridActive({ gridStyle: 'off', cellWorld: 1 }), false);
  assert.equal(gridActive({ gridStyle: 'square', cellWorld: 0 }), false);
  assert.equal(gridActive({}), false);
  assert.equal(gridActive(), false);
});

test('snapToCell (square, cell=1): centres sit at ±0.5, ±1.5 …', () => {
  const sc = { gridStyle: 'square', cellWorld: 1 };
  assert.deepEqual(snapToCell(0.5, 0.5, sc), { x: 0.5, z: 0.5 }); // a centre stays put
  assert.deepEqual(snapToCell(0.7, 0.2, sc), { x: 0.5, z: 0.5 }); // pulls to nearest centre
  assert.deepEqual(snapToCell(0.99, 1.2, sc), { x: 0.5, z: 1.5 });
  assert.deepEqual(snapToCell(-0.3, -0.3, sc), { x: -0.5, z: -0.5 }); // negative side
  assert.deepEqual(snapToCell(1.0, 0.0, sc), { x: 1.5, z: 0.5 }); // exact boundary rounds up
});

test('snapToCell (square, cell=2): centres at ±1, ±3 …', () => {
  const sc = { gridStyle: 'square', cellWorld: 2 };
  assert.deepEqual(snapToCell(0, 0, sc), { x: 1, z: 1 });
  assert.deepEqual(snapToCell(1, 1, sc), { x: 1, z: 1 });
  assert.deepEqual(snapToCell(2.9, -4.1, sc), { x: 3, z: -5 }); // -4.1 is nearer centre -5 than -3
});

test('snapToCell: non-round cell size lands on exact multiples (no float dust)', () => {
  const sc = { gridStyle: 'square', cellWorld: 1.5 }; // e.g. table width ÷ N
  const { x } = snapToCell(2.0, 0, sc);
  assert.equal(x, 2.25); // centre = 0.75 + 1.5 = 2.25, exact
  assert.equal(Number.isInteger(x * 100), true); // no 2.2500000001 dust
});

test('snapToCell (cross anchor): snaps to line crossings, not cell centres (go)', () => {
  const sc = { gridStyle: 'square', cellWorld: 1, snapAnchor: 'cross' };
  assert.deepEqual(snapToCell(0, 0, sc), { x: 0, z: 0 }); // a crossing sits on the origin line
  assert.deepEqual(snapToCell(0.4, -0.4, sc), { x: 0, z: 0 }); // pulls to the nearest crossing
  assert.deepEqual(snapToCell(0.6, 1.9, sc), { x: 1, z: 2 });
  // same point, the two anchors disagree by half a cell (centres vs crossings)
  const center = snapToCell(0.2, 0.2, { gridStyle: 'square', cellWorld: 1, snapAnchor: 'center' });
  const cross = snapToCell(0.2, 0.2, { gridStyle: 'square', cellWorld: 1, snapAnchor: 'cross' });
  assert.deepEqual(center, { x: 0.5, z: 0.5 });
  assert.deepEqual(cross, { x: 0, z: 0 });
});

test('snapToCell (rectangular): X and Z snap on independent spacings (go board)', () => {
  const sc = { gridStyle: 'square', cellWorld: 0.4, cellZ: 0.5, snapAnchor: 'cross' };
  assert.deepEqual(snapToCell(0.79, 0.99, sc), { x: 0.8, z: 1.0 }); // x→nearest 0.4, z→nearest 0.5
  assert.deepEqual(snapToCell(0.3, 0.3, sc), { x: 0.4, z: 0.5 }); // different spacing pulls x and z apart
  // cellZ ≤ 0 falls back to the width (square)
  assert.deepEqual(
    snapToCell(0.79, 0.79, { gridStyle: 'square', cellWorld: 0.4, cellZ: 0, snapAnchor: 'cross' }),
    { x: 0.8, z: 0.8 },
  );
});

test('snapToCell: hex / off / zero-cell are identity (safe to always call)', () => {
  assert.deepEqual(snapToCell(3.3, -1.7, { gridStyle: 'hex', cellWorld: 2 }), { x: 3.3, z: -1.7 });
  assert.deepEqual(snapToCell(3.3, -1.7, { gridStyle: 'off', cellWorld: 2 }), { x: 3.3, z: -1.7 });
  assert.deepEqual(snapToCell(3.3, -1.7, { gridStyle: 'square', cellWorld: 0 }), {
    x: 3.3,
    z: -1.7,
  });
  assert.deepEqual(snapToCell(3.3, -1.7, {}), { x: 3.3, z: -1.7 });
});
