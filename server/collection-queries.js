import {
  COLLECTION_KINDS,
  COLLECTION_LIMITS,
  collectionPayload,
} from '../shared/asset-collections.js';

import { ASSET_TABLES as TABLES } from './library-queries.js';

const visibleAssets = COLLECTION_KINDS.map(
  (kind) => `SELECT '${kind}' AS kind, id, is_public FROM ${TABLES[kind]}`,
).join(' UNION ALL ');
const row = (value) => ({
  id: String(value.id),
  name: value.name,
  isPublic: value.is_public,
  revision: value.revision,
  items: value.items || [],
});
export class CollectionError extends Error {}

export function createCollectionQueries(pool) {
  async function transaction(run, authorize) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (!authorize()) throw new CollectionError('Collection administration is unavailable.');
      const result = await run(client);
      // Recheck after reads and immediately before committing privileged changes.
      if (!authorize()) throw new CollectionError('Collection administration is unavailable.');
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async function list({ includePrivate = false, after = '0' } = {}) {
    const { rows } = await pool.query(
      `SELECT c.*, COALESCE((
      SELECT jsonb_agg(jsonb_build_object('kind', i.kind, 'id', i.asset_id::text) ORDER BY i.kind, i.asset_id)
      FROM asset_collection_items i JOIN (${visibleAssets}) a ON a.kind=i.kind AND a.id=i.asset_id
      WHERE i.collection_id=c.id AND ($1 OR a.is_public)
    ), '[]'::jsonb) AS items FROM asset_collections c
    WHERE ($1 OR c.is_public) AND c.id > $2 ORDER BY c.id LIMIT $3`,
      [includePrivate, after, COLLECTION_LIMITS.page],
    );
    return {
      collections: rows.map(row),
      next: rows.length === COLLECTION_LIMITS.page ? String(rows.at(-1).id) : null,
    };
  }
  async function mutate(operation, payload, { ownerId = null, authorize = () => false } = {}) {
    const value = collectionPayload(payload, operation);
    if (!['create', 'update', 'delete'].includes(operation) || !value)
      throw new CollectionError('Invalid collection details.');
    return transaction(async (client) => {
      if (operation === 'create') {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('open-tabletop:collections'))");
        const { rows } = await client.query('SELECT count(*)::int AS count FROM asset_collections');
        if (rows[0].count >= COLLECTION_LIMITS.collections)
          throw new CollectionError(
            `The library supports up to ${COLLECTION_LIMITS.collections} collections.`,
          );
        const created = await client.query(
          'INSERT INTO asset_collections (name, is_public, owner_id) VALUES ($1,$2,$3) RETURNING *',
          [value.name, value.isPublic, ownerId],
        );
        return row(created.rows[0]);
      }
      const { rows } = await client.query(
        'SELECT revision FROM asset_collections WHERE id=$1 FOR UPDATE',
        [value.id],
      );
      if (!rows.length || rows[0].revision !== value.revision)
        throw new CollectionError(
          'This collection changed. Reload it before saving; your draft has been kept.',
        );
      if (operation === 'delete') {
        await client.query('DELETE FROM asset_collections WHERE id=$1', [value.id]);
        return { id: value.id };
      }
      for (const kind of COLLECTION_KINDS) {
        const ids = value.items.filter((item) => item.kind === kind).map((item) => item.id);
        if (!ids.length) continue;
        const found = await client.query(
          `SELECT id FROM ${TABLES[kind]} WHERE id = ANY($1::bigint[]) ORDER BY id FOR KEY SHARE`,
          [ids],
        );
        if (found.rows.length !== ids.length)
          throw new CollectionError(
            'An asset was removed. Reload the collection before saving; your draft has been kept.',
          );
      }
      if (!authorize()) throw new CollectionError('Collection administration is unavailable.');
      await client.query('DELETE FROM asset_collection_items WHERE collection_id=$1', [value.id]);
      if (value.items.length)
        await client.query(
          `INSERT INTO asset_collection_items (collection_id,kind,asset_id)
        SELECT $1, item.kind, item.id::bigint FROM jsonb_to_recordset($2::jsonb) AS item(kind text,id text)`,
          [value.id, JSON.stringify(value.items)],
        );
      const updated = await client.query(
        'UPDATE asset_collections SET name=$2,is_public=$3,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *',
        [value.id, value.name, value.isPublic],
      );
      return row(updated.rows[0]);
    }, authorize);
  }
  return { list, mutate };
}
