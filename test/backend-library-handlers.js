import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerLibraryHandlers } from '../server/game/handlers/library.js';

const MESSAGE_NAMES = [
  'deckBegin', 'deckAppend', 'deckFinish', 'saveDeck', 'listDecks',
  'loadDeck', 'saveBoard', 'listBoards', 'saveProp', 'listProps',
  'assetPublic', 'assetRename', 'getDeck', 'assetDelete', 'listScenes',
  'sceneSave', 'sceneLoad', 'loadBoard',
  'listSkyboxes', 'saveSkybox',
];

function harness({ admin = true, rank = 3 } = {}) {
  const handlers = new Map();
  const calls = [];
  const db = new Proxy({}, {
    get(target, name) {
      if (!target[name]) target[name] = async (...args) => {
        calls.push({ name, args });
        return null;
      };
      return target[name];
    },
  });
  const room = {
    drafts: new Map(),
    onMessage(name, handler) { handlers.set(name, handler); },
    isAdmin() { return admin; },
    rank() { return rank; },
    spawn(...args) { calls.push({ name: 'spawn', args }); },
    async sendAssetList(...args) { calls.push({ name: 'sendAssetList', args }); },
    async saveDeckById(...args) { calls.push({ name: 'saveDeckById', args }); return true; },
    serializeScene() { return { pieces: [] }; },
    applyScene(...args) { calls.push({ name: 'applyScene', args }); },
    swapBoard(...args) { calls.push({ name: 'swapBoard', args }); },
  };
  registerLibraryHandlers(room, {
    db,
    boardKeys: ['chess'],
    colliders: ['flat'],
    libraryKinds: ['deck', 'board', 'prop', 'scene', 'sky'],
    refOk: (value) => typeof value === 'string' && value.length < 200000,
    sanitizeGeom: (value) => value,
    randomPosition: () => [1, 2, 3],
    sceneMaxBytes: 1000,
    skyUrlOk: (value) => typeof value === 'string' && value.startsWith('/sky/'),
    logger: { error() {} },
  });
  return { room, db, handlers, calls };
}

const client = () => ({
  sessionId: 'session-1',
  auth: { userId: 'user-1' },
  sent: [],
  send(type, payload) { this.sent.push({ type, payload }); },
});

test('library handler module registers the complete asset message family', () => {
  assert.deepEqual([...harness().handlers.keys()], MESSAGE_NAMES);
});

test('deck drafts are assembled in chunks and persisted by the finish handler', async () => {
  const { room, handlers, calls } = harness();
  const user = client();
  await handlers.get('deckBegin')(user, { back: '/back' });
  await handlers.get('deckAppend')(user, { fronts: ['/one', '/two'] });
  await handlers.get('deckFinish')(user, { name: 'Example', spawn: true });

  assert.equal(room.drafts.has(user.sessionId), false);
  assert.deepEqual(calls.find(({ name }) => name === 'spawn').args,
    ['deck', [1, 2, 3], { back: '/back', cards: ['/one', '/two'] }]);
  assert.deepEqual(calls.find(({ name }) => name === 'insertDeck').args[0], {
    name: 'Example', back: '/back', fronts: ['/one', '/two'], geom: null,
    ownerId: 'user-1', isPublic: false,
  });
  assert.equal(calls.at(-1).name, 'sendAssetList');
});

test('non-admin clients cannot curate or inspect private library records', async () => {
  const { handlers, calls } = harness({ admin: false, rank: 1 });
  const user = client();
  await handlers.get('saveBoard')(user, { name: 'Map', board: { board: 'chess' } });
  await handlers.get('assetDelete')(user, { kind: 'deck', id: '1' });
  await handlers.get('getDeck')(user, { id: '1' });
  assert.deepEqual(calls, []);
  assert.deepEqual(user.sent, []);
});

test('database failures use the sanitized asset error boundary', async () => {
  const user = client();
  const failure = harness();
  failure.room.sendAssetList = async () => { throw new Error('database secret'); };
  await failure.handlers.get('listDecks')(user);
  assert.deepEqual(user.sent, [{
    type: 'assetError',
    payload: { operation: 'listDecks', message: 'Library unavailable. Try again.' },
  }]);
});

test('private assets cannot be loaded by non-admin helpers', async () => {
  const { db, handlers, calls } = harness({ admin: false, rank: 1 });
  db.getDeck = async () => ({ isPublic: false, back: '/back', fronts: ['/front'] });
  await handlers.get('loadDeck')(client(), { id: '1' });
  assert.equal(calls.some(({ name }) => name === 'spawn'), false);
});
