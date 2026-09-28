import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { passwordError } from '../shared/passwords.js';
import {
  createRecoveryMailer,
  createRecoveryMailQueue,
  recoveryMailConfig,
} from '../server/recovery-mail.js';
import { createAccountSecurityRouter } from '../server/http/routes/account-security.js';
import { createAuthRouter } from '../server/http/routes/auth.js';
import { hashToken, makeToken } from '../auth.js';

test('password confirmation rejects missing, mismatched, short, long and non-string values', () => {
  for (const [password, confirmation] of [
    ['1234567', '1234567'],
    ['12345678', 'bad'],
    ['12345678', undefined],
    ['x'.repeat(129), 'x'.repeat(129)],
    [12345678, 12345678],
  ])
    assert.ok(passwordError(password, confirmation));
  assert.equal(passwordError(' pass phrase ', ' pass phrase '), '');
});

test('SMTP is optional, requires safe origin/TLS, and constructs plain-text fragment links', async () => {
  assert.equal(recoveryMailConfig({}), null);
  assert.equal(createRecoveryMailer({ config: null }).enabled, false);
  const env = {
    SMTP_HOST: 'smtp.example.test',
    SMTP_FROM: 'table@example.test',
    PUBLIC_ORIGIN: 'https://table.example.test',
  };
  for (const extra of [
    { PUBLIC_ORIGIN: 'http://remote.example.test' },
    { PUBLIC_ORIGIN: 'https://table.example.test/evil' },
    { SMTP_PORT: 'bad' },
    { SMTP_USER: 'user' },
    { SMTP_FROM: 'bad\naddress' },
  ])
    assert.throws(() => recoveryMailConfig({ ...env, ...extra }));
  const config = recoveryMailConfig(env);
  assert.equal(config.transport.requireTLS, true);
  assert.equal(config.transport.disableFileAccess, true);
  assert.equal(config.transport.disableUrlAccess, true);
  const sent = [];
  const mailer = createRecoveryMailer({
    config,
    createTransport: () => ({ sendMail: async (message) => sent.push(message) }),
  });
  await mailer.send({ email: 'a@example.test', purpose: 'recover', token: 'fake-token' });
  assert.match(sent[0].text, /https:\/\/table.example.test\/#recover=fake-token/);
  assert.deepEqual(sent[0].to, { address: 'a@example.test' });
  assert.equal(sent[0].html, undefined);
});

test('mail work is bounded and failures log no credentials or recipient data', async () => {
  const logs = [];
  const queue = createRecoveryMailQueue({
    limit: 1,
    logger: { error: (message) => logs.push(message) },
  });
  let release;
  assert.equal(
    queue.enqueue(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    ),
    true,
  );
  assert.equal(
    queue.enqueue(() => assert.fail('over capacity')),
    false,
  );
  await Promise.resolve();
  release();
  await queue.idle();
  queue.enqueue(() => {
    throw new Error('secret-token@example.test');
  });
  await queue.idle();
  assert.deepEqual(logs, ['[recovery-mail] delivery failed']);
});

test('production auth routes validate passwords, gate recovery and rotate live sessions', async (t) => {
  const calls = [];
  const queue = createRecoveryMailQueue({ logger: { error: () => {} } });
  const user = {
    id: '1',
    username: 'test',
    email: 'test@example.test',
    passwordHash: 'old',
    hasPassword: true,
  };
  const db = {
    createUser: async (record) => {
      calls.push(['signup', record]);
      return user;
    },
    accountSecurity: {
      credentials: async () => user,
      setPassword: async (args) => {
        calls.push(['password', args]);
        return user;
      },
      replaceCodes: async (_session, hashes) => {
        calls.push(['codes', hashes]);
        return true;
      },
      issueEmail: async ({ email }) => (email === user.email ? { email } : null),
      exchange: async (args) => {
        calls.push(['exchange', args]);
        return { hasPassword: true };
      },
      recover: async (args) => {
        calls.push(['recover', args]);
        return user;
      },
      discardEmail: async () => {},
    },
  };
  const app = express();
  const rateLimitAuth = (_req, _res, next) => next();
  const roomAccess = { revokeUser: (id) => calls.push(['revoke', id]) };
  const shared = {
    db,
    rateLimitAuth,
    hashPassword: async (value) => `hashed:${value}`,
    verifyPassword: async (value) => value === 'old password',
    makeToken,
    hashToken,
    roomAccess,
  };
  const mailer = { enabled: true, send: async (message) => calls.push(['mail', message]) };
  app.use('/auth', createAuthRouter(shared));
  app.use(
    '/auth',
    createAccountSecurityRouter({
      ...shared,
      mailer,
      mailQueue: queue,
      requireUser: async (req, res) => {
        if (req.headers.authorization === 'Bearer valid') return user;
        res.status(401).json({ error: 'not signed in' });
        return null;
      },
    }),
  );
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  async function request(path, body, signedIn = false) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/auth${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(signedIn ? { Authorization: 'Bearer valid' } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  for (const confirmation of [undefined, 'mismatch'])
    assert.equal(
      (
        await request('/signup', {
          username: 'test',
          email: user.email,
          password: 'new password',
          confirmation,
        })
      ).status,
      400,
    );
  assert.equal(
    (
      await request('/signup', {
        username: 'test',
        email: user.email,
        password: 'new password',
        confirmation: 'new password',
      })
    ).status,
    200,
  );
  assert.equal((await request('/password', {})).status, 401);
  assert.equal(
    (
      await request(
        '/password',
        { password: 'new password', confirmation: 'new password', currentPassword: 'wrong' },
        true,
      )
    ).status,
    403,
  );
  const changed = await request(
    '/password',
    { password: 'new password', confirmation: 'new password', currentPassword: 'old password' },
    true,
  );
  assert.equal(changed.status, 200);
  assert.equal(changed.headers.get('cache-control'), 'no-store');
  assert.equal(changed.body.user.passwordHash, undefined);
  assert.deepEqual(calls.at(-1), ['revoke', user.id]);
  const codes = await request('/recovery/codes', {}, true);
  assert.equal(codes.body.codes.length, 10);
  assert.ok(calls.at(-1)[1].every((digest) => /^[a-f0-9]{64}$/.test(digest)));
  const known = await request('/recovery/request', { email: user.email });
  const unknown = await request('/recovery/request', { email: 'unknown@example.test' });
  assert.deepEqual(known.body, unknown.body);
  await queue.idle();
  assert.equal(calls.filter(([name]) => name === 'mail').length, 1);
  assert.equal((await request('/recovery/exchange', { code: 'bad', login: 'test' })).status, 400);
  const exchanged = await request('/recovery/exchange', {
    code: codes.body.codes[0],
    login: 'test',
  });
  assert.equal(exchanged.body.hasPassword, true);
  const completed = await request('/recovery/complete', {
    grant: exchanged.body.grant,
    password: 'reset password',
    confirmation: 'reset password',
  });
  assert.equal(completed.status, 200);
  assert.deepEqual(calls.at(-1), ['revoke', user.id]);
  mailer.enabled = false;
  assert.equal((await request('/recovery/request', { email: user.email })).status, 503);
});
