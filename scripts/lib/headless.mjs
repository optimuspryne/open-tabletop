// scripts/lib/headless.mjs — the shared headless-browser plumbing.
//
// Three scripts drive a real browser now (css-parity, input-test, component-parity), so
// the static server + CDP boilerplate lives here once. Zero dependencies: node:http plus
// the Chrome DevTools Protocol over Node 22's global WebSocket.
//
// Needs a Chromium/Chrome binary. Set CHROME_BIN, or the usual paths are searched.
// Deliberately not a devDependency: `npm run check` must keep working without a browser.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

export function findChrome() {
  if (process.env.CHROME_BIN) {
    // Validate rather than trust: a wrong path otherwise hangs until the launch timeout.
    if (!existsSync(process.env.CHROME_BIN))
      throw new Error(`CHROME_BIN is set to ${process.env.CHROME_BIN}, which does not exist.`);
    return process.env.CHROME_BIN;
  }
  const hit = [
    '/opt/pw-browsers/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/brave-browser',
  ].find((n) => existsSync(n));
  if (!hit) throw new Error('No Chromium found. Set CHROME_BIN to a Chrome/Chromium binary.');
  return hit;
}

/**
 * Static file server over `root`.
 *   stubJs: serve an empty body for every .js (deterministic, script-free snapshots)
 *   stubOnly: serve an empty body for just these paths (e.g. ['/client.js'])
 *   routes: virtual paths → { body, type }
 *   mounts: url prefix → directory, for trees outside root (e.g. /shared/)
 * `missing` collects 404s so a caller can report them rather than silently rendering wrong.
 */
export async function serveDir({ root, stubJs = false, stubOnly = [], routes = {}, mounts = {} }) {
  const missing = [];
  const server = await new Promise((ok) => {
    const s = createServer(async (req, res) => {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const ext = extname(path);
      if (routes[path]) {
        res.writeHead(200, { 'content-type': routes[path].type ?? MIME['.html'] });
        return res.end(routes[path].body);
      }
      if ((stubJs && ext === '.js') || stubOnly.includes(path)) {
        res.writeHead(200, { 'content-type': MIME['.js'] });
        return res.end('');
      }
      const mount = Object.keys(mounts).find((p) => path.startsWith(p));
      const file = mount ? join(mounts[mount], path.slice(mount.length)) : join(root, path);
      try {
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
        res.end(body);
      } catch {
        missing.push(path);
        res.writeHead(404).end('');
      }
    });
    s.listen(0, '127.0.0.1', () => ok(s));
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    missing,
    close: () => server.close(),
  };
}

/**
 * Launch headless Chrome and connect the DevTools protocol.
 *   webgl: the page needs a GL context (graphics.js builds a WebGLRenderer at import).
 *          Software GL via SwiftShader; --disable-gpu would also disable that, so the
 *          two modes are mutually exclusive.
 */
export async function launch({ webgl = false } = {}) {
  const profile = await mkdtemp(join(tmpdir(), 'headless-'));
  const flags = [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage', // CI containers give /dev/shm 64MB; Chrome crashes without it
    '--hide-scrollbars',
    '--disable-lcd-text',
    '--force-device-scale-factor=1',
    '--force-color-profile=srgb',
    '--disable-font-subpixel-positioning',
    // Headless reports (pointer: none) by default, so (pointer: fine) never matches and
    // any rule gated on it goes unmeasured. 4 = fine in Blink's pointer enum.
    '--blink-settings=primaryPointerType=4,availablePointerTypes=4',
    ...(webgl
      ? ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader']
      : ['--disable-gpu']),
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    'about:blank',
  ];
  const proc = spawn(findChrome(), flags, { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((ok, fail) => {
    let buf = '';
    const t = setTimeout(() => fail(new Error('browser did not start')), 30000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/ws:\/\/[^\s]+/);
      if (m) {
        clearTimeout(t);
        ok(m[0]);
      }
    });
  });

  const sock = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  sock.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
    } else listeners.forEach((fn) => fn(msg));
  });
  await new Promise((ok) => sock.addEventListener('open', ok));

  const send = (method, params = {}, sessionId) =>
    new Promise((ok, fail) => {
      const mid = ++id;
      pending.set(mid, { ok, fail });
      sock.send(JSON.stringify({ id: mid, method, params, sessionId }));
    });

  return {
    send,
    on: (fn) => listeners.push(fn),
    async close() {
      sock.close();
      proc.kill();
      await new Promise((r) => setTimeout(r, 300));
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/**
 * Open a page, size it, navigate, wait for load. Returns an `evaluate` bound to it, plus
 * the errors the page raised — a fixture that silently half-executed is the failure mode
 * these scripts exist to avoid, so callers can assert on it.
 */
export async function newPage(
  cdp,
  { url, width = 1440, height = 900, touch = false, settle = 300 },
) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const errors = [];
  cdp.on((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown')
      errors.push(
        (
          m.params.exceptionDetails.exception?.description ||
          m.params.exceptionDetails.text ||
          ''
        ).split('\n')[0],
      );
  });
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send(
    'Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: 1, mobile: !!touch },
    sessionId,
  );
  // (pointer: coarse) only matches with touch emulation on. Calling this with
  // enabled:false resets the pointer type to none and undoes the blink-settings flag,
  // so the fine-pointer pages must not call it at all.
  if (touch)
    await cdp.send(
      'Emulation.setTouchEmulationEnabled',
      { enabled: true, maxTouchPoints: 5 },
      sessionId,
    );
  await cdp.send('Page.enable', {}, sessionId);
  const loaded = new Promise((ok) =>
    cdp.on((m) => {
      if (m.method === 'Page.loadEventFired' && m.sessionId === sessionId) ok();
    }),
  );
  await cdp.send('Page.navigate', { url }, sessionId);
  await loaded;
  if (settle) await new Promise((r) => setTimeout(r, settle));

  return {
    sessionId,
    errors,
    async evaluate(expression) {
      const { result, exceptionDetails } = await cdp.send(
        'Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true },
        sessionId,
      );
      if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'evaluate threw');
      return result.value;
    },
    close: () => cdp.send('Target.closeTarget', { targetId }),
  };
}

// The properties every snapshot records. Shared so css-parity and component-parity
// produce the same shape and the same --diff can read both.
export const SNAPSHOT_PROPS = [
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
  'visibility',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'color',
  'background-color',
  'background-image',
  'opacity',
  'box-shadow',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'text-decoration-line',
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'justify-content',
  'align-items',
  'align-self',
  'gap',
  'order',
  'grid-template-columns',
  'grid-template-rows',
  'grid-column',
  'grid-row',
  'overflow-x',
  'overflow-y',
  'transform',
  'transition-property',
  'cursor',
  'pointer-events',
  'white-space',
  'box-sizing',
];

/** The in-page snapshot routine, as an expression string. */
export function snapshotExpression({
  props = SNAPSHOT_PROPS,
  revealHidden = true,
  root = null,
  normalizeDataUrls = false,
} = {}) {
  return `(() => {
  ${revealHidden ? "for (const el of document.querySelectorAll('[hidden]')) el.removeAttribute('hidden');" : ''}
  const PROPS = ${JSON.stringify(props)};
  const scope = ${root ? `document.querySelector(${JSON.stringify(root)})` : 'document.documentElement'};
  if (!scope) return JSON.stringify({});
  const pathOf = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== scope; n = n.parentElement) {
      const i = n.parentElement ? [...n.parentElement.children].indexOf(n) + 1 : 1;
      parts.unshift(n.id ? n.tagName.toLowerCase() + '#' + n.id : n.tagName.toLowerCase() + ':' + i);
    }
    return 'html>' + parts.join('>');
  };
  const out = {};
  for (const el of [scope, ...scope.querySelectorAll('*')]) {
    // the scope element itself counts: querySelectorAll would skip it
    const cs = getComputedStyle(el);
    const rec = {};
    for (const p of PROPS) {
      let v = cs.getPropertyValue(p);
      ${normalizeDataUrls ? `if (v.startsWith('url("data:')) v = 'url(data:generated)';` : ''}
      rec[p] = v;
    }
    const r = el.getBoundingClientRect();
    rec['@rect'] = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    let k = pathOf(el), n = 2;
    while (k in out) k = pathOf(el) + '~' + n++;
    out[k] = rec;
  }
  return JSON.stringify(out);
})()`;
}
