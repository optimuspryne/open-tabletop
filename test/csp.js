import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('every inline table script is allowed by the enforced CSP', async () => {
  const [html, server] = await Promise.all([
    readFile(new URL('../public/table.html', import.meta.url), 'utf8'),
    readFile(new URL('../server.js', import.meta.url), 'utf8'),
  ]);
  const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .filter((source) => source.trim());

  assert.ok(inlineScripts.length, 'table.html has an inline import map to validate');
  for (const source of inlineScripts) {
    const hash = createHash('sha256').update(source).digest('base64');
    assert.ok(server.includes(`'sha256-${hash}'`), `CSP is missing inline script hash ${hash}`);
  }
});
