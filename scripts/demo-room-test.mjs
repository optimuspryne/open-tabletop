// Real demo entry → server → synchronized room checks, using only disposable DBs.
// Run via npm run test:demo; the shared runner creates and removes PostgreSQL.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { launch, newPage } from './lib/headless.mjs';

for (const key of ['TEST_DATABASE_URL', 'TEST_DATABASE_OWNER_URL'])
  assert.ok(new URL(process.env[key]).pathname.endsWith('_test'), `${key} must end in _test`);
const database = new pg.Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL });
const scratch = await mkdtemp(join(tmpdir(), 'tabletop-demo-rooms-'));
const listener = createServer();
await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const origin = `http://127.0.0.1:${port}`;
let child;
let browser;
let serverLog = '';

async function waitFor(check, description, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null) throw new Error(`Demo server exited: ${serverLog}`);
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}\n${serverLog}`);
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  const force = setTimeout(() => child.kill('SIGKILL'), 8000);
  try {
    await exited;
  } finally {
    clearTimeout(force);
  }
}

try {
  await database.connect();
  child = spawn(process.execPath, ['server.js'], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      DATABASE_URL_FILE: '',
      MIGRATE_DATABASE_URL: '',
      MIGRATE_DATABASE_URL_FILE: '',
      AUTO_MIGRATE: 'false',
      DEMO_MODE: 'true',
      RATE_LIMIT_STORE: 'memory',
      REDIS_URL: '',
      REDIS_URL_FILE: '',
      ASSETS_DIR: scratch,
      SMTP_HOST: '',
      BOOTSTRAP_ADMIN_USERNAME: '',
      BOOTSTRAP_ADMIN_EMAIL: '',
      BOOTSTRAP_ADMIN_PASSWORD_FILE: '',
      PUBLIC_ORIGIN: origin,
      TRUST_PROXY_HOPS: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (data) => (serverLog = (serverLog + data).slice(-12000)));
  child.stderr.on('data', (data) => (serverLog = (serverLog + data).slice(-12000)));
  await waitFor(
    () =>
      fetch(origin)
        .then((res) => res.ok)
        .catch(() => false),
    'demo startup',
  );
  browser = await launch({ webgl: true });
  const page = await newPage(browser, { url: origin });
  await browser.send(
    'Page.addScriptToEvaluateOnNewDocument',
    {
      source: `let notify; Object.defineProperty(window,'onOttRoom', {
      configurable:true, set(fn) {notify=fn;},
      get() {return (room,...args) => {window.demoRoom=room; notify?.(room,...args);};}
    });`,
    },
    page.sessionId,
  );
  for (const [environment, starter] of [
    ['cozy', 'empty'],
    ['poker-night', 'dice'],
    ['medieval-tavern', 'cards'],
    ['modern-bar', 'chess'],
  ]) {
    await page.evaluate(`localStorage.removeItem('tabletop.demo.session')`);
    await browser.send('Page.navigate', { url: origin }, page.sessionId);
    await waitFor(
      () => page.evaluate(`!!document.querySelector('[name="environment"]')`),
      'room picker',
    );
    await page.evaluate(`document.querySelector('#demo-name').value='Room tester';
      document.querySelector('[name="environment"][value="${environment}"]').checked=true;
      document.querySelector('[name="starter"][value="${starter}"]').checked=true;
      document.querySelector('form').requestSubmit();`);
    await waitFor(
      () =>
        page.evaluate(
          `window.demoRoom?.state?.environment === '${environment}' && !!document.querySelector('.demo-table-status')`,
        ),
      `${environment} synchronized room`,
    );
    const saved = await page.evaluate(`JSON.parse(localStorage.getItem('tabletop.demo.session'))`);
    assert.equal(saved.table.environment, environment);
    assert.equal(saved.table.starter, starter);
    const row = (
      await database.query('SELECT room_environment FROM rooms WHERE id=$1', [saved.table.roomId])
    ).rows[0];
    assert.equal(row.room_environment, environment);
    if (starter === 'dice')
      assert.equal(
        await page.evaluate(
          `Array.from(window.demoRoom.state.pieces.values()).filter(piece=>piece.type==='die').length`,
        ),
        5,
      );
    assert.deepEqual(page.errors, []);
    console.log(`PASS demo production entry: ${environment} / ${starter}`);
  }
  const saved = await page.evaluate(`JSON.parse(localStorage.getItem('tabletop.demo.session'))`);
  const resumed = await fetch(`${origin}/demo-api/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${saved.token}` },
    body: JSON.stringify({ displayName: 'Other', starter: 'empty', environment: 'cozy' }),
  });
  assert.equal(resumed.status, 200);
  assert.equal(
    (await resumed.json()).table.environment,
    'modern-bar',
    'existing sessions retain their room',
  );
  await browser.send('Page.reload', {}, page.sessionId);
  await waitFor(
    () => page.evaluate(`window.demoRoom?.state?.environment === 'modern-bar'`),
    'refresh retains style',
  );
  await page.evaluate(`localStorage.removeItem('tabletop.demo.session')`);
  await browser.send('Page.navigate', { url: `${origin}/#invite=${saved.invite}` }, page.sessionId);
  await waitFor(
    () => page.evaluate(`document.querySelector('#demo-heading')?.textContent.startsWith('Join ')`),
    'invite entry',
  );
  assert.equal(
    await page.evaluate(`document.querySelector('[data-demo="environments"]').hidden`),
    true,
  );
  await page.evaluate(
    `document.querySelector('#demo-name').value='Friend';document.querySelector('form').requestSubmit()`,
  );
  await waitFor(
    () => page.evaluate(`window.demoRoom?.state?.environment === 'modern-bar'`),
    'invite inherits style',
  );
  assert.equal(
    await page.evaluate(`JSON.parse(localStorage.getItem('tabletop.demo.session')).table.role`),
    'player',
  );
  await database.query(
    "UPDATE demo_rooms SET expires_at=clock_timestamp()-interval '1 second' WHERE room_id=$1",
    [saved.table.roomId],
  );
  await waitFor(
    () => page.evaluate(`location.search.includes('expired=1')`),
    'expired demo redirect',
  );
  await waitFor(
    async () =>
      !(await database.query('SELECT 1 FROM demo_rooms WHERE room_id=$1', [saved.table.roomId]))
        .rowCount,
    'expired room reclamation',
  );
  assert.deepEqual(page.errors, []);
  await page.close();
  console.log(
    'PASS demo production lifecycle: existing-session creation, refresh, invite inheritance, expiry and reclamation.',
  );
} finally {
  await browser?.close();
  await stopServer();
  await database.end();
  await rm(scratch, { recursive: true, force: true });
}
