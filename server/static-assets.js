import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The only location setting for bundled assets. Relative to the project root, or absolute.
// Move the six category folders together, update this value, and restart the server.
// Public URLs stay /models/..., /sky/..., etc. so saved scenes keep working.
export const STATIC_ASSETS_DIR = 'public/static_assets';

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const CATEGORIES = ['mahjong', 'sky', 'textures', 'models', 'music', 'sounds'];

// Resolve trusted catalog/config paths, not untrusted request paths. HTTP containment is
// handled by express.static within each category mount.
export function staticAssetPath(assetPath, assetsDir = STATIC_ASSETS_DIR) {
  return resolve(PROJECT_ROOT, assetsDir, assetPath.replace(/^\/+/, ''));
}

// Shared by production HTTP and browser fixtures; prefixes are stable public contracts.
export function staticAssetMounts(assetsDir = STATIC_ASSETS_DIR) {
  return Object.fromEntries(
    CATEGORIES.map((category) => [`/${category}/`, staticAssetPath(category, assetsDir)]),
  );
}
