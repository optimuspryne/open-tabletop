// import-assets.js — ONE-TIME: load existing saved-assets/*.json metadata into
// Postgres. The image/model files are left where they are; only the metadata
// rows are created. Run once after applying the migration:
//
//   DATABASE_URL=postgresql://tabletop:PASS@HOST:5432/tabletop node import-assets.js
//
// Re-running inserts duplicates (rows aren't keyed by name), so run it just once.
// The old .json files can stay on disk afterwards; nothing reads them anymore.
import fs from 'fs';
import path from 'path';
import * as db from './db.js';

const ASSETS_DIR = process.env.ASSETS_DIR || './saved-assets';

function readJson(kind) {
  const folder = path.join(ASSETS_DIR, kind);
  try {
    return fs.readdirSync(folder)
      .filter(f => f.endsWith('.json'))
      .map(f => { try { return JSON.parse(fs.readFileSync(path.join(folder, f))); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return []; // folder doesn't exist
  }
}

let decks = 0, boards = 0, props = 0;
for (const d of readJson('decks')) {
  if (!d.name) continue;
  await db.insertDeck({ name: d.name, back: d.back || 'back', fronts: Array.isArray(d.fronts) ? d.fronts : [] });
  decks++;
}
for (const b of readJson('boards')) {
  if (!b.name) continue;
  const { name, ...record } = b; // the old file mixed name into the record
  await db.insertBoard(name, record);
  boards++;
}
for (const p of readJson('props')) {
  if (!p.name || !p.props || !p.props.model) continue;
  await db.insertProp(p.name, p.props);
  props++;
}

console.log(`Imported ${decks} decks, ${boards} boards, ${props} props.`);
await db.close();
