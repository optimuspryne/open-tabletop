import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HAND_FAN_MAX,
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
      back: 'different back',
    })),
  );
  assert.deepEqual(first, second);
  assert.equal(first.find((group) => group.props.tile === 'domino').count, 2);
  for (const forbidden of ['SECRET', 'private-id', 'front', 'back', 'model'])
    assert.ok(!JSON.stringify(first).includes(forbidden));
  assert.deepEqual(
    hand.map((card) => card.front),
    ['SECRET_ONE', hex.front, 'SECRET_TWO'],
  );
  assert.ok(
    handFanGroups(Array.from({ length: 100 }, (_, i) => ({ geom: { w: i + 1, h: 1 } }))).length <=
      HAND_FAN_MAX,
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
  assert.deepEqual(handFanCards({ hand: 0 }, [domino('shown')]), []);
  assert.equal(isHandTile({ geom: { w: 1, h: 1, t: 0.015 } }), false);
  assert.equal(isHandTile(hex), true);
  assert.equal(isHandTile({ tile: 'mahjong' }), true);
  assert.equal(isHandTile({ kind: 'notecard', open: true, geom: hex.geom }), false);
});
