import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageExtension, validateGlb } from '../server/assets/upload-validation.js';

test('image format and saved extension come from bytes', () => {
  const jpeg = Buffer.alloc(12); jpeg[0] = 0xFF; jpeg[1] = 0xD8;
  const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]);
  const gif = Buffer.from('GIF89a000000');
  const webp = Buffer.from('RIFF0000WEBP');
  assert.equal(imageExtension(jpeg), 'jpg');
  assert.equal(imageExtension(png), 'png');
  assert.equal(imageExtension(gif), 'gif');
  assert.equal(imageExtension(webp), 'webp');
});

test('image validation rejects unsupported, truncated, and RIFF non-WEBP data', () => {
  assert.equal(imageExtension(Buffer.from('<html>payload')), null);
  assert.equal(imageExtension(Buffer.from([0xFF, 0xD8])), null);
  assert.equal(imageExtension(Buffer.from('RIFF0000WAVE')), null);
});

function glb(json) {
  const body = Buffer.from(JSON.stringify(json));
  const buffer = Buffer.alloc(20 + body.length);
  buffer.writeUInt32LE(0x46546C67, 0);
  buffer.writeUInt32LE(2, 4);
  buffer.writeUInt32LE(buffer.length, 8);
  buffer.writeUInt32LE(body.length, 12);
  buffer.writeUInt32LE(0x4E4F534A, 16);
  body.copy(buffer, 20);
  return buffer;
}

test('GLB validation accepts embedded data and rejects external references', () => {
  assert.deepEqual(validateGlb(glb({ asset: { version: '2.0' }, images: [{ uri: 'data:image/png;base64,AA==' }] })), { ok: true });
  assert.deepEqual(validateGlb(glb({ asset: { version: '2.0' }, images: [{ uri: 'https://example.com/tracker.png' }] })),
    { ok: false, reason: 'model contains an external reference' });
});

test('GLB validation fails closed on malformed headers and JSON', () => {
  assert.equal(validateGlb(Buffer.alloc(4)).ok, false);
  const badMagic = glb({ asset: { version: '2.0' } }); badMagic.writeUInt32LE(0, 0);
  assert.equal(validateGlb(badMagic).reason, 'not a .glb (bad magic)');
  const badJson = glb({}); badJson.fill(0xFF, 20);
  assert.equal(validateGlb(badJson).reason, 'invalid glTF JSON');
});
