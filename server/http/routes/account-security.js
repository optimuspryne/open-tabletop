import crypto from 'node:crypto';
import express from 'express';
import { asyncRoute } from '../async-route.js';
import { clientUser } from '../auth-context.js';
import { passwordError } from '../../../shared/passwords.js';
import { validEmail } from '../../auth-validation.js';
import { sessionExpiresAt } from '../../session-config.js';
import { createRecoveryMailQueue } from '../../recovery-mail.js';

const TOKEN_TTL_MS = 30 * 60_000;
const GRANT_TTL_MS = 10 * 60_000;
const CODE_COUNT = 10;
// Existing passwords were bounded only by the legacy request body limit.
const CURRENT_PASSWORD_MAX_LENGTH = 1024;
const secret = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const genericMailMessage =
  'If this email is verified for an account, a recovery link will arrive shortly.';

export function createAccountSecurityRouter({
  db,
  requireUser,
  rateLimitAuth,
  hashPassword,
  verifyPassword,
  makeToken,
  hashToken,
  roomAccess,
  mailer,
  mailQueue = createRecoveryMailQueue(),
}) {
  const router = express.Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use(rateLimitAuth, express.json({ limit: '4kb' }));
  const sessionHash = (req) => hashToken((req.headers.authorization || '').replace(/^Bearer /, ''));
  const denied = (res) =>
    res
      .status(400)
      .json({ error: 'This credential is invalid, expired, or already used. Please try again.' });
  const session = () => {
    const token = makeToken();
    return { token, stored: { tokenHash: hashToken(token), expiresAt: sessionExpiresAt() } };
  };
  function sendEmail(request) {
    return mailQueue.enqueue(async () => {
      const token = makeToken();
      const tokenHash = hashToken(token);
      const recipient = await db.accountSecurity.issueEmail({
        ...request,
        tokenHash,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      });
      if (!recipient) return;
      try {
        await mailer.send({ ...recipient, purpose: request.purpose, token });
      } catch (error) {
        await db.accountSecurity.discardEmail(tokenHash);
        throw error;
      }
    });
  }
  router.get('/security/config', (_req, res) =>
    res.json({ emailRecoveryAvailable: mailer.enabled }),
  );
  router.get(
    '/security',
    asyncRoute(async (req, res) => {
      if (!(await requireUser(req, res))) return;
      const status = await db.accountSecurity.status(sessionHash(req));
      if (!status) return res.status(401).json({ error: 'Please sign in again.' });
      res.json({
        ...status,
        user: clientUser(status.user),
        emailRecoveryAvailable: mailer.enabled,
      });
    }),
  );
  router.post(
    '/password',
    asyncRoute(async (req, res) => {
      if (!(await requireUser(req, res))) return;
      const { password, confirmation, currentPassword } = req.body || {};
      const error = passwordError(password, confirmation);
      if (error) return res.status(400).json({ error });
      const user = await db.accountSecurity.credentials(sessionHash(req));
      if (!user) return res.status(401).json({ error: 'Please sign in again.' });
      if (
        user.passwordHash &&
        (typeof currentPassword !== 'string' ||
          currentPassword.length > CURRENT_PASSWORD_MAX_LENGTH ||
          !(await verifyPassword(currentPassword, user.passwordHash)))
      )
        return res.status(403).json({
          error: 'Current password is incorrect. Use password reset if you have forgotten it.',
        });
      const next = session();
      const updated = await db.accountSecurity.setPassword({
        sessionHash: sessionHash(req),
        expectedHash: user.passwordHash,
        passwordHash: await hashPassword(password),
        session: next.stored,
      });
      if (!updated) return denied(res);
      roomAccess.revokeUser(updated.id);
      res.json({ user: clientUser(updated), token: next.token });
    }),
  );
  router.post(
    '/recovery/codes',
    asyncRoute(async (req, res) => {
      if (!(await requireUser(req, res))) return;
      const codes = Array.from({ length: CODE_COUNT }, () =>
        crypto.randomBytes(16).toString('hex').match(/.{4}/g).join('-'),
      );
      if (
        !(await db.accountSecurity.replaceCodes(
          sessionHash(req),
          codes.map((code) => hashToken(code.replaceAll('-', ''))),
        ))
      )
        return res.status(401).json({ error: 'Please sign in again.' });
      res.json({ codes });
    }),
  );
  router.post(
    '/recovery/verify/request',
    asyncRoute(async (req, res) => {
      if (!(await requireUser(req, res))) return;
      if (!mailer.enabled)
        return res.status(503).json({
          error: 'Email recovery is not configured on this server. Save recovery codes instead.',
        });
      if (!sendEmail({ sessionHash: sessionHash(req), purpose: 'verify' }))
        return res.status(503).json({ error: 'Email queue is busy. Please try again shortly.' });
      res.json({
        message:
          'Verification requested. Check your inbox; requests are limited to once per minute.',
      });
    }),
  );
  router.post(
    '/recovery/verify',
    asyncRoute(async (req, res) => {
      if (!(await requireUser(req, res))) return;
      if (
        !secret(req.body?.token) ||
        !(await db.accountSecurity.verifyEmail(sessionHash(req), hashToken(req.body.token)))
      )
        return denied(res);
      res.json({ message: 'Recovery email verified.' });
    }),
  );
  router.post('/recovery/request', (req, res) => {
    if (!mailer.enabled)
      return res
        .status(503)
        .json({ error: 'Email recovery is not configured. Use a saved recovery code.' });
    if (!validEmail(req.body?.email))
      return res.status(400).json({ error: 'Enter a valid email address.' });
    if (!sendEmail({ email: req.body.email.trim(), purpose: 'recover' }))
      return res.status(503).json({ error: 'Email queue is busy. Please try again shortly.' });
    res.json({ message: genericMailMessage });
  });
  router.post(
    '/recovery/exchange',
    asyncRoute(async (req, res) => {
      const { token, login, code } = req.body || {};
      const normalizedCode =
        typeof code === 'string' ? code.replaceAll('-', '').trim().toLowerCase() : '';
      if (!(
        secret(token) ||
        (typeof login === 'string' && login.length <= 254 && /^[a-f0-9]{32}$/.test(normalizedCode))
      ))
        return denied(res);
      const grant = makeToken();
      const result = await db.accountSecurity.exchange({
        tokenHash: secret(token) ? hashToken(token) : null,
        login: typeof login === 'string' ? login.trim() : '',
        codeHash: hashToken(normalizedCode),
        grantHash: hashToken(grant),
        expiresAt: new Date(Date.now() + GRANT_TTL_MS),
      });
      if (!result) return denied(res);
      res.json({ ...result, grant });
    }),
  );
  router.post(
    '/recovery/complete',
    asyncRoute(async (req, res) => {
      const { grant, password, confirmation } = req.body || {};
      if (!secret(grant)) return denied(res);
      if (password !== undefined) {
        const error = passwordError(password, confirmation);
        if (error) return res.status(400).json({ error });
      }
      const next = session();
      const user = await db.accountSecurity.recover({
        grantHash: hashToken(grant),
        passwordHash: password === undefined ? null : await hashPassword(password),
        session: next.stored,
      });
      if (!user) return denied(res);
      roomAccess.revokeUser(user.id);
      res.json({ user: clientUser(user), token: next.token });
    }),
  );
  return router;
}
