export const PACKAGE_ASSET_KINDS = Object.freeze(['dice', 'deck', 'board', 'mat', 'sky', 'prop']);
// v1: dice; v2: deck/tiles; v3: one collection of supported assets. References use local IDs.
export const ASSET_PACKAGE = Object.freeze({
  format: 'open-tabletop-assets',
  version: 1,
  deckVersion: 2,
  collectionVersion: 3,
  maxAssets: 64,
  maxTotalCards: 5000,
  maxFileBytes: 8 * 1024 * 1024,
  maxPackageBytes: 96 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxFiles: 4096,
  maxCards: 1000,
  maxReferenceChars: 200000,
  maxGeneratedChars: 2 * 1024 * 1024,
  maxTotalPixels: 128 * 1024 * 1024,
  maxPixels: 16 * 1024 * 1024,
  maxName: 80,
});
// Binary ZIP packages keep only one decoded original in memory at a time.
export const ASSET_ARCHIVE = Object.freeze({
  ...ASSET_PACKAGE,
  version: 4,
  maxPackageBytes: 544 * 1024 * 1024,
  maxManifestBytes: 12 * 1024 * 1024,
  maxEntryMetadataBytes: 4 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
  maxFileBytes: 32 * 1024 * 1024,
  maxPixels: 32 * 1024 * 1024,
  maxTotalPixels: 4 * 1024 * 1024 * 1024,
});
export class AssetPackageError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export function packageName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > ASSET_PACKAGE.maxName)
    throw new AssetPackageError('Enter an asset name of 1–80 characters.');
  return value.trim();
}
