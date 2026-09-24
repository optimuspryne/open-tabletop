import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import {
  ASSET_PACKAGE,
  ASSET_ARCHIVE,
  AssetPackageError,
  packageName,
} from '../../shared/asset-package.js';
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
async function imageInfo(bytes, limits) {
  const ext = imageExtension(bytes);
  if (!ext) invalid('The package must contain a PNG, JPEG, GIF or WebP image.');
  try {
    const info = await sharp(bytes, { limitInputPixels: limits.maxPixels }).metadata();
    if (
      !info.width ||
      !info.height ||
      info.width * info.height > limits.maxPixels ||
      (info.pages || 1) > 1
    )
      invalid(`Use a single-frame image of at most ${limits.maxPixels / 1024 ** 2} megapixels.`);
    // Decode to reject truncated data, but retain the exact original bytes for storage/export.
    await sharp(bytes, { limitInputPixels: limits.maxPixels }).stats();
    return { ext, width: info.width, height: info.height, mediaType: mime[ext] };
  } catch (error) {
    if (error instanceof AssetPackageError) throw error;
    invalid('The image is damaged or exceeds the image limits.');
  }
}
function fileEnvelope(file, index, archive, limits) {
  if (
    !exact(file, ['id', 'mediaType', 'bytes', 'sha256', archive ? 'path' : 'data']) ||
    file.id !== `file-${index + 1}` ||
    !Number.isInteger(file.bytes) ||
    file.bytes < 12 ||
    file.bytes > limits.maxFileBytes ||
    typeof file.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(file.sha256)
  )
    invalid('Invalid image dependency or package size.');
  if (archive) {
    const ext = Object.keys(mime).find((key) => mime[key] === file.mediaType);
    if (!ext || file.path !== `files/${file.id}.${ext}`)
      invalid('Invalid image dependency path or type.');
  } else if (
    typeof file.data !== 'string' ||
    file.data.length !== 4 * Math.ceil(file.bytes / 3) ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)
  )
    invalid('Invalid image dependency or package size.');
}
export async function inspectAssetPackage(value, { readFile } = {}) {
  const archive = value?.version === ASSET_ARCHIVE.version;
  const limits = archive ? ASSET_ARCHIVE : ASSET_PACKAGE;
  const collection =
    value?.version === ASSET_PACKAGE.collectionVersion ||
    (archive && Object.hasOwn(value, 'collection'));
  if (archive && !readFile) invalid('Version 4 requires a ZIP package with original files.');
  if (
    !exact(value, [
      'format',
      'version',
      'assets',
      'files',
      ...(collection ? ['collection'] : []),
    ]) ||
    value.format !== ASSET_PACKAGE.format ||
    ![
      ASSET_PACKAGE.version,
      ASSET_PACKAGE.deckVersion,
      ASSET_PACKAGE.collectionVersion,
      ASSET_ARCHIVE.version,
    ].includes(value.version)
  )
    invalid('Unsupported asset package format or version.');
  if (
    !Array.isArray(value.assets) ||
    (collection ? value.assets.length > ASSET_PACKAGE.maxAssets : value.assets.length !== 1)
  )
    invalid('Invalid asset count. A collection package supports up to 64 assets.');
  if (!Array.isArray(value.files) || value.files.length > ASSET_PACKAGE.maxFiles)
    invalid(`A package supports up to ${ASSET_PACKAGE.maxFiles} images.`);
  if (
    collection &&
    (!exact(value.collection, ['name', 'items']) ||
      !Array.isArray(value.collection.items) ||
      value.collection.items.length !== value.assets.length ||
      value.collection.items.some((id, index) => id !== `asset-${index + 1}`))
  )
    invalid('Invalid or missing collection membership.');
  const collectionName = collection ? packageName(value.collection.name) : null;
  let totalBytes = 0,
    totalCards = 0,
    characters = 0;
  value.files.forEach((file, index) => {
    fileEnvelope(file, index, archive, limits);
    totalBytes += file.bytes;
  });
  if (totalBytes > limits.maxTotalBytes)
    invalid(`The image dependencies exceed ${limits.maxTotalBytes / 1024 ** 2} MiB.`);
  const ids = new Set(value.files.map((file) => file.id)),
    used = new Map(),
    assets = [];
  const useFile = (id, category) => {
    if (!ids.has(id)) invalid('Missing or unsupported image dependency.');
    if (!used.has(id)) used.set(id, new Set());
    used.get(id).add(category);
    return id;
  };
  for (const [index, asset] of value.assets.entries()) {
    const isDice = asset?.kind === 'dice';
    const keys = isDice
      ? ['id', 'kind', 'name', 'texture']
      : ['id', 'kind', 'name', 'back', 'fronts', 'geom', 'open', 'deckModel', 'color', 'textColor'];
    if (
      !exact(asset, keys) ||
      asset.id !== `asset-${index + 1}` ||
      !['dice', 'deck'].includes(asset.kind) ||
      (!archive &&
        !collection &&
        asset.kind !== (value.version === ASSET_PACKAGE.version ? 'dice' : 'deck'))
    )
      invalid('Unsupported asset kind or metadata.');
    packageName(asset.name);
    let metadata = null;
    if (isDice) {
      if (!collection && (asset.texture !== 'file-1' || value.files.length !== 1))
        invalid('A dice package needs one image dependency.');
      useFile(asset.texture, 'dice');
    } else {
      metadata = packageDeckMetadata(asset);
      await mapDeckReferences(asset, (ref) => {
        if (exact(ref, ['generated']) && generatedDeckReference(ref.generated)) {
          characters += ref.generated.length;
          if (characters > ASSET_PACKAGE.maxGeneratedChars)
            invalid('The package contains too much generated face text.');
          return ref.generated;
        }
        if (!exact(ref, ['file'])) invalid('Missing or unsupported image dependency.');
        return useFile(ref.file, 'decks');
      });
      totalCards += asset.fronts.length;
      if (totalCards > ASSET_PACKAGE.maxTotalCards)
        invalid('The package exceeds 5,000 cards or tiles.');
    }
    assets.push({ asset, metadata });
  }
  if (used.size !== value.files.length) invalid('The package contains unused image dependencies.');
  let totalPixels = 0;
  const files = [];
  for (const file of value.files) {
    const bytes = archive ? await readFile(file) : Buffer.from(file.data, 'base64');
    if (
      bytes.length !== file.bytes ||
      (!archive && bytes.toString('base64') !== file.data) ||
      digest(bytes) !== file.sha256
    )
      invalid('The image checksum or byte count does not match.');
    const info = await imageInfo(bytes, limits);
    if (file.mediaType !== info.mediaType)
      invalid('The image type does not match its declared type.');
    totalPixels += info.width * info.height;
    if (totalPixels > limits.maxTotalPixels)
      invalid(`The image dependencies exceed ${limits.maxTotalPixels / 1024 ** 2} megapixels.`);
    files.push({
      id: file.id,
      size: file.bytes,
      ...(archive ? { readBytes: () => readFile(file) } : { bytes }),
      info,
      categories: [...used.get(file.id)],
    });
  }
  const memberSummary = ({ asset }) => ({
    name: packageName(asset.name),
    kind: asset.kind,
    ...(asset.kind === 'deck'
      ? { count: asset.fronts.length, open: asset.open, deckModel: asset.deckModel }
      : {}),
  });
  return {
    assets,
    files,
    summary: {
      ...(collection
        ? {
            name: collectionName,
            kind: 'collection',
            members: assets.map(memberSummary),
            count: assets.length,
          }
        : memberSummary(assets[0])),
      totalBytes,
      files: files.map(({ id, size, info }) => ({
        id,
        mediaType: info.mediaType,
        bytes: size,
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
  async function readImage(url, kind, limits) {
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
      if (!stat.isFile() || stat.size > limits.maxFileBytes)
        invalid(
          `Each image must be a regular file no larger than ${limits.maxFileBytes / 1024 ** 2} MiB.`,
        );
      const buffer = Buffer.alloc(Math.min(stat.size + 1, limits.maxFileBytes + 1));
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
  async function exportAsset(kind, id, authorize, { writeFile } = {}) {
    const limits = writeFile ? ASSET_ARCHIVE : ASSET_PACKAGE;
    if (!['dice', 'deck', 'collection'].includes(kind)) invalid('Unsupported asset kind.');
    if (typeof id !== 'string' || !/^[1-9]\d{0,17}$/.test(id)) invalid('Invalid asset ID.');
    const source = await (kind === 'collection'
      ? db.getCollectionForPackage(id)
      : kind === 'dice'
        ? db.getDice(id)
        : db.getDeck(id));
    if (!source) throw new AssetPackageError('Asset or collection not found.', 404);
    const members = kind === 'collection' ? source.assets : [{ kind, asset: source }];
    if (members.length > ASSET_PACKAGE.maxAssets)
      invalid('A collection package supports up to 64 assets.');
    const files = [],
      urls = new Map(),
      hashes = new Map();
    let totalBytes = 0,
      totalPixels = 0,
      totalCards = 0,
      characters = 0;
    const resolve = async (ref, assetKind) => {
      if (assetKind === 'deck' && generatedDeckReference(ref)) {
        characters += ref.length;
        if (characters > ASSET_PACKAGE.maxGeneratedChars)
          invalid('The package contains too much generated face text.');
        return { generated: ref };
      }
      if (typeof ref !== 'string') invalid('Unsupported card reference or metadata.');
      const sourceKey = assetKind + ':' + ref;
      if (urls.has(sourceKey)) return { file: urls.get(sourceKey) };
      const bytes = await readImage(ref, assetKind === 'dice' ? 'dice' : 'decks', limits),
        hash = digest(bytes);
      if (hashes.has(hash)) {
        urls.set(sourceKey, hashes.get(hash));
        return { file: hashes.get(hash) };
      }
      totalBytes += bytes.length;
      if (files.length >= ASSET_PACKAGE.maxFiles)
        invalid(`A package supports up to ${ASSET_PACKAGE.maxFiles} images.`);
      if (totalBytes > limits.maxTotalBytes)
        invalid(`The image dependencies exceed ${limits.maxTotalBytes / 1024 ** 2} MiB.`);
      const info = await imageInfo(bytes, limits);
      totalPixels += info.width * info.height;
      if (totalPixels > limits.maxTotalPixels)
        invalid(`The image dependencies exceed ${limits.maxTotalPixels / 1024 ** 2} megapixels.`);
      const file = {
        id: `file-${files.length + 1}`,
        mediaType: info.mediaType,
        bytes: bytes.length,
        sha256: hash,
        ...(writeFile
          ? { path: `files/file-${files.length + 1}.${info.ext}` }
          : { data: bytes.toString('base64') }),
      };
      if (writeFile) await writeFile(file, bytes);
      files.push(file);
      urls.set(sourceKey, file.id);
      hashes.set(hash, file.id);
      return { file: file.id };
    };
    const assets = [];
    for (const member of members) {
      const { kind: assetKind, asset } = member;
      if (!['dice', 'deck'].includes(assetKind))
        invalid('The collection contains an unsupported asset type. Nothing was exported.');
      const base = {
        id: `asset-${assets.length + 1}`,
        kind: assetKind,
        name: packageName(asset.name),
      };
      const portable =
        assetKind === 'dice'
          ? { ...base, texture: (await resolve(asset.url, assetKind)).file }
          : {
              ...base,
              ...packageDeckMetadata(asset),
              ...(await mapDeckReferences(asset, (ref) => resolve(ref, assetKind))),
            };
      totalCards += assetKind === 'deck' ? asset.fronts.length : 0;
      if (totalCards > ASSET_PACKAGE.maxTotalCards)
        invalid('The package exceeds 5,000 cards or tiles.');
      assets.push(portable);
    }
    if (!(await authorize()))
      throw new AssetPackageError('Admin access is no longer available.', 403);
    const value = {
      format: ASSET_PACKAGE.format,
      version: writeFile
        ? ASSET_ARCHIVE.version
        : kind === 'collection'
          ? ASSET_PACKAGE.collectionVersion
          : kind === 'dice'
            ? ASSET_PACKAGE.version
            : ASSET_PACKAGE.deckVersion,
      ...(kind === 'collection'
        ? { collection: { name: packageName(source.name), items: assets.map((asset) => asset.id) } }
        : {}),
      assets,
      files,
    };
    if (
      Buffer.byteLength(JSON.stringify(value)) >
      (writeFile ? ASSET_ARCHIVE.maxManifestBytes : ASSET_PACKAGE.maxPackageBytes - 1024)
    )
      invalid(writeFile ? 'The manifest exceeds 12 MiB.' : 'The package exceeds 96 MiB.');
    return value;
  }
  async function importAsset(value, name, ownerId, authorize, options) {
    const inspected = await inspectAssetPackage(value, options);
    name = packageName(name);
    if (!(await authorize()))
      throw new AssetPackageError('Admin access is no longer available.', 403);
    const kind = inspected.summary.kind,
      created = [],
      urls = new Map();
    let keep = false;
    try {
      for (const file of inspected.files) {
        const bytes = file.readBytes ? await file.readBytes() : file.bytes;
        // A shared image used by both dice and decks needs one destination file in each
        // storage category so existing pickers and future exports retain valid paths.
        for (const category of file.categories) {
          const dir = await directory(category),
            filename = randomBytes(9).toString('hex') + '.' + file.info.ext,
            target = path.join(dir, filename);
          const handle = await fs.open(target, 'wx');
          created.push(target);
          try {
            await handle.writeFile(bytes);
            await handle.sync();
          } finally {
            await handle.close();
          }
          urls.set(category + ':' + file.id, '/assets/' + category + '/' + filename);
        }
      }
      const members = [];
      for (const { asset, metadata } of inspected.assets) {
        const data =
          asset.kind === 'dice'
            ? { url: urls.get('dice:' + asset.texture) }
            : {
                ...metadata,
                ...(await mapDeckReferences(asset, (ref) =>
                  Object.hasOwn(ref, 'generated') ? ref.generated : urls.get('decks:' + ref.file),
                )),
              };
        members.push({ kind: asset.kind, data: { ...data, name: packageName(asset.name) } });
      }
      const data = kind === 'collection' ? { assets: members } : members[0].data;
      const id = await db.importAssetPackage(kind, { ...data, name, ownerId }, authorize);
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
