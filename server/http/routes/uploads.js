import express from 'express';
import { asyncRoute } from '../async-route.js';
import { imageExtension, validateGlb } from '../../assets/upload-validation.js';

export function createUploadRouter({ rateLimitUpload, requireAdmin, saveAsset }) {
  const router = express.Router();

  router.post('/upload', rateLimitUpload, express.raw({ type: 'image/*', limit: '16mb' }), asyncRoute(async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'empty' });
    const extension = imageExtension(req.body);
    if (!extension) return res.status(415).json({ error: 'not a supported image' });
    res.json({ url: saveAsset(req.query.kind, req.body, extension) });
  }));

  router.post('/upload-model', rateLimitUpload, express.raw({ type: () => true, limit: '16mb' }), asyncRoute(async (req, res) => {
    if (!await requireAdmin(req, res)) return;
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'empty' });
    const result = validateGlb(req.body);
    if (!result.ok) return res.status(415).json({ error: result.reason });
    res.json({ url: saveAsset(req.query.kind || 'props', req.body, 'glb') });
  }));

  return router;
}
