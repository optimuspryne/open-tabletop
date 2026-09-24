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

// A real self-contained GLB keeps the authored material and embedded texture in its binary chunk.
function modelBytes(image, overrides = {}) {
  const geometry = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]).buffer);
  const bin = Buffer.concat([geometry, image, Buffer.alloc((4 - (image.length % 4)) % 4)]);
  const gltf = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: image.length },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 0, 1],
      },
    ],
    images: [{ bufferView: 1, mimeType: 'image/png' }],
    textures: [{ source: 0 }],
    materials: [
      {
        name: 'Authored material',
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicFactor: 0.2,
          roughnessFactor: 0.7,
        },
      },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
    ...overrides,
  };
  const json = Buffer.from(JSON.stringify(gltf));
  const padded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(20),
    binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + padded.length + bin.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, padded, binHeader, bin]);
}
async function surfaceFixture(t) {
  const f = await fixture(t);
  for (const category of ['boards', 'mats', 'sky']) {
    await fs.mkdir(path.join(f.root, category));
    await fs.writeFile(path.join(f.root, category, f.filename), f.bytes);
  }
  const glb = modelBytes(f.bytes),
    modelName = '0123456789abcdef01.glb';
  await fs.writeFile(path.join(f.root, 'boards', modelName), glb);
  const rec = {
    model: '/assets/boards/' + modelName,
    modelScale: 2.5,
    box: [3, 0.3, 2],
    compoundCollider: {
      version: 1,
      shapes: [
        { type: 'box', position: [0, 0, 0], size: [1, 0.1, 0.7], rotation: [0, 0.2, 0] },
        { type: 'sphere', position: [0.2, 0.1, 0.1], size: [0.2, 0.2, 0.2], rotation: [0, 0, 0] },
        {
          type: 'outline',
          position: [-0.2, 0.1, 0],
          size: [0.3, 0.1, 0.3],
          rotation: [0, 0.1, 0],
          outline: { type: 'hexagon' },
        },
      ],
    },
  };
  const board = { name: 'Model board', rec },
    mat = {
      name: 'Player mat',
      tex: '/assets/mats/' + f.filename,
      geom: { w: 4, h: 2, t: 0.02, round: 0.1, shape: 'rect' },
    },
    sky = {
      name: 'Cubemap',
      url: JSON.stringify({ t: 'cube', f: Array(6).fill('/assets/sky/' + f.filename) }),
    };
  Object.assign(f.db, {
    getBoard: async () => board,
    getMat: async () => mat,
    getSkybox: async () => sky,
    getCollectionForPackage: async () => ({
      name: 'Surfaces',
      assets: [
        { kind: 'board', asset: board },
        { kind: 'mat', asset: mat },
        { kind: 'sky', asset: sky },
        { kind: 'dice', asset: f.dice },
      ],
    }),
  });
  return { ...f, board, mat, sky, glb, modelName };
}

test('surface ZIP packages retain original model/material bytes, board collider physics, mat geometry and cube face order across stores', async (t) => {
  const source = await surfaceFixture(t),
    destination = await surfaceFixture(t);
  const { colliderSpec } = await import('../shared/collider-spec.js');
  // Distinct face, with a repeated face in its authored position.
  const other = await sharp({ create: { width: 4, height: 4, channels: 4, background: '#123456' } })
    .png()
    .toBuffer();
  await fs.writeFile(path.join(source.root, 'sky', '123456789abcdef012.png'), other);
  source.sky.url = JSON.stringify({
    t: 'cube',
    f: [...Array(5).fill('/assets/sky/' + source.filename), '/assets/sky/123456789abcdef012.png'],
  });
  for (const kind of ['board', 'mat', 'sky', 'collection']) {
    await withBytes(source, await source.exported(kind), async ({ manifest, readFile }) => {
      const preview = await destination.packages.inspect(manifest, { readFile });
      assert.equal(preview.summary.kind, kind);
      await destination.packages.importAsset(manifest, 'Imported ' + kind, 'admin', yes, {
        readFile,
      });
      const saved = destination.writes.at(-1);
      const members = kind === 'collection' ? saved.value.assets : [{ kind, data: saved.value }];
      for (const member of members) {
        if (member.kind === 'board') {
          const record = member.data.rec;
          assert.deepEqual({ ...record, model: source.board.rec.model }, source.board.rec);
          assert.deepEqual(colliderSpec('board', record), colliderSpec('board', source.board.rec));
          assert.notEqual(record.model, source.board.rec.model);
          assert.deepEqual(
            await fs.readFile(path.join(destination.root, record.model.slice('/assets/'.length))),
            source.glb,
          );
          destination.board.rec = record;
        } else if (member.kind === 'mat') {
          assert.deepEqual(member.data.geom, source.mat.geom);
          assert.match(member.data.tex, /^\/assets\/mats\//);
          destination.mat.tex = member.data.tex;
        } else if (member.kind === 'sky') {
          const faces = JSON.parse(member.data.url).f;
          assert.equal(faces.length, 6);
          assert.equal(new Set(faces.slice(0, 5)).size, 1);
          assert.notEqual(faces[0], faces[5]);
          assert.deepEqual(
            await fs.readFile(path.join(destination.root, faces[5].slice('/assets/'.length))),
            other,
          );
          destination.sky.url = member.data.url;
        }
      }
      // Re-export from the destination store proves remapped storage refs remain portable.
      await withBytes(destination, await destination.exported(kind), async (archive) => {
        assert.equal(
          (await destination.packages.inspect(archive.manifest, { readFile: archive.readFile }))
            .summary.kind,
          kind,
        );
      });
    });
  }
});

test('flat/image/model-outline boards and panoramic skyboxes retain their authored variants', async (t) => {
  const f = await surfaceFixture(t);
  const variants = [
    { w: 8, d: 6 },
    {
      w: 8,
      d: 6,
      thickness: 0.3,
      tex: '/assets/boards/' + f.filename,
      outline: { type: 'clipped', cut: 0.1 },
    },
    {
      model: f.board.rec.model,
      modelScale: 1.2,
      box: [2, 0.1, 1],
      outline: { type: 'hexagon', fit: { scale: [0.8, 0.7], rotation: 0.2 } },
    },
  ];
  const { colliderSpec } = await import('../shared/collider-spec.js');
  for (const rec of variants) {
    f.board.rec = rec;
    await withBytes(f, await f.exported('board'), async ({ manifest, readFile }) => {
      if (!rec.model && !rec.tex) assert.equal(manifest.files.length, 0);
      await f.packages.importAsset(manifest, 'Board', 'admin', yes, { readFile });
      const saved = f.writes.at(-1).value.rec;
      assert.deepEqual(colliderSpec('board', saved), colliderSpec('board', rec));
      assert.deepEqual(
        {
          ...saved,
          ...(rec.model ? { model: rec.model } : {}),
          ...(rec.tex ? { tex: rec.tex } : {}),
        },
        rec,
      );
    });
  }
  f.sky.url = '/assets/sky/' + f.filename;
  await withBytes(f, await f.exported('sky'), async ({ manifest, readFile }) => {
    assert.equal((await f.packages.inspect(manifest, { readFile })).summary.type, 'equirect');
    await f.packages.importAsset(manifest, 'Panorama', 'admin', yes, { readFile });
    assert.match(f.writes.at(-1).value.url, /^\/assets\/sky\//);
  });
});

test('surface metadata and model dependency failures reject before persistence and clean temporary files', async (t) => {
  const f = await surfaceFixture(t),
    { manifest, files } = await packageFixture(f);
  for (const mutate of [
    (p) => (p.assets[0].data.compoundCollider.shapes[0].size[0] = 0),
    (p) => (p.assets[0].data.compoundCollider.shapes[0].presetId = 'unknown'),
    (p) => (p.assets[0].data.outline = { type: 'circle' }),
    (p) => (p.assets[0].data.model = { file: 'file-2' }),
    (p) => (p.assets[1].data.tex = { file: 'file-1' }),
    (p) => (p.assets[1].data.geom.w = 100),
    (p) => p.assets[2].data.faces.pop(),
    (p) => (p.assets[2].data.faces[0] = { file: 'file-999' }),
    (p) => (p.assets[0].data.model = { file: 'file-1', url: 'https://example.invalid/model.glb' }),
  ]) {
    const bad = structuredClone(manifest);
    mutate(bad);
    await withBytes(f, await zipBytes(bad, files), async ({ manifest, readFile }) => {
      await assert.rejects(f.packages.importAsset(manifest, 'Bad', 'admin', yes, { readFile }));
    });
  }
  assert.equal(f.writes.length, 0);
  for (const glb of [
    Buffer.from('not a GLB file at all'),
    modelBytes(f.bytes, { buffers: [{ uri: 'https://example.invalid/data.bin' }] }),
    modelBytes(f.bytes, { images: [{ uri: '../outside.png' }] }),
    modelBytes(f.bytes, { images: 1 }),
  ]) {
    await fs.writeFile(path.join(f.root, 'boards', f.modelName), glb);
    await assert.rejects(f.exported('board'), /GLB/);
    assert.deepEqual(await fs.readdir(f.tempRoot), []);
  }
  await fs.writeFile(path.join(f.root, 'boards', f.modelName), f.glb);
  const original = f.board.rec.model;
  for (const ref of [
    'https://example.invalid/model.glb',
    '/assets/mats/' + f.modelName,
    '/assets/boards/../' + f.modelName,
  ]) {
    f.board.rec.model = ref;
    await assert.rejects(f.exported('board'), /supported local/);
  }
  f.board.rec.model = original;
  const before = await Promise.all(
    ['boards', 'mats', 'sky', 'dice'].map((c) => fs.readdir(path.join(f.root, c))),
  );
  f.db.importAssetPackage = async () => {
    throw new Error('database failure');
  };
  await withBytes(f, await f.exported(), async ({ manifest, readFile }) => {
    await assert.rejects(
      f.packages.importAsset(manifest, 'Failed', 'admin', yes, { readFile }),
      /database failure/,
    );
  });
  assert.deepEqual(
    await Promise.all(
      ['boards', 'mats', 'sky', 'dice'].map((c) => fs.readdir(path.join(f.root, c))),
    ),
    before,
  );
});

test('board, mat, sky and model routes deliver ZIPs and import new private copies through the production router', async (t) => {
  const f = await propFixture(t),
    app = express();
  app.use(
    '/asset-packages',
    createAssetPackagesRouter({
      packages: f.packages,
      archives: f.archives,
      rateLimitUpload: (req, res, next) => next(),
      requireAdmin: async (req, res) => {
        if (req.headers.authorization === 'Bearer admin') return { id: 'admin' };
        res.status(403).json({ error: 'Admin required' });
        return null;
      },
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/asset-packages`;
  const headers = { Authorization: 'Bearer admin', 'Content-Type': 'application/zip' };
  for (const kind of ['board', 'mat', 'sky', 'prop']) {
    assert.equal((await fetch(base + '/' + kind + '/1')).status, 403);
    const exported = await fetch(base + '/' + kind + '/1', { headers });
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-disposition'), new RegExp(kind + '\\.ott\\.zip'));
    const bytes = Buffer.from(await exported.arrayBuffer());
    const preview = await fetch(base + '/preview', { method: 'POST', headers, body: bytes });
    assert.equal(preview.status, 200);
    assert.equal((await preview.json()).kind, kind);
    const imported = await fetch(base + '/import?name=Private%20surface', {
      method: 'POST',
      headers,
      body: bytes,
    });
    assert.equal(imported.status, 201);
    assert.deepEqual(await imported.json(), {
      id: '2',
      name: 'Private surface',
      kind,
      isPublic: false,
    });
    assert.equal(f.writes.at(-1).value.ownerId, 'admin');
    assert.deepEqual(await fs.readdir(f.tempRoot), []);
  }
});

async function propFixture(t) {
  const f = await surfaceFixture(t);
  await fs.mkdir(path.join(f.root, 'props'));
  await fs.writeFile(path.join(f.root, 'props', f.modelName), f.glb);
  const prop = {
    name: 'Authored model',
    props: {
      model: '/assets/props/' + f.modelName,
      box: [0.5, 0.2, 0.3],
      scale: 1.8,
      stand: true,
      modelRot: [0.2, 0.4, 0.1],
      cells: 3,
      color: 0xabcdef,
      tintMaterial: 'Authored material',
      compoundCollider: structuredClone(f.board.rec.compoundCollider),
      dispenser: {
        appearance: 'custom',
        infinite: false,
        defaultCount: 23,
        model: '/assets/props/' + f.modelName,
        box: [0.8, 0.5, 0.8],
        scale: 1.2,
        modelRot: [0, 0.2, 0],
        collider: 'cylinder',
        tintMaterial: null,
      },
    },
  };
  f.db.getProp = async () => prop;
  f.db.getCollectionForPackage = async () => ({
    name: 'Models',
    assets: [
      { kind: 'board', asset: f.board },
      { kind: 'prop', asset: prop },
    ],
  });
  return { ...f, prop };
}

test('model board export accepts the actual shared model-upload destination and preserves collider metadata', async (t) => {
  const f = await propFixture(t),
    app = express();
  const { createUploadRouter } = await import('../server/http/routes/uploads.js');
  const { writeFileSync } = await import('node:fs');
  app.use(
    createUploadRouter({
      rateLimitUpload: (req, res, next) => next(),
      requireAdmin: async () => ({ id: 'admin' }),
      saveAsset: (kind, bytes, extension) => {
        assert.equal(kind, 'props');
        assert.equal(extension, 'glb');
        const filename = 'fedcba987654321012.glb';
        writeFileSync(path.join(f.root, kind, filename), bytes);
        return '/assets/' + kind + '/' + filename;
      },
    }),
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/upload-model?kind=props`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'model/gltf-binary' },
      body: f.glb,
    },
  );
  assert.equal(response.status, 200);
  f.board.rec.model = (await response.json()).url;
  const { colliderSpec } = await import('../shared/collider-spec.js');
  await withBytes(f, await f.exported('board'), async ({ manifest, readFile }) => {
    assert.deepEqual(await readFile(manifest.files[0]), f.glb);
    await f.packages.importAsset(manifest, 'Uploaded model board', 'admin', yes, { readFile });
    const saved = f.writes.at(-1).value.rec;
    assert.match(saved.model, /^\/assets\/boards\//);
    assert.deepEqual(colliderSpec('board', saved), colliderSpec('board', f.board.rec));
    f.board.rec = saved;
    await f.exported('board');
  });
});

test('standalone model and collection ZIPs preserve appearance, physics and saved dispenser dependencies across stores', async (t) => {
  const f = await propFixture(t),
    destination = await propFixture(t);
  const { colliderSpec } = await import('../shared/collider-spec.js');
  const { OBJECT_FINISHES } = await import('../shared/pieces.js');
  f.prop.props.finish = OBJECT_FINISHES[0].key;
  // A distinct custom dispenser GLB must be included, not merely the object's model.
  const dispenser = modelBytes(f.bytes, {
    materials: [{ name: 'Container material', doubleSided: true }],
  });
  await fs.writeFile(path.join(f.root, 'props', '123456789abcdef012.glb'), dispenser);
  f.prop.props.dispenser.model = '/assets/props/123456789abcdef012.glb';
  for (const kind of ['prop', 'collection']) {
    await withBytes(f, await f.exported(kind), async ({ manifest, readFile }) => {
      assert.equal(manifest.files.length, 2);
      const summary = (await destination.packages.inspect(manifest, { readFile })).summary;
      const item = kind === 'prop' ? summary : summary.members.find((m) => m.kind === 'prop');
      assert.equal(item.dispenser, true);
      assert.equal(item.collider, 'compound');
      await destination.packages.importAsset(manifest, 'Private models', 'admin', yes, {
        readFile,
      });
      const saved = destination.writes.at(-1).value;
      const props =
        kind === 'prop' ? saved.props : saved.assets.find((a) => a.kind === 'prop').data.props;
      assert.deepEqual(
        {
          ...props,
          model: f.prop.props.model,
          dispenser: { ...props.dispenser, model: f.prop.props.dispenser.model },
        },
        f.prop.props,
      );
      assert.deepEqual(colliderSpec('prop', props), colliderSpec('prop', f.prop.props));
      assert.deepEqual(
        await fs.readFile(path.join(destination.root, props.model.slice('/assets/'.length))),
        f.glb,
      );
      assert.deepEqual(
        await fs.readFile(
          path.join(destination.root, props.dispenser.model.slice('/assets/'.length)),
        ),
        dispenser,
      );
      destination.prop.props = props;
      await destination.exported('prop');
    });
  }
  // Primitive/default colliders and dispenser appearances share the saved object validator.
  for (const collider of [undefined, 'sphere', 'cylinder', 'cone', 'flat']) {
    const props = { model: f.prop.props.model, box: [0.5, 0.2, 0.3], scale: 1, stand: false };
    if (collider) props.collider = collider;
    props.dispenser = { appearance: 'automatic', infinite: true };
    f.prop.props = props;
    await withBytes(f, await f.exported('prop'), async ({ manifest, readFile }) => {
      await destination.packages.importAsset(manifest, 'Primitive', 'admin', yes, { readFile });
      assert.deepEqual(
        colliderSpec('prop', destination.writes.at(-1).value.props),
        colliderSpec('prop', props),
      );
    });
  }
});

test('model metadata, missing secondary GLBs and live inventory fail without partial imports', async (t) => {
  const f = await propFixture(t),
    { manifest, files } = await packageFixture(f);
  for (const change of [
    (p) => (p.assets[1].data.compoundCollider.shapes[0].size[0] = 0),
    (p) => (p.assets[1].data.modelRot[0] = 99),
    (p) => (p.assets[1].data.cells = 0),
    (p) => (p.assets[1].data.finish = 'unknown'),
    (p) => (p.assets[1].data.dispenser.model = { file: 'file-99' }),
    (p) => (p.assets[1].data.dispenser.count = 9),
    (p) => (p.assets[1].data.dispenser.inventory = ['private piece']),
    (p) => (p.assets[1].data.tintMaterial = '   '),
    (p) => (p.assets[1].data.model = { file: 'file-1', url: 'https://example.invalid/model.glb' }),
  ]) {
    const bad = structuredClone(manifest);
    change(bad);
    await withBytes(f, await zipBytes(bad, files), async ({ manifest, readFile }) => {
      await assert.rejects(
        f.packages.importAsset(manifest, 'Bad model', 'admin', yes, { readFile }),
      );
    });
  }
  assert.equal(f.writes.length, 0);
  f.prop.props.dispenser.model = '/assets/props/000000000000000000.glb';
  await assert.rejects(f.exported('prop'), /missing/);
  f.prop.props.dispenser.model = f.prop.props.model;
  const before = await fs.readdir(path.join(f.root, 'props'));
  f.db.importAssetPackage = async () => {
    throw new Error('rollback');
  };
  await withBytes(f, await f.exported('prop'), async ({ manifest, readFile }) => {
    await assert.rejects(
      f.packages.importAsset(manifest, 'Failure', 'admin', yes, { readFile }),
      /rollback/,
    );
  });
  assert.deepEqual(await fs.readdir(path.join(f.root, 'props')), before);
  assert.deepEqual(await fs.readdir(f.tempRoot), []);
});
