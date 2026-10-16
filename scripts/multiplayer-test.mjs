// Run through test-database.mjs --multiplayer so the real server uses a disposable DB.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { launch, newPage } from './lib/headless.mjs';

for (const key of ['TEST_DATABASE_URL', 'TEST_DATABASE_OWNER_URL']) {
  assert.ok(new URL(process.env[key]).pathname.endsWith('_test'), `${key} must end in _test`);
}
const database = new pg.Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL });
const scratch = await mkdtemp(join(tmpdir(), 'tabletop-multiplayer-'));
const listener = createServer();
await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const origin = `http://127.0.0.1:${port}`;
let child;
let serverLog = '';
let browser;
const packets = new Map();
const password = 'local-migration-test-password';

async function waitFor(check, description, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}`);
}

async function startServer() {
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
  await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(`Server startup failed: ${serverLog}`);
    return fetch(origin, { signal: AbortSignal.timeout(1000) })
      .then((response) => response.ok)
      .catch(() => false);
  }, 'real server startup');
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  const processToStop = child;
  const exited = new Promise((resolve) => processToStop.once('exit', resolve));
  processToStop.kill('SIGTERM');
  const force = setTimeout(() => processToStop.kill('SIGKILL'), 8000);
  try {
    await exited;
  } finally {
    clearTimeout(force);
  }
}

async function api(path, body, token) {
  const response = await fetch(origin + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const result = response.status === 204 ? {} : await response.json();
  assert.ok(response.ok, `${path}: ${response.status} ${result.error || ''}`);
  return result;
}

async function sdkPage() {
  const page = await newPage(browser, { url: origin + '/index.html' });
  packets.set(page.sessionId, []);
  await browser.send('Network.enable', {}, page.sessionId);
  return page;
}

async function joinRoom(page, token, code, name = 'table') {
  return page.evaluate(`(async () => {
    window.messages = [];
    window.room = await new Colyseus.Client(location.origin).joinOrCreate(${JSON.stringify(name)}, ${JSON.stringify({ code, token })});
    room.onMessage('*', (type, data) => messages.push({type, data}));
    return {id:room.roomId, sid:room.sessionId};
  })()`);
}

const state = (page) => page.evaluate('room.state?.toJSON()');
const received = (page, type) =>
  page.evaluate(`messages.filter(message => message.type === ${JSON.stringify(type)})`);
const noPacketSecrets = (page, secrets) => {
  const captured = packets.get(page.sessionId);
  assert.ok(
    captured.length > 0 && captured.length < 2000,
    'WebSocket capture is empty or exhausted',
  );
  const bytes = captured.join('');
  for (const secret of secrets)
    assert.ok(!bytes.includes(secret), `Unauthorized packet contains ${secret}`);
};

try {
  await database.connect();
  await startServer();
  const policy = (await fetch(origin)).headers.get('content-security-policy');
  assert.ok(policy?.includes("script-src 'self'") && !policy.includes('unsafe-eval'));
  const accounts = [];
  for (const username of ['sdk_owner', 'sdk_player', 'sdk_viewer']) {
    accounts.push(
      await api('/auth/signup', {
        username,
        email: `${username}@example.test`,
        password,
        confirmation: password,
      }),
    );
  }
  const [owner, player, viewer] = accounts;
  await database.query("UPDATE users SET is_admin=true, host_status='approved' WHERE id=$1", [
    owner.user.id,
  ]);
  const { room: record } = await api(
    '/rooms',
    { name: 'SDK migration fixture', requireApproval: false },
    owner.token,
  );
  for (const account of [player, viewer])
    await api('/rooms/join', { code: record.code }, account.token);
  const legacy = {
    table: { x: 10, z: 7, shape: 'rect' },
    pieces: [
      {
        type: 'deck',
        props: { back: 'back', cards: ['SECRET_DECK_BOTTOM', 'SECRET_DECK_TOP'] },
        x: -2,
        y: 1,
        z: 0,
        q: [0, 0, 0, 1],
      },
      {
        type: 'card',
        hidden: true,
        props: { front: 'SECRET_HIDDEN_FACE', back: 'back', faceDown: true },
        x: 2,
        y: 1,
        z: 0,
        q: [0, 0, 0, 1],
      },
    ],
    hands: [
      {
        userId: player.user.id,
        name: 'sdk_player',
        cards: [{ hid: 'legacy-hand', front: 'SECRET_PRIVATE_HAND', back: 'back' }],
      },
    ],
  };
  await database.query('UPDATE rooms SET scene=$1 WHERE id=$2', [legacy, record.id]);
  browser = await launch({ webgl: true });
  browser.on((message) => {
    if (message.method === 'Runtime.exceptionThrown') {
      console.error(message.params.exceptionDetails.exception?.description || 'Browser exception');
    }
    if (message.method !== 'Network.webSocketFrameReceived' || !packets.has(message.sessionId))
      return;
    const frame = message.params.response;
    const receivedPackets = packets.get(message.sessionId);
    if (receivedPackets.length < 2000)
      receivedPackets.push(
        Buffer.from(frame.payloadData, frame.opcode === 2 ? 'base64' : 'utf8').toString('utf8'),
      );
  });
  const gm = await sdkPage();
  const outsider = await sdkPage();
  const table = await joinRoom(gm, owner.token, record.code);
  await joinRoom(outsider, viewer.token, record.code);
  await waitFor(
    async () => Object.keys((await state(gm))?.pieces || {}).length === 2,
    'GM initial state',
  );
  await waitFor(
    async () => Object.keys((await state(outsider))?.pieces || {}).length === 1,
    'player initial filtered state',
  );
  const initial = await state(gm);
  const deckId = Object.keys(initial.pieces).find((id) => initial.pieces[id].type === 'deck');
  assert.equal(initial.pieces[deckId].count, 2);
  assert.ok(!JSON.stringify(initial).includes('SECRET_'), 'public schema contains private content');
  noPacketSecrets(outsider, ['SECRET_DECK_', 'SECRET_HIDDEN_FACE', 'SECRET_PRIVATE_HAND']);
  console.log('PASS shipped SDK: actual server, strict CSP, legacy save, initial view privacy');

  const editorDenied = await outsider.evaluate(
    `(async()=>{try{await new Colyseus.Client(location.origin).joinOrCreate('editor',{token:${JSON.stringify(viewer.token)}});return false;}catch{return true;}})()`,
  );
  assert.equal(editorDenied, true);
  await gm.evaluate(
    `(async()=>{const editor=await new Colyseus.Client(location.origin).joinOrCreate('editor',{token:${JSON.stringify(owner.token)}});await editor.leave();})()`,
  );
  await gm.evaluate(
    `room.send('setRole',{userId:${JSON.stringify(String(viewer.user.id))},role:'gm'})`,
  );
  await waitFor(
    async () => Object.keys((await state(outsider))?.pieces || {}).length === 2,
    'live promotion reveals authorized view',
  );
  await gm.evaluate(
    `room.send('setRole',{userId:${JSON.stringify(String(viewer.user.id))},role:'player'})`,
  );
  await waitFor(
    async () => Object.keys((await state(outsider))?.pieces || {}).length === 1,
    'live demotion prunes hidden view',
  );
  const { room: approval } = await api(
    '/rooms',
    { name: 'SDK pending admission', requireApproval: true },
    owner.token,
  );
  await api('/rooms/join', { code: approval.code }, viewer.token);
  const pendingDenied = await outsider.evaluate(
    `(async()=>{try{await new Colyseus.Client(location.origin).joinOrCreate('table',${JSON.stringify({ code: approval.code, token: viewer.token })});return false;}catch{return true;}})()`,
  );
  assert.equal(pendingDenied, true);
  await outsider.evaluate(
    `(async()=>{window.waiting=await new Colyseus.Client(location.origin).joinOrCreate('lobby',${JSON.stringify({ code: approval.code, token: viewer.token })});waiting.onMessage('admitted',()=>window.admitted=true);})()`,
  );
  await gm.evaluate(
    `(async()=>{window.approvalTable=await new Colyseus.Client(location.origin).joinOrCreate('table',${JSON.stringify({ code: approval.code, token: owner.token })});approvalTable.send('admit',{userId:${JSON.stringify(String(viewer.user.id))}});})()`,
  );
  await waitFor(
    () => outsider.evaluate('window.admitted === true'),
    'lobby admission notification',
  );
  await gm.evaluate('approvalTable.leave()');
  console.log(
    'PASS actual server: editor gating, live promotion/demotion, pending lobby admission',
  );

  // Capture the real application room without replacing its production callbacks.
  const actual = await sdkPage();
  await browser.send(
    'Page.addScriptToEvaluateOnNewDocument',
    {
      source: `
    localStorage.setItem('tabletop.token', ${JSON.stringify(player.token)});
    let notify;
    Object.defineProperty(window, 'onOttRoom', {
      configurable:true,
      set(fn) { notify=fn; },
      get() { return (room,...args) => { window.actualRoom=room; window.reconnects=0; room.onReconnect(()=>window.reconnects++); notify?.(room,...args); }; }
    });
  `,
    },
    actual.sessionId,
  );
  await browser.send(
    'Page.navigate',
    { url: origin + '/table.html?room=' + record.code },
    actual.sessionId,
  );
  await waitFor(
    () =>
      actual.evaluate(
        '!!window.actualRoom && document.querySelectorAll("#hand .handcard").length === 1',
      ),
    'restored private hand in production client',
  );
  assert.equal(await actual.evaluate('actualRoom.roomId'), table.id);
  await actual.evaluate(`actualRoom.send('drawToHand', {deckId:${JSON.stringify(deckId)}})`);
  await waitFor(
    () => actual.evaluate('document.querySelectorAll("#hand .handcard").length === 2'),
    'private draw through shipped SDK',
  );
  noPacketSecrets(outsider, ['SECRET_DECK_', 'SECRET_HIDDEN_FACE', 'SECRET_PRIVATE_HAND']);
  await actual.evaluate(
    `actualRoom.send('showStart',{hids:'all',to:[${JSON.stringify(table.sid)}]})`,
  );
  await waitFor(
    async () => (await received(gm, 'showFan')).length > 0,
    'restricted Show recipient',
  );
  noPacketSecrets(outsider, ['SECRET_DECK_', 'SECRET_HIDDEN_FACE', 'SECRET_PRIVATE_HAND']);
  await actual.evaluate("actualRoom.send('showStop')");
  await gm.evaluate(
    `room.send('setPieceVisibility', {ids:[${JSON.stringify(deckId)}],hidden:true})`,
  );
  await waitFor(
    async () => Object.keys((await state(outsider))?.pieces || {}).length === 0,
    'entirely hidden reflected collection',
  );
  await gm.evaluate(
    `room.send('setPieceVisibility', {ids:[${JSON.stringify(deckId)}],hidden:false})`,
  );
  await waitFor(
    async () => Object.keys((await state(outsider))?.pieces || {}).length === 1,
    'revealed reflected collection',
  );
  console.log('PASS shipped SDK: private draw and hidden/revealed empty collection patches');

  const oldToken = await actual.evaluate('actualRoom.reconnectionToken');
  await actual.evaluate(
    `Object.assign(actualRoom.reconnection,{minUptime:0,minDelay:50,maxDelay:50,delay:50});actualRoom.connection.close(4010)`,
  );
  await waitFor(() => actual.evaluate('window.reconnects === 1'), 'automatic SDK reconnect');
  await waitFor(
    () =>
      actual.evaluate(
        `actualRoom.reconnectionToken !== ${JSON.stringify(oldToken)} && sessionStorage.getItem(${JSON.stringify('tt_token:' + record.code)}) === actualRoom.reconnectionToken`,
      ),
    'refreshed reconnect token persisted by production client',
  );
  await browser.send('Page.reload', {}, actual.sessionId);
  await waitFor(
    () =>
      actual.evaluate(
        '!!window.actualRoom && document.querySelectorAll("#hand .handcard").length === 2',
      ),
    'refresh reconnect private-hand hydration',
  );
  assert.equal(await actual.evaluate('actualRoom.roomId'), table.id);
  console.log(
    'PASS production client: automatic reconnect, rotated token and refresh hand hydration',
  );

  const reconnectToken = await actual.evaluate('actualRoom.reconnectionToken');
  await api('/auth/logout', { token: player.token });
  await waitFor(
    () => actual.evaluate('actualRoom.connection.isOpen === false'),
    'session revocation closes real socket',
  );
  const denied = await outsider.evaluate(
    `(async()=>{try{await new Colyseus.Client(location.origin).reconnect(${JSON.stringify(reconnectToken)});return false;}catch{return true;}})()`,
  );
  assert.equal(denied, true);
  noPacketSecrets(outsider, ['SECRET_DECK_', 'SECRET_HIDDEN_FACE', 'SECRET_PRIVATE_HAND']);
  await gm.evaluate("room.send('stateSave')");
  await waitFor(async () => (await received(gm, 'stateSaved')).length > 0, 'save acknowledgment');
  const saved = (await database.query('SELECT scene FROM rooms WHERE id=$1', [record.id])).rows[0]
    .scene;
  assert.ok(JSON.stringify(saved).includes('SECRET_PRIVATE_HAND'));
  assert.ok(JSON.stringify(saved).includes('SECRET_DECK_TOP'));
  assert.deepEqual(actual.errors, []);
  await actual.close();
  await gm.evaluate('room.leave()');
  await outsider.evaluate('room.leave()');
  await stopServer();
  await startServer();
  const renewed = await api('/auth/login', { login: 'sdk_player', password });
  await joinRoom(gm, owner.token, record.code);
  await joinRoom(outsider, renewed.token, record.code);
  await waitFor(
    async () => (await received(outsider, 'hand')).some((message) => message.data.length === 2),
    'durable account hand after server restart',
  );
  assert.equal(Object.keys((await state(gm)).pieces).length, 2);
  console.log(
    'PASS actual server: revocation rejects reconnect; saved game/private hand survives restart',
  );
  for (const page of [gm, outsider]) assert.deepEqual(page.errors, []);
  assert.ok(!serverLog.includes('TypeError'), 'server reported a runtime TypeError');
  console.log(
    'Multiplayer SDK migration checks passed. Fixture uses memory rate limiting; real devices/load remain manual.',
  );
} finally {
  await browser?.close();
  await stopServer();
  await database.end();
  await rm(scratch, { recursive: true, force: true });
}
