import fs from 'node:fs';
import path from 'node:path';

const MIN_AGE_MS = 24 * 60 * 60 * 1000;

// Scan owned data rather than serializing a game: serialization intentionally
// transforms cards and can omit drafts, pending inspections, and saved snapshots.
function roomAssetValues(room) {
  return [
    room.state.toJSON(),
    room.savedScene,
    room.deckCards,
    room.cardData,
    room.hands,
    room.pendingHands,
    room.pendingInspect,
    room.drafts,
    room.shows,
    room.notebooks,
    room.chatLog,
  ];
}

export function createAssetCleanup({ assetsDir, assetKinds, allAssetRefBlobs, liveRooms }) {
  const kinds = new Set(assetKinds);
  // Category matching uses the same allowlist as uploads and directory scanning.
  const assetPath = /\/assets\/([A-Za-z0-9_-]+)\/[A-Za-z0-9._-]+/g;

  function collectReferences(value, references) {
    const pending = [value];
    const seen = new Set();
    while (pending.length) {
      const current = pending.pop();
      if (typeof current === 'string') {
        for (const match of current.matchAll(assetPath)) {
          if (kinds.has(match[1])) references.add(match[0]);
        }
        // Props and cube skyboxes can themselves be JSON strings. Decode escaped
        // URLs too; ordinary text remains a harmless conservative reference scan.
        if (['[', '{', '"'].includes(current.trimStart()[0])) {
          try {
            pending.push(JSON.parse(current));
          } catch {
            // Not JSON; any literal references were already collected above.
          }
        }
      } else if (current && typeof current === 'object' && !seen.has(current)) {
        seen.add(current);
        if (current instanceof Map || current instanceof Set) {
          for (const item of current.values()) pending.push(item);
        } else {
          for (const item of Object.values(current)) pending.push(item);
        }
      }
    }
  }

  function collectLiveReferences(references) {
    for (const room of liveRooms) collectReferences(roomAssetValues(room), references);
  }

  async function findOrphanAssets() {
    const referenced = new Set();
    // Retain references from rooms that dispose while the database read is in
    // progress, then include rooms and private data created during that read.
    collectLiveReferences(referenced);
    collectReferences(await allAssetRefBlobs(), referenced); // failure aborts cleanup
    collectLiveReferences(referenced);
    const cutoff = Date.now() - MIN_AGE_MS;
    const orphans = [];
    for (const kind of kinds) {
      let names;
      try {
        names = fs.readdirSync(path.join(assetsDir, kind));
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      for (const name of names) {
        const stat = fs.lstatSync(path.join(assetsDir, kind, name));
        if (!stat.isFile() || stat.mtimeMs > cutoff) continue;
        const url = `/assets/${kind}/${name}`;
        if (!referenced.has(url)) orphans.push({ url, kind, name, size: stat.size });
      }
    }
    return orphans;
  }

  function trashOrphans(orphans) {
    const moved = [];
    for (const orphan of orphans) {
      const { kind, name, url } = orphan;
      if (!kinds.has(kind) || !/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..')
        throw new Error('Invalid orphan asset path');
      try {
        const source = path.join(assetsDir, kind, name);
        if (!fs.lstatSync(source).isFile()) continue;
        const destDir = path.join(assetsDir, '.trash', kind);
        fs.mkdirSync(destDir, { recursive: true });
        fs.renameSync(source, path.join(destDir, name));
        // Texture derivatives are reproducible and must not outlive a removed original.
        fs.rmSync(path.join(assetsDir, '.texture-cache', 'v1', kind, `${name}.webp`), {
          force: true,
        });
        moved.push(url);
      } catch (error) {
        console.error('[cleanup] move', url, error.message);
      }
    }
    return moved;
  }

  return { findOrphanAssets, trashOrphans };
}
