import fs from 'fs';

export function redisConnectionUrl({ env = process.env, required = false, readFile = fs.readFileSync } = {}) {
  const file = String(env.REDIS_URL_FILE || '').trim();
  if (file) {
    const value = String(readFile(file, 'utf8')).trim();
    if (!value) throw new Error('REDIS_URL_FILE is empty.');
    return value;
  }
  const value = String(env.REDIS_URL || '').trim();
  if (value) return value;
  if (required) throw new Error('Redis not configured: set REDIS_URL or REDIS_URL_FILE.');
  return null;
}

export function trustedProxyHops({ env = process.env } = {}) {
  const raw = String(env.TRUST_PROXY_HOPS || '0').trim();
  if (!/^\d+$/.test(raw) || Number(raw) > 10) throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 10.');
  return Number(raw);
}
