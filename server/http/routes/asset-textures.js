import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { asyncRoute } from '../async-route.js';

const TEXTURE_FILE = /^([a-f0-9]{18}\.(?:gif|jpe?g|png|webp))\.webp$/i;

export function textureAssetPaths(assetsDir, assetKinds, kind, requestedFile) {
  if (!assetKinds.includes(kind)) return null;
  const match = TEXTURE_FILE.exec(requestedFile);
  if (!match) return null;
  const sourceName = match[1];
  return {
    source: path.resolve(assetsDir, kind, sourceName),
    cached: path.resolve(assetsDir, '.texture-cache', 'v1', kind, `${sourceName}.webp`),
  };
}

export async function createTextureDerivative(source, destination, maxDimension = 768) {
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await sharp(source)
      .rotate()
      .resize({
        width: maxDimension,
        height: maxDimension,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82, alphaQuality: 90, smartSubsample: true })
      .toFile(temporary);
    await fs.promises.rename(temporary, destination);
  } catch (error) {
    await fs.promises.rm(temporary, { force: true });
    throw error;
  }
}

export function createAssetTextureRouter({ assetsDir, assetKinds, maxDimension = 768 }) {
  const router = express.Router();
  const pending = new Map();

  router.get(
    '/asset-textures/v1/:kind/:file',
    asyncRoute(async (req, res) => {
      const paths = textureAssetPaths(assetsDir, assetKinds, req.params.kind, req.params.file);
      if (!paths) return res.sendStatus(404);

      try {
        await fs.promises.access(paths.source, fs.constants.R_OK);
      } catch {
        return res.sendStatus(404);
      }

      try {
        await fs.promises.access(paths.cached, fs.constants.R_OK);
      } catch {
        let task = pending.get(paths.cached);
        if (!task) {
          task = createTextureDerivative(paths.source, paths.cached, maxDimension).finally(() =>
            pending.delete(paths.cached),
          );
          pending.set(paths.cached, task);
        }
        await task;
      }

      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.type('webp');
      return res.sendFile(paths.cached);
    }),
  );

  return router;
}
