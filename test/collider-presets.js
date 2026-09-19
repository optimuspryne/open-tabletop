import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  normalizePreset,
  createColliderPresetsRouter,
} from '../server/http/routes/collider-presets.js';

test('production database exports the preset operations used by HTTP routes', () => {
  // Import the same db.js namespace as server.js, without connecting to a live database.
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
    import assert from 'node:assert/strict';
    import pg from 'pg';
    let queries = 0;
    pg.Pool.prototype.query = async () => { queries++; return { rows: [] }; };
    const db = await import('./db.js');
    try {
      for (const operation of ['list', 'get', 'save', 'remove'])
        assert.equal(typeof db.colliderPresets?.[operation], 'function', operation);
      assert.deepEqual(await db.colliderPresets.list({ id: '1', isAdmin: false }),
        { presets: [], nextOffset: null });
      assert.equal(queries, 1);
    } finally { await db.close(); }
  `,
    ],
    {
      cwd: new URL('../', import.meta.url),
      env: {
        ...process.env,
        DATABASE_URL_FILE: '',
        DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/collider_wiring_test',
      },
    },
  );
});

const value = {
  name: ' Hexagon ',
  isPublic: false,
  size: 2,
  layout: {
    version: 1,
    shapes: [
      {
        type: 'outline',
        outline: { type: 'hexagon' },
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [1, 0.1, 1],
      },
    ],
  },
};
test('preset validation rejects unsafe and oversized layouts and strips ownership fields', () => {
  const valid = normalizePreset({ ...value, ownerId: '99', canEdit: true });
  assert.equal(valid.name, 'Hexagon');
  assert.equal(valid.ownerId, undefined);
  assert.equal(valid.canEdit, undefined);
  for (const invalid of [
    null,
    {},
    { ...value, name: '' },
    { ...value, name: 'x'.repeat(121) },
    { ...value, isPublic: 'false' },
    { ...value, size: Infinity },
    { ...value, size: 0 },
    { ...value, layout: { version: 1, shapes: Array(17).fill(value.layout.shapes[0]) } },
    {
      ...value,
      layout: { version: 1, shapes: [{ ...value.layout.shapes[0], position: [3, 0, 0] }] },
    },
  ])
    assert.equal(normalizePreset(invalid), null);
});
function invoke(router, method, path, req = {}) {
  const route = router.stack.find(
    (layer) => layer.route?.path === path && layer.route.methods[method],
  ).route;
  return new Promise((resolve, reject) => {
    const res = {
      code: 200,
      status(code) {
        this.code = code;
        return this;
      },
      json(body) {
        resolve({ code: this.code, body });
      },
    };
    route.stack.at(-1).handle({ params: {}, query: {}, ...req }, res, reject);
  });
}
test('preset routes require authentication and pass server identity to persistence', async () => {
  const calls = [];
  const user = { id: '2', isAdmin: false };
  const db = {
    colliderPresets: {
      async save(...args) {
        calls.push(args);
        return { id: '1' };
      },
    },
  };
  const router = createColliderPresetsRouter({ db, requireUser: async () => user });
  assert.equal(
    (await invoke(router, 'post', '/', { body: { ...value, ownerId: '99' } })).code,
    201,
  );
  assert.equal(calls[0][0], user);
  assert.equal(calls[0][2].ownerId, undefined);
  assert.equal(
    (await invoke(router, 'put', '/:id', { params: { id: '0' }, body: value })).code,
    400,
  );
  assert.equal((await invoke(router, 'post', '/', { body: { ...value, isPublic: 1 } })).code, 400);
  assert.equal((await invoke(router, 'get', '/', { query: { offset: -1 } })).code, 400);
  const denied = createColliderPresetsRouter({
    db,
    requireUser: async (req, res) => {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    },
  });
  for (const [method, path] of [
    ['get', '/'],
    ['get', '/:id'],
    ['post', '/'],
    ['put', '/:id'],
    ['delete', '/:id'],
  ])
    assert.equal(
      (await invoke(denied, method, path, { params: { id: '1' }, body: value })).code,
      401,
    );
  assert.equal(calls.length, 1);
});
