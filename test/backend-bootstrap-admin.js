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
        db: {},
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
        db: {},
        hashPassword: async () => 'hash',
        env: { ...validEnv, BOOTSTRAP_ADMIN_USERNAME: 'bad name' },
        readFile: () => 'long-enough-password',
      }),
    /USERNAME/,
  );
  await assert.rejects(
    () =>
      bootstrapAdminFromEnvironment({
        db: {},
        hashPassword: async () => 'hash',
        env: { ...validEnv, BOOTSTRAP_ADMIN_EMAIL: 'invalid' },
        readFile: () => 'long-enough-password',
      }),
    /EMAIL/,
  );
  await assert.rejects(
    () =>
      bootstrapAdminFromEnvironment({
        db: {},
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
