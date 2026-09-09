import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnTableCard } from '../server/game/card-transfer.js';

for (const open of [false, true]) {
  for (const faceDown of [false, true]) {
    test(`table card placement preserves visibility and geometry: open=${open}, faceDown=${faceDown}`, () => {
      const geo = { tile: 'letter', geom: { w: 2, h: 3 }, snap: true };
      const card = { front: 'front-art', back: 'back-art', open, geo };
      const original = structuredClone(card);
      const position = [1, 2, 3];
      const calls = [];
      const room = {
        cardData: new Map(),
        spawnCardFlat(pos, props) {
          calls.push({ pos, props });
          return 'new-card';
        },
      };
      assert.equal(spawnTableCard(room, position, card, faceDown), 'new-card');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].pos, position);
      assert.deepEqual(calls[0].props, {
        ...geo,
        back: 'back-art',
        ...(open || !faceDown ? { front: 'front-art' } : {}),
        ...(open ? { open: true, ...(faceDown ? { down: true } : {}) } : {}),
      });
      assert.deepEqual(
        [...room.cardData],
        !open && faceDown ? [['new-card', { front: 'front-art' }]] : [],
      );
      assert.deepEqual(card, original, 'placement does not mutate inventory metadata');
    });
  }
}

test('default placement hides a normal front and does not write private data if spawning fails', () => {
  const room = {
    cardData: new Map(),
    spawnCardFlat(position, props) {
      assert.deepEqual(props, { back: 'back' });
      throw new Error('Table piece limit reached');
    },
  };
  assert.throws(
    () => spawnTableCard(room, [0, 4, 0], { front: 'ace', back: 'back' }),
    /piece limit/,
  );
  assert.equal(room.cardData.size, 0);
});

test('hand placement delegates with selected geometry and preserves its face-up default', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  const start = source.indexOf('  spawnHandCard(');
  const end = source.indexOf('\n  }', start) + 4;
  assert.ok(start > 0 && end > start);
  const { spawnHandCard } = runInNewContext(`({${source.slice(start, end)}})`, {
    spawnTableCard,
    geoOf: (card) => ({ snap: card.snap }),
  });
  const room = {
    cardData: new Map(),
    spawnCardFlat(pos, props) {
      this.placed = props;
      return 'card';
    },
  };
  const card = { front: 'ace', back: 'blue', hid: 'private-id', snap: true };
  spawnHandCard.call(room, [0, 1, 0], card);
  assert.deepEqual(room.placed, { snap: true, back: 'blue', front: 'ace' });
  assert.equal(room.cardData.size, 0);
  spawnHandCard.call(room, [0, 1, 0], card, true);
  assert.deepEqual(room.placed, { snap: true, back: 'blue' });
  assert.deepEqual(room.cardData.get('card'), { front: 'ace' });
});
