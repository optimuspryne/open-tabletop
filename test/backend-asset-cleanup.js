import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAssetCleanup } from '../server/asset-cleanup.js';

function harness(t, overrides = {}) {
  const assetsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ott-cleanup-'));
  t.after(() => fs.rmSync(assetsDir, { recursive: true, force: true }));
  const liveRooms = new Set();
  const options = {
    assetsDir,
    assetKinds: ['uploads', 'decks', 'boards', 'props', 'sky', 'dice', 'mats'],
    liveRooms,
    allAssetRefBlobs: async () => [],
    ...overrides,
  };
  function file(kind, name, old = true) {
    const directory = path.join(assetsDir, kind);
    fs.mkdirSync(directory, { recursive: true });
    const filename = path.join(directory, name);
    fs.writeFileSync(filename, 'asset');
    if (old) {
      const time = new Date(Date.now() - 48 * 60 * 60 * 1000);
      fs.utimesSync(filename, time, time);
    }
    return `/assets/${kind}/${name}`;
  }
  return { ...createAssetCleanup(options), assetsDir, liveRooms, file };
}

test('cleanup protects every allowed category, including mats and future upload categories', async (t) => {
  const refs = [];
  const kinds = ['uploads', 'decks', 'boards', 'props', 'sky', 'dice', 'mats', 'future'];
  const h = harness(t, { assetKinds: kinds, allAssetRefBlobs: async () => refs });
  for (const kind of kinds) refs.push(JSON.stringify({ url: h.file(kind, 'used.jpg') }));
  h.file('mats', 'unused.jpg');
  const orphans = await h.findOrphanAssets();
  assert.deepEqual(
    orphans.map((o) => o.url),
    ['/assets/mats/unused.jpg'],
  );
});

test('cleanup reads public state and every private card/reference store without exposing them', async (t) => {
  const h = harness(t);
  const room = {
    state: { toJSON: () => ({ props: JSON.stringify({ tex: h.file('boards', 'board.jpg') }) }) },
  };
  room.savedScene = { pieces: [{ props: { model: h.file('props', 'saved.glb') } }] };
  for (const key of [
    'deckCards',
    'cardData',
    'hands',
    'pendingHands',
    'pendingInspect',
    'drafts',
    'shows',
    'notebooks',
  ]) {
    room[key] = new Map([['player', { cards: [{ front: h.file('decks', `${key}.jpg`) }] }]]);
  }
  room.shows.get('player').to = new Set(['session']);
  h.liveRooms.add(room);
  assert.deepEqual(await h.findOrphanAssets(), []);
});

test('references with JSON-escaped slashes survive nested props and saved snapshots', async (t) => {
  const refs = [];
  const h = harness(t, { allAssetRefBlobs: async () => refs });
  const url = h.file('mats', 'escaped.jpg');
  refs.push(JSON.stringify({ props: JSON.stringify({ tex: url }).replaceAll('/', '\\/') }));
  assert.deepEqual(await h.findOrphanAssets(), []);
});

test('live references are retained across disposal and collected after database awaits', async (t) => {
  let h;
  h = harness(t, {
    allAssetRefBlobs: async () => {
      h.liveRooms.clear();
      h.liveRooms.add({ state: { toJSON: () => ({ tex: '/assets/mats/new-room.jpg' }) } });
      return [];
    },
  });
  const url = h.file('decks', 'departing-hand.jpg');
  h.file('mats', 'new-room.jpg');
  h.liveRooms.add({
    state: { toJSON: () => ({}) },
    hands: new Map([['session', [{ front: url }]]]),
  });
  assert.deepEqual(await h.findOrphanAssets(), []);
});

test('scan/purge preserve recent files, directories, symlinks and referenced assets', async (t) => {
  const refs = [];
  const h = harness(t, { allAssetRefBlobs: async () => refs });
  refs.push(h.file('mats', 'used.jpg'));
  h.file('mats', 'recent.jpg', false);
  const old = h.file('mats', 'unused.jpg');
  const derivative = path.join(h.assetsDir, '.texture-cache', 'v1', 'mats', 'unused.jpg.webp');
  fs.mkdirSync(path.dirname(derivative), { recursive: true });
  fs.writeFileSync(derivative, 'derived texture');
  fs.mkdirSync(path.join(h.assetsDir, 'mats', 'directory'));
  fs.symlinkSync('used.jpg', path.join(h.assetsDir, 'mats', 'link.jpg'));
  const orphans = await h.findOrphanAssets();
  assert.deepEqual(
    orphans.map((o) => o.url),
    [old],
  );
  assert.deepEqual(h.trashOrphans(orphans), [old]);
  assert.equal(fs.existsSync(path.join(h.assetsDir, '.trash', 'mats', 'unused.jpg')), true);
  assert.equal(fs.existsSync(derivative), false);
  for (const name of ['used.jpg', 'recent.jpg', 'directory', 'link.jpg']) {
    assert.equal(fs.existsSync(path.join(h.assetsDir, 'mats', name)), true);
  }
  assert.deepEqual(await h.findOrphanAssets(), []);
});

test('database or live-state scan failures abort cleanup without moving files', async (t) => {
  const h = harness(t, {
    allAssetRefBlobs: async () => {
      throw new Error('database offline');
    },
  });
  h.file('mats', 'keep.jpg');
  await assert.rejects(h.findOrphanAssets(), /database offline/);
  assert.equal(fs.existsSync(path.join(h.assetsDir, 'mats', 'keep.jpg')), true);
  h.liveRooms.add({
    state: {
      toJSON() {
        throw new Error('state unavailable');
      },
    },
  });
  await assert.rejects(h.findOrphanAssets(), /state unavailable/);
});

test('trash destinations cannot escape the asset allowlist', (t) => {
  const h = harness(t);
  for (const orphan of [
    { kind: '..', name: 'x' },
    { kind: 'mats', name: '../x' },
  ]) {
    assert.throws(() => h.trashOrphans([orphan]), /Invalid orphan asset path/);
  }
});
