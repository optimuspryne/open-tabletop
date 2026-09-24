import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
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
  const bytes = await sharp({ create: { width: 4, height: 4, channels: 4, background: '#ff00ff' } })
    .png()
    .toBuffer();
  const filename = '123456789abcdef012.png';
  await fs.writeFile(path.join(root, 'dice', filename), bytes);
  const rows = new Map([
    ['1', { name: 'Original', url: '/assets/dice/' + filename, isPublic: true, ownerId: 'old' }],
  ]);
  const db = {
    getDice: async (id) => rows.get(id),
    importDicePackage: async (value, authorize) => {
      assert.ok(await authorize());
      const id = String(rows.size + 1);
      rows.set(id, { ...value, isPublic: false });
      return id;
    },
  };
  const service = createAssetPackages({ db, assetsDir: root });
  const value = await service.exportDice('1', yes);
  return { root, bytes, filename, rows, db, service, value };
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
  const copy = await f.service.importDice(f.value, 'Copy', 'new-admin', yes);
  const row = f.rows.get(copy.id);
  assert.equal(row.isPublic, false);
  assert.equal(row.ownerId, 'new-admin');
  assert.notEqual(row.url, f.rows.get('1').url);
  assert.deepEqual(await fs.readFile(path.join(f.root, row.url.slice('/assets/'.length))), f.bytes);
  const second = await f.service.importDice(f.value, 'Copy', 'new-admin', yes);
  assert.notEqual(second.id, copy.id);
  assert.equal(f.rows.get('1').name, 'Original');
  const exported = await f.service.exportDice(copy.id, yes);
  assert.deepEqual(exported.files, f.value.files);
  assert.ok(!JSON.stringify(exported).includes('ownerId'));
  const destination = await fixture(t);
  const transferred = await destination.service.importDice(
    f.value,
    'Other installation',
    'other-admin',
    yes,
  );
  assert.deepEqual(
    (await destination.service.exportDice(transferred.id, yes)).files,
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
  await assert.rejects(f.service.exportDice('../1', yes), /Invalid asset ID/);
  await assert.rejects(f.service.exportDice('99', yes), /not found/);
  await assert.rejects(
    f.service.exportDice('1', async () => false),
    /Admin access/,
  );
  f.rows.get('1').url = 'https://example.test/image.png';
  await assert.rejects(f.service.exportDice('1', yes), /local uploaded/);
  f.rows.get('1').url = '/assets/dice/' + f.filename;
  await fs.unlink(path.join(f.root, 'dice', f.filename));
  await assert.rejects(f.service.exportDice('1', yes), /missing/);
  await fs.symlink('/etc/passwd', path.join(f.root, 'dice', f.filename));
  await assert.rejects(f.service.exportDice('1', yes), /symbolic link/);
});
test('failed imports remove only new files; uncertain commits preserve recoverable data', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.service.importDice(f.value, 'Copy', 'admin', async () => false),
    /Admin access/,
  );
  f.db.importDicePackage = async () => {
    throw new Error('database unavailable');
  };
  await assert.rejects(f.service.importDice(f.value, 'Copy', 'admin', yes), /database unavailable/);
  assert.deepEqual(await fs.readdir(path.join(f.root, 'dice')), [f.filename]);
  f.db.importDicePackage = async () => {
    throw Object.assign(new Error('uncertain'), { preserveAssetFile: true });
  };
  await assert.rejects(f.service.importDice(f.value, 'Copy', 'admin', yes), /uncertain/);
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
      db.importDicePackage(
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
  assert.equal(
    (await post('/preview', '"' + 'a'.repeat(ASSET_PACKAGE.maxPackageBytes) + '"')).status,
    413,
  );
  const imported = await post('/import', { package: f.value, name: 'HTTP Copy' });
  assert.equal(imported.status, 201);
  assert.equal((await imported.json()).isPublic, false);
  const exported = await fetch(base + '/dice/1', { headers: { Authorization: 'Bearer admin' } });
  assert.equal(exported.headers.get('cache-control'), 'no-store');
  assert.match(exported.headers.get('content-disposition'), /dice-texture.ott.json/);
  assert.deepEqual(await exported.json(), f.value);
});
