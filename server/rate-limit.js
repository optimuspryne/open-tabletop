import { createClient } from 'redis';
import { redisConnectionUrl } from './redis-config.js';

const TOKEN_BUCKET_LUA = `
local nowParts = redis.call('TIME')
local now = tonumber(nowParts[1]) * 1000 + math.floor(tonumber(nowParts[2]) / 1000)
local cap = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local bucket = redis.call('HMGET', KEYS[1], 'tokens', 'last')
local tokens = cap
local last = now
if bucket[1] and bucket[2] then
  tokens = math.min(cap, tonumber(bucket[1]) + math.max(0, now - tonumber(bucket[2])) * refill)
  last = tonumber(bucket[2])
end
local allowed = 0
local retry = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  retry = math.ceil((1 - tokens) / refill)
end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'last', now)
redis.call('PEXPIRE', KEYS[1], ttl)
return { allowed, retry }
`;

export class RedisTokenBucketStore {
  constructor(client, { prefix = 'open-tabletop:rate' } = {}) {
    this.client = client;
    this.prefix = prefix;
  }

  async consume(key, { cap, refillPerMs }) {
    const ttlMs = Math.max(1000, Math.ceil(cap / refillPerMs));
    const result = await this.client.eval(TOKEN_BUCKET_LUA, {
      keys: [`${this.prefix}:${key}`],
      arguments: [String(cap), String(refillPerMs), String(ttlMs)],
    });
    return { allowed: Number(result[0]) === 1, retryAfterMs: Number(result[1]) || 0 };
  }

  close() {
    return this.client.quit();
  }
}

export class MemoryTokenBucketStore {
  constructor({ now = Date.now, sweepIntervalMs = 60000 } = {}) {
    this.now = now;
    this.buckets = new Map();
    this.timer = sweepIntervalMs > 0 ? setInterval(() => this.sweep(), sweepIntervalMs) : null;
    if (this.timer) this.timer.unref();
  }

  async consume(key, { cap, refillPerMs }) {
    const now = this.now();
    const ttlMs = Math.max(1000, Math.ceil(cap / refillPerMs));
    const prior = this.buckets.get(key);
    let tokens = prior
      ? Math.min(cap, prior.tokens + Math.max(0, now - prior.last) * refillPerMs)
      : cap;
    const allowed = tokens >= 1;
    const retryAfterMs = allowed ? 0 : Math.ceil((1 - tokens) / refillPerMs);
    if (allowed) tokens -= 1;
    this.buckets.set(key, { tokens, last: now, expiresAt: now + ttlMs });
    return { allowed, retryAfterMs };
  }

  sweep() {
    const now = this.now();
    for (const [key, bucket] of this.buckets) if (bucket.expiresAt <= now) this.buckets.delete(key);
  }

  close() {
    if (this.timer) clearInterval(this.timer);
  }
}

export async function createRateLimitStore({ env = process.env, logger = console } = {}) {
  const mode = String(env.RATE_LIMIT_STORE || '')
    .trim()
    .toLowerCase();
  if (mode && mode !== 'redis' && mode !== 'memory')
    throw new Error('RATE_LIMIT_STORE must be redis or memory.');
  const redisUrl = redisConnectionUrl({
    env,
    required: mode === 'redis' || (env.NODE_ENV === 'production' && mode !== 'memory'),
  });
  if (mode === 'memory' || (!redisUrl && env.NODE_ENV !== 'production')) {
    logger.warn('[rate-limit] using in-memory store; set REDIS_URL for multi-instance deployments');
    return new MemoryTokenBucketStore();
  }
  const client = createClient({ url: redisUrl });
  client.on('error', (error) => logger.error('[redis]', error.message));
  await client.connect();
  return new RedisTokenBucketStore(client);
}

export function makeRateLimiter({ store, namespace, cap, refillPerMs, message, logger = console }) {
  if (!store || !namespace || !(cap > 0) || !(refillPerMs > 0))
    throw new Error('Invalid rate limiter configuration.');
  return async (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    try {
      const result = await store.consume(`${namespace}:${ip}`, { cap, refillPerMs });
      if (result.allowed) return next();
      const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
      res.set('Retry-After', String(seconds));
      return res.status(429).json({ error: message });
    } catch (error) {
      logger.error(`[rate-limit:${namespace}]`, error.message);
      res.set('Retry-After', '1');
      return res.status(503).json({ error: 'rate limiter unavailable — try again' });
    }
  };
}
