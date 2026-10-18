import assert from 'node:assert/strict';
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
    // Upgrade a populated pre-demo schema with the same numbered migration used
    // by deployment; permanent users and room state must remain unchanged.
    const demoMigration = await fs.readFile(
      path.join(root, 'postgres/024_demo_sessions.sql'),
      'utf8',
    );
    await client.query('CREATE SCHEMA demo_upgrade_test');
    try {
      await client.query('SET search_path TO demo_upgrade_test');
      await client.query(
        schema
          .replace(
            (await fs.readFile(path.join(root, 'postgres/025_demo_occupancy.sql'), 'utf8')) + '\n',
            '',
          )
          .replace(", ('025_demo_occupancy.sql')", '')
          .replace(demoMigration + '\n', '')
          .replace(", ('024_demo_sessions.sql')", ''),
      );
      const user = (
        await client.query(
          "INSERT INTO users(username,email) VALUES ('survivor','survivor@example.test') RETURNING id",
        )
      ).rows[0];
      await client.query(
        "INSERT INTO rooms(owner_id,code,name,notes) VALUES ($1,'SURVIVOR','Saved table','keep me')",
        [user.id],
      );
      await client.query(demoMigration);
      await client.query(
        await fs.readFile(path.join(root, 'postgres/025_demo_occupancy.sql'), 'utf8'),
      );
      const existing = (await client.query('SELECT email,is_demo FROM users')).rows[0];
      assert.equal(existing.email, 'survivor@example.test');
      assert.equal(existing.is_demo, false);
      assert.equal((await client.query('SELECT notes FROM rooms')).rows[0].notes, 'keep me');
      assert.equal((await client.query('SELECT count(*)::int AS n FROM demo_rooms')).rows[0].n, 0);
    } finally {
      await client.query('SET search_path TO public');
      await client.query('DROP SCHEMA demo_upgrade_test CASCADE');
    }

    // Deployed demo databases already have their own 024/025 files. Exercise the
    // real filename-ledger migrator: matching numeric prefixes must not skip main's
    // four environment migrations or replay temporary identities onto live guests.
    const environmentFiles = [
      '024_room_environment.sql',
      '025_poker_night.sql',
      '026_medieval_tavern.sql',
      '027_modern_bar.sql',
    ];
    const deployedFiles = (await fs.readdir(path.join(root, 'postgres')))
      .filter((file) => /^\d{3,}_.+\.sql$/.test(file) && !environmentFiles.includes(file))
      .sort();
    const oldDemoSchema = schema
      .replace(/^ {2}room_environment[^\n]*\n/m, '')
      .replace(
        /INSERT INTO schema_migrations \(version\) VALUES[\s\S]*?;/,
        `INSERT INTO schema_migrations (version) VALUES ${deployedFiles.map((file) => `('${file}')`).join(', ')};`,
      );
    await client.query('CREATE SCHEMA demo_environment_upgrade_test');
    try {
      await client.query('SET search_path TO demo_environment_upgrade_test');
      await client.query(oldDemoSchema);
      await client.query(
        "INSERT INTO users(username,email) VALUES ('permanent','permanent@example.test')",
      );
      const guest = (
        await client.query(
          "INSERT INTO users(username,email,is_demo) VALUES ('guest',NULL,true) RETURNING id",
        )
      ).rows[0];
      const snapshot = { pieces: [{ type: 'die', props: { sides: 6 } }] };
      const room = (
        await client.query(
          "INSERT INTO rooms(owner_id,code,name,notes,scene,table_rim_wood) VALUES ($1,'DEMO-SURVIVOR','Saved demo','keep notes',$2,'walnut') RETURNING id",
          [guest.id, snapshot],
        )
      ).rows[0];
      await client.query(
        "INSERT INTO demo_rooms(room_id,invite_hash,starter,expires_at,idle_expires_at,last_occupied_at) VALUES ($1,$2,'dice',clock_timestamp()+interval '2 hours',NULL,clock_timestamp())",
        [room.id, 'a'.repeat(64)],
      );
      await client.query(
        "INSERT INTO demo_guests(user_id,room_id,display_name) VALUES ($1,$2,'Alex')",
        [guest.id, room.id],
      );
      await client.query(
        "INSERT INTO user_sessions(user_id,token_hash,expires_at) VALUES ($1,$2,clock_timestamp()+interval '2 hours')",
        [guest.id, 'b'.repeat(64)],
      );
      await client.query(
        "INSERT INTO room_members(room_id,user_id,role,status) VALUES ($1,$2,'owner','admitted')",
        [room.id, guest.id],
      );
      const before = (await client.query('SELECT * FROM demo_rooms')).rows;
      const upgradeUrl = new URL(checkedOwnerUrl);
      upgradeUrl.searchParams.set('options', '-c search_path=demo_environment_upgrade_test');
      for (let pass = 0; pass < 2; pass++) {
        await run(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            "import {runMigrations} from './migrate.js'; await runMigrations();",
          ],
          {
            env: {
              MIGRATE_DATABASE_URL: upgradeUrl.toString(),
              MIGRATE_DATABASE_URL_FILE: '',
              AUTO_MIGRATE: 'true',
            },
          },
        );
      }
      assert.equal(
        (await client.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n,
        29,
      );
      assert.deepEqual((await client.query('SELECT * FROM demo_rooms')).rows, before);
      assert.deepEqual(
        (await client.query('SELECT notes,scene,table_rim_wood,room_environment FROM rooms')).rows,
        [
          {
            notes: 'keep notes',
            scene: snapshot,
            table_rim_wood: 'walnut',
            room_environment: 'standard',
          },
        ],
      );
      assert.equal(
        (await client.query('SELECT count(*)::int AS n FROM user_sessions')).rows[0].n,
        1,
      );
      assert.equal(
        (await client.query('SELECT count(*)::int AS n FROM room_members')).rows[0].n,
        1,
      );
      assert.equal(
        (await client.query("SELECT email FROM users WHERE username='permanent'")).rows[0].email,
        'permanent@example.test',
      );
    } finally {
      await client.query('SET search_path TO public');
      await client.query('DROP SCHEMA demo_environment_upgrade_test CASCADE');
    }

    // Existing rooms migrate to Standard without losing their other settings.
    const environmentMigration = await fs.readFile(
      path.join(root, 'postgres/024_room_environment.sql'),
      'utf8',
    );
    await client.query('CREATE SCHEMA environment_upgrade_test');
    try {
      await client.query('SET search_path TO environment_upgrade_test');
      await client.query(
        'CREATE TABLE rooms (id bigint PRIMARY KEY, notes text, table_rim_wood text)',
      );
      await client.query("INSERT INTO rooms VALUES (1, 'legacy notes', 'walnut')");
      await client.query(environmentMigration);
      assert.deepEqual((await client.query('SELECT * FROM rooms')).rows, [
        { id: '1', notes: 'legacy notes', table_rim_wood: 'walnut', room_environment: 'standard' },
      ]);
      await client.query("UPDATE rooms SET room_environment = 'cozy'");
      await client.query(environmentMigration);
      assert.equal(
        (await client.query('SELECT room_environment FROM rooms')).rows[0].room_environment,
        'cozy',
      );
      const pokerMigration = await fs.readFile(
        path.join(root, 'postgres/025_poker_night.sql'),
        'utf8',
      );
      await client.query("INSERT INTO rooms VALUES (2, 'standard notes', 'oak', 'standard')");
      await client.query(pokerMigration);
      assert.deepEqual(
        (await client.query('SELECT room_environment FROM rooms ORDER BY id')).rows.map(
          (row) => row.room_environment,
        ),
        ['cozy', 'standard'],
      );
      await client.query("UPDATE rooms SET room_environment = 'poker-night' WHERE id = 1");
      await client.query(pokerMigration);
      assert.equal(
        (await client.query('SELECT room_environment FROM rooms WHERE id = 1')).rows[0]
          .room_environment,
        'poker-night',
      );
      const tavernMigration = await fs.readFile(
        path.join(root, 'postgres/026_medieval_tavern.sql'),
        'utf8',
      );
      await client.query(tavernMigration);
      assert.deepEqual(
        (await client.query('SELECT room_environment FROM rooms ORDER BY id')).rows.map(
          (row) => row.room_environment,
        ),
        ['poker-night', 'standard'],
      );
      await client.query("UPDATE rooms SET room_environment = 'medieval-tavern' WHERE id = 1");
      await client.query(tavernMigration);
      assert.equal(
        (await client.query('SELECT room_environment FROM rooms WHERE id = 1')).rows[0]
          .room_environment,
        'medieval-tavern',
      );
      const modernMigration = await fs.readFile(
        path.join(root, 'postgres/027_modern_bar.sql'),
        'utf8',
      );
      await client.query(
        "INSERT INTO rooms VALUES (3, 'cozy notes', 'oak', 'cozy'), (4, 'poker notes', 'walnut', 'poker-night')",
      );
      await client.query(modernMigration);
      assert.deepEqual(
        (await client.query('SELECT room_environment FROM rooms ORDER BY id')).rows.map(
          (row) => row.room_environment,
        ),
        ['medieval-tavern', 'standard', 'cozy', 'poker-night'],
      );
      await client.query("UPDATE rooms SET room_environment = 'modern-bar' WHERE id = 2");
      await client.query(modernMigration);
      assert.deepEqual(
        (await client.query('SELECT room_environment FROM rooms ORDER BY id')).rows.map(
          (row) => row.room_environment,
        ),
        ['medieval-tavern', 'modern-bar', 'cozy', 'poker-night'],
      );
      assert.deepEqual(
        (await client.query('SELECT notes, table_rim_wood FROM rooms WHERE id = 2')).rows,
        [{ notes: 'standard notes', table_rim_wood: 'oak' }],
      );
      await client.query(
        "INSERT INTO rooms (id, notes, table_rim_wood) VALUES (5, 'fresh default', 'oak')",
      );
      assert.equal(
        (await client.query('SELECT room_environment FROM rooms WHERE id = 5')).rows[0]
          .room_environment,
        'standard',
      );
      await assert.rejects(
        client.query("UPDATE rooms SET room_environment = 'unknown'"),
        (error) => error.code === '23514',
      );
    } finally {
      await client.query('SET search_path TO public');
      await client.query('DROP SCHEMA environment_upgrade_test CASCADE');
    }
    // Exercise migration 021 independently against an existing account, preserving its avatar.
    const placardMigration = await fs.readFile(
      path.join(root, 'postgres/021_user_placards.sql'),
      'utf8',
    );
    await client.query('CREATE SCHEMA placard_upgrade_test');
    try {
      await client.query('SET search_path TO placard_upgrade_test');
      await client.query('CREATE TABLE users (id bigint PRIMARY KEY, avatar text)');
      await client.query("INSERT INTO users VALUES (1, 'legacy-avatar')");
      await client.query(placardMigration);
      const { rows } = await client.query('SELECT avatar, placard FROM users WHERE id = 1');
      assert.equal(rows[0].avatar, 'legacy-avatar');
      assert.equal(rows[0].placard.shape, 'masculine');
    } finally {
      await client.query('SET search_path TO public');
      await client.query('DROP SCHEMA placard_upgrade_test CASCADE');
    }

    const recoveryMigration = await fs.readFile(
      path.join(root, 'postgres/023_account_recovery.sql'),
      'utf8',
    );
    await client.query('CREATE SCHEMA recovery_upgrade_test');
    try {
      await client.query('SET search_path TO recovery_upgrade_test');
      await client.query(
        'CREATE TABLE users (id bigint PRIMARY KEY, email text, password_hash text)',
      );
      await client.query(
        "INSERT INTO users VALUES (1, 'legacy@example.test', NULL), (2, 'host@example.test', 'legacy-hash')",
      );
      await client.query(recoveryMigration);
      const { rows } = await client.query(
        'SELECT email_verified_at, password_hash FROM users ORDER BY id',
      );
      assert.equal(rows[0].email_verified_at, null);
      assert.equal(rows[0].password_hash, null);
      assert.equal(rows[1].email_verified_at, null);
      assert.equal(rows[1].password_hash, 'legacy-hash');
    } finally {
      await client.query('SET search_path TO public');
      await client.query('DROP SCHEMA recovery_upgrade_test CASCADE');
    }

    const templateMigration = await fs.readFile(
      path.join(root, 'postgres/022_notecard_templates.sql'),
      'utf8',
    );
    await client.query('CREATE SCHEMA template_upgrade_test');
    try {
      await client.query('SET search_path TO template_upgrade_test');
      await client.query(
        schema
          .replace(templateMigration + '\n', '')
          .replace(", ('022_notecard_templates.sql')", ''),
      );
      const seeded = await client.query(
        "INSERT INTO users(username,email) VALUES ('template-upgrade','template-upgrade@example.test') RETURNING id",
      );
      await client.query(templateMigration);
      await client.query(
        "INSERT INTO notecard_templates(owner_id,name,content) VALUES ($1,'Private','{}')",
        [seeded.rows[0].id],
      );
      assert.equal(
        (await client.query('SELECT is_public FROM notecard_templates')).rows[0].is_public,
        false,
      );
    } finally {
      await client.query('SET search_path TO public');
      await client.query('DROP SCHEMA template_upgrade_test CASCADE');
    }

    // Exercise the actual numbered upgrade against a populated pre-collections baseline.
    const collectionMigration = await fs.readFile(
      path.join(root, 'postgres/020_asset_collections.sql'),
      'utf8',
    );
    const previous = schema
      .replace(templateMigration + '\n', '')
      .replace(", ('022_notecard_templates.sql')", '')
      .replace(placardMigration + '\n', '')
      .replace(", ('021_user_placards.sql')", '')
      .replace(collectionMigration + '\n', '')
      .replace(", ('020_asset_collections.sql')", '')
      .replaceAll('001–022', '001–019');
    await client.query('CREATE SCHEMA collection_upgrade_test');
    try {
      await client.query('SET search_path TO collection_upgrade_test');
      await client.query(previous);
      const seeded = await client.query(
        "INSERT INTO custom_decks(name) VALUES ('Upgrade survivor') RETURNING id",
      );
      await client.query(collectionMigration);
      assert.equal(
        (await client.query('SELECT name FROM custom_decks WHERE id=$1', [seeded.rows[0].id]))
          .rows[0].name,
        'Upgrade survivor',
      );
      await client.query("INSERT INTO asset_collections(name) VALUES ('Upgraded collection')");
    } finally {
      await client.query('SET search_path TO public');
      await client.query('DROP SCHEMA collection_upgrade_test CASCADE');
    }

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
  await run(process.execPath, ['--test', 'test/integration/demo-sessions.js'], {
    env: { TEST_DATABASE_URL: appUrl },
  });
  if (process.argv.includes('--demo')) {
    await run(process.execPath, ['scripts/demo-room-test.mjs'], {
      env: { TEST_DATABASE_URL: appUrl, TEST_DATABASE_OWNER_URL: ownerUrl },
    });
  }
  if (process.argv.includes('--multiplayer')) {
    await run(process.execPath, ['scripts/multiplayer-test.mjs'], {
      env: { TEST_DATABASE_URL: appUrl, TEST_DATABASE_OWNER_URL: ownerUrl },
    });
  }
} finally {
  await stopDisposablePostgres().catch((error) => {
    console.error(`[test:integration] cleanup failed: ${error.message}`);
  });
}
