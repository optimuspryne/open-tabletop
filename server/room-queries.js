export const roomRow = (row) =>
  row && {
    id: String(row.id),
    ownerId: String(row.owner_id),
    code: row.code,
    name: row.name,
    requireApproval: row.require_approval,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
export const memberRow = (row) =>
  row && {
    roomId: String(row.room_id),
    userId: String(row.user_id),
    role: row.role,
    status: row.status,
  };
export const DEFAULT_ROOM_STATE = Object.freeze({
  scoreboard: [],
  notes: '',
  tableX: 10,
  tableZ: 7,
  skybox: '',
  feltColor: '#2f6b4f',
  scene: null,
  scale: null,
});

const freshDefaultState = () => ({ ...DEFAULT_ROOM_STATE, scoreboard: [] });

export function createRoomQueries(query) {
  const getMembership = async (roomId, userId) => {
    const { rows } = await query('SELECT * FROM room_members WHERE room_id = $1 AND user_id = $2', [
      roomId,
      userId,
    ]);
    return memberRow(rows[0]) || null;
  };

  return {
    async findRoomByCode(code) {
      const { rows } = await query('SELECT * FROM rooms WHERE code = $1 AND deleted_at IS NULL', [
        code,
      ]);
      return roomRow(rows[0]) || null;
    },

    async getRoom(id) {
      const { rows } = await query('SELECT * FROM rooms WHERE id = $1', [id]);
      return roomRow(rows[0]) || null;
    },

    async listRoomsForUser(userId) {
      const { rows } = await query(
        `SELECT r.*, m.role, m.status FROM rooms r JOIN room_members m ON m.room_id = r.id
         WHERE m.user_id = $1 AND r.deleted_at IS NULL ORDER BY r.created_at DESC`,
        [userId],
      );
      return rows.map((row) => ({ ...roomRow(row), role: row.role, status: row.status }));
    },

    async listRoomsForAdmin(adminId) {
      const { rows } = await query(
        `SELECT r.*, u.username AS owner_name FROM rooms r JOIN users u ON u.id = r.owner_id
         WHERE r.deleted_at IS NULL ORDER BY r.created_at DESC`,
      );
      return rows.map((row) => ({
        ...roomRow(row),
        ownerName: row.owner_name,
        status: 'admitted',
        role: String(row.owner_id) === String(adminId) ? 'owner' : 'admin',
      }));
    },

    async listRooms({ includeDeleted = false } = {}) {
      const { rows } = await query(
        `SELECT r.*, u.username AS owner_name FROM rooms r JOIN users u ON u.id = r.owner_id
         ${includeDeleted ? '' : 'WHERE r.deleted_at IS NULL'} ORDER BY r.created_at DESC`,
      );
      return rows.map((row) => ({ ...roomRow(row), ownerName: row.owner_name }));
    },

    async getRoomState(roomId) {
      const { rows } = await query(
        'SELECT scoreboard, notes, table_x, table_z, skybox, felt_color, scene, scale FROM rooms WHERE id = $1',
        [roomId],
      );
      if (!rows[0]) return freshDefaultState();
      const row = rows[0];
      return {
        scoreboard: row.scoreboard || [],
        notes: row.notes || '',
        tableX: Number(row.table_x) || 10,
        tableZ: Number(row.table_z) || 7,
        skybox: row.skybox || '',
        feltColor: row.felt_color || '#2f6b4f',
        scene: row.scene || null,
        scale: row.scale || null,
      };
    },

    async joinRoom({ roomId, userId, requireApproval }) {
      const status = requireApproval ? 'pending' : 'admitted';
      const { rows } = await query(
        `INSERT INTO room_members (room_id, user_id, status) VALUES ($1,$2,$3)
         ON CONFLICT (room_id, user_id) DO NOTHING RETURNING *`,
        [roomId, userId, status],
      );
      return rows[0] ? memberRow(rows[0]) : getMembership(roomId, userId);
    },

    getMembership,

    async listMembers(roomId) {
      const { rows } = await query(
        `SELECT m.room_id, m.user_id, m.role, m.status, u.username, u.avatar FROM room_members m
         JOIN users u ON u.id = m.user_id WHERE m.room_id = $1
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'gm' THEN 1 WHEN 'helper' THEN 2 ELSE 3 END, u.username`,
        [roomId],
      );
      return rows.map((row) => ({
        userId: String(row.user_id),
        username: row.username,
        avatar: row.avatar,
        role: row.role,
        status: row.status,
      }));
    },
  };
}
