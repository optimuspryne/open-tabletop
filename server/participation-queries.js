import { canManageMember, rankOf, RANK } from './permissions.js';

// Serialize against membership/role changes with row locks. The live callback
// covers in-process revocation while a query is pending; DB locks cover durable
// authority. No room state is published until COMMIT has succeeded.
export function createParticipationQueries(pool) {
  return {
    async setPlayerTimeout({ roomId, actorId, userId, timedOut }, isLive) {
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        const { rows: users } = await connection.query(
          'SELECT id, is_admin FROM users WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE',
          [[actorId, userId]],
        );
        const { rows: members } = await connection.query(
          `SELECT user_id, role, status FROM room_members
           WHERE room_id = $1 AND user_id = ANY($2::bigint[]) ORDER BY user_id FOR UPDATE`,
          [roomId, [actorId, userId]],
        );
        const actor = users.find((u) => String(u.id) === String(actorId));
        const target = users.find((u) => String(u.id) === String(userId));
        const actorMember = members.find((m) => String(m.user_id) === String(actorId));
        const targetMember = members.find((m) => String(m.user_id) === String(userId));
        const rank = actor?.is_admin
          ? RANK.owner
          : actorMember?.status === 'admitted'
            ? rankOf(actorMember.role)
            : -1;
        const authorized = () =>
          isLive(targetMember?.role) &&
          String(actorId) !== String(userId) &&
          target &&
          !target.is_admin &&
          targetMember?.status === 'admitted' &&
          canManageMember(rank, targetMember.role);
        if (!authorized()) {
          await connection.query('ROLLBACK');
          return null;
        }
        const { rows } = await connection.query(
          `INSERT INTO room_participation (room_id, user_id, timed_out) VALUES ($1,$2,$3)
           ON CONFLICT (room_id, user_id) DO UPDATE
           SET timed_out = EXCLUDED.timed_out, version = room_participation.version + 1
           RETURNING timed_out, version`,
          [roomId, userId, timedOut],
        );
        if (!authorized()) {
          await connection.query('ROLLBACK');
          return null;
        }
        await connection.query('COMMIT');
        return { timedOut: rows[0].timed_out, version: rows[0].version };
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}
