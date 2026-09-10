import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeckBuilders } from '../server/game/deck-builders.js';
import { LETTER_DIST, MAHJONG } from '../shared/pieces.js';

const builders = createDeckBuilders({ shuffle: (cards) => cards });
const counts = (cards) =>
  cards.reduce((result, ref) => {
    result[ref] = (result[ref] || 0) + 1;
    return result;
  }, {});

test('standard decks contain every rank/suit once, with optional red and black jokers', () => {
  const deck = builders.buildSimpleDeck();
  assert.equal(deck.back, 'back');
  assert.equal(deck.cards.length, 52);
  assert.equal(new Set(deck.cards).size, 52);
  for (const [suit, color] of [
    ['♠', '#000000'],
    ['♣', '#000000'],
    ['♥', '#bd2500'],
    ['♦', '#bd2500'],
  ]) {
    for (const rank of ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']) {
      assert.ok(deck.cards.includes(`rank:${rank}:${suit}:${color}`));
    }
  }
  assert.deepEqual(builders.buildSimpleDeck(true).cards, [
    ...deck.cards,
    'joker:#bd2500',
    'joker:#1a1a1a',
  ]);
});

test('domino inventory includes all 28 unordered double-six pairs and its skin', () => {
  const { cards, ...props } = builders.buildDominoSet();
  assert.deepEqual(props, { back: 'domback', tile: 'domino', deckModel: 'bag' });
  assert.equal(cards.length, 28);
  assert.equal(new Set(cards).size, 28);
  for (let a = 0; a <= 6; a++)
    for (let b = a; b <= 6; b++) assert.ok(cards.includes(`domino:${a}:${b}`));
});

test('letter inventory preserves configured counts, scores, blanks, and grid behavior', () => {
  const { cards, ...props } = builders.buildScrabbleBag();
  assert.deepEqual(props, { back: 'lback', tile: 'letter', snap: true, deckModel: 'bag' });
  assert.equal(cards.length, 100);
  const actual = counts(cards);
  const expected = Object.fromEntries(
    Object.entries(LETTER_DIST).map(([letter, [count, value]]) => [
      `letter:${letter}:${value}`,
      count,
    ]),
  );
  assert.deepEqual(actual, expected);
  assert.equal(actual['letter::0'], 2);
});

test('Mahjong inventory contains 144 tiles with four copies of ordinary faces and single bonuses', () => {
  const { cards, ...props } = builders.buildMahjongWall();
  assert.deepEqual(props, { back: 'mjback', tile: 'mahjong', deckModel: 'bag' });
  assert.equal(cards.length, 144);
  const actual = counts(cards);
  const expected = {};
  for (const suit of MAHJONG.suits)
    for (let rank = 1; rank <= 9; rank++) expected[`${MAHJONG.base}${suit}${rank}.png`] = 4;
  for (const honor of MAHJONG.honors) expected[`${MAHJONG.base}${honor}.png`] = 4;
  for (const bonus of MAHJONG.bonus) expected[`${MAHJONG.base}${bonus}.png`] = 1;
  assert.deepEqual(actual, expected);
});

test('each builder shuffles a fresh inventory exactly once and uses the returned order', () => {
  const calls = [];
  const shuffled = createDeckBuilders({
    shuffle: (cards) => {
      calls.push([...cards]);
      return [...cards].reverse();
    },
  });
  for (const name of Object.keys(builders)) {
    const before = calls.length;
    const first = shuffled[name]();
    assert.equal(calls.length, before + 1);
    assert.deepEqual(first.cards, [...builders[name]().cards].reverse());
    first.cards.length = 0;
    const second = shuffled[name]();
    assert.deepEqual(second.cards, [...builders[name]().cards].reverse());
  }
});
