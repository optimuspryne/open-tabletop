import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launch, newPage, serveDir } from './lib/headless.mjs';

const root = resolve(import.meta.dirname, '..', 'public');
const html = (await readFile(resolve(root, 'admin.html'), 'utf8')).replace(
  '<script type="module" src="/admin.js">',
  '<script src="/admin-fixture.js"></script><script type="module" src="/admin.js">',
);
const fixture = `
const nativeFetch = window.fetch;
window.calls = [];
window.logoutFails = false;
window.alert = message => { window.lastAlert = message; };
window.fetch = async (path, options = {}) => {
  if (!/^\\/(auth|admin|demo-config)/.test(path)) return nativeFetch(path, options);
  const body = options.body ? JSON.parse(options.body) : {};
  window.calls.push({ path, body });
  const response = (data, status = 200) => new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
  if (path === '/demo-config') return response({ enabled: true });
  if (path === '/auth/login') {
    await new Promise(resolve => setTimeout(resolve, 100));
    if (body.password !== 'fixture-password') return response({ error: 'invalid login or password' }, 401);
    return response({
      user: { id: '1', username: body.login, isAdmin: body.login === 'demo-admin' },
      token: body.login === 'demo-admin' ? 'admin-session' : 'rejected-session',
    });
  }
  if (path === '/auth/token') {
    if (body.token !== 'admin-session') return response({ error: 'invalid or expired token' }, 401);
    return response({ user: { id: '1', username: 'demo-admin', isAdmin: true } });
  }
  if (path === '/auth/logout') {
    if (window.logoutFails) throw new Error('Network unavailable');
    return response({});
  }
  if (path === '/admin/rooms') return response({ rooms: [] });
  if (path === '/admin/users') return response({ users: [{ id: '2', username: 'Demo guest', email: null, hostStatus: 'none' }] });
  if (path === '/admin/texture-cache') return response({ state: 'idle', total: 0, completed: 0 });
  throw new Error('Unexpected fixture request: ' + path);
};
`;
const server = await serveDir({
  root,
  routes: {
    '/admin.html': { body: html },
    '/admin-fixture.js': { body: fixture, type: 'application/javascript' },
  },
});
let browser;
try {
  browser = await launch();
  const page = await newPage(browser, { url: server.origin + '/admin.html' });
  const evaluate = page.evaluate;
  const settle = () => evaluate('new Promise(resolve => setTimeout(resolve, 350))');
  const submit = (login, password) =>
    evaluate(`document.querySelector('#adminLoginId').value=${JSON.stringify(login)};
      document.querySelector('#adminLoginPassword').value=${JSON.stringify(password)};
      document.querySelector('#adminLoginForm').requestSubmit()`);
  assert.equal(await evaluate('document.activeElement.id'), 'adminLoginId');
  assert.equal(await evaluate("document.querySelector('#editorBtn').hidden"), true);
  assert.equal(await evaluate("document.querySelector('#admin').hidden"), true);
  await evaluate("localStorage.setItem('tabletop.demo.session', 'guest-sentinel')");
  await submit('demo-admin', 'wrong');
  await settle();
  assert.match(
    await evaluate("document.querySelector('#adminLoginError').textContent"),
    /invalid login/,
  );
  assert.equal(await evaluate('document.activeElement.id'), 'adminLoginError');
  assert.equal(await evaluate("document.querySelector('#adminLoginPassword').value"), '');
  assert.equal(await evaluate("localStorage.getItem('tabletop.token')"), null);
  await evaluate("localStorage.setItem('tabletop.token', 'keep-account-session')");
  await submit('player', 'fixture-password');
  await settle();
  assert.match(
    await evaluate("document.querySelector('#adminLoginError').textContent"),
    /administrator access/,
  );
  assert.equal(await evaluate("localStorage.getItem('tabletop.token')"), 'keep-account-session');
  assert.equal(
    await evaluate(
      "calls.some(c => c.path === '/auth/logout' && c.body.token === 'rejected-session')",
    ),
    true,
  );
  const before = await evaluate("calls.filter(c => c.path === '/auth/login').length");
  await submit('demo-admin', 'fixture-password');
  await evaluate("document.querySelector('#adminLoginForm').requestSubmit()");
  await settle();
  assert.equal(await evaluate("calls.filter(c => c.path === '/auth/login').length"), before + 1);
  assert.equal(await evaluate("document.querySelector('#admin').hidden"), false);
  assert.equal(
    await evaluate("document.querySelector('#adminIdentity').textContent"),
    'demo-admin',
  );
  assert.equal(await evaluate("document.querySelector('#editorBtn').hidden"), false);
  assert.equal(await evaluate('document.activeElement.id'), 'adminHeading');
  await evaluate("window.logoutFails=true; document.querySelector('#adminSignOut').click()");
  await settle();
  assert.equal(await evaluate("localStorage.getItem('tabletop.token')"), 'admin-session');
  assert.match(await evaluate('window.lastAlert'), /Could not sign out/);
  await evaluate("window.logoutFails=false; document.querySelector('#adminSignOut').click()");
  await settle();
  assert.equal(await evaluate("localStorage.getItem('tabletop.token')"), null);
  assert.equal(await evaluate("localStorage.getItem('tabletop.demo.session')"), 'guest-sentinel');
  assert.equal(await evaluate("document.querySelector('#admin').hidden"), true);
  assert.equal(await evaluate('document.activeElement.id'), 'adminLoginId');
  await evaluate("localStorage.setItem('tabletop.token', 'expired')");
  const expired = await newPage(browser, { url: server.origin + '/admin.html' });
  assert.match(
    await expired.evaluate("document.querySelector('#adminLoginError').textContent"),
    /could not be verified/,
  );
  await expired.close();
  await evaluate("localStorage.removeItem('tabletop.token')");
  // Full/compact and fine/coarse are independent layout concerns.
  for (const width of [360, 1440]) {
    for (const touch of [false, true]) {
      const layout = await newPage(browser, { url: server.origin + '/admin.html', width, touch });
      for (const full of [false, true]) {
        await layout.evaluate(`document.body.classList.toggle('ui-full', ${full})`);
        assert.equal(
          await layout.evaluate('document.documentElement.scrollWidth <= innerWidth'),
          true,
        );
        assert.equal(
          await layout.evaluate(
            "getComputedStyle(document.querySelector('#lobbyBtn .lbl')).display !== 'none'",
          ),
          true,
        );
        assert.equal(
          await layout.evaluate(
            "document.querySelector('#adminSignIn').getBoundingClientRect().height >= 44",
          ),
          true,
        );
      }
      if (width === 360 && touch) {
        const shot = await browser.send(
          'Page.captureScreenshot',
          { format: 'png' },
          layout.sessionId,
        );
        await writeFile(
          '/tmp/open-tabletop-admin-login-phone.png',
          Buffer.from(shot.data, 'base64'),
        );
      }
      await layout.evaluate(`document.querySelector('#adminLoginId').value='demo-admin';
        document.querySelector('#adminLoginPassword').value='fixture-password';
        document.querySelector('#adminLoginForm').requestSubmit();
        new Promise(resolve => setTimeout(resolve, 350))`);
      assert.equal(await layout.evaluate("document.querySelector('#adminSession').hidden"), false);
      assert.equal(
        await layout.evaluate(`[...document.querySelector('#topbar').children].filter(el => !el.hidden).every(el => {
          const box = el.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth;
        })`),
        true,
        'authenticated header wraps within viewport',
      );
      assert.equal(
        await layout.evaluate(
          "getComputedStyle(document.querySelector('#adminSignOut .lbl')).display !== 'none'",
        ),
        true,
      );
      await layout.evaluate("localStorage.removeItem('tabletop.token')");
      assert.deepEqual(layout.errors, []);
      await layout.close();
    }
  }
  assert.deepEqual(page.errors, []);
  await page.close();
  console.log(
    'Admin login passed: credentials, non-admin rejection/revocation, duplicate prevention, session restore failure, sign-out retry, guest isolation, focus, and 8 layouts.',
  );
} finally {
  await browser?.close();
  await server.close();
}
