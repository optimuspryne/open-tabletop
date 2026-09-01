#!/usr/bin/env node
/**
 * device-matrix.mjs — hold the layout to docs/DEVICE_MATRIX.md.
 *
 * A whole layout branch can be wrong for one class of device and everything still looks fine
 * on the machine you happen to test on — the same failure mode docs/GESTURES.md and
 * input-test.mjs exist for, one layer up. GESTURES.md is the ledger of what a finger can
 * reach; DEVICE_MATRIX.md is the ledger of which layout each device gets, and this is its
 * automated half.
 *
 * The chrome hangs off three switches on two axes, and the code deliberately mixes them:
 *   SHEET_MQ = (max-width: 900px), (pointer: coarse)   → bottom-sheet vs floating panels
 *   (pointer: fine)                                    → panels can be dragged out to float
 *   (max-width: 560px)                                 → compact logo mark vs wordmark
 * A regression that collapses width and pointer into one query passes every phone and breaks
 * every tablet, so the profiles below put each switch in both states independently.
 *
 * These switches are pure CSS + matchMedia over static markup, so no server, no room and no
 * engine are needed: /client.js (the engine) and /landing.js are stubbed exactly as
 * component-parity.mjs stubs the engine, which keeps the pages error-clean. Browser plumbing:
 * scripts/lib/headless.mjs. Runs as `npm run test:devices`; NOT part of `npm run check`,
 * which must keep working on a machine with no browser.
 */
import { resolve } from 'node:path';
import { launch, newPage, serveDir } from './lib/headless.mjs';

const ROOT = resolve(import.meta.dirname, '..', 'public');
const SHARED = resolve(import.meta.dirname, '..', 'shared');

// Keep this string identical to SHEET_MQ in public/client.js and the .region,.sheet media
// query in public/styles.css — the drift between them is one of the things this test catches.
const SHEET_MQ = '(max-width: 900px), (pointer: coarse)';

// name, viewport, and the branch each profile is expected to land in.
// sheet = SHEET_MQ matches; fine = (pointer: fine) matches; mark = compact logo (<= 560px).
const PROFILES = [
  {
    name: 'desktop-1440',
    width: 1440,
    height: 900,
    touch: false,
    sheet: false,
    fine: true,
    mark: false,
  },
  {
    name: 'laptop-1280',
    width: 1280,
    height: 800,
    touch: false,
    sheet: false,
    fine: true,
    mark: false,
  },
  {
    name: 'desktop-narrow-720',
    width: 720,
    height: 900,
    touch: false,
    sheet: true,
    fine: true,
    mark: false,
  },
  {
    name: 'tablet-landscape',
    width: 1024,
    height: 768,
    touch: true,
    sheet: true,
    fine: false,
    mark: false,
  },
  {
    name: 'tablet-portrait',
    width: 820,
    height: 1180,
    touch: true,
    sheet: true,
    fine: false,
    mark: false,
  },
  { name: 'phone-390', width: 390, height: 844, touch: true, sheet: true, fine: false, mark: true },
  { name: 'phone-360', width: 360, height: 780, touch: true, sheet: true, fine: false, mark: true },
];

// Runs in the page. Reveals the elements it measures (they ship hidden), reports the live
// branch for each switch as both the matchMedia predicate AND the CSS effect it should cause,
// so a JS/CSS drift shows up as the two disagreeing rather than both being wrong together.
const PROBE_TABLE = `(() => {
  const mq = (q) => matchMedia(q).matches;
  const region = document.getElementById('regionTR'); // a .region: fixed 300px panel, or a bottom sheet
  if (region) region.hidden = false;
  const cs = region && getComputedStyle(region);
  const r = region && region.getBoundingClientRect();
  // The sheet rule sets border-radius: 16px 16px 0 0 (bottom-left 0) and spans the viewport;
  // the base .region keeps a non-zero radius on all four corners at width 300px.
  const cssSheet = !!cs && cs.borderBottomLeftRadius === '0px' && Math.round(r.width) >= innerWidth - 1;

  const modal = document.getElementById('addModal');
  if (modal) modal.hidden = false;
  const x = document.getElementById('addClose');
  const xr = x && x.getBoundingClientRect();
  const xVisible = !!xr && xr.width > 0 && xr.height > 0;
  const xInView = !!xr && xr.top >= 0 && xr.left >= 0 && xr.bottom <= innerHeight && xr.right <= innerWidth;

  return JSON.stringify({
    mqSheet: mq(${JSON.stringify(SHEET_MQ)}),
    mqFine: mq('(pointer: fine)'),
    cssSheet,
    hasRegion: !!region,
    hasSeat: !!document.getElementById('seatBtn'),
    hasModal: !!modal,
    xVisible,
    xInView,
    innerW: innerWidth,
    innerH: innerHeight,
  });
})()`;

// Runs on the landing page, where the topbar brand lives. Exactly one of the two logos should
// be displayed, and which one is the (max-width: 560px) switch.
const PROBE_BRAND = `(() => {
  const full = document.querySelector('.brandFull');
  const mark = document.querySelector('.brandMark');
  const shown = (el) => !!el && getComputedStyle(el).display !== 'none';
  return JSON.stringify({
    hasBrand: !!(full || mark),
    fullShown: shown(full),
    markShown: shown(mark),
  });
})()`;

const server = await serveDir({
  root: ROOT,
  // The layout switches are pure CSS + matchMedia over static markup, so stub ALL page JS:
  // no engine, no WebGL, no network, and the pages load error-clean.
  stubOnly: [
    '/client.js',
    '/editor-panel.js',
    '/equalize.js',
    '/landing.js',
    '/vendor/colyseus.js',
  ],
  mounts: { '/shared/': SHARED },
});
const cdp = await launch({ webgl: true }); // graphics.js builds a WebGLRenderer at import; needs software GL

let bad = 0;
const fail = (profile, msg) => {
  console.error(`  FAIL  ${profile}: ${msg}`);
  bad++;
};

for (const p of PROFILES) {
  // --- table.html: sheet / movable-panel / modal / seat ---
  const table = await newPage(cdp, {
    url: `${server.origin}/table.html`,
    width: p.width,
    height: p.height,
    touch: p.touch,
    settle: 700, // module graph + Three's first build
  });
  const t = JSON.parse(await table.evaluate(PROBE_TABLE));

  if (t.mqSheet !== p.sheet) fail(p.name, `SHEET_MQ matched ${t.mqSheet}, matrix says ${p.sheet}`);
  if (!t.hasRegion) fail(p.name, `#regionTR missing — cannot verify the sheet CSS effect`);
  else if (t.cssSheet !== p.sheet)
    fail(
      p.name,
      `.region laid out as sheet=${t.cssSheet} but matrix says ${p.sheet} — ` +
        `SHEET_MQ (client.js) and the .region media query (styles.css) are out of step`,
    );
  else if (t.mqSheet !== t.cssSheet)
    fail(
      p.name,
      `matchMedia says sheet=${t.mqSheet} but the CSS rendered sheet=${t.cssSheet} — JS/CSS drift`,
    );

  if (t.mqFine !== p.fine)
    fail(p.name, `(pointer: fine) matched ${t.mqFine}, matrix says ${p.fine}`);

  if (!t.hasSeat) fail(p.name, `#seatBtn missing from the markup`);
  if (!t.hasModal) fail(p.name, `#addModal missing — cannot verify modal reachability`);
  else if (!t.xVisible) fail(p.name, `Add-modal close (#addClose) did not render`);
  else if (!t.xInView)
    fail(p.name, `Add-modal close (#addClose) is outside the ${t.innerW}x${t.innerH} viewport`);

  if (table.errors.length) fail(p.name, `table.html raised ${table.errors[0]}`);
  await table.close();

  // --- index.html: the topbar logo switch ---
  const landing = await newPage(cdp, {
    url: `${server.origin}/index.html`,
    width: p.width,
    height: p.height,
    touch: p.touch,
    settle: 300,
  });
  const b = JSON.parse(await landing.evaluate(PROBE_BRAND));

  if (!b.hasBrand) fail(p.name, `topbar brand (.brandFull/.brandMark) missing on the landing page`);
  else if (b.fullShown === b.markShown)
    fail(
      p.name,
      `brand: expected exactly one logo shown, got full=${b.fullShown} mark=${b.markShown}`,
    );
  else {
    const wantMark = p.mark;
    if (b.markShown !== wantMark)
      fail(p.name, `logo mark shown=${b.markShown}, matrix says ${wantMark} (<= 560px)`);
  }

  if (landing.errors.length) fail(p.name, `index.html raised ${landing.errors[0]}`);
  await landing.close();

  console.log(
    `  ${p.name} (${p.width}x${p.height}${p.touch ? ' touch' : ''}): ` +
      `sheet=${t.mqSheet} fine=${t.mqFine} mark=${b.markShown} — ` +
      `${p.sheet === t.mqSheet && p.fine === t.mqFine && p.mark === b.markShown ? 'ok' : 'MISMATCH'}`,
  );
}

await cdp.close();
server.close();
if (server.missing.length)
  console.log(
    `  (${new Set(server.missing).size} asset paths 404'd: ${[...new Set(server.missing)].slice(0, 3).join(' ')}…)`,
  );

if (bad) {
  console.error(`\n${bad} device-matrix assertion(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`\nall ${PROFILES.length} profiles match docs/DEVICE_MATRIX.md`);
}
