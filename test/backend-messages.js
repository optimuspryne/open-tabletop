import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finitePosition } from '../server/message-validation.js';
import { takeTopCard } from '../server/deck-state.js';

test('movement accepts finite numeric coordinates without coercion', () => {
  assert.deepEqual(finitePosition({ x: 1, y: -2.5, z: 0 }), { x: 1, y: -2.5, z: 0 });
  assert.equal(finitePosition({ x: '1', y: 2, z: 3 }), null);
});

test('movement rejects malformed and non-finite payloads', () => {
  for (const value of [null, undefined, {}, { x: NaN, y: 0, z: 0 }, { x: Infinity, y: 0, z: 0 }, { x: 0, y: 0, z: -Infinity }]) {
    assert.equal(finitePosition(value), null);
  }
});

test('drawing mutates deck count and returns cards in stack order', () => {
  const deck = { type: 'deck', count: 2 };
  const cards = ['bottom', 'top'];
  assert.deepEqual(takeTopCard(deck, cards), { front: 'top', empty: false });
  assert.equal(deck.count, 1);
  assert.deepEqual(takeTopCard(deck, cards), { front: 'bottom', empty: true });
  assert.equal(deck.count, 0);
});

test('drawing rejects missing, empty, and non-deck state without mutation', () => {
  const piece = { type: 'card', count: 1 };
  const cards = ['front'];
  assert.equal(takeTopCard(piece, cards), null);
  assert.deepEqual(cards, ['front']);
  assert.equal(takeTopCard({ type: 'deck', count: 0 }, []), null);
  assert.equal(takeTopCard(null, cards), null);
});
