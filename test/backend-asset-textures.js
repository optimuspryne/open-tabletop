import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import express from 'express';
import {
  createAssetTextureRouter,
  createTexturePrebuilder,
  createTextureDerivative,
  prebuildTextureCache,
  textureAssetPaths,
} from '../server/http/routes/asset-textures.js';
import { assetThumbnailURL } from '../public/rendering/asset-texture-url.js';

test('texture HTTP route isolates thumbnail sizes and caches while preserving the original', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'open-tabletop-thumb-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  await fs.promises.mkdir(path.join(root, 'decks'));
  const original = await sharp({
    create: { width: 1800, height: 2520, channels: 4, background: '#4a78c980' },
  })
    .png()
    .toBuffer();
  const filename = '0123456789abcdefab.png';
  await fs.promises.writeFile(path.join(root, 'decks', filename), original);
  const app = express();
  const bundledAssetsDir = path.join(root, 'bundled');
  await fs.promises.mkdir(path.join(bundledAssetsDir, 'sky'), { recursive: true });
  const skySource = path.join(bundledAssetsDir, 'sky', 'test.png');
  await fs.promises.writeFile(skySource, original);
  app.use(createAssetTextureRouter({ assetsDir: root, assetKinds: ['decks'], bundledAssetsDir }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/asset-textures/v1/decks/${filename}.webp`;
  for (const [quality, height] of [
    ['thumbnail', 320],
    ['standard', 768],
    ['high', 1536],
    ['invalid', 768],
  ]) {
    const responses = await Promise.all([
      fetch(`${url}?quality=${quality}`),
      fetch(`${url}?quality=${quality}`),
    ]);
    const buffers = await Promise.all(
      responses.map(async (response) => {
        assert.equal(response.status, 200);
        assert.match(response.headers.get('cache-control'), /immutable/);
        return Buffer.from(await response.arrayBuffer());
      }),
    );
    assert.deepEqual(buffers[0], buffers[1]);
    const metadata = await sharp(buffers[0]).metadata();
    assert.equal(metadata.height, height);
    assert.equal(metadata.hasAlpha, true);
  }
  assert.deepEqual(await fs.promises.readFile(path.join(root, 'decks', filename)), original);
  assert.equal(
    (await fetch(url.replace('/decks/', '/unknown/') + '?quality=thumbnail')).status,
    404,
  );
  assert.equal((await fetch(url.replace(filename, 'bad.png') + '?quality=thumbnail')).status, 404);
  const skyURL = `http://127.0.0.1:${server.address().port}${assetThumbnailURL('/sky/test.png')}`;
  const sky = await fetch(skyURL);
  assert.equal(sky.status, 200);
  assert.equal(sky.headers.get('cache-control'), 'public, no-cache');
  const skyBytes = Buffer.from(await sky.arrayBuffer());
  assert.equal((await sharp(skyBytes).metadata()).height, 320);
  await sharp({ create: { width: 700, height: 350, channels: 4, background: '#ffffff' } })
    .png()
    .toFile(skySource);
  // Ensure a deterministic newer timestamp even on a filesystem with coarse mtime resolution.
  const later = new Date(Date.now() + 2000);
  await fs.promises.utimes(skySource, later, later);
  const refreshed = await fetch(skyURL);
  const metadata = await sharp(Buffer.from(await refreshed.arrayBuffer())).metadata();
  assert.equal(metadata.width, 320);
  assert.equal(metadata.height, 160);
  for (const ref of [
    'sky/../test.png',
    'sky/%2e%2e/test.png',
    'models/test.png',
    '/sky/test.png',
  ]) {
    assert.equal(
      textureAssetPaths(root, ['decks'], 'bundled', ref + '.webp', 'thumbnail', bundledAssetsDir),
      null,
    );
  }
});

test('textureAssetPaths accepts only allowlisted random-name image derivatives', () => {
  const root = '/srv/assets';
  assert.deepEqual(textureAssetPaths(root, ['decks'], 'decks', '0123456789abcdefab.png.webp'), {
    source: path.resolve(root, 'decks', '0123456789abcdefab.png'),
    cached: path.resolve(root, '.texture-cache', 'v1', 'decks', '0123456789abcdefab.png.webp'),
  });
  assert.equal(textureAssetPaths(root, ['decks'], 'sky', '0123456789abcdefab.png.webp'), null);
  assert.equal(textureAssetPaths(root, ['decks'], 'decks', '../secret.png.webp'), null);
  assert.equal(textureAssetPaths(root, ['decks'], 'decks', 'deck.json.webp'), null);
  assert.equal(textureAssetPaths(root, ['decks'], 'decks', '0123456789abcdefab.glb.webp'), null);
  assert.deepEqual(
    textureAssetPaths(root, ['decks'], 'decks', '0123456789abcdefab.png.webp', 'high'),
    {
      source: path.resolve(root, 'decks', '0123456789abcdefab.png'),
      cached: path.resolve(
        root,
        '.texture-cache',
        'v1-high',
        'decks',
        '0123456789abcdefab.png.webp',
      ),
    },
  );
});

test('createTextureDerivative bounds dimensions and emits a compact WebP', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'open-tabletop-texture-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.png');
  const destination = path.join(root, 'cache', 'source.png.webp');
  await sharp({
    create: { width: 1200, height: 1142, channels: 4, background: '#4a78c9' },
  })
    .png()
    .toFile(source);

  await createTextureDerivative(source, destination);
  const metadata = await sharp(destination).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 768);
  assert.ok(metadata.height <= 768);
  assert.ok((await fs.promises.stat(destination)).size < (await fs.promises.stat(source)).size);
});

test('createTextureDerivative supports the high-quality card bound', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'open-tabletop-texture-high-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.png');
  const destination = path.join(root, 'cache', 'source.png.webp');
  await sharp({
    create: { width: 1800, height: 2520, channels: 4, background: '#4a78c9' },
  })
    .png()
    .toFile(source);

  await createTextureDerivative(source, destination, 1536);
  const metadata = await sharp(destination).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.height, 1536);
  assert.ok(metadata.width <= 1536);
});

test('prebuildTextureCache creates only missing upload derivatives and preserves originals', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'open-tabletop-prebuild-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  await fs.promises.mkdir(path.join(root, 'decks'), { recursive: true });
  await fs.promises.mkdir(path.join(root, 'boards'), { recursive: true });

  const pngName = '0123456789abcdefab.png';
  const jpgName = 'fedcba9876543210fe.jpg';
  const ignoredName = 'friendly-name.png';
  const pngPath = path.join(root, 'decks', pngName);
  const jpgPath = path.join(root, 'boards', jpgName);
  await sharp({ create: { width: 900, height: 700, channels: 4, background: '#4a78c9' } })
    .png()
    .toFile(pngPath);
  await sharp({ create: { width: 500, height: 800, channels: 3, background: '#c94a4a' } })
    .jpeg()
    .toFile(jpgPath);
  await fs.promises.copyFile(pngPath, path.join(root, 'decks', ignoredName));

  const pngBefore = await fs.promises.readFile(pngPath);
  const jpgBefore = await fs.promises.readFile(jpgPath);
  const cachedJpg = textureAssetPaths(
    root,
    ['decks', 'boards'],
    'boards',
    `${jpgName}.webp`,
  ).cached;
  await createTextureDerivative(jpgPath, cachedJpg);
  const cachedJpgBefore = await fs.promises.readFile(cachedJpg);

  const report = await prebuildTextureCache({
    assetsDir: root,
    assetKinds: ['decks', 'boards'],
    concurrency: 2,
  });

  assert.deepEqual(
    {
      total: report.total,
      processed: report.processed,
      created: report.created,
      skipped: report.skipped,
      failed: report.failed,
    },
    { total: 2, processed: 2, created: 1, skipped: 1, failed: 0 },
  );
  assert.deepEqual(await fs.promises.readFile(pngPath), pngBefore);
  assert.deepEqual(await fs.promises.readFile(jpgPath), jpgBefore);
  assert.deepEqual(await fs.promises.readFile(cachedJpg), cachedJpgBefore);
  const cachedPng = textureAssetPaths(root, ['decks', 'boards'], 'decks', `${pngName}.webp`).cached;
  assert.equal((await sharp(cachedPng).metadata()).format, 'webp');
  await assert.rejects(
    fs.promises.access(path.join(root, '.texture-cache', 'v1', 'decks', `${ignoredName}.webp`)),
  );
});

test('createTexturePrebuilder coalesces concurrent starts and reports completion', async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'open-tabletop-job-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  await fs.promises.mkdir(path.join(root, 'decks'), { recursive: true });
  await sharp({ create: { width: 32, height: 32, channels: 3, background: '#4ac97a' } })
    .png()
    .toFile(path.join(root, 'decks', '001122334455667788.png'));

  const prebuilder = createTexturePrebuilder({ assetsDir: root, assetKinds: ['decks'] });
  assert.equal(prebuilder.status().state, 'idle');
  assert.equal(prebuilder.start().started, true);
  assert.equal(prebuilder.start().started, false);

  while (prebuilder.status().state === 'running') {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(
    {
      state: prebuilder.status().state,
      total: prebuilder.status().total,
      created: prebuilder.status().created,
      failed: prebuilder.status().failed,
    },
    { state: 'complete', total: 1, created: 1, failed: 0 },
  );
});
