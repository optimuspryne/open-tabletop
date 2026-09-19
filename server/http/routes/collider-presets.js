import express from 'express';
import { asyncRoute } from '../async-route.js';
import { normalizeCompoundCollider } from '../../../shared/compound-collider.js';

export function normalizePreset(value) {
  const layout = normalizeCompoundCollider(value?.layout);
  const name = typeof value?.name === 'string' ? value.name.trim() : '';
  if (
    !layout ||
    !name ||
    name.length > 120 ||
    typeof value.isPublic !== 'boolean' ||
    !Number.isFinite(value.size) ||
    value.size < 0.001 ||
    value.size > 400
  )
    return null;
  return { name, layout, size: value.size, isPublic: value.isPublic };
}

export function createColliderPresetsRouter({ db, requireUser }) {
  const router = express.Router();
  const run = (handler) =>
    asyncRoute(async (req, res) => {
      const user = await requireUser(req, res);
      if (!user) return;
      if (req.params.id && !/^[1-9]\d{0,17}$/.test(req.params.id))
        return res.status(400).json({ error: 'Invalid preset ID.' });
      return handler(req, res, user);
    });
  router.get(
    '/',
    run(async (req, res, user) => {
      const offset = Number(req.query.offset || 0);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000)
        return res.status(400).json({ error: 'Invalid page.' });
      res.json(await db.colliderPresets.list(user, offset));
    }),
  );
  router.get(
    '/:id',
    run(async (req, res, user) => {
      const preset = await db.colliderPresets.get(user, req.params.id);
      if (!preset) return res.status(404).json({ error: 'Preset not found.' });
      res.json({ preset });
    }),
  );
  for (const method of ['post', 'put'])
    router[method](
      method === 'post' ? '/' : '/:id',
      express.json({ limit: '64kb' }),
      run(async (req, res, user) => {
        const value = normalizePreset(req.body);
        if (!value)
          return res
            .status(400)
            .json({ error: 'Invalid preset name, size, visibility, or collider layout.' });
        const preset = await db.colliderPresets.save(user, req.params.id || null, value);
        if (!preset) return res.status(404).json({ error: 'Preset not found or not editable.' });
        res.status(method === 'post' ? 201 : 200).json({ preset });
      }),
    );
  router.delete(
    '/:id',
    run(async (req, res, user) => {
      if (!(await db.colliderPresets.remove(user, req.params.id)))
        return res.status(404).json({ error: 'Preset not found or not editable.' });
      res.json({ ok: true });
    }),
  );
  return router;
}
