// migrate.js — startup schema migrator.
//
// Applies any `postgres/NNN_*.sql` migrations not yet recorded in the
// `schema_migrations` table, in filename order, each exactly once. Runs as a
// PRIVILEGED (DDL-capable) role via `MIGRATE_DATABASE_URL` — deliberately SEPARATE
// from the app's least-privilege `DATABASE_URL` — so the running server never needs
// CREATE/ALTER rights. Deployment-agnostic: it targets whatever Postgres the
// connection string points at (the bundled db image, stock `postgres`, or a
// managed/standalone instance), so migrations auto-apply on upgrade everywhere.
//
// Reconciliation with the baseline: a fresh install applies `postgres/schema.sql`
// (the flattened end state), which also SEEDS `schema_migrations` with 001..N — so
// this runner sees nothing pending. An upgrade has an older applied set, so only the
// new files run. A truly blank database (no baseline) has nothing recorded, so the
// full 001..N sequence builds the schema from scratch. Each migration runs inside a
// single transaction together with its bookkeeping row, so a crash can never leave a
// migration applied-but-unrecorded.
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { databaseConnectionString } from './server/database-config.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'postgres');
const FILE_RE = /^\d{3,}_.+\.sql$/; // numbered migrations only (skips schema.sql, grants_*.sql)

// The migrations subsumed by postgres/schema.sql — the state every deployment already had
// before this migrator existed. FROZEN: never add newer files here. Used to "adopt" a
// pre-tracking database (mark these as applied instead of replaying them onto a schema that
// already has them). A deployment must be on the release just before the migrator (schema at
// this baseline) before upgrading — i.e. upgrade sequentially from anything older.
const BASELINE_MIGRATIONS = [
  '001_custom_assets.sql',
  '002_auth.sql',
  '003_asset_visibility.sql',
  '004_host_status.sql',
  '005_room_board.sql',
  '006_room_table.sql',
  '007_scenes.sql',
  '008_room_skybox.sql',
  '009_room_state.sql',
  '010_room_scale.sql',
];

// The migrator's connection string — an owner/DDL role, never the app role. Supports
// the same `_FILE` (Docker-secret) form as db.js's DATABASE_URL. Null → not configured.
function migrateConnectionString() {
  return databaseConnectionString({ prefix: 'MIGRATE_', required: false });
}

// Drop the file's own standalone BEGIN/COMMIT so the body runs inside one
// transaction WE control (migration + its schema_migrations row commit together).
const stripTxn = (sql) =>
  sql
    .split('\n')
    .filter((l) => !/^\s*(begin|commit)\s*;\s*$/i.test(l))
    .join('\n');

export async function runMigrations() {
  if (process.env.AUTO_MIGRATE === 'false' || process.env.AUTO_MIGRATE === '0') {
    console.log('[migrate] AUTO_MIGRATE disabled — skipping (migrations managed externally).');
    return;
  }
  const connectionString = migrateConnectionString();
  if (!connectionString) {
    console.log(
      '[migrate] MIGRATE_DATABASE_URL not set — skipping auto-migration. Apply ' +
        'postgres/NNN_*.sql by hand, or set MIGRATE_DATABASE_URL (an owner/DDL role) to auto-apply.',
    );
    return;
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => FILE_RE.test(f))
    .sort();
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query('SELECT version FROM schema_migrations');
    let applied = new Set(rows.map((r) => r.version));

    // Adopt a pre-tracking database: if nothing is recorded yet but the app schema is
    // already present (a deployment from before this migrator existed), record the frozen
    // baseline as applied instead of replaying those files onto tables that already exist,
    // then fall through so any NEWER migration still runs. A truly blank database has no app
    // tables, so it skips this and builds the whole schema from 001.
    if (applied.size === 0) {
      const present = (await client.query("SELECT to_regclass('public.rooms') AS t")).rows[0].t;
      if (present) {
        for (const f of BASELINE_MIGRATIONS) {
          await client.query(
            'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING',
            [f],
          );
        }
        applied = new Set(BASELINE_MIGRATIONS);
        console.log(
          `[migrate] adopted an existing schema — recorded the ${BASELINE_MIGRATIONS.length}-migration baseline (nothing replayed).`,
        );
      }
    }
    const pending = files.filter((f) => !applied.has(f));
    if (!pending.length) {
      console.log(`[migrate] up to date (${applied.size} applied, ${files.length} on disk).`);
      return;
    }
    console.log(`[migrate] applying ${pending.length} migration(s): ${pending.join(', ')}`);
    for (const file of pending) {
      const body = stripTxn(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
      await client.query('BEGIN');
      try {
        await client.query(body);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[migrate]   ✓ ${file}`);
      } catch (e) {
        await client.query('ROLLBACK');
        console.error(`[migrate]   ✗ ${file}: ${e.message}`);
        throw e; // fail fast — never boot the app on a half-migrated schema
      }
    }
    console.log('[migrate] done.');
  } finally {
    await client.end();
  }
}
