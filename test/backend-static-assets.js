import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm, rename, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { createStaticAssetRouter } from '../server/http/routes/static-assets.js';
import { staticAssetPath, staticAssetMounts } from '../server/static-assets.js';
import { serveDir } from '../scripts/lib/headless.mjs';
import { BOARDS, PROPS, DECK_MODELS, DISPENSERS, DICE_MODELS, MAHJONG } from '../shared/pieces.js';
import { BUILTIN_SKIES } from '../public/table/skybox.js';
import { MUSIC } from '../public/credits.js';

async function start(t, options) {
  const app = express();
  app.use(createStaticAssetRouter(options));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('bundled catalog URLs still serve their assets after the directory move', async (t) => {
  const origin = await start(t);
  const urls = new Set([
    ...[BOARDS, PROPS, DECK_MODELS, DISPENSERS, DICE_MODELS].flatMap((catalog) =>
      Object.values(catalog).flatMap((entry) => (entry.model ? [entry.model] : [])),
    ),
    ...BUILTIN_SKIES.map((entry) => entry.url),
    ...MUSIC.map((entry) => '/music/' + entry.file),
    ...MAHJONG.suits.flatMap((suit) =>
      Array.from({ length: 9 }, (_, i) => `${MAHJONG.base}${suit}${i + 1}.png`),
    ),
    ...[...MAHJONG.honors, ...MAHJONG.bonus].map((face) => `${MAHJONG.base}${face}.png`),
  ]);
  for (const category of ['sounds', 'textures'])
    for (const file of await readdir(staticAssetPath(category))) urls.add(`/${category}/${file}`);
  for (const url of urls) {
    const response = await fetch(origin + url, { method: 'HEAD' });
    assert.equal(response.status, 200, url);
    assert.equal(+response.headers.get('content-length'), (await stat(staticAssetPath(url))).size);
  }
});

test('relocating the configured root preserves public URLs, caching, and audio ranges', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tabletop-static-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = join(root, 'original');
  const relocated = join(root, 'nested', 'renamed-assets');
  for (const directory of Object.values(staticAssetMounts(original)))
    await mkdir(directory, { recursive: true });
  await mkdir(join(original, 'mahjong', 'faces'));
  await writeFile(join(original, 'mahjong', 'faces', 'bam1.png'), 'face');
  for (const category of ['sky', 'textures', 'models', 'music', 'sounds'])
    await writeFile(join(original, category, 'example.ogg'), '0123456789');
  await writeFile(join(original, 'secret.txt'), 'outside the category mount');
  await mkdir(join(root, 'nested'));
  await rename(original, relocated);

  const origin = await start(t, { assetsDir: relocated });
  for (const category of ['sky', 'textures', 'models', 'music', 'sounds']) {
    const response = await fetch(`${origin}/${category}/example.ogg`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '0123456789');
    assert.match(response.headers.get('cache-control'), /max-age=0/);
  }
  const face = await fetch(origin + '/mahjong/faces/bam1.png');
  assert.equal(await face.text(), 'face');
  assert.match(face.headers.get('cache-control'), /max-age=86400/);
  const cached = await fetch(origin + '/mahjong/faces/bam1.png', {
    // Explicit revalidation policy: fetch otherwise adds no-cache for conditional requests,
    // which deliberately makes Express send a fresh 200 response instead of a 304.
    headers: { 'If-None-Match': face.headers.get('etag'), 'Cache-Control': 'max-age=0' },
  });
  assert.equal(cached.status, 304);
  const range = await fetch(origin + '/music/example.ogg', { headers: { Range: 'bytes=2-5' } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(await range.text(), '2345');
  for (const url of ['/models/missing.glb', '/models/%2e%2e%2fsecret.txt', '/secret.txt'])
    assert.equal((await fetch(origin + url)).status, 404, url);
});

test('browser fixtures use the same bundled-asset locations and allow explicit mount overrides', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'tabletop-static-fixture-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'custom.glb'), 'fixture override');
  const server = await serveDir({ root, mounts: { '/models/': root } });
  t.after(() => server.close());
  const face = await fetch(server.origin + MAHJONG.base + 'bam1.png', { method: 'HEAD' });
  assert.equal(face.status, 200);
  const model = await fetch(server.origin + '/models/custom.glb');
  assert.equal(await model.text(), 'fixture override');
  assert.deepEqual(server.missing, []);
});
