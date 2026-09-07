import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuthRouter } from '../server/http/routes/auth.js';
import { createAdminRouter } from '../server/http/routes/admin.js';

// Exercise the registered async route body with an already-parsed request.
function invoke(router, path, body = {}, params = {}) {
  const route = router.stack.find((layer) => layer.route?.path === path).route;
  const handler = route.stack.at(-1).handle;
  return new Promise((resolve, reject) => {
    const response = {
      code: 200,
      status(code) {
        this.code = code;
        return this;
      },
      json(value) {
        resolve({ code: this.code, body: value });
      },
      end() {
        resolve({ code: this.code });
      },
    };
    handler({ body, params }, response, reject);
  });
}

function harness() {
  const calls = [];
  const db = {
    async revokeSession(hash) {
      calls.push(['deleteSession', hash]);
    },
    async findUserByToken(hash) {
      return hash === 'hash:valid' ? { id: '2' } : null;
    },
    async revokeUserSessions(id) {
      calls.push(['deleteSessions', id]);
    },
    async setAdmin(id, enabled) {
      calls.push(['setAdmin', id, enabled]);
    },
    async findUserById(id) {
      return { id };
    },
    async roomsOwnedBy() {
      return [];
    },
    async purgeUser(id) {
      calls.push(['purgeUser', id]);
    },
  };
  const roomAccess = {
    revokeSession(hash) {
      calls.push(['disconnectSession', hash]);
    },
    revokeUser(id) {
      calls.push(['disconnectUser', id]);
    },
  };
  const auth = createAuthRouter({
    db,
    roomAccess,
    hashToken: (raw) => `hash:${raw}`,
    rateLimitAuth: (_req, _res, next) => next(),
  });
  const admin = createAdminRouter({
    db,
    roomAccess,
    requireAdmin: async () => ({ id: '1' }),
    kickUserEverywhere: (id) => calls.push(['kickUser', id]),
  });
  return { calls, db, auth, admin };
}

test('logout disconnects only the revoked token after successful database revocation', async () => {
  const h = harness();
  assert.equal((await invoke(h.auth, '/logout', { token: 'valid' })).code, 204);
  assert.deepEqual(h.calls, [
    ['deleteSession', 'hash:valid'],
    ['disconnectSession', 'hash:valid'],
  ]);
});

test('logout-all disconnects the authenticated account across devices', async () => {
  const h = harness();
  assert.equal((await invoke(h.auth, '/logout-all', { token: 'valid' })).code, 204);
  assert.deepEqual(h.calls, [
    ['deleteSessions', '2'],
    ['disconnectUser', '2'],
  ]);
});

test('invalid logout-all credentials cannot disconnect anyone', async () => {
  const h = harness();
  assert.equal((await invoke(h.auth, '/logout-all', { token: 'invalid' })).code, 401);
  assert.deepEqual(h.calls, []);
});

test('admin privilege changes invalidate live authority after the database update', async () => {
  const h = harness();
  await invoke(h.admin, '/users/:id/admin', { isAdmin: false }, { id: '2' });
  assert.deepEqual(h.calls, [
    ['setAdmin', '2', false],
    ['disconnectUser', '2'],
  ]);
});

test('account deletion revokes connections after deletion prevents new authorization', async () => {
  const h = harness();
  await invoke(h.admin, '/users/:id', {}, { id: '2' });
  assert.deepEqual(h.calls, [
    ['purgeUser', '2'],
    ['kickUser', '2'],
  ]);
});

test('database failures do not report successful revocation or admin changes', async () => {
  for (const [router, path, operation, body, params] of [
    ['auth', '/logout', 'revokeSession', { token: 'valid' }, {}],
    ['auth', '/logout-all', 'revokeUserSessions', { token: 'valid' }, {}],
    ['admin', '/users/:id/admin', 'setAdmin', { isAdmin: false }, { id: '2' }],
  ]) {
    const h = harness();
    h.db[operation] = async () => {
      throw new Error('database offline');
    };
    await assert.rejects(invoke(h[router], path, body, params), /database offline/);
    assert.deepEqual(h.calls, []);
  }
});
