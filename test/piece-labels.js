import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePieceLabels, finiteStockCount, lowStockText } from '../shared/piece-labels.js';

test('label settings bound text and reject invalid or unbounded low-stock settings', () => {
  assert.deepEqual(normalizePieceLabels({ label: '  Ranger\n Alice ', lowStock: null }), {
    label: 'Ranger Alice',
    lowStock: null,
  });
  for (const value of [
    null,
    [],
    { label: 12, lowStock: null },
    { label: 'x'.repeat(61), lowStock: null },
    { label: '', lowStock: { reference: Infinity, percent: 25 } },
    { label: '', lowStock: { reference: 10, percent: 0 } },
    { label: '', lowStock: { reference: 10, percent: 100.1 } },
    { label: '', lowStock: { reference: 10, percent: 25, extra: 1 } },
  ])
    assert.equal(normalizePieceLabels(value), null);
});

test('stock labels appear strictly below the saved percentage and disappear after refill', () => {
  const piece = { type: 'deck', count: 13 };
  const props = { lowStock: { reference: 52, percent: 25 } };
  assert.equal(lowStockText(piece, props), '');
  piece.count = 12;
  assert.equal(lowStockText(piece, props), '12 cards left');
  props.tile = 'mahjong';
  assert.equal(lowStockText(piece, props), '12 tiles left');
  piece.count = 0;
  assert.equal(lowStockText(piece, props), '0 tiles left');
  piece.count = 54;
  assert.equal(lowStockText(piece, props), '');
  assert.equal(props.lowStock.reference, 52);
  assert.equal(finiteStockCount({ type: 'prop', count: 1 }, {}), null);
  assert.equal(finiteStockCount({ type: 'deck', count: NaN }, {}), null);
  assert.equal(finiteStockCount({ type: 'dispenser', count: 0 }, { disp: 'goBowl' }), null);
});
