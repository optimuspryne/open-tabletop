import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { once } from 'node:events';
import sharp from 'sharp';
import express from 'express';
import { createAssetPackages, inspectAssetPackage } from '../server/assets/packages.js';
import { createAssetPackagesRouter } from '../server/http/routes/asset-packages.js';
import { createDatabase } from '../server/database.js';
import { ASSET_PACKAGE } from '../shared/asset-package.js';

const yes = async () => true;
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ott-package-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'dice'));
  await fs.mkdir(path.join(root, 'decks'));
  const bytes = await sharp({ create: { width: 4, height: 4, channels: 4, background: '#ff00ff' } })
    .png()
    .toBuffer();
  const filename = '123456789abcdef012.png';
  await fs.writeFile(path.join(root, 'dice', filename), bytes);
  const rows = new Map([
    ['1', { name: 'Original', url: '/assets/dice/' + filename, isPublic: true, ownerId: 'old' }],
  ]);
  const decks = new Map();
  const db = {
    getDeck: async (id) => decks.get(id),
    getDice: async (id) => rows.get(id),
    importAssetPackage: async (kind, value, authorize) => {
      assert.ok(await authorize());
      const target = kind === 'dice' ? rows : decks;
      const id = String(target.size + 1);
      target.set(id, { ...value, isPublic: false });
      return id;
    },
  };
  const service = createAssetPackages({ db, assetsDir: root });
  const value = await service.exportAsset('dice', '1', yes);
  return { root, bytes, filename, rows, decks, db, service, value };
}
test('dice package round-trip preserves bytes and creates independent private copies', async (t) => {
  const f = await fixture(t);
  const preview = await f.service.inspect(f.value);
  assert.deepEqual(preview.summary.files[0], {
    id: 'file-1',
    mediaType: 'image/png',
    bytes: f.bytes.length,
    width: 4,
    height: 4,
  });
  assert.equal((await fs.readdir(path.join(f.root, 'dice'))).length, 1);
  const copy = await f.service.importAsset(f.value, 'Copy', 'new-admin', yes);
  const row = f.rows.get(copy.id);
  assert.equal(row.isPublic, false);
  assert.equal(row.ownerId, 'new-admin');
  assert.notEqual(row.url, f.rows.get('1').url);
  assert.deepEqual(await fs.readFile(path.join(f.root, row.url.slice('/assets/'.length))), f.bytes);
  const second = await f.service.importAsset(f.value, 'Copy', 'new-admin', yes);
  assert.notEqual(second.id, copy.id);
  assert.equal(f.rows.get('1').name, 'Original');
  const exported = await f.service.exportAsset('dice', copy.id, yes);
  assert.deepEqual(exported.files, f.value.files);
  assert.ok(!JSON.stringify(exported).includes('ownerId'));
  const destination = await fixture(t);
  const transferred = await destination.service.importAsset(
    f.value,
    'Other installation',
    'other-admin',
    yes,
  );
  assert.deepEqual(
    (await destination.service.exportAsset('dice', transferred.id, yes)).files,
    f.value.files,
  );
});
test('package validation rejects unsupported data, paths, missing files, mismatches, and damaged images', async (t) => {
  const { value } = await fixture(t);
  for (const change of [
    (p) => p.version++,
    (p) => (p.assets[0].kind = 'deck'),
    (p) => (p.files = []),
    (p) => (p.assets[0].texture = '../secret'),
    (p) => (p.files[0].path = '/etc/passwd'),
    (p) => (p.assets[0].ownerId = 'other'),
    (p) => (p.assets[0].name = ' '),
    (p) => (p.files[0].sha256 = 'bad'),
    (p) => p.files[0].bytes++,
    (p) => (p.files[0].mediaType = 'image/jpeg'),
    (p) => (p.files[0].data = 'A'.repeat(p.files[0].data.length)),
    (p) => (p.files[0].bytes = ASSET_PACKAGE.maxFileBytes + 1),
  ]) {
    const bad = structuredClone(value);
    change(bad);
    await assert.rejects(inspectAssetPackage(bad), { name: 'Error' });
  }
  const broken = structuredClone(value),
    bytes = Buffer.from(broken.files[0].data, 'base64').subarray(0, 32);
  Object.assign(broken.files[0], {
    bytes: bytes.length,
    data: bytes.toString('base64'),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  await assert.rejects(inspectAssetPackage(broken), /damaged/);
});
test('export rejects remote paths, missing originals, symlinks and revoked access', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.service.exportAsset('dice', '../1', yes), /Invalid asset ID/);
  await assert.rejects(f.service.exportAsset('dice', '99', yes), /not found/);
  await assert.rejects(
    f.service.exportAsset('dice', '1', async () => false),
    /Admin access/,
  );
  f.rows.get('1').url = 'https://example.test/image.png';
  await assert.rejects(f.service.exportAsset('dice', '1', yes), /local uploaded/);
  f.rows.get('1').url = '/assets/dice/' + f.filename;
  await fs.unlink(path.join(f.root, 'dice', f.filename));
  await assert.rejects(f.service.exportAsset('dice', '1', yes), /missing/);
  await fs.symlink('/etc/passwd', path.join(f.root, 'dice', f.filename));
  await assert.rejects(f.service.exportAsset('dice', '1', yes), /symbolic link/);
});
test('failed imports remove only new files; uncertain commits preserve recoverable data', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.service.importAsset(f.value, 'Copy', 'admin', async () => false),
    /Admin access/,
  );
  f.db.importAssetPackage = async () => {
    throw new Error('database unavailable');
  };
  await assert.rejects(
    f.service.importAsset(f.value, 'Copy', 'admin', yes),
    /database unavailable/,
  );
  assert.deepEqual(await fs.readdir(path.join(f.root, 'dice')), [f.filename]);
  f.db.importAssetPackage = async () => {
    throw Object.assign(new Error('uncertain'), { preserveAssetFile: true });
  };
  await assert.rejects(f.service.importAsset(f.value, 'Copy', 'admin', yes), /uncertain/);
  assert.equal((await fs.readdir(path.join(f.root, 'dice'))).length, 2);
});
test('database import uses a transaction, forces private, rolls back revoked access, and marks uncertain commits', async () => {
  for (const mode of ['success', 'revoked', 'commit-error', 'insert-error']) {
    const calls = [];
    let checks = 0;
    const client = {
      query: async (sql, args) => {
        calls.push({ sql, args });
        if (
          (mode === 'commit-error' && sql === 'COMMIT') ||
          (mode === 'insert-error' && sql.includes('INSERT INTO'))
        )
          throw new Error(mode);
        return { rows: [{ id: 9 }] };
      },
      release: () => calls.push({ sql: 'RELEASE' }),
    };
    const db = createDatabase({ connect: async () => client });
    const run = () =>
      db.importAssetPackage(
        'dice',
        { name: 'Copy', url: '/assets/dice/a.png', ownerId: 'a', isPublic: true },
        async () => mode !== 'revoked' || ++checks < 2,
      );
    if (mode === 'success') assert.equal(await run(), '9');
    else
      await assert.rejects(run(), (error) => error.preserveAssetFile === (mode === 'commit-error'));
    assert.equal(calls[0].sql, 'BEGIN');
    assert.equal(calls.find((c) => c.sql.includes('INSERT INTO')).args[3], false);
    assert.equal(calls.at(-1).sql, 'RELEASE');
    assert.ok(calls.some((c) => c.sql === (mode === 'success' ? 'COMMIT' : 'ROLLBACK')));
  }
});
test('HTTP admin gate, preview, import, export and malformed JSON use production router', async (t) => {
  const f = await fixture(t);
  const app = express();
  let admin = true;
  app.use(
    '/asset-packages',
    createAssetPackagesRouter({
      packages: f.service,
      rateLimitUpload: (req, res, next) => next(),
      requireAdmin: async (req, res) => {
        if (req.headers.authorization !== 'Bearer admin') {
          res.status(401).json({ error: 'unauthorized' });
          return null;
        }
        if (!admin) {
          res.status(403).json({ error: 'admin only' });
          return null;
        }
        return { id: 'admin' };
      },
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/asset-packages`;
  const post = (endpoint, value) =>
    fetch(base + endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer admin', 'Content-Type': 'application/json' },
      body: typeof value === 'string' ? value : JSON.stringify(value),
    });
  assert.equal((await fetch(base + '/dice/1')).status, 401);
  admin = false;
  assert.equal((await post('/preview', f.value)).status, 403);
  admin = true;
  assert.equal((await post('/preview', f.value)).status, 200);
  assert.equal(f.rows.size, 1);
  assert.equal((await post('/preview', '{')).status, 400);
  const oversized = request(base + '/preview', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer admin',
      'Content-Type': 'application/json',
      'Content-Length': ASSET_PACKAGE.maxPackageBytes + 1,
    },
  });
  const tooLarge = once(oversized, 'response');
  const chunk = Buffer.alloc(512 * 1024, 32);
  for (let remaining = ASSET_PACKAGE.maxPackageBytes + 1; remaining > 0;) {
    const part = chunk.subarray(0, Math.min(chunk.length, remaining));
    remaining -= part.length;
    if (!oversized.write(part)) await once(oversized, 'drain');
  }
  oversized.end();
  const [largeResponse] = await tooLarge;
  largeResponse.resume();
  assert.equal(largeResponse.statusCode, 413);
  const imported = await post('/import', { package: f.value, name: 'HTTP Copy' });
  assert.equal(imported.status, 201);
  assert.equal((await imported.json()).isPublic, false);
  const exported = await fetch(base + '/dice/1', { headers: { Authorization: 'Bearer admin' } });
  assert.equal(exported.headers.get('cache-control'), 'no-store');
  assert.match(exported.headers.get('content-disposition'), /dice-texture.ott.json/);
  assert.deepEqual(await exported.json(), f.value);
  f.decks.set('1', {
    name: 'HTTP deck',
    back: 'back',
    fronts: ['text:One', { front: 'text:Two', back: 'tback:Back' }],
    geom: null,
    open: true,
    deckModel: null,
    color: null,
    textColor: null,
  });
  const deckExport = await fetch(base + '/deck/1', { headers: { Authorization: 'Bearer admin' } });
  assert.equal(deckExport.status, 200);
  assert.match(deckExport.headers.get('content-disposition'), /deck.ott.json/);
  const deckPackage = await deckExport.json();
  assert.equal((await post('/preview', deckPackage)).status, 200);
  const importedDeck = await post('/import', { package: deckPackage, name: 'HTTP tiles' });
  assert.equal(importedDeck.status, 201);
  assert.equal((await importedDeck.json()).kind, 'deck');
  const unsupported = await fetch(base + '/scene/1', {
    headers: { Authorization: 'Bearer admin' },
  });
  assert.equal(unsupported.status, 400);
});

async function deckFixture(t) {
  const f = await fixture(t);
  const names = ['123456789abcdef012.png', 'abcdef012345678901.png', 'abcdef012345678902.png'];
  const other = await sharp({ create: { width: 8, height: 4, channels: 4, background: '#112233' } })
    .png()
    .toBuffer();
  await fs.writeFile(path.join(f.root, 'decks', names[0]), f.bytes);
  await fs.writeFile(path.join(f.root, 'decks', names[1]), other);
  // A different filename with identical bytes should still share one dependency.
  await fs.writeFile(path.join(f.root, 'decks', names[2]), f.bytes);
  const urls = names.map((name) => '/assets/decks/' + name);
  const deck = {
    name: 'Tiles',
    back: urls[0],
    fronts: [
      urls[1],
      { front: urls[0], back: urls[1] },
      'text:#111111:#ffffff:#dddddd:Hello',
      urls[2],
    ],
    geom: { w: 0.5, h: 0.7, t: 0.08, round: 0.1, shape: 'hex' },
    open: true,
    deckModel: 'bag',
    color: '#112233',
    textColor: '#abcdef',
    isPublic: true,
    ownerId: 'old',
  };
  f.decks.set('1', deck);
  return { ...f, deck, urls, package: await f.service.exportAsset('deck', '1', yes) };
}
test('deck packages preserve ordered paired faces, shape, skin, text and original images across stores', async (t) => {
  const f = await deckFixture(t),
    value = f.package;
  assert.equal(value.version, 2);
  assert.equal(value.files.length, 2);
  assert.deepEqual(value.assets[0].fronts[3], { file: 'file-1' });
  assert.ok(!JSON.stringify(value).includes('/assets/'));
  const inspected = await inspectAssetPackage(value);
  assert.equal(inspected.summary.count, 4);
  assert.equal(inspected.summary.open, true);
  const destination = await fixture(t);
  const copy = await destination.service.importAsset(value, 'Tile copy', 'new-admin', yes);
  const saved = destination.decks.get(copy.id);
  assert.equal(saved.isPublic, false);
  assert.equal(saved.ownerId, 'new-admin');
  for (const key of ['geom', 'open', 'deckModel', 'color', 'textColor'])
    assert.deepEqual(saved[key], f.deck[key]);
  assert.equal(saved.fronts[1].front, saved.back);
  assert.equal(saved.fronts[3], saved.back);
  assert.equal(saved.fronts[0], saved.fronts[1].back);
  assert.equal(saved.fronts[2], f.deck.fronts[2]);
  assert.notEqual(saved.back, f.deck.back);
  const exported = await destination.service.exportAsset('deck', copy.id, yes);
  assert.deepEqual(exported.files, value.files);
  assert.deepEqual({ ...exported.assets[0], name: 'Tiles' }, value.assets[0]);
});
test('generated decks need no files and missing/unsupported originals fail without a partial export', async (t) => {
  const f = await deckFixture(t);
  Object.assign(f.deck, {
    back: 'back',
    fronts: [
      'rank:A:S:#000000',
      'joker:#ff0000',
      'domino:1:2',
      { front: 'letter:A:1', back: 'lback' },
    ],
  });
  const value = await f.service.exportAsset('deck', '1', yes);
  assert.equal(value.files.length, 0);
  const copy = await f.service.importAsset(value, 'Generated', 'admin', yes);
  assert.deepEqual(f.decks.get(copy.id).fronts, f.deck.fronts);
  f.deck.fronts = ['https://example.test/face.png'];
  await assert.rejects(f.service.exportAsset('deck', '1', yes), /local uploaded/);
  f.deck.fronts = ['data:image/png;base64,aaa'];
  await assert.rejects(f.service.exportAsset('deck', '1', yes), /local uploaded/);
  f.deck.fronts = ['/assets/decks/aaaaaaaaaaaaaaaaaa.png'];
  await assert.rejects(f.service.exportAsset('deck', '1', yes), /missing/);
});
test('deck validation rejects missing/unused dependencies and unsupported metadata before import', async (t) => {
  const f = await deckFixture(t);
  const mutations = [
    (p) => (p.assets[0].fronts[0] = { file: 'file-99' }),
    (p) => (p.assets[0].fronts[0] = { generated: 'https://example.test' }),
    (p) => (p.assets[0].fronts[0] = { file: '../secret' }),
    (p) => (p.assets[0].fronts[1].owner = 'private'),
    (p) => (p.assets[0].geom.extra = 'bad'),
    (p) => (p.assets[0].geom.t = 1000),
    (p) => (p.assets[0].deckModel = 'https://example.test/model.glb'),
    (p) => (p.assets[0].color = 'red'),
    (p) => (p.assets[0].fronts = []),
    (p) => (p.assets[0].fronts = Array(1001).fill({ generated: 'back' })),
    (p) => (p.assets[0].fronts = Array(30).fill({ generated: 'text:' + 'a'.repeat(100000) })),
    (p) => (p.files[1].id = 'file-1'),
    (p) => (p.files = Array(257).fill(p.files[0])),
    (p) => p.files.push({ ...p.files[0], id: 'file-3' }),
    (p) => (p.files[0].sha256 = 'bad'),
  ];
  for (const mutate of mutations) {
    const value = structuredClone(f.package);
    mutate(value);
    await assert.rejects(f.service.importAsset(value, 'bad', 'admin', yes));
  }
  assert.equal(f.decks.size, 1);
  assert.equal((await fs.readdir(path.join(f.root, 'decks'))).length, 3);
});
test('multi-image import rolls back all its new files when metadata fails or permission is revoked', async (t) => {
  const f = await deckFixture(t),
    destination = await fixture(t);
  destination.db.importAssetPackage = async (kind, data, authorize) => {
    assert.equal(kind, 'deck');
    assert.ok(await authorize());
    throw new Error('insert failed');
  };
  await assert.rejects(
    destination.service.importAsset(f.package, 'Copy', 'admin', yes),
    /insert failed/,
  );
  assert.deepEqual(await fs.readdir(path.join(destination.root, 'decks')), []);
  assert.equal((await fs.readdir(path.join(destination.root, 'dice'))).length, 1);
  let checks = 0;
  destination.db.importAssetPackage = async (kind, data, authorize) => {
    if (!(await authorize())) throw new Error('revoked');
  };
  await assert.rejects(
    destination.service.importAsset(f.package, 'Copy', 'admin', async () => ++checks < 2),
    /revoked/,
  );
  assert.deepEqual(await fs.readdir(path.join(destination.root, 'decks')), []);
});
