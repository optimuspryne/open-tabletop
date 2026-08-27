import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asyncRoute, httpErrorHandler } from '../server/http/async-route.js';
import { clientUser, createRequireUser, createRequireAdmin } from '../server/http/auth-context.js';
import { validEmail, validUsername } from '../server/http/routes/auth.js';

test('asyncRoute forwards rejected promises to Express next', async () => {
  const expected = new Error('database unavailable');
  const wrapped = asyncRoute(async () => {
    throw expected;
  });
  const received = await new Promise((resolve) => wrapped({}, {}, resolve));
  assert.equal(received, expected);
});

test('HTTP error boundary returns a generic 500 response', () => {
  const response = {
    headersSent: false,
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  const original = console.error;
  console.error = () => {};
  try {
    httpErrorHandler(
      new Error('secret database detail'),
      { method: 'GET', originalUrl: '/rooms' },
      response,
      () => {},
    );
  } finally {
    console.error = original;
  }
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { error: 'internal server error' });
});

test('bearer authentication hashes the token and returns its user', async () => {
  const db = {
    findUserByToken: async (digest) => (digest === 'hash:raw-token' ? { id: '7' } : null),
  };
  const requireUser = createRequireUser({ db, hashToken: (token) => `hash:${token}` });
  const response = {
    status() {
      throw new Error('unexpected rejection');
    },
  };
  assert.deepEqual(
    await requireUser({ headers: { authorization: 'Bearer raw-token' } }, response),
    { id: '7' },
  );
});

test('bearer authentication rejects missing and non-Bearer credentials', async () => {
  const db = {
    findUserByToken: async () => {
      throw new Error('DB must not be queried without a token');
    },
  };
  const requireUser = createRequireUser({ db, hashToken: String });
  for (const authorization of [undefined, 'Basic abc', 'bearer token']) {
    const response = {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };
    assert.equal(await requireUser({ headers: { authorization } }, response), null);
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.body, { error: 'not signed in' });
  }
});

test('admin authentication rejects ordinary users and returns administrators', async () => {
  const responses = [];
  const response = {
    status(code) {
      responses.push(code);
      return this;
    },
    json(body) {
      responses.push(body);
      return this;
    },
  };
  const rejectAdmin = createRequireAdmin(async () => ({ id: '1', isAdmin: false }));
  assert.equal(await rejectAdmin({}, response), null);
  assert.deepEqual(responses, [403, { error: 'admin only' }]);

  const admin = { id: '2', isAdmin: true };
  const acceptAdmin = createRequireAdmin(async () => admin);
  assert.equal(await acceptAdmin({}, response), admin);
});

test('public user shape never exposes authentication hashes', () => {
  const result = clientUser({
    id: '1',
    username: 'player',
    email: 'p@example.com',
    avatar: '',
    isAdmin: false,
    canOwnRooms: false,
    hostStatus: 'none',
    hasPassword: true,
    passwordHash: 'secret',
    loginTokenHash: 'secret',
  });
  assert.equal(result.passwordHash, undefined);
  assert.equal(result.loginTokenHash, undefined);
  assert.equal(result.username, 'player');
});

test('signup validators enforce the documented username and email boundaries', () => {
  assert.equal(validUsername('player_1'), true);
  assert.equal(validUsername('ab'), false);
  assert.equal(validUsername('bad name'), false);
  assert.equal(validEmail('player@example.com'), true);
  assert.equal(validEmail('not-an-email'), false);
});
