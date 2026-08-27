// Built-in content: the one-click starter games. Their layouts are pure data derived from the
// shared piece/board/dispenser tables, so they can be validated without a running room. Run: `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STARTERS, STARTER_LIST, PROPS, BOARDS, DISPENSERS, standMode } from '../shared/pieces.js';

test('STARTER_LIST ids all resolve to a starter definition', () => {
  for (const g of STARTER_LIST) assert.ok(STARTERS[g.id], `missing starter: ${g.id}`);
});

test('chess: 32 valid pieces, 16 per side, one per square', () => {
  const p = STARTERS.chess.pieces();
  assert.equal(p.length, 32);
  assert.equal(p.filter((x) => x.team === 0).length, 16);
  assert.equal(p.filter((x) => x.team === 1).length, 16);
  assert.equal(p.filter((x) => x.shape === 'chess-pawn').length, 16);
  assert.equal(p.filter((x) => x.shape === 'chess-king').length, 2);
  assert.equal(p.filter((x) => x.shape === 'chess-queen').length, 2);
  assert.ok(
    p.every((x) => PROPS[x.shape] && PROPS[x.shape].team === 'chess'),
    'every shape is a chess-team piece',
  );
  assert.ok(
    p.every((x) => x.col >= 0 && x.col < 8 && x.row >= 0 && x.row < 8),
    'all on the board',
  );
  assert.equal(new Set(p.map((x) => x.col + ',' + x.row)).size, 32, 'no two on the same square');
});

test('chess: kings and queens on their correct files', () => {
  const p = STARTERS.chess.pieces();
  const at = (col, row) => p.find((x) => x.col === col && x.row === row).shape;
  assert.equal(at(4, 0), 'chess-king'); // e1
  assert.equal(at(3, 0), 'chess-queen'); // d1
  assert.equal(at(0, 0), 'chess-rook'); // a1
  assert.equal(at(4, 7), 'chess-king'); // e8
});

test('checkers: 24 pieces, 12 per side, dark squares only, none overlapping', () => {
  const p = STARTERS.checkers.pieces();
  assert.equal(p.length, 24);
  assert.equal(p.filter((x) => x.team === 0).length, 12);
  assert.equal(p.filter((x) => x.team === 1).length, 12);
  assert.ok(
    p.every((x) => (x.col + x.row) % 2 === 1),
    'dark squares only',
  );
  assert.ok(
    p.every((x) => x.shape === 'checker'),
    'all checkers',
  );
  assert.ok(
    p.every((x) => x.row < 3 || x.row > 4),
    'the middle two rows are empty',
  );
  assert.equal(new Set(p.map((x) => x.col + ',' + x.row)).size, 24, 'no overlaps');
});

test('go: a valid board and two valid bowl dispensers', () => {
  assert.ok(BOARDS[STARTERS.go.board]);
  assert.ok(STARTERS.go.bowls.every((b) => DISPENSERS[b.disp]));
});

test('poker: a deck flag and valid chip-stack dispensers', () => {
  assert.equal(STARTERS.poker.deck, true);
  assert.ok(STARTERS.poker.stacks.length >= 1);
  assert.ok(STARTERS.poker.stacks.every((s) => DISPENSERS[s.disp]));
});

test('dominoes: a domino set dealt to hands', () => {
  const d = STARTERS.dominoes;
  assert.ok(d, 'dominoes starter exists');
  assert.equal(d.deck.set, 'domino');
  assert.equal(d.deck.deal, 7);
  assert.ok(!d.board, 'dominoes has no board');
  assert.ok(
    STARTER_LIST.some((g) => g.id === 'dominoes'),
    'listed in the Games tab',
  );
});

test('board-based starters reference a real built-in board', () => {
  for (const g of ['chess', 'checkers', 'go']) assert.ok(BOARDS[STARTERS[g].board], `${g} board`);
});

test('standMode: upright pieces stand, discs lie flat, and it always returns a real mode', () => {
  assert.equal(standMode('chess-king'), true); // tall → upright
  assert.equal(standMode('chess-pawn'), true);
  assert.equal(standMode('checker'), 'flat'); // disc → flat
  assert.equal(standMode('go'), 'flat');
  assert.equal(standMode('coin'), 'flat');
  assert.equal(standMode('cylinder'), true); // tall cylinder → upright
  for (const p of PROPS ? Object.keys(PROPS) : []) {
    const m = standMode(p);
    assert.ok(m === true || m === 'flat', `standMode(${p}) is a real mode`);
  }
  assert.equal(standMode('does-not-exist'), true); // no collider → upright default
});

test("the go board pins its printed-line spacing (bordered grid, so it can't derive from the collider)", () => {
  const grid = BOARDS.go.grid;
  assert.equal(grid.anchor, 'cross');
  assert.ok(grid.cellX > 0 && grid.cellZ > 0, 'go grid has explicit cell spacing');
  // The pinned spacing is smaller than collider ÷ gaps (which is why the border made auto-calibration wrong).
  assert.ok(
    grid.cellX < (BOARDS.go.box[0] * 2) / grid.cells,
    'pinned cellX is inside the collider-derived value',
  );
  assert.ok(
    grid.cellZ < (BOARDS.go.box[2] * 2) / grid.cells,
    'pinned cellZ is inside the collider-derived value',
  );
});
