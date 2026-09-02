// Pool-injected Postgres operations for the library, users, rooms, and membership.
//
// Only METADATA lives in Postgres. The image/model FILES still sit on disk under
// ASSETS_DIR and are served from there; a row just references them by URL. Assets
// are keyed by their row id (a bigint, which pg returns as a string) — that id
// replaces the old filename slug the client used to load by.
//
// Normalisation: a model's URL is the canonical column `file_url`; everything else
// rides in the `props` jsonb bag. Reads splice the two back into the record shape
// the game already expects, so nothing is stored twice.
import { createLibraryQueries } from './library-queries.js';
import { createUserQueries, publicUserRow } from './user-queries.js';
import { createRoomQueries, roomRow } from './room-queries.js';

export function createDatabase(pool) {
  const close = () => pool.end(); // for one-off scripts to let the process exit

  const library = createLibraryQueries((sql, params) => pool.query(sql, params));
  const userReads = createUserQueries((sql, params) => pool.query(sql, params));
  const roomReads = createRoomQueries((sql, params) => pool.query(sql, params));

  // ===== Decks =================================================================
  // cards = the ordered front refs (jsonb array); props = { back }.
  // Visibility: is_public gates who can spawn; owner_id records the admin who made
  // it (editing stays admin-only regardless). Lists are public-only unless the
  // caller passes includePrivate (admins).
  async function listDecks({ includePrivate = false } = {}) {
    return library.listDecks({ includePrivate });
  }
  async function getDeck(id) {
    return library.getDeck(id);
  }
  function insertDeck({ name, back, fronts, geom = null, ownerId = null, isPublic = false }) {
    return pool
      .query(
        "INSERT INTO custom_decks (name, type, cards, props, owner_id, is_public) VALUES ($1, 'mixed', $2, $3, $4, $5) RETURNING id",
        [
          name,
          JSON.stringify(fronts),
          JSON.stringify(geom ? { back, geom } : { back }),
          ownerId,
          isPublic,
        ],
      )
      .then((r) => String(r.rows[0].id));
  }
  // Update an existing deck in place (name + cards + back + optional card geometry), keeping owner + public flag.
  function updateDeck(id, name, back, fronts, geom = null) {
    return pool
      .query('UPDATE custom_decks SET name = $2, cards = $3, props = $4 WHERE id = $1', [
        id,
        name,
        JSON.stringify(fronts),
        JSON.stringify(geom ? { back, geom } : { back }),
      ])
      .then((r) => r.rowCount > 0);
  }

  // ===== Boards ================================================================
  // A board record is one of: { board } (built-in) | { model, modelScale, box }
  // (uploaded .glb) | { w, d, tex } (procedural). model → file_url; the rest → props.
  const boardType = (rec) => (rec.model ? 'glb' : rec.tex ? 'image' : 'flat'); // the CHECK-constrained label

  async function listBoards({ includePrivate = false } = {}) {
    return library.listBoards({ includePrivate });
  }
  // Returns a wrapper: .rec is the spawn record, plus visibility/owner for gating.
  async function getBoard(id) {
    return library.getBoard(id);
  }
  function insertBoard(name, rec, { ownerId = null, isPublic = false } = {}) {
    const { model, ...rest } = rec;
    return pool
      .query(
        'INSERT INTO custom_boards (name, type, file_url, props, owner_id, is_public) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [name, boardType(rec), model || null, JSON.stringify(rest), ownerId, isPublic],
      )
      .then((r) => String(r.rows[0].id));
  }
  // Update an existing board in place (keeps id, owner, public flag).
  function updateBoard(id, name, rec) {
    const { model, ...rest } = rec;
    return pool
      .query(
        'UPDATE custom_boards SET name = $2, type = $3, file_url = $4, props = $5 WHERE id = $1',
        [id, name, boardType(rec), model || null, JSON.stringify(rest)],
      )
      .then((r) => r.rowCount > 0);
  }

  // ===== Props (custom model objects) ==========================================
  // A prop is always a .glb model: file_url = the model URL; props = the rest
  // ({ box, stand, scale, color? }). Reads splice model back in for spawning.
  async function listProps({ includePrivate = false } = {}) {
    return library.listProps({ includePrivate });
  }
  function insertProp(name, props, { ownerId = null, isPublic = false } = {}) {
    const { model, ...rest } = props;
    return pool
      .query(
        'INSERT INTO custom_objects (name, file_url, props, owner_id, is_public) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [name, model, JSON.stringify(rest), ownerId, isPublic],
      )
      .then((r) => String(r.rows[0].id));
  }
  // Update an existing prop in place (keeps id, owner, public flag).
  function updateProp(id, name, props) {
    const { model, ...rest } = props;
    return pool
      .query('UPDATE custom_objects SET name = $2, file_url = $3, props = $4 WHERE id = $1', [
        id,
        name,
        model,
        JSON.stringify(rest),
      ])
      .then((r) => r.rowCount > 0);
  }

  // ===== Scenes (a saved whole-table setup) ===================================
  async function listScenes({ includePrivate = false } = {}) {
    return library.listScenes({ includePrivate });
  }
  async function getScene(id) {
    return library.getScene(id);
  }
  function insertScene({ name, payload, ownerId = null, isPublic = false }) {
    return pool
      .query(
        'INSERT INTO custom_scenes (name, props, owner_id, is_public) VALUES ($1, $2, $3, $4) RETURNING id',
        [name, JSON.stringify(payload || {}), ownerId, isPublic],
      )
      .then((r) => String(r.rows[0].id));
  }

  // ===== Skyboxes (admin-curated equirectangular panoramas) ===================
  async function listSkyboxes({ includePrivate = false } = {}) {
    return library.listSkyboxes({ includePrivate });
  }
  function insertSkybox({ name, url, ownerId = null, isPublic = false }) {
    return pool
      .query(
        'INSERT INTO custom_skyboxes (name, file_url, owner_id, is_public) VALUES ($1, $2, $3, $4) RETURNING id',
        [name, url, ownerId, isPublic],
      )
      .then((r) => String(r.rows[0].id));
  }

  // ===== Dice textures (host-uploaded die surface images) =====================
  // A dice texture is just a named image URL (file_url), applied to a die via its
  // finish='custom' + finishImg prop. Mirrors the skybox library.
  async function listDice({ includePrivate = false } = {}) {
    return library.listDice({ includePrivate });
  }
  async function getDice(id) {
    return library.getDice(id);
  }
  function insertDice({ name, url, ownerId = null, isPublic = false }) {
    return pool
      .query(
        'INSERT INTO custom_dice (name, file_url, owner_id, is_public) VALUES ($1, $2, $3, $4) RETURNING id',
        [name, url, ownerId, isPublic],
      )
      .then((r) => String(r.rows[0].id));
  }

  // Every stored blob that could name an asset file — the reference set for orphan
  // cleanup. SELECT * (not named columns) so a newly-added column can never silently
  // un-protect a file. Throws on any error, so the caller aborts rather than over-delete.
  async function allAssetRefBlobs() {
    const out = [];
    const dump = async (sql) => {
      const { rows } = await pool.query(sql);
      for (const r of rows) out.push(JSON.stringify(r));
    };
    await dump('SELECT * FROM custom_decks');
    await dump('SELECT * FROM custom_boards');
    await dump('SELECT * FROM custom_objects');
    await dump('SELECT * FROM custom_scenes');
    await dump('SELECT * FROM custom_skyboxes');
    await dump('SELECT * FROM custom_dice');
    await dump("SELECT skybox FROM rooms WHERE skybox <> ''");
    return out;
  }

  // ===== Asset admin (generic across the asset tables) =========================
  // Editing/visibility/deletion is admin-only (enforced server-side); these just run
  // the query for whichever kind. Unknown kinds are rejected so the table name can
  // never come from untrusted input.
  const ASSET_TABLE = {
    deck: 'custom_decks',
    board: 'custom_boards',
    prop: 'custom_objects',
    scene: 'custom_scenes',
    sky: 'custom_skyboxes',
    dice: 'custom_dice',
  };
  function setAssetPublic(kind, id, isPublic) {
    const table = ASSET_TABLE[kind];
    if (!table) return Promise.reject(new Error('bad kind'));
    return pool.query(`UPDATE ${table} SET is_public = $2 WHERE id = $1`, [id, !!isPublic]);
  }
  function renameAsset(kind, id, name) {
    const table = ASSET_TABLE[kind];
    if (!table) return Promise.reject(new Error('bad kind'));
    return pool.query(`UPDATE ${table} SET name = $2 WHERE id = $1`, [id, name]);
  }
  function deleteAsset(kind, id) {
    const table = ASSET_TABLE[kind];
    if (!table) return Promise.reject(new Error('bad kind'));
    return pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
  }

  // ===== Users ================================================================
  // This layer only stores/compares hash STRINGS — hashing is the server's job.
  // Passwords use a slow salted hash (bcrypt/argon2) and are verified after a
  // username lookup. Device tokens are high-entropy random strings hashed with a
  // FAST deterministic hash (e.g. sha256) so they can be looked up by equality;
  // storing the hash means a DB leak doesn't expose live tokens. Hashes never leave
  // this module except to the auth path — the *public* shape omits them.
  const publicUser = publicUserRow;

  // Create an account. A password sets host_status = 'pending' (must be approved by
  // an admin before hosting); passwordless => 'none'. Throws with err.conflict =
  // 'username' | 'email' if that field is taken.
  async function createUser({
    username,
    email,
    passwordHash = null,
    loginTokenHash = null,
    sessionExpiresAt = null,
    isAdmin = false,
  }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const hostStatus = passwordHash ? 'pending' : 'none';
      const { rows } = await client.query(
        `INSERT INTO users (username, email, password_hash, is_admin, host_status)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [username, email, passwordHash, isAdmin, hostStatus],
      );
      if (loginTokenHash) {
        await client.query(
          'INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1,$2,$3)',
          [rows[0].id, loginTokenHash, sessionExpiresAt],
        );
      }
      await client.query('COMMIT');
      return publicUser(rows[0]);
    } catch (e) {
      await client.query('ROLLBACK');
      if (e.code === '23505') {
        const field = e.constraint === 'users_email_key' ? 'email' : 'username';
        const err = new Error(`${field} already taken`);
        err.conflict = field;
        throw err;
      }
      throw e;
    } finally {
      client.release();
    }
  }

  // First-boot provisioning. The transaction-level advisory lock serializes multiple
  // app replicas; provisioning is allowed only on an empty users table. An existing
  // admin makes subsequent restarts a no-op, and existing non-admin users fail closed.
  async function bootstrapAdmin({ username, email, passwordHash }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('open-tabletop:admin-bootstrap'))");
      const { rows: counts } = await client.query(
        'SELECT count(*)::int AS users, count(*) FILTER (WHERE is_admin)::int AS admins FROM users',
      );
      if (counts[0].admins > 0) {
        await client.query('COMMIT');
        return { status: 'already-configured' };
      }
      if (counts[0].users > 0) {
        throw new Error(
          'Cannot bootstrap admin: users exist but none is an admin. Use npm run admin:grant -- <username-or-email>.',
        );
      }
      const { rows } = await client.query(
        `INSERT INTO users (username, email, password_hash, is_admin, host_status)
       VALUES ($1,$2,$3,true,'approved') RETURNING *`,
        [username, email, passwordHash],
      );
      await client.query('COMMIT');
      return { status: 'created', user: publicUser(rows[0]) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Local recovery command support. Exact case-insensitive username/email matching;
  // ambiguity fails closed. Revocation cannot remove the final administrator.
  async function changeAdminByLogin(login, isAdmin) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('open-tabletop:admin-role-change'))",
      );
      const { rows } = await client.query(
        'SELECT * FROM users WHERE lower(username) = lower($1) OR lower(email) = lower($1) FOR UPDATE',
        [login],
      );
      if (rows.length !== 1)
        throw new Error(
          rows.length
            ? 'Login matches more than one account; use an unambiguous username or email.'
            : 'User not found.',
        );
      if (!isAdmin && rows[0].is_admin) {
        const { rows: count } = await client.query(
          'SELECT count(*)::int AS n FROM users WHERE is_admin = true',
        );
        if (count[0].n <= 1) throw new Error('Cannot revoke the final administrator.');
      }
      const { rows: updated } = await client.query(
        "UPDATE users SET is_admin = $2, host_status = CASE WHEN $2 THEN 'approved' ELSE host_status END WHERE id = $1 RETURNING *",
        [rows[0].id, !!isAdmin],
      );
      await client.query('COMMIT');
      return publicUser(updated[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Login/join entry point: look up by username OR email (case-insensitive). Returns
  // the AUTH shape (with hashes) so the server can verify a password.
  async function findUserByLogin(login) {
    return userReads.findUserByLogin(login);
  }
  // Resolve a device token (pass its HASH) to its user — the passwordless "login".
  async function findUserByToken(tokenHash) {
    return userReads.findUserByToken(tokenHash);
  }
  async function findUserById(id) {
    return userReads.findUserById(id);
  }
  function createSession(userId, tokenHash, expiresAt) {
    return pool.query(
      'INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1,$2,$3)',
      [userId, tokenHash, expiresAt],
    );
  }
  function revokeSession(tokenHash) {
    return pool
      .query('DELETE FROM user_sessions WHERE token_hash = $1', [tokenHash])
      .then((r) => r.rowCount > 0);
  }
  function revokeUserSessions(userId) {
    return pool
      .query('DELETE FROM user_sessions WHERE user_id = $1', [userId])
      .then((r) => r.rowCount);
  }
  function setPassword(userId, passwordHash) {
    // a player upgrading to a GM account
    return pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, passwordHash]);
  }
  function setUserAvatar(userId, avatar) {
    return pool.query('UPDATE users SET avatar = $2 WHERE id = $1', [userId, avatar]);
  }
  // Admin console: everyone, no hashes (publicUser omits them).
  async function listUsers() {
    return userReads.listUsers();
  }
  function setAdmin(userId, isAdmin) {
    return pool.query('UPDATE users SET is_admin = $2 WHERE id = $1', [userId, !!isAdmin]);
  }
  function setHostStatus(userId, status) {
    // 'none' | 'pending' | 'approved'
    return pool.query('UPDATE users SET host_status = $2 WHERE id = $1', [userId, status]);
  }
  async function countPendingHosts() {
    return userReads.countPendingHosts();
  }
  // Rooms this user owns (active + soft-deleted) — codes let the caller dispose live tables.
  async function roomsOwnedBy(userId) {
    return userReads.roomsOwnedBy(userId);
  }
  // Permanently delete a user and everything that would otherwise block/orphan it,
  // in one transaction: release their library assets (kept as shared), purge the
  // rooms they own (cascading those rooms' members), then delete the user (their own
  // memberships cascade via FK). RESTRICT FKs stay as safety rails; this clears deps
  // deliberately rather than relying on a blanket DB cascade.
  async function purgeUser(userId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE custom_decks   SET owner_id = NULL WHERE owner_id = $1', [userId]);
      await client.query('UPDATE custom_boards  SET owner_id = NULL WHERE owner_id = $1', [userId]);
      await client.query('UPDATE custom_objects SET owner_id = NULL WHERE owner_id = $1', [userId]);
      await client.query('DELETE FROM rooms WHERE owner_id = $1', [userId]); // cascades those rooms' members
      await client.query('DELETE FROM users WHERE id = $1', [userId]); // cascades this user's memberships
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // ===== Rooms ================================================================
  const roomShape = roomRow;

  // Create a room AND its owner membership atomically (one CTE). Throws with
  // err.conflict = 'code' if the code is already in use by an active room.
  async function createRoom({ ownerId, code, name, requireApproval = true }) {
    try {
      const { rows } = await pool.query(
        `WITH r AS (
         INSERT INTO rooms (owner_id, code, name, require_approval) VALUES ($1,$2,$3,$4) RETURNING *
       ), m AS (
         INSERT INTO room_members (room_id, user_id, role, status) SELECT id, $1, 'owner', 'admitted' FROM r
       )
       SELECT * FROM r`,
        [ownerId, code, name, requireApproval],
      );
      return roomShape(rows[0]);
    } catch (e) {
      if (e.code === '23505') {
        const err = new Error('room code already in use');
        err.conflict = 'code';
        throw err;
      }
      throw e;
    }
  }
  // Active room by code (soft-deleted rooms are invisible) — the join entry point.
  async function findRoomByCode(code) {
    return roomReads.findRoomByCode(code);
  }
  async function getRoom(id) {
    return roomReads.getRoom(id);
  }
  // Rooms a user belongs to, with their role/status there (active rooms only).
  async function listRoomsForUser(userId) {
    return roomReads.listRoomsForUser(userId);
  }
  // Every active room, shaped for the lobby — for site admins, who can see and
  // enter any room. Their own rooms keep the 'owner' role (so lobby management
  // still shows); the rest read as 'admin'. Always 'admitted' so Enter is enabled.
  async function listRoomsForAdmin(adminId) {
    return roomReads.listRoomsForAdmin(adminId);
  }
  // All rooms with owner name — the admin console (optionally including soft-deleted).
  async function listRooms({ includeDeleted = false } = {}) {
    return roomReads.listRooms({ includeDeleted });
  }
  function setRoomPolicy(roomId, requireApproval) {
    return pool.query('UPDATE rooms SET require_approval = $2 WHERE id = $1', [
      roomId,
      requireApproval,
    ]);
  }
  function renameRoom(roomId, name) {
    return pool.query('UPDATE rooms SET name = $2 WHERE id = $1', [roomId, name]);
  }
  // Durable per-room state: scoreboard (array of {id,label,score}), GM notes, and
  // the play-surface half-extents. All survive restarts and are Reset-exempt.
  async function getRoomState(roomId) {
    return roomReads.getRoomState(roomId);
  }
  function saveRoomState(
    roomId,
    { scoreboard, notes, tableX, tableZ, skybox, feltColor, scene, scale },
  ) {
    return pool.query(
      'UPDATE rooms SET scoreboard = $2, notes = $3, table_x = $4, table_z = $5, skybox = $6, felt_color = $7, scene = $8, scale = $9 WHERE id = $1',
      [
        roomId,
        JSON.stringify(scoreboard),
        notes,
        tableX,
        tableZ,
        skybox,
        feltColor || '#2f6b4f',
        scene ? JSON.stringify(scene) : null,
        scale ? JSON.stringify(scale) : null,
      ],
    );
  }
  function softDeleteRoom(roomId) {
    // owner or admin — hides it, keeps the row
    return pool.query('UPDATE rooms SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL', [
      roomId,
    ]);
  }
  function restoreRoom(roomId) {
    // admin — undo a soft-delete
    return pool.query('UPDATE rooms SET deleted_at = NULL WHERE id = $1', [roomId]);
  }
  function purgeRoom(roomId) {
    // admin only — permanent; cascades members
    return pool.query('DELETE FROM rooms WHERE id = $1', [roomId]);
  }

  // ===== Membership ===========================================================
  // Join: create a membership if absent (status per the room's policy). Idempotent —
  // a returning member keeps their existing role/status (no reset to pending).
  async function joinRoom({ roomId, userId, requireApproval }) {
    return roomReads.joinRoom({ roomId, userId, requireApproval });
  }
  // The per-room role/status lookup that feeds every server-side permission check.
  async function getMembership(roomId, userId) {
    return roomReads.getMembership(roomId, userId);
  }
  function admitMember(roomId, userId) {
    // GM approves a pending joiner
    return pool.query("UPDATE room_members SET status='admitted' WHERE room_id=$1 AND user_id=$2", [
      roomId,
      userId,
    ]);
  }
  function kickMember(roomId, userId) {
    // hard delete (kick = remove the row)
    return pool.query('DELETE FROM room_members WHERE room_id=$1 AND user_id=$2', [roomId, userId]);
  }
  function setMemberRole(roomId, userId, role) {
    // flag helper / add co-gm / demote
    return pool.query('UPDATE room_members SET role=$3 WHERE room_id=$1 AND user_id=$2', [
      roomId,
      userId,
      role,
    ]);
  }
  // Everyone in a room with their identity — the player list + approval queue.
  async function listMembers(roomId) {
    return roomReads.listMembers(roomId);
  }

  return {
    close,
    listDecks,
    getDeck,
    insertDeck,
    updateDeck,
    listBoards,
    getBoard,
    insertBoard,
    updateBoard,
    listProps,
    insertProp,
    updateProp,
    listScenes,
    getScene,
    insertScene,
    listSkyboxes,
    insertSkybox,
    listDice,
    getDice,
    insertDice,
    allAssetRefBlobs,
    setAssetPublic,
    renameAsset,
    deleteAsset,
    createUser,
    bootstrapAdmin,
    changeAdminByLogin,
    findUserByLogin,
    findUserByToken,
    findUserById,
    createSession,
    revokeSession,
    revokeUserSessions,
    setPassword,
    setUserAvatar,
    listUsers,
    setAdmin,
    setHostStatus,
    countPendingHosts,
    roomsOwnedBy,
    purgeUser,
    createRoom,
    findRoomByCode,
    getRoom,
    listRoomsForUser,
    listRoomsForAdmin,
    listRooms,
    setRoomPolicy,
    renameRoom,
    getRoomState,
    saveRoomState,
    softDeleteRoom,
    restoreRoom,
    purgeRoom,
    joinRoom,
    getMembership,
    admitMember,
    kickMember,
    setMemberRole,
    listMembers,
  };
}
