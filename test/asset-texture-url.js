import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetTextureURL, assetThumbnailURL } from '../public/rendering/asset-texture-url.js';

test('all saved image categories and bundled rasters use WebP thumbnail derivatives', () => {
  for (const kind of ['uploads', 'decks', 'dice', 'sky', 'boards', 'mats', 'props']) {
    const ref = `/assets/${kind}/0123456789abcdefab.png`;
    const thumb = assetThumbnailURL(ref);
    assert.equal(thumb, `/asset-textures/v1/${kind}/0123456789abcdefab.png.webp?quality=thumbnail`);
    assert.equal(assetThumbnailURL(thumb), thumb);
  }
  assert.equal(
    assetThumbnailURL('/sky/equirect/cloudy_noon.png'),
    '/asset-textures/v1/bundled/sky%2Fequirect%2Fcloudy_noon.png.webp?quality=thumbnail',
  );
  assert.equal(
    assetThumbnailURL('/mahjong/faces/dragR.png'),
    '/asset-textures/v1/bundled/mahjong%2Ffaces%2FdragR.png.webp?quality=thumbnail',
  );
});

test('unsupported thumbnail refs never fall back to raw source images', () => {
  for (const ref of [
    null,
    undefined,
    '/assets/sky/original.png',
    'https://example.test/image.png',
    'data:image/png;base64,AAAA',
    '/sky/../secret.png',
    '/models/secret.png',
    '/asset-textures/v1/sky/not-an-asset.png.webp?quality=thumbnail',
    '/asset-textures/v1/bundled/sky%2F..%2Fsecret.png.webp?quality=thumbnail',
    '/asset-textures/v1/bundled/%ZZ.webp?quality=thumbnail',
    'data:image/webp;base64,AAAA"junk',
  ])
    assert.equal(assetThumbnailURL(ref), null);
  const generated = 'data:image/webp;base64,AAAA';
  assert.equal(assetThumbnailURL(generated), generated);
});

test('saved asset images use standard WebP derivatives for previews', () => {
  assert.equal(
    assetTextureURL('/assets/decks/0123456789abcdefab.png'),
    '/asset-textures/v1/decks/0123456789abcdefab.png.webp',
  );
});

test('rendered card faces may request the separate high-quality derivative', () => {
  assert.equal(
    assetTextureURL('/assets/uploads/abcdef0123456789ab.jpeg', { high: true }),
    '/asset-textures/v1/uploads/abcdef0123456789ab.jpeg.webp?quality=high',
  );
});

test('library thumbnails use a separate derivative from hand and table images', () => {
  assert.equal(
    assetTextureURL('/assets/decks/0123456789abcdefab.png', { thumbnail: true }),
    '/asset-textures/v1/decks/0123456789abcdefab.png.webp?quality=thumbnail',
  );
});

test('external, data, procedural, and non-random asset references pass through', () => {
  for (const ref of [
    'https://example.test/card.png',
    'data:image/png;base64,AAAA',
    'rank:A:♠:#000',
    '/assets/decks/card.png',
  ]) {
    assert.equal(assetTextureURL(ref), ref);
  }
});
