// db.js — Postgres pool + the saved-library queries (decks, boards, props).
//
// Only METADATA lives in Postgres. The image/model FILES still sit on disk under
// ASSETS_DIR and are served from there; a row just references them by URL. Assets
// are keyed by their row id (a bigint, which pg returns as a string) — that id
// replaces the old filename slug the client used to load by.
//
// Normalisation: a model's URL is the canonical column `file_url`; everything else
// rides in the `props` jsonb bag. Reads splice the two back into the record shape
// the game already expects, so nothing is stored twice.
import fs from 'fs';
import pg from 'pg';
import { BOARDS } from './shared/pieces.js';

// The connection string comes from the environment, never from this file. Prefer
// DATABASE_URL_FILE — a path to a file holding the string (the Docker-secrets
// pattern, so the value never lands in the image or `docker inspect`) — and fall
// back to DATABASE_URL. With neither set we throw at startup rather than guess a
// default, so a missing config fails loudly instead of silently.
function connectionString() {
  const { DATABASE_URL_FILE, DATABASE_URL } = process.env;
  if (DATABASE_URL_FILE) return fs.readFileSync(DATABASE_URL_FILE, 'utf8').trim();
  if (DATABASE_URL) return DATABASE_URL;
  throw new Error('Database not configured: set DATABASE_URL or DATABASE_URL_FILE (see .env.example).');
}

const pool = new pg.Pool({ connectionString: connectionString() });
pool.on('error', (err) => console.error('[db] pool error:', err.message)); // don't crash on an idle-client drop

export const close = () => pool.end(); // for one-off scripts to let the process exit

// ===== Decks =================================================================
// cards = the ordered front refs (jsonb array); props = { back }.
export async function listDecks() {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, jsonb_array_length(cards) AS count FROM custom_decks ORDER BY name, id');
    return rows.map(r => ({ id: String(r.id), name: r.name, count: Number(r.count) }));
  } catch (e) { console.error('[db] listDecks:', e.message); return []; }
}
export async function getDeck(id) {
  try {
    const { rows } = await pool.query('SELECT name, cards, props FROM custom_decks WHERE id = $1', [id]);
    if (!rows[0]) return null;
    return { name: rows[0].name, fronts: rows[0].cards || [], back: (rows[0].props || {}).back || 'back' };
  } catch (e) { console.error('[db] getDeck:', e.message); return null; }
}
export function insertDeck({ name, back, fronts }) {
  return pool.query(
    "INSERT INTO custom_decks (name, type, cards, props) VALUES ($1, 'mixed', $2, $3) RETURNING id",
    [name, JSON.stringify(fronts), JSON.stringify({ back })]).then(r => String(r.rows[0].id));
}
export function updateDeck(id, { name, back, fronts }) {
  return pool.query(
    'UPDATE custom_decks SET name = $2, cards = $3, props = $4 WHERE id = $1',
    [id, name, JSON.stringify(fronts), JSON.stringify({ back })]);
}

// ===== Boards ================================================================
// A board record is one of: { board } (built-in) | { model, modelScale, box }
// (uploaded .glb) | { w, d, tex } (procedural). model → file_url; the rest → props.
const boardType = (rec) => rec.model ? 'glb' : (rec.tex ? 'image' : 'flat'); // the CHECK-constrained label
function boardKind(rec) { // short descriptor for the load menu
  if (rec.board) return BOARDS[rec.board] ? BOARDS[rec.board].name : rec.board;
  if (rec.model) return 'model';
  return `${rec.w || 8}\u00d7${rec.d || 8}`;
}
const boardRecord = (row) => { const rec = { ...(row.props || {}) }; if (row.file_url) rec.model = row.file_url; return rec; };

export async function listBoards() {
  try {
    const { rows } = await pool.query('SELECT id, name, file_url, props FROM custom_boards ORDER BY name, id');
    return rows.map(r => ({ id: String(r.id), name: r.name, kind: boardKind(boardRecord(r)) }));
  } catch (e) { console.error('[db] listBoards:', e.message); return []; }
}
export async function getBoard(id) {
  try {
    const { rows } = await pool.query('SELECT file_url, props FROM custom_boards WHERE id = $1', [id]);
    return rows[0] ? boardRecord(rows[0]) : null;
  } catch (e) { console.error('[db] getBoard:', e.message); return null; }
}
export function insertBoard(name, rec) {
  const { model, ...rest } = rec;
  return pool.query(
    'INSERT INTO custom_boards (name, type, file_url, props) VALUES ($1, $2, $3, $4) RETURNING id',
    [name, boardType(rec), model || null, JSON.stringify(rest)]).then(r => String(r.rows[0].id));
}

// ===== Props (custom model objects) ==========================================
// A prop is always a .glb model: file_url = the model URL; props = the rest
// ({ box, stand, scale, color? }). Reads splice model back in for spawning.
const propRecord = (row) => ({ model: row.file_url, ...(row.props || {}) });

export async function listProps() {
  try {
    const { rows } = await pool.query('SELECT id, name, file_url, props FROM custom_objects ORDER BY name, id');
    return rows.map(r => ({ id: String(r.id), name: r.name, props: propRecord(r) }));
  } catch (e) { console.error('[db] listProps:', e.message); return []; }
}
export function insertProp(name, props) {
  const { model, ...rest } = props;
  return pool.query(
    'INSERT INTO custom_objects (name, file_url, props) VALUES ($1, $2, $3) RETURNING id',
    [name, model, JSON.stringify(rest)]).then(r => String(r.rows[0].id));
}
