#!/usr/bin/env node
/**
 * css-parity.mjs — prove a CSS change is a PURE refactor.
 *
 * Snapshots the computed style of every element on every page, then diffs two
 * snapshots. Any visual delta shows up as a property change on a named element.
 *
 * Zero dependencies: a node:http static server + the Chrome DevTools Protocol
 * over Node's global WebSocket (Node >= 22). Page JavaScript is not served, so
 * snapshots are deterministic — no sockets, no physics, no random ids.
 *
 * Needs a Chromium/Chrome binary. Set CHROME_BIN, or install one; the script
 * searches the usual names. It is intentionally NOT a devDependency.
 *
 *   node scripts/css-parity.mjs --out before.json
 *   # ...edit public/styles.css...
 *   node scripts/css-parity.mjs --out after.json
 *   node scripts/css-parity.mjs --diff before.json after.json
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', 'public');
const PAGES = ['table.html', 'index.html', 'admin.html'];

// The stylesheet has breakpoints at 560/720/900px plus (pointer: coarse) and a
// short-landscape query. Snapshot every regime, or a responsive-only regression
// walks straight past the harness.
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'lap-880', width: 880, height: 900 },
  { name: 'tab-700', width: 700, height: 900 },
  { name: 'phone-540', width: 540, height: 900 },
  { name: 'landscape-short', width: 800, height: 520 },
  { name: 'coarse-390', width: 390, height: 844, touch: true },
];

const PROPS = [
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

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function serve() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const ext = extname(path);
    // Serve CSS/HTML/assets, but stub every script: page JS must not run.
    if (ext === '.js') {
      res.writeHead(200, { 'content-type': MIME['.js'] });
      return res.end('');
    }
    try {
      const body = await readFile(join(ROOT, path));
      res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('');
    }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const names = [
    '/opt/pw-browsers/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/brave-browser',
  ];
  const hit = names.find((n) => existsSync(n));
  if (!hit) {
    throw new Error('No Chromium found. Set CHROME_BIN to a Chrome/Chromium binary.');
  }
  return hit;
}

async function launch() {
  const profile = await mkdtemp(join(tmpdir(), 'cssparity-'));
  const proc = spawn(
    findChrome(),
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      '--disable-lcd-text',
      '--force-device-scale-factor=1',
      '--force-color-profile=srgb',
      '--disable-font-subpixel-positioning',
      // Headless reports (pointer: none) by default, so (pointer: fine) never matches
      // and any rule gated on it goes unmeasured. 4 = fine in Blink's pointer enum.
      '--blink-settings=primaryPointerType=4,availablePointerTypes=4',
      `--user-data-dir=${profile}`,
      '--remote-debugging-port=0',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const ws = await new Promise((ok, fail) => {
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
  return { proc, ws, profile };
}

function cdp(url) {
  const sock = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  sock.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
    } else {
      listeners.forEach((fn) => fn(msg));
    }
  });
  const ready = new Promise((ok) => sock.addEventListener('open', ok));
  return {
    ready,
    on: (fn) => listeners.push(fn),
    send: (method, params = {}, sessionId) =>
      new Promise((ok, fail) => {
        const mid = ++id;
        pending.set(mid, { ok, fail });
        sock.send(JSON.stringify({ id: mid, method, params, sessionId }));
      }),
    close: () => sock.close(),
  };
}

const SNAPSHOT = `(() => {
  // Reveal hidden containers so modal/pop-out subtrees are measurable.
  for (const el of document.querySelectorAll('[hidden]')) el.removeAttribute('hidden');
  const PROPS = ${JSON.stringify(PROPS)};
  const pathOf = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      const i = n.parentElement ? [...n.parentElement.children].indexOf(n) + 1 : 1;
      parts.unshift(n.id ? n.tagName.toLowerCase() + '#' + n.id : n.tagName.toLowerCase() + ':' + i);
    }
    return 'html>' + parts.join('>');
  };
  const out = {};
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    const rec = {};
    for (const p of PROPS) rec[p] = cs.getPropertyValue(p);
    const r = el.getBoundingClientRect();
    rec['@rect'] = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    let k = pathOf(el), n = 2;
    while (k in out) k = pathOf(el) + '~' + n++;
    out[k] = rec;
  }
  return JSON.stringify(out);
})()`;

async function snapshot(outFile) {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const { proc, ws, profile } = await launch();
  const c = cdp(ws);
  await c.ready;
  const all = {};
  for (const { name, width, height, touch } of VIEWPORTS)
    for (const page of PAGES) {
      const { targetId } = await c.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await c.send('Target.attachToTarget', { targetId, flatten: true });
      await c.send(
        'Emulation.setDeviceMetricsOverride',
        { width, height, deviceScaleFactor: 1, mobile: !!touch },
        sessionId,
      );
      // (pointer: coarse) only matches with touch emulation on. Calling this with
      // enabled:false resets the pointer type to none and undoes the blink-settings
      // flag above, so the fine-pointer regimes must not call it at all.
      if (touch)
        await c.send(
          'Emulation.setTouchEmulationEnabled',
          { enabled: true, maxTouchPoints: 5 },
          sessionId,
        );
      await c.send('Page.enable', {}, sessionId);
      const loaded = new Promise((ok) => {
        c.on((m) => {
          if (m.method === 'Page.loadEventFired' && m.sessionId === sessionId) ok();
        });
      });
      await c.send('Page.navigate', { url: `${base}/${page}` }, sessionId);
      await loaded;
      await new Promise((r) => setTimeout(r, 400));
      const { result } = await c.send(
        'Runtime.evaluate',
        { expression: SNAPSHOT, returnByValue: true },
        sessionId,
      );
      const key = `${page} @${name}`;
      all[key] = JSON.parse(result.value);
      process.stderr.write(`  ${key}: ${Object.keys(all[key]).length} elements\n`);
      await c.send('Target.closeTarget', { targetId });
    }
  c.close();
  proc.kill();
  server.close();
  await writeFile(outFile, JSON.stringify(all, null, 0));
  // Best-effort: the browser may still be flushing its profile dir.
  await new Promise((r) => setTimeout(r, 500));
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  console.log(`wrote ${outFile}`);
}

async function diff(aFile, bFile) {
  const a = JSON.parse(await readFile(aFile, 'utf8'));
  const b = JSON.parse(await readFile(bFile, 'utf8'));
  let changed = 0,
    addedEls = 0,
    removedEls = 0;
  const report = [];
  for (const page of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const pa = a[page] ?? {},
      pb = b[page] ?? {};
    for (const k of Object.keys(pa)) {
      if (!(k in pb)) {
        removedEls++;
        report.push(`- ${page} ${k}  ELEMENT GONE`);
        continue;
      }
      for (const p of Object.keys(pa[k])) {
        const va = JSON.stringify(pa[k][p]),
          vb = JSON.stringify(pb[k][p]);
        if (va !== vb) {
          changed++;
          report.push(`~ ${page} ${k}\n    ${p}: ${va} -> ${vb}`);
        }
      }
    }
    for (const k of Object.keys(pb))
      if (!(k in pa)) {
        addedEls++;
        report.push(`+ ${page} ${k}  ELEMENT NEW`);
      }
  }
  const shown = report.slice(0, 60);
  shown.forEach((l) => console.log(l));
  if (report.length > shown.length) console.log(`... ${report.length - shown.length} more`);
  console.log(
    `\nproperty deltas: ${changed}   elements added: ${addedEls}   removed: ${removedEls}`,
  );
  if (changed || addedEls || removedEls) {
    console.log('RESULT: NOT a pure refactor');
    process.exitCode = 1;
  } else {
    console.log('RESULT: PURE refactor — computed styles identical');
  }
}

/* ------------------------------------------------------------------ lint --
 * Static mode: no browser, no baseline. Catches CSS that has decayed away
 * from the markup — a class defined in styles.css that nothing references
 * any more. This is what belongs in `npm run check`; the snapshot/diff modes
 * above are refactor-time tools that need two runs and a browser.
 * ------------------------------------------------------------------------ */

// Classes that are intentionally defined without a reference (applied by an
// external script, kept for a documented reason). Add with a comment saying why.
const LINT_ALLOW = new Set([]);

const SCAN_EXT = ['.js', '.mjs', '.html', '.json', '.md', '.sql'];
const SCAN_SKIP = new Set(['.git', 'node_modules', 'saved-assets', 'vendor', '.idea', '.claude']);

function selectorsOf(css) {
  const out = [];
  let buf = '',
    i = 0;
  while (i < css.length) {
    if (css.startsWith('/*', i)) {
      const j = css.indexOf('*/', i + 2);
      i = j === -1 ? css.length : j + 2;
      continue;
    }
    const c = css[i];
    if (c === '{') {
      if (!buf.trim().startsWith('@')) out.push(buf);
      buf = '';
    } else if (c === '}') buf = '';
    else buf += c;
    i++;
  }
  return out;
}

async function walkFiles(dir, acc = []) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    if (SCAN_SKIP.has(ent.name)) continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) await walkFiles(full, acc);
    else if (SCAN_EXT.includes(extname(ent.name))) acc.push(full);
  }
  return acc;
}

async function lint() {
  const cssPath = join(ROOT, 'styles.css');
  const css = await readFile(cssPath, 'utf8');
  const sels = selectorsOf(css);

  // A class used ONLY inside :not() is not dead — :not(.gone) still matches.
  const defined = new Set(),
    inNot = new Set();
  for (const sel of sels) {
    for (const m of sel.matchAll(/\.[A-Za-z_][\w-]*/g)) {
      const name = m[0].slice(1);
      const before = sel.slice(0, m.index);
      const open = (before.match(/:not\(/g) ?? []).length;
      const close = (before.match(/\)/g) ?? []).length;
      (open > close ? inNot : defined).add(name);
    }
  }

  const repo = resolve(ROOT, '..');
  const files = await walkFiles(repo);
  const blobs = await Promise.all(
    files.filter((f) => f !== cssPath).map((f) => readFile(f, 'utf8').catch(() => '')),
  );

  const dead = [];
  for (const name of [...defined].sort()) {
    if (LINT_ALLOW.has(name) || inNot.has(name)) continue;
    const re = new RegExp(`(?<![\\w-])${name.replace(/[.*+?^$()[\]{}|\\]/g, '\\$&')}(?![\\w-])`);
    if (!blobs.some((b) => re.test(b))) dead.push(name);
  }

  if (dead.length === 0) {
    console.log(`css-lint: ${defined.size} classes defined, all referenced.`);
    return;
  }
  console.error(
    `css-lint: ${dead.length} class(es) defined in public/styles.css but referenced nowhere:\n`,
  );
  for (const d of dead) console.error(`  .${d}`);
  console.error(
    '\nRemove them, or add to LINT_ALLOW in scripts/css-parity.mjs with a reason.' +
      '\nNote: some may share a comma group with live selectors — remove the dead' +
      '\nselector, not the whole rule.',
  );
  process.exitCode = 1;
}

const argv = process.argv.slice(2);
if (argv[0] === '--lint') await lint();
else if (argv[0] === '--out') await snapshot(argv[1]);
else if (argv[0] === '--diff') await diff(argv[1], argv[2]);
else {
  console.error('usage: css-parity.mjs --lint | --out <file> | --diff <before> <after>');
  process.exitCode = 2;
}
