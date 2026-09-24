// v1 carries one dice texture; v2 carries one deck/tile set. References use local IDs, never paths.
export const ASSET_PACKAGE = Object.freeze({
  format: 'open-tabletop-assets',
  version: 1,
  deckVersion: 2,
  maxFileBytes: 8 * 1024 * 1024,
  maxPackageBytes: 96 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxFiles: 256,
  maxCards: 1000,
  maxReferenceChars: 200000,
  maxGeneratedChars: 2 * 1024 * 1024,
  maxTotalPixels: 128 * 1024 * 1024,
  maxPixels: 16 * 1024 * 1024,
  maxName: 80,
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
