import * as THREE from 'three';
import { CONFIG, clamp, scene, camera, renderer, controls } from './core.js';
import { KIND, cTex, cardMesh, propColor, measureModel, measureBoard, resizeToCanvas, splitColorText, uploadImage, uploadModel } from './graphics.js';
import { KINDS as PHYS, PROPS, PROP_LIST, COLORS, BOARDS, DIE_SIDES, deckHeight } from '/shared/pieces.js';

// ===== Tiny DOM helpers =====================================================
const byId = (id) => document.getElementById(id);
const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => document.querySelectorAll(selector);

function sendDeck(back, fronts, name) { // build the deck in small batches so no single message is large
  room.send('deckBegin', { back });
  for (let i = 0; i < fronts.length; i += 50) room.send('deckAppend', { fronts: fronts.slice(i, i + 50) });
  room.send('deckFinish', name ? { name } : {}); // name -> also save it to the library
}

// Render saved decks/props/boards into a container as "savedRow"s. For each item,
// labelFor(item) gives the row text and buttonsFor(item) gives [{ text, onClick }].
// emptyNote (optional) is shown when the list is empty.
function renderSavedList(containerId, items, { labelFor, buttonsFor, emptyNote }) {
  const container = byId(containerId);
  container.innerHTML = '';
  if (!items.length && emptyNote) {
    container.innerHTML = `<div class="note">${emptyNote}</div>`;
    return;
  }
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'savedRow';
    const label = document.createElement('span');
    label.textContent = labelFor(item); // textContent = safe from HTML in user-supplied names
    row.appendChild(label);
    for (const { text, onClick } of buttonsFor(item)) {
      const button = document.createElement('button');
      button.textContent = text;
      button.onclick = onClick;
      row.appendChild(button);
    }
    container.appendChild(row);
  }
}

// Run an async task while showing a button as busy (disabled + "busyText"), then
// always restore it. Returns true on success, false if the task threw (after
// alerting errMsg). Callers do their own post-success cleanup on a true return.
async function withBusyButton(button, busyText, errMsg, task) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  try {
    await task();
    return true;
  } catch (e) {
    alert(errMsg);
    return false;
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

// ===== Networking ===========================================================
const { Client, getStateCallbacks } = Colyseus;
const statusEl = byId('status');
const meshes = new Map();  // id -> { mesh, type }
const buffers = new Map(); // id -> [snapshot]   recent server states, for interpolation
let room, mySession;
const heldTarget = new THREE.Vector3(); // drag target sent to the server

// One timestamped transform snapshot (a server state at time t), for interpolation.
const snapshot = (t, p) => ({ t, x: p.x, y: p.y, z: p.z, qx: p.qx, qy: p.qy, qz: p.qz, qw: p.qw });
// Copy a snapshot's (or piece's) position + orientation onto a mesh.
const applyTransform = (mesh, s) => {
  mesh.position.set(s.x, s.y, s.z);
  mesh.quaternion.set(s.qx, s.qy, s.qz, s.qw);
};

(async () => {
  const client = new Client(location.origin.replace(/^http/, 'ws'));
  const saved = sessionStorage.getItem('tt_token'); // per-tab: survives refresh, distinct across browsers/tabs
  if (saved) {
    try { room = await client.reconnect(saved); } catch (e) { room = null; }
  }
  if (!room) room = await client.joinOrCreate('table');
  sessionStorage.setItem('tt_token', room.reconnectionToken);
  mySession = room.sessionId;
  statusEl.innerHTML = 'connected · <b>you</b>';
  const cb = getStateCallbacks(room); // Colyseus state-change callbacks (NOT jQuery)

  cb(room.state).pieces.onAdd((piece, id) => {
    const mesh = KIND[piece.type].mesh(JSON.parse(piece.props || '{}'));
    const castsShadow = PHYS[piece.type].mass > 0;
    applyTransform(mesh, piece);
    mesh.traverse(node => { // stamp the id on the group AND its children, so picking works
      node.userData.id = id;
      if (node.isMesh) { node.castShadow = castsShadow; node.receiveShadow = true; }
    });
    scene.add(mesh);
    meshes.set(id, { mesh, type: piece.type });
    buffers.set(id, [snapshot(performance.now(), piece)]);

    if (piece.type === 'deck') {
      // The extruded prism is unit-height; scale Y to reflect how many cards remain.
      const setDeckHeight = (count) => { mesh.scale.y = deckHeight(count); };
      setDeckHeight(piece.count);
      cb(piece).listen('count', setDeckHeight);
    }
    if (piece.type === 'card') {
      // Rebuild the card mesh when its props change (front revealed/hidden on flip).
      cb(piece).listen('props', () => rebuildCard(id, piece), false);
    }
    if (piece.type === 'board') {
      // Remember the board's top surface height so the drop marker sits on it.
      const boardProps = JSON.parse(piece.props || '{}');
      const builtin = boardProps.board && BOARDS[boardProps.board];
      const box = builtin ? builtin.box : ((boardProps.model && Array.isArray(boardProps.box)) ? boardProps.box : null);
      boardTopY = box ? box[1] * 2 : 0.1;
    }
  });

  cb(room.state).pieces.onRemove((piece, id) => {
    const entry = meshes.get(id);
    if (entry) scene.remove(entry.mesh);
    if (piece.type === 'board') boardTopY = 0; // back to bare table until a new board arrives
    if (inspect && inspect.origId === id) releaseInspect();
    meshes.delete(id);
    buffers.delete(id);
  });

  // Record one timestamped snapshot per piece on every patch (~the server patch
  // rate). The render loop plays these back interpolated and slightly delayed, so
  // motion stays smooth at any speed.
  room.onStateChange((state) => {
    const now = performance.now();
    state.pieces.forEach((piece, id) => {
      const buf = buffers.get(id);
      if (!buf) return;
      buf.push(snapshot(now, piece));
      if (buf.length > 24) buf.shift();
    });
  });

  room.onMessage('hand', renderHand); // your private hand — never seen by other clients
  room.onMessage('shuffled', ({ id }) => startAnim(id, 'shuffle')); // cosmetic: everyone sees the deck riffle
  room.onMessage('inspectCard', ({ front, back }) => inspectMesh(cardMesh({ front, back }), { drawn: true, type: 'card' })); // drawn card — front is ours alone
  room.onMessage('dealt', ({ id }) => { // a card you dragged off a deck — adopt it as the dragged piece
    if (down && down.pendingDeal) {
      down.id = id;
      down.type = 'card';
      down.kind = KIND.card;
      down.grabbed = true;
      down.pendingDeal = false;
      room.send('move', { id, x: hit.x, y: hit.y, z: hit.z });
    } else {
      room.send('release', { id, v: [0, 0, 0] }); // gesture already ended — just drop it
    }
  });

  // seats, turn order, and other players' fanned hand-backs (all public info)
  cb(room.state).players.onAdd((player, sid) => {
    if (sid === mySession) { applySeat(player.seat); byId('nameInput').value = player.name; updateMyPreview(player.avatar); }
    refreshFan(sid); refreshMarker(sid); renderPlayers();
    cb(player).listen('hand', () => { refreshFan(sid); renderPlayers(); }, false);
    cb(player).listen('seat', () => { if (sid === mySession) applySeat(player.seat); refreshFan(sid); refreshMarker(sid); }, false);
    cb(player).listen('name', () => { refreshMarker(sid); renderPlayers(); }, false);
    cb(player).listen('avatar', () => { if (sid === mySession) updateMyPreview(player.avatar); else refreshMarker(sid); renderPlayers(); }, false);
    cb(player).listen('color', () => { refreshMarker(sid); renderPlayers(); }, false);
  });
  cb(room.state).players.onRemove((player, sid) => { removePlayerVis(sid); renderPlayers(); });
  cb(room.state).listen('turn', renderPlayers, false);

  const diceGrp = byId('diceGrp');
  const diceBtn = byId('diceBtn');
  diceBtn.onclick = (e) => { e.stopPropagation(); diceGrp.hidden = !diceGrp.hidden; };
  diceGrp.onclick = (e) => e.stopPropagation();                   // clicks inside don't close the menu
  document.addEventListener('click', () => diceGrp.hidden = true); // clicking anywhere else closes it
  for (const sides of DIE_SIDES) {
    const button = document.createElement('button');
    button.textContent = '+ d' + sides;
    button.onclick = () => room.send('spawn', { type: 'die', props: { sides } });
    diceGrp.appendChild(button);
  }
  qsa('[data-spawn]').forEach(b => b.onclick = () => {
    const type = b.dataset.spawn;
    let props = {};
    if (type === 'card') { // build a random standard-deck card: rank:<rank>:<suit>:<color>
      const [suit, color] = [['♠', '#000000'], ['♥', '#bd2500'], ['♦', '#bd2500'], ['♣', '#000000']][Math.random() * 4 | 0];
      const rank = ['A', '2', 'Q', '9', 'J', 'K'][Math.random() * 6 | 0];
      props = { front: `rank:${rank}:${suit}:${color}`, back: 'back' };
    }
    byId('deckModal').hidden = true;
    room.send('spawn', { type, props });
  });
  room.onMessage('deckList', decks => renderSavedList('savedList', decks, {
    emptyNote: 'none saved yet',
    labelFor: d => `${d.name} · ${d.count}`,
    buttonsFor: d => [
      { text: 'Edit', onClick: () => openEditDeck(d) },
      { text: 'Load', onClick: () => { room.send('loadDeck', { slug: d.slug }); byId('deckModal').hidden = true; } },
    ],
  }));
  byId('newDeck').onclick = () => { byId('deckModal').hidden = false; room.send('listDecks'); };

  // Prop picker
  const propShapeSel = byId('propShape');
  for (const shape of PROP_LIST) {
    const option = document.createElement('option');
    option.value = shape.id;
    option.textContent = shape.name;
    propShapeSel.appendChild(option);
  }
  // Show/hide the colour vs. team pickers to match the selected shape.
  const syncPropControls = () => {
    const spec = PROP_LIST.find(s => s.id === propShapeSel.value) || {};
    const propDef = PROPS[propShapeSel.value] || {};
    const ownMaterial = !!propDef.ownMaterial && !propDef.tintMaterial; // own-material models get no colour picker (unless they tint one slot)
    byId('propColorWrap').hidden = !!spec.team || ownMaterial;
    byId('propTeamWrap').hidden = !spec.team;
    byId('propStand').checked = !!propDef.stand; // default to the shape's behaviour
  };
  propShapeSel.onchange = syncPropControls;
  syncPropControls();
  byId('newProp').onclick = () => { byId('propModal').hidden = false; };
  byId('propCustom').onclick = () => { byId('propModal').hidden = true; byId('customPropModal').hidden = false; room.send('listProps'); };
  byId('cpCancel').onclick = () => byId('customPropModal').hidden = true;
  byId('cpTintColor').oninput = () => { qs('input[name="cpColorMode"][value="tint"]').checked = true; }; // picking a colour implies you want it tinted

  // ---- edit / clone a saved model prop (client-side; scale re-derives the collider box) ----
  let editingProp = null;
  window.openEditProp = (savedProp) => {
    editingProp = savedProp;
    const saved = savedProp.props || {};
    byId('editPropModel').textContent = 'model: ' + (saved.model || '').split('/').pop();
    byId('editPropScale').value = saved.scale || 1;
    byId('editPropStand').checked = !!saved.stand;
    qs('input[name="editPropColorMode"][value="' + (saved.color != null ? 'tint' : 'own') + '"]').checked = true;
    if (saved.color != null) byId('editPropTintColor').value = '#' + (saved.color >>> 0).toString(16).padStart(6, '0');
    byId('editPropName').value = savedProp.name + ' copy';
    byId('editPropModal').hidden = false;
  };
  // Re-derive a prop's props from the edit dialog. Rescaling the collider box by
  // the scale ratio keeps physics in sync with the new visual size.
  const buildEditedProp = () => {
    const saved = editingProp.props || {};
    const scale = clamp(+byId('editPropScale').value || 1, ...CONFIG.ranges.scale);
    const ratio = scale / (saved.scale || 1);
    const props = {
      model: saved.model,
      box: (saved.box || [0.5, 0.5, 0.5]).map(v => v * ratio),
      stand: byId('editPropStand').checked,
      scale,
    };
    if (qs('input[name="editPropColorMode"]:checked').value === 'tint') {
      props.color = parseInt(byId('editPropTintColor').value.slice(1), 16);
    }
    return props;
  };
  byId('editPropCancel').onclick = () => byId('editPropModal').hidden = true;
  byId('editPropSave').onclick = () => { room.send('saveProp', { name: editingProp.name, props: buildEditedProp() }); byId('editPropModal').hidden = true; };
  byId('editPropCopy').onclick = () => {
    const name = byId('editPropName').value.trim();
    if (!name) { alert('Enter a copy name.'); return; }
    room.send('saveProp', { name, props: buildEditedProp() });
    byId('editPropModal').hidden = true;
  };

  // ---- edit / clone a saved deck (shallow: replace back + append cards; server applies the deltas) ----
  let editingDeck = null;
  window.openEditDeck = (d) => {
    editingDeck = d;
    byId('editDeckInfo').textContent = d.name + ' · ' + d.count + ' cards';
    byId('editDeckBack').value = '';
    byId('editDeckText').value = '';
    byId('editDeckImgs').value = '';
    byId('editDeckName').value = d.name + ' copy';
    byId('editDeckModal').hidden = false;
  };
  async function commitDeckEdit(saveAs) {
    const buttons = ['editDeckSave', 'editDeckCopy'].map(id => byId(id));
    const name = saveAs ? byId('editDeckName').value.trim() : editingDeck.name;
    if (saveAs && !name) { alert('Enter a copy name.'); return; }
    buttons.forEach(b => b.disabled = true); // two buttons here, so not the withBusyButton pattern
    try {
      let back;
      const backFile = byId('editDeckBack').files[0];
      if (backFile) back = await uploadImage(backFile, CONFIG.upload.cardW, CONFIG.upload.cardH, undefined, 'decks');

      const addFronts = [];
      const faceColor = byId('editDeckFaceColor').value, bg = byId('editDeckFaceBg').value;
      const lines = byId('editDeckText').value.split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines) addFronts.push('text:' + faceColor + ':' + bg + ':' + line);
      for (const img of byId('editDeckImgs').files) addFronts.push(await uploadImage(img, CONFIG.upload.cardW, CONFIG.upload.cardH, undefined, 'decks'));

      room.send('editDeck', { slug: editingDeck.slug, name, back, addFronts, saveAs });
      byId('editDeckModal').hidden = true;
    } catch (e) {
      alert('Edit failed — an image upload may have errored.');
    }
    buttons.forEach(b => b.disabled = false);
  }
  byId('editDeckCancel').onclick = () => byId('editDeckModal').hidden = true;
  byId('editDeckSave').onclick = () => commitDeckEdit(false);
  byId('editDeckCopy').onclick = () => commitDeckEdit(true);

  room.onMessage('propList', props => renderSavedList('propSavedList', props, {
    labelFor: sp => sp.name,
    buttonsFor: sp => [
      { text: 'Edit', onClick: () => openEditProp(sp) },
      { text: 'Spawn', onClick: () => room.send('spawn', { type: 'prop', props: sp.props }) },
    ],
  }));
  byId('propCancel').onclick = () => byId('propModal').hidden = true;
  byId('propSpawn').onclick = () => { // built-in shape prop
    const shape = propShapeSel.value;
    const team = !!(PROP_LIST.find(s => s.id === shape) || {}).team;
    const props = team ? { shape, team: +byId('propTeam').value }
                       : { shape, color: parseInt(byId('propColor').value.slice(1), 16) };
    props.stand = byId('propStand').checked;
    props.scale = clamp(+byId('propScale').value || 1, ...CONFIG.ranges.scale);
    const qty = clamp(+byId('propQty').value || 1, ...CONFIG.ranges.qty);
    for (let i = 0; i < qty; i++) room.send('spawn', { type: 'prop', props });
    byId('propModal').hidden = true;
  };
  byId('cpSpawn').onclick = async () => { // custom .glb prop
    const modelFile = byId('cpModel').files[0];
    if (!modelFile) { alert('Choose a .glb file first.'); return; }
    const stand = byId('cpStand').checked;
    const qty = clamp(+byId('cpQty').value || 1, ...CONFIG.ranges.qty);
    const scale = clamp(+byId('cpScale').value || 1, ...CONFIG.ranges.scale);

    const ok = await withBusyButton(byId('cpSpawn'), 'Uploading…', 'Model upload/load failed — make sure it is a .glb file.', async () => {
      const color = qs('input[name="cpColorMode"]:checked').value === 'tint' ? parseInt(byId('cpTintColor').value.slice(1), 16) : null;
      const url = await uploadModel(modelFile);
      const box = await measureModel(url, scale);
      const props = { model: url, box, stand, scale };
      if (color != null) props.color = color;
      for (let i = 0; i < qty; i++) room.send('spawn', { type: 'prop', props });
      const saveName = byId('cpName').value.trim();
      if (saveName) room.send('saveProp', { name: saveName, props });
    });
    if (!ok) return;

    byId('cpModel').value = '';
    byId('cpName').value = '';
    byId('customPropModal').hidden = true;
  };
  byId('newBoard').onclick = () => { byId('boardModal').hidden = false; room.send('listBoards'); };
  { // built-in model boards
    const container = byId('builtinBoards');
    for (const key of Object.keys(BOARDS)) {
      const button = document.createElement('button');
      button.textContent = BOARDS[key].name;
      button.onclick = () => { room.send('spawn', { type: 'board', props: { board: key } }); byId('boardModal').hidden = true; };
      container.appendChild(button);
    }
  }
  byId('boardModelSpawn').onclick = async () => {
    const file = byId('boardModel').files[0];
    if (!file) { alert('Choose a .glb file first.'); return; }

    const ok = await withBusyButton(byId('boardModelSpawn'), 'Uploading…', 'Board model upload/load failed — make sure it is a .glb file.', async () => {
      const url = await uploadModel(file);
      const { scale, box } = await measureBoard(url);
      room.send('spawn', { type: 'board', props: { model: url, modelScale: scale, box } });
    });
    if (!ok) return;

    byId('boardModel').value = '';
    byId('boardModal').hidden = true;
  };
  byId('boardSave').onclick = () => {
    let board = null;
    room.state.pieces.forEach(p => { if (p.type === 'board') board = JSON.parse(p.props || '{}'); });
    if (!board) { alert('No board on the table to save.'); return; }
    const name = prompt('Save board as:');
    if (name && name.trim()) room.send('saveBoard', { name: name.trim(), board });
  };
  room.onMessage('boardList', boards => renderSavedList('boardSavedList', boards, {
    labelFor: b => b.name + (b.kind ? ` (${b.kind})` : ''),
    buttonsFor: b => [
      { text: 'Load', onClick: () => { room.send('loadBoard', { slug: b.slug }); byId('boardModal').hidden = true; } },
    ],
  }));
  byId('boardCancel').onclick = () => byId('boardModal').hidden = true;
  byId('boardCreate').onclick = async () => {
    const btn = byId('boardCreate');
    const w = clamp(+byId('boardW').value || 8, ...CONFIG.ranges.boardW);
    const d = clamp(+byId('boardD').value || 8, ...CONFIG.ranges.boardD);
    const imgFile = byId('boardImg').files[0];
    const props = { w, d };
    if (imgFile) { // only this path uploads, so show the button busy just around it
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Uploading…';
      try {
        props.tex = await uploadImage(imgFile, CONFIG.upload.board, CONFIG.upload.board, 'stretch', 'boards');
      } catch (e) {
        btn.disabled = false; btn.textContent = label;
        alert('Image upload failed.');
        return;
      }
      btn.disabled = false;
      btn.textContent = label;
    }
    room.send('spawn', { type: 'board', props });
    byId('boardModal').hidden = true;
    byId('boardImg').value = '';
  };
  byId('deckCancel').onclick = () => byId('deckModal').hidden = true;
  qsa('input[name=deckMode]').forEach(r => r.onchange = () => {
    const textMode = qs('input[name=deckMode]:checked').value === 'text';
    byId('textMode').hidden = !textMode;
    byId('imageMode').hidden = textMode;
  });
  // Parse the face list: either a JSON array, or comma/newline-separated lines.
  const parseFaces = raw => {
    raw = raw.trim();
    if (!raw) return [];
    if (raw[0] === '[') {
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr.map(String).map(s => s.trim()).filter(Boolean);
      } catch {}
    }
    return raw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  };
  byId('deckCreate').onclick = async () => {
    const btn = byId('deckCreate');
    const mode = qs('input[name=deckMode]:checked').value;
    let back = 'back', fronts = [];
    if (mode === 'text') {
      const faces = parseFaces(byId('faceText').value);
      if (!faces.length) return;
      const faceColor = byId('faceColor').value;
      fronts = faces.map(face => 'text:' + faceColor + ':' + byId('faceBg').value + ':' + face);
      const backText = byId('backText').value.trim();
      back = 'tback:' + byId('backColor').value + ':' + byId('backTextColor').value + ':' + backText;
    } else {
      const backFile = byId('deckBack').files[0];
      const frontFiles = [...byId('deckFronts').files];
      if (!frontFiles.length) return;
      const label = btn.textContent;
      btn.disabled = true; // uploads go over HTTP one image at a time; show running progress
      try {
        let done = 0;
        if (backFile) back = await uploadImage(backFile, CONFIG.upload.cardW, CONFIG.upload.cardH, undefined, 'decks');
        for (const file of frontFiles) {
          fronts.push(await uploadImage(file, CONFIG.upload.cardW, CONFIG.upload.cardH, undefined, 'decks'));
          btn.textContent = `Uploading ${++done}/${frontFiles.length}…`;
        }
      } catch (e) {
        btn.disabled = false; btn.textContent = label;
        alert('Image upload failed.');
        return;
      }
      btn.disabled = false;
      btn.textContent = label;
    }
    sendDeck(back, fronts, byId('deckSaveName').value.trim() || undefined);
    byId('deckModal').hidden = true;
    byId('deckBack').value = '';
    byId('deckFronts').value = '';
    byId('faceText').value = '';
    byId('deckSaveName').value = '';
  };
  byId('roll').onclick = () => room.send('roll');
  byId('nextTurn').onclick = () => room.send('nextTurn');
  byId('nameInput').addEventListener('change', e => {
    const name = e.target.value.trim();
    if (name) room.send('setName', { name });
  });
  byId('avatarInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const canvas = await resizeToCanvas(file, 96, 96); // small square keeps the data-URL tiny for state sync
    room.send('setAvatar', { data: canvas.toDataURL('image/jpeg', 0.7) });
  });
  byId('reset').onclick = () => room.send('reset');
})().catch(err => { statusEl.textContent = 'connection failed'; console.error(err); });

// ===== Interaction — click vs. drag; the meaning depends on the piece ========
const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
const GRAB_HEIGHT = CONFIG.grab.height; // float height when a piece is first grabbed (scroll to raise/lower)
const DRAG_MIN = CONFIG.grab.min, DRAG_MAX = CONFIG.grab.max, DRAG_STEP = CONFIG.grab.step;
const DECK_DRAG_HEIGHT = CONFIG.grab.deckHeight; // dealt cards ride this high to clear the deck
let dragHeight = GRAB_HEIGHT;
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -GRAB_HEIGHT), hit = new THREE.Vector3();
const prevTarget = new THREE.Vector3(), throwVel = new THREE.Vector3(); // hand speed → throw velocity
let lastMoveSent = 0, prevThrowTime = 0, down = null;

// Convert a pointer event to normalized device coordinates (−1..1) for raycasting.
const setPointer = (e) => {
  pointer.x = e.clientX / innerWidth * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
};

// The piece id under the pointer, if any. Model children live below the
// id-stamped group, so walk up until we reach the stamped ancestor.
const pickId = () => {
  ray.setFromCamera(pointer, camera);
  let obj = ray.intersectObjects([...meshes.values()].map(m => m.mesh))[0]?.object;
  while (obj && obj.userData.id === undefined) obj = obj.parent;
  return obj && obj.userData.id;
};

renderer.domElement.addEventListener('contextmenu', e => e.preventDefault()); // right-click is ours
renderer.domElement.addEventListener('mousedown', e => { // middle-click snaps a held piece's facing to 90°
  if (e.button === 1) {
    e.preventDefault();
    if (down && down.grabbed) room.send('snap', { id: down.id });
  }
});
byId('hintHead').onclick = () => { // collapsible controls panel
  const collapsed = byId('hint').classList.toggle('collapsed');
  byId('hintToggle').innerHTML = collapsed ? 'Show &#9656;' : 'Hide &#9662;';
};
qsa('[data-place]').forEach(b => b.onclick = () => placeDrawn(b.dataset.place)); // drawn-card placement

// Map a click-action name to the server message it sends.
const sendAction = (action, id) => {
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
const INSPECTABLE = (type) => type === 'die' || type === 'card' || type === 'prop'; // not boards/decks

// Core inspect: park `mesh` enlarged in front of the camera. opts: { origId,
// type, drawn }. A 'card' is stood upright; a 'drawn' card shows the action panel.
function inspectMesh(mesh, opts = {}) {
  releaseInspect();
  mesh.position.set(0, 0, 0);
  mesh.rotation.set(0, 0, 0);
  mesh.scale.set(1, 1, 1);
  mesh.visible = true;

  // Scale to a consistent on-screen size and centre the mesh within a pivot.
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = CONFIG.inspect.fit / (Math.max(size.x, size.y, size.z) || 1);
  mesh.position.copy(center).multiplyScalar(-1);

  const pivot = new THREE.Group();
  pivot.add(mesh);
  pivot.scale.setScalar(scale);
  if (opts.type === 'card') pivot.rotateX(Math.PI / 2); // a card lies flat (face = +Y); stand it up

  if (!camera.parent) scene.add(camera); // camera must be in the graph for its children to render
  camera.add(pivot);
  pivot.position.set(0, -CONFIG.inspect.drop, -CONFIG.inspect.dist);

  inspect = { pivot, origId: opts.origId || null, drag: null, drawn: !!opts.drawn, placed: false };
  controls.enabled = false;
  byId('inspectHint').hidden = !!opts.drawn; // a drawn card shows the action panel instead
  byId('drawActions').hidden = !opts.drawn;
}

// Inspect an on-table piece by cloning its mesh (the clone respects hidden info —
// a face-down card clones back-only), then hide the real piece behind the copy.
function enterInspect(id) {
  const entry = meshes.get(id);
  if (!entry) return;
  inspectMesh(entry.mesh.clone(true), { origId: id, type: entry.type });
  entry.mesh.visible = false;
}

function releaseInspect() {
  if (!inspect) return;
  if (inspect.drawn && !inspect.placed) room.send('inspectPlace', { where: 'deck' }); // closed without choosing → back to deck
  camera.remove(inspect.pivot); // shares geometry/materials — never dispose
  const entry = inspect.origId && meshes.get(inspect.origId);
  if (entry) entry.mesh.visible = true;
  inspect = null;
  controls.enabled = true;
  byId('inspectHint').hidden = true;
  byId('drawActions').hidden = true;
}

// Resolve a drawn card to its destination: field-up | field-down | hand | deck.
function placeDrawn(where) {
  if (!inspect || !inspect.drawn) return;
  room.send('inspectPlace', { where });
  inspect.placed = true;
  releaseInspect();
}

// Handle a click (no drag). A left-click on an inspectable piece or a deck waits
// briefly for a possible double-click (inspect / draw); everything else fires now.
function handleClick(gesture) {
  const { id, button, type } = gesture;
  const wantsDouble = button === 0 && (INSPECTABLE(type) || type === 'deck');

  if (!wantsDouble) {
    sendAction(button === 0 ? gesture.kind.lclick : gesture.kind.rclick, id); // right-click / non-inspectable
    return;
  }

  const isSecondClick = pendingClick && pendingClick.id === id && performance.now() - pendingClick.t < CONFIG.input.dblMs;
  if (isSecondClick) {
    clearTimeout(pendingClick.timer);
    pendingClick = null;
    if (type === 'deck') room.send('drawInspect', { deckId: id }); // double-click a deck = draw to inspect
    else enterInspect(id);                                          // double-click a piece = inspect it
  } else {
    if (pendingClick) clearTimeout(pendingClick.timer);
    const action = gesture.kind.lclick; // undefined for die/prop → harmless no-op
    pendingClick = { id, t: performance.now(), timer: setTimeout(() => { pendingClick = null; sendAction(action, id); }, CONFIG.input.clickMs) };
  }
}
renderer.domElement.addEventListener('pointerdown', e => {
  if (inspect) { // in inspect mode, a left-drag spins the item (trackball)
    if (e.button === 0) {
      inspect.drag = { sx: e.clientX, sy: e.clientY, px: e.clientX, py: e.clientY, moved: false };
      renderer.domElement.setPointerCapture(e.pointerId);
    }
    return;
  }
  if (!room || (e.button !== 0 && e.button !== 2)) return;
  setPointer(e);
  const id = pickId();
  if (!id) { down = null; return; } // empty felt → let OrbitControls orbit/pan
  const type = meshes.get(id).type;
  down = { id, type, kind: KIND[type], button: e.button, sx: e.clientX, sy: e.clientY, dragging: false, grabbed: false };
  controls.enabled = false; // this gesture belongs to the piece
  dragHeight = GRAB_HEIGHT;
  dragPlane.constant = -GRAB_HEIGHT; // every grab starts at the base height
  renderer.domElement.setPointerCapture(e.pointerId);
});

renderer.domElement.addEventListener('wheel', e => {
  if (!(down && down.grabbed)) return; // not holding a piece → let OrbitControls zoom
  e.preventDefault();
  dragHeight = clamp(dragHeight - Math.sign(e.deltaY) * DRAG_STEP, DRAG_MIN, DRAG_MAX); // scroll up = raise
  dragPlane.constant = -dragHeight;
  ray.setFromCamera(pointer, camera);
  ray.ray.intersectPlane(dragPlane, hit); // re-place under the cursor at the new height
  room.send('move', { id: down.id, x: hit.x, y: hit.y, z: hit.z });
}, { passive: false });

renderer.domElement.addEventListener('pointermove', e => {
  if (inspect) { // spin the inspected item with a screen-aligned trackball
    const drag = inspect.drag;
    if (drag) {
      const dx = e.clientX - drag.px, dy = e.clientY - drag.py;
      drag.px = e.clientX; drag.py = e.clientY;
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > CONFIG.input.inspectPx) drag.moved = true;
      inspect.pivot.quaternion.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(dy * 0.01, dx * 0.01, 0)));
    }
    return;
  }
  if (!down) return;
  setPointer(e);
  ray.setFromCamera(pointer, camera);
  ray.ray.intersectPlane(dragPlane, hit);

  // First move past the click threshold decides what this drag means.
  if (!down.dragging) {
    if (Math.hypot(e.clientX - down.sx, e.clientY - down.sy) < CONFIG.input.dragPx) return; // still a click
    down.dragging = true;
    const kind = down.kind;
    if (down.button === kind.grab) { // the button that moves this kind (2 = deck, 0 = most)
      down.grabbed = true;
      heldTarget.copy(hit); prevTarget.copy(hit); prevThrowTime = performance.now(); throwVel.set(0, 0, 0);
      room.send('grab', { id: down.id });
      room.send('move', { id: down.id, x: hit.x, y: hit.y, z: hit.z });
    } else if (down.button === 0 && kind.ldrag === 'deal') { // deck left-drag = deal a card and carry it
      down.pendingDeal = true;
      dragHeight = DECK_DRAG_HEIGHT;
      dragPlane.constant = -dragHeight; // lift above the deck so the dealt card doesn't fight its collider
      ray.setFromCamera(pointer, camera);
      ray.ray.intersectPlane(dragPlane, hit); // recompute the target at the higher plane
      heldTarget.copy(hit); prevTarget.copy(hit); prevThrowTime = performance.now(); throwVel.set(0, 0, 0);
      room.send('dealDrag', { deckId: down.id, x: hit.x, y: hit.y, z: hit.z });
    }
  }

  if (down.grabbed) {
    heldTarget.copy(hit);
    const now = performance.now(), dt = (now - prevThrowTime) / 1000;
    if (dt > 0 && dt < 0.1) throwVel.lerp(hit.clone().sub(prevTarget).multiplyScalar(1 / dt), 0.4); // smooth the hand speed
    prevTarget.copy(hit); prevThrowTime = now;
    if (now - lastMoveSent > 16) { room.send('move', { id: down.id, x: hit.x, y: hit.y, z: hit.z }); lastMoveSent = now; } // ~60Hz throttle
  }
});
const endGesture = e => {
  if (inspect) { // releasing in inspect mode: a plain click (no drag) closes it
    const drag = inspect.drag;
    if (drag) {
      inspect.drag = null; // clear first — releaseInspect() nulls `inspect`
      try { renderer.domElement.releasePointerCapture(e.pointerId); } catch {}
      if (!drag.moved) releaseInspect();
    }
    return;
  }
  if (!down) return;
  if (down.grabbed) {
    const throwVector = down.kind.grab === 2 ? [0, 0, 0] : [throwVel.x, throwVel.y, throwVel.z]; // decks don't fly
    room.send('release', { id: down.id, v: throwVector });
  } else if (!down.dragging) { // a click / tap
    handleClick(down);
  }
  controls.enabled = !inspect; // stay disabled if this click just entered inspect
  try { renderer.domElement.releasePointerCapture(e.pointerId); } catch {}
  down = null;
};
renderer.domElement.addEventListener('pointerup', endGesture);
renderer.domElement.addEventListener('pointercancel', endGesture);

// The piece to act on for a keyboard shortcut: the held one, else whatever's hovered.
const heldOrHoveredId = () => (down && down.id) || pickId();

// Keyboard shortcuts (ignored while typing in an input). Delete/Backspace removes
// a piece, U toggles its upright/flat behaviour, S saves a hovered deck.
addEventListener('keydown', e => {
  if (!room) return;
  if (e.key === 'Escape' && inspect) { releaseInspect(); return; }
  if (inspect && inspect.drawn) { // f/d/h/r place a drawn card
    const where = { f: 'field-up', d: 'field-down', h: 'hand', r: 'deck' }[e.key.toLowerCase()];
    if (where) { placeDrawn(where); return; }
  }
  const typing = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
  if (typing) return;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (e.key === 'Backspace') e.preventDefault();
    const id = heldOrHoveredId();
    if (id) {
      room.send('remove', { id });
      if (down && down.id === id) { down = null; controls.enabled = true; }
    }
  } else if (e.key === 'u' || e.key === 'U') { // toggle keep-upright / lie-flat
    const id = heldOrHoveredId();
    if (id) room.send('setStand', { id });
  } else if (e.key === 's' || e.key === 'S') { // save a hovered deck to the shared library
    const id = heldOrHoveredId();
    if (id && meshes.get(id).type === 'deck') {
      const name = prompt('Save this deck as:');
      if (name && name.trim()) room.send('saveDeck', { deckId: id, name: name.trim() });
    }
  }
});

// Rebuild a card's mesh when it's revealed/hidden (props gain/lose the front),
// keeping its last known transform so it doesn't jump.
function rebuildCard(id, piece) {
  const entry = meshes.get(id);
  if (!entry) return;
  scene.remove(entry.mesh);
  const mesh = KIND.card.mesh(JSON.parse(piece.props || '{}'));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.id = id;
  const buf = buffers.get(id), last = buf && buf[buf.length - 1];
  if (last) applyTransform(mesh, last);
  scene.add(mesh);
  entry.mesh = mesh;
}

// hidden hand: a private bottom bar only this client ever sees
let handDrag = null; // dragging a card out of the hand onto the table
addEventListener('pointermove', e => {
  if (!handDrag) return;
  if (!handDrag.dragging) {
    if (Math.hypot(e.clientX - handDrag.sx, e.clientY - handDrag.sy) < CONFIG.input.handPx) return;
    handDrag.dragging = true;
    document.body.style.userSelect = document.body.style.webkitUserSelect = 'none'; // stop the text-selection sweep
    const selection = window.getSelection && window.getSelection();
    if (selection) selection.removeAllRanges();
    // A ghost copy of the card that follows the cursor.
    const ghost = handDrag.el.cloneNode(true);
    Object.assign(ghost.style, { position: 'fixed', pointerEvents: 'none', opacity: '0.85', zIndex: '50', margin: '0', transform: 'translate(-50%,-50%)' });
    document.body.appendChild(ghost);
    handDrag.ghost = ghost;
  }
  handDrag.ghost.style.left = e.clientX + 'px';
  handDrag.ghost.style.top = e.clientY + 'px';
});
addEventListener('pointerup', e => {
  if (!handDrag) return;
  const drag = handDrag;
  handDrag = null;
  document.body.style.userSelect = document.body.style.webkitUserSelect = ''; // re-enable selection
  if (drag.ghost) drag.ghost.remove();
  if (!drag.dragging) { room.send('playCard', { hid: drag.hid, faceDown: drag.faceDown }); return; } // a click = quick play
  if (document.elementFromPoint(e.clientX, e.clientY) !== renderer.domElement) return; // dropped on UI → cancel
  setPointer(e);
  ray.setFromCamera(pointer, camera);
  ray.ray.intersectPlane(dragPlane, hit); // where on the table
  room.send('playCard', { hid: drag.hid, faceDown: drag.faceDown, x: hit.x, z: hit.z });
});

function renderHand(cards) {
  const el = byId('hand');
  el.innerHTML = '';
  for (const card of cards) {
    const div = document.createElement('div');
    div.className = 'handcard';
    if (card.front && card.front.startsWith('rank:')) {
      const [, rank, suit, color] = card.front.split(':');
      div.textContent = rank + suit;
      div.style.color = color || '#111';
    } else if (card.front && card.front.startsWith('text:')) {
      const [color, rest] = splitColorText(card.front.slice(5), COLORS.ink);
      const [bg, text] = splitColorText(rest, '#fbfbf7');
      div.classList.add('txt');
      div.textContent = text;
      div.style.color = color;
      div.style.background = bg;
    } else if (card.front) {
      div.classList.add('img');
      div.style.backgroundImage = `url("${card.front}")`; // uploaded/file card art
    }
    div.title = 'Left drag/click: face-down · Right drag/click: face-up';
    div.oncontextmenu = ev => ev.preventDefault(); // right-click is handled by the pointer events
    div.addEventListener('pointerdown', ev => {
      if (ev.button === 0 || ev.button === 2) {
        ev.preventDefault();
        handDrag = { hid: card.hid, faceDown: ev.button === 0, sx: ev.clientX, sy: ev.clientY, dragging: false, ghost: null, el: div };
      }
    });
    el.appendChild(div);
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
  const layout = seatLayout[seat];
  if (!layout) return;
  camera.position.set(...layout.cam.pos);
  controls.target.set(...layout.cam.target);
  controls.update();
}

// Rebuild the fanned face-down backs shown at another player's seat.
function refreshFan(sid) {
  if (sid === mySession) return; // I see my own cards in the bottom bar
  const player = room.state.players.get(sid);
  if (!player) return;
  const seat = seatLayout[player.seat];
  if (!seat) return;

  let group = handGroups.get(sid);
  if (!group) { group = new THREE.Group(); scene.add(group); handGroups.set(sid, group); }
  while (group.children.length) group.remove(group.children[0]);

  const out = new THREE.Vector3(...seat.out).normalize();
  const tangent = new THREE.Vector3(out.z, 0, -out.x); // along the table edge
  const yaw = Math.atan2(out.x, out.z);
  const count = Math.min(player.hand, 12);
  for (let i = 0; i < count; i++) {
    const back = KIND.card.mesh({}); // face-down (back-only)
    back.castShadow = back.receiveShadow = false;
    const offset = i - (count - 1) / 2;
    back.position.set(seat.hand[0] + tangent.x * offset * 0.55, seat.hand[1], seat.hand[2] + tangent.z * offset * 0.55);
    back.rotation.y = yaw + offset * 0.06; // slight fan
    back.scale.setScalar(0.8);
    group.add(back);
  }
}

function removeFan(sid) {
  const group = handGroups.get(sid);
  if (group) { scene.remove(group); handGroups.delete(sid); }
}

// A simple standing marker at each seat: a colored base + a billboard showing
// the player's avatar (or a default silhouette) and their name, facing the table.
const markers = new Map(); // sid -> THREE.Group
function makePlayerTexture(player) {
  const width = 256, height = 320;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const draw = (img) => {
    ctx.clearRect(0, 0, width, height);
    // Card-ish background with a border tinted in the player's colour.
    ctx.fillStyle = 'rgba(20,24,29,0.9)';
    roundRect(ctx, 6, 6, width - 12, height - 12, 16);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = player.color;
    roundRect(ctx, 6, 6, width - 12, height - 12, 16);
    ctx.stroke();
    // Avatar image (or a default silhouette) clipped to a circle.
    ctx.save();
    ctx.beginPath();
    ctx.arc(width / 2, 120, 78, 0, 7);
    ctx.closePath();
    ctx.clip();
    if (img) {
      ctx.drawImage(img, width / 2 - 78, 42, 156, 156);
    } else {
      ctx.fillStyle = '#3a4048';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#c8ccd2';
      ctx.beginPath(); ctx.arc(width / 2, 104, 34, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(width / 2, 210, 62, 52, 0, Math.PI, 0); ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = player.color;
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(width / 2, 120, 78, 0, 7); ctx.stroke();
    // Name.
    ctx.fillStyle = '#e8e6e0';
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText((player.name || 'Player').slice(0, 14), width / 2, 270);
    tex.needsUpdate = true;
  };

  const tex = cTex(canvas);
  draw(null);
  if (player.avatar) { const img = new Image(); img.onload = () => draw(img); img.src = player.avatar; }
  return tex;
}

// Trace a rounded-rectangle path on ctx (caller then fill()s or stroke()s it).
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function refreshMarker(sid) {
  if (sid === mySession) return; // don't render my own marker in my face
  const player = room.state.players.get(sid);
  if (!player) return;
  const seat = seatLayout[player.seat];
  if (!seat) return;

  const existing = markers.get(sid);
  if (existing) { scene.remove(existing); markers.delete(sid); }

  const out = new THREE.Vector3(...seat.out).normalize();
  const px = seat.hand[0] + out.x * 1.6, pz = seat.hand[2] + out.z * 1.6; // just outside the hand zone
  const group = new THREE.Group();

  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.55, 0.08, 20),
    new THREE.MeshStandardMaterial({ color: player.color, roughness: 0.5 }));
  disc.position.set(px, 0.04, pz);
  group.add(disc);

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 1.75),
    new THREE.MeshBasicMaterial({ map: makePlayerTexture(player), transparent: true }));
  plane.position.set(px, 1.05, pz);
  plane.lookAt(0, 1.05, 0); // face the table centre
  group.add(plane);

  scene.add(group);
  markers.set(sid, group);
}

function removePlayerVis(sid) {
  removeFan(sid);
  const marker = markers.get(sid);
  if (marker) { scene.remove(marker); markers.delete(sid); }
}

function updateMyPreview(avatar) {
  const el = byId('myAv');
  if (el) el.style.backgroundImage = avatar ? `url(${avatar})` : 'none';
}

function renderPlayers() { // built with DOM + textContent so a player's name can never inject HTML
  const el = byId('players');
  if (!el) return;
  const list = [];
  room.state.players.forEach((player, sid) => list.push([sid, player]));
  list.sort((a, b) => a[1].seat - b[1].seat);
  el.replaceChildren();
  if (!list.length) {
    const placeholder = document.createElement('div');
    placeholder.className = 'prow';
    placeholder.textContent = 'waiting…';
    el.appendChild(placeholder);
    return;
  }
  for (const [sid, player] of list) {
    const row = document.createElement('div');
    row.className = 'prow' + (room.state.turn === sid ? ' turn' : '');
    if (player.avatar) { // server enforces a data:image URL
      const img = document.createElement('img');
      img.className = 'pav';
      img.src = player.avatar;
      row.appendChild(img);
    } else { // colour is a server palette value
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = player.color;
      row.appendChild(dot);
    }
    const label = document.createElement('span');
    label.textContent = `${player.name}${sid === mySession ? ' (you)' : ''} \u00b7 ${player.hand}`; // textContent = inert
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

// Position `mesh` at time `renderTime` by interpolating its buffered snapshots.
// Before the first / after the last snapshot, clamp to that endpoint.
function sample(buf, renderTime, mesh) {
  const count = buf.length;
  if (!count) return;
  if (count === 1 || renderTime <= buf[0].t) { applyTransform(mesh, buf[0]); return; }
  if (renderTime >= buf[count - 1].t)         { applyTransform(mesh, buf[count - 1]); return; }

  // Find the pair of snapshots (a, b) bracketing renderTime, then lerp/slerp between them.
  let i = count - 2;
  while (i > 0 && buf[i].t > renderTime) i--;
  const a = buf[i], b = buf[i + 1];
  const fraction = (renderTime - a.t) / ((b.t - a.t) || 1);
  mesh.position.set(a.x + (b.x - a.x) * fraction, a.y + (b.y - a.y) * fraction, a.z + (b.z - a.z) * fraction);
  qa.set(a.qx, a.qy, a.qz, a.qw);
  qb.set(b.qx, b.qy, b.qz, b.qw);
  mesh.quaternion.copy(qa).slerp(qb, fraction);
}
let boardTopY = 0; // top surface of the current board (0 = bare table) — where the drop marker sits

// ===== Cosmetic animation layer =============================================
// Purely visual, event-driven flourishes (e.g. a deck riffle on shuffle). They
// add a decaying offset ON TOP of the interpolated server transform — never touch
// physics — using only rotation/position, which sample() resets each frame (so no
// drift accumulates). Add a new one: a CONFIG.anim entry + a branch in applyAnim.
const anims = new Map(); // id -> { kind, start }
function startAnim(id, kind) {
  if (CONFIG.anim[kind]) anims.set(id, { kind, start: performance.now() });
}
function applyAnim(id, mesh) {
  const anim = anims.get(id);
  if (!anim) return;
  const cfg = CONFIG.anim[anim.kind];
  const progress = (performance.now() - anim.start) / cfg.dur;
  if (progress >= 1) { anims.delete(id); return; }
  if (anim.kind === 'shuffle') { // riffle: a fast fading side-to-side wiggle + a little lift-and-settle
    mesh.rotateY(Math.sin(progress * Math.PI * cfg.cycles) * cfg.yaw * (1 - progress));
    mesh.position.y += Math.sin(progress * Math.PI) * cfg.bob;
  }
}

// "If dropped" marker: a flat ring on the table under whatever you're holding,
// showing where it would land if released now (straight down).
const dropMarker = new THREE.Mesh(
  new THREE.RingGeometry(CONFIG.marker.inner, CONFIG.marker.outer, 40),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: CONFIG.marker.opacity, side: THREE.DoubleSide, depthWrite: false }));
dropMarker.rotation.x = -Math.PI / 2;
dropMarker.renderOrder = 3;
dropMarker.visible = false;
scene.add(dropMarker);

(function animate() {
  const renderTime = performance.now() - DELAY;
  for (const [id, { mesh }] of meshes) {
    const buf = buffers.get(id);
    if (buf) sample(buf, renderTime, mesh);
    if (anims.size) applyAnim(id, mesh);
  }
  const held = down && down.grabbed && meshes.get(down.id); // landing spot under the held piece
  if (held) {
    dropMarker.position.set(held.mesh.position.x, boardTopY + CONFIG.marker.lift, held.mesh.position.z);
    dropMarker.visible = true;
  } else {
    dropMarker.visible = false;
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
})();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
