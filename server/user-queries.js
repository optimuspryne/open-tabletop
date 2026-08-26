export const publicUserRow = (row) => row && ({
  id: String(row.id), username: row.username, email: row.email, avatar: row.avatar,
  isAdmin: row.is_admin, hostStatus: row.host_status, hasPassword: !!row.password_hash,
  canOwnRooms: row.host_status === 'approved' || row.is_admin,
});
export const authUserRow = (row) => row && ({ ...publicUserRow(row), passwordHash: row.password_hash });

// Successful absence remains null/[]/0. Query rejection is deliberately not
// caught, so authentication and admin routes cannot mistake an outage for data.
export function createUserQueries(query) {
  return {
    async findUserByLogin(login) {
      const { rows } = await query(
        'SELECT * FROM users WHERE lower(username) = lower($1) OR lower(email) = lower($1) LIMIT 1', [login]);
      return authUserRow(rows[0]) || null;
    },

    async findUserByToken(tokenHash) {
      if (!tokenHash) return null;
      const { rows } = await query(
        `SELECT u.* FROM user_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.expires_at > now()`, [tokenHash]);
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
      const { rows } = await query("SELECT count(*)::int AS n FROM users WHERE host_status = 'pending' AND is_admin = false");
      return rows[0].n;
    },

    async roomsOwnedBy(userId) {
      const { rows } = await query('SELECT id, code FROM rooms WHERE owner_id = $1', [userId]);
      return rows.map((row) => ({ id: String(row.id), code: row.code }));
    },
  };
}
