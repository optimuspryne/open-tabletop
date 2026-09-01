#!/usr/bin/env node
/**
 * component-parity.mjs — snapshot the DOM the app BUILDS, not just the markup it ships.
 *
 * css-parity.mjs stubs page JavaScript so its snapshots are deterministic. The cost is a
 * blind spot: every component assembled at runtime — library cards, their controls, the
 * colour swatches — is invisible to it. Three changes shipped in one day needed a human
 * to look at them for exactly this reason.
 *
 * This runs the real modules. public/editor-panel.js does not depend on client.js: it
 * receives the room through window.onOttRoom and nothing else, so a permissive stub room
 * is enough to reach the whole library UI with no server, no database and no auth.
 *
 * Two things the fixture must get right, both learned the hard way:
 *   - graphics.js builds a WebGLRenderer at import time, so the browser needs software
 *     GL. --disable-gpu (which css-parity uses) would also disable SwiftShader, and
 *     editor-panel.js would die before assigning its seams — every global reading
 *     `undefined` and looking like the module simply did not exist.
 *   - applyIcons() is called from client.js, which is stubbed here. Without calling it,
 *     every icon-bearing element measures wrong: the swatch trigger comes out 14x6px
 *     instead of 26x18, which reads exactly like a real tap-target bug.
 *
 * Output uses the same snapshot format as css-parity.mjs, so:
 *   node scripts/component-parity.mjs --out before.json
 *   node scripts/css-parity.mjs --diff before.json after.json
 *
 * Needs a browser; not part of `npm run check`. Run as `npm run test:components`.
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launch, newPage, serveDir, snapshotExpression } from './lib/headless.mjs';

const ROOT = resolve(import.meta.dirname, '..', 'public');
const SHARED = resolve(import.meta.dirname, '..', 'shared');

// A permissive stub: editor-panel only needs the handover to wire its UI. Nothing here
// reaches the network — every method is a no-op and every state read is undefined.
const STUB_ROOM = `new Proxy({}, {
  get: (t, k) => k === 'sessionId' ? 'component-parity'
    : k === 'state' ? new Proxy({}, { get: () => undefined })
    : () => undefined,
})`;

// Becoming an admin with custom assets. Two things kept this whole surface unrendered until now:
// table.html ships `<body class="ui-full not-admin">` and it is client.js — stubbed here — that
// clears the class, so every .admin-only element was invisible in every scene; and the stub room
// serves no custom assets, so the Edit button and the "..." overflow (which only exist on a
// custom asset an admin owns) never rendered at all. That is the exact blind spot that let a
// dead "..." button ship.
const CUSTOM_ASSETS = {
  deck: [{ id: 'd1', name: 'Standard 54 - Pixel Red', isPublic: false, count: 54 }],
  board: [{ id: 'b1', name: 'Hex Field', isPublic: true }],
  prop: [{ id: 'p1', name: 'Dragon Mini', isPublic: false }],
  sky: [{ id: 'k1', name: 'Dusk Panorama', isPublic: true }],
  scene: [{ id: 'n1', name: 'Act II Setup', isPublic: false }],
};
const BE_ADMIN = `
  window.OTT_IS_ADMIN = true;
  document.body.classList.remove('not-admin', 'not-gm');`;
const WITH_ASSETS = `
  for (const [kind, list] of Object.entries(${JSON.stringify(CUSTOM_ASSETS)}))
    window.onLibraryList(kind, list);`;

// A gallery of the extracted row builders, rendered from fixtures. This is the point of
// pulling them out of client.js: every state a row can be in — pending member, GM seen by
// an owner, your own message, a message with no timestamp — is one object here, where
// producing the same set from a live room would mean six accounts and a real game.
const ROWS_FIXTURE = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/styles.css">
<body><div id="gallery">
  <div class="pane" data-pane="chat"><div id="chatLog"></div></div>
  <ul id="memberList"></ul>
  <table><tbody id="scoreRows"></tbody></table>
  <div id="unclaimedHands"></div>
  <div id="toast"></div>
</div>
<script type="module">
import { chatRow, memberRow, emptyRow, scoreRow, scoreEmptyRow, unclaimedHead, unclaimedRow, toastContent } from '/rows.js';
import { applyIcons } from '/icons.js';
const log = document.getElementById('chatLog');
const ts = Date.UTC(2026, 0, 2, 15, 4);   // fixed: toLocaleTimeString must not drift
for (const [m, opt] of [
  [{ from: 'Ada', text: 'Your turn.', ts }, {}],
  [{ from: 'Ada', text: 'Your turn.', ts }, { mine: true }],
  [{ from: 'Grace', text: 'No timestamp on this one' }, {}],
  [{ from: 'Ada', text: 'A much longer message that has to wrap inside the log column.', ts }, {}],
  [{ from: '', text: '' }, {}],
]) log.appendChild(chatRow(m, opt));
const ul = document.getElementById('memberList');
const MEMBERS = [
  { username: 'pending-player', role: 'player', status: 'pending' },
  { username: 'a-player', role: 'player', status: 'admitted' },
  { username: 'a-helper', role: 'helper', status: 'admitted' },
  { username: 'a-gm', role: 'gm', status: 'admitted' },
  { username: 'the-owner', role: 'owner', status: 'admitted' },
];
for (const m of MEMBERS) ul.appendChild(memberRow(m, { myRank: 0, isSelf: false }));
for (const m of MEMBERS) ul.appendChild(memberRow(m, { myRank: 3, isSelf: false }));
ul.appendChild(memberRow(MEMBERS[1], { myRank: 3, isSelf: true }));
ul.appendChild(emptyRow());
const tb = document.getElementById('scoreRows');
for (const canEdit of [false, true])
  for (const r of [{ label: 'Ada', score: 12 }, { label: '', score: 0 }, { label: 'A very long team name', score: -3 }])
    tb.appendChild(scoreRow(r, 'id', { canEdit }));
tb.appendChild(scoreEmptyRow());
const uh = document.getElementById('unclaimedHands');
uh.appendChild(unclaimedHead());
const present = [['s1', 'Ada'], ['s2', 'Grace']];
uh.appendChild(unclaimedRow(7, 'Ada', { present }));
uh.appendChild(unclaimedRow(8, '', { present }));
uh.appendChild(unclaimedRow(9, 'Solo', { present: [] }));
document.getElementById('toast').append(
  ...toastContent('Hand dropped', 'trash', { label: 'Undo', fn: () => {} }, () => {}),
);
applyIcons(document);
window.__rowsReady = true;
</script></body>`;

// Each scene: drive the real UI, then snapshot a subtree.
const SCENES = [
  {
    name: 'rows',
    page: '/__rows.html',
    root: '#gallery',
    expect: { selector: '.memberRow', min: 11 },
    settle: 250,
    drive: `void 0;`, // the fixture renders itself on import
  },
  {
    name: 'library',
    root: '#libraryModal',
    expect: { selector: '.libCard', min: 40 },
    drive: `
      window.onOttRoom(${STUB_ROOM});
      document.getElementById('lib2Btn').click();
      (await import('/icons.js')).applyIcons();`,
  },
  {
    // Regression guard. The overflow menu is a .pop-group whose shape matches what
    // wirePopGroups claims, so the generic wiring used to attach a SECOND click handler to the
    // trigger: the first opened and portaled the menu, the second read it as already-open and
    // shut it in the same tick. The button looked completely inert. Nothing caught it, because
    // the menu only renders for a custom asset an admin owns — a state no scene reached.
    name: 'library-overflow-open',
    root: '#libraryModal',
    // Desktop opens the portaled popover; a coarse pointer opens the action sheet instead. The
    // assertion is the thing that regressed either way: the trigger opens SOMETHING.
    expect: { selector: '.overflowMenu:not([hidden]), .sheet-backdrop', min: 1 },
    drive: `
      ${BE_ADMIN}
      window.onOttRoom(${STUB_ROOM});
      document.getElementById('lib2Btn').click();
      document.querySelector('.libTab[data-tab="decks"]').click();
      ${WITH_ASSETS}
      (await import('/icons.js')).applyIcons();
      await new Promise((r) => setTimeout(r, 60));
      document.querySelector('.overflowTrigger').click();
      await new Promise((r) => setTimeout(r, 60));`,
  },
  {
    // The other half: dismissing must put the portaled menu BACK in its group. The generic
    // document closer runs first (wirePopGroups wires itself before any card renders), so if it
    // hides the menu where it stands, overflowMenu's own close() early-returns on the hidden
    // flag and never re-parents — leaving a dead menu in <body> for every card ever opened.
    name: 'library-overflow-dismissed',
    root: '#libraryModal',
    expect: { selector: '.pop-group > .overflowMenu', min: 1 },
    drive: `
      ${BE_ADMIN}
      window.onOttRoom(${STUB_ROOM});
      document.getElementById('lib2Btn').click();
      document.querySelector('.libTab[data-tab="decks"]').click();
      ${WITH_ASSETS}
      (await import('/icons.js')).applyIcons();
      await new Promise((r) => setTimeout(r, 60));
      document.querySelector('.overflowTrigger').click();
      await new Promise((r) => setTimeout(r, 60));
      document.getElementById('libraryModal').click();   // dismiss by clicking outside the menu
      await new Promise((r) => setTimeout(r, 60));`,
  },
  {
    // The player's view of the library is the default one (body ships with .not-admin), so this
    // is the admin half: a custom asset in every kind, each carrying Edit and the "..." overflow.
    // Five kinds means a regression in any one of them shows up as a count, not just a diff.
    name: 'library-admin',
    root: '#libraryModal',
    expect: { selector: '.overflowTrigger', min: 5 },
    drive: `
      ${BE_ADMIN}
      window.onOttRoom(${STUB_ROOM});
      document.getElementById('lib2Btn').click();
      ${WITH_ASSETS}
      (await import('/icons.js')).applyIcons();
      await new Promise((r) => setTimeout(r, 60));`,
  },
  {
    // Role-gated table chrome. .gm-only happens to render by default (nothing sets .not-gm until
    // client.js learns your rank), but .admin-only never did, so its markup went unsnapshotted
    // entirely — a change to it could not be seen by this suite at all.
    name: 'table-roles',
    root: 'body',
    expect: { selector: '.admin-only, .gm-only', min: 7 },
    drive: `
      ${BE_ADMIN}
      window.onOttRoom(${STUB_ROOM});
      (await import('/icons.js')).applyIcons();
      await new Promise((r) => setTimeout(r, 60));`,
  },
  {
    name: 'library-swatches-open',
    root: '#libraryModal',
    expect: { selector: '.libCard', min: 40 },
    drive: `
      window.onOttRoom(${STUB_ROOM});
      document.getElementById('lib2Btn').click();
      (await import('/icons.js')).applyIcons();
      document.querySelector('.swatchPop > .pop-trigger').click();`,
  },
];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'coarse-390', width: 390, height: 844, touch: true },
];

const out = {};
const server = await serveDir({
  root: ROOT,
  stubOnly: ['/client.js'], // the engine; editor-panel is what we are exercising
  mounts: { '/shared/': SHARED },
  routes: { '/__rows.html': { body: ROWS_FIXTURE } },
});
const cdp = await launch({ webgl: true });

let bad = 0;
for (const vp of VIEWPORTS)
  for (const scene of SCENES) {
    const page = await newPage(cdp, {
      url: `${server.origin}${scene.page ?? '/table.html'}`,
      width: vp.width,
      height: vp.height,
      touch: vp.touch,
      settle: scene.settle ?? 900, // module graph + Three + the first render
    });
    // A drive that throws is a scene failure, not a suite crash. Before this, a missing element
    // in one scene's setup aborted the whole run with a stack trace, so the scenes after it never
    // reported at all — and the failure read as a broken harness rather than a broken component.
    let drove = true;
    try {
      await page.evaluate(`(async () => { ${scene.drive} })()`);
    } catch (err) {
      console.error(`  FAIL  ${scene.name} @${vp.name}: drive threw — ${err.message}`);
      bad++;
      drove = false;
    }
    await new Promise((r) => setTimeout(r, 500));

    // A harness that reports green on an empty page is worse than no harness.
    const found = await page.evaluate(
      `document.querySelectorAll(${JSON.stringify(scene.expect.selector)}).length`,
    );
    if (drove && found < scene.expect.min) {
      console.error(
        `  FAIL  ${scene.name} @${vp.name}: ${found} ${scene.expect.selector} rendered, ` +
          `expected at least ${scene.expect.min} — fixture broken`,
      );
      bad++;
    }
    if (page.errors.length) {
      console.error(`  FAIL  ${scene.name} @${vp.name}: page raised ${page.errors[0]}`);
      bad++;
    }

    const key = `${scene.name} @${vp.name}`;
    out[key] = JSON.parse(
      await page.evaluate(
        snapshotExpression({ root: scene.root, revealHidden: false, normalizeDataUrls: true }),
      ),
    );
    console.log(
      `  ${key}: ${found} ${scene.expect.selector}, ${Object.keys(out[key]).length} elements`,
    );
    await page.close();
  }

await cdp.close();
server.close();
if (server.missing.length)
  console.log(
    `  (${new Set(server.missing).size} asset paths 404'd: ${[...new Set(server.missing)].slice(0, 3).join(' ')}…)`,
  );

const file = process.argv[2] === '--out' ? process.argv[3] : null;
if (file) {
  await writeFile(file, JSON.stringify(out, null, 0));
  console.log(`wrote ${file}`);
}
if (bad) process.exitCode = 1;
