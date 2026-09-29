import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoQueries, DEMO_STORAGE_LIMITS } from '../server/demo-queries.js';

const valid = { displayName: 'Alex', sessionHash: 'a'.repeat(64), inviteHash: 'b'.repeat(64) };

test('demo query boundary rejects malformed names, credentials, IDs and starters before I/O', async () => {
  const demo = createDemoQueries({
    connect() {
      assert.fail('invalid input must not acquire a connection');
    },
    query() {
      assert.fail('invalid input must not issue a query');
    },
  });
  for (const displayName of [null, {}, '', '   ', 'a'.repeat(21), 'Alex\nAdmin']) {
    await assert.rejects(demo.createTable({ ...valid, displayName }), { code: 'invalid' });
    await assert.rejects(demo.joinInvite({ ...valid, displayName }), { code: 'invalid' });
  }
  for (const badHash of [null, {}, '', 'raw secret', 'a'.repeat(63), 'A'.repeat(64)]) {
    await assert.rejects(demo.createTable({ ...valid, sessionHash: badHash }), { code: 'invalid' });
    await assert.rejects(demo.joinInvite({ ...valid, inviteHash: badHash }), { code: 'invalid' });
    await assert.rejects(demo.resume(badHash), { code: 'invalid' });
    await assert.rejects(demo.rotateInvite({ ...valid, inviteHash: badHash }), { code: 'invalid' });
  }
  await assert.rejects(demo.createTable({ ...valid, starter: '__proto__' }), { code: 'invalid' });
  await assert.rejects(demo.createTable({ ...valid, inviteHash: valid.sessionHash }), {
    code: 'invalid',
  });
  for (const roomId of [
    null,
    {},
    1,
    '0',
    '-1',
    '1;DELETE',
    '1'.repeat(20),
    '9223372036854775808',
  ]) {
    await assert.rejects(demo.setOccupied(roomId, true), { code: 'invalid' });
    await assert.rejects(demo.purgeClosed(roomId), { code: 'invalid' });
  }
  await assert.rejects(demo.setOccupied('1', 'true'), { code: 'invalid' });
});

test('demo storage limits fail closed on invalid operator configuration', () => {
  for (const key of Object.keys(DEMO_STORAGE_LIMITS)) {
    for (const value of [undefined, 0, -1, 1.5, Infinity, '5'])
      assert.throws(
        () => createDemoQueries({}, { ...DEMO_STORAGE_LIMITS, [key]: value }),
        /Invalid demo storage limit/,
      );
  }
});

test('demo transaction failures propagate and roll back/release rather than returning empty success', async () => {
  for (const operation of [
    (demo) => demo.createTable(valid),
    (demo) => demo.joinInvite(valid),
    (demo) => demo.rotateInvite(valid),
    (demo) => demo.setOccupied('1', true),
    (demo) => demo.closeExpired(),
    (demo) => demo.purgeClosed('1'),
    (demo) => demo.purgeOrphans(),
  ]) {
    const calls = [];
    const failure = new Error('database unavailable');
    const demo = createDemoQueries({
      async connect() {
        return {
          async query(sql) {
            calls.push(sql);
            if (sql !== 'BEGIN' && sql !== 'ROLLBACK' && !sql.includes('pg_advisory_xact_lock'))
              throw failure;
            return { rows: [] };
          },
          release() {
            calls.push('RELEASE');
          },
        };
      },
    });
    await assert.rejects(operation(demo), (error) => error === failure);
    assert.deepEqual(calls.slice(-2), ['ROLLBACK', 'RELEASE']);
    assert.equal(calls.includes('COMMIT'), false);
  }
  const demo = createDemoQueries({
    async query() {
      throw new Error('read failure');
    },
  });
  await assert.rejects(demo.resume(valid.sessionHash), /read failure/);
});
