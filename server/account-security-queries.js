import { authUserRow, publicUserRow } from './user-queries.js';

// Every credential mutation locks the account, then rechecks its credential.
// Hashing and SMTP stay outside transactions. Recovery consumption, password
// mutation, revocation and replacement session creation commit atomically.
export function createAccountSecurityQueries(pool) {
  async function transaction(run) {
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      const result = await run(connection.query.bind(connection));
      await connection.query('COMMIT');
      return result;
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  }
  async function lockUser(query, id) {
    const { rows } = await query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [id]);
    return rows[0];
  }
  async function sessionUser(query, tokenHash) {
    const { rows } = await query('SELECT user_id FROM user_sessions WHERE token_hash = $1', [
      tokenHash,
    ]);
    if (!rows[0]) return null;
    const user = await lockUser(query, rows[0].user_id);
    const { rowCount } = await query(
      'SELECT token_hash FROM user_sessions WHERE token_hash = $1 AND expires_at > now() FOR UPDATE',
      [tokenHash],
    );
    return rowCount ? user : null;
  }
  async function putToken(query, user, purpose, tokenHash, expiresAt) {
    await query(
      `INSERT INTO account_recovery_tokens (token_hash,user_id,purpose,email,expires_at)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id,purpose) DO UPDATE
       SET token_hash = EXCLUDED.token_hash, email = EXCLUDED.email, expires_at = EXCLUDED.expires_at`,
      [tokenHash, user.id, purpose, user.email, expiresAt],
    );
  }
  async function rotateAccess(query, user, session) {
    await query('DELETE FROM user_sessions WHERE user_id = $1', [user.id]);
    await query('DELETE FROM account_recovery_tokens WHERE user_id = $1', [user.id]);
    await query('DELETE FROM account_recovery_codes WHERE user_id = $1', [user.id]);
    await query('INSERT INTO user_sessions (user_id,token_hash,expires_at) VALUES ($1,$2,$3)', [
      user.id,
      session.tokenHash,
      session.expiresAt,
    ]);
  }
  async function tokenUser(query, tokenHash, purpose) {
    const { rows } = await query(
      'SELECT user_id FROM account_recovery_tokens WHERE token_hash = $1 AND purpose = $2',
      [tokenHash, purpose],
    );
    if (!rows[0]) return null;
    const user = await lockUser(query, rows[0].user_id);
    if (!user) return null;
    const result = await query(
      `SELECT token_hash FROM account_recovery_tokens
       WHERE token_hash = $1 AND purpose = $2 AND email = $3 AND expires_at > now() FOR UPDATE`,
      [tokenHash, purpose, user.email],
    );
    return result.rowCount ? user : null;
  }
  return {
    async status(sessionHash) {
      return transaction(async (query) => {
        const user = await sessionUser(query, sessionHash);
        if (!user) return null;
        const { rows } = await query(
          'SELECT count(*)::int AS count FROM account_recovery_codes WHERE user_id = $1',
          [user.id],
        );
        return {
          user: publicUserRow(user),
          emailVerified: !!user.email_verified_at,
          codesRemaining: rows[0].count,
        };
      });
    },
    async credentials(sessionHash) {
      return transaction(
        async (query) => authUserRow(await sessionUser(query, sessionHash)) || null,
      );
    },
    async setPassword({ sessionHash, expectedHash, passwordHash, session }) {
      return transaction(async (query) => {
        const user = await sessionUser(query, sessionHash);
        if (!user || user.password_hash !== expectedHash) return null;
        const { rows } = await query(
          'UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING *',
          [user.id, passwordHash],
        );
        await rotateAccess(query, user, session);
        return publicUserRow(rows[0]);
      });
    },
    async replaceCodes(sessionHash, hashes) {
      return transaction(async (query) => {
        const user = await sessionUser(query, sessionHash);
        if (!user) return false;
        await query('DELETE FROM account_recovery_codes WHERE user_id = $1', [user.id]);
        // Regeneration also invalidates any recovery proof already exchanged for a grant.
        await query(
          "DELETE FROM account_recovery_tokens WHERE user_id = $1 AND purpose = 'grant'",
          [user.id],
        );
        await query(
          'INSERT INTO account_recovery_codes (user_id,code_hash) SELECT $1, unnest($2::text[])',
          [user.id, hashes],
        );
        return true;
      });
    },
    async issueEmail({ sessionHash, email, purpose, tokenHash, expiresAt }) {
      return transaction(async (query) => {
        let user;
        if (purpose === 'verify') user = await sessionUser(query, sessionHash);
        else if (purpose === 'recover') {
          const { rows } = await query(
            'SELECT id FROM users WHERE lower(email) = lower($1) AND email_verified_at IS NOT NULL',
            [email],
          );
          if (rows[0]) user = await lockUser(query, rows[0].id);
          if (!user?.email_verified_at) return null;
        } else return null;
        if (!user || (purpose === 'verify' && user.email_verified_at)) return null;
        const { rowCount } = await query(
          `UPDATE users SET recovery_mail_sent_at = now() WHERE id = $1
           AND (recovery_mail_sent_at IS NULL OR recovery_mail_sent_at < now() - interval '60 seconds')`,
          [user.id],
        );
        if (!rowCount) return null;
        await putToken(query, user, purpose, tokenHash, expiresAt);
        return { email: user.email };
      });
    },
    async discardEmail(tokenHash) {
      await pool.query(
        "DELETE FROM account_recovery_tokens WHERE token_hash = $1 AND purpose IN ('verify','recover')",
        [tokenHash],
      );
    },
    async verifyEmail(sessionHash, tokenHash) {
      return transaction(async (query) => {
        const user = await sessionUser(query, sessionHash);
        if (!user) return false;
        const { rowCount } = await query(
          `DELETE FROM account_recovery_tokens WHERE token_hash = $1 AND user_id = $2
           AND purpose = 'verify' AND email = $3 AND expires_at > now()`,
          [tokenHash, user.id, user.email],
        );
        if (!rowCount) return false;
        await query('UPDATE users SET email_verified_at = now() WHERE id = $1', [user.id]);
        return true;
      });
    },
    async exchange({ tokenHash, login, codeHash, grantHash, expiresAt }) {
      return transaction(async (query) => {
        let user;
        if (tokenHash) {
          user = await tokenUser(query, tokenHash, 'recover');
          if (!user || !user.email_verified_at) return null;
          await query('DELETE FROM account_recovery_tokens WHERE token_hash = $1', [tokenHash]);
        } else {
          const { rows } = await query(
            'SELECT id FROM users WHERE lower(username) = lower($1) OR lower(email) = lower($1)',
            [login],
          );
          if (!rows[0]) return null;
          user = await lockUser(query, rows[0].id);
          if (!user) return null;
          const { rowCount } = await query(
            'DELETE FROM account_recovery_codes WHERE user_id = $1 AND code_hash = $2',
            [user.id, codeHash],
          );
          if (!rowCount) return null;
        }
        await putToken(query, user, 'grant', grantHash, expiresAt);
        return { hasPassword: !!user.password_hash };
      });
    },
    async recover({ grantHash, passwordHash, session }) {
      return transaction(async (query) => {
        const user = await tokenUser(query, grantHash, 'grant');
        if (!user || (user.password_hash && !passwordHash)) return null;
        if (passwordHash) {
          await query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, passwordHash]);
          user.password_hash = passwordHash;
        }
        await rotateAccess(query, user, session);
        return publicUserRow(user);
      });
    },
  };
}
