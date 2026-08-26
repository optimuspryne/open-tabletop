import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionExpiresAt, sessionTtlDays } from '../server/session-config.js';

test('session lifetime defaults to 30 days and accepts bounded whole days', () => {
  assert.equal(sessionTtlDays(undefined), 30);
  assert.equal(sessionTtlDays('1'), 1);
  assert.equal(sessionTtlDays('365'), 365);
  for (const value of ['0', '1.5', '366', 'forever']) {
    assert.throws(() => sessionTtlDays(value), /SESSION_TTL_DAYS/);
  }
});

test('session expiration is calculated from the supplied clock', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(sessionExpiresAt(now, 2).toISOString(), '2026-01-03T00:00:00.000Z');
});
