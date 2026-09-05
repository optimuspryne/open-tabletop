// Table shape outline — pure geometry, shared by the walls (server), the felt mesh and the grid
// clip (client), so it must agree for all three. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tableOutline, TABLE_SHAPES } from '../shared/pieces.js';

const hx = 10,
  hz = 7,
  S3 = Math.sqrt(3),
  near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const radius = (p) => Math.hypot(p.x, p.z);

test('TABLE_SHAPES lists the five shapes with rect first', () => {
  assert.deepEqual(TABLE_SHAPES, ['rect', 'round', 'oval', 'hex', 'roundedRect']);
});

test('rect outline is the four half-extent corners', () => {
  const p = tableOutline('rect', hx, hz);
  assert.equal(p.length, 4);
  assert.ok(p.every((c) => near(Math.abs(c.x), hx) && near(Math.abs(c.z), hz)));
});

test('unknown shape falls back to rect', () => {
  assert.deepEqual(tableOutline('blob', hx, hz), tableOutline('rect', hx, hz));
});

test('round outline: bounded segment count, every point on radius hx', () => {
  const p = tableOutline('round', hx, hz);
  assert.ok(p.length >= 24 && p.length <= 96);
  assert.ok(p.every((c) => near(radius(c), hx, 1e-9)));
});

test('oval outline: every point on the ellipse (x/hx)^2+(z/hz)^2=1', () => {
  const p = tableOutline('oval', hx, hz);
  assert.ok(p.every((c) => near((c.x / hx) ** 2 + (c.z / hz) ** 2, 1, 1e-9)));
});

test('hex outline: 6 points on radius hx, flat-top (flat edges facing ±Z)', () => {
  const p = tableOutline('hex', hx, hz);
  assert.equal(p.length, 6);
  assert.ok(p.every((c) => near(radius(c), hx)));
  // two vertices share z = +hx·√3/2 (the top flat edge) and two share z = -hx·√3/2
  const top = p.filter((c) => near(c.z, (hx * S3) / 2, 1e-3)).length;
  const bot = p.filter((c) => near(c.z, (-hx * S3) / 2, 1e-3)).length;
  assert.equal(top, 2);
  assert.equal(bot, 2);
});

test('roundedRect outline: inside the bounds and reaching both extents', () => {
  const p = tableOutline('roundedRect', hx, hz);
  assert.ok(p.every((c) => Math.abs(c.x) <= hx + 1e-9 && Math.abs(c.z) <= hz + 1e-9));
  assert.ok(p.some((c) => near(Math.abs(c.x), hx)) && p.some((c) => near(Math.abs(c.z), hz)));
});

test('round ignores depth (uses hx); oval does not', () => {
  assert.deepEqual(tableOutline('round', hx, 3), tableOutline('round', hx, hz)); // hz irrelevant
  assert.notDeepEqual(tableOutline('oval', hx, 3), tableOutline('oval', hx, hz));
});
