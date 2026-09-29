import crypto from 'node:crypto';
import { ASSET_TABLES } from './library-queries.js';

export const DEMO_STORAGE_LIMITS = Object.freeze({
  rooms: 5,
  guests: 40,
  guestsPerRoom: 8,
  lifetimeMs: 2 * 60 * 60 * 1000,
  idleMs: 15 * 60 * 1000,
});

export class DemoError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const live = `d.closed_at IS NULL AND r.deleted_at IS NULL
  AND d.expires_at > clock_timestamp()
  AND (d.idle_expires_at IS NULL OR d.idle_expires_at > clock_timestamp())`;
const tableShape = (row) => ({
  roomId: String(row.room_id),
  code: row.code,
  name: row.name,
  starter: row.starter,
  expiresAt: row.expires_at,
  idleExpiresAt: row.idle_expires_at,
});
const hash = (value) => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw new DemoError('invalid', 'Invalid credential hash.');
  return value;
};
const id = (value) => {
  if (
    typeof value !== 'string' ||
    !/^[1-9][0-9]{0,18}$/.test(value) ||
    BigInt(value) > 9223372036854775807n
  )
    throw new DemoError('invalid', 'Invalid table ID.');
  return value;
};
const name = (value) => {
  if (typeof value !== 'string') throw new DemoError('invalid', 'A guest name is required.');
  const normalized = value.trim();
  if (!normalized || normalized.length > 20 || /[\x00-\x1f\x7f]/.test(normalized))
    throw new DemoError('invalid', 'Guest names must contain 1–20 printable characters.');
  return normalized;
};

// No routes register this API yet. The future demo HTTP/runtime boundary must
// enforce IP/rate limits and block non-demo write paths before exposing guests.
export function createDemoQueries(pool, limits = DEMO_STORAGE_LIMITS) {
  for (const key of Object.keys(DEMO_STORAGE_LIMITS)) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1)
      throw new Error(`Invalid demo storage limit: ${key}`);
  }
  limits = Object.freeze({ ...limits });

  async function transaction(run) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Small single-instance demo: serialize allocation, invite exchange, expiry
      // and purge together. Check capacity before inserting any identity/inventory.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('open-tabletop:demo'))");
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function checkCapacity(client, roomId = null) {
    const { rows } = await client.query(
      `SELECT
      (SELECT count(*)::int FROM demo_rooms) AS rooms,
      (SELECT count(*)::int FROM users WHERE is_demo) AS guests,
      (SELECT count(*)::int FROM demo_guests WHERE room_id = $1) AS room_guests`,
      [roomId],
    );
    const count = rows[0];
    // Include expired-but-not-purged data: a failed sweeper cannot cause unbounded growth.
    if (
      (!roomId && count.rooms >= limits.rooms) ||
      count.guests >= limits.guests ||
      (roomId && count.room_guests >= limits.guestsPerRoom)
    )
      throw new DemoError('capacity', 'The demo is full. Please try again shortly.');
  }

  async function insertGuest(client, displayName, sessionHash, expiresAt) {
    const { rows } = await client.query(
      `INSERT INTO users(username,email,is_demo) VALUES ($1,NULL,true) RETURNING id`,
      [`g_${crypto.randomBytes(8).toString('hex')}`],
    );
    const userId = String(rows[0].id);
    await client.query(
      'INSERT INTO user_sessions(user_id,token_hash,expires_at) VALUES ($1,$2,$3)',
      [userId, sessionHash, expiresAt],
    );
    await client.query('INSERT INTO demo_guests(user_id,display_name) VALUES ($1,$2)', [
      userId,
      displayName,
    ]);
    return userId;
  }

  async function findSession(query, sessionHash, lock = false) {
    const { rows } = await query(
      `SELECT d.*, r.code, r.name, g.user_id, g.display_name, m.role
      FROM user_sessions s JOIN users u ON u.id=s.user_id AND u.is_demo
      JOIN demo_guests g ON g.user_id=u.id JOIN demo_rooms d ON d.room_id=g.room_id
      JOIN rooms r ON r.id=d.room_id
      JOIN room_members m ON m.room_id=r.id AND m.user_id=u.id AND m.status='admitted'
      WHERE s.token_hash=$1 AND s.expires_at>clock_timestamp() AND ${live}
      ${lock ? 'FOR UPDATE OF s,u,m,d,r' : ''}`,
      [sessionHash],
    );
    const row = rows[0];
    return row
      ? {
          ...tableShape(row),
          userId: String(row.user_id),
          displayName: row.display_name,
          role: row.role,
        }
      : null;
  }

  async function createTable({ displayName, sessionHash, inviteHash, starter = 'empty' }) {
    displayName = name(displayName);
    hash(sessionHash);
    hash(inviteHash);
    if (sessionHash === inviteHash)
      throw new DemoError('invalid', 'Session and invite credentials must be distinct.');
    if (!['empty', 'dice', 'cards', 'chess'].includes(starter))
      throw new DemoError('invalid', 'Unknown starter table.');
    return transaction(async (client) => {
      await checkCapacity(client);
      const times = (
        await client.query(
          `SELECT
        clock_timestamp()+$1*interval '1 millisecond' AS expiry,
        clock_timestamp()+$2*interval '1 millisecond' AS idle`,
          [limits.lifetimeMs, limits.idleMs],
        )
      ).rows[0];
      const userId = await insertGuest(client, displayName, sessionHash, times.expiry);
      const room = (
        await client.query(
          `INSERT INTO rooms(owner_id,code,name,require_approval)
        VALUES ($1,$2,$3,true) RETURNING id,code,name`,
          [userId, crypto.randomBytes(16).toString('hex').toUpperCase(), `${displayName}'s table`],
        )
      ).rows[0];
      const demo = (
        await client.query(
          `INSERT INTO demo_rooms(room_id,invite_hash,starter,expires_at,idle_expires_at)
        VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [room.id, inviteHash, starter, times.expiry, times.idle],
        )
      ).rows[0];
      await client.query('UPDATE demo_guests SET room_id=$2 WHERE user_id=$1', [userId, room.id]);
      await client.query(
        "INSERT INTO room_members(room_id,user_id,role,status) VALUES ($1,$2,'owner','admitted')",
        [room.id, userId],
      );
      return { ...tableShape({ ...demo, ...room }), userId, displayName, role: 'owner' };
    });
  }

  async function joinInvite({ displayName, sessionHash, inviteHash }) {
    displayName = name(displayName);
    hash(sessionHash);
    hash(inviteHash);
    if (sessionHash === inviteHash)
      throw new DemoError('invalid', 'Session and invite credentials must be distinct.');
    return transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT d.*, r.code, r.name FROM demo_rooms d
        JOIN rooms r ON r.id=d.room_id WHERE d.invite_hash=$1 AND ${live} FOR UPDATE OF d,r`,
        [inviteHash],
      );
      const room = rows[0];
      if (!room) throw new DemoError('expired', 'This invite has expired.');
      await checkCapacity(client, room.room_id);
      const userId = await insertGuest(client, displayName, sessionHash, room.expires_at);
      await client.query('UPDATE demo_guests SET room_id=$2 WHERE user_id=$1', [
        userId,
        room.room_id,
      ]);
      await client.query(
        "INSERT INTO room_members(room_id,user_id,role,status) VALUES ($1,$2,'player','admitted')",
        [room.room_id, userId],
      );
      return { ...tableShape(room), userId, displayName, role: 'player' };
    });
  }

  async function resume(sessionHash) {
    hash(sessionHash);
    return findSession(pool.query.bind(pool), sessionHash);
  }

  async function rotateInvite({ sessionHash, inviteHash }) {
    hash(sessionHash);
    hash(inviteHash);
    if (sessionHash === inviteHash)
      throw new DemoError('invalid', 'Session and invite credentials must be distinct.');
    return transaction(async (client) => {
      const session = await findSession(client.query.bind(client), sessionHash, true);
      if (!session || session.role !== 'owner')
        throw new DemoError('forbidden', 'Host access required.');
      const result = await client.query(
        `UPDATE demo_rooms d SET invite_hash=$2 FROM rooms r
        WHERE d.room_id=$1 AND r.id=d.room_id AND r.owner_id=$3 AND ${live} RETURNING d.room_id`,
        [session.roomId, inviteHash, session.userId],
      );
      if (!result.rowCount) throw new DemoError('expired', 'This table has expired.');
      return true;
    });
  }

  // Runtime-only hooks; callers derive occupancy from authorized connections,
  // never a client heartbeat. Repeated empty updates cannot extend idle expiry.
  async function setOccupied(roomId, occupied) {
    id(roomId);
    if (typeof occupied !== 'boolean') throw new DemoError('invalid', 'Invalid occupancy.');
    return transaction(async (client) => {
      const result = await client.query(
        `UPDATE demo_rooms d SET idle_expires_at=
        CASE WHEN $2 THEN NULL ELSE COALESCE(d.idle_expires_at, clock_timestamp()+$3*interval '1 millisecond') END
        FROM rooms r WHERE d.room_id=$1 AND r.id=d.room_id AND ${live} RETURNING d.room_id`,
        [roomId, occupied, limits.idleMs],
      );
      return result.rowCount === 1;
    });
  }

  async function closeExpired() {
    return transaction(async (client) => {
      await client.query(`UPDATE demo_rooms d SET closed_at=clock_timestamp() FROM rooms r
        WHERE r.id=d.room_id AND d.closed_at IS NULL AND
        (r.deleted_at IS NOT NULL OR d.expires_at<=clock_timestamp() OR d.idle_expires_at<=clock_timestamp())`);
      await client.query(`DELETE FROM user_sessions s USING users u, demo_guests g
        WHERE s.user_id=u.id AND u.is_demo AND g.user_id=u.id AND
        (g.room_id IS NULL OR EXISTS (SELECT 1 FROM demo_rooms d WHERE d.room_id=g.room_id AND d.closed_at IS NOT NULL))`);
      const { rows } =
        await client.query(`SELECT d.room_id,r.code FROM demo_rooms d JOIN rooms r ON r.id=d.room_id
        WHERE d.closed_at IS NOT NULL ORDER BY d.room_id`);
      // Return unpurged closed rooms again after a crash/failed disposal, for retry.
      return rows.map((row) => ({ roomId: String(row.room_id), code: row.code }));
    });
  }

  async function deleteGuests(client, userIds) {
    if (!userIds.length) return;
    for (const table of Object.values(ASSET_TABLES))
      await client.query(`UPDATE ${table} SET owner_id=NULL WHERE owner_id=ANY($1::bigint[])`, [
        userIds,
      ]);
    await client.query('DELETE FROM users WHERE is_demo AND id=ANY($1::bigint[])', [userIds]);
  }

  // Runtime must finish disposal/final writes first and recheck that no local
  // writer exists. Default-deny; no request payload may provide this callback.
  async function purgeClosed(roomId, { canPurge = () => false } = {}) {
    id(roomId);
    return transaction(async (client) => {
      const closed = await client.query(
        'SELECT room_id FROM demo_rooms WHERE room_id=$1 AND closed_at IS NOT NULL FOR UPDATE',
        [roomId],
      );
      if (!closed.rowCount) return false;
      const { rows } = await client.query(
        `SELECT u.id FROM users u JOIN demo_guests g ON g.user_id=u.id
        WHERE u.is_demo AND g.room_id=$1 FOR UPDATE OF u,g`,
        [roomId],
      );
      if (canPurge(roomId) !== true)
        throw new DemoError('busy', 'Table disposal has not finished.');
      await client.query('DELETE FROM rooms WHERE id=$1', [roomId]);
      await deleteGuests(
        client,
        rows.map((row) => String(row.id)),
      );
      if (canPurge(roomId) !== true)
        throw new DemoError('busy', 'Table disposal has not finished.');
      return true;
    });
  }

  async function purgeOrphans() {
    return transaction(async (client) => {
      const { rows } =
        await client.query(`SELECT u.id FROM users u JOIN demo_guests g ON g.user_id=u.id
        WHERE u.is_demo AND g.room_id IS NULL AND NOT EXISTS (SELECT 1 FROM rooms r WHERE r.owner_id=u.id)
        FOR UPDATE OF u,g`);
      await deleteGuests(
        client,
        rows.map((row) => String(row.id)),
      );
      return rows.length;
    });
  }

  return {
    createTable,
    joinInvite,
    resume,
    rotateInvite,
    setOccupied,
    closeExpired,
    purgeClosed,
    purgeOrphans,
  };
}
