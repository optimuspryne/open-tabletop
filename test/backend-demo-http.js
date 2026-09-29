import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createDemoRouter } from '../server/http/routes/demo.js';
import { createRequireUser } from '../server/http/auth-context.js';
import { makeToken, hashToken } from '../auth.js';
import { DemoError } from '../server/demo-queries.js';

async function fixture(
  t,
  demo,
  store = {
    async consume() {
      return { allowed: true };
    },
  },
) {
  const app = express();
  app.use(createDemoRouter({ demo, store, makeToken, hashToken }));
  app.use((_error, _req, res, _next) => res.status(500).json({ error: 'internal' }));
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return async (path, body = {}, token = '', extra = {}) => {
    const res = await fetch(origin + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...extra,
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.text(), cache: res.headers.get('Cache-Control') };
  };
}

test('demo HTTP passes only hashed credentials to storage and resumes a live session', async (t) => {
  let created;
  const table = { roomId: '1', code: 'DEMO', expiresAt: new Date().toISOString() };
  const post = await fixture(t, {
    async resume() {
      return null;
    },
    async createTable(value) {
      created = value;
      return table;
    },
  });
  const response = await post('/create', { displayName: 'Ada', starter: 'chess' });
  assert.equal(response.status, 200);
  assert.equal(response.cache, 'no-store');
  const result = JSON.parse(response.body);
  assert.equal(created.sessionHash, hashToken(result.token));
  assert.equal(created.inviteHash, hashToken(result.invite));
  assert.notEqual(result.token, result.invite);
  assert.equal(created.displayName, 'Ada');
  const resume = await fixture(t, {
    async resume(hash) {
      assert.equal(hash, hashToken(result.token));
      return table;
    },
    async createTable() {
      assert.fail('must resume');
    },
  });
  assert.deepEqual(JSON.parse((await resume('/create', {}, result.token)).body), { table });
});

test('demo HTTP rejects malformed invites, hides storage errors and honors throttling', async (t) => {
  const post = await fixture(t, {
    async inspectInvite() {
      throw new DemoError('expired', 'private error');
    },
    async joinInvite() {
      assert.fail('invalid token reached storage');
    },
  });
  assert.equal((await post('/join', { invite: 'bad' })).status, 410);
  assert.deepEqual(JSON.parse((await post('/invite', { invite: makeToken() })).body), {
    code: 'expired',
  });
  assert.equal(
    (await post('/create', {}, '', { Origin: 'https://different.example' })).status,
    403,
  );
  const blocked = await fixture(
    t,
    {},
    {
      async consume() {
        return { allowed: false, retryAfterMs: 1000 };
      },
    },
  );
  assert.equal((await blocked('/create')).status, 429);
});

test('guest tokens cannot call ordinary account/persistent-library HTTP routes', async () => {
  const requireUser = createRequireUser({
    db: {
      async findUserByToken() {
        return { id: '1', isDemo: true };
      },
    },
    hashToken,
  });
  let status;
  const res = {
    status(value) {
      status = value;
      return this;
    },
    json() {},
  };
  assert.equal(await requireUser({ headers: { authorization: 'Bearer demo' } }, res), null);
  assert.equal(status, 403);
});

test('explicit read-only guest template access never permits writes', async () => {
  const requireUser = createRequireUser({
    db: {
      async findUserByToken() {
        return { id: '1', isDemo: true };
      },
    },
    hashToken,
    allowDemoReadOnly: true,
  });
  const res = {
    status() {
      return this;
    },
    json() {},
  };
  assert.equal(
    (await requireUser({ method: 'GET', headers: { authorization: 'Bearer demo' } }, res)).isDemo,
    true,
  );
  for (const method of ['POST', 'PATCH', 'DELETE'])
    assert.equal(
      await requireUser({ method, headers: { authorization: 'Bearer demo' } }, res),
      null,
    );
});
