// Opt-in end-to-end check against the isolated local demo stack only.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { launch, newPage } from './lib/headless.mjs';
const origin = process.env.DEMO_TEST_ORIGIN;
if (origin !== 'http://127.0.0.1:2568')
  throw new Error('Set DEMO_TEST_ORIGIN=http://127.0.0.1:2568 for the isolated local stack.');
const starter = process.env.DEMO_TEST_STARTER || 'chess';
assert.ok(['empty', 'dice', 'cards', 'chess'].includes(starter));
const browser = await launch({ webgl: true });
try {
  const page = await newPage(browser, { url: origin, settle: 1000 });
  assert.equal(
    await page.evaluate(`document.querySelector('#demo-heading')?.textContent`),
    'Your own table, ready to play',
  );
  await browser.send(
    'Page.addScriptToEvaluateOnNewDocument',
    {
      source: `(() => {
        let handler;
        Object.defineProperty(window, 'onOttRoom', {
          configurable: true,
          get: () => (room, ...args) => {
            window.__demoTestRoom = room;
            return handler?.(room, ...args);
          },
          set: value => { handler = value; },
        });
      })();`,
    },
    page.sessionId,
  );
  await page.evaluate(
    `document.querySelector('#demo-name').value='UI smoke'; document.querySelector('[value="${starter}"]').checked=true; document.querySelector('form').requestSubmit()`,
  );
  await new Promise((resolve) => setTimeout(resolve, 3500));
  assert.match(await page.evaluate('location.href'), /table.html/);
  assert.equal(
    await page.evaluate(`document.querySelector('#lobbyBtn').getAttribute('aria-label')`),
    'Leave table',
  );
  assert.match(
    await page.evaluate(`document.querySelector('.demo-table-status')?.textContent`),
    /Public demo/,
  );
  if (starter === 'dice') {
    assert.deepEqual(
      await page.evaluate(
        `Array.from(window.__demoTestRoom.state.pieces.values(), piece => ({
          type: piece.type, sides: JSON.parse(piece.props).sides,
        }))`,
      ),
      Array.from({ length: 5 }, () => ({ type: 'die', sides: 6 })),
      'dice starter joins with five synchronized six-sided dice',
    );
  }
  await page.evaluate(`document.querySelector('.demo-invite').click()`);
  const state = await page.evaluate(`JSON.parse(localStorage.getItem('tabletop.demo.session'))`);
  const link = await page.evaluate(`document.querySelector('#demo-invite-link').value`);
  assert.equal(link, `${origin}/#invite=${state.invite}`);
  assert.equal(await page.evaluate(`document.querySelector('.demo-invite-dialog').open`), true);
  const api = async (action, body = {}, token = '') => {
    const response = await fetch(`${origin}/demo-api/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  };
  const guest = await api('join', { invite: state.invite, displayName: 'Friend' });
  assert.equal(guest.status, 200);
  assert.equal(guest.data.table.roomId, state.table.roomId);
  assert.equal(guest.data.table.role, 'player');
  assert.equal((await api('rotate', {}, guest.data.token)).status, 403);
  const account = await fetch(`${origin}/rooms`, {
    headers: { Authorization: `Bearer ${guest.data.token}` },
  });
  assert.equal(account.status, 403);
  const rotated = await api('rotate', {}, state.token);
  assert.equal(rotated.status, 200);
  assert.equal((await api('invite', { invite: state.invite })).status, 410);
  assert.equal((await api('resume', {}, guest.data.token)).status, 200);
  assert.equal((await api('invite', { invite: rotated.data.invite })).status, 200);
  assert.equal(
    (
      await fetch(`${origin}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
    403,
  );
  await writeFile(
    '/tmp/open-tabletop-demo-smoke-room.json',
    JSON.stringify({ roomId: state.table.roomId }),
  );
  // Capture the desktop table dialog for visual inspection without printing credentials.
  await page.evaluate(
    `document.querySelector('#demo-invite-link').value='http://localhost:2568/#invite=example-link'`,
  );
  const shot = await browser.send('Page.captureScreenshot', { format: 'png' }, page.sessionId);
  await writeFile('/tmp/open-tabletop-demo-live.png', Buffer.from(shot.data, 'base64'));
  assert.deepEqual(page.errors, []);
  await browser.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
    page.sessionId,
  );
  await browser.send(
    'Emulation.setTouchEmulationEnabled',
    { enabled: true, maxTouchPoints: 5 },
    page.sessionId,
  );
  await page.evaluate(`document.body.classList.remove('ui-full')`);
  assert.equal(
    await page.evaluate(
      `(() => { const d=document.querySelector('.demo-invite-dialog'); return d.scrollWidth <= d.clientWidth && d.getBoundingClientRect().width <= innerWidth; })()`,
    ),
    true,
    'touch dialog fits viewport',
  );
  assert.notEqual(
    await page.evaluate(`getComputedStyle(document.querySelector('.demo-invite .lbl')).display`),
    'none',
    'touch invite keeps its label in compact mode',
  );
  assert.notEqual(
    await page.evaluate(
      `getComputedStyle(document.querySelector('.demo-invite-dialog [data-action="copy"] .lbl')).display`,
    ),
    'none',
    'compact copy action keeps its label',
  );
  const phone = await browser.send('Page.captureScreenshot', { format: 'png' }, page.sessionId);
  await writeFile('/tmp/open-tabletop-demo-live-phone.png', Buffer.from(phone.data, 'base64'));
  assert.match(state.table.roomId, /^\d+$/);
  execFileSync(
    'docker',
    [
      'exec',
      'open-tabletop-demo-test-db',
      'psql',
      '-U',
      'tabletop',
      '-d',
      'tabletop',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `UPDATE demo_rooms SET expires_at=clock_timestamp()-interval '1 second' WHERE room_id=${state.table.roomId}`,
    ],
    { stdio: 'ignore' },
  );
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if ((await page.evaluate('location.href')).includes('expired=1')) break;
  }
  assert.match(await page.evaluate('location.href'), /expired=1/);
  assert.equal((await api('resume', {}, state.token)).status, 410);
  const remaining = execFileSync(
    'docker',
    [
      'exec',
      'open-tabletop-demo-test-db',
      'psql',
      '-U',
      'tabletop',
      '-d',
      'tabletop',
      '-tAc',
      `SELECT count(*) FROM demo_rooms WHERE room_id=${state.table.roomId}`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(remaining.trim(), '0', 'expired live table reclaimed after disposal');
  await page.close();
  console.log(
    `Live demo passed: entry → ${starter} table, invite dialog, guest exchange, host-only rotation, stale invite rejection, existing guest resume, account/signup denial, active expiry redirect and safe reclamation.`,
  );
} finally {
  await browser.close();
}
