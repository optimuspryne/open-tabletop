// editor-panel.js — the admin library-management panel (editor.html only). It rides
// on the table engine's room connection, handed over by client.js via
// window.onOttRoom, and gets asset lists via window.onLibraryList (client.js fans
// the deckList/boardList/propList messages out to here, so the modal saved-lists
// keep working too). In the editor the admin sees private assets as well as public.
import { cardPreviewURL, propPreviewURL, boardPreviewURL, diePreviewURL, uploadImage, uploadModel, measureBoard, measureModel, glbFilePreviewURL } from './graphics.js';
import { DIE_SIDES, PROP_LIST, BOARDS } from '/shared/pieces.js';
const $ = (id) => document.getElementById(id);
const btn = (label, fn, cls) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = fn; return b; };
// Reveal one tabbed pane at a time, scoped to a modal (so multiple tabbed modals don't collide).
function wireTabs(root) {
  const tabs = [...root.querySelectorAll('.libTab')];
  tabs.forEach((tab) => tab.onclick = () => {
    tabs.forEach((t) => t.classList.toggle('on', t === tab));
    root.querySelectorAll('.libPane').forEach((pane) => { pane.hidden = pane.dataset.pane !== tab.dataset.tab; });
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
  if (!list.length) { const li = document.createElement('li'); li.className = 'libEmpty'; li.textContent = 'None yet.'; ul.appendChild(li); return; }
  for (const it of list) {
    const li = document.createElement('li'); li.className = 'libCard';
    const extra = kind === 'deck' && it.count != null ? ` \u00b7 ${it.count}` : (kind === 'board' && it.kind ? ` \u00b7 ${it.kind}` : (kind === 'sky' && typeof it.url === 'string' && it.url[0] === '{' ? ' \u00b7 cube' : ''));
    const name = document.createElement('span'); name.className = 'libName'; name.textContent = it.name + extra;
    const badge = document.createElement('span'); badge.className = 'libBadge ' + (it.isPublic ? 'pub' : 'priv'); badge.textContent = it.isPublic ? 'public' : 'private';
    const meta = document.createElement('div'); meta.className = 'libMeta'; meta.append(name, badge);
    const acts = document.createElement('div'); acts.className = 'libActs';
    // Scenes load (replace the whole editor table); skyboxes apply to the room; other assets spawn onto it.
    const primary = kind === 'scene'
      ? btn('Load', () => { if (confirm(`Load "${it.name}" into the editor? This clears the current table.`)) ROOM.send('sceneLoad', { id: it.id }); })
      : kind === 'sky'
        ? btn('Apply', () => ROOM.send('skybox', { url: it.url }))
        : btn('Spawn', () => spawnOf[kind](it));
    acts.append(primary);
    if (window.OTT_IS_ADMIN) { // library curation is site-admin only; GMs/helpers just spawn/apply
      acts.append(
        btn(it.isPublic ? 'Unpublish' : 'Publish', () => ROOM.send('assetPublic', { kind, id: it.id, isPublic: !it.isPublic })),
        btn('Rename', () => { const n = prompt('Rename:', it.name); if (n && n.trim()) ROOM.send('assetRename', { kind, id: it.id, name: n.trim() }); }),
        btn('Delete', () => { if (confirm(`Delete "${it.name}"? This cannot be undone.`)) ROOM.send('assetDelete', { kind, id: it.id }); }, 'danger'),
      );
    }
    li.append(previewEl(kind, it), meta, acts);
    ul.appendChild(li);
  }
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
  const dice = $('biDice'); dice.replaceChildren();
  for (const sides of DIE_SIDES) {
    const box = previewBox(); box.append(thumbImg(diePreviewURL(sides)));
    dice.append(builtinCard(box, 'd' + sides, 'Spawn', () => ROOM.send('spawn', { type: 'die', props: { sides } })));
  }

  const decks = $('biDecks'); decks.replaceChildren();
  { const box = previewBox('deckPreview'); box.append(thumbImg(cardPreviewURL('back')), thumbImg(cardPreviewURL('rank:A:\u2660:#000')));
    decks.append(builtinCard(box, 'Standard 52-card', 'Spawn', () => ROOM.send('spawn', { type: 'deck', props: {} }))); }

  const boards = $('biBoards'); boards.replaceChildren();
  for (const key of Object.keys(BOARDS)) {
    const box = previewBox(); fillAsync(box, boardPreviewURL(BOARDS[key].model));
    boards.append(builtinCard(box, BOARDS[key].name, 'Spawn', () => ROOM.send('spawn', { type: 'board', props: { board: key } })));
  }

  const objs = $('biObjects'); objs.replaceChildren();
  for (const p of PROP_LIST) {
    const box = previewBox(); fillAsync(box, propPreviewURL({ shape: p.id }));
    objs.append(builtinCard(box, p.name, 'Spawn', () => ROOM.send('spawn', { type: 'prop', props: { shape: p.id } })));
  }

  const sky = $('biSky'); sky.replaceChildren();
  for (const s of (window.OTT_BUILTIN_SKIES || [])) {
    const ref = s.faces ? JSON.stringify({ t: 'cube', f: s.faces }) : (s.url || '');
    const box = previewBox(); box.append(thumbImg(s.faces ? s.faces[0] : s.url));
    sky.append(builtinCard(box, s.name, 'Apply', () => ROOM.send('skybox', { url: ref })));
  }
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
    $('adImgNoCrop').checked = false; $('adImgPad').value = '#ffffff'; $('adImgPadRow').hidden = true;
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
    const noCrop = $('adImgNoCrop').checked;
    ['adImgBack', 'adImgFronts'].forEach((id) => { const sq = $(id).parentElement; sq.style.backgroundSize = noCrop ? 'contain' : 'cover'; sq.style.backgroundColor = noCrop ? $('adImgPad').value : ''; });
  };
  wireUploadSq('adImgBack', false, applyImgFit);
  wireUploadSq('adImgFronts', false, applyImgFit);
  $('adImgNoCrop').addEventListener('change', () => { $('adImgPadRow').hidden = !$('adImgNoCrop').checked; applyImgFit(); });
  $('adImgPad').addEventListener('input', applyImgFit);
  const saveImg = async (spawn) => {
    const name = $('adImgName').value.trim();
    if (!name) return alert('Name the deck first.');
    const frontFiles = [...$('adImgFronts').files];
    if (!frontFiles.length) return alert('Choose at least one front image.');
    const noCrop = $('adImgNoCrop').checked;      // 'contain' fits the whole image (no crop); pad fills the leftover
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
  const clearObj = () => {
    ['adObjName'].forEach((id) => { $(id).value = ''; });
    $('adObjScale').value = '1'; $('adObjStand').checked = false; setCollider('box');
    clearSq('adObjGlb');
  };
  wireUploadSq('adObjGlb', true);
  const saveObj = async (spawn) => {
    const name = $('adObjName').value.trim();
    if (!name) return alert('Name the object first.');
    const f = $('adObjGlb').files[0];
    if (!f) return alert('Choose a .glb file.');
    const scale = +$('adObjScale').value || 1, stand = $('adObjStand').checked, collider = currentCollider();
    try {
      const url = await uploadModel(f);
      const box = await measureModel(url, scale);
      const props = { model: url, box, stand, scale };
      if (collider !== 'box') props.collider = collider;
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
  }
  // Built-in library — bundled pieces, spawn-only (client-side data, no server fetch).
  const builtin = $('builtinModal');
  if (builtin) {
    $('builtinBtn').onclick = () => { builtin.hidden = !builtin.hidden; if (!builtin.hidden) renderBuiltin(); };
    $('builtinClose').onclick = () => { builtin.hidden = true; };
    wireTabs(builtin);
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
