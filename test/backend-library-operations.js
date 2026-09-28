import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLibraryOperations } from '../server/game/library.js';

function harness() {
  const calls = [];
  const db = {
    async insertDeck(record) {
      calls.push(['insertDeck', record]);
    },
  };
  const operations = createLibraryOperations({ db });
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
  for (const change of ['revoke', 'demote', 'loading', 'unchanged']) {
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
    if (change === 'loading') user.auth.participationReady = false;
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
  db.listDecks = async () => {
    throw new Error('list unavailable');
  };
  await assert.rejects(operations.sendAssetList(room, client(), 'deck'), /list unavailable/);
});
