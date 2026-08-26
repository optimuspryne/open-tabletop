import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, makeToken, hashToken } from '../auth.js';

test('password hashes are salted and verify only the original password', async () => {
  const first = await hashPassword('correct horse battery staple');
  const second = await hashPassword('correct horse battery staple');
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('correct horse battery staple', first), true);
  assert.equal(await verifyPassword('wrong password', first), false);
});

test('malformed stored password hashes fail closed', async () => {
  for (const stored of [null, '', 'plain-text', 'bcrypt$salt$hash', 'scrypt$$00']) {
    assert.equal(await verifyPassword('password', stored), false);
  }
});

test('device tokens are random and only their deterministic digest is persisted', () => {
  const first = makeToken();
  const second = makeToken();
  assert.notEqual(first, second);
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(hashToken(first), hashToken(first));
  assert.notEqual(hashToken(first), first);
  assert.notEqual(hashToken(first), hashToken(second));
});
