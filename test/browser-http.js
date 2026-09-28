import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAuthToken, setAuthToken, clearAuthToken } from '../public/auth.js';
import { requestJSON } from '../public/http.js';

function storage(t) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  });
  return values;
}

test('browser requests opt into auth and read the current token for each request', async (t) => {
  const values = storage(t);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    requests.push({ path, ...options });
    return new Response('{"ok":true}');
  });
  assert.equal(getAuthToken(), '');
  setAuthToken('first');
  assert.equal(values.get('tabletop.token'), 'first');
  assert.deepEqual(await requestJSON('/rooms'), { ok: true });
  assert.deepEqual(requests.at(-1), {
    path: '/rooms',
    method: 'GET',
    headers: {},
    body: undefined,
  });
  await requestJSON('/rooms', { auth: true });
  assert.equal(requests.at(-1).headers.Authorization, 'Bearer first');
  // Simulate an account change by another tab, bypassing the setter.
  values.set('tabletop.token', 'second');
  await requestJSON('/rooms', { auth: true });
  assert.equal(requests.at(-1).headers.Authorization, 'Bearer second');
  clearAuthToken();
  assert.equal(values.has('tabletop.token'), false);
  await requestJSON('/rooms', { auth: true });
  assert.equal(requests.at(-1).headers.Authorization, 'Bearer ');
});

test('browser JSON requests retain body, method and empty-response behavior', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    requests.push({ path, ...options });
    return new Response(null, { status: 204 });
  });
  const body = { name: 'Table', requireApproval: false };
  assert.deepEqual(await requestJSON('/rooms/1', { method: 'PATCH', body }), {});
  assert.deepEqual(requests.at(-1), {
    path: '/rooms/1',
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  for (const empty of [undefined, null, false, 0, '']) {
    await requestJSON('/rooms/1', { method: 'POST', body: empty });
    assert.deepEqual(requests.at(-1).headers, {});
    assert.equal(requests.at(-1).body, undefined);
  }
});

test('browser request errors preserve server messages, status fallbacks and network failures', async (t) => {
  const replies = [
    new Response('{"error":"Access revoked"}', { status: 403 }),
    new Response('{}', { status: 404 }),
    new Response('<html>Unavailable</html>', { status: 503 }),
    new Response('not JSON'),
  ];
  t.mock.method(globalThis, 'fetch', async () => replies.shift());
  await assert.rejects(requestJSON('/private'), { message: 'Access revoked' });
  await assert.rejects(requestJSON('/missing'), { message: 'request failed (404)' });
  await assert.rejects(requestJSON('/down'), { message: 'request failed (503)' });
  assert.deepEqual(await requestJSON('/empty'), {});
  const offline = new TypeError('Failed to fetch');
  t.mock.method(globalThis, 'fetch', async () => {
    throw offline;
  });
  await assert.rejects(requestJSON('/offline'), (error) => error === offline);
});
