#!/usr/bin/env node
/**
 * input-test.mjs — behavioural tests for the input seam (public/controls.js).
 *
 * controls.js translates raw DOM input into the intent vocabulary client.js
 * implements. That seam is unusually testable: attach it to a bare <div>, hand it a
 * recording `intents` object, dispatch synthetic events, and assert on the intents
 * raised. No 3D, no server, no room.
 *
 * It exists because a whole input path can be missing for one device family and
 * everything still looks fine: claiming the whiteboard hung on the native `dblclick`
 * event, which Chrome synthesizes from a double-tap and WebKit does not, so the
 * gesture was unreachable on iOS/iPadOS with no error anywhere.
 *
 * Zero dependencies: a node:http static server plus the Chrome DevTools Protocol over
 * Node's global WebSocket (Node >= 22). Needs a Chromium/Chrome binary — set CHROME_BIN,
 * or it searches the usual names. Deliberately NOT a devDependency, and deliberately not
 * part of `npm run check`, which must keep working on a machine with no browser.
 *
 *   npm run test:input          (or: node scripts/input-test.mjs)
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', 'public');
const MIME = {
  '.js': 'application/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};

// The fixture: controls.js attached to a bare div, with every intent recorded.
const FIXTURE = `<!doctype html><meta charset="utf-8">
<div id="surface" style="width:400px;height:400px"></div>
<script type="module">
import { attachControls } from '/controls.js';
const rec = [];
let held = false;
const flags = (p) =>
  ['primary','secondary','additive','rotate','fineRotate','touch'].filter((k) => p[k]).join('+') || '-';
attachControls(document.getElementById('surface'), {
  press:  (p) => rec.push(['press', flags(p)]),
  move:   (p) => rec.push(['move', flags(p)]),
  release:(p) => rec.push(['release', flags(p)]),
  command:(k) => rec.push(['command', k.key]),
  raiseAxis:(d) => rec.push(['raiseAxis', d]),
  doubleClick: () => { rec.push(['doubleClick']); return true; },
  snapHeld: () => rec.push(['snapHeld']),
  ping: () => rec.push(['ping']),
  secondaryPress: () => rec.push(['secondaryPress']),
  hasHeld: () => held,
});
const dom = document.getElementById('surface');
const P = (type, o = {}) => dom.dispatchEvent(new PointerEvent(type, {
  bubbles: true, cancelable: true, pointerId: 1, pointerType: o.t ?? 'touch',
  clientX: o.x ?? 0, clientY: o.y ?? 0, button: o.button ?? 0,
  shiftKey: !!o.shift, altKey: !!o.alt,
}));
const M = (type, o = {}) => dom.dispatchEvent(new MouseEvent(type, {
  bubbles: true, cancelable: true, clientX: o.x ?? 0, clientY: o.y ?? 0, button: o.button ?? 0,
}));
Object.assign(window, {
  rec, P, M,
  setHeld: (v) => { held = v; },
  reset: () => { rec.length = 0; },
  only: (...names) => rec.filter((r) => names.includes(r[0])),
  tap: (x, y, t = 'touch') => { P('pointerdown', { x, y, t }); P('pointerup', { x, y, t }); },
  wheel: (dy) => dom.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: dy })),
  ctx: () => dom.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
  key: (k) => window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: k })),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
});
window.__ready = true;
</script>`;

// Each case: [name, setup statements, result expression, expected value].
// The setup and the expression are separate because an async function body has no
// implicit return — the first version of this file lost every result to that.
const CASES = [
  [
    'touch double-tap raises doubleClick once',
    `reset(); tap(100,100); await sleep(60); tap(102,101);`,
    `only('doubleClick').length`,
    1,
  ],
  [
    'a third tap does not chain into a second double',
    `reset(); tap(100,100); await sleep(60); tap(101,100); await sleep(60); tap(101,101);`,
    `only('doubleClick').length`,
    1,
  ],
  [
    'taps 500ms apart are not a double',
    `reset(); tap(200,200); await sleep(500); tap(200,200);`,
    `only('doubleClick').length`,
    0,
  ],
  [
    'taps 250px apart are not a double',
    `reset(); tap(50,50); await sleep(60); tap(300,300);`,
    `only('doubleClick').length`,
    0,
  ],
  [
    'a drag then a tap is not a double',
    `reset(); P('pointerdown',{x:80,y:80}); P('pointermove',{x:140,y:140});
    P('pointerup',{x:140,y:140}); await sleep(60); tap(140,140);`,
    `only('doubleClick').length`,
    0,
  ],
  [
    'a native dblclick after a touch tap is suppressed',
    `reset(); tap(10,10); M('dblclick',{x:10,y:10});`,
    `only('doubleClick').length`,
    0,
  ],
  [
    'a mouse dblclick still raises doubleClick',
    `reset(); P('pointerdown',{x:20,y:20,t:'mouse'}); P('pointerup',{x:20,y:20,t:'mouse'});
    M('dblclick',{x:20,y:20});`,
    `only('doubleClick').length`,
    1,
  ],
  [
    'a held finger raises secondaryPress',
    `reset(); P('pointerdown',{x:30,y:30}); await sleep(560);`,
    `only('secondaryPress').length`,
    1,
  ],
  [
    'a finger that drifts does not raise secondaryPress',
    `reset(); P('pointerdown',{x:30,y:30}); await sleep(200); P('pointermove',{x:44,y:30});
    await sleep(400);`,
    `only('secondaryPress').length`,
    0,
  ],
  [
    'a mouse hold never raises secondaryPress',
    `reset(); P('pointerdown',{x:30,y:30,t:'mouse'}); await sleep(560);`,
    `only('secondaryPress').length`,
    0,
  ],
  [
    'middle-click pings when nothing is held',
    `reset(); setHeld(false); M('mousedown',{button:1});`,
    `JSON.stringify(only('ping','snapHeld'))`,
    '[["ping"]]',
  ],
  [
    'middle-click snaps the held piece',
    `reset(); setHeld(true); M('mousedown',{button:1});`,
    `JSON.stringify(only('ping','snapHeld'))`,
    '[["snapHeld"]]',
  ],
  [
    'the wheel raises a held piece, up = +1',
    `reset(); setHeld(true); wheel(-120);`,
    `JSON.stringify(only('raiseAxis'))`,
    '[["raiseAxis",1]]',
  ],
  [
    'the wheel lowers a held piece, down = -1',
    `reset(); setHeld(true); wheel(120);`,
    `JSON.stringify(only('raiseAxis'))`,
    '[["raiseAxis",-1]]',
  ],
  [
    'the wheel is left to the camera when nothing is held',
    `reset(); setHeld(false); wheel(-120);`,
    `only('raiseAxis').length`,
    0,
  ],
  ['contextmenu is prevented so right-click is ours', `reset();`, `ctx() === false`, true],
  [
    'a right-button press is secondary',
    `reset(); P('pointerdown',{x:5,y:5,t:'mouse',button:2});`,
    `JSON.stringify(only('press'))`,
    '[["press","secondary"]]',
  ],
  [
    'shift marks a press additive',
    `reset(); P('pointerdown',{x:5,y:5,t:'mouse',shift:true});`,
    `JSON.stringify(only('press'))`,
    '[["press","primary+additive"]]',
  ],
  [
    'alt+shift marks a press rotate and fineRotate',
    `reset(); P('pointerdown',{x:5,y:5,t:'mouse',alt:true,shift:true});`,
    `JSON.stringify(only('press'))`,
    '[["press","primary+additive+rotate+fineRotate"]]',
  ],
  [
    'a touch press carries the touch flag',
    `reset(); P('pointerdown',{x:5,y:5});`,
    `JSON.stringify(only('press'))`,
    '[["press","primary+touch"]]',
  ],
  [
    'pointercancel still releases',
    `reset(); P('pointerdown',{x:5,y:5}); P('pointercancel',{x:5,y:5});`,
    `only('release').length`,
    1,
  ],
  [
    'a keydown raises a command',
    `reset(); key('Escape');`,
    `JSON.stringify(only('command'))`,
    '[["command","Escape"]]',
  ],
];

function findChrome() {
  if (process.env.CHROME_BIN) {
    // Validate rather than trusting it: a wrong path otherwise hangs until the
    // launch timeout instead of saying what is wrong.
    if (!existsSync(process.env.CHROME_BIN))
      throw new Error(`CHROME_BIN is set to ${process.env.CHROME_BIN}, which does not exist.`);
    return process.env.CHROME_BIN;
  }
  const hit = [
    '/opt/pw-browsers/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ].find((n) => existsSync(n));
  if (!hit) throw new Error('No Chromium found. Set CHROME_BIN to a Chrome/Chromium binary.');
  return hit;
}

const server = await new Promise((ok) => {
  const s = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (path === '/__fixture.html') {
      res.writeHead(200, { 'content-type': MIME['.html'] });
      return res.end(FIXTURE);
    }
    try {
      const body = await readFile(join(ROOT, path));
      res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'text/plain' });
      res.end(body);
    } catch {
      res.writeHead(404).end('');
    }
  });
  s.listen(0, '127.0.0.1', () => ok(s));
});

const profile = await mkdtemp(join(tmpdir(), 'inputtest-'));
const proc = spawn(
  findChrome(),
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage', // CI containers give /dev/shm 64MB; Chrome crashes without this
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);
const wsUrl = await new Promise((ok, fail) => {
  let buf = '';
  const t = setTimeout(() => fail(new Error('browser did not start')), 30000);
  proc.stderr.on('data', (d) => {
    buf += d;
    const m = buf.match(/ws:\/\/[^\s]+/);
    if (m) {
      clearTimeout(t);
      ok(m[0]);
    }
  });
});

const sock = new WebSocket(wsUrl);
let id = 0;
const pending = new Map();
const listeners = [];
sock.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { ok, fail } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
  } else listeners.forEach((fn) => fn(msg));
});
await new Promise((ok) => sock.addEventListener('open', ok));
const send = (method, params = {}, sessionId) =>
  new Promise((ok, fail) => {
    const mid = ++id;
    pending.set(mid, { ok, fail });
    sock.send(JSON.stringify({ id: mid, method, params, sessionId }));
  });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
const loaded = new Promise((ok) =>
  listeners.push((m) => {
    if (m.method === 'Page.loadEventFired' && m.sessionId === sessionId) ok();
  }),
);
await send(
  'Page.navigate',
  { url: `http://127.0.0.1:${server.address().port}/__fixture.html` },
  sessionId,
);
await loaded;
await new Promise((r) => setTimeout(r, 200));

let failed = 0;
for (const [name, setup, expr, expected] of CASES) {
  let got,
    err = null;
  try {
    const { result, exceptionDetails } = await send(
      'Runtime.evaluate',
      {
        expression: `(async () => { ${setup}; return (${expr}); })()`,
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId,
    );
    if (exceptionDetails) err = exceptionDetails.text ?? 'threw';
    got = result.value;
  } catch (e) {
    err = e.message;
  }
  const ok = !err && JSON.stringify(got) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
  if (!ok)
    console.log(
      `          expected ${JSON.stringify(expected)}, got ${err ?? JSON.stringify(got)}`,
    );
}
console.log(`\n${CASES.length - failed}/${CASES.length} passed`);

sock.close();
proc.kill();
server.close();
await new Promise((r) => setTimeout(r, 300));
await rm(profile, { recursive: true, force: true }).catch(() => {});
if (failed) process.exitCode = 1;
