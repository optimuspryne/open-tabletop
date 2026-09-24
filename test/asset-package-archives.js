import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { request } from 'node:http';
import { once } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import express from 'express';
import yazl from 'yazl';
import { ASSET_ARCHIVE } from '../shared/asset-package.js';
import { createAssetPackages } from '../server/assets/packages.js';
import { openAssetArchive, createAssetPackageArchives } from '../server/assets/package-archives.js';
import { createAssetPackagesRouter } from '../server/http/routes/asset-packages.js';

const yes = async () => true;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ott-archive-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const dir of ['dice', 'decks', 'staging']) await fs.mkdir(path.join(root, dir));
  const bytes = await sharp({ create: { width: 4, height: 4, channels: 4, background: '#abcdef' } })
    .png()
    .toBuffer();
  const filename = '0123456789abcdef01.png';
  await fs.writeFile(path.join(root, 'dice', filename), bytes);
  await fs.writeFile(path.join(root, 'decks', filename), bytes);
  const dice = { name: 'Original die', url: '/assets/dice/' + filename };
  const deck = {
    name: 'Original tiles',
    back: '/assets/decks/' + filename,
    fronts: ['text:A', { front: '/assets/decks/' + filename, back: 'text:B' }],
    geom: null,
    open: true,
    deckModel: null,
    color: null,
    textColor: null,
  };
  const writes = [];
  const db = {
    getDice: async () => dice,
    getDeck: async () => deck,
    getCollectionForPackage: async () => ({
      name: 'Game',
      assets: [
        { kind: 'dice', asset: dice },
        { kind: 'deck', asset: deck },
      ],
    }),
    importAssetPackage: async (kind, value, authorize) => {
      assert.equal(await authorize(), true);
      writes.push({ kind, value });
      return '2';
    },
  };
  const packages = createAssetPackages({ db, assetsDir: root });
  const tempRoot = path.join(root, 'staging');
  const archives = createAssetPackageArchives({ packages, tempRoot });
  async function exported(kind = 'collection', authorize = yes) {
    return archives.exportArchive(kind, '1', authorize, async ({ stream, size }) => {
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const data = Buffer.concat(chunks);
      assert.equal(data.length, size);
      return data;
    });
  }
  return { root, bytes, filename, dice, deck, db, packages, archives, tempRoot, writes, exported };
}
async function zipBytes(manifest, entries, { compress = false } = {}) {
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json', { compress });
  for (const entry of entries)
    zip.addBuffer(entry.bytes, entry.name, { compress, ...entry.options });
  zip.end();
  const chunks = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk);
  return Buffer.concat(chunks);
}
async function withBytes(f, bytes, run) {
  const filename = path.join(f.root, 'input.zip');
  await fs.writeFile(filename, bytes);
  const archive = await openAssetArchive(filename);
  try {
    return await run(archive);
  } finally {
    await archive.close();
  }
}
async function packageFixture(f) {
  let manifest;
  const files = [];
  manifest = await f.packages.exportAsset('collection', '1', yes, {
    writeFile: async (file, bytes) => files.push({ name: file.path, bytes }),
  });
  return { manifest, files };
}
test('ZIP exports contain a small manifest and exact originals; all supported kinds import privately', async (t) => {
  const f = await fixture(t);
  for (const kind of ['dice', 'deck', 'collection']) {
    const zipped = await f.exported(kind);
    assert.deepEqual(await fs.readdir(f.tempRoot), []);
    await withBytes(f, zipped, async ({ manifest, readFile }) => {
      assert.equal(manifest.version, 4);
      assert.equal(manifest.files.length, 1);
      assert.equal(Object.hasOwn(manifest.files[0], 'data'), false);
      assert.equal(manifest.files[0].sha256, hash(f.bytes));
      assert.deepEqual(await readFile(manifest.files[0]), f.bytes);
      const inspected = await f.packages.inspect(manifest, { readFile });
      assert.equal(inspected.summary.kind, kind);
      assert.equal(inspected.files[0].bytes, undefined, 'Inspection must not retain image buffers');
      assert.equal(typeof inspected.files[0].readBytes, 'function');
      const result = await f.packages.importAsset(manifest, 'Private copy', 'admin', yes, {
        readFile,
      });
      assert.equal(result.isPublic, false);
      const saved = f.writes.at(-1);
      assert.equal(saved.kind, kind);
      assert.equal(saved.value.ownerId, 'admin');
      if (kind === 'collection') {
        assert.match(saved.value.assets[0].data.url, /^\/assets\/dice\//);
        assert.match(saved.value.assets[1].data.back, /^\/assets\/decks\//);
        assert.notEqual(saved.value.assets[0].data.url, saved.value.assets[1].data.back);
        assert.deepEqual(saved.value.assets[1].data.fronts[1].back, 'text:B');
      }
    });
  }
});
test('ZIP import accepts deflated originals and applies the larger binary file/pixel budgets', async (t) => {
  const f = await fixture(t);
  // A real >8 MiB original proves the archive path does not inherit the legacy per-file cap.
  const bytes = await sharp(randomBytes(1536 * 1536 * 4), {
    raw: { width: 1536, height: 1536, channels: 4 },
  })
    .png({ compressionLevel: 0 })
    .toBuffer();
  assert.ok(bytes.length > 8 * 1024 ** 2);
  await fs.writeFile(path.join(f.root, 'dice', f.filename), bytes);
  await assert.rejects(f.packages.exportAsset('dice', '1', yes), /8 MiB/);
  const zipped = await f.exported('dice');
  await withBytes(f, zipped, async ({ manifest, readFile }) => {
    assert.equal(
      (await f.packages.inspect(manifest, { readFile })).summary.totalBytes,
      bytes.length,
    );
  });
  // Eight distinct originals exceed the old 64 MiB aggregate ceiling. Stream the ZIP
  // to disk rather than collecting its payload, matching the production transport.
  const fronts = [];
  for (let i = 0; i < 8; i++) {
    const name = (i + 1).toString(16).padStart(18, '0') + '.png';
    await fs.writeFile(path.join(f.root, 'decks', name), Buffer.concat([bytes, Buffer.from([i])]));
    fronts.push('/assets/decks/' + name);
  }
  f.deck.fronts = fronts;
  f.deck.back = 'back';
  const archivePath = path.join(f.root, 'large.zip');
  await f.archives.exportArchive('deck', '1', yes, ({ stream }) =>
    pipeline(stream, createWriteStream(archivePath)),
  );
  const large = await openAssetArchive(archivePath);
  try {
    const checked = await f.packages.inspect(large.manifest, { readFile: large.readFile });
    assert.ok(checked.summary.totalBytes > 64 * 1024 ** 2);
    assert.equal(
      checked.files.every((file) => file.bytes === undefined),
      true,
    );
    await f.packages.importAsset(large.manifest, 'Large originals', 'admin', yes, {
      readFile: large.readFile,
    });
    const copied = f.writes.at(-1).value.fronts;
    for (let i = 0; i < copied.length; i++) {
      const actual = await fs.readFile(path.join(f.root, copied[i].replace('/assets/', '')));
      assert.equal(hash(actual), large.manifest.files[i].sha256);
    }
  } finally {
    await large.close();
  }
  const largePixels = await sharp({
    create: { width: 4224, height: 4224, channels: 3, background: '#abcdef' },
  })
    .png()
    .toBuffer();
  await fs.writeFile(path.join(f.root, 'dice', f.filename), largePixels);
  await assert.rejects(f.packages.exportAsset('dice', '1', yes), /image limits/);
  await withBytes(f, await f.exported('dice'), async ({ manifest, readFile }) => {
    assert.equal((await f.packages.inspect(manifest, { readFile })).summary.files[0].width, 4224);
  });
  const { manifest, files } = await packageFixture(f);
  await withBytes(
    f,
    await zipBytes(manifest, files, { compress: true }),
    async ({ manifest, readFile }) => {
      assert.equal((await f.packages.inspect(manifest, { readFile })).summary.kind, 'collection');
    },
  );
});
test('ZIP reader rejects unsafe entries, mismatched closure, corrupt images and expansion abuse', async (t) => {
  const f = await fixture(t),
    { manifest, files } = await packageFixture(f);
  const variants = [
    [{ ...manifest, version: 99 }, files],
    [manifest, []],
    [manifest, [...files, files[0]]],
    [manifest, [...files, { name: 'unlisted.txt', bytes: Buffer.from('extra') }]],
    [manifest, files.map((file) => ({ ...file, options: { mode: 0o120777 } }))],
    [
      manifest,
      files.map((file) => ({
        ...file,
        options: { fileComment: 'x'.repeat(ASSET_ARCHIVE.maxEntryMetadataBytes) },
      })),
    ],
    [{ ...manifest, files: [{ ...manifest.files[0], path: '../image.png' }] }, files],
    [{ ...manifest, files: [{ ...manifest.files[0], sha256: '0'.repeat(64) }] }, files],
    [manifest, files.map((file) => ({ ...file, bytes: Buffer.alloc(file.bytes.length) }))],
    [manifest, files.map((file) => ({ ...file, bytes: Buffer.from('short') }))],
  ];
  for (const [value, entries] of variants) {
    await assert.rejects(
      withBytes(f, await zipBytes(value, entries), ({ manifest, readFile }) =>
        f.packages.importAsset(manifest, 'bad', 'admin', yes, { readFile }),
      ),
    );
  }
  const good = await zipBytes(manifest, files);
  const central = good.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  for (const mutate of [
    (b) => b.writeUInt16LE(1, central + 8), // encrypted entry
    (b) => b.writeUInt16LE(99, central + 10), // unsupported compression
    (b) => b.writeUInt32LE(ASSET_ARCHIVE.maxFileBytes + 1, central + 24),
    (b) => {
      // Same-length replacement in both the central and local headers.
      const from = Buffer.from('files/file-1.png'),
        to = Buffer.from('../xx/file-1.png');
      for (let i = b.indexOf(from); i !== -1; i = b.indexOf(from, i + to.length)) to.copy(b, i);
    },
  ]) {
    const bad = Buffer.from(good);
    mutate(bad);
    await assert.rejects(withBytes(f, bad, () => assert.fail('Unsafe archive opened')));
  }
  const compressed = await zipBytes(
    { ...manifest, files: [{ ...manifest.files[0], bytes: 12 }] },
    files,
    { compress: true },
  );
  const compressedCentral = compressed.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  compressed.writeUInt32LE(12, compressedCentral + 24);
  await assert.rejects(
    withBytes(f, compressed, ({ manifest, readFile }) =>
      f.packages.inspect(manifest, { readFile }),
    ),
  );
  const tooMany = Buffer.from(good),
    end = tooMany.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  tooMany.writeUInt16LE(ASSET_ARCHIVE.maxFiles + 2, end + 10);
  await assert.rejects(
    withBytes(f, tooMany, () => {}),
    /Too many/,
  );
  await assert.rejects(withBytes(f, good.subarray(0, good.length - 16), () => {}));
  assert.equal(f.writes.length, 0);
  assert.deepEqual(await fs.readdir(path.join(f.root, 'dice')), [f.filename]);
});
test('archive staging and permanent originals are cleaned up on definite failure, retained on uncertain commit', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.exported('collection', async () => false),
    /Admin access/,
  );
  assert.deepEqual(await fs.readdir(f.tempRoot), []);
  await assert.rejects(
    f.archives.exportArchive('dice', '1', yes, async ({ stream }) => {
      stream.destroy();
      throw new Error('download disconnected');
    }),
    /disconnected/,
  );
  assert.deepEqual(await fs.readdir(f.tempRoot), []);
  const bytes = await f.exported();
  f.db.importAssetPackage = async () => {
    throw new Error('database unavailable');
  };
  await assert.rejects(
    withBytes(f, bytes, ({ manifest, readFile }) =>
      f.packages.importAsset(manifest, 'bad', 'admin', yes, { readFile }),
    ),
    /database unavailable/,
  );
  for (const dir of ['dice', 'decks'])
    assert.deepEqual(await fs.readdir(path.join(f.root, dir)), [f.filename]);
  f.db.importAssetPackage = async () => {
    throw Object.assign(new Error('uncertain'), { preserveAssetFile: true });
  };
  await assert.rejects(
    withBytes(f, bytes, ({ manifest, readFile }) =>
      f.packages.importAsset(manifest, 'uncertain', 'admin', yes, { readFile }),
    ),
    /uncertain/,
  );
  for (const dir of ['dice', 'decks'])
    assert.equal((await fs.readdir(path.join(f.root, dir))).length, 2);
});

test('binary HTTP preview/import streams ZIP uploads, rechecks auth, serializes operations and cleans aborted uploads', async (t) => {
  const f = await fixture(t),
    app = express();
  let admin = true,
    invalidations = 0;
  app.use(
    '/asset-packages',
    createAssetPackagesRouter({
      packages: f.packages,
      archives: f.archives,
      rateLimitUpload: (req, res, next) => next(),
      requireAdmin: async (req, res) => {
        if (req.headers.authorization !== 'Bearer admin') {
          res.status(401).json({ error: 'login' });
          return null;
        }
        if (!admin) {
          res.status(403).json({ error: 'admin' });
          return null;
        }
        return { id: 'admin' };
      },
      onCollectionImported: () => invalidations++,
    }),
  );
  app.use((error, req, res, next) => {
    if (res.headersSent || res.destroyed) return next(error);
    res.status(500).json({ error: 'internal' });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/asset-packages`;
  const headers = { Authorization: 'Bearer admin', 'Content-Type': 'application/zip' };
  const bytes = await f.exported();
  const post = (endpoint, body = bytes, extra = {}) =>
    fetch(base + endpoint, { method: 'POST', headers: { ...headers, ...extra }, body });
  assert.equal((await post('/preview', bytes, { Authorization: 'Bearer nobody' })).status, 401);
  const preview = await post('/preview');
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).count, 2);
  assert.equal(f.writes.length, 0);
  const imported = await post('/import?name=Archive%20copy');
  assert.equal(imported.status, 201);
  assert.equal((await imported.json()).name, 'Archive copy');
  assert.equal(invalidations, 1);
  assert.equal((await post('/import?name=')).status, 400);
  assert.equal((await post('/preview', Buffer.from('broken zip'))).status, 400);
  // Hold one chunked upload open, then try another package operation.
  const pending = request(base + '/preview', { method: 'POST', headers });
  pending.on('error', () => {});
  pending.write(bytes.subarray(0, 32));
  for (let i = 0; i < 100 && !(await fs.readdir(f.tempRoot)).length; i++)
    await new Promise((r) => setTimeout(r, 5));
  const busy = await post('/preview');
  assert.equal(busy.status, 503);
  assert.equal(busy.headers.get('retry-after'), '5');
  pending.destroy();
  for (let i = 0; i < 100 && (await fs.readdir(f.tempRoot)).length; i++)
    await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(await fs.readdir(f.tempRoot), []);
  // Revoke after the initial gate but before the final upload chunk.
  const revoked = request(base + '/preview', { method: 'POST', headers });
  revoked.on('error', () => {});
  revoked.write(bytes.subarray(0, 32));
  for (let i = 0; i < 100 && !(await fs.readdir(f.tempRoot)).length; i++)
    await new Promise((r) => setTimeout(r, 5));
  admin = false;
  const response = once(revoked, 'response');
  revoked.end(bytes.subarray(32));
  const [denied] = await response;
  denied.resume();
  assert.equal(denied.statusCode, 403);
  admin = true;
  for (let i = 0; i < 100 && (await fs.readdir(f.tempRoot)).length; i++)
    await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(await fs.readdir(f.tempRoot), []);
  assert.equal(f.writes.length, 1);
});

test('streamed uploads reject declared and actual overflow without keeping temporary files', async (t) => {
  const f = await fixture(t);
  const oversized = Readable.from([]);
  oversized.headers = { 'content-length': String(ASSET_ARCHIVE.maxPackageBytes + 1) };
  await assert.rejects(
    f.archives.withUpload(oversized, () => {}),
    { status: 413 },
  );
  assert.deepEqual(await fs.readdir(f.tempRoot), []);
  const chunk = Buffer.alloc(1024 * 1024);
  const req = Readable.from(
    (async function* () {
      for (let n = 0; n <= ASSET_ARCHIVE.maxPackageBytes; n += chunk.length) yield chunk;
    })(),
  );
  req.headers = {};
  await assert.rejects(
    f.archives.withUpload(req, () => {}),
    { status: 413 },
  );
  assert.deepEqual(await fs.readdir(f.tempRoot), []);
});
