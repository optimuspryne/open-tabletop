import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeNotecardTemplate,
  createNotecardTemplatesRouter,
} from '../server/http/routes/notecard-templates.js';

const content = { drawing: [], paper: { pattern: 'grid', tone: 'ivory' }, textBoxes: [] };
const value = { name: ' Sheet ', content };
function invoke(router, method, path, req = {}) {
  const route = router.stack.find((l) => l.route?.path === path && l.route.methods[method]).route;
  return new Promise((resolve, reject) => {
    const res = {
      code: 200,
      headers: {},
      set(k, v) {
        this.headers[k] = v;
        return this;
      },
      status(c) {
        this.code = c;
        return this;
      },
      json(body) {
        resolve({ code: this.code, headers: this.headers, body });
      },
    };
    route.stack.at(-1).handle({ params: {}, query: {}, ...req }, res, reject);
  });
}
test('template content stays structured and private by default; malformed metadata/content fails', () => {
  assert.deepEqual(normalizeNotecardTemplate({ ...value, ownerId: '999', canEdit: true }), {
    name: 'Sheet',
    content,
    isPublic: false,
  });
  for (const bad of [
    null,
    {},
    { ...value, name: '' },
    { ...value, name: 'x'.repeat(61) },
    { ...value, isPublic: 'yes' },
    { ...value, isPublic: null },
    { ...value, content: { drawing: [], textBoxes: [{}] } },
  ])
    assert.equal(normalizeNotecardTemplate(bad), null);
  assert.deepEqual(normalizeNotecardTemplate({ ...value, isPublic: true }, true), {
    name: 'Sheet',
    isPublic: true,
  });
});
test('template routes require authentication, preserve trusted identity and reject stale replacements', async () => {
  const calls = [],
    user = { id: '3', isAdmin: false };
  const db = {
    notecardTemplates: {
      async create(...args) {
        calls.push(args);
        return { id: '1' };
      },
      async update() {
        return undefined;
      },
      async remove() {
        return false;
      },
    },
  };
  const router = createNotecardTemplatesRouter({ db, requireUser: async () => user });
  const saved = await invoke(router, 'post', '/', { body: { ...value, ownerId: '9' } });
  assert.equal(saved.code, 201);
  assert.equal(calls[0][0], user);
  assert.equal(calls[0][1].ownerId, undefined);
  assert.equal(calls[0][1].isPublic, false);
  assert.equal(saved.headers['Cache-Control'], 'private, no-store');
  assert.equal(
    (await invoke(router, 'put', '/:id', { params: { id: '1' }, body: { ...value, revision: 1 } }))
      .code,
    409,
  );
  assert.equal(
    (
      await invoke(router, 'patch', '/:id', {
        params: { id: '1' },
        body: { name: 'Rename', revision: 0 },
      })
    ).code,
    400,
  );
  assert.equal(
    (await invoke(router, 'delete', '/:id', { params: { id: '1' }, body: { revision: 1 } })).code,
    409,
  );
  assert.equal((await invoke(router, 'get', '/:id', { params: { id: '1;DROP' } })).code, 400);
  assert.equal((await invoke(router, 'get', '/', { query: { offset: -1 } })).code, 400);
  const denied = createNotecardTemplatesRouter({
    db,
    requireUser: async (_req, res) => {
      res.status(401).json({ error: 'Sign in' });
      return null;
    },
  });
  for (const [method, path] of [
    ['get', '/'],
    ['get', '/:id'],
    ['post', '/'],
    ['put', '/:id'],
    ['patch', '/:id'],
    ['delete', '/:id'],
  ])
    assert.equal((await invoke(denied, method, path, { body: value })).code, 401);
});
test('private template responses recheck live account access after asynchronous reads', async () => {
  const template = { id: '1', ownerId: '7', content, isPublic: false, canEdit: true };
  let calls = 0;
  const db = {
    notecardTemplates: {
      get: async () => template,
      list: async () => ({ templates: [template], nextOffset: null }),
    },
  };
  const requireUser = async () => ({ id: '3', isAdmin: ++calls === 1 });
  const router = createNotecardTemplatesRouter({ db, requireUser });
  assert.equal((await invoke(router, 'get', '/:id', { params: { id: '1' } })).code, 404);
  calls = 0;
  assert.deepEqual((await invoke(router, 'get', '/')).body.templates, []);
});
test('template database failures reach the HTTP error boundary instead of reporting empty/successful saves', async () => {
  const db = {
    notecardTemplates: {
      list: async () => {
        throw new Error('database unavailable');
      },
      create: async () => {
        throw new Error('write unavailable');
      },
    },
  };
  const router = createNotecardTemplatesRouter({ db, requireUser: async () => ({ id: '3' }) });
  await assert.rejects(invoke(router, 'get', '/'), /database unavailable/);
  await assert.rejects(invoke(router, 'post', '/', { body: value }), /write unavailable/);
});
