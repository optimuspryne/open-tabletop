import express from 'express';
import path from 'node:path';

const MEDIA_TYPES = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  glb: 'model/gltf-binary',
});

// Validate the same decoded path static serving resolves. Only generated media
// filenames are public; metadata, backups and old executable uploads stay private.
export function createAssetFilesRouter({ assetsDir, assetKinds }) {
  const router = express.Router();
  router.use((req, res, next) => {
    let decoded;
    try {
      decoded = decodeURIComponent(req.path);
    } catch {
      return res.sendStatus(404);
    }
    // Reject encoded separators instead of admitting alternate path structures.
    if (/%(?:2f|5c)/i.test(req.path)) return res.sendStatus(404);
    const match = /^\/([a-z]+)\/([a-f0-9]{18})\.(jpg|jpeg|png|gif|webp|glb)$/i.exec(decoded);
    if (!match || !assetKinds.includes(match[1])) return res.sendStatus(404);
    next();
  });
  router.use(
    express.static(assetsDir, {
      maxAge: '1y',
      immutable: true,
      index: false,
      redirect: false,
      setHeaders(res, filename) {
        res.setHeader('Content-Type', MEDIA_TYPES[path.extname(filename).slice(1).toLowerCase()]);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      },
    }),
  );
  return router;
}
