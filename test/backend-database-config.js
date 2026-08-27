import { test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseConnectionString } from '../server/database-config.js';

test('complete URL secret takes priority over literal and component configuration', () => {
  const value = databaseConnectionString({
    env: {
      DATABASE_URL_FILE: '/run/secrets/db_url',
      DATABASE_URL: 'postgresql://ignored',
      DATABASE_HOST: 'ignored',
    },
    readFile: (path) => {
      assert.equal(path, '/run/secrets/db_url');
      return 'postgresql://secret-url\n';
    },
  });
  assert.equal(value, 'postgresql://secret-url');
});

test('component configuration reads and safely encodes a password secret', () => {
  const value = databaseConnectionString({
    env: {
      DATABASE_HOST: 'db',
      DATABASE_PORT: '5432',
      DATABASE_NAME: 'tabletop',
      DATABASE_USER: 'tabletop_app',
      DATABASE_PASSWORD_FILE: '/run/secrets/app_db_password',
    },
    readFile: () => 'p@ss:/?#% word\n',
  });
  assert.equal(value, 'postgresql://tabletop_app:p%40ss%3A%2F%3F%23%25%20word@db:5432/tabletop');
});

test('migration configuration uses its independent prefixed credentials', () => {
  const value = databaseConnectionString({
    prefix: 'MIGRATE_',
    env: {
      MIGRATE_DATABASE_HOST: 'postgres',
      MIGRATE_DATABASE_NAME: 'tabletop',
      MIGRATE_DATABASE_USER: 'tabletop',
      MIGRATE_DATABASE_PASSWORD_FILE: '/run/secrets/owner',
    },
    readFile: () => 'owner-password',
  });
  assert.equal(value, 'postgresql://tabletop:owner-password@postgres:5432/tabletop');
});

test('incomplete and empty password-file configuration fails closed', () => {
  assert.throws(() => databaseConnectionString({ env: { DATABASE_HOST: 'db' } }), /incomplete/);
  assert.throws(
    () =>
      databaseConnectionString({
        env: {
          DATABASE_HOST: 'db',
          DATABASE_NAME: 'tabletop',
          DATABASE_USER: 'app',
          DATABASE_PASSWORD_FILE: '/secret',
        },
        readFile: () => '\n',
      }),
    /empty/,
  );
  assert.equal(databaseConnectionString({ env: {}, required: false }), null);
});
