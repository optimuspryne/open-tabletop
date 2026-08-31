#!/usr/bin/env node
/**
 * css-parity.mjs — prove a CSS change is a PURE refactor, and lint dead selectors.
 *
 * Two modes for two jobs:
 *
 *   --out / --diff   refactor-time proof. Snapshots the computed style of every element
 *                    on every page at every responsive regime, then diffs two snapshots.
 *                    Any visual delta shows up as a property change on a named element.
 *                    Needs a browser.
 *
 *   --lint           static gate, no browser, no baseline, sub-second. Fails when a class
 *                    or id is defined in styles.css and referenced nowhere in the repo.
 *                    This is the mode wired into `npm run check`; computed styles are
 *                    SUPPOSED to change when features are built, so gating on "styles
 *                    identical" would fail every legitimate UI commit.
 *
 *   node scripts/css-parity.mjs --lint
 *   node scripts/css-parity.mjs --out before.json
 *   #  ...edit public/styles.css...
 *   node scripts/css-parity.mjs --out after.json
 *   node scripts/css-parity.mjs --diff before.json after.json    # exit 1 on any delta
 *
 * Browser plumbing lives in scripts/lib/headless.mjs, shared with input-test.mjs and
 * component-parity.mjs.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { launch, newPage, serveDir, snapshotExpression } from './lib/headless.mjs';

const ROOT = resolve(import.meta.dirname, '..', 'public');
const PAGES = ['table.html', 'index.html', 'admin.html'];

// The stylesheet has breakpoints at 560/720/900px plus (pointer: coarse) and a
// short-landscape query. Snapshot every regime, or a responsive-only regression walks
// straight past the harness.
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'lap-880', width: 880, height: 900 },
  { name: 'tab-700', width: 700, height: 900 },
  { name: 'phone-540', width: 540, height: 900 },
  { name: 'landscape-short', width: 800, height: 520 },
  { name: 'coarse-390', width: 390, height: 844, touch: true },
];

async function snapshot(outFile) {
  // Page JavaScript is stubbed, so snapshots are deterministic: no sockets, no physics,
  // no random ids. The cost is that JS-built DOM is invisible here — that is
  // component-parity.mjs's job.
  const server = await serveDir({ root: ROOT, stubJs: true });
  const cdp = await launch();
  const all = {};
  for (const { name, width, height, touch } of VIEWPORTS)
    for (const page of PAGES) {
      const p = await newPage(cdp, {
        url: `${server.origin}/${page}`,
        width,
        height,
        touch,
        settle: 400,
      });
      const key = `${page} @${name}`;
      all[key] = JSON.parse(await p.evaluate(snapshotExpression()));
      process.stderr.write(`  ${key}: ${Object.keys(all[key]).length} elements\n`);
      await p.close();
    }
  await cdp.close();
  server.close();
  await writeFile(outFile, JSON.stringify(all, null, 0));
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

// Selectors intentionally defined without a reference (applied by an external script,
// kept for a documented reason). Entries carry their sigil: '.foo' or '#bar'.
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

  // A selector used ONLY inside :not() is not dead — :not(.gone) still matches.
  const defined = { class: new Set(), id: new Set() };
  const inNot = { class: new Set(), id: new Set() };
  for (const sel of sels) {
    for (const m of sel.matchAll(/[.#][A-Za-z_][\w-]*/g)) {
      const kind = m[0][0] === '.' ? 'class' : 'id';
      const name = m[0].slice(1);
      const before = sel.slice(0, m.index);
      const open = (before.match(/:not\(/g) ?? []).length;
      const close = (before.match(/\)/g) ?? []).length;
      (open > close ? inNot : defined)[kind].add(name);
    }
  }

  const repo = resolve(ROOT, '..');
  const files = await walkFiles(repo);
  const blobs = await Promise.all(
    files.filter((f) => f !== cssPath).map((f) => readFile(f, 'utf8').catch(() => '')),
  );

  const dead = { class: [], id: [] };
  for (const kind of ['class', 'id'])
    for (const name of [...defined[kind]].sort()) {
      const sigil = kind === 'class' ? '.' : '#';
      if (LINT_ALLOW.has(sigil + name) || inNot[kind].has(name)) continue;
      const re = new RegExp(`(?<![\\w-])${name.replace(/[.*+?^$()[\]{}|\\]/g, '\\$&')}(?![\\w-])`);
      if (!blobs.some((b) => re.test(b))) dead[kind].push(name);
    }

  const total = dead.class.length + dead.id.length;
  if (total === 0) {
    console.log(
      `css-lint: ${defined.class.size} classes and ${defined.id.size} ids defined, all referenced.`,
    );
    return;
  }
  console.error(
    `css-lint: ${total} selector(s) defined in public/styles.css but referenced nowhere:\n`,
  );
  for (const d of dead.class) console.error(`  .${d}`);
  for (const d of dead.id) console.error(`  #${d}`);
  console.error(
    '\nRemove them, or add to LINT_ALLOW in scripts/css-parity.mjs with a reason' +
      "\n(entries carry their sigil, e.g. '.foo' or '#bar')." +
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
