import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLibraryQueries } from '../server/library-queries.js';

test('successful empty library queries remain ordinary empty and not-found results', async () => {
  const library = createLibraryQueries(async () => ({ rows: [] }));
  assert.deepEqual(await library.listDecks(), []);
  assert.deepEqual(await library.listBoards(), []);
  assert.deepEqual(await library.listProps(), []);
  assert.deepEqual(await library.listScenes(), []);
  assert.deepEqual(await library.listSkyboxes(), []);
  assert.equal(await library.getDeck('1'), null);
  assert.equal(await library.getBoard('1'), null);
  assert.equal(await library.getScene('1'), null);
});

test('library query failures reject instead of masquerading as empty results', async () => {
  const outage = new Error('database unavailable');
  const library = createLibraryQueries(async () => { throw outage; });
  for (const read of [
    () => library.listDecks(), () => library.getDeck('1'),
    () => library.listBoards(), () => library.getBoard('1'),
    () => library.listProps(), () => library.listScenes(),
    () => library.getScene('1'), () => library.listSkyboxes(),
  ]) await assert.rejects(read, (error) => error === outage);
});

test('library rows retain their public API shapes', async () => {
  const rows = [{ id: 7, name: 'Cards', count: '2', first: 'ace', back: null, is_public: true, owner_id: 3 }];
  const library = createLibraryQueries(async () => ({ rows }));
  assert.deepEqual(await library.listDecks(), [{
    id: '7', name: 'Cards', count: 2, first: 'ace', back: 'back', isPublic: true, ownerId: '3',
  }]);
});
