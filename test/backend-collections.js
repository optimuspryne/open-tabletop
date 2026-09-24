import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectionAllows, collectionPayload } from '../shared/asset-collections.js';
import {
  registerCollectionHandlers,
  invalidateCollections,
} from '../server/game/handlers/collections.js';
import { CollectionError } from '../server/collection-queries.js';

const c = (id, items) => ({ id, items });
test('collection filters use visible union membership and keep hidden members out of Uncollected', () => {
  const groups = [
    c('1', [{ kind: 'deck', id: '1' }]),
    c('2', [
      { kind: 'deck', id: '1' },
      { kind: 'prop', id: '2' },
    ]),
  ];
  assert.equal(collectionAllows(groups, new Set(['1']), 'deck', '1'), true);
  assert.equal(collectionAllows(groups, new Set(['1', '2']), 'deck', '1'), false);
  assert.equal(collectionAllows(groups, new Set(['uncollected']), 'board', '1'), false);
  assert.equal(collectionAllows(groups, new Set(['1', '2']), 'board', '1'), true);
  assert.equal(collectionAllows([], new Set(), 'deck', '1'), true); // inaccessible collections have no effect
});
test('collection payloads reject forged keys, oversized IDs/names/batches and unknown kinds', () => {
  const valid = {
    id: '1',
    revision: 1,
    name: 'Game',
    isPublic: false,
    items: [{ kind: 'deck', id: '1' }],
  };
  assert.equal(collectionPayload({ ...valid, name: '  Game ' }, 'update').name, 'Game');
  assert.equal(
    collectionPayload({ ...valid, items: [...valid.items, ...valid.items] }, 'update').items.length,
    1,
  );
  for (const extra of [
    { id: '9223372036854775808' },
    { id: '01' },
    { revision: 0 },
    { name: 'x'.repeat(81) },
    { items: Array(501).fill(valid.items[0]) },
    { items: [{ kind: 'toString', id: '1' }] },
    { isAdmin: true },
    { items: [{ kind: 'deck', id: '1', private: true }] },
  ])
    assert.equal(collectionPayload({ ...valid, ...extra }, 'update'), null);
});
function harness(db) {
  const handlers = new Map(),
    sent = [],
    errors = [];
  const client = {
    auth: { userId: '1', isAdmin: true, role: 'owner' },
    send: (...args) => sent.push(args),
  };
  const room = {
    clients: [client],
    onMessage: (key, fn) => handlers.set(key, fn),
    isAdmin: (value) => value.auth.isAdmin && !value.auth.revoked,
  };
  const dispose = registerCollectionHandlers(room, {
    db: { collections: db },
    logger: { error: (...args) => errors.push(args) },
  });
  return {
    client,
    sent,
    errors,
    dispose,
    send: (type, payload) => handlers.get(type)(client, payload),
  };
}
test('collection handlers deny non-admin edits and recheck private access after reads', async () => {
  let resolveRead,
    writes = 0;
  const h = harness({
    list: () =>
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    mutate: () => {
      writes++;
    },
  });
  try {
    const pending = h.send('listCollections', { request: 1 });
    h.client.auth.isAdmin = false;
    resolveRead({ collections: [{ name: 'secret' }], next: null });
    await pending;
    assert.equal(h.sent.length, 0);
    await h.send('createCollection', { name: 'forged', isPublic: true });
    assert.equal(writes, 0);
    assert.equal(h.sent.at(-1)[0], 'collectionError');
  } finally {
    h.dispose();
  }
});
test('collection failures remain errors and conflicts do not report success', async () => {
  const h = harness({
    list: async () => {
      throw Error('database offline');
    },
    mutate: async () => {
      throw new CollectionError('Reload your draft');
    },
  });
  try {
    await h.send('listCollections', { request: 1 });
    assert.equal(h.sent.at(-1)[0], 'collectionError');
    assert.equal(h.errors.length, 1);
    await h.send('updateCollection', {});
    assert.equal(h.sent.at(-1)[1].message, 'Reload your draft');
    assert.equal(
      h.sent.some(([type]) => type === 'collectionSaved'),
      false,
    );
  } finally {
    h.dispose();
  }
});
test('collection invalidation spans rooms without leaking content and unsubscribes on disposal', () => {
  const first = harness({}),
    second = harness({});
  try {
    second.client.auth.isAdmin = false;
    invalidateCollections();
    assert.deepEqual(first.sent, [['collectionsChanged', {}]]);
    assert.deepEqual(second.sent, first.sent);
    first.dispose();
    second.client.auth.revoked = true;
    invalidateCollections();
    assert.equal(first.sent.length, 1);
    assert.equal(second.sent.length, 1);
  } finally {
    first.dispose();
    second.dispose();
  }
});
