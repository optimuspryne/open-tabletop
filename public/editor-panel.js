// editor-panel.js — the admin library-management panel (editor.html only). It rides
// on the table engine's room connection, handed over by client.js via
// window.onOttRoom, and gets asset lists via window.onLibraryList (client.js fans
// the deckList/boardList/propList messages out to here, so the modal saved-lists
// keep working too). In the editor the admin sees private assets as well as public.
import { cardPreviewURL, propPreviewURL, boardPreviewURL, diePreviewURL, uploadImage, uploadModel, measureBoard, measureModel, glbFilePreviewURL } from './graphics.js';
import * as THREE from 'three';
import { DIE_SIDES, PROP_LIST, BOARDS, COLORS } from '/shared/pieces.js';
const $ = (id) => document.getElementById(id);
const btn = (label, fn, cls) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = fn; return b; };
// Reveal one tabbed pane at a time, scoped to a modal (so multiple tabbed modals don't collide).
function wireTabs(root) {
  const tabs = [...root.querySelectorAll('.libTab')];
  tabs.forEach((tab) => tab.onclick = () => {
    tabs.forEach((t) => t.classList.toggle('on', t === tab));
    root.querySelectorAll('.libPane').forEach((pane) => { pane.hidden = pane.dataset.pane !== tab.dataset.tab; });
    if (root._applySearch) root._applySearch(); // re-filter the newly shown pane
  });
}
// A per-modal search box (filters the visible tab's cards by name). Injected once
// under the tabs; re-applied on tab switch and after each render.
function wireSearch(root) {
  const tabs = root.querySelector('.libTabs');
  if (!tabs || root.querySelector('.libSearch')) return;
  const wrap = document.createElement('div'); wrap.className = 'libSearchWrap';
  const inp = document.createElement('input'); inp.type = 'search'; inp.className = 'libSearch'; inp.placeholder = 'Search\u2026';
  wrap.append(inp); tabs.after(wrap);
  root._applySearch = () => {
    const q = inp.value.trim().toLowerCase();
    const pane = [...root.querySelectorAll('.libPane')].find((p) => !p.hidden);
    if (!pane) return;
    pane.querySelectorAll('.libCard').forEach((card) => {
      const name = (card.querySelector('.libName')?.textContent || '').toLowerCase();
      card.style.display = (!q || name.includes(q)) ? '' : 'none';
    });
  };
  inp.oninput = root._applySearch;
}

// ---- Spawn cards: quantity + colour, and multi-select batch spawn ----------
// Fixed swatch palette (first = neutral / no tint). Team pieces use their own
// two set colours (COLORS.team) instead of the palette.
const PALETTE = [
  { name: 'Neutral', hex: null },
  { name: 'Red', hex: 0xd14b4b }, { name: 'Orange', hex: 0xd98a3a },
  { name: 'Yellow', hex: 0xd9c24b }, { name: 'Green', hex: 0x5fae5f },
  { name: 'Blue', hex: 0x5b8ad6 }, { name: 'Purple', hex: 0x9a6fc0 },
  { name: 'White', hex: 0xf4f1ea }, { name: 'Black', hex: 0x2a2a2a },
];
// Named alternate palettes a shape can opt into via PROP_LIST `swatches`.
const METALS = [
  { name: 'Gold', hex: 0xd4af37 }, { name: 'Silver', hex: 0xc0c0c0 },
  { name: 'Copper', hex: 0xb87333 }, { name: 'Bronze', hex: 0x9c6b3f },
];
const PALETTES = { metals: METALS };
// Legible die-number colour for a face colour (dark face → light numbers).
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
// One spawnable card: preview + title + quantity + optional colour + Spawn.
// send(colourProps) fires a single spawn; the card supplies quantity + colour.
// color: 'palette' | 'team' | 'own' | 'none'. li._spawn() is used for batch spawn.
function spawnCard({ preview, title, badge, send, color = 'none', teamName, dice = false, swatches, extraActs = [] }) {
  const li = document.createElement('li'); li.className = 'libCard';
  const name = document.createElement('span'); name.className = 'libName'; name.textContent = title;
  const meta = document.createElement('div'); meta.className = 'libMeta'; meta.append(name); if (badge) meta.append(badge);

  const ctrls = document.createElement('div'); ctrls.className = 'cardCtrls';
  const qty = qtyStepper(); ctrls.append(qty);

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
    const cols = COLORS.team[teamName] || [0x888888, 0x222222];
    let idx = 0; getTeam = () => idx;
    ctrls.append(pickRow(cols.map((c, i) => ({ hex: c, name: 'Set ' + (i + 1) })), (_it, i) => { idx = i; }));
  } else if (color === 'palette' || color === 'own') {
    const pal = PALETTES[swatches] || PALETTE;
    let col = pal[0].hex;   // default to the first swatch (null for the Neutral-led default palette)
    const row = pickRow(pal, (it) => { col = it.hex; });
    if (color === 'own') {
      row.hidden = true;
      const tog = document.createElement('button'); tog.type = 'button'; tog.className = 'chip chk on ownTog'; tog.textContent = 'Own colours';
      tog.onclick = () => { row.hidden = tog.classList.toggle('on'); };
      getColor = () => (tog.classList.contains('on') ? null : col);
      ctrls.append(tog, row);
    } else {
      getColor = () => col; ctrls.append(row);
    }
  }

  li._spawn = () => {
    const n = qty.get(); const cp = {};
    const c = getColor(); if (c != null) { cp.color = c; if (dice) cp.textColor = contrast(c); }
    const t = getTeam(); if (t != null) cp.team = t;
    for (let i = 0; i < n; i++) send(cp);
  };

  const acts = document.createElement('div'); acts.className = 'libActs';
  acts.append(btn('Spawn', () => li._spawn()), ...extraActs);
  li.append(preview, meta, ctrls, acts);
  return li;
}
// A tab's multi-select bar (Select toggle + "Spawn selected"), injected once
// before the card list. In select mode, clicking a card highlights it.
function spawnBar(ul) {
  if (ul.previousElementSibling && ul.previousElementSibling.classList.contains('spawnBar')) return;
  const bar = document.createElement('div'); bar.className = 'spawnBar';
  const sel = document.createElement('button'); sel.type = 'button'; sel.className = 'chip selToggle'; sel.textContent = 'Select';
  const go = document.createElement('button'); go.type = 'button'; go.className = 'spawnSelBtn'; go.textContent = 'Spawn selected'; go.hidden = true;
  bar.append(sel, go);
  ul.parentNode.insertBefore(bar, ul);
  sel.onclick = () => {
    const on = ul.classList.toggle('selecting'); sel.classList.toggle('on', on); go.hidden = !on;
    if (!on) ul.querySelectorAll('.libCard.sel').forEach((c) => c.classList.remove('sel'));
  };
  go.onclick = () => ul.querySelectorAll('.libCard.sel').forEach((c) => c._spawn && c._spawn());
  ul.addEventListener('click', (e) => {
    if (!ul.classList.contains('selecting')) return;
    if (e.target.closest('.cardCtrls') || e.target.closest('.libActs')) return; // let qty/colour clicks through
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

// Build the preview image(s) for a card. Decks show back + first-front; skyboxes,
// boards and props show a thumbnail (boards/props render async); scenes get a glyph.
function previewEl(kind, it) {
  const wrap = document.createElement('div'); wrap.className = 'libPreview';
  const img = (src, cls) => { const im = document.createElement('img'); im.className = 'libThumb' + (cls ? ' ' + cls : ''); im.loading = 'lazy'; if (src) im.src = src; return im; };
  const asyncThumb = (promise) => { const im = img(); wrap.append(im); promise.then((u) => { if (u) im.src = u; else wrap.classList.add('empty'); }).catch(() => wrap.classList.add('empty')); };
  if (kind === 'deck') {
    wrap.classList.add('deckPreview');
    wrap.append(img(cardPreviewURL(it.back), 'back'), img(cardPreviewURL(it.first), 'front'));
  } else if (kind === 'sky') {
    let src = it.url;
    if (typeof src === 'string' && src[0] === '{') { try { src = JSON.parse(src).f[0]; } catch { src = null; } } // cubemap → first face
    wrap.append(img(src));
  } else if (kind === 'board') {
    asyncThumb(boardPreviewURL(it.preview));
  } else if (kind === 'prop') {
    asyncThumb(propPreviewURL(it.props || {}));
  } else { // scene — no single image
    wrap.classList.add('empty'); wrap.textContent = '🎬';
  }
  return wrap;
}

function renderList(kind, list) {
  const ul = $(LIST_UL[kind]); if (!ul) return;
  ul.replaceChildren();
  if (kind === 'prop' || kind === 'deck') spawnBar(ul); // quantity + colour + multi-select for spawnable assets
  if (!list.length) { const li = document.createElement('li'); li.className = 'libEmpty'; li.textContent = 'None yet.'; ul.appendChild(li); return; }
  for (const it of list) {
    const badge = document.createElement('span'); badge.className = 'libBadge ' + (it.isPublic ? 'pub' : 'priv'); badge.textContent = it.isPublic ? 'public' : 'private';
    const adminActs = window.OTT_IS_ADMIN ? [ // curation is site-admin only; GMs/helpers just spawn/apply
      btn(it.isPublic ? 'Unpublish' : 'Publish', () => ROOM.send('assetPublic', { kind, id: it.id, isPublic: !it.isPublic })),
      btn('Rename', () => { const n = prompt('Rename:', it.name); if (n && n.trim()) ROOM.send('assetRename', { kind, id: it.id, name: n.trim() }); }),
      btn('Delete', () => { if (confirm(`Delete "${it.name}"? This cannot be undone.`)) ROOM.send('assetDelete', { kind, id: it.id }); }, 'danger'),
    ] : [];

    if (kind === 'prop' || kind === 'deck') { // spawnable: quantity + colour + multi-select
      const extra = kind === 'deck' && it.count != null ? ` \u00b7 ${it.count}` : '';
      ul.appendChild(spawnCard({
        preview: previewEl(kind, it), title: it.name + extra, badge, extraActs: adminActs,
        color: kind === 'prop' ? 'own' : 'none',  // custom objects: default to their own material; decks never tint
        send: kind === 'deck'
          ? () => ROOM.send('loadDeck', { id: it.id })
          : (cp) => ROOM.send('spawn', { type: 'prop', props: { ...it.props, ...cp } }),
      }));
    } else { // board / scene / sky — one action, no quantity/colour
      const extra = kind === 'board' && it.kind ? ` \u00b7 ${it.kind}` : (kind === 'sky' && typeof it.url === 'string' && it.url[0] === '{' ? ' \u00b7 cube' : '');
      const li = document.createElement('li'); li.className = 'libCard';
      const name = document.createElement('span'); name.className = 'libName'; name.textContent = it.name + extra;
      const meta = document.createElement('div'); meta.className = 'libMeta'; meta.append(name, badge);
      const acts = document.createElement('div'); acts.className = 'libActs';
      const primary = kind === 'scene'
        ? btn('Load', () => { if (confirm(`Load "${it.name}" into the editor? This clears the current table.`)) ROOM.send('sceneLoad', { id: it.id }); })
        : kind === 'sky' ? btn('Apply', () => ROOM.send('skybox', { url: it.url }))
        : btn('Spawn', () => spawnOf[kind](it));
      acts.append(primary, ...adminActs);
      li.append(previewEl(kind, it), meta, acts);
      ul.appendChild(li);
    }
  }
  const lp = $('libraryPanel'); if (lp && lp._applySearch) lp._applySearch();
}

// client.js fans the three list messages here (and still renders the modal saved-lists).
const listCache = {};
window.onLibraryList = (kind, list) => { listCache[kind] = list; renderList(kind, list); if (kind === 'sky') { const m = $('skyPickModal'); if (m && !m.hidden) renderSkyPick(); } };
window.onLibraryAdmin = () => { for (const k in listCache) renderList(k, listCache[k]); }; // admin status arrived → re-render

// ---- built-in library (read-only: spawn the bundled pieces) ----------------
// One card, with a preview node and a Spawn/Apply button.
function builtinCard(previewNode, title, label, fn) {
  const li = document.createElement('li'); li.className = 'libCard';
  const meta = document.createElement('div'); meta.className = 'libMeta';
  const name = document.createElement('span'); name.className = 'libName'; name.textContent = title;
  meta.append(name);
  const acts = document.createElement('div'); acts.className = 'libActs'; acts.append(btn(label, fn));
  li.append(previewNode, meta, acts);
  return li;
}
const previewBox = (extraClass) => { const w = document.createElement('div'); w.className = 'libPreview' + (extraClass ? ' ' + extraClass : ''); return w; };
const thumbImg = (src) => { const im = document.createElement('img'); im.className = 'libThumb'; im.loading = 'lazy'; if (src) im.src = src; return im; };
// Fill a preview box asynchronously (models load first), falling back to an empty slot.
const fillAsync = (box, promise) => { const im = thumbImg(); box.append(im); promise.then((u) => { if (u) im.src = u; else box.classList.add('empty'); }).catch(() => box.classList.add('empty')); };

function renderBuiltin() {
  const dice = $('biDice'); dice.replaceChildren(); spawnBar(dice);
  for (const sides of DIE_SIDES) {
    const box = previewBox(); box.append(thumbImg(diePreviewURL(sides)));
    dice.append(spawnCard({ preview: box, title: 'd' + sides, color: 'palette', dice: true,
      send: (cp) => ROOM.send('spawn', { type: 'die', props: { sides, ...cp } }) }));
  }

  const decks = $('biDecks'); decks.replaceChildren(); spawnBar(decks);
  { const box = previewBox('deckPreview'); box.append(thumbImg(cardPreviewURL('back')), thumbImg(cardPreviewURL('rank:A:\u2660:#000')));
    decks.append(spawnCard({ preview: box, title: 'Standard 52-card', color: 'none',
      send: () => ROOM.send('spawn', { type: 'deck', props: {} }) })); }

  const boards = $('biBoards'); boards.replaceChildren();
  for (const key of Object.keys(BOARDS)) {
    const box = previewBox(); fillAsync(box, boardPreviewURL(BOARDS[key].model));
    boards.append(builtinCard(box, BOARDS[key].name, 'Spawn', () => ROOM.send('spawn', { type: 'board', props: { board: key } })));
  }

  const objs = $('biObjects'); objs.replaceChildren(); spawnBar(objs);
  for (const p of PROP_LIST) {
    const box = previewBox(); fillAsync(box, propPreviewURL({ shape: p.id }));
    const teamName = p.team ? (p.id.startsWith('chess') ? 'chess' : p.id) : null; // checker/go/chess → their 2 set colours
    objs.append(spawnCard({ preview: box, title: p.name, color: teamName ? 'team' : 'palette', teamName, swatches: p.swatches,
      send: (cp) => ROOM.send('spawn', { type: 'prop', props: { shape: p.id, ...cp } }) }));
  }

  const sky = $('biSky'); sky.replaceChildren();
  for (const s of (window.OTT_BUILTIN_SKIES || [])) {
    const ref = s.faces ? JSON.stringify({ t: 'cube', f: s.faces }) : (s.url || '');
    const box = previewBox(); box.append(thumbImg(s.faces ? s.faces[0] : s.url));
    sky.append(builtinCard(box, s.name, 'Apply', () => ROOM.send('skybox', { url: ref })));
  }
  const bm = $('builtinModal'); if (bm && bm._applySearch) bm._applySearch();
}

// Room Controls → Skybox: a two-tab picker (built-in + custom), apply to the room.
function renderSkyPick() {
  const bi = $('skyPickBuiltin');
  if (bi) {
    bi.replaceChildren();
    bi.append(builtinCard(previewBox('empty'), 'Default (none)', 'Apply', () => ROOM.send('skybox', { url: '' })));
    for (const s of (window.OTT_BUILTIN_SKIES || [])) {
      const ref = s.faces ? JSON.stringify({ t: 'cube', f: s.faces }) : (s.url || '');
      const box = previewBox(); box.append(thumbImg(s.faces ? s.faces[0] : s.url));
      bi.append(builtinCard(box, s.name, 'Apply', () => ROOM.send('skybox', { url: ref })));
    }
  }
  const cu = $('skyPickCustom');
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
  return raw.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
};
// Build a deck on the server: begin → append (batched) → finish. spawn:false = save only.
function sendDeck(back, fronts, name, spawn) {
  ROOM.send('deckBegin', { back });
  for (let i = 0; i < fronts.length; i += 50) ROOM.send('deckAppend', { fronts: fronts.slice(i, i + 50) });
  ROOM.send('deckFinish', { name, spawn });
}
const showCardPrev = (el, ref) => { const u = cardPreviewURL(ref); el.style.backgroundImage = u ? `url("${u}")` : 'none'; };
// Turn a .uploadSq (with a hidden <input type=file> inside) into a click-to-upload tile.
function wireUploadSq(inputId, isGlb, onChange) {
  const input = $(inputId), sq = input.parentElement;
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
const clearSq = (inputId) => { const input = $(inputId), sq = input.parentElement; input.value = ''; sq.classList.remove('filled'); sq.style.backgroundImage = 'none'; sq.style.backgroundColor = ''; };

function wireAddDeck() {
  // text decks — refs carry four colours: text / fill / accent(border) / content
  const backRef = () => 'tback:' + $('adBackFill').value + ':' + $('adBackTextC').value + ':' + $('adBackAccent').value + ':' + $('adBackText').value.trim();
  const frontRef = (face) => 'text:' + $('adFrontTextC').value + ':' + $('adFrontFill').value + ':' + $('adFrontAccent').value + ':' + face;
  const refreshText = () => {
    showCardPrev($('adTxtBackPrev'), backRef());
    const faces = parseFaces($('adFaces').value);
    showCardPrev($('adTxtFrontPrev'), frontRef(faces[0] || 'Sample'));
  };
  ['adBackFill', 'adBackTextC', 'adBackAccent', 'adBackText', 'adFrontFill', 'adFrontTextC', 'adFrontAccent', 'adFaces']
    .forEach((id) => $(id).addEventListener('input', refreshText));
  refreshText();
  // load fronts from a .csv/.txt file (parseFaces already handles comma / line / JSON)
  $('adFacesFile').addEventListener('change', () => {
    const f = $('adFacesFile').files[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => { $('adFaces').value = String(r.result || '').trim(); refreshText(); }; r.readAsText(f);
  });
  // reset every field + preview to a clean slate after a save
  const clearDeckForm = () => {
    ['adImgName', 'adTxtName', 'adBackText', 'adFaces', 'adFacesFile'].forEach((id) => { $(id).value = ''; });
    $('adBackFill').value = '#7d2b2b'; $('adBackTextC').value = '#f4f1ea'; $('adBackAccent').value = '#dddddd';
    $('adFrontFill').value = '#fbfbf7'; $('adFrontTextC').value = '#141414'; $('adFrontAccent').value = '#dddddd';
    clearSq('adImgBack'); clearSq('adImgFronts');
    ['adTxtBackPrev', 'adTxtFrontPrev'].forEach((id) => { $(id).style.backgroundImage = 'none'; });
    $('adImgNoCrop').classList.remove('on'); $('adImgPad').value = '#ffffff'; $('adImgPadRow').hidden = true;
  };
  const saveText = (spawn) => {
    const name = $('adTxtName').value.trim();
    if (!name) return alert('Name the deck first.');
    const faces = parseFaces($('adFaces').value);
    if (!faces.length) return alert('Add at least one front (one per line, comma-separated, or JSON).');
    sendDeck(backRef(), faces.map(frontRef), name, spawn);
    clearDeckForm();
    $('addModal').hidden = true;
  };
  $('adTxtSave').onclick = () => saveText(false);
  $('adTxtSpawn').onclick = () => saveText(true);

  // image decks — click-tiles for back + fronts; the tile preview mirrors the crop mode
  const applyImgFit = () => {
    const noCrop = $('adImgNoCrop').classList.contains('on');
    ['adImgBack', 'adImgFronts'].forEach((id) => { const sq = $(id).parentElement; sq.style.backgroundSize = noCrop ? 'contain' : 'cover'; sq.style.backgroundColor = noCrop ? $('adImgPad').value : ''; });
  };
  wireUploadSq('adImgBack', false, applyImgFit);
  wireUploadSq('adImgFronts', false, applyImgFit);
  $('adImgNoCrop').onclick = () => { $('adImgNoCrop').classList.toggle('on'); $('adImgPadRow').hidden = !$('adImgNoCrop').classList.contains('on'); applyImgFit(); };
  $('adImgPad').addEventListener('input', applyImgFit);
  const saveImg = async (spawn) => {
    const name = $('adImgName').value.trim();
    if (!name) return alert('Name the deck first.');
    const frontFiles = [...$('adImgFronts').files];
    if (!frontFiles.length) return alert('Choose at least one front image.');
    const noCrop = $('adImgNoCrop').classList.contains('on');      // 'contain' fits the whole image (no crop); pad fills the leftover
    const fit = noCrop ? 'contain' : undefined;
    const pad = noCrop ? $('adImgPad').value : undefined;
    try {
      let back = 'back';
      if ($('adImgBack').files[0]) back = await uploadImage($('adImgBack').files[0], undefined, undefined, fit, 'decks', pad);
      const fronts = [];
      for (const f of frontFiles) fronts.push(await uploadImage(f, undefined, undefined, fit, 'decks', pad));
      sendDeck(back, fronts, name, spawn);
      clearDeckForm();
      $('addModal').hidden = true;
    } catch (e) { alert('Image upload failed.'); }
  };
  $('adImgSave').onclick = () => saveImg(false);
  $('adImgSpawn').onclick = () => saveImg(true);
}

// ---- Add-to-Library: board tab ---------------------------------------------
const BOARD_TEX = 1024; // board texture size (square; matches CONFIG.upload.board)

function wireAddBoard() {
  // saveBoard inserts to the library (no spawn); Save + Spawn also swaps it onto the table.
  const save = (spec, name, spawn) => { ROOM.send('saveBoard', { name, board: spec }); if (spawn) ROOM.send('spawn', { type: 'board', props: spec }); };
  const clearBoard = () => {
    ['adBoardGlbName', 'adBoardImgName'].forEach((id) => { $(id).value = ''; });
    $('adBoardW').value = '10'; $('adBoardD').value = '10';
    clearSq('adBoardGlb'); clearSq('adBoardImg');
  };

  wireUploadSq('adBoardGlb', true);   // model tile renders the local .glb
  const saveGlb = async (spawn) => {
    const name = $('adBoardGlbName').value.trim();
    if (!name) return alert('Name the board first.');
    const f = $('adBoardGlb').files[0];
    if (!f) return alert('Choose a .glb file.');
    try {
      const url = await uploadModel(f);
      const { scale, box } = await measureBoard(url);
      save({ model: url, modelScale: scale, box }, name, spawn);
      clearBoard();
      $('addModal').hidden = true;
    } catch (e) { alert('Board model upload/load failed — make sure it is a .glb file.'); }
  };
  $('adBoardGlbSave').onclick = () => saveGlb(false);
  $('adBoardGlbSpawn').onclick = () => saveGlb(true);

  // image / flat boards — send the raw w/d; the server fits them to the current table
  wireUploadSq('adBoardImg', false);
  const saveImgBoard = async (spawn) => {
    const name = $('adBoardImgName').value.trim();
    if (!name) return alert('Name the board first.');
    const w = +$('adBoardW').value || 10, d = +$('adBoardD').value || 10;
    try {
      const spec = { w, d };
      const f = $('adBoardImg').files[0];
      if (f) spec.tex = await uploadImage(f, BOARD_TEX, BOARD_TEX, 'stretch', 'boards');
      save(spec, name, spawn);
      clearBoard();
      $('addModal').hidden = true;
    } catch (e) { alert('Image upload failed.'); }
  };
  $('adBoardImgSave').onclick = () => saveImgBoard(false);
  $('adBoardImgSpawn').onclick = () => saveImgBoard(true);
}

// ---- Add-to-Library: object tab (uploaded .glb models) ---------------------
function wireAddObject() {
  // saveProp inserts to the library (no spawn); Save + Spawn also drops one on the table.
  const save = (props, name, spawn) => { ROOM.send('saveProp', { name, props }); if (spawn) ROOM.send('spawn', { type: 'prop', props }); };
  // collider is a single-select toggle group of icon buttons
  const colliderBtns = [...document.querySelectorAll('#adObjColliders .colliderBtn')];
  const setCollider = (which) => colliderBtns.forEach((b) => b.classList.toggle('on', b.dataset.collider === which));
  const currentCollider = () => { const on = colliderBtns.find((b) => b.classList.contains('on')); return on ? on.dataset.collider : 'box'; };
  colliderBtns.forEach((b) => b.onclick = () => setCollider(b.dataset.collider));
  // Orientation: accumulate 90° world-axis rotations, stored as an Euler modelRot on spawn.
  let objQuat = new THREE.Quaternion();
  const objRot = () => { const e = new THREE.Euler().setFromQuaternion(objQuat); return [e.x, e.y, e.z]; };
  const refreshObjPreview = () => { const f = $('adObjGlb').files[0]; if (f) glbFilePreviewURL(f, objRot()).then((u) => { $('adObjGlb').parentElement.style.backgroundImage = u ? `url("${u}")` : 'none'; }); };
  const rotBy = (x, y, z) => { objQuat.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(x, y, z), Math.PI / 2)); refreshObjPreview(); };
  $('adObjRotX').onclick = () => rotBy(1, 0, 0);
  $('adObjRotY').onclick = () => rotBy(0, 1, 0);
  $('adObjRotZ').onclick = () => rotBy(0, 0, 1);
  $('adObjRotReset').onclick = () => { objQuat.identity(); refreshObjPreview(); };
  const clearObj = () => {
    ['adObjName'].forEach((id) => { $(id).value = ''; });
    $('adObjScale').value = '1'; $('adObjStand').classList.remove('on'); setCollider('box');
    objQuat.identity(); clearSq('adObjGlb');
  };
  wireUploadSq('adObjGlb', true, () => { objQuat.identity(); }); // new file → fresh orientation
  $('adObjStand').onclick = () => $('adObjStand').classList.toggle('on');
  const saveObj = async (spawn) => {
    const name = $('adObjName').value.trim();
    if (!name) return alert('Name the object first.');
    const f = $('adObjGlb').files[0];
    if (!f) return alert('Choose a .glb file.');
    const scale = +$('adObjScale').value || 1, stand = $('adObjStand').classList.contains('on'), collider = currentCollider(), rot = objRot();
    try {
      const url = await uploadModel(f);
      const box = await measureModel(url, scale, rot);
      const props = { model: url, box, stand, scale };
      if (collider !== 'box') props.collider = collider;
      if (rot.some((v) => Math.abs(v) > 1e-4)) props.modelRot = rot;
      save(props, name, spawn);
      clearObj();
      $('addModal').hidden = true;
    } catch (e) { alert('Model upload/load failed — make sure it is a .glb file.'); }
  };
  $('adObjSave').onclick = () => saveObj(false);
  $('adObjSpawn').onclick = () => saveObj(true);
}

// ---- Add-to-Library: skybox tab (equirect panorama or 6-face cubemap) -------
const CUBE_IDS = ['adSkyPX', 'adSkyNX', 'adSkyPY', 'adSkyNY', 'adSkyPZ', 'adSkyNZ'];
function wireAddSky() {
  const clearSky = () => {
    ['adSkyEqName', 'adSkyCubeName'].forEach((id) => { $(id).value = ''; });
    ['adSkyEq', ...CUBE_IDS].forEach(clearSq);
  };

  // every face + the panorama is a click-tile
  wireUploadSq('adSkyEq', false);
  CUBE_IDS.forEach((id) => wireUploadSq(id, false));
  const saveEq = async (apply) => {
    const name = $('adSkyEqName').value.trim();
    if (!name) return alert('Name the skybox first.');
    const f = $('adSkyEq').files[0];
    if (!f) return alert('Choose a 2:1 panorama image.');
    try {
      const url = await uploadImage(f, 2048, 1024, 'stretch', 'sky');
      ROOM.send('saveSkybox', { name, url, isPublic: false });   // private by default; publish from the library
      if (apply) ROOM.send('skybox', { url });
      clearSky();
      $('addModal').hidden = true;
    } catch (e) { alert('Upload failed.'); }
  };
  $('adSkyEqSave').onclick = () => saveEq(false);
  $('adSkyEqApply').onclick = () => saveEq(true);

  // cubemap (six square faces)
  const saveCube = async (apply) => {
    const name = $('adSkyCubeName').value.trim();
    if (!name) return alert('Name the skybox first.');
    const files = CUBE_IDS.map((id) => $(id).files[0]);
    if (files.some((f) => !f)) return alert('Pick all six faces.');
    try {
      const faces = [];
      for (const f of files) faces.push(await uploadImage(f, 1024, 1024, 'stretch', 'sky'));
      ROOM.send('saveSkybox', { name, type: 'cube', faces, isPublic: false });
      if (apply) ROOM.send('skybox', { url: JSON.stringify({ t: 'cube', f: faces }) });
      clearSky();
      $('addModal').hidden = true;
    } catch (e) { alert('Upload failed.'); }
  };
  $('adSkyCubeSave').onclick = () => saveCube(false);
  $('adSkyCubeApply').onclick = () => saveCube(true);
}

// client.js hands over the live room once connected.
window.onOttRoom = (room) => {
  ROOM = room;
  const refresh = () => { room.send('listDecks'); room.send('listBoards'); room.send('listProps'); room.send('listScenes'); room.send('listSkyboxes'); };
  // View Library (present on both the editor and the table)
  const panel = $('libraryPanel');
  if (panel) {
    $('libraryBtn').onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) refresh(); };
    $('libraryClose').onclick = () => { panel.hidden = true; };
    wireTabs(panel);
    wireSearch(panel);
    // Room Controls → Load a Scene: open the library straight to the Scenes tab.
    const roomScene = $('roomScene');
    if (roomScene) roomScene.onclick = () => {
      const rg = $('roomGrp'); if (rg) rg.hidden = true;
      panel.hidden = false;
      const scenesTab = panel.querySelector('.libTab[data-tab="scenes"]');
      if (scenesTab) scenesTab.click(); // activate via wireTabs
      refresh();
    };
  }
  // Built-in library — bundled pieces, spawn-only (client-side data, no server fetch).
  const builtin = $('builtinModal');
  if (builtin) {
    $('builtinBtn').onclick = () => { builtin.hidden = !builtin.hidden; if (!builtin.hidden) renderBuiltin(); };
    $('builtinClose').onclick = () => { builtin.hidden = true; };
    wireTabs(builtin);
    wireSearch(builtin);
  }
  // Room Controls → Skybox: two-tab apply-picker (both pages).
  const skyPick = $('skyPickModal');
  if (skyPick) {
    const rs = $('roomSky');
    if (rs) rs.onclick = () => { const rg = $('roomGrp'); if (rg) rg.hidden = true; skyPick.hidden = false; renderSkyPick(); room.send('listSkyboxes'); };
    $('skyPickClose').onclick = () => { skyPick.hidden = true; };
    wireTabs(skyPick);
  }
  // Add-to-Library builder — editor only (absent on the table).
  const addModal = $('addModal');
  if (addModal) {
    $('addBtn').onclick = () => { addModal.hidden = !addModal.hidden; };
    $('addClose').onclick = () => { addModal.hidden = true; };
    wireTabs(addModal);
    wireAddDeck();
    wireAddBoard();
    wireAddObject();
    wireAddSky();
  }
  const saveScene = $('sceneSaveBtn');
  if (saveScene) saveScene.onclick = () => { const n = prompt('Save the current table as a scene named:'); if (n && n.trim()) room.send('sceneSave', { name: n.trim() }); };
  refresh(); // prime the lists so the panel is populated on first open
};
