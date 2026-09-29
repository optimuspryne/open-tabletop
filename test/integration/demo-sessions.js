import { after, afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { createDatabase } from '../../server/database.js';
import { createDemoQueries, DEMO_STORAGE_LIMITS } from '../../server/demo-queries.js';
import { createRoomAccess } from '../../server/room-access.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !new URL(connectionString).pathname.endsWith('_test'))
  throw new Error('Demo integration tests require a database ending in _test');
const pool = new pg.Pool({ connectionString });
const db = createDatabase(pool);
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
let serial = 0;
const credentials = () => {
  const token = `demo-test-${++serial}`;
  return {
    displayName: 'Alex',
    sessionHash: digest(token),
    inviteHash: digest(`${token}-invite`),
    token,
  };
};
const countGuests = async () =>
  (await pool.query('SELECT count(*)::int AS n FROM users WHERE is_demo')).rows[0].n;

afterEach(async () => {
  await pool.query('UPDATE demo_rooms SET closed_at=clock_timestamp()');
  for (const row of await db.demo.closeExpired())
    await db.demo.purgeClosed(row.roomId, { canPurge: () => true });
  await db.demo.purgeOrphans();
});
after(() => db.close());

test('atomic guest allocation uses existing sessions/memberships and preserves host privilege boundaries', async () => {
  const hostKeys = credentials();
  const table = await db.demo.createTable({ ...hostKeys, starter: 'chess' });
  const user = await db.findUserByToken(hostKeys.sessionHash);
  assert.equal(user.username, 'Alex');
  assert.equal((await db.listMembers(table.roomId))[0].username, 'Alex');
  assert.equal(user.isDemo, true);
  assert.equal(user.email, null);
  assert.equal(user.isAdmin, false);
  assert.equal(user.hasPassword, false);
  assert.equal(user.canOwnRooms, false);
  assert.equal(user.demoRoomId, table.roomId);
  assert.equal((await db.getMembership(table.roomId, user.id)).role, 'owner');
  assert.equal((await db.demo.resume(hostKeys.sessionHash)).roomId, table.roomId);
  assert.equal(table.inviteHash, undefined);
  assert.equal(table.sessionHash, undefined);
  const stored = (await pool.query('SELECT * FROM demo_rooms WHERE room_id=$1', [table.roomId]))
    .rows[0];
  assert.equal(stored.invite_hash, hostKeys.inviteHash);
  assert.ok(
    Math.abs(table.expiresAt.getTime() - Date.now() - DEMO_STORAGE_LIMITS.lifetimeMs) < 5000,
  );
  for (const sql of [
    'UPDATE users SET is_admin=true WHERE id=$1',
    "UPDATE users SET host_status='approved' WHERE id=$1",
    "UPDATE users SET password_hash='forbidden' WHERE id=$1",
  ])
    await assert.rejects(pool.query(sql, [user.id]), { code: '23514' });
  // New factory simulates a process restart: durable credentials still resume.
  assert.equal((await createDatabase(pool).demo.resume(hostKeys.sessionHash)).userId, user.id);
});

test('concurrent table allocation cannot oversubscribe storage and duplicate credentials roll back', async () => {
  const keys = Array.from({ length: 12 }, credentials);
  const results = await Promise.allSettled(keys.map((value) => db.demo.createTable(value)));
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    DEMO_STORAGE_LIMITS.rooms,
  );
  for (const result of results.filter((result) => result.status === 'rejected'))
    assert.equal(result.reason.code, 'capacity');
  assert.equal(await countGuests(), DEMO_STORAGE_LIMITS.rooms);
  // Expired-but-unpurged records keep consuming storage until cleanup succeeds.
  await pool.query("UPDATE demo_rooms SET expires_at=clock_timestamp()-interval '1 second'");
  await assert.rejects(db.demo.createTable(credentials()), { code: 'capacity' });
});

test('failed insertion rolls back its newly allocated guest without consuming capacity', async () => {
  const keys = credentials();
  await db.demo.createTable(keys);
  await assert.rejects(db.demo.createTable({ ...credentials(), inviteHash: keys.inviteHash }), {
    code: '23505',
  });
  await assert.rejects(db.demo.createTable({ ...credentials(), sessionHash: keys.sessionHash }), {
    code: '23505',
  });
  assert.equal(await countGuests(), 1);
  await db.demo.createTable(credentials());
  assert.equal(await countGuests(), 2);
});

test('global identity and per-table guest quotas are atomic and include the host', async () => {
  const small = createDemoQueries(pool, { ...DEMO_STORAGE_LIMITS, guests: 2 });
  const keys = credentials();
  await small.createTable(keys);
  const joining = await Promise.allSettled(
    Array.from({ length: 5 }, () =>
      small.joinInvite({ ...credentials(), inviteHash: keys.inviteHash }),
    ),
  );
  assert.equal(joining.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(await countGuests(), 2);
  const bounded = createDemoQueries(pool, { ...DEMO_STORAGE_LIMITS, guestsPerRoom: 3 });
  const more = await Promise.allSettled(
    Array.from({ length: 8 }, () =>
      bounded.joinInvite({ ...credentials(), inviteHash: keys.inviteHash }),
    ),
  );
  assert.equal(more.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(await countGuests(), 3);
});

test('invites admit players, rotate only with live host authority, and never reveal host sessions', async () => {
  const keys = credentials();
  const table = await db.demo.createTable(keys);
  const guestKeys = credentials();
  const guest = await db.demo.joinInvite({ ...guestKeys, inviteHash: keys.inviteHash });
  assert.equal(guest.role, 'player');
  assert.equal(guest.roomId, table.roomId);
  assert.notEqual(guest.userId, table.userId);
  await assert.rejects(
    db.demo.rotateInvite({ sessionHash: guestKeys.sessionHash, inviteHash: digest('replacement') }),
    { code: 'forbidden' },
  );
  await db.demo.rotateInvite({ sessionHash: keys.sessionHash, inviteHash: digest('replacement') });
  await assert.rejects(db.demo.joinInvite({ ...credentials(), inviteHash: keys.inviteHash }), {
    code: 'expired',
  });
  await db.demo.joinInvite({ ...credentials(), inviteHash: digest('replacement') });
  assert.equal((await db.demo.resume(guestKeys.sessionHash)).role, 'player');
  assert.equal(await countGuests(), 3);
});

test('idle deadlines do not extend on repeated empty updates and expired tables cannot be revived', async () => {
  const keys = credentials();
  const table = await db.demo.createTable(keys);
  assert.equal(await db.demo.setOccupied(table.roomId, true), true);
  assert.equal((await db.demo.resume(keys.sessionHash)).idleExpiresAt, null);
  await db.demo.setOccupied(table.roomId, false);
  const first = await db.demo.resume(keys.sessionHash);
  await db.demo.setOccupied(table.roomId, false);
  assert.deepEqual((await db.demo.resume(keys.sessionHash)).idleExpiresAt, first.idleExpiresAt);
  await pool.query(
    "UPDATE demo_rooms SET idle_expires_at=clock_timestamp()-interval '1 second' WHERE room_id=$1",
    [table.roomId],
  );
  assert.equal(await db.demo.setOccupied(table.roomId, true), false);
  assert.equal(await db.demo.resume(keys.sessionHash), null);
  assert.equal(await db.findUserByToken(keys.sessionHash), null);
  await assert.rejects(db.demo.joinInvite({ ...credentials(), inviteHash: keys.inviteHash }), {
    code: 'expired',
  });
});

test('absolute expiry rejects authentication before sweeping and survives new database factories', async () => {
  const keys = credentials();
  const table = await db.demo.createTable(keys);
  await db.demo.setOccupied(table.roomId, true);
  await pool.query(
    "UPDATE demo_rooms SET expires_at=clock_timestamp()-interval '1 second' WHERE room_id=$1",
    [table.roomId],
  );
  assert.equal(await createDatabase(pool).findUserByToken(keys.sessionHash), null);
  assert.equal(await db.demo.resume(keys.sessionHash), null);
  assert.deepEqual(await db.demo.closeExpired(), [{ roomId: table.roomId, code: table.code }]);
  assert.deepEqual(await db.demo.closeExpired(), [{ roomId: table.roomId, code: table.code }]);
  assert.equal(
    (
      await pool.query('SELECT count(*)::int AS n FROM user_sessions WHERE user_id=$1', [
        table.userId,
      ])
    ).rows[0].n,
    0,
  );
});

test('purge waits for runtime disposal, rolls back a changed guard, and preserves ordinary users and assets', async () => {
  const keys = credentials();
  const table = await db.demo.createTable(keys);
  const permanent = await db.createUser({
    username: 'demo-test-permanent',
    email: 'demo-test@example.test',
  });
  const permanentRoom = await db.createRoom({
    ownerId: permanent.id,
    code: 'DEMO-PERMANENT',
    name: 'Keep',
  });
  const assetId = await db.insertDeck({
    name: 'Keep shared asset',
    back: 'back',
    fronts: ['front'],
    ownerId: table.userId,
    isPublic: true,
  });
  assert.equal(await db.demo.purgeClosed(table.roomId, { canPurge: () => true }), false);
  await pool.query('UPDATE demo_rooms SET closed_at=clock_timestamp() WHERE room_id=$1', [
    table.roomId,
  ]);
  await db.demo.closeExpired();
  await assert.rejects(db.demo.purgeClosed(table.roomId), { code: 'busy' });
  let calls = 0;
  await assert.rejects(db.demo.purgeClosed(table.roomId, { canPurge: () => ++calls === 1 }), {
    code: 'busy',
  });
  assert.ok(await db.getRoom(table.roomId));
  assert.ok(await db.findUserById(table.userId));
  assert.equal(await db.demo.purgeClosed(table.roomId, { canPurge: () => true }), true);
  assert.equal(await db.demo.purgeClosed(table.roomId, { canPurge: () => true }), false);
  assert.equal(await db.getRoom(table.roomId), null);
  assert.equal(await db.findUserById(table.userId), null);
  assert.ok(await db.getRoom(permanentRoom.id));
  assert.ok(await db.findUserById(permanent.id));
  const asset = (
    await pool.query('SELECT owner_id,is_public FROM custom_decks WHERE id=$1', [assetId])
  ).rows[0];
  assert.equal(asset.owner_id, null);
  assert.equal(asset.is_public, true);
});

test('administratively purged rooms leave collectable guest markers with unusable sessions', async () => {
  const keys = credentials();
  const table = await db.demo.createTable(keys);
  await db.purgeRoom(table.roomId);
  assert.equal(await db.findUserByToken(keys.sessionHash), null);
  assert.equal(await db.demo.resume(keys.sessionHash), null);
  assert.equal(await db.demo.purgeOrphans(), 1);
  assert.equal(await db.demo.purgeOrphans(), 0);
  assert.equal(await countGuests(), 0);
});

test('a demo guest cannot use a forged cross-room membership to enter another table', async () => {
  const keys = credentials();
  const first = await db.demo.createTable(keys);
  const second = await db.demo.createTable(credentials());
  await db.joinRoom({ roomId: second.roomId, userId: first.userId, requireApproval: false });
  const access = createRoomAccess({ db, hashToken: digest });
  const good = await access.preflight({ code: first.code, token: keys.token });
  assert.equal(good.userId, first.userId);
  await assert.rejects(access.preflight({ code: second.code, token: keys.token }), { code: 403 });
});

test('restart occupancy recovery uses the durable heartbeat and cannot extend an existing idle deadline', async () => {
  const keys = credentials();
  const table = await db.demo.createTable(keys);
  await db.demo.setOccupied(table.roomId, true);
  const occupied = await db.demo.roomState(table.roomId);
  assert.equal(occupied.idle_expires_at, null);
  assert.ok(occupied.last_occupied_at instanceof Date);
  await db.demo.recoverOccupancy();
  const recovered = await db.demo.roomState(table.roomId);
  assert.equal(
    recovered.idle_expires_at.getTime(),
    occupied.last_occupied_at.getTime() + DEMO_STORAGE_LIMITS.idleMs,
  );
  await db.demo.recoverOccupancy();
  assert.equal(
    (await db.demo.roomState(table.roomId)).idle_expires_at.getTime(),
    recovered.idle_expires_at.getTime(),
  );
  await pool.query(
    "UPDATE demo_rooms SET idle_expires_at=NULL,last_occupied_at=clock_timestamp()-interval '16 minutes' WHERE room_id=$1",
    [table.roomId],
  );
  await db.demo.recoverOccupancy();
  assert.equal(await db.demo.resume(keys.sessionHash), null);
  assert.equal(await db.demo.setOccupied(table.roomId, true), false);
});
