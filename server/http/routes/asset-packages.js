import express from 'express';
import { asyncRoute } from '../async-route.js';
import { ASSET_PACKAGE, AssetPackageError } from '../../../shared/asset-package.js';
export function createAssetPackagesRouter({ packages, requireAdmin, rateLimitUpload }) {
  const router = express.Router();
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
        const user = await requireAdmin(req, res);
        if (!user) return false;
        if (String(user.id) !== String(req.packageUser.id))
          throw new AssetPackageError('The signed-in account changed. Please try again.', 403);
        return true;
      };
      try {
        await fn(req, res, authorize);
      } catch (error) {
        if (!(error instanceof AssetPackageError)) throw error;
        if (!res.headersSent) res.status(error.status).json({ error: error.message });
      }
    });
  router.get(
    '/dice/:id',
    run(async (req, res, authorize) => {
      const value = await packages.exportDice(req.params.id, authorize);
      res.attachment('dice-texture.ott.json').json(value);
    }),
  );
  router.use(express.json({ limit: ASSET_PACKAGE.maxPackageBytes }));
  router.post(
    '/preview',
    run(async (req, res, authorize) => {
      const { summary } = await packages.inspect(req.body);
      if (await authorize()) res.json(summary);
    }),
  );
  router.post(
    '/import',
    run(async (req, res, authorize) => {
      if (
        !req.body ||
        Object.keys(req.body).length !== 2 ||
        !Object.hasOwn(req.body, 'package') ||
        !Object.hasOwn(req.body, 'name')
      )
        throw new AssetPackageError('Invalid import request.');
      const result = await packages.importDice(
        req.body.package,
        req.body.name,
        req.packageUser.id,
        authorize,
      );
      if (!res.headersSent) res.status(201).json(result);
    }),
  );
  router.use((error, req, res, next) => {
    if (error.type === 'entity.too.large')
      return res.status(413).json({ error: 'The package exceeds 12 MiB.' });
    if (error.type === 'entity.parse.failed')
      return res.status(400).json({ error: 'The package is not valid JSON.' });
    next(error);
  });
  return router;
}
