import fs from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import yazl from 'yazl';
import { ASSET_ARCHIVE, AssetPackageError } from '../../shared/asset-package.js';

const invalid = (message) => new AssetPackageError(message);
const malformed = (error) =>
  ['ENOENT', 'EACCES', 'EIO', 'EMFILE', 'ENFILE'].includes(error?.code)
    ? error
    : invalid('Invalid or damaged ZIP package.');

// Never extract ZIP paths to disk. Only exact manifest-listed regular entries may be read.
export async function openAssetArchive(filename) {
  let zip;
  try {
    zip = await new Promise((resolve, reject) =>
      yauzl.open(
        filename,
        {
          lazyEntries: true,
          autoClose: false,
          validateEntrySizes: true,
          strictFileNames: true,
        },
        (error, value) => (error ? reject(error) : resolve(value)),
      ),
    );
  } catch (error) {
    throw malformed(error);
  }
  let zipError = null;
  zip.on('error', (error) => {
    zipError = error;
  });
  const close = () =>
    new Promise((resolve) => {
      if (!zip.isOpen) return resolve();
      zip.once('close', resolve);
      zip.close();
    });
  try {
    if (zip.entryCount > ASSET_ARCHIVE.maxFiles + 1) throw invalid('Too many ZIP entries.');
    const entries = new Map();
    let total = 0;
    while (true) {
      if (zipError) throw malformed(zipError);
      const entry = await new Promise((resolve, reject) => {
        const clear = () => {
          zip.off('entry', onEntry);
          zip.off('end', onEnd);
          zip.off('error', onError);
        };
        const onEntry = (value) => {
          clear();
          resolve(value);
        };
        const onEnd = () => {
          clear();
          resolve(null);
        };
        const onError = (error) => {
          clear();
          reject(malformed(error));
        };
        zip.once('entry', onEntry);
        zip.once('end', onEnd);
        zip.once('error', onError);
        zip.readEntry();
      });
      if (!entry) break;
      if (
        entry.fileNameLength + entry.extraFieldLength + entry.fileCommentLength >
        ASSET_ARCHIVE.maxEntryMetadataBytes
      )
        throw invalid('ZIP entry metadata exceeds its size limit.');
      const name = entry.fileName;
      const type = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (
        (name !== 'manifest.json' &&
          !/^files\/file-[1-9]\d{0,3}\.(png|jpg|gif|webp|glb)$/.test(name)) ||
        entries.has(name) ||
        (type && type !== 0o100000) ||
        entry.externalFileAttributes & 0x10 ||
        entry.generalPurposeBitFlag & 1 ||
        ![0, 8].includes(entry.compressionMethod)
      )
        throw invalid('ZIP contains duplicate, unsupported or unsafe entries.');
      const max =
        name === 'manifest.json' ? ASSET_ARCHIVE.maxManifestBytes : ASSET_ARCHIVE.maxFileBytes;
      if (entry.uncompressedSize > max)
        throw invalid('A ZIP entry exceeds its expanded size limit.');
      total += entry.uncompressedSize;
      if (total > ASSET_ARCHIVE.maxTotalBytes + ASSET_ARCHIVE.maxManifestBytes)
        throw invalid('ZIP expanded content exceeds the package limit.');
      entries.set(name, entry);
    }
    const readEntry = async (entry) => {
      if (zipError) throw malformed(zipError);
      try {
        const stream = await new Promise((resolve, reject) =>
          zip.openReadStream(entry, (error, value) => (error ? reject(error) : resolve(value))),
        );
        const chunks = [];
        let bytes = 0;
        for await (const chunk of stream) {
          bytes += chunk.length;
          if (bytes > entry.uncompressedSize) throw malformed();
          chunks.push(chunk);
        }
        if (bytes !== entry.uncompressedSize) throw malformed();
        return Buffer.concat(chunks, bytes);
      } catch (error) {
        throw malformed(error);
      }
    };
    const header = entries.get('manifest.json');
    if (!header) throw invalid('ZIP package is missing manifest.json.');
    const headerBytes = await readEntry(header);
    let manifest;
    try {
      manifest = JSON.parse(headerBytes.toString('utf8'));
    } catch {
      throw invalid('The ZIP manifest is not valid JSON.');
    }
    if (manifest?.version !== ASSET_ARCHIVE.version || !Array.isArray(manifest.files))
      throw invalid('Unsupported ZIP manifest version or files.');
    const expected = new Set(['manifest.json']);
    for (const file of manifest.files) {
      const entry = entries.get(file?.path);
      if (!entry || expected.has(file.path) || entry.uncompressedSize !== file.bytes)
        throw invalid('Missing, duplicate or mismatched ZIP file dependency.');
      expected.add(file.path);
    }
    if (expected.size !== entries.size)
      throw invalid('ZIP contains files absent from its manifest.');
    return { manifest, readFile: (file) => readEntry(entries.get(file.path)), close };
  } catch (error) {
    await close();
    throw error;
  }
}

// Separate format/transport ownership from asset validation and transactional persistence.
export function createAssetPackageArchives({ packages, tempRoot = os.tmpdir() }) {
  async function temporary(run) {
    const dir = await fs.mkdtemp(path.join(tempRoot, 'ott-package-'));
    try {
      return await run(dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
  async function exportArchive(kind, id, authorize, deliver) {
    return temporary(async (dir) => {
      const manifest = await packages.exportAsset(kind, id, authorize, {
        writeFile: (file, bytes) =>
          fs.writeFile(path.join(dir, file.id), bytes, { flag: 'wx', mode: 0o600 }),
      });
      const zip = new yazl.ZipFile();
      zip.on('error', (error) => zip.outputStream.destroy(error));
      zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json', { compress: false });
      for (const file of manifest.files)
        zip.addFile(path.join(dir, file.id), file.path, { compress: false });
      zip.end();
      const filename = path.join(dir, 'package.zip');
      await pipeline(zip.outputStream, createWriteStream(filename, { flags: 'wx', mode: 0o600 }));
      const { size } = await fs.stat(filename);
      if (size > ASSET_ARCHIVE.maxPackageBytes) throw invalid('ZIP package exceeds 544 MiB.');
      if (!(await authorize()))
        throw new AssetPackageError('Admin access is no longer available.', 403);
      return deliver({ stream: createReadStream(filename), size });
    });
  }
  async function withUpload(req, run) {
    if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')
      throw invalid('Upload the ZIP file without HTTP content encoding.');
    if (Number(req.headers['content-length']) > ASSET_ARCHIVE.maxPackageBytes) {
      req.resume();
      throw new AssetPackageError('ZIP package exceeds 544 MiB.', 413);
    }
    return temporary(async (dir) => {
      const filename = path.join(dir, 'upload.zip');
      let size = 0;
      const bounded = new Transform({
        transform(chunk, encoding, next) {
          size += chunk.length;
          if (size > ASSET_ARCHIVE.maxPackageBytes)
            next(new AssetPackageError('ZIP package exceeds 544 MiB.', 413));
          else next(null, chunk);
        },
      });
      const abort = () => bounded.destroy(new Error('Package upload interrupted.'));
      req.once('aborted', abort);
      req.once('error', abort);
      try {
        const written = pipeline(
          bounded,
          createWriteStream(filename, { flags: 'wx', mode: 0o600 }),
        );
        req.pipe(bounded);
        await written;
      } finally {
        req.unpipe(bounded);
        req.off('aborted', abort);
        req.off('error', abort);
        if (!req.complete) req.resume();
      }
      const archive = await openAssetArchive(filename);
      try {
        return await run(archive);
      } finally {
        await archive.close();
      }
    });
  }
  return { exportArchive, withUpload };
}
