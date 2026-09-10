import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLibraryOperations } from '../server/game/library.js';

const data = (value) => `data:image/png;base64,${value}`;

function harness() {
  const calls = [];
  const db = {
    async insertDeck(record) {
      calls.push(['insertDeck', record]);
    },
  };
  const operations = createLibraryOperations({
    db,
    saveImageRef(value, kind) {
      calls.push(['saveImageRef', value, kind]);
      return value.includes('invalid') ? null : `/assets/${kind}/${calls.length}.png`;
    },
  });
  const room = {
    deckCards: new Map(),
    state: { pieces: new Map() },
    isAdmin(client) {
      return !!client.auth?.isAdmin && !client.auth.revoked;
    },
  };
  return { calls, db, operations, room };
}

const client = ({ admin = false } = {}) => ({
  auth: { isAdmin: admin },
  sent: [],
  send(type, payload) {
    this.sent.push([type, payload]);
  },
});

test('saving a table deck normalizes its name and stores inline art through the injected writer', async () => {
  const { calls, operations, room } = harness();
  room.state.pieces.set('deck', {
    type: 'deck',
    props: JSON.stringify({ back: data('back') }),
  });
  room.deckCards.set('deck', ['ace', data('front'), data('invalid')]);

  assert.equal(await operations.saveDeckById(room, 'deck', '  Saved deck  ', 'owner'), true);
  assert.deepEqual(calls, [
    ['saveImageRef', data('back'), 'decks'],
    ['saveImageRef', data('front'), 'decks'],
    ['saveImageRef', data('invalid'), 'decks'],
    [
      'insertDeck',
      {
        name: 'Saved deck',
        back: '/assets/decks/1.png',
        fronts: ['ace', '/assets/decks/2.png', data('invalid')],
        ownerId: 'owner',
      },
    ],
  ]);
});

test('invalid table decks and empty names do not write library records', async () => {
  const { calls, operations, room } = harness();
  room.state.pieces.set('card', { type: 'card', props: '{}' });
  room.deckCards.set('card', ['ace']);
  room.state.pieces.set('deck', { type: 'deck', props: '{}' });
  room.deckCards.set('deck', []);
  assert.equal(await operations.saveDeckById(room, 'missing', 'name'), false);
  assert.equal(await operations.saveDeckById(room, 'card', 'name'), false);
  assert.equal(await operations.saveDeckById(room, 'deck', 'name'), false);
  room.deckCards.set('deck', ['ace']);
  assert.equal(await operations.saveDeckById(room, 'deck', '   '), false);
  assert.deepEqual(calls, []);
});

test('asset listings map every kind to its database reader and client message', async () => {
  const { db, operations, room } = harness();
  const kinds = {
    deck: ['listDecks', 'deckList'],
    board: ['listBoards', 'boardList'],
    prop: ['listProps', 'propList'],
    scene: ['listScenes', 'sceneList'],
    sky: ['listSkyboxes', 'skyList'],
    dice: ['listDice', 'diceList'],
    mat: ['listMats', 'matList'],
  };
  const reads = [];
  for (const [kind, [method, message]] of Object.entries(kinds)) {
    db[method] = async (options) => {
      reads.push([method, options]);
      return [kind];
    };
    const user = client();
    assert.equal(await operations.sendAssetList(room, user, kind), true);
    assert.deepEqual(user.sent, [[message, [kind]]]);
  }
  assert.deepEqual(
    reads,
    Object.values(kinds).map(([method]) => [method, { includePrivate: false }]),
  );
});

test('private asset results are suppressed if admin access is lost during the read', async () => {
  for (const change of ['revoke', 'demote', 'unchanged']) {
    const { db, operations, room } = harness();
    let finishRead;
    let readOptions;
    db.listDecks = (options) => {
      readOptions = options;
      return new Promise((resolve) => (finishRead = resolve));
    };
    const user = client({ admin: true });
    const pending = operations.sendAssetList(room, user, 'deck');
    assert.deepEqual(readOptions, { includePrivate: true });
    if (change === 'revoke') user.auth.revoked = true;
    if (change === 'demote') user.auth.isAdmin = false;
    finishRead([{ privateData: true }]);
    assert.equal(await pending, change === 'unchanged');
    assert.equal(user.sent.length, change === 'unchanged' ? 1 : 0);
  }
});

test('revoked clients and unknown asset kinds fail without a database read', async () => {
  const { operations, room } = harness();
  const revoked = client();
  revoked.auth.revoked = true;
  assert.equal(await operations.sendAssetList(room, revoked, 'deck'), false);
  assert.equal(await operations.sendAssetList(room, client(), 'unknown'), false);
});

test('library database failures propagate to the existing safe message boundary', async () => {
  const { db, operations, room } = harness();
  room.state.pieces.set('deck', { type: 'deck', props: '{}' });
  room.deckCards.set('deck', ['ace']);
  db.insertDeck = async () => {
    throw new Error('insert unavailable');
  };
  db.listDecks = async () => {
    throw new Error('list unavailable');
  };
  await assert.rejects(operations.saveDeckById(room, 'deck', 'name'), /insert unavailable/);
  await assert.rejects(operations.sendAssetList(room, client(), 'deck'), /list unavailable/);
});
