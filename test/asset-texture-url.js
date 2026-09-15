import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetTextureURL } from '../public/asset-texture-url.js';

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
