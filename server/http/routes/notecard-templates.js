import express from 'express';
import { asyncRoute } from '../async-route.js';
import { normalizeNotecardContent } from '../../../shared/notecards.js';

export function normalizeNotecardTemplate(value, metadataOnly = false) {
  const name = typeof value?.name === 'string' ? value.name.trim() : '';
  const isPublic = value?.isPublic === undefined ? false : value.isPublic;
  const content = metadataOnly ? undefined : normalizeNotecardContent(value?.content);
  if (!name || name.length > 60 || typeof isPublic !== 'boolean' || (!metadataOnly && !content))
    return null;
  return { name, isPublic, ...(metadataOnly ? {} : { content }) };
}
export function createNotecardTemplatesRouter({ db, requireUser }) {
  const router = express.Router();
  const run = (handler) =>
    asyncRoute(async (req, res) => {
      const user = await requireUser(req, res);
      if (!user) return;
      res.set('Cache-Control', 'private, no-store');
      if (req.params.id && !/^[1-9]\d{0,17}$/.test(req.params.id))
        return res.status(400).json({ error: 'Invalid template ID.' });
      return handler(req, res, user);
    });
  const conflict = (res) =>
    res.status(409).json({
      error:
        'This template changed or is no longer editable. Save a new template, or reopen the latest design before replacing it.',
    });
  const revision = (value) => Number.isInteger(value) && value > 0 && value < 2147483647;
  router.get(
    '/',
    run(async (req, res, user) => {
      const scope = req.query.scope || 'mine',
        offset = Number(req.query.offset || 0);
      if (
        !['mine', 'shared', 'managed'].includes(scope) ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset > 1000000
      )
        return res.status(400).json({ error: 'Invalid template page.' });
      const result = await db.notecardTemplates.list(user, scope, offset);
      const current = await requireUser(req, res);
      if (!current) return;
      result.templates = result.templates
        .filter((t) => t.isPublic || String(t.ownerId) === String(current.id) || current.isAdmin)
        .map((t) => ({
          ...t,
          canEdit: String(t.ownerId) === String(current.id) || !!current.isAdmin,
        }));
      res.json(result);
    }),
  );
  router.get(
    '/:id',
    run(async (req, res, user) => {
      const template = await db.notecardTemplates.get(user, req.params.id);
      const current = await requireUser(req, res);
      if (!current) return;
      if (
        !template ||
        (!template.isPublic && String(template.ownerId) !== String(current.id) && !current.isAdmin)
      )
        return res.status(404).json({ error: 'Template not found or no longer shared.' });
      res.json({
        template: {
          ...template,
          canEdit: String(template.ownerId) === String(current.id) || !!current.isAdmin,
        },
      });
    }),
  );
  router.post(
    '/',
    express.json({ limit: '256kb' }),
    run(async (req, res, user) => {
      const value = normalizeNotecardTemplate(req.body);
      if (!value)
        return res
          .status(400)
          .json({ error: 'Invalid template name, sharing setting or notecard content.' });
      const template = await db.notecardTemplates.create(user, value);
      res.status(201).json({ template });
    }),
  );
  for (const method of ['put', 'patch'])
    router[method](
      '/:id',
      express.json({ limit: '256kb' }),
      run(async (req, res, user) => {
        const value = normalizeNotecardTemplate(req.body, method === 'patch');
        if (!value || !revision(req.body?.revision))
          return res.status(400).json({ error: 'Invalid template or revision.' });
        const template = await db.notecardTemplates.update(
          user,
          req.params.id,
          value,
          req.body.revision,
        );
        if (!template) return conflict(res);
        res.json({ template });
      }),
    );
  router.delete(
    '/:id',
    express.json({ limit: '1kb' }),
    run(async (req, res, user) => {
      if (!revision(req.body?.revision))
        return res.status(400).json({ error: 'Invalid template revision.' });
      if (!(await db.notecardTemplates.remove(user, req.params.id, req.body.revision)))
        return conflict(res);
      res.json({ ok: true });
    }),
  );
  return router;
}
