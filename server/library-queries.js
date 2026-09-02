import { BOARDS } from '../shared/pieces.js';

const idOrNull = (value) => (value == null ? null : String(value));
const boardKind = (record) => {
  if (record.board) return BOARDS[record.board] ? BOARDS[record.board].name : record.board;
  if (record.model) return 'model';
  return `${record.w || 8}\u00d7${record.d || 8}`;
};
const boardRecord = (row) => {
  const record = { ...(row.props || {}) };
  if (row.file_url) record.model = row.file_url;
  return record;
};

// Dependency-injected library reads keep successful empty/not-found results
// distinct from query rejection, and make that contract testable without a DB.
export function createLibraryQueries(query) {
  return {
    async listDecks({ includePrivate = false } = {}) {
      const { rows } = await query(
        `SELECT id, name, jsonb_array_length(cards) AS count, cards->>0 AS first, props->>'back' AS back, is_public, owner_id FROM custom_decks
         ${includePrivate ? '' : 'WHERE is_public = true'} ORDER BY name, id`,
      );
      return rows.map((row) => ({
        id: String(row.id),
        name: row.name,
        count: Number(row.count),
        first: row.first || null,
        back: row.back || 'back',
        isPublic: row.is_public,
        ownerId: idOrNull(row.owner_id),
      }));
    },

    async getDeck(id) {
      const { rows } = await query(
        'SELECT name, cards, props, is_public, owner_id FROM custom_decks WHERE id = $1',
        [id],
      );
      if (!rows[0]) return null;
      const row = rows[0];
      return {
        name: row.name,
        fronts: row.cards || [],
        back: (row.props || {}).back || 'back',
        geom: (row.props || {}).geom || null,
        isPublic: row.is_public,
        ownerId: idOrNull(row.owner_id),
      };
    },

    async listBoards({ includePrivate = false } = {}) {
      const { rows } = await query(
        `SELECT id, name, file_url, props, is_public, owner_id FROM custom_boards
         ${includePrivate ? '' : 'WHERE is_public = true'} ORDER BY name, id`,
      );
      return rows.map((row) => {
        const record = boardRecord(row);
        return {
          ...record,
          id: String(row.id),
          name: row.name,
          kind: boardKind(record),
          preview: row.file_url || (row.props && row.props.tex) || null,
          isPublic: row.is_public,
          ownerId: idOrNull(row.owner_id),
        };
      });
    },

    async getBoard(id) {
      const { rows } = await query(
        'SELECT name, file_url, props, is_public, owner_id FROM custom_boards WHERE id = $1',
        [id],
      );
      if (!rows[0]) return null;
      const row = rows[0];
      return {
        rec: boardRecord(row),
        name: row.name,
        isPublic: row.is_public,
        ownerId: idOrNull(row.owner_id),
      };
    },

    async listProps({ includePrivate = false } = {}) {
      const { rows } = await query(
        `SELECT id, name, file_url, props, is_public, owner_id FROM custom_objects
         ${includePrivate ? '' : 'WHERE is_public = true'} ORDER BY name, id`,
      );
      return rows.map((row) => ({
        id: String(row.id),
        name: row.name,
        props: { model: row.file_url, ...(row.props || {}) },
        isPublic: row.is_public,
        ownerId: idOrNull(row.owner_id),
      }));
    },

    async listScenes({ includePrivate = false } = {}) {
      const { rows } = await query(
        `SELECT id, name, is_public, owner_id FROM custom_scenes
         ${includePrivate ? '' : 'WHERE is_public = true'} ORDER BY name, id`,
      );
      return rows.map((row) => ({
        id: String(row.id),
        name: row.name,
        isPublic: row.is_public,
        ownerId: idOrNull(row.owner_id),
      }));
    },

    async getScene(id) {
      const { rows } = await query(
        'SELECT name, props, is_public, owner_id FROM custom_scenes WHERE id = $1',
        [id],
      );
      if (!rows[0]) return null;
      const row = rows[0];
      return {
        name: row.name,
        payload: row.props || {},
        isPublic: row.is_public,
        ownerId: idOrNull(row.owner_id),
      };
    },

    async listSkyboxes({ includePrivate = false } = {}) {
      const { rows } = await query(
        `SELECT id, name, file_url, is_public, owner_id FROM custom_skyboxes
         ${includePrivate ? '' : 'WHERE is_public = true'} ORDER BY name, id`,
      );
      return rows.map((row) => ({
        id: String(row.id),
        name: row.name,
        url: row.file_url,
        isPublic: row.is_public,
        ownerId: idOrNull(row.owner_id),
      }));
    },

    async listDice({ includePrivate = false } = {}) {
      const { rows } = await query(
        `SELECT id, name, file_url, is_public, owner_id FROM custom_dice
         ${includePrivate ? '' : 'WHERE is_public = true'} ORDER BY name, id`,
      );
      return rows.map((row) => ({
        id: String(row.id),
        name: row.name,
        url: row.file_url,
        isPublic: row.is_public,
        ownerId: idOrNull(row.owner_id),
      }));
    },

    async getDice(id) {
      const { rows } = await query(
        'SELECT name, file_url, is_public, owner_id FROM custom_dice WHERE id = $1',
        [id],
      );
      if (!rows[0]) return null;
      const row = rows[0];
      return {
        name: row.name,
        url: row.file_url,
        isPublic: row.is_public,
        ownerId: idOrNull(row.owner_id),
      };
    },
  };
}
