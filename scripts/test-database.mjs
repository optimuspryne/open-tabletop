import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDatabase = 'open_tabletop_test';
const ownerPassword = 'owner_test_password';
const appPassword = 'app_test_password';
const image = process.env.TEST_POSTGRES_IMAGE || 'postgres:16-alpine';

function checkedTestUrl(value, label) {
  const url = new URL(value);
  const database = url.pathname.slice(1);
  if (!database.endsWith('_test')) {
    throw new Error(
      `${label} must name a database ending in _test; received ${database || '(empty)'}`,
    );
  }
  return url.toString();
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      env: { ...process.env, ...options.env },
    });
    let stdout = '';
    let stderr = '';
    if (options.capture) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
    }
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve(stdout.trim());
      else
        reject(
          new Error(
            `${command} exited with ${code ?? signal}${stderr ? `: ${stderr.trim()}` : ''}`,
          ),
        );
    });
  });
}

async function waitForPostgres(connectionString) {
  let consecutiveConnections = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const client = new pg.Client({ connectionString });
    try {
      await client.connect();
      await client.query('SELECT 1');
      consecutiveConnections += 1;
      if (consecutiveConnections >= 2) return;
    } catch {
      consecutiveConnections = 0;
    } finally {
      await client.end().catch(() => {});
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Disposable PostgreSQL did not become ready in time');
}

async function startDisposablePostgres(onContainer) {
  const container = `open-tabletop-test-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  onContainer(container);
  await run(
    'docker',
    [
      'run',
      '--detach',
      '--rm',
      '--name',
      container,
      '--env',
      `POSTGRES_USER=tabletop`,
      '--env',
      `POSTGRES_PASSWORD=${ownerPassword}`,
      '--env',
      `POSTGRES_DB=${testDatabase}`,
      '--publish',
      '127.0.0.1::5432',
      image,
    ],
    { capture: true },
  );
  const mapping = await run('docker', ['port', container, '5432/tcp'], { capture: true });
  const port = mapping.match(/:(\d+)$/)?.[1];
  if (!port) throw new Error(`Could not resolve PostgreSQL port from: ${mapping}`);
  const ownerUrl = `postgresql://tabletop:${ownerPassword}@127.0.0.1:${port}/${testDatabase}`;
  await waitForPostgres(ownerUrl);
  return {
    container,
    ownerUrl,
    appUrl: `postgresql://tabletop_app:${appPassword}@127.0.0.1:${port}/${testDatabase}`,
  };
}

async function prepareDatabase(ownerUrl) {
  const checkedOwnerUrl = checkedTestUrl(ownerUrl, 'Owner database URL');
  const databaseName = new URL(checkedOwnerUrl).pathname.slice(1).replaceAll('"', '""');
  const client = new pg.Client({
    connectionString: checkedOwnerUrl,
  });
  await client.connect();
  try {
    const schema = await fs.readFile(path.join(root, 'postgres/schema.sql'), 'utf8');
    await client.query(schema);
    await client.query(`CREATE ROLE tabletop_app LOGIN PASSWORD '${appPassword}'`);
    await client.query(`GRANT CONNECT ON DATABASE "${databaseName}" TO tabletop_app`);
    await client.query('GRANT USAGE ON SCHEMA public TO tabletop_app');
    await client.query(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tabletop_app',
    );
    await client.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tabletop_app');
    await client.query(
      'ALTER DEFAULT PRIVILEGES FOR ROLE tabletop IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tabletop_app',
    );
    await client.query(
      'ALTER DEFAULT PRIVILEGES FOR ROLE tabletop IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO tabletop_app',
    );
  } finally {
    await client.end();
  }
}

let container = null;
async function stopDisposablePostgres() {
  if (!container) return;
  const name = container;
  container = null;
  await run('docker', ['stop', '--time', '1', name], { capture: true });
}

const stopOnSignal = (signal) => {
  void stopDisposablePostgres()
    .catch((error) => console.error(`[test:integration] cleanup failed: ${error.message}`))
    .finally(() => process.kill(process.pid, signal));
};
process.once('SIGINT', () => stopOnSignal('SIGINT'));
process.once('SIGTERM', () => stopOnSignal('SIGTERM'));

try {
  let ownerUrl = process.env.TEST_DATABASE_OWNER_URL;
  let appUrl = process.env.TEST_DATABASE_URL;
  if (ownerUrl || appUrl) {
    if (!ownerUrl || !appUrl) {
      throw new Error('TEST_DATABASE_OWNER_URL and TEST_DATABASE_URL must be provided together');
    }
    ownerUrl = checkedTestUrl(ownerUrl, 'TEST_DATABASE_OWNER_URL');
    appUrl = checkedTestUrl(appUrl, 'TEST_DATABASE_URL');
  } else {
    const disposable = await startDisposablePostgres((name) => {
      container = name;
    });
    ({ ownerUrl, appUrl } = disposable);
  }

  await prepareDatabase(ownerUrl);
  await run(process.execPath, ['--test', 'test/integration/database.js'], {
    env: { TEST_DATABASE_URL: appUrl },
  });
} finally {
  await stopDisposablePostgres().catch((error) => {
    console.error(`[test:integration] cleanup failed: ${error.message}`);
  });
}
