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
  assert.equal((tableRoom.match(/tableMessage\('/g) || []).length, 12); // +reorderHand (§8)
});
