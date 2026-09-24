import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { ASSET_PACKAGE, AssetPackageError, packageName } from '../../shared/asset-package.js';
import { imageExtension } from './upload-validation.js';
import { generatedDeckReference, packageDeckMetadata, mapDeckReferences } from './package-decks.js';
const mime = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const invalid = (message) => {
  throw new AssetPackageError(message);
};
async function imageInfo(bytes) {
  const ext = imageExtension(bytes);
  if (!ext) invalid('The package must contain a PNG, JPEG, GIF or WebP image.');
  try {
    const info = await sharp(bytes, { limitInputPixels: ASSET_PACKAGE.maxPixels }).metadata();
    if (
      !info.width ||
      !info.height ||
      info.width * info.height > ASSET_PACKAGE.maxPixels ||
      (info.pages || 1) > 1
    )
      invalid('Use a single-frame image of at most 16 megapixels.');
    // Decode to reject truncated data, but retain the exact original bytes for storage/export.
    await sharp(bytes, { limitInputPixels: ASSET_PACKAGE.maxPixels }).stats();
    return { ext, width: info.width, height: info.height, mediaType: mime[ext] };
  } catch (error) {
    if (error instanceof AssetPackageError) throw error;
    invalid('The image is damaged or exceeds the image limits.');
  }
}
function fileEnvelope(file, index) {
  if (
    !exact(file, ['id', 'mediaType', 'bytes', 'sha256', 'data']) ||
    file.id !== `file-${index + 1}` ||
    !Number.isInteger(file.bytes) ||
    file.bytes < 12 ||
    file.bytes > ASSET_PACKAGE.maxFileBytes ||
    typeof file.data !== 'string' ||
    file.data.length !== 4 * Math.ceil(file.bytes / 3) ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)
  )
    invalid('Invalid image dependency or package size.');
}
export async function inspectAssetPackage(value) {
  if (
    !exact(value, ['format', 'version', 'assets', 'files']) ||
    value.format !== ASSET_PACKAGE.format ||
    ![ASSET_PACKAGE.version, ASSET_PACKAGE.deckVersion].includes(value.version)
  )
    invalid('Unsupported asset package format or version.');
  if (
    !Array.isArray(value.assets) ||
    value.assets.length !== 1 ||
    !Array.isArray(value.files) ||
    value.files.length > ASSET_PACKAGE.maxFiles
  )
    invalid('This version supports one asset with bounded image dependencies.');
  const asset = value.assets[0],
    isDice = value.version === ASSET_PACKAGE.version;
  const keys = isDice
    ? ['id', 'kind', 'name', 'texture']
    : ['id', 'kind', 'name', 'back', 'fronts', 'geom', 'open', 'deckModel', 'color', 'textColor'];
  if (!exact(asset, keys) || asset.id !== 'asset-1' || asset.kind !== (isDice ? 'dice' : 'deck'))
    invalid('Unsupported asset kind or metadata.');
  const name = packageName(asset.name),
    used = new Set();
  // Validate all declared sizes and reference closure before decoding any images.
  let totalBytes = 0;
  value.files.forEach((file, index) => {
    fileEnvelope(file, index);
    totalBytes += file.bytes;
  });
  if (totalBytes > ASSET_PACKAGE.maxTotalBytes) invalid('The image dependencies exceed 64 MiB.');
  const ids = new Set(value.files.map((file) => file.id));
  const reference = (ref) => {
    if (exact(ref, ['generated']) && generatedDeckReference(ref.generated)) return ref.generated;
    if (!exact(ref, ['file']) || !ids.has(ref.file))
      invalid('Missing or unsupported image dependency.');
    used.add(ref.file);
    return ref.file;
  };
  let metadata = null;
  if (isDice) {
    if (asset.texture !== 'file-1' || value.files.length !== 1)
      invalid('A dice package needs one image dependency.');
    used.add(asset.texture);
  } else {
    metadata = packageDeckMetadata(asset);
    await mapDeckReferences(asset, reference);
  }
  if (used.size !== value.files.length) invalid('The package contains unused image dependencies.');
  let totalPixels = 0;
  const files = [];
  for (const file of value.files) {
    const bytes = Buffer.from(file.data, 'base64');
    if (
      bytes.length !== file.bytes ||
      bytes.toString('base64') !== file.data ||
      digest(bytes) !== file.sha256
    )
      invalid('The image checksum or byte count does not match.');
    const info = await imageInfo(bytes);
    if (file.mediaType !== info.mediaType)
      invalid('The image type does not match its declared type.');
    totalPixels += info.width * info.height;
    if (totalPixels > ASSET_PACKAGE.maxTotalPixels)
      invalid('The image dependencies exceed 128 megapixels.');
    files.push({ id: file.id, bytes, info });
  }
  return {
    asset,
    metadata,
    files,
    summary: {
      name,
      kind: asset.kind,
      totalBytes,
      ...(isDice
        ? {}
        : { count: asset.fronts.length, open: asset.open, deckModel: asset.deckModel }),
      files: files.map(({ id, bytes, info }) => ({
        id,
        mediaType: info.mediaType,
        bytes: bytes.length,
        width: info.width,
        height: info.height,
      })),
      isPublic: false,
    },
  };
}

export function createAssetPackages({ db, assetsDir, logger = console }) {
  async function directory(kind) {
    const root = await fs.realpath(assetsDir),
      dir = path.join(root, kind);
    const stat = await fs.lstat(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      invalid('Image storage must be a regular directory.');
    return dir;
  }
  async function readImage(url, kind) {
    const match = new RegExp(
      '^/assets/' + kind + '/([a-f0-9]{18}\\.(?:png|jpg|jpeg|gif|webp))$',
    ).exec(url);
    if (!match)
      invalid(
        'This asset does not reference a supported local uploaded image. Remote and embedded images are not supported.',
      );
    let handle, bytes;
    try {
      handle = await fs.open(
        path.join(await directory(kind), match[1]),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > ASSET_PACKAGE.maxFileBytes)
        invalid('Each image must be a regular file no larger than 8 MiB.');
      const buffer = Buffer.alloc(Math.min(stat.size + 1, ASSET_PACKAGE.maxFileBytes + 1));
      let size = 0;
      while (size < buffer.length) {
        const read = await handle.read(buffer, size, buffer.length - size, size);
        if (!read.bytesRead) break;
        size += read.bytesRead;
      }
      if (size !== stat.size)
        invalid('The original image changed while reading. Please try again.');
      bytes = buffer.subarray(0, size);
    } catch (error) {
      if (['ENOENT', 'ELOOP'].includes(error.code))
        invalid('The original image is missing or is a symbolic link.');
      throw error;
    } finally {
      await handle?.close();
    }
    return bytes;
  }
  async function exportAsset(kind, id, authorize) {
    if (!['dice', 'deck'].includes(kind)) invalid('Unsupported asset kind.');
    if (typeof id !== 'string' || !/^[1-9]\d{0,17}$/.test(id)) invalid('Invalid asset ID.');
    const asset = await (kind === 'dice' ? db.getDice(id) : db.getDeck(id));
    if (!asset) throw new AssetPackageError('Asset not found.', 404);
    const files = [],
      urls = new Map(),
      hashes = new Map();
    let totalBytes = 0,
      totalPixels = 0;
    const resolve = async (ref) => {
      if (kind === 'deck' && generatedDeckReference(ref)) return { generated: ref };
      if (typeof ref !== 'string') invalid('Unsupported card reference or metadata.');
      if (urls.has(ref)) return { file: urls.get(ref) };
      const bytes = await readImage(ref, kind === 'dice' ? 'dice' : 'decks'),
        hash = digest(bytes);
      if (hashes.has(hash)) {
        urls.set(ref, hashes.get(hash));
        return { file: hashes.get(hash) };
      }
      totalBytes += bytes.length;
      if (files.length >= ASSET_PACKAGE.maxFiles || totalBytes > ASSET_PACKAGE.maxTotalBytes)
        invalid('The package exceeds 256 images or 64 MiB of originals.');
      const info = await imageInfo(bytes);
      totalPixels += info.width * info.height;
      if (totalPixels > ASSET_PACKAGE.maxTotalPixels)
        invalid('The image dependencies exceed 128 megapixels.');
      const file = {
        id: `file-${files.length + 1}`,
        mediaType: info.mediaType,
        bytes: bytes.length,
        sha256: hash,
        data: bytes.toString('base64'),
      };
      files.push(file);
      urls.set(ref, file.id);
      hashes.set(hash, file.id);
      return { file: file.id };
    };
    const base = { id: 'asset-1', kind, name: packageName(asset.name) };
    const portable =
      kind === 'dice'
        ? { ...base, texture: (await resolve(asset.url)).file }
        : { ...base, ...packageDeckMetadata(asset), ...(await mapDeckReferences(asset, resolve)) };
    if (!(await authorize()))
      throw new AssetPackageError('Admin access is no longer available.', 403);
    const value = {
      format: ASSET_PACKAGE.format,
      version: kind === 'dice' ? ASSET_PACKAGE.version : ASSET_PACKAGE.deckVersion,
      assets: [portable],
      files,
    };
    if (Buffer.byteLength(JSON.stringify(value)) > ASSET_PACKAGE.maxPackageBytes - 1024)
      invalid('The package exceeds 96 MiB.');
    return value;
  }
  async function importAsset(value, name, ownerId, authorize) {
    const inspected = await inspectAssetPackage(value);
    name = packageName(name);
    if (!(await authorize()))
      throw new AssetPackageError('Admin access is no longer available.', 403);
    const kind = inspected.asset.kind,
      created = [],
      urls = new Map();
    let keep = false;
    try {
      const category = kind === 'dice' ? 'dice' : 'decks';
      const dir = inspected.files.length ? await directory(category) : null;
      for (const file of inspected.files) {
        const filename = randomBytes(9).toString('hex') + '.' + file.info.ext,
          target = path.join(dir, filename);
        const handle = await fs.open(target, 'wx');
        created.push(target);
        try {
          await handle.writeFile(file.bytes);
          await handle.sync();
        } finally {
          await handle.close();
        }
        urls.set(file.id, '/assets/' + category + '/' + filename);
      }
      const data =
        kind === 'dice'
          ? { url: urls.get(inspected.asset.texture) }
          : {
              ...inspected.metadata,
              ...(await mapDeckReferences(inspected.asset, (ref) =>
                Object.hasOwn(ref, 'generated') ? ref.generated : urls.get(ref.file),
              )),
            };
      const id = await db.importAssetPackage(kind, { name, ...data, ownerId }, authorize);
      keep = true;
      return { id, name, kind, isPublic: false };
    } catch (error) {
      // An uncertain COMMIT may have succeeded: preserve every file for recovery/orphan cleanup.
      keep = error.preserveAssetFile === true;
      throw error;
    } finally {
      if (!keep)
        for (const target of created)
          await fs
            .unlink(target)
            .catch((error) => logger.error('[asset-package:cleanup]', error.code));
    }
  }
  return { exportAsset, importAsset, inspect: inspectAssetPackage };
}
