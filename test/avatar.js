import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { AVATAR_IMAGE, isBoundedImageDataURL } from '../shared/avatar.js';
import { createRoomsRouter } from '../server/http/routes/rooms.js';

const imageData = (length) => 'data:image/jpeg;base64,'.padEnd(length, 'A');

test('avatar validation accepts larger and legacy images but preserves its size/type boundary', () => {
  assert.ok(isBoundedImageDataURL(imageData(1000)));
  assert.ok(isBoundedImageDataURL(imageData(256 * 1024)));
  assert.ok(isBoundedImageDataURL(imageData(AVATAR_IMAGE.maxDataUrlLength - 1)));
  for (const data of [
    null,
    {},
    42,
    'https://example.com/photo.jpg',
    'data:text/plain;base64,abc',
    imageData(AVATAR_IMAGE.maxDataUrlLength),
  ])
    assert.equal(isBoundedImageDataURL(data), false);
});

test('profile route accepts a large avatar through its JSON parser and rejects oversized data before saving', async (t) => {
  const saved = [];
  const app = express();
  app.use(
    createRoomsRouter({
      db: { setUserAvatar: async (...args) => saved.push(args) },
      requireUser: async () => ({ id: '7' }),
      isBoundedImageDataURL,
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await once(server, 'listening');
  const upload = (data) =>
    fetch(`http://127.0.0.1:${server.address().port}/me/avatar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });
  const data = imageData(AVATAR_IMAGE.maxDataUrlLength - 1);
  const response = await upload(data);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, avatar: data });
  assert.deepEqual(saved, [['7', data]]);
  const rejected = await upload(imageData(AVATAR_IMAGE.maxDataUrlLength));
  assert.equal(rejected.status, 400);
  assert.deepEqual(await rejected.json(), { error: 'invalid image' });
  assert.equal(saved.length, 1);
});
