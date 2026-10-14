import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HAND_FAN_MAX,
  HAND_FAN_GROUP_MAX,
  handFanAppearance,
  handFanGroups,
  handFanCards,
  isHandTile,
} from '../shared/hand-fan.js';

const domino = (front, extra = {}) => ({
  hid: 'private-id',
  tile: 'domino',
  front,
  back: 'domback',
  ...extra,
});
const hex = {
  open: true,
  front: '/assets/decks/SECRET_FRONT.png',
  back: '/assets/decks/SECRET_BACK.png',
  geom: { w: 0.5, h: 0.58, t: 0.06, shape: 'hex', SECRET: 'nested face' },
};

const mixedHand = (counts) =>
  Object.entries(counts).flatMap(([back, count]) =>
    Array.from({ length: count }, (_, i) => ({
      hid: `PRIVATE_${back}_${i}`,
      front: `SECRET_${i}`,
      back,
    })),
  );
const fanFor = (hand, revealed = []) =>
  handFanCards(
    { hand: hand.length, handBack: 'legacy-cover', handFan: JSON.stringify(handFanGroups(hand)) },
    revealed,
  );
const backCounts = (cards) =>
  cards.reduce((counts, card) => {
    if (!card.front) counts[card.back] = (counts[card.back] || 0) + 1;
    return counts;
  }, {});

test('mixed ordinary backs match every held card up to twelve, independent of private order', () => {
  const hand = mixedHand({ '/assets/decks/a.png': 3, '/assets/decks/b.png': 2 });
  assert.deepEqual(backCounts(fanFor(hand)), {
    '/assets/decks/a.png': 3,
    '/assets/decks/b.png': 2,
  });
  assert.deepEqual(fanFor([...hand].reverse()), fanFor(hand));
  assert.ok(!JSON.stringify(handFanGroups(hand)).includes('SECRET'));
  assert.ok(!JSON.stringify(handFanGroups(hand)).includes('PRIVATE'));
  hand.pop();
  assert.deepEqual(backCounts(fanFor(hand)), {
    '/assets/decks/a.png': 3,
    '/assets/decks/b.png': 1,
  });
});

test('large hands use proportional whole slots with stable rounding and no invented cards', () => {
  for (const [counts, expected] of [
    [
      { A: 20, B: 10 },
      { A: 8, B: 4 },
    ],
    [
      { A: 78, B: 26 },
      { A: 9, B: 3 },
    ],
    [
      { A: 9, B: 8, C: 7 },
      { A: 5, B: 4, C: 3 },
    ],
    [{ A: 99, B: 1 }, { A: 12 }],
  ]) {
    const hand = mixedHand(counts),
      cards = fanFor(hand);
    assert.equal(cards.length, HAND_FAN_MAX);
    assert.deepEqual(backCounts(cards), expected);
    assert.deepEqual(cards, fanFor([...hand].reverse()));
    for (const [back, count] of Object.entries(backCounts(cards))) assert.ok(count <= counts[back]);
  }
  const hand = mixedHand(
    Object.fromEntries(Array.from({ length: 13 }, (_, i) => [String(i), i === 12 ? 100 : 1])),
  );
  assert.equal(handFanGroups(hand).length, 13); // slot cap must not truncate group weights
  assert.equal(backCounts(fanFor(hand))['12'], 11);
  const overflow = mixedHand(
    Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`back-${i}`, i === 149 ? 100 : 1])),
  );
  assert.ok(handFanGroups(overflow).some((group) => group.props.back === 'back-149'));
  assert.equal(fanFor(overflow).length, HAND_FAN_MAX);
});

test('Show subtracts the matching back before sampling the remaining concealed hand', () => {
  const hand = mixedHand({ A: 20, B: 10 });
  const shown = hand.slice(0, 4).map((card) => ({ ...card, open: false }));
  const fan = fanFor(hand, shown);
  assert.deepEqual(fan.slice(0, 4), shown);
  assert.deepEqual(backCounts(fan), { A: 5, B: 3 }); // 16:10 split across the remaining eight slots
  assert.ok(fan.slice(4).every((card) => !card.front));
  const exact = mixedHand({ A: 3, B: 2 }),
    b = exact.at(-1);
  assert.deepEqual(backCounts(fanFor(exact, [{ ...b, open: false }])), { A: 3, B: 1 });
  assert.deepEqual(backCounts(fanFor(exact)), { A: 3, B: 2 }); // Stop Show
});

test('double-sided artwork remains covered even when its reverse matches an ordinary back', () => {
  const ordinary = { front: 'SECRET_ORDINARY', back: 'shared-back' };
  const open = { front: 'SECRET_OPEN', back: 'shared-back', open: true };
  const cards = fanFor([ordinary, open], [{ ...open }]);
  assert.deepEqual(cards[1], { back: 'shared-back' });
  const other = fanFor([ordinary, open], [{ ...ordinary, open: false }]);
  assert.deepEqual(other[1], { fanCover: true });
  assert.equal(handFanAppearance({ ...hex, back: 'SECRET_REVERSE' }).back, undefined);
  assert.equal(handFanAppearance({ kind: 'notecard', back: 'SECRET_NOTECARD' }).back, undefined);
  assert.equal(handFanAppearance({ back: { front: 'SECRET' } }).back, undefined);
  assert.equal(handFanAppearance({ back: 'x'.repeat(513) }).back, undefined);
});

test('fan projection contains only canonical shape, normalized material, and neutral cover', () => {
  const props = handFanAppearance({
    ...hex,
    drawing: 'private drawing',
    model: 'private model',
    textBoxes: [{ text: 'private' }],
  });
  assert.equal(props.fanCover, true);
  assert.equal(props.geom.shape, 'hex');
  assert.equal(props.geom.t, 0.06);
  assert.ok(!JSON.stringify(props).includes('SECRET'));
  assert.deepEqual(Object.keys(props).sort(), ['fanCover', 'geom']);
  assert.deepEqual(
    handFanAppearance({ ...domino('SECRET'), dominoAppearance: { base: 0x123456 } })
      .dominoAppearance,
    { base: 0x123456, inset: 0x000000, finish: 'original' },
  );
  assert.deepEqual(
    handFanAppearance({ geom: { w: Infinity, h: 1 }, tile: 'private-identity' }),
    {},
  );
  assert.deepEqual(handFanAppearance(null), {});
});

test('group descriptions cannot reveal faces, IDs, private hand order, or double-sided backs', () => {
  const hand = [domino('SECRET_ONE'), hex, domino('SECRET_TWO')];
  const first = handFanGroups(hand);
  const second = handFanGroups(
    [...hand].reverse().map((card) => ({
      ...card,
      hid: 'different id',
      front: 'different face',
      ...(card.open ? { back: 'different private reverse face' } : {}),
    })),
  );
  assert.deepEqual(first, second);
  assert.equal(first.find((group) => group.props.tile === 'domino').count, 2);
  for (const forbidden of ['SECRET', 'private-id', 'front', 'model'])
    assert.ok(!JSON.stringify(first).includes(forbidden));
  assert.deepEqual(
    hand.map((card) => card.front),
    ['SECRET_ONE', hex.front, 'SECRET_TWO'],
  );
  assert.ok(
    handFanGroups(Array.from({ length: 200 }, (_, i) => ({ geom: { w: i + 1, h: 1 } }))).length <=
      HAND_FAN_GROUP_MAX,
  );
});

test('revealed slots consume the corresponding public shapes; remaining slots stay concealed', () => {
  const mahjong = { tile: 'mahjong', front: '/mahjong/faces/bam1.png' };
  const hand = [domino('domino:1:2'), hex, mahjong];
  const p = { hand: hand.length, handBack: 'back', handFan: JSON.stringify(handFanGroups(hand)) };
  const cards = handFanCards(p, [mahjong]);
  assert.equal(cards.length, hand.length);
  assert.deepEqual(cards[0], mahjong);
  assert.equal(cards.filter((card) => card.tile === 'mahjong').length, 1);
  assert.equal(cards.find((card) => card.geom)?.fanCover, true);
  assert.ok(cards.slice(1).every((card) => !card.front && !card.hid));
  const shownHex = { front: hex.front, back: hex.back, geom: hex.geom };
  const customShown = handFanCards(p, [shownHex]);
  assert.equal(customShown.filter((card) => card.geom).length, 1);
});

test('old/malformed descriptions and empty hands preserve the bounded legacy fallback', () => {
  for (const handFan of [
    undefined,
    'bad json',
    '{}',
    JSON.stringify([{ count: -2, props: { tile: 'mahjong' } }]),
  ]) {
    const cards = handFanCards({ hand: 40, handBack: 'blue-back', handFan });
    assert.equal(cards.length, HAND_FAN_MAX);
    assert.ok(cards.every((card) => card.back === 'blue-back' && !card.front));
  }
  const cards = handFanCards({
    hand: 1,
    handFan: JSON.stringify([
      { count: 1, props: { tile: 'domino', front: 'SECRET', model: 'SECRET', hid: 'SECRET' } },
    ]),
  });
  assert.ok(!JSON.stringify(cards).includes('SECRET'));
  const legacy = handFanCards({
    hand: 2,
    handBack: 'blue-back',
    handFan: JSON.stringify([{ count: 2, props: { tile: 'domino' } }]),
  });
  assert.equal(legacy.length, 2);
  assert.ok(legacy.every((card) => card.tile === 'domino' && card.back === 'blue-back'));
  assert.deepEqual(handFanCards({ hand: 0 }, [domino('shown')]), []);
  assert.equal(isHandTile({ geom: { w: 1, h: 1, t: 0.015 } }), false);
  assert.equal(isHandTile(hex), true);
  assert.equal(isHandTile({ tile: 'mahjong' }), true);
  assert.equal(isHandTile({ kind: 'notecard', open: true, geom: hex.geom }), false);
});
