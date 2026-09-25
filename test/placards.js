import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PLACARD,
  PLACARD_SHAPES,
  PLACARD_PATTERNS,
  normalizePlacard,
  readPlacard,
} from '../shared/placards.js';
import { createRoomAccess } from '../server/room-access.js';
import { registerMemberHandlers } from '../server/game/handlers/members.js';
import { createJoinedPlayer } from '../server/game/player-seats.js';

const style = (shape = 'frog') => ({
  ...DEFAULT_PLACARD,
  shape,
  pattern: 'stars',
  color: '#AA22BB',
});
test('placards accept bounded presets/colors and recover legacy or malformed saved preferences', () => {
  for (const shape of Object.keys(PLACARD_SHAPES))
    for (const pattern of Object.keys(PLACARD_PATTERNS))
      assert.equal(normalizePlacard({ ...style(shape), pattern }).color, '#aa22bb');
  for (const value of [
    null,
    [],
    {},
    { ...style(), shape: '__proto__' },
    { ...style(), pattern: 'constructor' },
    { ...style(), color: 'url(secret)' },
    { ...style(), asset: 'secret' },
  ])
    assert.equal(normalizePlacard(value), null);
  assert.deepEqual(readPlacard('broken'), DEFAULT_PLACARD);
  assert.deepEqual(readPlacard(undefined), DEFAULT_PLACARD);
  assert.deepEqual(readPlacard(JSON.stringify(style())), normalizePlacard(style()));
});

async function fixture() {
  let saved = { ...DEFAULT_PLACARD };
  const writes = [];
  const db = {
    findUserByToken: async () => ({ id: '1', username: 'Ada', placard: saved }),
    findRoomByCode: async () => ({ id: 'r' }),
    getMembership: async () => ({ role: 'player', status: 'admitted' }),
    setUserPlacard: async (id, value) => {
      writes.push([id, value]);
      saved = value;
    },
  };
  const access = createRoomAccess({ db, hashToken: String });
  const rooms = [];
  for (const code of ['A', 'B']) {
    const handlers = new Map();
    const room = {
      roomCode: code,
      state: { players: new Map() },
      onMessage: (name, handler) => handlers.set(name, handler),
    };
    const client = {
      sessionId: code,
      sent: [],
      send(...args) {
        this.sent.push(args);
      },
    };
    client.auth = await access.authorize(room, client, { code, token: 'token' });
    const player = createJoinedPlayer(room, client, { seatFor: () => 0, palette: ['#123456'] });
    registerMemberHandlers(room, { db, roomAccess: access, logger: { error() {} } });
    rooms.push({ room, client, player, handlers });
  }
  return { db, access, rooms, writes };
}

test('production personal request saves only the actor account and updates every live room', async () => {
  const { rooms, writes, access } = await fixture();
  const a = rooms[0];
  a.client.auth.participation = 'spectator';
  a.client.auth.timedOut = true;
  await a.handlers.get('setPlacard')(a.client, style());
  assert.deepEqual(writes, [['1', normalizePlacard(style())]]);
  for (const { player, client } of rooms) {
    assert.deepEqual(JSON.parse(player.placard), normalizePlacard(style()));
    assert.deepEqual(client.auth.placard, normalizePlacard(style()));
  }
  assert.equal(a.client.sent.at(-1)[0], 'placardSaved');
  await access.reconnect(a.room, a.client);
  assert.deepEqual(JSON.parse(a.player.placard), normalizePlacard(style()));
  await a.handlers.get('setPlacard')(a.client, { ...style(), userId: '2' });
  a.client.auth.revoked = true;
  await a.handlers.get('setPlacard')(a.client, style('gecko'));
  assert.equal(writes.length, 1);
});

test('failed saves preserve live appearance and report failure without a success acknowledgment', async () => {
  const { db, rooms } = await fixture();
  db.setUserPlacard = async () => {
    throw new Error('offline');
  };
  const a = rooms[0];
  await a.handlers.get('setPlacard')(a.client, style());
  assert.deepEqual(JSON.parse(a.player.placard), DEFAULT_PLACARD);
  assert.equal(a.client.sent.at(-1)[0], 'serverError');
  assert.equal(
    a.client.sent.some(([name]) => name === 'placardSaved'),
    false,
  );
});

test('queued account saves preserve write ordering and recheck revoked access before mutation', async () => {
  const { db, rooms, access } = await fixture();
  let finish;
  const writes = [];
  db.setUserPlacard = async (_, value) => {
    writes.push(value.shape);
    if (writes.length === 1)
      await new Promise((resolve) => {
        finish = resolve;
      });
  };
  const first = access.savePlacard('1', style('frog'), () => true);
  await new Promise((resolve) => setImmediate(resolve));
  const next = access.savePlacard('1', style('gecko'), () => true);
  const denied = access.savePlacard('1', style('fluffy'), () => false);
  assert.deepEqual(writes, ['frog']);
  finish();
  assert.deepEqual(await Promise.all([first, next, denied]), [true, true, false]);
  assert.deepEqual(writes, ['frog', 'gecko']);
  assert.equal(JSON.parse(rooms[1].player.placard).shape, 'gecko');
});

test('a cosmetic save refreshes an in-flight reconnect without revoking access or restoring stale appearance', async () => {
  const { db, access, rooms } = await fixture();
  const a = rooms[0];
  let finish;
  const original = db.findUserByToken;
  db.findUserByToken = async () => {
    const stale = await original();
    await new Promise((resolve) => {
      finish = resolve;
    });
    return stale;
  };
  const reconnect = access.reconnect(a.room, a.client);
  await new Promise((resolve) => setImmediate(resolve));
  await access.savePlacard('1', normalizePlacard(style()), () => true);
  finish();
  await reconnect;
  assert.equal(a.client.auth.revoked, undefined);
  assert.deepEqual(JSON.parse(a.player.placard), normalizePlacard(style()));
});
