import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clickRoute } from '../public/clicks.js';

// Mirrors INSPECTABLE in client.js — boards and decks are not inspectable.
const INSPECTABLE = (t) => ['die', 'card', 'prop', 'dispenser'].includes(t);
const route = (type, secondary) => clickRoute(type, secondary, INSPECTABLE(type));
const KINDS = ['die', 'card', 'deck', 'prop', 'dispenser', 'board'];

test('right-click opens the menu for every kind except a card', () => {
  for (const type of KINDS)
    assert.equal(route(type, true), type === 'card' ? 'verb' : 'menu', `right-click ${type}`);
});

test('right-clicking a card still flips it, immediately', () => {
  // 'verb' means the action fires now — a card must not wait on a possible double.
  assert.equal(route('card', true), 'verb');
});

test('a deck no longer defers its right-click', () => {
  // Split used to be double-right-click, so the first right-click had to wait ~250ms to find out.
  // It is a menu item now, so the menu opens on the press with no delay.
  assert.equal(route('deck', true), 'menu');
});

test('left-click still defers where a double means something', () => {
  assert.equal(route('deck', false), 'double'); // deal now, or draw-to-inspect on a double
  assert.equal(route('die', false), 'double'); // inspectable
  assert.equal(route('card', false), 'double'); // inspectable
  assert.equal(route('prop', false), 'double');
  assert.equal(route('dispenser', false), 'double');
});

test('left-click on a board fires straight away', () => {
  assert.equal(route('board', false), 'verb'); // neither inspectable nor a deck
});

test('a kind nobody has added yet still behaves', () => {
  // An unknown kind must not fall into the menu on a left-click or vanish on a right-click.
  assert.equal(clickRoute('token', false, false), 'verb');
  assert.equal(clickRoute('token', true, false), 'menu');
});
