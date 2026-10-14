import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapAdminFromEnvironment } from '../server/bootstrap-admin.js';

const validEnv = {
  BOOTSTRAP_ADMIN_USERNAME: 'site_admin',
  BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
  BOOTSTRAP_ADMIN_PASSWORD_FILE: '/run/secrets/admin_password',
};

test('admin bootstrap is disabled when no provisioning variables are present', async () => {
  let called = false;
  const result = await bootstrapAdminFromEnvironment({
    db: {
      hasUsers: async () => false,
      bootstrapAdmin: async () => {
        called = true;
      },
    },
    hashPassword: async () => 'hash',
    env: {},
  });
  assert.deepEqual(result, { status: 'disabled' });
  assert.equal(called, false);
});

test('partial bootstrap configuration fails closed', async () => {
  await assert.rejects(
    () =>
      bootstrapAdminFromEnvironment({
        db: { hasUsers: async () => false },
        hashPassword: async () => 'hash',
        env: { BOOTSTRAP_ADMIN_USERNAME: 'admin' },
      }),
    /requires BOOTSTRAP_ADMIN_USERNAME/,
  );
});

test('bootstrap validates identity and requires a strong password', async () => {
  await assert.rejects(
    () =>
      bootstrapAdminFromEnvironment({
        db: { hasUsers: async () => false },
        hashPassword: async () => 'hash',
        env: { ...validEnv, BOOTSTRAP_ADMIN_USERNAME: 'bad name' },
        readFile: () => 'long-enough-password',
      }),
    /USERNAME/,
  );
  await assert.rejects(
    () =>
      bootstrapAdminFromEnvironment({
        db: { hasUsers: async () => false },
        hashPassword: async () => 'hash',
        env: { ...validEnv, BOOTSTRAP_ADMIN_EMAIL: 'invalid' },
        readFile: () => 'long-enough-password',
      }),
    /EMAIL/,
  );
  await assert.rejects(
    () =>
      bootstrapAdminFromEnvironment({
        db: { hasUsers: async () => false },
        hashPassword: async () => 'hash',
        env: validEnv,
        readFile: () => 'too-short',
      }),
    /at least 12/,
  );
});

test('bootstrap reads the secret file, hashes it, and passes no plaintext to the database', async () => {
  let hashed;
  let provisioned;
  const result = await bootstrapAdminFromEnvironment({
    db: {
      hasUsers: async () => false,
      bootstrapAdmin: async (record) => {
        provisioned = record;
        return { status: 'created' };
      },
    },
    hashPassword: async (password) => {
      hashed = password;
      return 'password-hash';
    },
    env: validEnv,
    readFile: (path, encoding) => {
      assert.equal(path, '/run/secrets/admin_password');
      assert.equal(encoding, 'utf8');
      return 'long-random-password\n';
    },
  });
  assert.equal(hashed, 'long-random-password');
  assert.deepEqual(provisioned, {
    username: 'site_admin',
    email: 'admin@example.com',
    passwordHash: 'password-hash',
  });
  assert.deepEqual(result, { status: 'created' });
});

test('existing users bypass all bootstrap configuration and credential access', async () => {
  const unexpected = () => assert.fail('bootstrap credentials must not be accessed');
  const result = await bootstrapAdminFromEnvironment({
    db: { hasUsers: async () => true, bootstrapAdmin: unexpected },
    env: new Proxy({}, { get: unexpected }),
    readFile: unexpected,
    hashPassword: unexpected,
  });
  assert.deepEqual(result, { status: 'already-configured' });
});

test('user lookup failure stops startup before accessing bootstrap credentials', async () => {
  const failure = new Error('database unavailable');
  await assert.rejects(
    bootstrapAdminFromEnvironment({
      db: {
        hasUsers: async () => {
          throw failure;
        },
      },
      env: new Proxy({}, { get: () => assert.fail('credentials accessed') }),
    }),
    (error) => error === failure,
  );
});

test('empty database still rejects a missing bootstrap password file', async () => {
  const failure = Object.assign(new Error('missing password file'), { code: 'ENOENT' });
  await assert.rejects(
    bootstrapAdminFromEnvironment({
      db: { hasUsers: async () => false },
      env: validEnv,
      readFile: () => {
        throw failure;
      },
      hashPassword: () => assert.fail('must not hash a missing password'),
    }),
    (error) => error === failure,
  );
});

test('provisioning retains the database race check after an empty preflight', async () => {
  const result = await bootstrapAdminFromEnvironment({
    db: {
      hasUsers: async () => false,
      bootstrapAdmin: async () => ({ status: 'already-configured' }),
    },
    env: validEnv,
    readFile: () => 'long-enough-password',
    hashPassword: async () => 'hash',
  });
  assert.deepEqual(result, { status: 'already-configured' });
});
