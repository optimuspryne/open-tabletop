import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import express from 'express';
import { matchMaker, ClientState, getMessageBytes, Protocol } from '@colyseus/core';
import { WebSocketClient } from '@colyseus/ws-transport';
import { createAssetFilesRouter } from '../server/http/routes/asset-files.js';
import { DEFAULT_ROOM_STATE } from '../server/room-queries.js';
import { hashToken } from '../auth.js';

const filename = '0123456789abcdef01';

test('asset HTTP boundary serves generated media with safe types and rejects encoded metadata/scripts', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ott-assets-test-'));
  await mkdir(path.join(dir, 'decks'));
  for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'glb', 'json', 'html', 'js', 'svg'])
    await writeFile(path.join(dir, 'decks', `${filename}.${ext}`), 'fixture');
  await writeFile(path.join(dir, 'decks', 'legacy.json'), 'fixture secret');
  const app = express();
  app.use('/assets', createAssetFilesRouter({ assetsDir: dir, assetKinds: ['decks'] }));
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}/assets/`;
  for (const [ext, type] of Object.entries({
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    glb: 'model/gltf-binary',
  })) {
    const response = await fetch(`${origin}decks/${filename}.${ext}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), type);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-security-policy'), /sandbox/);
    await response.text();
  }
  for (const suffix of [
    'decks/legacy.json',
    'decks/legacy%2ejson',
    ...['html', 'js', 'json', 'svg'].flatMap((ext) => [
      `decks/${filename}.${ext}`,
      `decks/${filename}%2e${ext}`,
    ]),
    `decks%2f${filename}.png`,
    `decks%5c${filename}.png`,
    `decks/%252e%252e/${filename}.png`,
    `decks/${filename}.png%00.html`,
    `unknown/${filename}.png`,
    '.texture-cache/private.json',
    'decks/%',
    'decks/%C0%AE',
  ]) {
    const response = await fetch(origin + suffix);
    assert.equal(response.status, 404, suffix);
    assert.doesNotMatch(await response.text(), /fixture secret/);
  }
  const encodedImage = await fetch(`${origin}decks/${filename}%2epng`);
  assert.equal(encodedImage.status, 200);
  await encodedImage.text();
});

function transport(sessionId) {
  const socket = new EventEmitter();
  socket.readyState = 1;
  socket.send = () => {};
  socket.close = (code) => {
    if (socket.readyState === 3) return;
    socket.readyState = 3;
    socket.emit('close', code);
  };
  return new WebSocketClient(sessionId, socket);
}

// Exercise the production classes and registration through real Colyseus HTTP.
// Replace only the database/storage and omit application startup (migrations/listen).
async function isolatedServer(dir, db) {
  const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
  const lobbyStart = source.indexOf('class LobbyRoom extends Room');
  let fixture =
    source.slice(0, source.indexOf('// --- Boot: Colyseus')) +
    '\n' +
    source.slice(lobbyStart, source.indexOf('const PORT ='));
  fixture = fixture.replace(
    "import * as db from './db.js';",
    'const db = globalThis.__securityTestDb;',
  );
  fixture = fixture.replace("process.env.ASSETS_DIR || './saved-assets'", JSON.stringify(dir));
  fixture = fixture.replace(
    'const gameServer = new Server({',
    'const httpServer = createServer();\nconst gameServer = new Server({ greet: false,',
  );
  fixture = fixture.replace(/from '([^']+)'/g, (_match, specifier) => {
    const resolved = specifier.startsWith('.')
      ? new URL('../' + specifier, import.meta.url).href
      : import.meta.resolve(specifier);
    return `from '${resolved}'`;
  });
  fixture += '\nexport { gameServer, httpServer, TableRoom, roomAccess, ROOM_WRITERS };\n';
  const file = path.join(dir, 'server-fixture.mjs');
  await writeFile(file, fixture);
  globalThis.__securityTestDb = db;
  try {
    return await import(pathToFileURL(file));
  } finally {
    delete globalThis.__securityTestDb;
  }
}

test('production HTTP matchmaking authenticates before allocation and preserves one durable writer', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ott-room-test-'));
  let stateReads = 0;
  let stored = { ...structuredClone(DEFAULT_ROOM_STATE), notes: 'initial' };
  const writes = [];
  let validToken = true;
  let isAdmin = false;
  let membership = { status: 'admitted', role: 'owner', participation: 'player' };
  const db = {
    async findUserByToken(token) {
      return validToken && token === hashToken('valid')
        ? { id: 'user', username: 'test', isAdmin }
        : null;
    },
    async findRoomByCode(code) {
      return ['A', 'B'].includes(code) ? { id: `db-${code}`, code, name: 'Test' } : null;
    },
    async getMembership() {
      return membership;
    },
    async getRoomState() {
      stateReads++;
      return structuredClone(stored);
    },
    async saveRoomState(id, payload) {
      writes.push({ id, notes: payload.notes });
      stored = structuredClone(payload);
      return { rowCount: 1 };
    },
    async insertDeck() {
      assert.fail('legacy saver must not insert a library record');
    },
    async listMembers() {
      return [];
    },
    async setSelfParticipation({ participation }) {
      membership = { ...membership, participation };
      return { participation };
    },
  };
  const { gameServer, httpServer, roomAccess, ROOM_WRITERS } = await isolatedServer(dir, db);
  t.after(async () => {
    await gameServer.gracefullyShutdown(false);
    await rm(dir, { recursive: true, force: true });
  });
  await gameServer.listen(0, '127.0.0.1');
  const origin = `http://127.0.0.1:${httpServer.address().port}`;
  async function request(method, name, options) {
    const response = await fetch(`${origin}/matchmake/${method}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
    return { status: response.status, body: await response.json() };
  }
  for (const [method, name, options] of [
    ['create', 'table', { code: 'A' }],
    ['create', 'table', { code: 'A', token: 'valid' }],
    ['joinOrCreate', 'table', { code: 'A' }],
    ['joinOrCreate', 'table', { code: 'A', token: 'bad' }],
    ['joinOrCreate', 'table', { code: {}, token: 'valid' }],
    ['joinOrCreate', 'editor', { token: 'valid' }],
    ['joinOrCreate', 'lobby', { code: 'A', token: 'valid' }],
  ])
    assert.notEqual((await request(method, name, options)).status, 200);
  membership = { status: 'pending', role: 'player' };
  assert.equal((await request('joinOrCreate', 'table', { code: 'A', token: 'valid' })).status, 403);
  membership = { status: 'admitted', role: 'owner', participation: 'player' };
  assert.equal(stateReads, 0);
  assert.equal(ROOM_WRITERS.size, 0);
  const results = await Promise.all(
    Array.from({ length: 3 }, () =>
      request('joinOrCreate', 'table', { code: 'A', token: 'valid' }),
    ),
  );
  for (const result of results) assert.equal(result.status, 200);
  assert.equal(new Set(results.map((result) => result.body.roomId)).size, 1);
  assert.equal(stateReads, 1);
  const room = matchMaker.getLocalRoomById(results[0].body.roomId);
  assert.notEqual(room.roomId, room.persistentRoomId);
  assert.equal(room.persistentRoomId, 'db-A');
  // An internal duplicate still cannot obtain a second writer or read stale state.
  await assert.rejects(matchMaker.createRoom('table', { code: 'A', token: 'valid' }), {
    code: 409,
  });
  assert.equal(stateReads, 1);
  assert.equal(ROOM_WRITERS.get('db-A'), room);
  assert.equal(matchMaker.getLocalRoomById(room.roomId), room);
  // Reservation-time auth is not sufficient once the token is revoked.
  validToken = false;
  await assert.rejects(room._onJoin(transport(results[0].body.sessionId), {}), { code: 401 });
  validToken = true;
  const crossRoom = await request('joinById', room.roomId, { code: 'B', token: 'valid' });
  await assert.rejects(room._onJoin(transport(crossRoom.body.sessionId), {}), { code: 403 });
  const spectator = await request('joinOrCreate', 'table', {
    code: 'A',
    token: 'valid',
    participation: 'spectator',
  });
  const client = transport(spectator.body.sessionId);
  await room._onJoin(client, {});
  client.state = ClientState.JOINED;
  delete client._enqueuedMessages;
  assert.equal(client.auth.participation, 'spectator');
  assert.equal(room.state.players.get(client.sessionId).seat, -1);
  roomAccess.assertActive(room, client);
  room.state.notes = 'newer checkpoint';
  await room.saveStateNow();
  assert.deepEqual(writes.at(-1), { id: 'db-A', notes: 'newer checkpoint' });
  roomAccess.revokeSession(hashToken('valid'));
  assert.equal(client.auth.revoked, true);
  // A crafted legacy message from an admin cannot write executable files or records.
  isAdmin = true;
  const editorSeat = await request('joinOrCreate', 'editor', { token: 'valid', code: 'A' });
  assert.equal(editorSeat.status, 200);
  const editor = matchMaker.getLocalRoomById(editorSeat.body.roomId);
  assert.equal(editor.persistentRoomId, null);
  const admin = transport(editorSeat.body.sessionId);
  await editor._onJoin(admin, {});
  admin.state = ClientState.JOINED;
  delete admin._enqueuedMessages;
  const script = 'data:image/js;base64,YWxlcnQoMSk=';
  const piece = editor.spawn('deck', [0, 2, 0], { back: script, cards: [script] });
  editor._onMessage(
    admin,
    getMessageBytes.raw(Protocol.ROOM_DATA, 'saveDeck', { deckId: piece.id, name: 'Exploit' }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await readdir(path.join(dir, 'decks')), []);
  roomAccess.revokeSession(hashToken('valid'));
  isAdmin = false;
  // A room with only unused reservations must never write on disposal.
  const unused = await request('joinOrCreate', 'table', { code: 'B', token: 'valid' });
  const unusedRoom = matchMaker.getLocalRoomById(unused.body.roomId);
  await unusedRoom.disconnect();
  assert.equal(
    writes.some(({ id }) => id === 'db-B'),
    false,
  );
  assert.equal(ROOM_WRITERS.has('db-B'), false);
  // A failed load releases ownership without persisting partially initialized state.
  const readState = db.getRoomState;
  db.getRoomState = async () => {
    throw new Error('fixture state read failed');
  };
  assert.notEqual(
    (await request('joinOrCreate', 'table', { code: 'B', token: 'valid' })).status,
    200,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ROOM_WRITERS.has('db-B'), false);
  assert.equal(
    writes.some(({ id }) => id === 'db-B'),
    false,
  );
  db.getRoomState = readState;
  const retry = await request('joinOrCreate', 'table', { code: 'B', token: 'valid' });
  assert.equal(retry.status, 200);
  await matchMaker.getLocalRoomById(retry.body.roomId).disconnect();

  // Ownership cannot transfer while the last checkpoint is still being written.
  let releaseSave;
  let startedSave;
  const saving = new Promise((resolve) => {
    startedSave = resolve;
  });
  const saveState = db.saveRoomState;
  db.saveRoomState = async (...args) => {
    startedSave();
    await new Promise((resolve) => {
      releaseSave = resolve;
    });
    return saveState(...args);
  };
  room.state.notes = 'final checkpoint';
  const disposing = room.disconnect();
  await saving;
  assert.equal(ROOM_WRITERS.get('db-A'), room);
  await assert.rejects(matchMaker.createRoom('table', { code: 'A', token: 'valid' }), {
    code: 409,
  });
  releaseSave();
  await disposing;
  assert.equal(ROOM_WRITERS.has('db-A'), false);
  db.saveRoomState = saveState;
  const reopened = await request('joinOrCreate', 'table', { code: 'A', token: 'valid' });
  assert.equal(reopened.status, 200);
  const restored = matchMaker.getLocalRoomById(reopened.body.roomId);
  assert.equal(restored.state.notes, 'final checkpoint');
  assert.notEqual(restored.roomId, room.roomId);
  await restored.disconnect();
});
