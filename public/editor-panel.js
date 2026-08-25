// editor-panel.js — the admin library-management panel (loaded on the table; its asset-creation UI is admin-gated). It rides
// on the table engine's room connection, handed over by client.js via
// window.onOttRoom, and gets asset lists via window.onLibraryList (client.js fans
// the deckList/boardList/propList messages out to here, so the modal saved-lists
// keep working too). In the editor the admin sees private assets as well as public.
import { cardPreviewURL, propPreviewURL, boardPreviewURL, procBoardTexURL, diePreviewURL, uploadImage, uploadModel, measureImage, measureBoard, measureModel, glbFilePreviewURL, parseCardFront } from './graphics.js';
import * as THREE from 'three';

// Library edit/clone state. openEditModal() sets it; the Add form's Save reads it.
//   { id }        → Save UPDATES that asset (Edit)
//   { id: null }  → Save CREATES a new asset (Clone — user must enter a fresh name)
let editCtx = null;
const FILLERS = {}; // kind → fn(it, clone) that pre-fills the Add form (registered by wireAddObject/wireAddBoard)
function openEditModal(kind, it, clone) {
  if (kind === 'deck') return openDeckEdit(it, clone); // decks fetch their cards first (async), then fill
  editCtx = { kind, id: clone ? null : it.id, model: kind === 'prop' ? (it.props && it.props.model) : it.model, tex: it.tex };
  const modal = byId('addModal'); if (!modal) return;
  openAddModal();
  const tab = kind === 'prop' ? 'objects' : (it.model ? 'modelboards' : 'imgboards'); // boards split into two tabs
  const tb = modal.querySelector(`.libTab[data-tab="${tab}"]`);
  if (tb) tb.click(); // switch to the right tab via wireTabs
  const fill = FILLERS[kind]; if (fill) fill(it, clone);
  focusAddModal();
}
let pendingDeck = null; // deck Edit/Clone fetches the deck's cards first, then fills the form on the deckData response
function openDeckEdit(it, clone) {
  const modal = byId('addModal'); if (!modal) return;
  openAddModal();
  pendingDeck = { it, clone };
  ROOM.send('getDeck', { id: it.id });
  focusAddModal();
}
import { DIE_SIDES, PROP_LIST, BOARDS, COLORS, PROPS, DISPENSER_LIST, DISPENSERS, PALETTE, PALETTES, STARTER_LIST, standMode, geomFromImage, TILES, HEX_HH } from '/shared/pieces.js';

// Card/tile thickness for an image deck, as a multiple of a standard card, read from the editor's
// slider → a world HALF-thickness for geom.t. 1× = a thin card; higher = a chunky tile.
const cardThickHalf = () => +(TILES.card.t * (+byId('adImgThick').value || 1)).toFixed(4);
const setThickSlider = (tHalf) => {
  const m = tHalf ? Math.max(1, Math.min(8, Math.round((tHalf / TILES.card.t) * 2) / 2)) : 1;
  byId('adImgThick').value = m; byId('adImgThickVal').textContent = m + '×';
};

// The image-deck card SHAPE picker (segmented chips): 'rounded' | 'square' | 'hex'.
const imgShape = () => byId('adImgShape').querySelector('.seg.on')?.dataset.shape || 'rounded';
const setImgShape = (s) => byId('adImgShape').querySelectorAll('.seg').forEach(b => b.classList.toggle('on', b.dataset.shape === (s || 'rounded')));
// Fold the picked shape into a fitted geom: square = no corner radius; hexagon = a regular POINTY-TOP
// hex (circumradius R stored as `h`, half-width pinned to R·√3/2); rounded = keep the measured radius.
const applyShapeToGeom = (geom) => {
  const s = imgShape();
  if (s === 'square') return { ...geom, shape: 'rect', round: 0 };
  if (s === 'hex') { const R = geom.w; return { ...geom, shape: 'hex', round: 0, w: +(R * HEX_HH).toFixed(4), h: R }; }
  return { ...geom, shape: 'rect' };
};
// Which chip to show when re-opening a saved image deck.
const shapeOfGeom = (geom) => geom && geom.shape === 'hex' ? 'hex' : (geom && geom.round === 0 ? 'square' : 'rounded');
const byId = (id) => document.getElementById(id);
const ICON_FOR = { 'Spawn': 'square-rounded-plus', 'Apply': 'checks', 'Set up': 'go-game', 'Edit': 'edit', 'Clone': 'copy', 'Rename': 'cursor-text', 'Delete': 'trash', 'Publish': 'flag-check', 'Unpublish': 'flag-cancel' };
const btn = (label, fn, cls) => { const button = document.createElement('button'); button.type = 'button'; const ic = ICON_FOR[label]; if (ic) { button.dataset.icon = ic; button.innerHTML = '<span class="lbl">' + label + '</span>'; } else button.textContent = label; if (cls) button.className = cls; button.onclick = fn; return button; };
// ---- Add-to-Library modal: dialog open/close with focus management ----
let addReturn = null; // the control to restore focus to when the dialog closes
const focusablesIn = (el) => [...el.querySelectorAll('a[href], button, input, textarea, select, [tabindex]')]
  .filter((n) => !n.disabled && n.tabIndex !== -1 && n.type !== 'hidden' && n.getClientRects().length);
function openAddModal() { const m = byId('addModal'); if (!m) return null; if (m.hidden) addReturn = document.activeElement; m.hidden = false; return m; }
function focusAddModal() { const m = byId('addModal'); if (!m || m.hidden) return; (m.querySelector('.libTab.on') || focusablesIn(m)[0] || m).focus(); }
function closeAddModal() { const m = byId('addModal'); if (!m || m.hidden) return; m.hidden = true; editCtx = null; const r = addReturn; addReturn = null; if (r && r.focus) r.focus(); }
function trapTab(e, m) { const f = focusablesIn(m); if (!f.length) return; const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }

// Reveal one tabbed pane at a time, scoped to a modal (so multiple tabbed modals don't collide).
// When the tabs carry role="tab" (the Add modal), also maintain aria-selected + roving tabindex and
// arrow-key navigation; the other tabbed modals keep the plain class/hidden behavior unchanged.
function wireTabs(root) {
  const tabs = [...root.querySelectorAll('.libTab')];
  const aria = !!(tabs[0] && tabs[0].getAttribute('role') === 'tab');
  const select = (tab) => {
    tabs.forEach((t) => { const on = t === tab; t.classList.toggle('on', on); if (aria) { t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1; } });
    root.querySelectorAll('.libPane').forEach((pane) => { pane.hidden = pane.dataset.pane !== tab.dataset.tab; });
    root.querySelectorAll('.libList.selecting').forEach((ul) => { ul.classList.remove('selecting'); ul.querySelectorAll('.libCard.sel').forEach((c) => c.classList.remove('sel')); });
    if (root._resetSelect) root._resetSelect();
    if (root._applySearch) root._applySearch(); // re-filter the newly shown pane
  };
  tabs.forEach((tab, i) => {
    tab.onclick = () => select(tab);
    if (aria) tab.onkeydown = (e) => {
      let j = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = tabs.length - 1;
      if (j >= 0) { e.preventDefault(); select(tabs[j]); tabs[j].focus(); }
    };
  });
}
// A per-modal controls row (multi-select buttons + divider + search), pinned in the sticky header.
// Everything acts on the currently visible tab's list, found fresh each time via activeUl().
function wireControls(root) {
  const tabs = root.querySelector('.libTabs');
  if (!tabs || root.querySelector('.libControls')) return;
  const row = document.createElement('div'); row.className = 'libControls';
  const sel = document.createElement('button'); sel.type = 'button'; sel.className = 'chip selToggle'; sel.dataset.icon = 'new-section'; sel.innerHTML = '<span class="lbl">Select</span>';
  const go = document.createElement('button'); go.type = 'button'; go.className = 'spawnSelBtn'; go.dataset.icon = 'category-plus'; go.innerHTML = '<span class="lbl">Spawn selected</span>'; go.hidden = true;
  const divider = document.createElement('div'); divider.className = 'libDivider';
  const wrap = document.createElement('div'); wrap.className = 'libSearchWrap';
  const inp = document.createElement('input'); inp.type = 'search'; inp.className = 'libSearch'; inp.placeholder = 'Search\u2026';
  wrap.append(inp);
  row.append(sel, go, divider, wrap); tabs.after(row);
  const activeUl = () => { const pane = [...root.querySelectorAll('.libPane')].find((p) => !p.hidden); return pane ? pane.querySelector('.libList') : null; };
  sel.onclick = () => {
    const ul = activeUl(); if (!ul) return;
    const on = ul.classList.toggle('selecting'); sel.classList.toggle('on', on); go.hidden = !on;
    if (!on) ul.querySelectorAll('.libCard.sel').forEach((c) => c.classList.remove('sel'));
  };
  go.onclick = () => { const ul = activeUl(); if (ul) ul.querySelectorAll('.libCard.sel').forEach((c) => c._spawn && c._spawn()); };
  root._resetSelect = () => { sel.classList.remove('on'); go.hidden = true; };
  root._applySearch = () => {
    const q = inp.value.trim().toLowerCase();
    const ul = activeUl(); if (!ul) return;
    ul.querySelectorAll('.libCard').forEach((card) => {
      const name = (card.querySelector('.libName')?.textContent || '').toLowerCase();
      card.style.display = (!q || name.includes(q)) ? '' : 'none';
    });
  };
  inp.oninput = root._applySearch;
}

// ---- Spawn cards: quantity + color, and multi-select batch spawn ----------
// PALETTE and the alternate palettes (PALETTES, e.g. metals) now live in shared/pieces.js so the
// recolor/inspect swatches use the same colors and constraints. Team pieces use COLORS.team.
// Legible die-number color for a face color (dark face → light numbers).
const contrast = (hex) => { const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255; return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5 ? 0xf4f1ea : 0x141414; };
const hexStr = (h) => '#' + (h >>> 0).toString(16).padStart(6, '0').slice(-6);
function swatchEl(hex) {
  const sw = document.createElement('button'); sw.type = 'button';
  sw.className = 'swatch' + (hex == null ? ' neutral' : '');
  if (hex != null) sw.style.background = hexStr(hex);
  return sw;
}
// Compact − / + quantity field (reuses the .stepper look); .get() → 1..99.
function qtyStepper() {
  const wrap = document.createElement('span'); wrap.className = 'stepper qtyStep';
  const inp = document.createElement('input'); inp.type = 'number'; inp.min = '1'; inp.max = '99'; inp.value = '1';
  const clamp = (v) => Math.max(1, Math.min(99, (v | 0) || 1));
  const step = (d) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'stepBtn'; b.textContent = d < 0 ? '\u2212' : '+'; b.tabIndex = -1; b.onclick = () => { inp.value = clamp((+inp.value || 1) + d); }; return b; };
  wrap.append(step(-1), inp, step(1));
  wrap.get = () => clamp(+inp.value || 1);
  return wrap;
}
// A labelled stack-size field for dispensers: how many items the stack starts with
// (distinct from qtyStepper's "how many dispensers to spawn"). .get() → 1..max.
function countStepper(def, max) {
  const wrap = document.createElement('span'); wrap.className = 'stepper qtyStep';
  const cap = document.createElement('span'); cap.className = 'miniLabel stepCap'; cap.textContent = 'Amount';
  const inp = document.createElement('input'); inp.type = 'number'; inp.min = '1'; inp.max = String(max); inp.value = String(def);
  const clamp = (v) => Math.max(1, Math.min(max, (v | 0) || def));
  const step = (d) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'stepBtn'; b.textContent = d < 0 ? '−' : '+'; b.tabIndex = -1; b.onclick = () => { inp.value = clamp((+inp.value || def) + d); }; return b; };
  wrap.append(cap, step(-1), inp, step(1));
  wrap.get = () => clamp(+inp.value || def);
  return wrap;
}
// One spawnable card: preview + title + quantity + optional color + Spawn.
// send(colorProps) fires a single spawn; the card supplies quantity + color.
// color: 'palette' | 'team' | 'own' | 'none'. li._spawn() is used for batch spawn.
function spawnCard({ preview, title, badge, send, color = 'none', teamName, dice = false, swatches, count, snapDefault = false, stand = null, standOn = false, extraActs = [] }) {
  const li = document.createElement('li'); li.className = 'libCard';
  const name = document.createElement('span'); name.className = 'libName'; name.textContent = title;
  const meta = document.createElement('div'); meta.className = 'libMeta'; meta.append(name); if (badge) meta.append(badge);

  const ctrls = document.createElement('div'); ctrls.className = 'cardCtrls';
  const qty = qtyStepper(); ctrls.append(qty);
  const stack = count ? countStepper(count.def, count.max) : null; if (stack) ctrls.append(stack); // dispenser stack size

  let getColor = () => null, getTeam = () => null;
  const pickRow = (items, onPick) => {
    const row = document.createElement('div'); row.className = 'swatchRow';
    const sws = items.map((it, i) => {
      const sw = swatchEl(it.hex); sw.title = it.name; if (i === 0) sw.classList.add('on');
      sw.onclick = () => { sws.forEach((s) => s.classList.remove('on')); sw.classList.add('on'); onPick(it, i); };
      row.append(sw); return sw;
    });
    return row;
  };
  if (color === 'team') {
    if (!COLORS.team[teamName]) console.warn(`spawnCard: no colors for team "${teamName}" — check the piece's PROPS.team and COLORS.team`);
    const cols = COLORS.team[teamName] || [0x888888, 0x222222];
    let idx = 0; getTeam = () => idx;
    ctrls.append(pickRow(cols.map((c, i) => ({ hex: c, name: 'Set ' + (i + 1) })), (_it, i) => { idx = i; }));
  } else if (color === 'palette' || color === 'own') {
    const pal = PALETTES[swatches] || PALETTE;
    let col = pal[0].hex;   // default to the first swatch (null for the Neutral-led default palette)
    const row = pickRow(pal, (it) => { col = it.hex; });
    if (color === 'own') {
      row.hidden = true;
      const tog = document.createElement('button'); tog.type = 'button'; tog.className = 'chip chk on ownTog'; tog.textContent = 'Own colors';
      tog.onclick = () => { row.hidden = tog.classList.toggle('on'); };
      getColor = () => (tog.classList.contains('on') ? null : col);
      ctrls.append(tog, row);
    } else {
      getColor = () => col; ctrls.append(row);
    }
  }

  // Per-piece snap-to-grid at spawn — on by default for the grid games (go / checkers /
  // chess), off for everything else; toggle it either way. Inert until a grid is on.
  const snapTog = document.createElement('button'); snapTog.type = 'button';
  snapTog.className = 'chip chk snapTog' + (snapDefault ? ' on' : '');
  snapTog.dataset.icon = 'grid-3x3'; snapTog.innerHTML = '<span class="lbl">Snap</span>'; snapTog.title = 'Spawn this piece with snap-to-grid on';
  snapTog.onclick = () => snapTog.classList.toggle('on');
  ctrls.append(snapTog);

  // Stand toggle: spawn the piece in its natural orientation (upright for tall pieces, flat for
  // discs) instead of letting it tumble. `stand` is that natural mode ('flat' | true); null hides
  // the toggle (dice/decks). On by default for shapes that stand naturally (chess/checkers/…).
  const standTog = stand ? document.createElement('button') : null;
  if (standTog) {
    standTog.type = 'button';
    standTog.className = 'chip chk standTog' + (standOn ? ' on' : '');
    standTog.dataset.icon = 'arrow-big-up-line'; standTog.innerHTML = '<span class="lbl">Stand</span>'; standTog.title = 'Spawn upright / flat (its natural pose); off = free to tumble';
    standTog.onclick = () => standTog.classList.toggle('on');
    ctrls.append(standTog);
  }

  li._spawn = () => {
    const n = qty.get(); const cp = {};
    const color = getColor(); if (color != null) { cp.color = color; if (dice) cp.textColor = contrast(color); }
    const team = getTeam(); if (team != null) cp.team = team;
    if (stack) cp.count = stack.get();
    cp.snap = snapTog.classList.contains('on');
    if (standTog) cp.stand = standTog.classList.contains('on') ? stand : false; // natural pose, or free to tumble
    for (let i = 0; i < n; i++) send(cp);
  };

  const acts = document.createElement('div'); acts.className = 'actions';
  acts.append(btn('Spawn', () => li._spawn()), ...extraActs);
  li.append(preview, meta, ctrls, acts);
  return li;
}
// A tab's multi-select bar (Select toggle + "Spawn selected"), injected once
// before the card list. In select mode, clicking a card highlights it.
function spawnBar(ul) {
  if (ul._selWired) return; ul._selWired = true; // the Select/Spawn buttons live in the sticky controls row now
  ul.addEventListener('click', (e) => {
    if (!ul.classList.contains('selecting')) return;
    if (e.target.closest('.cardCtrls') || e.target.closest('.actions')) return; // let qty/color clicks through
    const card = e.target.closest('.libCard'); if (card && card._spawn) card.classList.toggle('sel');
  });
}

let ROOM = null;
const LIST_UL = { deck: 'libDecks', board: 'libBoards', prop: 'libProps', scene: 'libScenes', sky: 'libSky' };
const spawnOf = {
  deck: (it) => ROOM.send('loadDeck', { id: it.id }),
  board: (it) => ROOM.send('loadBoard', { id: it.id }),
  prop: (it) => ROOM.send('spawn', { type: 'prop', props: it.props }),
};

// A lazy-loaded thumbnail <img> (optional extra class), and an async filler that
// drops one into a preview box, marking the box `.empty` if the promise yields nothing.
const thumbImg = (src, cls) => { const im = document.createElement('img'); im.className = 'libThumb' + (cls ? ' ' + cls : ''); im.loading = 'lazy'; if (src) im.src = src; return im; };
const fillAsync = (box, promise) => { const im = thumbImg(); box.append(im); promise.then((u) => { if (u) im.src = u; else box.classList.add('empty'); }).catch(() => box.classList.add('empty')); };

// Build the preview image(s) for a card. Decks show back + first-front; skyboxes,
// boards and props show a thumbnail (boards/props render async); scenes get a glyph.
function previewEl(kind, it) {
  const wrap = document.createElement('div'); wrap.className = 'libPreview';
  if (kind === 'deck') {
    wrap.classList.add('deckPreview');
    wrap.append(thumbImg(cardPreviewURL(it.back), 'back'), thumbImg(cardPreviewURL(it.first), 'front'));
  } else if (kind === 'sky') {
    let src = it.url;
    if (typeof src === 'string' && src[0] === '{') { try { src = JSON.parse(src).f[0]; } catch { src = null; } } // cubemap → first face
    wrap.append(thumbImg(src));
  } else if (kind === 'board') {
    fillAsync(wrap, boardPreviewURL(it.preview));
  } else if (kind === 'prop') {
    fillAsync(wrap, propPreviewURL(it.props || {}));
  } else { // scene — no single image
    wrap.classList.add('empty'); wrap.textContent = '🎬';
  }
  return wrap;
}

function renderList(kind, list) {
  const ul = byId(LIST_UL[kind]); if (!ul) return;
  ul.replaceChildren();
  if (kind === 'prop' || kind === 'deck') spawnBar(ul); // quantity + color + multi-select for spawnable assets
  if (!list.length) { const li = document.createElement('li'); li.className = 'libEmpty'; li.textContent = 'None yet.'; ul.appendChild(li); return; }
  for (const it of list) {
    const badge = document.createElement('span'); badge.className = 'libBadge ' + (it.isPublic ? 'pub' : 'priv'); badge.textContent = it.isPublic ? 'public' : 'private';
    const isEditor = !!byId('addModal'); // Edit/Clone need the editor's Add modal — hidden at the table where clicking them does nothing
    const canEdit = kind === 'prop' || kind === 'board' || kind === 'deck'; // objects, boards, and (limited) decks round-trip through the Add form
    const adminActs = window.OTT_IS_ADMIN ? [ // curation is site-admin only; GMs/helpers just spawn/apply
      ...(isEditor && canEdit ? [btn('Edit', () => openEditModal(kind, it, false)), btn('Clone', () => openEditModal(kind, it, true))] : []),
      btn(it.isPublic ? 'Unpublish' : 'Publish', () => ROOM.send('assetPublic', { kind, id: it.id, isPublic: !it.isPublic })),
      btn('Rename', () => { const n = prompt('Rename:', it.name); if (n && n.trim()) ROOM.send('assetRename', { kind, id: it.id, name: n.trim() }); }),
      btn('Delete', () => { if (confirm(`Delete "${it.name}"? This cannot be undone.`)) ROOM.send('assetDelete', { kind, id: it.id }); }, 'danger'),
    ] : [];

    if (kind === 'prop' || kind === 'deck') { // spawnable: quantity + color + multi-select
      const extra = kind === 'deck' && it.count != null ? ` \u00b7 ${it.count}` : '';
      ul.appendChild(spawnCard({
        preview: previewEl(kind, it), title: it.name + extra, badge, extraActs: adminActs,
        color: kind === 'prop' ? 'own' : 'none',  // custom objects: default to their own material; decks never tint
        stand: kind === 'prop' ? true : null, standOn: false, // custom models: a Stand-upright toggle, off by default (free to tumble)
        send: kind === 'deck'
          ? () => ROOM.send('loadDeck', { id: it.id })
          : (cp) => ROOM.send('spawn', { type: 'prop', props: { ...it.props, ...cp } }),
      }));
    } else { // board / scene / sky — one action, no quantity/color
      const extra = kind === 'board' && it.kind ? ` \u00b7 ${it.kind}` : (kind === 'sky' && typeof it.url === 'string' && it.url[0] === '{' ? ' \u00b7 cube' : '');
      const li = document.createElement('li'); li.className = 'libCard';
      const name = document.createElement('span'); name.className = 'libName'; name.textContent = it.name + extra;
      const meta = document.createElement('div'); meta.className = 'libMeta'; meta.append(name, badge);
      const acts = document.createElement('div'); acts.className = 'actions';
      const primary = kind === 'scene'
        ? btn('Load', () => { if (confirm(`Load "${it.name}" into the editor? This clears the current table.`)) ROOM.send('sceneLoad', { id: it.id }); })
        : kind === 'sky' ? btn('Apply', () => ROOM.send('skybox', { url: it.url }))
        : btn('Spawn', () => spawnOf[kind](it));
      acts.append(primary, ...adminActs);
      li.append(previewEl(kind, it), meta, acts);
      ul.appendChild(li);
    }
  }
  const lp = byId('libraryPanel'); if (lp && lp._applySearch) lp._applySearch();
}

// client.js fans the three list messages here (and still renders the modal saved-lists).
const listCache = {};
window.onLibraryList = (kind, list) => { listCache[kind] = list; renderList(kind, list); if (kind === 'sky') { const m = byId('skyPickModal'); if (m && !m.hidden) renderSkyPick(); } };
window.onLibraryAdmin = () => { for (const k in listCache) renderList(k, listCache[k]); }; // admin status arrived → re-render

// ---- built-in library (read-only: spawn the bundled pieces) ----------------
// One card, with a preview node and a Spawn/Apply button.
function builtinCard(previewNode, title, label, fn) {
  const li = document.createElement('li'); li.className = 'libCard';
  const meta = document.createElement('div'); meta.className = 'libMeta';
  const name = document.createElement('span'); name.className = 'libName'; name.textContent = title;
  meta.append(name);
  const acts = document.createElement('div'); acts.className = 'actions'; acts.append(btn(label, fn));
  li.append(previewNode, meta, acts);
  return li;
}
const previewBox = (extraClass) => { const w = document.createElement('div'); w.className = 'libPreview' + (extraClass ? ' ' + extraClass : ''); return w; };
// The url a built-in sky applies: a cubemap JSON blob, or its plain equirect url.
const skyRef = (s) => s.faces ? JSON.stringify({ t: 'cube', f: s.faces }) : (s.url || '');

function renderBuiltin() {
  const dice = byId('biDice'); dice.replaceChildren(); spawnBar(dice);
  for (const sides of DIE_SIDES) {
    const box = previewBox(); box.append(thumbImg(diePreviewURL(sides)));
    dice.append(spawnCard({ preview: box, title: 'd' + sides, color: 'palette', dice: true,
      send: (cp) => ROOM.send('spawn', { type: 'die', props: { sides, ...cp } }) }));
  }

  const decks = byId('biDecks'); decks.replaceChildren(); spawnBar(decks);
  { const box = previewBox('deckPreview'); box.append(thumbImg(cardPreviewURL('back')), thumbImg(cardPreviewURL('rank:A:\u2660:#000')));
    decks.append(spawnCard({ preview: box, title: 'Standard 52-card', color: 'none',
      send: () => ROOM.send('spawn', { type: 'deck', props: {} }) })); }
  { const box = previewBox('deckPreview'); box.append(thumbImg(cardPreviewURL('joker:#bd2500')), thumbImg(cardPreviewURL('rank:A:\u2660:#000')));
    decks.append(spawnCard({ preview: box, title: 'Standard 54 (with Jokers)', color: 'none',
      send: () => ROOM.send('spawn', { type: 'deck', props: { jokers: true } }) })); }
  { const box = previewBox('deckPreview'); box.append(thumbImg(cardPreviewURL('domino:6:3')), thumbImg(cardPreviewURL('domino:5:5')));
    decks.append(spawnCard({ preview: box, title: 'Dominoes (double-six)', color: 'none',
      send: () => ROOM.send('spawn', { type: 'deck', props: { set: 'domino' } }) })); } // a boneyard on its own — no table-clear/deal
  { const box = previewBox('deckPreview'); box.append(thumbImg(cardPreviewURL('letter:Q:10')), thumbImg(cardPreviewURL('letter:E:1')));
    decks.append(spawnCard({ preview: box, title: 'Word tiles (letter bag)', color: 'none',
      send: () => ROOM.send('spawn', { type: 'deck', props: { set: 'letter' } }) })); } // the 100-tile bag on its own
  { const box = previewBox('deckPreview'); box.append(thumbImg(cardPreviewURL('/mahjong/faces/dragR.png')), thumbImg(cardPreviewURL('/mahjong/faces/cir5.png')));
    decks.append(spawnCard({ preview: box, title: 'Mahjong wall (144)', color: 'none',
      send: () => ROOM.send('spawn', { type: 'deck', props: { set: 'mahjong' } }) })); } // the full wall on its own

  const boards = byId('biBoards'); boards.replaceChildren();
  for (const key of Object.keys(BOARDS)) {
    const box = previewBox();
    fillAsync(box, BOARDS[key].proc ? Promise.resolve(procBoardTexURL(key)) : boardPreviewURL(BOARDS[key].model)); // proc boards paint their own preview
    boards.append(builtinCard(box, BOARDS[key].name, 'Spawn', () => ROOM.send('spawn', { type: 'board', props: { board: key } })));
  }

  // One-click starter games (table only; GM+). Loading one clears the table, so confirm first.
  const games = byId('biGames'); if (games) { games.replaceChildren();
    const gamePreview = { chess: BOARDS.chess.model, checkers: BOARDS.chess.model, go: BOARDS.go.model };
    for (const g of STARTER_LIST) {
      const box = previewBox();
      if (gamePreview[g.id]) fillAsync(box, boardPreviewURL(gamePreview[g.id]));
      else if (g.id === 'dominoes') box.append(thumbImg(cardPreviewURL('domino:6:3')), thumbImg(cardPreviewURL('domino:5:5')));
      else if (g.id === 'wordy') box.append(thumbImg(cardPreviewURL('letter:W:4')), thumbImg(cardPreviewURL('letter:A:1')));
      else if (g.id === 'mahjong') box.append(thumbImg(cardPreviewURL('/mahjong/faces/dragR.png')), thumbImg(cardPreviewURL('/mahjong/faces/bam1.png')));
      else box.append(thumbImg(cardPreviewURL('rank:A:\u2660:#000')), thumbImg(cardPreviewURL('joker:#bd2500'))); // poker
      games.append(builtinCard(box, g.name, 'Set up', () => {
        if (confirm(`Set up ${g.name}? This clears the current table.`)) ROOM.send('loadStarter', { game: g.id });
      }));
    }
  }

  const objs = byId('biObjects'); objs.replaceChildren(); spawnBar(objs);
  for (const p of PROP_LIST) {
    const box = previewBox(); fillAsync(box, propPreviewURL({ shape: p.id }));
    const teamName = p.team ? PROPS[p.id].team : null; // checker/go/chess → their 2 set colors
    objs.append(spawnCard({ preview: box, title: p.name, color: teamName ? 'team' : 'palette', teamName, swatches: p.swatches,
      snapDefault: !!(PROPS[p.id] && PROPS[p.id].team), // grid games (go/checkers/chess) default to snap-on
      stand: standMode(p.id), standOn: !!(PROPS[p.id] && PROPS[p.id].stand), // Stand toggle, on for shapes that stand naturally
      send: (cp) => ROOM.send('spawn', { type: 'prop', props: { shape: p.id, ...cp } }) }));
  }

  const disp = byId('biDispensers'); disp.replaceChildren(); spawnBar(disp);
  for (const { id } of DISPENSER_LIST) {
    const spec = DISPENSERS[id]; if (!spec) continue;
    const box = previewBox();
    fillAsync(box, spec.body === 'stack' ? propPreviewURL({ shape: spec.item }) : boardPreviewURL(spec.model));
    disp.append(spawnCard({
      preview: box, title: spec.name,
      color: spec.team ? 'team' : (spec.color ? 'palette' : 'none'), teamName: spec.team, swatches: spec.swatches,
      count: spec.infinite ? null : spec.count, // stack size for finite dispensers; a bowl is unlimited
      send: (cp) => ROOM.send('spawn', { type: 'dispenser', props: { disp: id, ...cp } }),
    }));
  }

  const sky = byId('biSky'); sky.replaceChildren();
  for (const s of (window.OTT_BUILTIN_SKIES || [])) {
    const ref = skyRef(s);
    const box = previewBox(); box.append(thumbImg(s.faces ? s.faces[0] : s.url));
    sky.append(builtinCard(box, s.name, 'Apply', () => ROOM.send('skybox', { url: ref })));
  }
  const bm = byId('builtinModal'); if (bm && bm._applySearch) bm._applySearch();
}

// Room Controls → Skybox: a two-tab picker (built-in + custom), apply to the room.
function renderSkyPick() {
  const bi = byId('skyPickBuiltin');
  if (bi) {
    bi.replaceChildren();
    bi.append(builtinCard(previewBox('empty'), 'Default (none)', 'Apply', () => ROOM.send('skybox', { url: '' })));
    for (const s of (window.OTT_BUILTIN_SKIES || [])) {
      const ref = skyRef(s);
      const box = previewBox(); box.append(thumbImg(s.faces ? s.faces[0] : s.url));
      bi.append(builtinCard(box, s.name, 'Apply', () => ROOM.send('skybox', { url: ref })));
    }
  }
  const cu = byId('skyPickCustom');
  if (cu) {
    cu.replaceChildren();
    const list = listCache.sky || [];
    if (!list.length) { const li = document.createElement('li'); li.className = 'libEmpty'; li.textContent = 'None yet — add one from the editor.'; cu.appendChild(li); return; }
    for (const it of list) cu.append(builtinCard(previewEl('sky', it), it.name, 'Apply', () => ROOM.send('skybox', { url: it.url })));
  }
}

// ---- Add-to-Library: deck tab ----------------------------------------------
const parseFaces = (raw) => {
  raw = (raw || '').trim();
  if (!raw) return [];
  if (raw[0] === '[') { try { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr.map(String).map((s) => s.trim()).filter(Boolean); } catch {} }
  const sep = raw.includes('\n') ? /\n+/ : /,+/; // multi-line → one face per line (commas stay in the text); single line → comma-separated
  return raw.split(sep).map((s) => s.trim()).filter(Boolean);
};
// Build a deck on the server: begin → append (batched) → finish. spawn:false = save only.
function sendDeck(back, fronts, name, spawn, editId, geom) {
  ROOM.send('deckBegin', { back, geom });   // geom (optional): the card shape for a fit-to-image deck
  for (let i = 0; i < fronts.length; i += 50) ROOM.send('deckAppend', { fronts: fronts.slice(i, i + 50) });
  ROOM.send('deckFinish', { name, spawn, editId });
}
const showCardPrev = (el, ref) => { const u = cardPreviewURL(ref); el.style.backgroundImage = u ? `url("${u}")` : 'none'; };
// Turn a .uploadSq (with a hidden <input type=file> inside) into a click-to-upload tile.
function wireUploadSq(inputId, isGlb, onChange) {
  const input = byId(inputId), sq = input.parentElement;
  sq.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const f = input.files[0];
    sq.classList.toggle('filled', !!f);
    if (!f) sq.style.backgroundImage = 'none';
    else if (isGlb) glbFilePreviewURL(f).then((u) => { sq.style.backgroundImage = u ? `url("${u}")` : 'none'; });
    else { const r = new FileReader(); r.onload = () => { sq.style.backgroundImage = `url("${r.result}")`; }; r.readAsDataURL(f); }
    if (onChange) onChange();
  });
}
const clearSq = (inputId) => { const input = byId(inputId), sq = input.parentElement; input.value = ''; sq.classList.remove('filled'); sq.style.backgroundImage = 'none'; sq.style.backgroundColor = ''; };

function wireAddDeck() {
  // text decks — refs carry four colors: text / fill / accent(border) / content
  const backRef = () => 'tback:' + byId('adBackFill').value + ':' + byId('adBackTextC').value + ':' + byId('adBackAccent').value + ':' + byId('adBackText').value.trim();
  const frontRef = (face) => 'text:' + byId('adFrontTextC').value + ':' + byId('adFrontFill').value + ':' + byId('adFrontAccent').value + ':' + face;
  const refreshText = () => {
    showCardPrev(byId('adTxtBackPrev'), backRef());
    const faces = parseFaces(byId('adFaces').value);
    showCardPrev(byId('adTxtFrontPrev'), frontRef(faces[0] || 'Sample'));
  };
  ['adBackFill', 'adBackTextC', 'adBackAccent', 'adBackText', 'adFrontFill', 'adFrontTextC', 'adFrontAccent', 'adFaces']
    .forEach((id) => byId(id).addEventListener('input', refreshText));
  refreshText();
  // load fronts from a .csv/.txt file (parseFaces already handles comma / line / JSON)
  byId('adFacesFile').addEventListener('change', () => {
    const f = byId('adFacesFile').files[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => { byId('adFaces').value = String(r.result || '').trim(); refreshText(); }; r.readAsText(f);
  });
  // reset every field + preview to a clean slate after a save
  const clearDeckForm = () => {
    ['adImgName', 'adTxtName', 'adBackText', 'adFaces', 'adFacesFile'].forEach((id) => { byId(id).value = ''; });
    byId('adBackFill').value = '#7d2b2b'; byId('adBackTextC').value = '#f4f1ea'; byId('adBackAccent').value = '#dddddd';
    byId('adFrontFill').value = '#fbfbf7'; byId('adFrontTextC').value = '#141414'; byId('adFrontAccent').value = '#dddddd';
    clearSq('adImgBack'); clearSq('adImgFronts'); editCtx = null;
    refreshText(); // re-render the text previews to their reset defaults (not blank until next keystroke)
    byId('adImgNoCrop').classList.remove('on'); byId('adImgPad').value = '#ffffff'; byId('adImgPadRow').hidden = true;
    setThickSlider(0); byId('adImgThickRow').hidden = true; // back to 1× (thin card), row hidden until Fit is on
    setImgShape('rounded'); byId('adImgShapeRow').hidden = true;
  };
  const saveText = (spawn) => {
    const name = byId('adTxtName').value.trim();
    if (!name) return alert('Name the deck first.');
    const faces = parseFaces(byId('adFaces').value);
    if (!faces.length) return alert('Add at least one front (one per line, comma-separated, or JSON).');
    sendDeck(backRef(), faces.map(frontRef), name, spawn, editCtx && editCtx.id);
    clearDeckForm();
    closeAddModal();
  };
  byId('adTxtSave').onclick = () => saveText(false);
  byId('adTxtSpawn').onclick = () => saveText(true);

  // image decks — click-tiles for back + fronts. "Fit to image" sizes the CARD to the art's aspect
  // (no crop, no stretch, no padding); off = crop the art to a standard card. The preview mirrors it.
  const applyImgFit = () => {
    const fit = byId('adImgNoCrop').classList.contains('on');
    ['adImgBack', 'adImgFronts'].forEach((id) => { const sq = byId(id).parentElement; sq.style.backgroundSize = fit ? 'contain' : 'cover'; sq.style.backgroundColor = ''; });
    byId('adImgThickRow').hidden = !fit; // thickness + shape ride on the fit-to-image geometry
    byId('adImgShapeRow').hidden = !fit;
  };
  wireUploadSq('adImgBack', false, applyImgFit);
  wireUploadSq('adImgFronts', false, applyImgFit);
  byId('adImgNoCrop').onclick = () => { byId('adImgNoCrop').classList.toggle('on'); applyImgFit(); };
  byId('adImgThick').oninput = () => { byId('adImgThickVal').textContent = (+byId('adImgThick').value || 1) + '×'; };
  byId('adImgShape').querySelectorAll('.seg').forEach(b => b.onclick = () => setImgShape(b.dataset.shape));
  const saveImg = async (spawn) => {
    const name = byId('adImgName').value.trim();
    if (!name) return alert('Name the deck first.');
    const editingDeck = editCtx && editCtx.kind === 'deck';
    const frontFiles = [...byId('adImgFronts').files];
    if (!frontFiles.length && !editingDeck) return alert('Choose at least one front image.'); // a fresh deck needs fronts
    const fitToImage = byId('adImgNoCrop').classList.contains('on'); // size the card to the art (no crop/stretch)
    try {
      // Fit-to-image: measure the first front, size the deck's cards to that aspect, and upload every
      // image at that aspect (so the art fills the card exactly). Off: crop the art to a standard card.
      let geom = editingDeck ? editCtx.geom : undefined; // keep the deck's shape when editing without new fronts
      let uw, uh, fit;
      if (fitToImage && frontFiles.length) {
        const dim = await measureImage(frontFiles[0]);
        if (dim && dim.w && dim.h) {
          geom = geomFromImage(dim.w, dim.h, dim.round);   // round measured from the art's alpha
          const MAX = 1200, s = Math.min(1, MAX / Math.max(dim.w, dim.h)); // cap the texture size, keep aspect
          uw = Math.max(1, Math.round(dim.w * s)); uh = Math.max(1, Math.round(dim.h * s)); fit = 'cover';
        }
      }
      if (geom && fitToImage) geom = applyShapeToGeom({ ...geom, t: cardThickHalf() }); // apply the chosen thickness + shape
      let back;
      if (byId('adImgBack').files[0]) back = await uploadImage(byId('adImgBack').files[0], uw, uh, fit, 'decks');
      else back = editingDeck ? editCtx.back : 'back'; // keep the existing back when editing/cloning
      let fronts;
      if (frontFiles.length) { fronts = []; for (const f of frontFiles) fronts.push(await uploadImage(f, uw, uh, fit, 'decks')); }
      else fronts = editCtx.fronts; // image-deck edit only swaps the back — keep the existing fronts
      sendDeck(back, fronts, name, spawn, editCtx && editCtx.id, geom);
      clearDeckForm();
      closeAddModal();
    } catch (e) { alert('Image upload failed.'); }
  };
  byId('adImgSave').onclick = () => saveImg(false);
  byId('adImgSpawn').onclick = () => saveImg(true);
  FILLERS.imgdeck = (d, clone) => { // Edit/Clone image deck: name + swappable back; fronts are kept as-is
    byId('adImgName').value = clone ? '' : d.name;
    clearSq('adImgBack'); clearSq('adImgFronts');
    if (d.back && d.back !== 'back') byId('adImgBack').parentElement.style.backgroundImage = `url("${d.back}")`;
  };
  FILLERS.txtdeck = (d, clone) => { // Edit/Clone text deck: back text/colors + front colors + faces (decoded from the refs)
    byId('adTxtName').value = clone ? '' : d.name;
    const b = parseCardFront(d.back);
    if (b.kind === 'tback') { byId('adBackFill').value = b.bg; byId('adBackTextC').value = b.textColor; byId('adBackAccent').value = b.accent; byId('adBackText').value = b.text; }
    const f0 = parseCardFront(d.fronts[0] || '');
    if (f0.kind === 'text') { byId('adFrontTextC').value = f0.color; byId('adFrontFill').value = f0.bg; byId('adFrontAccent').value = f0.accent; }
    byId('adFaces').value = d.fronts.map((r) => { const f = parseCardFront(r); return f.kind === 'text' ? f.text : r; }).join('\n');
    refreshText();
  };
}

// ---- Add-to-Library: board tab ---------------------------------------------
const BOARD_TEX = 1024; // board texture size (square; matches CONFIG.upload.board)

function wireAddBoard() {
  // saveBoard inserts to the library (no spawn); Save + Spawn also swaps it onto the table.
  const save = (spec, name, spawn) => { ROOM.send('saveBoard', { name, board: spec, editId: editCtx && editCtx.id }); if (spawn) ROOM.send('spawn', { type: 'board', props: spec }); };
  const clearBoard = () => {
    ['adBoardGlbName', 'adBoardImgName'].forEach((id) => { byId(id).value = ''; });
    byId('adBoardW').value = '10'; byId('adBoardD').value = '10';
    clearSq('adBoardGlb'); clearSq('adBoardImg'); editCtx = null;
  };

  wireUploadSq('adBoardGlb', true);   // model tile renders the local .glb
  const saveGlb = async (spawn) => {
    const name = byId('adBoardGlbName').value.trim();
    if (!name) return alert('Name the board first.');
    const f = byId('adBoardGlb').files[0];
    try {
      const url = f ? await uploadModel(f) : (editCtx && editCtx.model); // keep the existing model when editing/cloning
      if (!url) return alert('Choose a .glb file.');
      const { scale, box } = await measureBoard(url);
      save({ model: url, modelScale: scale, box }, name, spawn);
      clearBoard();
      closeAddModal();
    } catch (e) { alert('Board model upload/load failed — make sure it is a .glb file.'); }
  };
  byId('adBoardGlbSave').onclick = () => saveGlb(false);
  byId('adBoardGlbSpawn').onclick = () => saveGlb(true);

  // image / flat boards — send the raw w/d; the server fits them to the current table.
  // The board slab stretches the image to fill w×d, so keep w:d matched to the image's
  // pixel aspect (imgW/imgH) or it comes out distorted and no grid can line up. On upload
  // we read the image's proportions and set Depth from Width; the lock keeps them matched
  // as you tune either field (uncheck to size the two axes freely).
  let imgAspect = 1; // width / height of the loaded image (or the current w/d when editing)
  const clampWD = (v, max) => Math.max(2, Math.min(max, Math.round(v * 100) / 100));
  const locked = () => { const l = byId('adBoardLock'); return !l || l.checked; };
  const wIn = byId('adBoardW'), dIn = byId('adBoardD');
  if (wIn) wIn.oninput = () => { if (locked() && imgAspect > 0) dIn.value = clampWD((+wIn.value || 0) / imgAspect, 32); };
  if (dIn) dIn.oninput = () => { if (locked() && imgAspect > 0) wIn.value = clampWD((+dIn.value || 0) * imgAspect, 40); };
  const onImgPicked = () => {
    const f = byId('adBoardImg').files[0]; if (!f) return;
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        imgAspect = img.naturalWidth / img.naturalHeight;
        const lk = byId('adBoardLock'); if (lk) lk.checked = true;      // fresh image → lock on
        dIn.value = clampWD((+wIn.value || 10) / imgAspect, 32);        // derive Depth from Width + aspect
      }
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
  };
  wireUploadSq('adBoardImg', false, onImgPicked);
  const saveImgBoard = async (spawn) => {
    const name = byId('adBoardImgName').value.trim();
    if (!name) return alert('Name the board first.');
    const w = +byId('adBoardW').value || 10, d = +byId('adBoardD').value || 10;
    try {
      const spec = { w, d };
      const f = byId('adBoardImg').files[0];
      if (f) spec.tex = await uploadImage(f, BOARD_TEX, BOARD_TEX, 'stretch', 'boards');
      else if (editCtx && editCtx.tex) spec.tex = editCtx.tex; // keep the existing image when editing/cloning
      save(spec, name, spawn);
      clearBoard();
      closeAddModal();
    } catch (e) { alert('Image upload failed.'); }
  };
  byId('adBoardImgSave').onclick = () => saveImgBoard(false);
  byId('adBoardImgSpawn').onclick = () => saveImgBoard(true);
  FILLERS.board = (it, clone) => { // pre-fill the Board form from an existing asset (Edit / Clone)
    if (it.model) { // uploaded .glb board
      byId('adBoardGlbName').value = clone ? '' : it.name;
      clearSq('adBoardGlb');
      boardPreviewURL(it).then((u) => { if (u) byId('adBoardGlb').parentElement.style.backgroundImage = `url("${u}")`; });
    } else { // image / flat board
      byId('adBoardImgName').value = clone ? '' : it.name;
      byId('adBoardW').value = it.w != null ? it.w : 10;
      byId('adBoardD').value = it.d != null ? it.d : 10;
      imgAspect = (it.w > 0 && it.d > 0) ? it.w / it.d : 1; // lock keeps this asset's existing proportions
      clearSq('adBoardImg');
      if (it.tex) boardPreviewURL(it).then((u) => { if (u) byId('adBoardImg').parentElement.style.backgroundImage = `url("${u}")`; });
    }
  };
}

// ---- Add-to-Library: object tab (uploaded .glb models) ---------------------
function wireAddObject() {
  // saveProp inserts to the library (no spawn); Save + Spawn also drops one on the table.
  const save = (props, name, spawn) => { ROOM.send('saveProp', { name, props, editId: editCtx && editCtx.id }); if (spawn) ROOM.send('spawn', { type: 'prop', props }); };
  // collider is a single-select toggle group of icon buttons
  const colliderBtns = [...document.querySelectorAll('#adObjColliders .colliderBtn')];
  const setCollider = (which) => colliderBtns.forEach((b) => b.classList.toggle('on', b.dataset.collider === which));
  const currentCollider = () => { const on = colliderBtns.find((b) => b.classList.contains('on')); return on ? on.dataset.collider : 'box'; };
  colliderBtns.forEach((b) => b.onclick = () => setCollider(b.dataset.collider));
  // Orientation: accumulate 90° world-axis rotations, stored as an Euler modelRot on spawn.
  let objQuat = new THREE.Quaternion();
  const objRot = () => { const e = new THREE.Euler().setFromQuaternion(objQuat); return [e.x, e.y, e.z]; };
  const refreshObjPreview = () => { const f = byId('adObjGlb').files[0]; if (f) glbFilePreviewURL(f, objRot()).then((u) => { byId('adObjGlb').parentElement.style.backgroundImage = u ? `url("${u}")` : 'none'; }); };
  const rotBy = (x, y, z) => { objQuat.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(x, y, z), Math.PI / 2)); refreshObjPreview(); };
  byId('adObjRotX').onclick = () => rotBy(1, 0, 0);
  byId('adObjRotY').onclick = () => rotBy(0, 1, 0);
  byId('adObjRotZ').onclick = () => rotBy(0, 0, 1);
  byId('adObjRotReset').onclick = () => { objQuat.identity(); refreshObjPreview(); };
  const clearObj = () => {
    ['adObjName'].forEach((id) => { byId(id).value = ''; });
    byId('adObjScale').value = '1'; byId('adObjStand').classList.remove('on'); setCollider('box');
    objQuat.identity(); clearSq('adObjGlb'); editCtx = null;
  };
  wireUploadSq('adObjGlb', true, () => { objQuat.identity(); }); // new file → fresh orientation
  byId('adObjStand').onclick = () => byId('adObjStand').classList.toggle('on');
  const saveObj = async (spawn) => {
    const name = byId('adObjName').value.trim();
    if (!name) return alert('Name the object first.');
    const f = byId('adObjGlb').files[0];
    const scale = +byId('adObjScale').value || 1, stand = byId('adObjStand').classList.contains('on'), collider = currentCollider(), rot = objRot();
    try {
      const url = f ? await uploadModel(f) : (editCtx && editCtx.model); // keep the existing model when editing/cloning
      if (!url) return alert('Choose a .glb file.');
      const box = await measureModel(url, scale, rot);
      const props = { model: url, box, stand, scale };
      if (collider !== 'box') props.collider = collider;
      if (rot.some((v) => Math.abs(v) > 1e-4)) props.modelRot = rot;
      save(props, name, spawn);
      clearObj();
      closeAddModal();
    } catch (e) { alert('Model upload/load failed — make sure it is a .glb file.'); }
  };
  byId('adObjSave').onclick = () => saveObj(false);
  byId('adObjSpawn').onclick = () => saveObj(true);
  FILLERS.prop = (it, clone) => { // pre-fill the Object form from an existing asset (Edit / Clone)
    const p = it.props || {};
    byId('adObjName').value = clone ? '' : it.name;
    byId('adObjScale').value = p.scale != null ? p.scale : 1;
    byId('adObjStand').classList.toggle('on', !!p.stand);
    setCollider(p.collider || 'box');
    objQuat.identity();
    if (Array.isArray(p.modelRot)) objQuat.setFromEuler(new THREE.Euler(p.modelRot[0], p.modelRot[1], p.modelRot[2]));
    clearSq('adObjGlb');
    propPreviewURL(it.props).then((u) => { if (u) byId('adObjGlb').parentElement.style.backgroundImage = `url("${u}")`; }); // current model — upload to replace
  };
}

// ---- Add-to-Library: skybox tab (equirect panorama or 6-face cubemap) -------
const CUBE_IDS = ['adSkyPX', 'adSkyNX', 'adSkyPY', 'adSkyNY', 'adSkyPZ', 'adSkyNZ'];
function wireAddSky() {
  const clearSky = () => {
    ['adSkyEqName', 'adSkyCubeName'].forEach((id) => { byId(id).value = ''; });
    ['adSkyEq', ...CUBE_IDS].forEach(clearSq);
  };

  // every face + the panorama is a click-tile
  wireUploadSq('adSkyEq', false);
  CUBE_IDS.forEach((id) => wireUploadSq(id, false));
  const saveEq = async (apply) => {
    const name = byId('adSkyEqName').value.trim();
    if (!name) return alert('Name the skybox first.');
    const f = byId('adSkyEq').files[0];
    if (!f) return alert('Choose a 2:1 panorama image.');
    try {
      const url = await uploadImage(f, 2048, 1024, 'stretch', 'sky');
      ROOM.send('saveSkybox', { name, url, isPublic: false });   // private by default; publish from the library
      if (apply) ROOM.send('skybox', { url });
      clearSky();
      closeAddModal();
    } catch (e) { alert('Upload failed.'); }
  };
  byId('adSkyEqSave').onclick = () => saveEq(false);
  byId('adSkyEqApply').onclick = () => saveEq(true);

  // cubemap (six square faces)
  const saveCube = async (apply) => {
    const name = byId('adSkyCubeName').value.trim();
    if (!name) return alert('Name the skybox first.');
    const files = CUBE_IDS.map((id) => byId(id).files[0]);
    if (files.some((f) => !f)) return alert('Pick all six faces.');
    try {
      const faces = [];
      for (const f of files) faces.push(await uploadImage(f, 1024, 1024, 'stretch', 'sky'));
      ROOM.send('saveSkybox', { name, type: 'cube', faces, isPublic: false });
      if (apply) ROOM.send('skybox', { url: JSON.stringify({ t: 'cube', f: faces }) });
      clearSky();
      closeAddModal();
    } catch (e) { alert('Upload failed.'); }
  };
  byId('adSkyCubeSave').onclick = () => saveCube(false);
  byId('adSkyCubeApply').onclick = () => saveCube(true);
}

// client.js hands over the live room once connected.
window.onOttRoom = (room) => {
  ROOM = room;
  room.onMessage('deckData', (d) => { // deck Edit/Clone: server sent the deck's cards + back — fill the matching form
    if (!pendingDeck) return;
    const { it, clone } = pendingDeck; pendingDeck = null;
    const isText = ((d.fronts && d.fronts[0]) || '').startsWith('text:');
    byId('addModal').querySelector(`.libTab[data-tab="${isText ? 'txtdecks' : 'imgdecks'}"]`)?.click();
    editCtx = { kind: 'deck', id: clone ? null : it.id, back: d.back, fronts: d.fronts, geom: d.geom || undefined };
    if (d.geom && !isText) { // fit-to-image deck: restore its thickness + shape
      byId('adImgNoCrop').classList.add('on');
      setThickSlider(d.geom.t); byId('adImgThickRow').hidden = false;
      setImgShape(shapeOfGeom(d.geom)); byId('adImgShapeRow').hidden = false;
    }
    (isText ? FILLERS.txtdeck : FILLERS.imgdeck)(d, clone);
  });
  const refresh = () => { room.send('listDecks'); room.send('listBoards'); room.send('listProps'); room.send('listScenes'); room.send('listSkyboxes'); };
  // View Library (present on both the editor and the table)
  const panel = byId('libraryPanel');
  if (panel) {
    byId('libraryBtn').onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) refresh(); };
    byId('libraryClose').onclick = () => { panel.hidden = true; };
    wireTabs(panel);
    wireControls(panel);
    // Room Controls → Load a Scene: open the library straight to the Scenes tab.
    const roomScene = byId('roomScene');
    if (roomScene) roomScene.onclick = () => {
      const rg = byId('roomGrp'); if (rg) rg.hidden = true;
      panel.hidden = false;
      const scenesTab = panel.querySelector('.libTab[data-tab="scenes"]');
      if (scenesTab) scenesTab.click(); // activate via wireTabs
      refresh();
    };
  }
  // Built-in library — bundled pieces, spawn-only (client-side data, no server fetch).
  const builtin = byId('builtinModal');
  if (builtin) {
    byId('builtinBtn').onclick = () => { builtin.hidden = !builtin.hidden; if (!builtin.hidden) renderBuiltin(); };
    byId('builtinClose').onclick = () => { builtin.hidden = true; };
    wireTabs(builtin);
    wireControls(builtin);
  }
  // Room Controls → Skybox: two-tab apply-picker (both pages).
  const skyPick = byId('skyPickModal');
  if (skyPick) {
    const rs = byId('roomSky');
    if (rs) rs.onclick = () => { const rg = byId('roomGrp'); if (rg) rg.hidden = true; skyPick.hidden = false; renderSkyPick(); room.send('listSkyboxes'); };
    byId('skyPickClose').onclick = () => { skyPick.hidden = true; };
    wireTabs(skyPick);
  }
  // Add-to-Library builder — editor only (absent on the table).
  const addModal = byId('addModal');
  if (addModal) {
    // "Add" = create mode; toggles the dialog and moves focus in/out for keyboard users
    byId('addBtn').onclick = () => { if (addModal.hidden) { editCtx = null; openAddModal(); focusAddModal(); } else { closeAddModal(); } };
    byId('addClose').onclick = () => closeAddModal();
    addModal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAddModal(); } // don't also trigger table Esc verbs
      else if (e.key === 'Tab') trapTab(e, addModal);                                       // keep focus inside the dialog
    });
    wireTabs(addModal);
    wireAddDeck();
    wireAddBoard();
    wireAddObject();
    wireAddSky();
  }
  const saveScene = byId('sceneSaveBtn');
  if (saveScene) saveScene.onclick = () => { const n = prompt('Save the current table as a scene named:'); if (n && n.trim()) room.send('sceneSave', { name: n.trim() }); };
  refresh(); // prime the lists so the panel is populated on first open
};
