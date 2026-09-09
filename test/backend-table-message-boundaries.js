import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('every inline TableRoom message uses the shared error boundary', async () => {
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  const tableRoom = source.slice(
    source.indexOf('class TableRoom'),
    source.indexOf('class EditorRoom'),
  );
  assert.equal(tableRoom.includes('this.onMessage('), false);
  assert.equal(tableRoom.includes('assetMessage('), false);
  assert.equal((tableRoom.match(/tableMessage\('/g) || []).length, 8); // placement handlers extracted
});

test('pending library and member lists do not disclose data after access is lost', async () => {
  const { runInNewContext } = await import('node:vm');
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  for (const method of ['sendAssetList', 'sendMembers']) {
    const start = source.indexOf(`  async ${method}(`);
    const end = source.indexOf('\n  }', start) + 4;
    assert.ok(start > 0 && end > start);
    for (const change of ['revoke', 'demote', 'unchanged']) {
      let resolve;
      const read = () => new Promise((done) => (resolve = done));
      const { [method]: deliver } = runInNewContext(`({${source.slice(start, end)}})`, {
        db: { listDecks: read, listMembers: read },
        RANK: { gm: 2 },
      });
      const sent = [];
      const client = { auth: { isAdmin: true, role: 3 }, send: (...args) => sent.push(args) };
      const room = {
        roomId: '1',
        isAdmin: (c) => !c.auth.revoked && c.auth.isAdmin,
        rank: (c) => (c.auth.revoked ? -1 : c.auth.role),
      };
      const pending = deliver.call(room, client, 'deck');
      assert.equal(typeof resolve, 'function');
      if (change === 'revoke') client.auth.revoked = true;
      if (change === 'demote') {
        client.auth.isAdmin = false;
        client.auth.role = 0;
      }
      resolve([{ privateData: true }]);
      await pending;
      assert.equal(sent.length, change === 'unchanged' ? 1 : 0, `${method}: ${change}`);
    }
  }
});
