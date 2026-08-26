import express from 'express';
import { asyncRoute } from '../async-route.js';
import { clientUser } from '../auth-context.js';
import { validEmail, validUsername } from '../../auth-validation.js';
export { validEmail, validUsername } from '../../auth-validation.js';

export function createAuthRouter({ db, rateLimitAuth, hashPassword, verifyPassword, makeToken, hashToken }) {
  const router = express.Router();
  const json = express.json({ limit: '1kb' });

  router.post('/signup', rateLimitAuth, json, asyncRoute(async (req, res) => {
    const { username, email, password } = req.body || {};
    if (!validUsername(username)) return res.status(400).json({ error: 'username must be 3–20 chars (letters, numbers, _ or -)' });
    if (!validEmail(email)) return res.status(400).json({ error: 'invalid email' });
    if (password != null && String(password).length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
    try {
      const passwordHash = password ? await hashPassword(String(password)) : null;
      const raw = makeToken();
      const user = await db.createUser({ username: username.trim(), email: email.trim(), passwordHash, loginTokenHash: hashToken(raw) });
      res.json({ user: clientUser(user), token: raw });
    } catch (error) {
      if (error.conflict) return res.status(409).json({ error: `that ${error.conflict} is already taken`, field: error.conflict });
      throw error;
    }
  }));

  router.post('/login', rateLimitAuth, json, asyncRoute(async (req, res) => {
    const { login, password } = req.body || {};
    if (!login || !password) return res.status(400).json({ error: 'login and password required' });
    const user = await db.findUserByLogin(String(login).trim());
    // Keep missing, passwordless, and incorrect-password responses indistinguishable.
    if (!user || !user.passwordHash || !(await verifyPassword(String(password), user.passwordHash))) {
      return res.status(401).json({ error: 'invalid login or password' });
    }
    const raw = makeToken();
    await db.setLoginToken(user.id, hashToken(raw));
    res.json({ user: clientUser(user), token: raw });
  }));

  router.post('/token', rateLimitAuth, json, asyncRoute(async (req, res) => {
    const user = await db.findUserByToken(hashToken(String((req.body && req.body.token) || '')));
    if (!user) return res.status(401).json({ error: 'invalid or expired token' });
    res.json({ user: clientUser(user) });
  }));

  return router;
}
