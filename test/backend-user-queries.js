import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUserQueries } from '../server/user-queries.js';

test('successful absent user reads remain null, empty, and zero', async () => {
  const users = createUserQueries(async (sql) => ({ rows: sql.includes('count(*)') ? [{ n: 0 }] : [] }));
  assert.equal(await users.findUserByLogin('missing'), null);
  assert.equal(await users.findUserByToken('missing-hash'), null);
  assert.equal(await users.findUserById('1'), null);
  assert.deepEqual(await users.listUsers(), []);
  assert.equal(await users.countPendingHosts(), 0);
  assert.deepEqual(await users.roomsOwnedBy('1'), []);
});

test('missing token avoids a database query while a database outage rejects every real read', async () => {
  const outage = new Error('database unavailable');
  let calls = 0;
  const users = createUserQueries(async () => { calls++; throw outage; });
  assert.equal(await users.findUserByToken(''), null);
  assert.equal(calls, 0);
  for (const read of [
    () => users.findUserByLogin('player'), () => users.findUserByToken('hash'),
    () => users.findUserById('1'), () => users.listUsers(),
    () => users.countPendingHosts(), () => users.roomsOwnedBy('1'),
  ]) await assert.rejects(read, (error) => error === outage);
});

test('user reads expose the documented public and authentication shapes', async () => {
  const row = {
    id: 7, username: 'player', email: 'p@example.com', avatar: '', is_admin: false,
    host_status: 'approved', password_hash: 'secret', created_at: 'now',
  };
  const users = createUserQueries(async () => ({ rows: [row] }));
  const login = await users.findUserByLogin('player');
  assert.equal(login.id, '7');
  assert.equal(login.passwordHash, 'secret');
  assert.equal(login.canOwnRooms, true);
  const listed = await users.listUsers();
  assert.equal(listed[0].passwordHash, undefined);
  assert.equal(listed[0].createdAt, 'now');
});
