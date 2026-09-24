import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { ASSET_PACKAGE, AssetPackageError, packageName } from '../../shared/asset-package.js';
import { imageExtension } from './upload-validation.js';
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
export async function inspectAssetPackage(value) {
  if (
    !exact(value, ['format', 'version', 'assets', 'files']) ||
    value.format !== ASSET_PACKAGE.format ||
    value.version !== ASSET_PACKAGE.version
  )
    invalid('Unsupported asset package format or version.');
  if (
    !Array.isArray(value.assets) ||
    value.assets.length !== 1 ||
    !Array.isArray(value.files) ||
    value.files.length !== 1
  )
    invalid('This version supports one dice texture and one image file.');
  const asset = value.assets[0],
    file = value.files[0];
  if (
    !exact(asset, ['id', 'kind', 'name', 'texture']) ||
    asset.id !== 'asset-1' ||
    asset.kind !== 'dice' ||
    asset.texture !== 'file-1'
  )
    invalid('Unsupported asset kind or missing image dependency.');
  const name = packageName(asset.name);
  if (
    !exact(file, ['id', 'mediaType', 'bytes', 'sha256', 'data']) ||
    file.id !== 'file-1' ||
    !Number.isInteger(file.bytes) ||
    file.bytes < 12 ||
    file.bytes > ASSET_PACKAGE.maxFileBytes ||
    typeof file.data !== 'string' ||
    file.data.length !== 4 * Math.ceil(file.bytes / 3) ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)
  )
    invalid('Invalid image dependency or package size.');
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
  return {
    bytes,
    info,
    summary: {
      name,
      kind: 'dice',
      totalBytes: bytes.length,
      files: [
        {
          id: 'file-1',
          mediaType: info.mediaType,
          bytes: bytes.length,
          width: info.width,
          height: info.height,
        },
      ],
      isPublic: false,
    },
  };
}

export function createAssetPackages({ db, assetsDir, logger = console }) {
  async function directory() {
    const root = await fs.realpath(assetsDir);
    const dir = path.join(root, 'dice');
    const stat = await fs.lstat(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      invalid('Dice image storage must be a regular directory.');
    return dir;
  }
  async function exportDice(id, authorize) {
    if (typeof id !== 'string' || !/^[1-9]\d{0,17}$/.test(id)) invalid('Invalid asset ID.');
    const asset = await db.getDice(id);
    if (!asset) throw new AssetPackageError('Dice texture not found.', 404);
    const match = /^\/assets\/dice\/([a-f0-9]{18}\.(?:png|jpg|jpeg|gif|webp))$/.exec(asset.url);
    if (!match) invalid('This texture does not reference a supported local uploaded image.');
    let handle, bytes;
    try {
      handle = await fs.open(
        path.join(await directory(), match[1]),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > ASSET_PACKAGE.maxFileBytes)
        invalid('The image must be a regular file no larger than 8 MiB.');
      // Bounded read even if a local file grows after stat.
      const buffer = Buffer.alloc(ASSET_PACKAGE.maxFileBytes + 1);
      let size = 0;
      while (size < buffer.length) {
        const read = await handle.read(buffer, size, buffer.length - size, size);
        if (!read.bytesRead) break;
        size += read.bytesRead;
      }
      if (size > ASSET_PACKAGE.maxFileBytes) invalid('The image exceeds 8 MiB.');
      bytes = buffer.subarray(0, size);
    } catch (error) {
      if (['ENOENT', 'ELOOP'].includes(error.code))
        invalid('The original image is missing or is a symbolic link.');
      throw error;
    } finally {
      await handle?.close();
    }
    const info = await imageInfo(bytes);
    if (!(await authorize()))
      throw new AssetPackageError('Admin access is no longer available.', 403);
    return {
      format: ASSET_PACKAGE.format,
      version: 1,
      assets: [{ id: 'asset-1', kind: 'dice', name: packageName(asset.name), texture: 'file-1' }],
      files: [
        {
          id: 'file-1',
          mediaType: info.mediaType,
          bytes: bytes.length,
          sha256: digest(bytes),
          data: bytes.toString('base64'),
        },
      ],
    };
  }
  async function importDice(value, name, ownerId, authorize) {
    const inspected = await inspectAssetPackage(value);
    name = packageName(name);
    if (!(await authorize()))
      throw new AssetPackageError('Admin access is no longer available.', 403);
    const dir = await directory(),
      filename = randomBytes(9).toString('hex') + '.' + inspected.info.ext;
    const target = path.join(dir, filename),
      url = '/assets/dice/' + filename;
    const handle = await fs.open(target, 'wx');
    let keep = false;
    try {
      await handle.writeFile(inspected.bytes);
      await handle.sync();
      await handle.close();
      const id = await db.importDicePackage({ name, url, ownerId }, authorize);
      keep = true;
      return { id, name, kind: 'dice', isPublic: false };
    } catch (error) {
      // An uncertain COMMIT may have succeeded: preserve its file for recovery/normal orphan cleanup.
      keep = error.preserveAssetFile === true;
      throw error;
    } finally {
      await handle.close().catch(() => {});
      if (!keep)
        await fs
          .unlink(target)
          .catch((error) => logger.error('[asset-package:cleanup]', error.code));
    }
  }
  return { exportDice, importDice, inspect: inspectAssetPackage };
}
