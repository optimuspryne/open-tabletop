// Card / tile geometry — cardGeom() is the single source both the client mesh and the server
// collider read, so a card's rendered size and physics footprint can't drift. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cardGeom,
  geomFromImage,
  sanitizeGeom,
  sanitizeMatGeom,
  MAT_MAX_HALF,
  TILES,
  KINDS,
  CARD_ROUND,
} from '../shared/pieces.js';

test('cardGeom default = the standard playing card (unchanged behavior)', () => {
  const g = cardGeom({});
  assert.equal(g.hw, KINDS.card.shape.box[0]);
  assert.equal(g.th, KINDS.card.shape.box[1]);
  assert.equal(g.hh, KINDS.card.shape.box[2]);
  assert.equal(g.round, CARD_ROUND);
});

test('cardGeom resolves a named tile kind', () => {
  const d = cardGeom({ tile: 'domino' });
  assert.equal(d.hw, TILES.domino.w);
  assert.equal(d.hh, TILES.domino.h);
  assert.equal(d.th, TILES.domino.t);
  assert.equal(d.hh / d.hw, 2, 'domino is 2:1');
});

test('cardGeom takes an explicit geom (custom uploads / custom-aspect image decks)', () => {
  const g = cardGeom({ geom: { w: 0.9, h: 0.6, t: 0.02, round: 0.05 } });
  assert.deepEqual(g, { hw: 0.9, hh: 0.6, th: 0.02, round: 0.05, shape: 'rect' });
});

test('cardGeom: explicit geom without a thickness/round falls back to card defaults', () => {
  const g = cardGeom({ geom: { w: 1, h: 1 } });
  assert.equal(g.th, TILES.card.t);
  assert.equal(g.round, CARD_ROUND);
});

test('cardGeom priority: explicit geom beats a tile kind', () => {
  const g = cardGeom({ geom: { w: 1, h: 1 }, tile: 'domino' });
  assert.equal(g.hw, 1);
  assert.equal(g.hh, 1);
});

test('cardGeom: unknown tile and invalid geom fall through to the standard card', () => {
  const std = cardGeom({});
  assert.deepEqual(cardGeom({ tile: 'nope' }), std);
  assert.deepEqual(cardGeom({ geom: { w: 0, h: 5 } }), std); // w must be > 0
  assert.deepEqual(cardGeom({ geom: {} }), std);
});

// geomFromImage — size a card/tile to its art's aspect (no crop/stretch).
test('geomFromImage: a standard-proportioned image yields the standard card', () => {
  const g = geomFromImage(500, 700);
  assert.ok(Math.abs(g.w - TILES.card.w) < 0.01 && Math.abs(g.h - TILES.card.h) < 0.01);
});

test('geomFromImage: aspect is preserved for portrait, landscape, and square', () => {
  const wide = geomFromImage(1000, 500); // 2:1
  assert.ok(Math.abs(wide.w / wide.h - 2) < 0.02);
  assert.equal(wide.w, TILES.card.h); // longer side = card length
  const tall = geomFromImage(400, 800); // 1:2
  assert.ok(Math.abs(tall.w / tall.h - 0.5) < 0.02);
  assert.equal(tall.h, TILES.card.h);
  const sq = geomFromImage(600, 600);
  assert.equal(sq.w, sq.h);
});

test('geomFromImage: keeps card thickness + corner radius, and a resulting geom is renderable via cardGeom', () => {
  const g = geomFromImage(300, 900);
  assert.equal(g.t, TILES.card.t);
  assert.equal(g.round, CARD_ROUND);
  const resolved = cardGeom({ geom: g }); // must round-trip through the resolver
  assert.equal(resolved.hw, g.w);
  assert.equal(resolved.hh, g.h);
});

test('sanitizeGeom: accepts sane geoms, rejects junk and out-of-range', () => {
  assert.equal(sanitizeGeom(null), null);
  assert.equal(sanitizeGeom({ w: 0, h: 1 }), null);
  assert.equal(sanitizeGeom({ w: 5, h: 1 }), null); // > 3 half-extent
  assert.deepEqual(sanitizeGeom({ w: 0.75, h: 1.05 }), {
    w: 0.75,
    h: 1.05,
    t: TILES.card.t,
    round: CARD_ROUND,
    shape: 'rect',
  });
  assert.equal(sanitizeGeom({ w: 1, h: 2, t: 0.02, round: 0.1 }).t, 0.02);
});

test('sanitizeMatGeom: a player mat allows a far larger footprint than a card', () => {
  const big = { w: 5, h: 3.2 }; // rejected by the card clamp (> 3 half-extent)
  assert.equal(sanitizeGeom(big), null);
  const mat = sanitizeMatGeom(big);
  assert.equal(mat.w, 5);
  assert.equal(mat.h, 3.2);
  // still bounded — beyond the mat cap is rejected
  assert.equal(sanitizeMatGeom({ w: MAT_MAX_HALF + 1, h: 2 }), null);
  // a mat's geom is renderable/collidable via the shared cardGeom
  const g = cardGeom({ geom: mat });
  assert.equal(g.hw, 5);
  assert.equal(g.hh, 3.2);
});

test('KINDS.mat is a heavy, movable surface (mass > 0)', () => {
  assert.ok(KINDS.mat, 'mat kind exists');
  assert.ok(KINDS.mat.mass > 0, 'movable + selectable + casts shadow');
});
