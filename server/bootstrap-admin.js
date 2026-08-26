import fs from 'fs';
import { validEmail, validUsername } from './auth-validation.js';

// Provision a fresh database before the HTTP listener opens. Partial config and
// non-empty databases without an admin fail closed; existing admins are untouched.
export async function bootstrapAdminFromEnvironment({ db, hashPassword, env = process.env, readFile = fs.readFileSync }) {
  const username = String(env.BOOTSTRAP_ADMIN_USERNAME || '').trim();
  const email = String(env.BOOTSTRAP_ADMIN_EMAIL || '').trim();
  const passwordFile = String(env.BOOTSTRAP_ADMIN_PASSWORD_FILE || '').trim();
  if (!username && !email && !passwordFile) return { status: 'disabled' };
  if (!username || !email || !passwordFile) {
    throw new Error('Admin bootstrap requires BOOTSTRAP_ADMIN_USERNAME, BOOTSTRAP_ADMIN_EMAIL, and BOOTSTRAP_ADMIN_PASSWORD_FILE.');
  }
  if (!validUsername(username)) throw new Error('BOOTSTRAP_ADMIN_USERNAME must be 3–20 characters (letters, numbers, _ or -).');
  if (!validEmail(email)) throw new Error('BOOTSTRAP_ADMIN_EMAIL is invalid.');
  const password = String(readFile(passwordFile, 'utf8')).replace(/[\r\n]+$/, '');
  if (password.length < 12) throw new Error('Bootstrap administrator password must be at least 12 characters.');
  if (password.length > 1024) throw new Error('Bootstrap administrator password is too long.');
  const passwordHash = await hashPassword(password);
  return db.bootstrapAdmin({ username, email, passwordHash });
}
