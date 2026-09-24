import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createParticipationQueries } from '../server/participation-queries.js';

function harness({
  actorRole = 'gm',
  targetRole = 'player',
  targetAdmin = false,
  failWrite = false,
  afterWrite = () => {},
} = {}) {
  const calls = [];
  const connection = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes('FROM users'))
        return {
          rows: [
            { id: '1', is_admin: false },
            { id: '2', is_admin: targetAdmin },
          ],
        };
      if (sql.includes('FROM room_members'))
        return {
          rows: [
            { user_id: '1', role: actorRole, status: 'admitted' },
            { user_id: '2', role: targetRole, status: 'admitted' },
          ],
        };
      if (sql.startsWith('INSERT')) {
        if (failWrite) throw Error('write failed');
        afterWrite();
        return { rows: [{ timed_out: true, version: 1 }] };
      }
      return { rows: [] };
    },
    release() {
      calls.push('release');
    },
  };
  const db = createParticipationQueries({ connect: async () => connection });
  return { calls, db, request: { roomId: '3', actorId: '1', userId: '2', timedOut: true } };
}

for (const [actorRole, targetRole, allowed] of [
  ['gm', 'player', true],
  ['gm', 'helper', true],
  ['gm', 'gm', false],
  ['owner', 'gm', true],
  ['owner', 'owner', false],
  ['helper', 'player', false],
]) {
  test(`time-out hierarchy ${actorRole} → ${targetRole}`, async () => {
    const h = harness({ actorRole, targetRole });
    const result = await h.db.setPlayerTimeout(h.request, () => true);
    assert.equal(!!result, allowed);
    assert.equal(h.calls.includes('COMMIT'), allowed);
    assert.equal(h.calls.at(-1), 'release');
  });
}

test('self and site-admin restrictions are rejected', async () => {
  for (const self of [true, false]) {
    const h = harness({ targetAdmin: !self });
    if (self) h.request.userId = '1';
    assert.equal(await h.db.setPlayerTimeout(h.request, () => true), null);
    assert.equal(
      h.calls.some((sql) => sql.startsWith('INSERT')),
      false,
    );
  }
});

test('database failure rolls back; live demotion during a write also rolls back', async () => {
  const failed = harness({ failWrite: true });
  await assert.rejects(
    failed.db.setPlayerTimeout(failed.request, () => true),
    /write failed/,
  );
  assert.equal(failed.calls.includes('ROLLBACK'), true);
  let live = true;
  const changed = harness({
    afterWrite: () => {
      live = false;
    },
  });
  assert.equal(await changed.db.setPlayerTimeout(changed.request, () => live), null);
  assert.equal(changed.calls.includes('COMMIT'), false);
  assert.equal(changed.calls.includes('ROLLBACK'), true);
});
