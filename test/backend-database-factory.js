import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../server/database.js';

function fakePool(responses = []) {
  const calls = [];
  let responseIndex = 0;
  const client = {
    async query(sql, params) {
      calls.push({ target: 'client', sql, params });
      return responses[responseIndex++] || { rows: [], rowCount: 0 };
    },
    release() {
      calls.push({ target: 'client', operation: 'release' });
    },
  };
  return {
    calls,
    async query(sql, params) {
      calls.push({ target: 'pool', sql, params });
      return responses[responseIndex++] || { rows: [], rowCount: 0 };
    },
    async connect() {
      calls.push({ target: 'pool', operation: 'connect' });
      return client;
    },
    async end() {
      calls.push({ target: 'pool', operation: 'end' });
    },
  };
}

test('database operations use only their injected pool', async () => {
  const firstPool = fakePool([{ rows: [{ id: 1, name: 'First', count: 0 }] }]);
  const secondPool = fakePool([{ rows: [{ id: 2, name: 'Second', count: 0 }] }]);
  const first = createDatabase(firstPool);
  const second = createDatabase(secondPool);

  assert.equal((await first.listDecks())[0].name, 'First');
  assert.equal((await second.listDecks())[0].name, 'Second');
  assert.equal(firstPool.calls.length, 1);
  assert.equal(secondPool.calls.length, 1);
});

test('database writes and shutdown delegate to the injected pool', async () => {
  const pool = fakePool([{ rows: [{ id: 12 }] }]);
  const database = createDatabase(pool);

  assert.equal(await database.insertSkybox({ name: 'Night', url: '/sky/night.jpg' }), '12');
  assert.match(pool.calls[0].sql, /INSERT INTO custom_skyboxes/);
  assert.deepEqual(pool.calls[0].params, ['Night', '/sky/night.jpg', null, false]);

  await database.close();
  assert.deepEqual(pool.calls.at(-1), { target: 'pool', operation: 'end' });
});

test('transactional operations acquire and release from the injected pool', async () => {
  const pool = fakePool([
    { rows: [], rowCount: 0 },
    { rows: [{ users: 0, admins: 0 }], rowCount: 1 },
    {
      rows: [{ id: 7, username: 'admin', email: 'admin@example.com', is_admin: true }],
      rowCount: 1,
    },
    { rows: [], rowCount: 0 },
  ]);
  const database = createDatabase(pool);

  const result = await database.bootstrapAdmin({
    username: 'admin',
    email: 'admin@example.com',
    passwordHash: 'hash',
  });

  assert.equal(result.status, 'created');
  assert.deepEqual(
    pool.calls.filter(({ target, sql }) => target === 'client' && sql).map(({ sql }) => sql),
    [
      'BEGIN',
      "SELECT pg_advisory_xact_lock(hashtext('open-tabletop:admin-bootstrap'))",
      'SELECT count(*)::int AS users, count(*) FILTER (WHERE is_admin)::int AS admins FROM users',
      `INSERT INTO users (username, email, password_hash, is_admin, host_status)
       VALUES ($1,$2,$3,true,'approved') RETURNING *`,
      'COMMIT',
    ],
  );
  assert.deepEqual(pool.calls.at(-1), { target: 'client', operation: 'release' });
});
