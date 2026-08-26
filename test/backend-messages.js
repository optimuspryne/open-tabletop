import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundedString, boundedUniqueIds, finiteNumber, finitePosition, groupIds, groupRecolor, groupRotation, isPlainObject } from '../server/message-validation.js';
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

test('shared payload primitives reject coercion, exotic objects, and out-of-range values', () => {
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject(Object.create(null)), true);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject(new Date()), false);
  assert.equal(boundedString('piece', { min: 1, max: 5 }), 'piece');
  assert.equal(boundedString('too-long', { max: 5 }), null);
  assert.equal(finiteNumber(3, { min: 0, max: 4 }), 3);
  assert.equal(finiteNumber('3', { min: 0, max: 4 }), null);
});

test('group id payloads are bounded, unique server piece ids', () => {
  assert.deepEqual(boundedUniqueIds(['1', '20']), ['1', '20']);
  assert.deepEqual(groupIds({ ids: ['1', '20'] }), ['1', '20']);
  for (const message of [
    null, {}, { ids: [] }, { ids: ['1', '1'] }, { ids: [1] }, { ids: ['piece'] },
    { ids: ['1'], unexpected: true }, { ids: Array.from({ length: 81 }, (_, i) => String(i)) },
  ]) assert.equal(groupIds(message), null);
});

test('group rotation accepts one bounded angle or an explicit direction', () => {
  assert.deepEqual(groupRotation({ ids: ['1'], dir: -1 }), { ids: ['1'], dir: -1 });
  assert.deepEqual(groupRotation({ ids: ['1'], angle: 0.5 }), { ids: ['1'], angle: 0.5 });
  for (const message of [
    { ids: ['1'] }, { ids: ['1'], dir: 0 }, { ids: ['1'], angle: NaN },
    { ids: ['1'], angle: Math.PI + 0.1 }, { ids: ['1'], dir: 1, angle: 0.5 },
  ]) assert.equal(groupRotation(message), null);
});

test('group recolor accepts integer colors or a team, never mixed inputs', () => {
  assert.deepEqual(groupRecolor({ ids: ['1'], color: 0x123456, textColor: 0xffffff }),
    { ids: ['1'], color: 0x123456, textColor: 0xffffff });
  assert.deepEqual(groupRecolor({ ids: ['1'], team: 0 }), { ids: ['1'], team: 0 });
  for (const message of [
    { ids: ['1'] }, { ids: ['1'], color: '#123456' }, { ids: ['1'], color: 1.5 },
    { ids: ['1'], color: 0x1000000 }, { ids: ['1'], team: true },
    { ids: ['1'], team: 1, color: 0 },
  ]) assert.equal(groupRecolor(message), null);
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
