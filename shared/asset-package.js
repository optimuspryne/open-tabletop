// v1 deliberately carries one dice texture. References are package-local IDs, never paths.
export const ASSET_PACKAGE = Object.freeze({
  format: 'open-tabletop-assets',
  version: 1,
  maxFileBytes: 8 * 1024 * 1024,
  maxPackageBytes: 12 * 1024 * 1024,
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
