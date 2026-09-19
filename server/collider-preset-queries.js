// Visibility and mutation permissions live in SQL, including concurrent updates.
export function createColliderPresetQueries(query) {
  const fields = `id, name, layout, size, owner_id AS "ownerId", is_public AS "isPublic",
    created_at AS "createdAt", updated_at AS "updatedAt",
    (owner_id = $1 OR $2::boolean) AS "canEdit"`;
  return {
    async list(user, offset = 0) {
      const { rows } = await query(
        `SELECT ${fields} FROM collider_presets
        WHERE is_public OR owner_id = $1 OR $2::boolean ORDER BY id DESC LIMIT 51 OFFSET $3`,
        [user.id, !!user.isAdmin, offset],
      );
      return { presets: rows.slice(0, 50), nextOffset: rows.length > 50 ? offset + 50 : null };
    },
    async get(user, id) {
      const { rows } = await query(
        `SELECT ${fields} FROM collider_presets
        WHERE id = $3 AND (is_public OR owner_id = $1 OR $2::boolean)`,
        [user.id, !!user.isAdmin, id],
      );
      return rows[0];
    },
    async save(user, id, value) {
      const params = [
        user.id,
        !!user.isAdmin,
        value.name,
        JSON.stringify(value.layout),
        value.size,
        value.isPublic,
      ];
      const { rows } = await query(
        id
          ? `UPDATE collider_presets SET name=$3, layout=$4::jsonb,
        size=$5, is_public=$6, updated_at=now() WHERE id=$7 AND (owner_id=$1 OR $2::boolean)
        RETURNING ${fields}`
          : `INSERT INTO collider_presets (owner_id,name,layout,size,is_public)
        VALUES ($1,$3,$4::jsonb,$5,$6) RETURNING ${fields}`,
        id ? [...params, id] : params,
      );
      return rows[0];
    },
    async remove(user, id) {
      const { rowCount } = await query(
        `DELETE FROM collider_presets
        WHERE id=$3 AND (owner_id=$1 OR $2::boolean)`,
        [user.id, !!user.isAdmin, id],
      );
      return !!rowCount;
    },
  };
}
