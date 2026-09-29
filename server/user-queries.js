import { readPlacard } from '../shared/placards.js';

export const publicUserRow = (row) =>
  row && {
    id: String(row.id),
    username: row.demo_name ?? row.username,
    email: row.email,
    avatar: row.avatar,
    placard: readPlacard(row.placard),
    isAdmin: row.is_admin,
    hostStatus: row.host_status,
    hasPassword: !!row.password_hash,
    canOwnRooms: row.host_status === 'approved' || row.is_admin,
    ...(row.is_demo
      ? {
          isDemo: true,
          demoRoomId: row.demo_room_id == null ? null : String(row.demo_room_id),
          demoExpiresAt: row.demo_expires_at,
        }
      : {}),
  };
export const authUserRow = (row) =>
  row && { ...publicUserRow(row), passwordHash: row.password_hash };

// Successful absence remains null/[]/0. Query rejection is deliberately not
// caught, so authentication and admin routes cannot mistake an outage for data.
export function createUserQueries(query) {
  return {
    async findUserByLogin(login) {
      const { rows } = await query(
        'SELECT * FROM users WHERE lower(username) = lower($1) OR lower(email) = lower($1) LIMIT 1',
        [login],
      );
      return authUserRow(rows[0]) || null;
    },

    async findUserByToken(tokenHash) {
      if (!tokenHash) return null;
      const { rows } = await query(
        `SELECT u.*, g.display_name AS demo_name, g.room_id AS demo_room_id, d.expires_at AS demo_expires_at FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN demo_guests g ON g.user_id=u.id
         LEFT JOIN demo_rooms d ON d.room_id=g.room_id
         LEFT JOIN rooms r ON r.id=d.room_id
         WHERE s.token_hash = $1 AND s.expires_at > clock_timestamp()
         AND (NOT u.is_demo OR (d.closed_at IS NULL AND r.deleted_at IS NULL
           AND d.expires_at>clock_timestamp()
           AND (d.idle_expires_at IS NULL OR d.idle_expires_at>clock_timestamp())))`,
        [tokenHash],
      );
      return publicUserRow(rows[0]) || null;
    },

    async findUserById(id) {
      const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
      return publicUserRow(rows[0]) || null;
    },

    async listUsers() {
      const { rows } = await query('SELECT * FROM users ORDER BY created_at');
      return rows.map((row) => ({ ...publicUserRow(row), createdAt: row.created_at }));
    },

    async countPendingHosts() {
      const { rows } = await query(
        "SELECT count(*)::int AS n FROM users WHERE host_status = 'pending' AND is_admin = false",
      );
      return rows[0].n;
    },

    async roomsOwnedBy(userId) {
      const { rows } = await query('SELECT id, code FROM rooms WHERE owner_id = $1', [userId]);
      return rows.map((row) => ({ id: String(row.id), code: row.code }));
    },
  };
}
