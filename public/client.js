import * as THREE from 'three';
import { CONFIG, clamp, scene, camera, renderer, controls } from './core.js';
import { KIND, cTex, cardMesh, propColor, measureModel, measureBoard, resizeToCanvas, splitColorText, uploadImage, uploadModel } from './graphics.js';
import { KINDS as PHYS, PROPS, PROP_LIST, COLORS, BOARDS, DIE_SIDES, deckHeight } from '/shared/pieces.js';

function sendDeck(back, fronts, name) { // build the deck in small batches so no single message is large
  room.send('deckBegin', { back });
  for (let i = 0; i < fronts.length; i += 50) room.send('deckAppend', { fronts: fronts.slice(i, i + 50) });
  room.send('deckFinish', name ? { name } : {}); // name -> also save it to the library
}

// ===== networking ===========================================================
const { Client, getStateCallbacks } = Colyseus;
const statusEl = document.getElementById('status');
const meshes = new Map();  // id -> { mesh }
const buffers = new Map(); // id -> [{ t, x,y,z, qx,qy,qz,qw }]  recent server states, for interpolation
let room, mySession, heldId = null;
const heldTarget = new THREE.Vector3(); // drag target sent to the server
(async () => {
  const client = new Client(location.origin.replace(/^http/, 'ws'));
  const saved = sessionStorage.getItem('tt_token'); // per-tab: survives refresh, distinct across browsers/tabs
  if (saved) { try { room = await client.reconnect(saved); } catch (e) { room = null; } }
  if (!room) room = await client.joinOrCreate('table');
  sessionStorage.setItem('tt_token', room.reconnectionToken);
  mySession = room.sessionId;
  statusEl.innerHTML = 'connected · <b>you</b>';
  const cb = getStateCallbacks(room); // Colyseus state-change callbacks (NOT jQuery)

  cb(room.state).pieces.onAdd((piece, id) => {
    const mesh = KIND[piece.type].mesh(JSON.parse(piece.props || '{}'));
    const cast = PHYS[piece.type].mass > 0;
    mesh.position.set(piece.x, piece.y, piece.z);
    mesh.quaternion.set(piece.qx, piece.qy, piece.qz, piece.qw);
    mesh.traverse(o => { o.userData.id = id; if (o.isMesh) { o.castShadow = cast; o.receiveShadow = true; } }); // group children too
    scene.add(mesh);
    meshes.set(id, { mesh, type: piece.type });
    buffers.set(id, [{ t: performance.now(), x:piece.x, y:piece.y, z:piece.z, qx:piece.qx, qy:piece.qy, qz:piece.qz, qw:piece.qw }]);
    if (piece.type === 'deck') { // stack height reflects how many cards remain
      const setH = (c) => { mesh.scale.y = deckHeight(c); }; // extruded prism is unit-height
      setH(piece.count); cb(piece).listen('count', setH);
    }
    if (piece.type === 'card') { // swap face<->back when the card is flipped/revealed (props gains/loses rank)
      cb(piece).listen('props', () => rebuildCard(id, piece), false);
    }
    if (piece.type === 'board') { const bp = JSON.parse(piece.props || '{}'); // remember the surface height for the drop marker
      const bd = bp.board && BOARDS[bp.board], box = bd ? bd.box : ((bp.model && Array.isArray(bp.box)) ? bp.box : null);
      boardTopY = box ? box[1] * 2 : 0.1; }
  });
  cb(room.state).pieces.onRemove((piece, id) => {
    const e = meshes.get(id); if (e) scene.remove(e.mesh);
    if (piece.type === 'board') boardTopY = 0; // back to bare table until a new board arrives
    if (inspect && inspect.origId === id) releaseInspect();
    meshes.delete(id); buffers.delete(id);
  });

  // Record one timestamped snapshot per piece on every patch (~server patch rate).
  // The render loop plays these back interpolated and slightly delayed → smooth at any speed.
  room.onStateChange((state) => {
    const t = performance.now();
    state.pieces.forEach((p, id) => {
      const buf = buffers.get(id); if (!buf) return;
      buf.push({ t, x:p.x, y:p.y, z:p.z, qx:p.qx, qy:p.qy, qz:p.qz, qw:p.qw });
      if (buf.length > 24) buf.shift();
    });
  });

  room.onMessage('hand', renderHand); // your private hand — never seen by other clients
  room.onMessage('inspectCard', ({ front, back }) => inspectMesh(cardMesh({ front, back }), { drawn: true, type: 'card' })); // drawn card — front is ours alone
  room.onMessage('dealt', ({ id }) => { // a card you dragged off a deck — adopt it as the dragged piece
    if (down && down.pendingDeal) {
      down.id = id; down.type = 'card'; down.k = KIND.card; down.grabbed = true; down.pendingDeal = false;
      room.send('move', { id, x: hit.x, y: hit.y, z: hit.z });
    } else {
      room.send('release', { id, v: [0, 0, 0] }); // gesture already ended — just drop it
    }
  });

  // seats, turn order, and other players' fanned hand-backs (all public info)
  cb(room.state).players.onAdd((player, sid) => {
    if (sid === mySession) { applySeat(player.seat); document.getElementById('nameInput').value = player.name; updateMyPreview(player.avatar); }
    refreshFan(sid); refreshMarker(sid); renderPlayers();
    cb(player).listen('hand', () => { refreshFan(sid); renderPlayers(); }, false);
    cb(player).listen('seat', () => { if (sid === mySession) applySeat(player.seat); refreshFan(sid); refreshMarker(sid); }, false);
    cb(player).listen('name', () => { refreshMarker(sid); renderPlayers(); }, false);
    cb(player).listen('avatar', () => { if (sid === mySession) updateMyPreview(player.avatar); else refreshMarker(sid); renderPlayers(); }, false);
    cb(player).listen('color', () => { refreshMarker(sid); renderPlayers(); }, false);
  });
  cb(room.state).players.onRemove((player, sid) => { removePlayerVis(sid); renderPlayers(); });
  cb(room.state).listen('turn', renderPlayers, false);

  const diceGrp = document.getElementById('diceGrp');
  const diceBtn = document.getElementById('diceBtn');
  diceBtn.onclick = (e) => { e.stopPropagation(); diceGrp.hidden = !diceGrp.hidden; };
  diceGrp.onclick = (e) => e.stopPropagation();           // clicks inside don't close it
  document.addEventListener('click', () => diceGrp.hidden = true);  // click anywhere else closes it
  for (const sides of DIE_SIDES) {
    const b = document.createElement('button'); b.textContent = '+ d' + sides;
    b.onclick = () => { room.send('spawn', { type: 'die', props: { sides } });};
    diceGrp.appendChild(b);
  }
  document.querySelectorAll('[data-spawn]').forEach(b => b.onclick = () => {
    const type = b.dataset.spawn;
    let props = {};
    if (type === 'card') { // match the standard-deck ref format: rank:<rank>:<suite>:<color>
      const s = [['♠','#000000'],['♥','#bd2500'],['♦','#bd2500'],['♣','#000000']][Math.random()*4|0];
      const rank = ['A','2','Q','9','J','K'][Math.random()*6|0];
      props = { front: `rank:${rank}:${s[0]}:${s[1]}`, back: 'back' };
    }
    document.getElementById('deckModal').hidden = true;
    room.send('spawn', { type, props });
  });
  room.onMessage('deckList', decks => {
    const el = document.getElementById('savedList'); el.innerHTML = '';
    if (!decks.length) { el.innerHTML = '<div class="note">none saved yet</div>'; return; }
    for (const d of decks) {
      const row = document.createElement('div'); row.className = 'savedRow';
      const label = document.createElement('span'); label.textContent = `${d.name} · ${d.count}`; // textContent = safe from HTML in names
      const btn = document.createElement('button'); btn.textContent = 'Load';
      btn.onclick = () => { room.send('loadDeck', { slug: d.slug }); document.getElementById('deckModal').hidden = true; };
      const ed = document.createElement('button'); ed.textContent = 'Edit'; ed.onclick = () => openEditDeck(d);
      row.append(label, ed, btn); el.appendChild(row);
    }
  });
  document.getElementById('newDeck').onclick = () => { document.getElementById('deckModal').hidden = false; room.send('listDecks'); };

  // Prop picker
  const propShapeSel = document.getElementById('propShape');
  for (const s of PROP_LIST) { const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; propShapeSel.appendChild(o); }
  const syncPropControls = () => { const team = !!(PROP_LIST.find(s => s.id === propShapeSel.value) || {}).team;
    const d = PROPS[propShapeSel.value] || {}, own = !!d.ownMaterial && !d.tintMaterial; // own-material models get no colour picker (unless they tint one slot)
    document.getElementById('propColorWrap').hidden = team || own; document.getElementById('propTeamWrap').hidden = !team;
    document.getElementById('propStand').checked = !!(PROPS[propShapeSel.value] || {}).stand; }; // default to the shape's behavior
  propShapeSel.onchange = syncPropControls; syncPropControls();
  document.getElementById("newProp").onclick = () => { document.getElementById("propModal").hidden = false; };
  document.getElementById('propCustom').onclick = () => { document.getElementById('propModal').hidden = true; document.getElementById('customPropModal').hidden = false; room.send('listProps'); };
  document.getElementById('cpCancel').onclick = () => document.getElementById('customPropModal').hidden = true;
  document.getElementById('cpTintColor').oninput = () => { document.querySelector('input[name="cpColorMode"][value="tint"]').checked = true; }; // picking a colour means you want it tinted
  // ---- edit / clone a saved model prop (client-side; scale re-derives the collider box) ----
  let editingProp = null;
  window.openEditProp = (sp) => { editingProp = sp; const p = sp.props || {};
    document.getElementById('editPropModel').textContent = 'model: ' + (p.model || '').split('/').pop();
    document.getElementById('editPropScale').value = p.scale || 1;
    document.getElementById('editPropStand').checked = !!p.stand;
    document.querySelector('input[name="editPropColorMode"][value="' + (p.color != null ? 'tint' : 'own') + '"]').checked = true;
    if (p.color != null) document.getElementById('editPropTintColor').value = '#' + (p.color >>> 0).toString(16).padStart(6, '0');
    document.getElementById('editPropName').value = sp.name + ' copy';
    document.getElementById('editPropModal').hidden = false; };
  const buildEditedProp = () => { const p = editingProp.props || {};
    const scale = clamp(+document.getElementById('editPropScale').value || 1, ...CONFIG.ranges.scale);
    const ratio = scale / (p.scale || 1);
    const props = { model: p.model, box: (p.box || [0.5,0.5,0.5]).map(v => v * ratio), stand: document.getElementById('editPropStand').checked, scale };
    if (document.querySelector('input[name="editPropColorMode"]:checked').value === 'tint') props.color = parseInt(document.getElementById('editPropTintColor').value.slice(1), 16);
    return props; };
  document.getElementById('editPropCancel').onclick = () => document.getElementById('editPropModal').hidden = true;
  document.getElementById('editPropSave').onclick = () => { room.send('saveProp', { name: editingProp.name, props: buildEditedProp() }); document.getElementById('editPropModal').hidden = true; };
  document.getElementById('editPropCopy').onclick = () => { const name = document.getElementById('editPropName').value.trim(); if (!name) { alert('Enter a copy name.'); return; } room.send('saveProp', { name, props: buildEditedProp() }); document.getElementById('editPropModal').hidden = true; };

  // ---- edit / clone a saved deck (shallow: replace back + append cards; server applies the deltas) ----
  let editingDeck = null;
  window.openEditDeck = (d) => { editingDeck = d;
    document.getElementById('editDeckInfo').textContent = d.name + ' · ' + d.count + ' cards';
    document.getElementById('editDeckBack').value = ''; document.getElementById('editDeckText').value = ''; document.getElementById('editDeckImgs').value = '';
    document.getElementById('editDeckName').value = d.name + ' copy';
    document.getElementById('editDeckModal').hidden = false; };
  async function commitDeckEdit(saveAs) {
    const btns = ['editDeckSave','editDeckCopy'].map(id => document.getElementById(id));
    const name = saveAs ? document.getElementById('editDeckName').value.trim() : editingDeck.name;
    if (saveAs && !name) { alert('Enter a copy name.'); return; }
    btns.forEach(b => b.disabled = true);
    try {
      let back; const backFile = document.getElementById('editDeckBack').files[0];
      if (backFile) back = await uploadImage(backFile, CONFIG.upload.cardW, CONFIG.upload.cardH, undefined, 'decks');
      const addFronts = [];
      const fc = document.getElementById('editDeckFaceColor').value, bg = document.getElementById('editDeckFaceBg').value;
      for (const line of document.getElementById('editDeckText').value.split('\n').map(l => l.trim()).filter(Boolean)) addFronts.push('text:' + fc + ':' + bg + ':' + line);
      for (const im of document.getElementById('editDeckImgs').files) addFronts.push(await uploadImage(im, CONFIG.upload.cardW, CONFIG.upload.cardH, undefined, 'decks'));
      room.send('editDeck', { slug: editingDeck.slug, name, back, addFronts, saveAs });
      document.getElementById('editDeckModal').hidden = true;
    } catch (e) { alert('Edit failed \u2014 an image upload may have errored.'); }
    btns.forEach(b => b.disabled = false);
  }
  document.getElementById('editDeckCancel').onclick = () => document.getElementById('editDeckModal').hidden = true;
  document.getElementById('editDeckSave').onclick = () => commitDeckEdit(false);
  document.getElementById('editDeckCopy').onclick = () => commitDeckEdit(true);

  room.onMessage("propList", props => {
    const el = document.getElementById("propSavedList"); el.innerHTML = "";
    for (const sp of props) {
      const row = document.createElement("div"); row.className = "savedRow";
      const label = document.createElement("span"); label.textContent = sp.name;
      const b = document.createElement("button"); b.textContent = "Spawn";
      b.onclick = () => room.send("spawn", { type: "prop", props: sp.props });
      const ed = document.createElement("button"); ed.textContent = "Edit"; ed.onclick = () => openEditProp(sp);
      row.append(label, ed, b); el.appendChild(row);
    }
  });
  document.getElementById('propCancel').onclick = () => document.getElementById('propModal').hidden = true;
  document.getElementById('propSpawn').onclick = () => { // built-in shape prop
    const shape = propShapeSel.value, team = !!(PROP_LIST.find(s => s.id === shape) || {}).team;
    const props = team ? { shape, team: +document.getElementById('propTeam').value }
                       : { shape, color: parseInt(document.getElementById('propColor').value.slice(1), 16) };
    props.stand = document.getElementById('propStand').checked;
    props.scale = clamp(+document.getElementById('propScale').value || 1, ...CONFIG.ranges.scale);
    const qty = clamp(+document.getElementById('propQty').value || 1, ...CONFIG.ranges.qty);
    for (let i = 0; i < qty; i++) room.send('spawn', { type: 'prop', props });
    document.getElementById('propModal').hidden = true;
  };
  document.getElementById('cpSpawn').onclick = async () => { // custom .glb prop
    const btn = document.getElementById('cpSpawn');
    const modelFile = document.getElementById('cpModel').files[0];
    if (!modelFile) { alert('Choose a .glb file first.'); return; }
    const stand = document.getElementById('cpStand').checked;
    const qty = clamp(+document.getElementById('cpQty').value || 1, ...CONFIG.ranges.qty);
    const scale = clamp(+document.getElementById('cpScale').value || 1, ...CONFIG.ranges.scale);
    const lbl = btn.textContent; btn.disabled = true; btn.textContent = 'Uploading…';
    try {
      const color = document.querySelector('input[name="cpColorMode"]:checked').value === 'tint' ? parseInt(document.getElementById('cpTintColor').value.slice(1), 16) : null;
      const url = await uploadModel(modelFile);
      const box = await measureModel(url, scale);
      const props = { model: url, box, stand, scale };
      if (color != null) props.color = color;
      for (let i = 0; i < qty; i++) room.send('spawn', { type: 'prop', props });
      const saveName = document.getElementById('cpName').value.trim();
      if (saveName) room.send('saveProp', { name: saveName, props });
    } catch (e) { btn.disabled = false; btn.textContent = lbl; alert('Model upload/load failed — make sure it is a .glb file.'); return; }
    btn.disabled = false; btn.textContent = lbl; document.getElementById('cpModel').value = ''; document.getElementById('cpName').value = '';
    document.getElementById('customPropModal').hidden = true;
  };
    document.getElementById("newBoard").onclick = () => { document.getElementById("boardModal").hidden = false; room.send("listBoards"); };
  { const bb = document.getElementById("builtinBoards"); // built-in model boards
    for (const key of Object.keys(BOARDS)) { const b = document.createElement("button"); b.textContent = BOARDS[key].name;
      b.onclick = () => { room.send("spawn", { type: "board", props: { board: key } }); document.getElementById("boardModal").hidden = true; }; bb.appendChild(b); } }
  document.getElementById("boardModelSpawn").onclick = async () => { const btn = document.getElementById("boardModelSpawn");
    const file = document.getElementById("boardModel").files[0]; if (!file) { alert("Choose a .glb file first."); return; }
    const lbl = btn.textContent; btn.disabled = true; btn.textContent = "Uploading\u2026";
    try { const url = await uploadModel(file); const { scale, box } = await measureBoard(url);
      room.send("spawn", { type: "board", props: { model: url, modelScale: scale, box } }); }
    catch (e) { btn.disabled = false; btn.textContent = lbl; alert("Board model upload/load failed \u2014 make sure it is a .glb file."); return; }
    btn.disabled = false; btn.textContent = lbl; document.getElementById("boardModel").value = ""; document.getElementById("boardModal").hidden = true; };
  document.getElementById("boardSave").onclick = () => {
    let board = null; room.state.pieces.forEach(p => { if (p.type === "board") board = JSON.parse(p.props || "{}"); });
    if (!board) { alert("No board on the table to save."); return; }
    const name = prompt("Save board as:"); if (name && name.trim()) room.send("saveBoard", { name: name.trim(), board });
  };
  room.onMessage("boardList", boards => {
    const el = document.getElementById("boardSavedList"); el.innerHTML = "";
    for (const b of boards) {
      const row = document.createElement("div"); row.className = "savedRow";
      const label = document.createElement("span"); label.textContent = b.name + (b.kind ? " (" + b.kind + ")" : "");
      const btn = document.createElement("button"); btn.textContent = "Load";
      btn.onclick = () => { room.send("loadBoard", { slug: b.slug }); document.getElementById("boardModal").hidden = true; };
      row.append(label, btn); el.appendChild(row);
    }
  });
  document.getElementById('boardCancel').onclick = () => document.getElementById('boardModal').hidden = true;
  document.getElementById('boardCreate').onclick = async () => {
    const btn = document.getElementById('boardCreate');
    const w = clamp(+document.getElementById('boardW').value || 8, ...CONFIG.ranges.boardW);
    const d = clamp(+document.getElementById('boardD').value || 8, ...CONFIG.ranges.boardD);
    const imgFile = document.getElementById('boardImg').files[0];
    const props = { w, d };
    if (imgFile) { const lbl = btn.textContent; btn.disabled = true; btn.textContent = 'Uploading…';
      try { props.tex = await uploadImage(imgFile, CONFIG.upload.board, CONFIG.upload.board, 'stretch', 'boards'); } catch (e) { btn.disabled = false; btn.textContent = lbl; alert('Image upload failed.'); return; }
      btn.disabled = false; btn.textContent = lbl; }
    room.send('spawn', { type: 'board', props });
    document.getElementById('boardModal').hidden = true;
    document.getElementById('boardImg').value = '';
  };
  document.getElementById('deckCancel').onclick = () => document.getElementById('deckModal').hidden = true;
  document.querySelectorAll('input[name=deckMode]').forEach(r => r.onchange = () => {
    const text = document.querySelector('input[name=deckMode]:checked').value === 'text';
    document.getElementById('textMode').hidden = !text; document.getElementById('imageMode').hidden = text;
  });
  const parseFaces = raw => { raw = raw.trim(); if (!raw) return [];
    if (raw[0] === '[') { try { const a = JSON.parse(raw); if (Array.isArray(a)) return a.map(String).map(s => s.trim()).filter(Boolean); } catch {} }
    return raw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean); };
  document.getElementById('deckCreate').onclick = async () => {
    const btn = document.getElementById('deckCreate');
    const mode = document.querySelector('input[name=deckMode]:checked').value;
    let back = 'back', fronts = [];
    if (mode === 'text') {
      const faces = parseFaces(document.getElementById('faceText').value);
      if (!faces.length) return;
      const faceColor = document.getElementById('faceColor').value;
      fronts = faces.map(t => 'text:' + faceColor + ':' + document.getElementById('faceBg').value + ':' + t);
      const btext = document.getElementById('backText').value.trim();
      back = 'tback:' + document.getElementById('backColor').value + ':' + document.getElementById('backTextColor').value + ':' + btext;
    } else {
      const backFile = document.getElementById('deckBack').files[0];
      const frontFiles = [...document.getElementById('deckFronts').files];
      if (!frontFiles.length) return;
      const label = btn.textContent; btn.disabled = true; // uploads happen over HTTP, one image at a time
      try {
        let done = 0;
        if (backFile) back = await uploadImage(backFile, CONFIG.upload.cardW, CONFIG.upload.cardH, undefined, 'decks');
        for (const f of frontFiles) { fronts.push(await uploadImage(f, CONFIG.upload.cardW, CONFIG.upload.cardH, undefined, 'decks')); btn.textContent = `Uploading ${++done}/${frontFiles.length}…`; }
      } catch (e) { btn.disabled = false; btn.textContent = label; alert('Image upload failed.'); return; }
      btn.disabled = false; btn.textContent = label;
    }
    sendDeck(back, fronts, document.getElementById('deckSaveName').value.trim() || undefined);
    document.getElementById('deckModal').hidden = true;
    document.getElementById('deckBack').value = ''; document.getElementById('deckFronts').value = ''; document.getElementById('faceText').value = ''; document.getElementById('deckSaveName').value = '';
  };
  document.getElementById('roll').onclick  = () => room.send('roll');
  document.getElementById('nextTurn').onclick = () => room.send('nextTurn');
  document.getElementById('nameInput').addEventListener('change', e => {
    const name = e.target.value.trim(); if (name) room.send('setName', { name });
  });
  document.getElementById('avatarInput').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    const c = await resizeToCanvas(file, 96, 96);            // small square keeps the data-URL tiny for state sync
    room.send('setAvatar', { data: c.toDataURL('image/jpeg', 0.7) });
  });
  document.getElementById('reset').onclick = () => room.send('reset');
})().catch(err => { statusEl.textContent = 'connection failed'; console.error(err); });

// ===== interaction — click vs. drag, meaning depends on the piece ===========
const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
const GRAB_HEIGHT = CONFIG.grab.height; // starting float height when a piece is grabbed — scroll to raise/lower
const DRAG_MIN = CONFIG.grab.min, DRAG_MAX = CONFIG.grab.max, DRAG_STEP = CONFIG.grab.step;
const DECK_DRAG_HEIGHT = CONFIG.grab.deckHeight; // dealt cards ride this high to clear the deck
let dragHeight = GRAB_HEIGHT;
const dragPlane = new THREE.Plane(new THREE.Vector3(0,1,0), -GRAB_HEIGHT), hit = new THREE.Vector3();
const prevTarget = new THREE.Vector3(), throwVel = new THREE.Vector3(); // hand speed -> throw
let lastMoveSent = 0, prevThrowTime = 0, down = null;
const setP = e => { pointer.x=e.clientX/innerWidth*2-1; pointer.y=-(e.clientY/innerHeight)*2+1; };
const pickId = () => { ray.setFromCamera(pointer,camera);
  let o = ray.intersectObjects([...meshes.values()].map(m=>m.mesh))[0]?.object;
  while (o && o.userData.id === undefined) o = o.parent; // model children live below the id-stamped group
  return o && o.userData.id; };

renderer.domElement.addEventListener('contextmenu', e => e.preventDefault()); // right-click is ours
renderer.domElement.addEventListener('mousedown', e => { // middle-click snaps a held piece's facing to 90°
  if (e.button === 1) { e.preventDefault(); if (down && down.grabbed) room.send('snap', { id: down.id }); } });
document.getElementById('hintHead').onclick = () => { const h = document.getElementById('hint'); const c = h.classList.toggle('collapsed');
  document.getElementById('hintToggle').innerHTML = c ? 'Show &#9656;' : 'Hide &#9662;'; }; // collapsible controls panel
document.querySelectorAll('[data-place]').forEach(b => b.onclick = () => placeDrawn(b.dataset.place)); // drawn-card placement

const sendAction = (action, id) => {           // click actions -> server messages
  if (action === 'takeCard') room.send('takeCard', { id });
  else if (action === 'deal') room.send('dealToTable', { deckId: id });
  else if (action === 'flip') room.send('flip', { id });
  else if (action === 'shuffle') room.send('shuffle', { deckId: id });
};

// ----- inspect: freeze an enlarged item in front of the camera --------------
// Local & visual. Two entries: (a) inspect an on-table piece by cloning its
// scene mesh (a face-down card is back-only, so nothing leaks); (b) DRAW a card
// from a deck, whose front the server sends privately to us alone, then place it.
let inspect = null;                                     // { pivot, origId, drag, drawn, placed }
let pendingClick = null;                                // defers a single-click so a double-click can pre-empt it
const INSPECTABLE = t => t === 'die' || t === 'card' || t === 'prop'; // not boards/decks
function inspectMesh(mesh, opts = {}) {                 // core: park `mesh` in front of the camera
  releaseInspect();
  mesh.position.set(0,0,0); mesh.rotation.set(0,0,0); mesh.scale.set(1,1,1); mesh.visible = true;
  const box = new THREE.Box3().setFromObject(mesh), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const s = CONFIG.inspect.fit / (Math.max(size.x, size.y, size.z) || 1); // scale everything to a similar viewing size
  mesh.position.copy(center).multiplyScalar(-1);          // center within the pivot
  const pivot = new THREE.Group(); pivot.add(mesh); pivot.scale.setScalar(s);
  if (opts.type === 'card') pivot.rotateX(Math.PI / 2);   // a card lies flat (face = +Y); stand it up
  if (!camera.parent) scene.add(camera);                  // camera must be in the graph for its children to render
  camera.add(pivot); pivot.position.set(0, -CONFIG.inspect.drop, -CONFIG.inspect.dist);
  inspect = { pivot, origId: opts.origId || null, drag: null, drawn: !!opts.drawn, placed: false };
  controls.enabled = false;
  document.getElementById('inspectHint').hidden = !!opts.drawn; // a drawn card shows the action panel instead
  document.getElementById('drawActions').hidden = !opts.drawn;
}
function enterInspect(id) {                              // inspect an on-table piece
  const entry = meshes.get(id); if (!entry) return;
  inspectMesh(entry.mesh.clone(true), { origId: id, type: entry.type }); // clone -> respects hidden info
  entry.mesh.visible = false;                            // hide the real piece behind its big copy
}
function releaseInspect() {
  if (!inspect) return;
  if (inspect.drawn && !inspect.placed) room.send('inspectPlace', { where: 'deck' }); // closed without choosing -> back to deck
  camera.remove(inspect.pivot);                          // shares geometry/materials — never dispose
  const entry = inspect.origId && meshes.get(inspect.origId); if (entry) entry.mesh.visible = true;
  inspect = null; controls.enabled = true;
  document.getElementById('inspectHint').hidden = true;
  document.getElementById('drawActions').hidden = true;
}
function placeDrawn(where) {                             // resolve a drawn card: field-up | field-down | hand | deck
  if (!inspect || !inspect.drawn) return;
  room.send('inspectPlace', { where }); inspect.placed = true; releaseInspect();
}
function handleClick(d) {                                // called on a click (no drag); left double-click is meaningful
  const id = d.id, btn = d.button, type = d.type;
  const wantsDouble = btn === 0 && (INSPECTABLE(type) || type === 'deck'); // inspect a piece, or draw from a deck
  if (wantsDouble) {
    if (pendingClick && pendingClick.id === id && performance.now() - pendingClick.t < CONFIG.input.dblMs) {
      clearTimeout(pendingClick.timer); pendingClick = null;
      if (type === 'deck') room.send('drawInspect', { deckId: id }); else enterInspect(id); // double-click
    } else {
      if (pendingClick) clearTimeout(pendingClick.timer);
      const act = d.k.lclick;                              // undefined for die/prop -> harmless no-op
      pendingClick = { id, t: performance.now(), timer: setTimeout(() => { pendingClick = null; sendAction(act, id); }, CONFIG.input.clickMs) };
    }
  } else sendAction(btn === 0 ? d.k.lclick : d.k.rclick, id); // right-click / non-inspectable: fire immediately
}
renderer.domElement.addEventListener('pointerdown', e => {
  if (inspect) { if (e.button === 0) { inspect.drag = { sx:e.clientX, sy:e.clientY, px:e.clientX, py:e.clientY, moved:false }; renderer.domElement.setPointerCapture(e.pointerId); } return; }
  if (!room || (e.button !== 0 && e.button !== 2)) return;
  setP(e); const id = pickId();
  if (!id) { down = null; return; }              // empty felt -> OrbitControls orbits/pans
  const type = meshes.get(id).type;
  down = { id, type, k: KIND[type], button: e.button, sx: e.clientX, sy: e.clientY, dragging: false, grabbed: false };
  controls.enabled = false;                      // this gesture belongs to the piece
  dragHeight = GRAB_HEIGHT; dragPlane.constant = -GRAB_HEIGHT; // every grab starts at the base height
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('wheel', e => {
  if (!(down && down.grabbed)) return;           // holding a piece? scroll adjusts its height; otherwise OrbitControls zooms
  e.preventDefault();
  dragHeight = Math.max(DRAG_MIN, Math.min(DRAG_MAX, dragHeight - Math.sign(e.deltaY) * DRAG_STEP)); // scroll up = higher
  dragPlane.constant = -dragHeight;
  ray.setFromCamera(pointer, camera); ray.ray.intersectPlane(dragPlane, hit); // re-place under the cursor at the new height
  room.send('move', { id: down.id, x: hit.x, y: hit.y, z: hit.z });
}, { passive: false });
renderer.domElement.addEventListener('pointermove', e => {
  if (inspect) { const d = inspect.drag; if (d) { const dx = e.clientX - d.px, dy = e.clientY - d.py; d.px = e.clientX; d.py = e.clientY;
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > CONFIG.input.inspectPx) d.moved = true;
    inspect.pivot.quaternion.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(dy * 0.01, dx * 0.01, 0))); } return; } // screen-aligned trackball
  if (!down) return;
  setP(e); ray.setFromCamera(pointer, camera); ray.ray.intersectPlane(dragPlane, hit);
  if (!down.dragging) {
    if (Math.hypot(e.clientX - down.sx, e.clientY - down.sy) < CONFIG.input.dragPx) return; // still a click
    down.dragging = true;
    const k = down.k;
    if (down.button === k.grab) {                 // the button that moves this kind (2 = deck, 0 = most)
      down.grabbed = true;
      heldTarget.copy(hit); prevTarget.copy(hit); prevThrowTime = performance.now(); throwVel.set(0,0,0);
      room.send('grab', { id: down.id });
      room.send('move', { id: down.id, x: hit.x, y: hit.y, z: hit.z });
    } else if (down.button === 0 && k.ldrag === 'deal') { // deck left-drag = deal a card and carry it
      down.pendingDeal = true;
      dragHeight = DECK_DRAG_HEIGHT; dragPlane.constant = -dragHeight; // lift above the deck so the dealt card doesn't fight its collider
      ray.setFromCamera(pointer, camera); ray.ray.intersectPlane(dragPlane, hit); // recompute the target at the higher plane
      heldTarget.copy(hit); prevTarget.copy(hit); prevThrowTime = performance.now(); throwVel.set(0,0,0);
      room.send('dealDrag', { deckId: down.id, x: hit.x, y: hit.y, z: hit.z });
    }
  }
  if (down.grabbed) {
    heldTarget.copy(hit);
    const now = performance.now(), dtv = (now - prevThrowTime) / 1000;
    if (dtv > 0 && dtv < 0.1) throwVel.lerp(hit.clone().sub(prevTarget).multiplyScalar(1/dtv), 0.4);
    prevTarget.copy(hit); prevThrowTime = now;
    if (now - lastMoveSent > 16) { room.send('move', { id: down.id, x: hit.x, y: hit.y, z: hit.z }); lastMoveSent = now; }
  }
});
const endGesture = e => {
  if (inspect) { const d = inspect.drag; if (d) { inspect.drag = null; // clear first — releaseInspect() nulls `inspect`
    try { renderer.domElement.releasePointerCapture(e.pointerId); } catch {}
    if (!d.moved) releaseInspect(); } return; } // click (no drag) closes
  if (!down) return;
  if (down.grabbed) {
    const v = down.k.grab === 2 ? [0,0,0] : [throwVel.x, throwVel.y, throwVel.z]; // decks don't fly
    room.send('release', { id: down.id, v });
  } else if (!down.dragging) {                    // a click / tap
    handleClick(down);
  }
  controls.enabled = !inspect;                     // stay disabled if this click just entered inspect
  try { renderer.domElement.releasePointerCapture(e.pointerId); } catch {}
  down = null;
};
renderer.domElement.addEventListener('pointerup', endGesture);
renderer.domElement.addEventListener('pointercancel', endGesture);

// Delete / Backspace removes the hovered/held piece; S saves a hovered deck
addEventListener('keydown', e => {
  if (!room) return;
  if (e.key === 'Escape' && inspect) { releaseInspect(); return; }
  if (inspect && inspect.drawn) { const w = { f:'field-up', d:'field-down', h:'hand', r:'deck' }[e.key.toLowerCase()]; if (w) { placeDrawn(w); return; } }
  if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return; // typing
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (e.key === 'Backspace') e.preventDefault();
    const id = (down && down.id) || pickId();
    if (id) { room.send('remove', { id }); if (down && down.id === id) { down = null; controls.enabled = true; } }
  } else if (e.key === 'u' || e.key === 'U') {          // toggle keep-upright / lie-flat on the held or hovered piece
    const id = (down && down.id) || pickId();
    if (id) room.send('setStand', { id });
  } else if (e.key === 's' || e.key === 'S') {
    const id = (down && down.id) || pickId(); // held or hovered
    if (id && meshes.get(id).type === 'deck') {
      const name = prompt('Save this deck as:'); // saves its current cards to the shared library
      if (name && name.trim()) room.send('saveDeck', { deckId: id, name: name.trim() });
    }
  }
});

// swap a card's mesh between face and back when it's revealed/hidden (props gains/loses rank)
function rebuildCard(id, piece) {
  const entry = meshes.get(id); if (!entry) return;
  scene.remove(entry.mesh);
  const mesh = KIND.card.mesh(JSON.parse(piece.props || '{}'));
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.id = id;
  const buf = buffers.get(id), s = buf && buf[buf.length - 1];
  if (s) { mesh.position.set(s.x, s.y, s.z); mesh.quaternion.set(s.qx, s.qy, s.qz, s.qw); }
  scene.add(mesh); entry.mesh = mesh;
}

// hidden hand: a private bottom bar only this client ever sees
let handDrag = null; // dragging a card out of the hand onto the table
addEventListener('pointermove', e => {
  if (!handDrag) return;
  if (!handDrag.dragging) {
    if (Math.hypot(e.clientX - handDrag.sx, e.clientY - handDrag.sy) < CONFIG.input.handPx) return;
    handDrag.dragging = true;
    document.body.style.userSelect = document.body.style.webkitUserSelect = 'none'; // stop text-selection sweep
    const sel = window.getSelection && window.getSelection(); if (sel) sel.removeAllRanges();
    const g = handDrag.el.cloneNode(true); // ghost that follows the cursor
    Object.assign(g.style, { position:'fixed', pointerEvents:'none', opacity:'0.85', zIndex:'50', margin:'0', transform:'translate(-50%,-50%)' });
    document.body.appendChild(g); handDrag.ghost = g;
  }
  handDrag.ghost.style.left = e.clientX + 'px'; handDrag.ghost.style.top = e.clientY + 'px';
});
addEventListener('pointerup', e => {
  if (!handDrag) return;
  const hd = handDrag; handDrag = null;
  document.body.style.userSelect = document.body.style.webkitUserSelect = ''; // re-enable selection
  if (hd.ghost) hd.ghost.remove();
  if (!hd.dragging) { room.send('playCard', { hid: hd.hid, faceDown: hd.faceDown }); return; } // a click = quick play
  if (document.elementFromPoint(e.clientX, e.clientY) !== renderer.domElement) return; // dropped on UI -> cancel
  setP(e); ray.setFromCamera(pointer, camera); ray.ray.intersectPlane(dragPlane, hit); // where on the table
  room.send('playCard', { hid: hd.hid, faceDown: hd.faceDown, x: hit.x, z: hit.z });
});
function renderHand(cards) {
  const el = document.getElementById('hand'); el.innerHTML = '';
  for (const c of cards) {
    const d = document.createElement('div'); d.className = 'handcard';
    if (c.front && c.front.startsWith('rank:')) { const p = c.front.split(':'); d.textContent = p[1]+p[2]; d.style.color = p[3] || '#111'; }
    else if (c.front && c.front.startsWith('text:')) { const [color, r1] = splitColorText(c.front.slice(5), COLORS.ink); const [bg, text] = splitColorText(r1, '#fbfbf7');
      d.classList.add('txt'); d.textContent = text; d.style.color = color; d.style.background = bg; }
    else if (c.front) { d.classList.add('img'); d.style.backgroundImage = `url("${c.front}")`; } // uploaded/file card art
    d.title = 'Left drag/click: face-down · Right drag/click: face-up';
    d.oncontextmenu = ev => ev.preventDefault(); // suppress the browser menu; right-click is handled by the pointer events
    d.addEventListener('pointerdown', ev => { if (ev.button === 0 || ev.button === 2) { ev.preventDefault(); handDrag = { hid: c.hid, faceDown: ev.button === 0, sx: ev.clientX, sy: ev.clientY, dragging: false, ghost: null, el: d }; } });
    el.appendChild(d);
  }
  el.style.display = cards.length ? 'flex' : 'none';
}

// ===== seats, other players' fanned hands, and turn order ===================
// Seats around the 20x14 table. Each client parks its camera at its own seat,
// and renders every OTHER player's hand as `hand` face-down backs at their seat.
const seatLayout = [
  { hand:[0,0.25,6.2],    out:[0,0,1],   cam:{pos:[0,13,17],    target:[0,0,1]} },   // front  (+z)
  { hand:[0,0.25,-6.2],   out:[0,0,-1],  cam:{pos:[0,13,-17],   target:[0,0,-1]} },  // back   (-z)
  { hand:[9.2,0.25,0],    out:[1,0,0],   cam:{pos:[17,13,0],    target:[1,0,0]} },   // right  (+x)
  { hand:[-9.2,0.25,0],   out:[-1,0,0],  cam:{pos:[-17,13,0],   target:[-1,0,0]} },  // left   (-x)
  { hand:[6.6,0.25,4.8],  out:[1,0,1],   cam:{pos:[14,13,11],   target:[0,0,0]} },   // front-right
  { hand:[-6.6,0.25,-4.8],out:[-1,0,-1], cam:{pos:[-14,13,-11], target:[0,0,0]} },   // back-left
];
const handGroups = new Map(); // sid -> THREE.Group of face-down backs

function applySeat(seat) {
  const s = seatLayout[seat]; if (!s) return;
  camera.position.set(...s.cam.pos); controls.target.set(...s.cam.target); controls.update();
}
function refreshFan(sid) {
  if (sid === mySession) return;                 // I see my own cards in the bottom bar
  const pl = room.state.players.get(sid); if (!pl) return;
  const s = seatLayout[pl.seat]; if (!s) return;
  let g = handGroups.get(sid);
  if (!g) { g = new THREE.Group(); scene.add(g); handGroups.set(sid, g); }
  while (g.children.length) g.remove(g.children[0]);
  const out = new THREE.Vector3(...s.out).normalize();
  const tan = new THREE.Vector3(out.z, 0, -out.x); // along the table edge
  const yaw = Math.atan2(out.x, out.z);
  const n = Math.min(pl.hand, 12);
  for (let i = 0; i < n; i++) {
    const back = KIND.card.mesh({}); // face-down (back-only)
    back.castShadow = back.receiveShadow = false;
    const off = i - (n - 1) / 2;
    back.position.set(s.hand[0] + tan.x * off * 0.55, s.hand[1], s.hand[2] + tan.z * off * 0.55);
    back.rotation.y = yaw + off * 0.06;          // slight fan
    back.scale.setScalar(0.8);
    g.add(back);
  }
}
function removeFan(sid) { const g = handGroups.get(sid); if (g) { scene.remove(g); handGroups.delete(sid); } }

// A simple standing marker at each seat: a colored base + a billboard showing
// the player's avatar (or a default silhouette) and their name, facing the table.
const markers = new Map(); // sid -> THREE.Group
function makePlayerTexture(pl) {
  const w = 256, h = 320, c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  const draw = (img) => {
    x.clearRect(0, 0, w, h);
    // card-ish background tinted with the player's color
    x.fillStyle = 'rgba(20,24,29,0.9)'; roundRect(x, 6, 6, w-12, h-12, 16); x.fill();
    x.lineWidth = 6; x.strokeStyle = pl.color; roundRect(x, 6, 6, w-12, h-12, 16); x.stroke();
    // avatar or silhouette in a circle
    x.save(); x.beginPath(); x.arc(w/2, 120, 78, 0, 7); x.closePath(); x.clip();
    if (img) { x.drawImage(img, w/2-78, 42, 156, 156); }
    else { x.fillStyle = '#3a4048'; x.fillRect(0, 0, w, h);                 // silhouette
           x.fillStyle = '#c8ccd2'; x.beginPath(); x.arc(w/2, 104, 34, 0, 7); x.fill();
           x.beginPath(); x.ellipse(w/2, 210, 62, 52, 0, Math.PI, 0); x.fill(); }
    x.restore();
    x.strokeStyle = pl.color; x.lineWidth = 5; x.beginPath(); x.arc(w/2, 120, 78, 0, 7); x.stroke();
    // name
    x.fillStyle = '#e8e6e0'; x.font = 'bold 30px system-ui, sans-serif'; x.textAlign = 'center';
    x.fillText((pl.name || 'Player').slice(0, 14), w/2, 270);
    tex.needsUpdate = true;
  };
  const tex = cTex(c);
  draw(null);
  if (pl.avatar) { const im = new Image(); im.onload = () => draw(im); im.src = pl.avatar; }
  return tex;
}
function roundRect(x, X, Y, W, H, r) { x.beginPath(); x.moveTo(X+r,Y); x.arcTo(X+W,Y,X+W,Y+H,r); x.arcTo(X+W,Y+H,X,Y+H,r); x.arcTo(X,Y+H,X,Y,r); x.arcTo(X,Y,X+W,Y,r); x.closePath(); }

function refreshMarker(sid) {
  if (sid === mySession) return; // don't render my own marker in my face
  const pl = room.state.players.get(sid); if (!pl) return;
  const s = seatLayout[pl.seat]; if (!s) return;
  let old = markers.get(sid); if (old) { scene.remove(old); markers.delete(sid); }
  const out = new THREE.Vector3(...s.out).normalize();
  const px = s.hand[0] + out.x * 1.6, pz = s.hand[2] + out.z * 1.6; // just outside the hand zone
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.08, 20),
    new THREE.MeshStandardMaterial({ color: pl.color, roughness: 0.5 }));
  disc.position.set(px, 0.04, pz); g.add(disc);
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.75),
    new THREE.MeshBasicMaterial({ map: makePlayerTexture(pl), transparent: true }));
  plane.position.set(px, 1.05, pz); plane.lookAt(0, 1.05, 0); // face the table centre
  g.add(plane);
  scene.add(g); markers.set(sid, g);
}
function removePlayerVis(sid) { removeFan(sid); const m = markers.get(sid); if (m) { scene.remove(m); markers.delete(sid); } }
function updateMyPreview(av) { const e = document.getElementById('myAv'); if (e) e.style.backgroundImage = av ? `url(${av})` : 'none'; }

function renderPlayers() { // built with DOM + textContent so a player's name can never inject HTML
  const el = document.getElementById('players'); if (!el) return;
  const list = []; room.state.players.forEach((p, sid) => list.push([sid, p]));
  list.sort((a, b) => a[1].seat - b[1].seat);
  el.replaceChildren();
  if (!list.length) { const w = document.createElement('div'); w.className = 'prow'; w.textContent = 'waiting…'; el.appendChild(w); return; }
  for (const [sid, p] of list) {
    const row = document.createElement('div');
    row.className = 'prow' + (room.state.turn === sid ? ' turn' : '');
    if (p.avatar) { const img = document.createElement('img'); img.className = 'pav'; img.src = p.avatar; row.appendChild(img); } // server enforces a data:image URL
    else { const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = p.color; row.appendChild(dot); } // color is a server palette value
    const label = document.createElement('span');
    label.textContent = `${p.name}${sid === mySession ? ' (you)' : ''} \u00b7 ${p.hand}`; // name via textContent = inert
    row.appendChild(label);
    el.appendChild(row);
  }
}

// ===== render loop — buffered snapshot interpolation ========================
// Every piece is drawn ~DELAY ms in the past, interpolated between the two real
// server states bracketing that time. Smooth at any speed; one path for all
// pieces (held, thrown, resting) so there are no prediction seams to jutter.
const DELAY = CONFIG.render.delay; // render this far behind live state (interpolation buffer)
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
function sample(buf, rt, mesh) {
  const n = buf.length; if (!n) return;
  if (n === 1 || rt <= buf[0].t)        { const s = buf[0];   mesh.position.set(s.x,s.y,s.z); mesh.quaternion.set(s.qx,s.qy,s.qz,s.qw); return; }
  if (rt >= buf[n-1].t)                 { const s = buf[n-1]; mesh.position.set(s.x,s.y,s.z); mesh.quaternion.set(s.qx,s.qy,s.qz,s.qw); return; }
  let i = n - 2; while (i > 0 && buf[i].t > rt) i--;
  const a = buf[i], b = buf[i+1], f = (rt - a.t) / ((b.t - a.t) || 1);
  mesh.position.set(a.x + (b.x-a.x)*f, a.y + (b.y-a.y)*f, a.z + (b.z-a.z)*f);
  qa.set(a.qx,a.qy,a.qz,a.qw); qb.set(b.qx,b.qy,b.qz,b.qw);
  mesh.quaternion.copy(qa).slerp(qb, f);
}
let boardTopY = 0; // top surface of the current board (0 = bare table) — where the drop marker sits
// "if dropped" marker: a flat ring on the table under whatever you're holding,
// showing where it would land if released now (straight down).
const dropMarker = new THREE.Mesh(
  new THREE.RingGeometry(CONFIG.marker.inner, CONFIG.marker.outer, 40),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: CONFIG.marker.opacity, side: THREE.DoubleSide, depthWrite: false }));
dropMarker.rotation.x = -Math.PI / 2; dropMarker.renderOrder = 3; dropMarker.visible = false; scene.add(dropMarker);
(function animate(){
  const rt = performance.now() - DELAY;
  for (const [id, { mesh }] of meshes) { const buf = buffers.get(id); if (buf) sample(buf, rt, mesh); }
  const held = down && down.grabbed && meshes.get(down.id); // straight-down landing spot under the held piece
  if (held) { dropMarker.position.set(held.mesh.position.x, boardTopY + CONFIG.marker.lift, held.mesh.position.z); dropMarker.visible = true; }
  else dropMarker.visible = false;
  controls.update(); renderer.render(scene, camera); requestAnimationFrame(animate);
})();
addEventListener('resize', () => { camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth,innerHeight); });
