import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
  createTextureDerivative,
  textureAssetPaths,
} from '../server/http/routes/asset-textures.js';

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
