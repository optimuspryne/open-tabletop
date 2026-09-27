// SQL access checks use the live account role, never client-supplied ownership/admin flags.
export function createNotecardTemplateQueries(query) {
  const admin = 'EXISTS (SELECT 1 FROM users WHERE id=$1 AND is_admin)';
  const editable = `(t.owner_id=$1 OR ${admin})`;
  const readable = `(t.is_public OR ${editable})`;
  const fields = `t.id, t.name, t.content, t.is_public AS "isPublic", t.revision,
    t.owner_id AS "ownerId", (SELECT username FROM users WHERE id=t.owner_id) AS "ownerName",
    ${editable} AS "canEdit"`;
  return {
    async list(user, scope = 'mine', offset = 0) {
      const filter =
        scope === 'shared'
          ? 't.is_public AND t.owner_id IS DISTINCT FROM $1'
          : scope === 'managed'
            ? editable
            : 't.owner_id=$1';
      const { rows } = await query(
        `SELECT ${fields} FROM notecard_templates t
        WHERE ${filter} ORDER BY t.id DESC LIMIT 21 OFFSET $2`,
        [user.id, offset],
      );
      return { templates: rows.slice(0, 20), nextOffset: rows.length > 20 ? offset + 20 : null };
    },
    async get(user, id) {
      const { rows } = await query(
        `SELECT ${fields} FROM notecard_templates t WHERE t.id=$2 AND ${readable}`,
        [user.id, id],
      );
      return rows[0];
    },
    async create(user, value) {
      const { rows } = await query(
        `INSERT INTO notecard_templates AS t (owner_id,name,content,is_public)
        VALUES ($1,$2,$3::jsonb,$4) RETURNING ${fields}`,
        [user.id, value.name, JSON.stringify(value.content), value.isPublic],
      );
      return rows[0];
    },
    async update(user, id, value, revision) {
      const { rows } = await query(
        `UPDATE notecard_templates t SET name=$3, is_public=$4,
        content=COALESCE($5::jsonb,content), revision=revision+1, updated_at=now()
        WHERE t.id=$2 AND ${editable} AND revision=$6 RETURNING ${fields}`,
        [
          user.id,
          id,
          value.name,
          value.isPublic,
          value.content ? JSON.stringify(value.content) : null,
          revision,
        ],
      );
      return rows[0];
    },
    async remove(user, id, revision) {
      const { rowCount } = await query(
        `DELETE FROM notecard_templates t WHERE t.id=$2 AND ${editable} AND revision=$3`,
        [user.id, id, revision],
      );
      return !!rowCount;
    },
  };
}
