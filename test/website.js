import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../website/', import.meta.url));
const pages = [
  'index.html',
  ...(await readdir(resolve(root, 'wiki')))
    .filter((name) => name.endsWith('.html'))
    .map((name) => `wiki/${name}`),
];

test('website pages have working local routes, assets, and fragment targets', async () => {
  for (const page of pages) {
    const source = await readFile(resolve(root, page), 'utf8');
    const ids = [...source.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${page}: duplicate IDs`);
    for (const [, value] of source.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      if (/^https:\/\//.test(value)) continue;
      assert.ok(!/^[a-z]+:|^\/\//i.test(value), `${page}: unexpected URL ${value}`);
      const [pathname, hash] = value.split('#');
      const target = pathname
        ? resolve(dirname(resolve(root, page)), decodeURIComponent(pathname))
        : resolve(root, page);
      assert.ok(
        !relative(root, target).startsWith(`..${sep}`),
        `${page}: link escapes the standalone site: ${value}`,
      );
      assert.ok((await stat(target)).isFile(), `${page}: missing target ${value}`);
      if (hash) {
        const destination = await readFile(target, 'utf8');
        assert.ok(
          destination.includes(`id="${decodeURIComponent(hash)}"`),
          `${page}: missing fragment ${value}`,
        );
      }
    }
  }
});

test('website remains readable without scripts and links to the public demo', async () => {
  for (const page of pages) {
    const source = await readFile(resolve(root, page), 'utf8');
    assert.match(source, /<html lang="en">/, page);
    assert.equal([...source.matchAll(/<h1\b/g)].length, 1, page);
    assert.match(source, /<main id="main"/, page);
    assert.match(source, /class="skip-link" href="#main"/, page);
    assert.doesNotMatch(source, /\bon[a-z]+=|—|–/, page);
    const scripts = [...source.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/g)].map(
      (match) => match[0],
    );
    assert.deepEqual(
      scripts,
      page === 'index.html' ? ['<script type="module" src="showcase.js"></script>'] : [],
      page,
    );
    assert.match(
      source,
      /<a class="demo" href="https:\/\/play\.open-tabletop\.com">Try public demo<\/a>/,
      page,
    );
    assert.doesNotMatch(
      source,
      /Public demo \(coming soon\)|class="demo" aria-disabled="true"/,
      page,
    );
    assert.doesNotMatch(source, /href="#"/, page);
    assert.match(source, /<meta\s+name="description"\s+content="[^"]+"/, page);
    if (page.startsWith('wiki/')) {
      assert.match(source, /<details class="wiki-mobile">/, page);
      assert.match(source, /<nav class="wiki-nav" aria-label="Wiki topics">/, page);
    }
  }
});

test('homepage has a static fallback and seven approved slideshow images', async () => {
  const source = await readFile(resolve(root, 'index.html'), 'utf8');
  assert.match(source, /data-showcase-controls hidden/);
  assert.match(source, /src="assets\/showcase\/chess.png"/);
  assert.match(source, /Chess on your own table\./);
  assert.match(source, /Chess screenshot:[\s\S]*?models by JustinARay/);
  assert.deepEqual(
    [...source.matchAll(/data-src="assets\/showcase\/([^".]+)\.png"/g)].map((m) => m[1]),
    ['chess', 'cards', 'dice', 'go', 'dominoes', 'mahjong', 'wordy'],
  );
  assert.equal([...source.matchAll(/data-alt="[^"]+"/g)].length, 7);
  assert.match(source, /script-src 'self'/);
  assert.doesNotMatch(source, /unsafe-inline|https:[^";]*script/);
});
