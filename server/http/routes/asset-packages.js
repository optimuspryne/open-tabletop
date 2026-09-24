import express from 'express';
import { pipeline } from 'node:stream/promises';
import { createAssetPackageArchives } from '../../assets/package-archives.js';
import { CollectionError } from '../../collection-queries.js';
import { asyncRoute } from '../async-route.js';
import { ASSET_PACKAGE, AssetPackageError } from '../../../shared/asset-package.js';
export function createAssetPackagesRouter({
  packages,
  requireAdmin,
  rateLimitUpload,
  onCollectionImported = () => {},
  archives = createAssetPackageArchives({ packages }),
}) {
  const router = express.Router();
  let active = false;
  router.use(
    rateLimitUpload,
    asyncRoute(async (req, res, next) => {
      const user = await requireAdmin(req, res);
      if (!user) return;
      req.packageUser = user;
      res.set('Cache-Control', 'no-store');
      next();
    }),
  );
  const run = (fn) =>
    asyncRoute(async (req, res) => {
      const authorize = async () => {
        if (req.aborted || res.destroyed) return false;
        const user = await requireAdmin(req, res);
        if (!user) return false;
        if (String(user.id) !== String(req.packageUser.id))
          throw new AssetPackageError('The signed-in account changed. Please try again.', 403);
        return true;
      };
      if (active) {
        req.resume();
        return res
          .status(503)
          .set('Retry-After', '5')
          .json({ error: 'Another package transfer is running. Try again shortly.' });
      }
      active = true;
      try {
        await fn(req, res, authorize);
      } catch (error) {
        if (!(error instanceof AssetPackageError) && !(error instanceof CollectionError))
          throw error;
        if (!res.headersSent) res.status(error.status || 400).json({ error: error.message });
      } finally {
        active = false;
      }
    });
  router.get(
    '/:kind/:id',
    run(async (req, res, authorize) => {
      await archives.exportArchive(
        req.params.kind,
        req.params.id,
        authorize,
        async ({ stream }) => {
          res
            .attachment(`${req.params.kind === 'dice' ? 'dice-texture' : req.params.kind}.ott.zip`)
            .type('application/zip');
          await pipeline(stream, res, { end: false });
        },
      );
      res.end();
    }),
  );
  // Binary uploads are streamed to temporary storage before inspecting any ZIP entries.
  router.post(['/preview', '/import'], (req, res, next) => {
    if (!req.is('application/zip')) return next();
    return run(async (req, res, authorize) => {
      const preview = req.path === '/preview';
      const result = await archives.withUpload(req, async ({ manifest, readFile }) => {
        if (!(await authorize())) return null;
        if (preview) return (await packages.inspect(manifest, { readFile })).summary;
        return packages.importAsset(manifest, req.query.name, req.packageUser.id, authorize, {
          readFile,
        });
      });
      if (!result) return;
      if (!preview && result.kind === 'collection') onCollectionImported();
      if (await authorize()) res.status(preview ? 200 : 201).json(result);
    })(req, res, next);
  });
  const json = express.json({ limit: ASSET_PACKAGE.maxPackageBytes });
  const readJson = (req, res) =>
    new Promise((resolve, reject) =>
      json(req, res, (error) => (error ? reject(error) : resolve())),
    );
  router.post(
    '/preview',
    run(async (req, res, authorize) => {
      await readJson(req, res);
      const { summary } = await packages.inspect(req.body);
      if (await authorize()) res.json(summary);
    }),
  );
  router.post(
    '/import',
    run(async (req, res, authorize) => {
      await readJson(req, res);
      if (
        !req.body ||
        Object.keys(req.body).length !== 2 ||
        !Object.hasOwn(req.body, 'package') ||
        !Object.hasOwn(req.body, 'name')
      )
        throw new AssetPackageError('Invalid import request.');
      const result = await packages.importAsset(
        req.body.package,
        req.body.name,
        req.packageUser.id,
        authorize,
      );
      if (result.kind === 'collection') onCollectionImported();
      if (!res.headersSent) res.status(201).json(result);
    }),
  );
  router.use((error, req, res, next) => {
    if (error.type === 'entity.too.large')
      return res.status(413).json({ error: 'The package exceeds 96 MiB.' });
    if (error.type === 'entity.parse.failed')
      return res.status(400).json({ error: 'The package is not valid JSON.' });
    next(error);
  });
  return router;
}
