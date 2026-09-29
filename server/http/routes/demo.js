import express from 'express';
import { asyncRoute } from '../async-route.js';
import { DemoError } from '../../demo-queries.js';

const rawToken = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer /, '');
const status = { invalid: 400, forbidden: 403, expired: 410, capacity: 503 };

export function createDemoRouter({ demo, store, makeToken, hashToken }) {
  const router = express.Router();
  let pending = 0;
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin) {
      try {
        if (new URL(origin).host !== req.get('host')) return res.sendStatus(403);
      } catch {
        return res.sendStatus(403);
      }
    }
    next();
  });
  router.use(express.json({ limit: '2kb' }));
  const route = (operation, handler) =>
    asyncRoute(async (req, res) => {
      if (pending >= 8) return res.status(503).json({ code: 'capacity' });
      pending++;
      try {
        const allocation = operation === 'create' || operation === 'join';
        const policy = allocation
          ? { cap: 8, refillPerMs: 8 / 600000 }
          : { cap: 60, refillPerMs: 1 / 1000 };
        for (const [key, budget] of [
          [`demo:${operation}:${req.ip}`, policy],
          [
            `demo:${allocation ? 'allocation' : 'read'}:global`,
            allocation
              ? { cap: 20, refillPerMs: 20 / 600000 }
              : { cap: 120, refillPerMs: 2 / 1000 },
          ],
        ]) {
          const result = await store.consume(key, budget);
          if (!result.allowed) {
            res.set('Retry-After', String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
            return res.status(429).json({ code: 'rate_limited' });
          }
        }
        await handler(req, res);
      } catch (error) {
        if (error instanceof DemoError)
          return res.status(status[error.code] || 400).json({ code: error.code });
        throw error;
      } finally {
        pending--;
      }
    });
  async function session(req) {
    const token = bearer(req);
    return rawToken(token) ? demo.resume(hashToken(token)) : null;
  }
  router.post(
    '/resume',
    route('resume', async (req, res) => {
      const table = await session(req);
      if (!table) return res.status(410).json({ code: 'expired' });
      res.json({ table });
    }),
  );
  router.post(
    '/create',
    route('create', async (req, res) => {
      const existing = await session(req);
      if (existing) return res.json({ table: existing });
      const token = makeToken();
      const invite = makeToken();
      const table = await demo.createTable({
        displayName: req.body?.displayName,
        starter: req.body?.starter,
        sessionHash: hashToken(token),
        inviteHash: hashToken(invite),
      });
      res.json({ table, token, invite });
    }),
  );
  router.post(
    '/invite',
    route('inspect', async (req, res) => {
      if (!rawToken(req.body?.invite)) return res.status(410).json({ code: 'expired' });
      const table = await demo.inspectInvite(hashToken(req.body.invite));
      if (!table) return res.status(410).json({ code: 'expired' });
      res.json({ table });
    }),
  );
  router.post(
    '/join',
    route('join', async (req, res) => {
      if (!rawToken(req.body?.invite)) return res.status(410).json({ code: 'expired' });
      const existing = await session(req);
      // A browser with a live table resumes it; joining another never silently abandons it.
      if (existing) return res.json({ table: existing });
      const token = makeToken();
      const table = await demo.joinInvite({
        displayName: req.body?.displayName,
        sessionHash: hashToken(token),
        inviteHash: hashToken(req.body.invite),
      });
      res.json({ table, token });
    }),
  );
  router.post(
    '/rotate',
    route('rotate', async (req, res) => {
      const token = bearer(req);
      if (!rawToken(token)) return res.status(403).json({ code: 'forbidden' });
      const invite = makeToken();
      await demo.rotateInvite({ sessionHash: hashToken(token), inviteHash: hashToken(invite) });
      res.json({ invite });
    }),
  );
  return router;
}
