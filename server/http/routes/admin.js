import express from 'express';
import { asyncRoute } from '../async-route.js';

export function createAdminRouter({
  db,
  requireAdmin,
  findOrphanAssets,
  trashOrphans,
  disposeLive,
  kickUserEverywhere,
}) {
  const router = express.Router();

  router.get(
    '/rooms',
    asyncRoute(async (req, res) => {
      if (!(await requireAdmin(req, res))) return;
      res.json({ rooms: await db.listRooms({ includeDeleted: true }) });
    }),
  );

  router.get(
    '/orphans',
    asyncRoute(async (req, res) => {
      if (!(await requireAdmin(req, res))) return;
      const orphans = await findOrphanAssets();
      res.json({
        count: orphans.length,
        totalBytes: orphans.reduce((sum, item) => sum + item.size, 0),
        files: orphans.slice(0, 200).map((item) => ({ url: item.url, size: item.size })),
      });
    }),
  );

  router.post(
    '/orphans/purge',
    asyncRoute(async (req, res) => {
      if (!(await requireAdmin(req, res))) return;
      const orphans = await findOrphanAssets();
      const totalBytes = orphans.reduce((sum, item) => sum + item.size, 0);
      const moved = trashOrphans(orphans);
      res.json({ moved: moved.length, totalBytes });
    }),
  );

  router.get(
    '/users',
    asyncRoute(async (req, res) => {
      if (!(await requireAdmin(req, res))) return;
      res.json({ users: await db.listUsers() });
    }),
  );

  router.get(
    '/pending-count',
    asyncRoute(async (req, res) => {
      if (!(await requireAdmin(req, res))) return;
      res.json({ pending: await db.countPendingHosts() });
    }),
  );

  router.post(
    '/users/:id/host',
    express.json({ limit: '1kb' }),
    asyncRoute(async (req, res) => {
      if (!(await requireAdmin(req, res))) return;
      const status = req.body && req.body.status;
      if (!['approved', 'pending', 'none'].includes(status))
        return res.status(400).json({ error: 'bad status' });
      await db.setHostStatus(req.params.id, status);
      res.json({ ok: true });
    }),
  );

  router.post(
    '/rooms/:id/restore',
    asyncRoute(async (req, res) => {
      if (!(await requireAdmin(req, res))) return;
      await db.restoreRoom(req.params.id);
      res.json({ ok: true });
    }),
  );

  router.delete(
    '/rooms/:id',
    asyncRoute(async (req, res) => {
      if (!(await requireAdmin(req, res))) return;
      const room = await db.getRoom(req.params.id);
      if (room) await disposeLive(room.code);
      await db.purgeRoom(req.params.id);
      res.json({ ok: true });
    }),
  );

  router.post(
    '/users/:id/admin',
    express.json({ limit: '1kb' }),
    asyncRoute(async (req, res) => {
      const actor = await requireAdmin(req, res);
      if (!actor) return;
      const makeAdmin = !!(req.body && req.body.isAdmin);
      if (String(req.params.id) === String(actor.id) && !makeAdmin) {
        return res.status(400).json({ error: 'you cannot remove your own admin rights' });
      }
      await db.setAdmin(req.params.id, makeAdmin);
      res.json({ ok: true });
    }),
  );

  router.post(
    '/users/:id/kick',
    asyncRoute(async (req, res) => {
      if (!(await requireAdmin(req, res))) return;
      res.json({ ok: true, rooms: kickUserEverywhere(req.params.id) });
    }),
  );

  router.delete(
    '/users/:id',
    asyncRoute(async (req, res) => {
      const actor = await requireAdmin(req, res);
      if (!actor) return;
      if (String(req.params.id) === String(actor.id))
        return res.status(400).json({ error: 'you cannot delete your own account' });
      const target = await db.findUserById(req.params.id);
      if (!target) return res.status(404).json({ error: 'user not found' });
      for (const room of await db.roomsOwnedBy(req.params.id)) await disposeLive(room.code);
      kickUserEverywhere(req.params.id);
      await db.purgeUser(req.params.id);
      res.json({ ok: true });
    }),
  );

  return router;
}
