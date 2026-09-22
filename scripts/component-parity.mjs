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

// A compact specimen page makes visual states deterministic. Product scenes usually contain
// whichever states happen to occur after setup, which left hover-adjacent variants such as
// pressed, busy and disabled effectively untested even after they became shared primitives.
const COMPONENT_STATES_FIXTURE = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/styles.css">
<body><main id="componentStates" class="panel">
  <div class="field-group"><span class="field-label">Buttons</span>
    <div class="button-row">
      <button class="button" id="stateButton">Default</button>
      <button class="button button--primary" id="statePrimary">Primary</button>
      <button class="button button--danger" id="stateDanger">Danger</button>
      <button class="button button--icon" id="stateIcon" aria-label="Icon button">⋯</button>
      <button class="button" id="statePressed" aria-pressed="true">Pressed</button>
      <button class="button" id="stateBusy" aria-busy="true">Busy</button>
      <button class="button" id="stateDisabled" disabled>Disabled</button>
    </div>
  </div>
  <div class="field-group"><label class="field-label" for="stateText">Controls</label>
    <input class="control" id="stateText" type="text" value="Text field">
    <input class="control control--compact" id="stateCompact" type="number" value="12">
    <select class="control control--select" id="stateSelect"><option>Dropdown</option></select>
    <select class="control control--select control--multiselect" id="stateMulti" multiple size="3">
      <option selected>Selected</option><option>Second</option><option>Third</option>
    </select>
    <input class="control" id="stateControlDisabled" type="text" value="Disabled" disabled>
  </div>
  <div class="button-row">
    <label class="checkbox"><input class="checkbox__input" id="stateCheckbox" type="checkbox">Unchecked</label>
    <label class="checkbox"><input class="checkbox__input" id="stateChecked" type="checkbox" checked>Checked</label>
    <label class="checkbox"><input class="checkbox__input" id="stateCheckboxDisabled" type="checkbox" disabled>Disabled</label>
  </div>
  <p class="help-text">Shared supporting text</p>
  <p class="status-text" role="status">Shared live status</p>
</main></body>`;

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
    name: 'component-states',
    page: '/__component-states.html',
    root: '#componentStates',
    expect: { selector: '.button, .control, .checkbox__input', min: 15 },
    settle: 250,
    drive: `
      const assert = (ok, message) => { if (!ok) throw new Error(message); };
      const style = (id) => getComputedStyle(document.getElementById(id));
      const normal = style('stateButton');
      const primary = style('statePrimary');
      const danger = style('stateDanger');
      const icon = style('stateIcon');
      const pressed = style('statePressed');
      const busy = style('stateBusy');
      const disabled = style('stateDisabled');
      assert(normal.fontFamily === style('stateText').fontFamily,
        'Buttons and controls do not share typography');
      assert(primary.borderTopColor !== normal.borderTopColor,
        'Primary button does not have a distinct border');
      assert(danger.color !== normal.color, 'Danger button does not have a distinct color');
      assert(icon.minWidth === '0px' && icon.paddingTop !== normal.paddingTop,
        'Icon button does not use the compact icon treatment');
      assert(pressed.borderTopColor === primary.borderTopColor,
        'Pressed state does not use the primary accent');
      assert(busy.cursor === 'progress', 'Busy button does not use the progress cursor');
      assert(disabled.cursor === 'not-allowed' && +disabled.opacity < +normal.opacity,
        'Disabled button is not visibly disabled');
      const input = style('stateText');
      const select = style('stateSelect');
      const multi = style('stateMulti');
      assert(input.backgroundColor === select.backgroundColor &&
        input.borderTopColor === select.borderTopColor,
        'Text fields and dropdowns do not share their base treatment');
      assert(select.backgroundImage !== 'none' && multi.backgroundImage === 'none',
        'Dropdown or multiselect indicator treatment regressed');
      assert(parseFloat(style('stateCompact').minHeight) < parseFloat(input.minHeight),
        'Compact control is not smaller than the base control');
      assert(style('stateControlDisabled').cursor === 'not-allowed' &&
        +style('stateControlDisabled').opacity < +input.opacity,
        'Disabled control is not visibly disabled');
      assert(style('stateChecked').backgroundColor !== style('stateCheckbox').backgroundColor,
        'Checked checkbox is not visually distinct');
      assert(style('stateCheckboxDisabled').cursor === 'not-allowed' &&
        +style('stateCheckboxDisabled').opacity < +style('stateCheckbox').opacity,
        'Disabled checkbox is not visibly disabled');`,
  },
  {
    name: 'collider-editor',
    root: '.compoundEditor',
    expect: { selector: '.compoundEditor .button, .compoundEditor .control', min: 20 },
    drive: `
      const assert = (ok, message) => { if (!ok) throw new Error(message); };
      const wait = async (test) => {
        for (let i = 0; i < 200; i++) {
          if (test()) return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error('Collider editor did not become ready');
      };
      const { openColliderEditor } = await import('/compound-collider-editor.js');
      window.__componentParityCollider = openColliderEditor({
        source: '/models/pieces/chess/rook.glb',
        box: [0.5, 0.5, 0.5],
        value: { version: 1, shapes: [
          { type: 'box', position: [0, 0, 0], rotation: [0, 0, 0], size: [0.7, 0.8, 0.7] },
          { type: 'outline', position: [0, -0.4, 0], rotation: [0, 0, 0],
            size: [0.9, 0.05, 0.9], outline: { type: 'clipped', cut: 0.18 } },
        ] },
      });
      await wait(() => document.querySelector('.compoundEditor [data-action="apply"]:not(:disabled)'));
      const dialog = document.querySelector('.compoundEditor');
      assert(dialog.matches('dialog.modal'), 'Collider editor does not use the shared modal shell');
      for (const selector of ['.modal__header', '.modal__title', '.modal__close',
        '.modal__body', '.modal__footer', '.button-row', '.field-group', '.field-label',
        '.help-text', '.status-text'])
        assert(dialog.querySelector(selector), 'Collider editor is missing ' + selector);
      for (const button of dialog.querySelectorAll('button:not(.modal__close)'))
        assert(button.classList.contains('button'),
          'Generated button lacks .button: ' + button.outerHTML.slice(0, 160));
      for (const button of dialog.querySelectorAll('button[data-icon]'))
        assert(button.classList.contains('button--icon'), 'Icon button lacks .button--icon');
      assert(dialog.querySelector('[data-action="apply"]').classList.contains('button--primary'),
        'Apply action lacks .button--primary');
      assert(dialog.querySelector('[data-action="clear"]').classList.contains('button--danger'),
        'Clear action lacks .button--danger');
      for (const control of dialog.querySelectorAll('input:not([type="checkbox"]), select'))
        assert(control.classList.contains('control'), 'Generated field lacks .control');
      for (const select of dialog.querySelectorAll('select:not([multiple])'))
        assert(select.classList.contains('control--select'), 'Dropdown lacks .control--select');
      const list = dialog.querySelector('select[multiple]');
      assert(list.classList.contains('control--select') &&
        list.classList.contains('control--multiselect'),
        'Shape list lacks the shared multiselect variants');
      const orbit = dialog.querySelector('[data-drag-mode="orbit"]');
      const move = dialog.querySelector('[data-drag-mode="move"]');
      assert(orbit.getAttribute('aria-pressed') === 'true', 'Default drag mode is not pressed');
      move.click();
      assert(move.getAttribute('aria-pressed') === 'true' &&
        orbit.getAttribute('aria-pressed') === 'false', 'Pressed drag mode did not move');
      const undo = dialog.querySelector('[data-action="undo"]');
      assert(undo.disabled && getComputedStyle(undo).cursor === 'not-allowed',
        'Initial undo action is not visibly disabled');
      assert(!dialog.querySelector('.ico-missing'), 'Collider editor contains a missing icon');`,
  },
  {
    name: 'modal-anatomy',
    root: '#settingsModal',
    expect: { selector: '.modal__header, .modal__body', min: 2 },
    drive: `
      const ids = ['settingsModal', 'roomSettingsModal', 'controlsModal',
        'libraryModal', 'addModal', 'sceneSaveModal'];
      for (const id of ids) {
        const backdrop = document.getElementById(id);
        const modal = backdrop.querySelector(':scope > .modal');
        if (!backdrop.classList.contains('modal-backdrop') || !modal ||
            !modal.querySelector('.modal__header') || !modal.querySelector('.modal__title') ||
            !modal.querySelector('.modal__close') || !modal.querySelector('.modal__body'))
          throw new Error(id + ' does not use the shared modal anatomy');
      }
      const sceneName = document.getElementById('sceneSaveName');
      if (!sceneName.closest('.field-group')?.querySelector('.field-label'))
        throw new Error('Scene save name does not use the shared field layout');
      for (const row of document.querySelectorAll('#addModal .saveFoot .row, .lightingActions'))
        if (!row.classList.contains('button-row') || !row.classList.contains('button-row--end'))
          throw new Error('Action row does not use the shared button-row layout');
      document.getElementById('settingsModal').hidden = false;`,
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
      const { applyIcons, setIcon } = await import('/icons.js');
      applyIcons();
      document.body.classList.remove('ui-full');
      document.getElementById('roomGrp').hidden = false;
      const timerLabel = document.querySelector('#timerBtn .lbl');
      if (getComputedStyle(timerLabel).display === 'none')
        throw new Error('Compact UI hides the timer value');
      const reset = document.getElementById('roomReset');
      const resetStyle = getComputedStyle(reset);
      const divider = getComputedStyle(reset, '::before');
      if (resetStyle.borderTopColor !== resetStyle.borderRightColor ||
          divider.position !== 'absolute' || divider.height !== '1px')
        throw new Error('Reset divider is part of the danger button border');
      const saveButton = document.getElementById('roomSaveState');
      if (!saveButton.querySelector(':scope > .ico'))
        throw new Error('Save Table is missing its Tabler icon');
      setIcon(saveButton, 'square-check');
      if (saveButton.querySelector(':scope > .ico > use')?.getAttribute('href') !== '#i-square-check' ||
          document.getElementById('i-square-check') === null)
        throw new Error('Save Table success icon is unavailable');
      await new Promise((r) => setTimeout(r, 60));`,
  },
  {
    name: 'lighting-panel',
    root: '#roomSettingsModal',
    expect: { selector: '#lightingGlobe, .lightingControl', min: 4 },
    drive: `
      const core = await import('/core.js');
      core.applyLighting({ preset: 'custom', azimuth: 275, elevation: 25,
        keyIntensity: 1.4, keyColor: '#ff9955', ambientIntensity: 0.4,
        ambientColor: '#667799', shadowSoftness: 0.2 }, { duration: 0 });
      if (core.getLighting().azimuth !== 275) throw new Error('lighting preview did not apply');
      document.getElementById('roomSettingsModal').hidden = false;
      document.querySelectorAll('#roomSettingsModal .libPane').forEach((pane) =>
        pane.hidden = pane.dataset.pane !== 'lighting');
      document.querySelectorAll('#roomSettingsModal .libTab').forEach((tab) =>
        tab.classList.toggle('on', tab.dataset.tab === 'lighting'));
      (await import('/icons.js')).applyIcons();`,
  },
  {
    name: 'scene-save-options',
    root: '#sceneSaveModal',
    expect: { selector: '#sceneSaveName, #sceneIncludeLighting, #sceneSaveConfirm', min: 3 },
    drive: `
      ${BE_ADMIN}
      window.onOttRoom(${STUB_ROOM});
      document.getElementById('sceneSaveBtn').click();`,
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
  routes: {
    '/__rows.html': { body: ROWS_FIXTURE },
    '/__component-states.html': { body: COMPONENT_STATES_FIXTURE },
  },
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
