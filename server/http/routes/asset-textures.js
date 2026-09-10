import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { asyncRoute } from '../async-route.js';

const TEXTURE_FILE = /^([a-f0-9]{18}\.(?:gif|jpe?g|png|webp))\.webp$/i;
const PREBUILD_SOURCE_FILE = /^[a-f0-9]{18}\.(?:jpe?g|png)$/i;

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

export async function prebuildTextureCache({
  assetsDir,
  assetKinds,
  maxDimension = 768,
  concurrency = 2,
  onProgress = () => {},
}) {
  const sources = [];
  for (const kind of assetKinds) {
    const entries = await fs.promises.readdir(path.resolve(assetsDir, kind), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (!entry.isFile() || !PREBUILD_SOURCE_FILE.test(entry.name)) continue;
      sources.push({ kind, name: entry.name });
    }
  }

  const report = {
    total: sources.length,
    processed: 0,
    created: 0,
    skipped: 0,
    failed: 0,
    sourceBytes: 0,
    cachedBytes: 0,
  };
  onProgress({ ...report });

  let nextIndex = 0;
  async function worker() {
    while (nextIndex < sources.length) {
      const { kind, name } = sources[nextIndex++];
      const paths = textureAssetPaths(assetsDir, assetKinds, kind, `${name}.webp`);
      try {
        const sourceStat = await fs.promises.stat(paths.source);
        report.sourceBytes += sourceStat.size;
        try {
          const cachedStat = await fs.promises.stat(paths.cached);
          if (!cachedStat.isFile()) throw new Error('cached texture is not a file');
          report.skipped += 1;
          report.cachedBytes += cachedStat.size;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          await createTextureDerivative(paths.source, paths.cached, maxDimension);
          report.created += 1;
          report.cachedBytes += (await fs.promises.stat(paths.cached)).size;
        }
      } catch {
        report.failed += 1;
      } finally {
        report.processed += 1;
        onProgress({ ...report });
      }
    }
  }

  const workerCount = Math.max(1, Math.min(Math.trunc(concurrency) || 1, sources.length || 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return report;
}

export function createTexturePrebuilder(options) {
  let job = {
    state: 'idle',
    phase: 'idle',
    total: 0,
    processed: 0,
    created: 0,
    skipped: 0,
    failed: 0,
    sourceBytes: 0,
    cachedBytes: 0,
  };
  let running = null;

  const status = () => ({ ...job });
  const start = () => {
    if (running) return { started: false, status: status() };
    job = {
      state: 'running',
      phase: 'scanning',
      total: 0,
      processed: 0,
      created: 0,
      skipped: 0,
      failed: 0,
      sourceBytes: 0,
      cachedBytes: 0,
      startedAt: new Date().toISOString(),
    };
    running = prebuildTextureCache({
      ...options,
      onProgress(progress) {
        job = { ...job, ...progress, phase: 'building' };
      },
    })
      .then((report) => {
        job = {
          ...job,
          ...report,
          state: 'complete',
          phase: 'complete',
          finishedAt: new Date().toISOString(),
        };
      })
      .catch((error) => {
        job = {
          ...job,
          state: 'failed',
          phase: 'failed',
          error: error.message,
          finishedAt: new Date().toISOString(),
        };
      })
      .finally(() => {
        running = null;
      });
    return { started: true, status: status() };
  };

  return { start, status };
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
