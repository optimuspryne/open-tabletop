// auth.js — password hashing + device tokens, using only Node's crypto (no
// dependencies, nothing to compile).
//
// Passwords: salted scrypt (a memory-hard KDF). Stored as "scrypt$<salt>$<hash>".
// Device tokens: 256 bits of randomness. The raw token goes to the client once;
// the server stores and looks it up only by its sha256 — the token *is* the
// secret, so a fast deterministic hash is correct here (and is what lets us look
// a user up by their token), while a DB leak still can't reveal live tokens.
import crypto from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(crypto.scrypt);
const KEYLEN = 32;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  // timing-safe compare (equal lengths guaranteed by keylen above)
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export function makeToken() {
  return crypto.randomBytes(32).toString('base64url');
}
export function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}
