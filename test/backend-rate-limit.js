import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryTokenBucketStore, RedisTokenBucketStore, createRateLimitStore, makeRateLimiter } from '../server/rate-limit.js';
import { redisConnectionUrl, trustedProxyHops } from '../server/redis-config.js';

test('memory token bucket limits, refills, and removes expired IP entries', async () => {
  let now = 1000;
  const store = new MemoryTokenBucketStore({ now: () => now, sweepIntervalMs: 0 });
  const options = { cap: 2, refillPerMs: 1 / 1000 };
  assert.equal((await store.consume('auth:ip', options)).allowed, true);
  assert.equal((await store.consume('auth:ip', options)).allowed, true);
  const denied = await store.consume('auth:ip', options);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterMs, 1000);
  now += 1000;
  assert.equal((await store.consume('auth:ip', options)).allowed, true);
  now += 2001;
  store.sweep();
  assert.equal(store.buckets.size, 0);
});

test('redis store delegates one atomic evaluation with a refill-based TTL', async () => {
  const calls = [];
  const client = { async eval(script, options) { calls.push({ script, options }); return [0, 500]; } };
  const store = new RedisTokenBucketStore(client, { prefix: 'test' });
  assert.deepEqual(await store.consume('auth:127.0.0.1', { cap: 20, refillPerMs: 1 / 3000 }),
    { allowed: false, retryAfterMs: 500 });
  assert.deepEqual(calls[0].options.keys, ['test:auth:127.0.0.1']);
  assert.equal(calls[0].options.arguments[2], '60000');
  assert.match(calls[0].script, /PEXPIRE/);
});

const response = () => ({
  statusCode: null, body: null, headers: {},
  set(name, value) { this.headers[name] = value; return this; },
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test('rate-limit middleware returns 429 with Retry-After and keeps namespaces separate', async () => {
  const keys = [];
  const store = { async consume(key) { keys.push(key); return { allowed: false, retryAfterMs: 1200 }; } };
  const limiter = makeRateLimiter({ store, namespace: 'auth', cap: 2, refillPerMs: 1, message: 'slow', logger: { error() {} } });
  const res = response();
  await limiter({ ip: '192.0.2.1' }, res, () => assert.fail('must not continue'));
  assert.deepEqual(keys, ['auth:192.0.2.1']);
  assert.equal(res.statusCode, 429);
  assert.equal(res.headers['Retry-After'], '2');
  assert.deepEqual(res.body, { error: 'slow' });
});

test('rate-limit middleware fails closed when the shared store is unavailable', async () => {
  const store = { async consume() { throw new Error('redis offline'); } };
  const limiter = makeRateLimiter({ store, namespace: 'upload', cap: 2, refillPerMs: 1, message: 'slow', logger: { error() {} } });
  const res = response();
  await limiter({ ip: '192.0.2.1' }, res, () => assert.fail('must not continue'));
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: 'rate limiter unavailable — try again' });
});

test('Redis URL files and trusted proxy hop counts are validated', () => {
  assert.equal(redisConnectionUrl({ env: { REDIS_URL: 'redis://cache:6379' } }), 'redis://cache:6379');
  assert.equal(redisConnectionUrl({ env: { REDIS_URL_FILE: '/secret' }, readFile: () => 'redis://secret:6379\n' }), 'redis://secret:6379');
  assert.equal(trustedProxyHops({ env: { TRUST_PROXY_HOPS: '2' } }), 2);
  assert.throws(() => trustedProxyHops({ env: { TRUST_PROXY_HOPS: 'all' } }), /integer/);
});

test('memory fallback is explicit in production and unknown store modes fail startup', async () => {
  const logger = { warn() {}, error() {} };
  const store = await createRateLimitStore({ env: { NODE_ENV: 'production', RATE_LIMIT_STORE: 'memory' }, logger });
  assert.equal(store instanceof MemoryTokenBucketStore, true);
  store.close();
  await assert.rejects(createRateLimitStore({ env: { RATE_LIMIT_STORE: 'filesystem' }, logger }), /redis or memory/);
});
