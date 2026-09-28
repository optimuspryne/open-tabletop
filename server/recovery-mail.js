import fs from 'node:fs';
import nodemailer from 'nodemailer';
import { validEmail } from './auth-validation.js';

export function recoveryMailConfig(env = process.env) {
  if (!env.SMTP_HOST) return null;
  const origin = new URL(env.PUBLIC_ORIGIN || '');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (
    (origin.protocol !== 'https:' && !(local && origin.protocol === 'http:')) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('PUBLIC_ORIGIN must be an HTTPS origin (HTTP allowed only on localhost).');
  const port = Number(env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !validEmail(env.SMTP_FROM))
    throw new Error('SMTP_PORT or SMTP_FROM is invalid.');
  const password = env.SMTP_PASSWORD_FILE
    ? fs.readFileSync(env.SMTP_PASSWORD_FILE, 'utf8').replace(/[\r\n]+$/, '')
    : env.SMTP_PASSWORD;
  if (!!env.SMTP_USER !== !!password)
    throw new Error('SMTP_USER and SMTP_PASSWORD(_FILE) must be configured together.');
  return {
    origin: origin.origin,
    from: env.SMTP_FROM.trim(),
    transport: {
      host: env.SMTP_HOST,
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: password } } : {}),
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      disableFileAccess: true,
      disableUrlAccess: true,
    },
  };
}

export function createRecoveryMailer({
  config = recoveryMailConfig(),
  createTransport = nodemailer.createTransport,
} = {}) {
  if (!config) return { enabled: false };
  const transport = createTransport(config.transport);
  return {
    enabled: true,
    async send({ email, purpose, token }) {
      // The operator-configured origin is never derived from request Host headers.
      // Fragments stay out of HTTP access logs and referrer headers.
      const link = `${config.origin}/#${purpose}=${encodeURIComponent(token)}`;
      await transport.sendMail({
        from: config.from,
        to: { address: email },
        subject:
          purpose === 'verify'
            ? 'Verify your Open Tabletop recovery email'
            : 'Recover your Open Tabletop account / reset password',
        text:
          purpose === 'verify'
            ? `Open this link in the browser where you are signed in, then confirm your email:\n\n${link}\n\nThis link expires in 30 minutes. If you did not request it, ignore this email.`
            : `Use this link to recover your account or reset your password:\n\n${link}\n\nThis link expires in 30 minutes and can be used once. If you did not request it, ignore this email.`,
      });
    },
  };
}

// Respond before lookup/delivery so unknown, unverified and registered addresses
// have the same request behavior. A bounded serial queue prevents SMTP fan-out.
export function createRecoveryMailQueue({ logger = console, limit = 20 } = {}) {
  let pending = 0;
  let tail = Promise.resolve();
  return {
    enqueue(work) {
      if (pending >= limit) return false;
      pending++;
      tail = tail
        .then(work)
        .catch(() => logger.error('[recovery-mail] delivery failed'))
        .finally(() => {
          pending--;
        });
      return true;
    },
    idle: () => tail,
  };
}
