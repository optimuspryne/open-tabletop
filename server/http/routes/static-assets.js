import express from 'express';
import { STATIC_ASSETS_DIR, staticAssetMounts, staticAssetPath } from '../../static-assets.js';

export function createStaticAssetRouter({ assetsDir = STATIC_ASSETS_DIR } = {}) {
  const router = express.Router();
  // Preserve the existing one-day Mahjong face cache; other assets still revalidate.
  router.use(
    '/mahjong/faces',
    express.static(staticAssetPath('mahjong/faces', assetsDir), { maxAge: '1d' }),
  );
  for (const [prefix, directory] of Object.entries(staticAssetMounts(assetsDir)))
    router.use(prefix, express.static(directory));
  return router;
}
