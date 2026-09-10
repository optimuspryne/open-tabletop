import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPieceLifecycle } from '../server/game/piece-lifecycle.js';
import { readProps } from '../server/game/props-codec.js';

const { releasePiece } = createPieceLifecycle({
  deckBuilders: {},
  dropSfx: () => 'drop',
  geoOf: () => ({}),
  sim: { absorb: { x: 1, z: 1 }, cards: { maxThrow: 14 }, throwCap: 40 },
});

function harness(cardProps, deckProps, front = 'new-front') {
  const piece = { type: 'card', props: JSON.stringify(cardProps), owner: 'player' };
  const deck = { type: 'deck', props: JSON.stringify(deckProps), count: 1 };
  const room = {
    state: {
      pieces: new Map([
        ['card', piece],
        ['deck', deck],
      ]),
      scale: {},
    },
    targets: new Map(),
    _released: new Map(),
    bodies: new Map(['card', 'deck'].map((id) => [id, { position: { x: 0, z: 0 }, wakeUp() {} }])),
    deckCards: new Map([['deck', ['old-front']]]),
    cardData: new Map(front ? [['card', { front }]] : []),
    updateDeckCollider() {},
    removePiece(id) {
      this.state.pieces.delete(id);
      this.cardData.delete(id);
    },
  };
  return room;
}

for (const props of [
  { open: true, tile: 'domino' },
  { open: true },
  { geom: { w: 1, h: 1 } },
  { tile: 'letter' },
  { snap: true },
  { back: 'other-back' },
]) {
  test(`incompatible card remains on the table: ${JSON.stringify(props)}`, () => {
    const room = harness({ back: 'blue', ...props }, { back: 'blue' });
    releasePiece(room, 'card');
    assert.equal(room.state.pieces.has('card'), true);
    assert.deepEqual(room.deckCards.get('deck'), ['old-front']);
    assert.equal(room.state.pieces.get('deck').count, 1);
    assert.deepEqual(room.cardData.get('card'), { front: 'new-front' });
  });
}

test('compatible normal cards still absorb their private front', () => {
  const room = harness({ back: 'blue' }, { back: 'blue' });
  releasePiece(room, 'card');
  assert.equal(room.state.pieces.has('card'), false);
  assert.deepEqual(room.deckCards.get('deck'), ['old-front', 'new-front']);
  assert.equal(room.state.pieces.get('deck').count, 2);
});

test('compatible open tiles preserve their individual back and update the cover', () => {
  const room = harness(
    { open: true, tile: 'domino', back: 'own-back', front: 'tile-front' },
    { open: true, tile: 'domino', back: 'shared' },
    null,
  );
  releasePiece(room, 'card');
  assert.equal(room.state.pieces.has('card'), false);
  assert.deepEqual(room.deckCards.get('deck'), [
    'old-front',
    { front: 'tile-front', back: 'own-back' },
  ]);
  assert.equal(readProps(room.state.pieces.get('deck')).cover, 'own-back');
});

test('a card without recoverable front data is not consumed', () => {
  const room = harness({ back: 'blue' }, { back: 'blue' }, null);
  releasePiece(room, 'card');
  assert.equal(room.state.pieces.has('card'), true);
  assert.deepEqual(room.deckCards.get('deck'), ['old-front']);
});
