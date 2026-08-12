import * as THREE from 'three';
import { CONFIG, clamp, scene, camera, renderer, controls, resizeTable } from './core.js';
import { KIND, makeCanvas, cTex, cardMesh, propColor, measureModel, measureBoard, resizeToCanvas, splitColorText, uploadImage, uploadModel } from './graphics.js';
import { KINDS as PHYS, PROPS, PROP_LIST, COLORS, BOARDS, DIE_SIDES, deckHeight, timerLive } from '/shared/pieces.js';

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
let myIsAdmin = false; // set by the server's 'whoami' on join; gates library-creation UI
let myRank = 0;        // set by applyRole; gates scoreboard (helper+) + room notes (gm+) editing
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
  const params = new URLSearchParams(location.search);
  const editorMode = !!window.OTT_EDITOR;                          // set by editor.html
  const code = (params.get('room') || 'LOBBY').toUpperCase();      // which table (handed over by the lobby)
  const authToken = localStorage.getItem('tabletop.token') || '';  // who you are (for the onAuth gate)
  const key = 'tt_token:' + code; // per-room reconnection token: survives refresh, distinct per table
  if (editorMode) {
    room = await client.joinOrCreate('editor', { token: authToken }); // admin-only workshop; no code, no reconnect
  } else {
    const saved = sessionStorage.getItem(key);
    if (saved) {
      try { room = await client.reconnect(saved); } catch (e) { room = null; }
    }
    if (!room) room = await client.joinOrCreate('table', { code, token: authToken });
    sessionStorage.setItem(key, room.reconnectionToken);
  }
  mySession = room.sessionId;
  statusEl.innerHTML = 'connected · <b>you</b>';
  if (!editorMode) { // room code, top-right — applyRole reveals it to GM+ only
    const rc = byId('roomCode');
    if (rc) { rc.textContent = 'Room Code: ' + code; rc.title = 'Click to copy'; rc.onclick = () => { navigator.clipboard && navigator.clipboard.writeText(code); }; }
  }
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
    cb(piece).listen('owner', () => updateHeldLabel(id, piece.owner), false); // name tag while held

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
    updateHeldLabel(id, ''); // drop its name tag if any
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

  room.onMessage('hand', cards => { myHand = cards; renderHand(cards); }); // your private hand — never seen by other clients
  room.onMessage('showFan', ({ sid, cards }) => { // cards another player is showing you, face-up in their fan
    if (cards && cards.length) revealed.set(sid, cards); else revealed.delete(sid);
    refreshFan(sid);
  });
  room.onMessage('ping', ({ sid, x, z }) => spawnPing(sid, x, z)); // someone's "look here" marker
  room.onMessage('memberList', (list) => { renderMembers(list); updateMembersPulse(list); }); // panel data + pending-pulse

  // Library creation/editing is admin-only; hide those controls for everyone else,
  // leaving the spawn pickers + built-in shapes. (The server enforces it too.)
  room.onMessage('whoami', ({ isAdmin }) => {
    myIsAdmin = !!isAdmin;
    document.body.classList.toggle('not-admin', !myIsAdmin);
    if (!myIsAdmin) { // the modals become spawn-only pickers — relabel so they read right
      const dt = byId('deckModalTitle'); if (dt) dt.textContent = 'Spawn a deck';
      const ct = byId('cpModalTitle'); if (ct) ct.textContent = 'Spawn a saved prop';
    }
  });

  // Forced exits: the GM kicked me, or the owner closed the room. These end the
  // session for good, so also drop the stale reconnection token — otherwise the
  // next visit tries to resume a seat the server already released, which logs
  // Colyseus's "reconnection token invalid" warning before falling back.
  let leaving = false;
  let exitReason = '';
  room.onMessage('roomClosed', () => { exitReason = 'This room was closed by the owner.'; sessionStorage.removeItem(key); });
  room.onMessage('kicked', () => { exitReason = 'You have been removed from this room by a GM.'; sessionStorage.removeItem(key); });
  room.onLeave(() => { if (!leaving) showExit(exitReason || 'You have been disconnected from the table.'); });

  // Leaving on purpose is a deliberate leave (no reconnection window), so clear the
  // token before we go — re-entering the same room should join fresh, not reconnect.
  byId('lobbyBtn').onclick = () => { leaving = true; sessionStorage.removeItem(key); try { room.leave(); } catch (e) {} location.href = '/'; };

  if (editorMode) { // workshop chrome: no member management, back to the admin console, hand the room to the panel
    const mb = byId('membersBtn'); if (mb) mb.hidden = true;
    const lb = byId('lobbyBtn'); lb.textContent = '← Admin';
    lb.onclick = () => { leaving = true; try { room.leave(); } catch (e) {} location.href = '/admin.html'; };
    if (window.onOttRoom) window.onOttRoom(room);
  }
  room.onMessage('notebook', text => { byId('notesText').value = text || ''; }); // your private notes, restored on reconnect
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
    if (sid === mySession) { mySeat = player.seat; applySeat(mySeat); applyRole(player.role); byId('nameInput').value = player.name; updateMyPreview(player.avatar); refreshMyChip(); }
    refreshFan(sid); refreshMarker(sid); renderPlayers();
    cb(player).listen('hand', () => { refreshFan(sid); renderPlayers(); }, false);
    cb(player).listen('seat', () => { if (sid === mySession) { mySeat = player.seat; applySeat(mySeat); refreshMyChip(); } refreshFan(sid); refreshMarker(sid); }, false);
    cb(player).listen('name', () => { refreshMarker(sid); renderPlayers(); }, false);
    cb(player).listen('role', () => { if (sid === mySession) applyRole(player.role); renderPlayers(); }, false);
    cb(player).listen('avatar', () => { if (sid === mySession) updateMyPreview(player.avatar); else refreshMarker(sid); renderPlayers(); }, false);
    cb(player).listen('color', () => { if (sid === mySession) refreshMyChip(); refreshMarker(sid); renderPlayers(); }, false);
    cb(player).listen('showing', () => refreshMarker(sid), false); // redraw the seat badge on show/stop
    cb(player).listen('handBack', () => refreshFan(sid), false); // re-skin the fan backs when the deck's back changes
  });
  cb(room.state).players.onRemove((player, sid) => { removePlayerVis(sid); renderPlayers(); });
  cb(room.state).listen('turn', renderPlayers, false);

  // Durable scoreboard + room notes (synced like the timer). Register
  // unconditionally: right after join the nested fields haven't decoded yet
  // (room.state.scores is briefly undefined), but the callback proxy tracks them
  // by schema and fires once they arrive. renderScores guards the empty window.
  // The try/catch only covers a theoretical old server missing these fields.
  try {
    cb(room.state).scores.onAdd((row) => { renderScores(); cb(row).listen('score', renderScores, false); cb(row).listen('label', renderScores, false); });
    cb(room.state).scores.onRemove(() => renderScores());
    cb(room.state).listen('notes', updateRoomNotes, false);
    cb(room.state).listen('tableX', () => { resizeTable(room.state.tableX, room.state.tableZ); rebuildSeats(); }, false);
    cb(room.state).listen('tableZ', () => { resizeTable(room.state.tableX, room.state.tableZ); rebuildSeats(); }, false);
  } catch (e) { /* older server without these fields — feature stays inert */ }
  renderScores(); updateRoomNotes();
  if (room.state.tableX) { resizeTable(room.state.tableX, room.state.tableZ); rebuildSeats(); } // initial size (may be default until decode)

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

  // The game table and the editor have different toolbars but share this file, so
  // every page-specific control is wired defensively (no-op if it isn't on the page).
  const wire = (id, fn) => { const el = byId(id); if (el) el.onclick = fn; };
  const menu = (btnId, grpId) => {
    const b = byId(btnId), g = byId(grpId); if (!b || !g) return;
    b.onclick = (e) => { e.stopPropagation(); const open = g.hidden; qsa('.grp').forEach(x => { if (x !== g) x.hidden = true; }); g.hidden = !open; };
    g.onclick = (e) => e.stopPropagation();
    document.addEventListener('click', () => g.hidden = true);
  };
  // Game-table spawn menus + Room Controls (absent in the editor).
  menu('objBtn', 'objGrp'); menu('deckBtn', 'deckGrp'); menu('boardBtn', 'boardGrp'); menu('roomBtn', 'roomGrp');
  wire('objBuiltin', () => { byId('objGrp').hidden = true; byId('propModal').hidden = false; });
  wire('objLibrary', () => { byId('objGrp').hidden = true; byId('customPropModal').hidden = false; room.send('listProps'); });
  wire('deckQuick', () => { byId('deckGrp').hidden = true; room.send('spawn', { type: 'deck', props: {} }); });
  wire('deckLibrary', () => { byId('deckGrp').hidden = true; byId('deckModal').hidden = false; room.send('listDecks'); });
  wire('boardBuiltin', () => { byId('boardGrp').hidden = true; byId('boardModal').hidden = false; });
  wire('boardLibrary', () => { byId('boardGrp').hidden = true; byId('boardLibraryModal').hidden = false; room.send('listBoards'); });
  wire('boardLibraryCancel', () => byId('boardLibraryModal').hidden = true);
  wire('roomMembers', () => { byId('roomGrp').hidden = true; const mp = byId('membersPanel'); mp.hidden = !mp.hidden; if (!mp.hidden) room.send('members'); });
  wire('roomScene', () => { byId('roomGrp').hidden = true; byId('scenesModal').hidden = false; room.send('listScenes'); });
  wire('roomTable', () => { byId('roomGrp').hidden = true; byId('tableModal').hidden = false; byId('tableW').value = Math.round(room.state.tableX * 2); byId('tableD').value = Math.round(room.state.tableZ * 2); });
  wire('tableCancel', () => byId('tableModal').hidden = true);
  wire('roomReset', () => { byId('roomGrp').hidden = true; if (confirm('Reset the table? This clears all pieces.')) room.send('reset'); });
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
  room.onMessage('deckList', decks => { renderSavedList('savedList', decks, {
    emptyNote: 'none saved yet',
    labelFor: d => `${d.name} · ${d.count}`,
    buttonsFor: d => [
      ...(window.OTT_EDITOR ? [{ text: 'Edit', onClick: () => openEditDeck(d) }] : []),
      { text: 'Load', onClick: () => { room.send('loadDeck', { id: d.id }); byId('deckModal').hidden = true; } },
    ],
  }); if (window.onLibraryList) window.onLibraryList('deck', decks); });
  wire('newDeck', () => { byId('deckModal').hidden = false; room.send('listDecks'); });

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
  wire('newProp', () => { byId('propModal').hidden = false; });
  wire('propCustom', () => { byId('propModal').hidden = true; byId('customPropModal').hidden = false; room.send('listProps'); });
  wire('cpCancel', () => byId('customPropModal').hidden = true);
  const cpTint = byId('cpTintColor');
  if (cpTint) cpTint.oninput = () => { qs('input[name="cpColorMode"][value="tint"]').checked = true; }; // picking a colour implies you want it tinted

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

      room.send('editDeck', { id: editingDeck.id, name, back, addFronts, saveAs });
      byId('editDeckModal').hidden = true;
    } catch (e) {
      alert('Edit failed — an image upload may have errored.');
    }
    buttons.forEach(b => b.disabled = false);
  }
  byId('editDeckCancel').onclick = () => byId('editDeckModal').hidden = true;
  byId('editDeckSave').onclick = () => commitDeckEdit(false);
  byId('editDeckCopy').onclick = () => commitDeckEdit(true);

  room.onMessage('propList', props => { renderSavedList('propSavedList', props, {
    labelFor: sp => sp.name,
    buttonsFor: sp => [
      ...(window.OTT_EDITOR ? [{ text: 'Edit', onClick: () => openEditProp(sp) }] : []),
      { text: 'Spawn', onClick: () => room.send('spawn', { type: 'prop', props: sp.props }) },
    ],
  }); if (window.onLibraryList) window.onLibraryList('prop', props); });
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
  wire('cpSpawn', async () => { // custom .glb prop
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
  });
  wire('newBoard', () => {
    byId('boardModal').hidden = false; room.send('listBoards');
    const tw = byId('tableW'), td = byId('tableD'); // editor's board modal also carries table size
    if (tw) tw.value = Math.round(room.state.tableX * 2); // full size = 2 x half-extent
    if (td) td.value = Math.round(room.state.tableZ * 2);
  });
  const tableResizeBtn = byId('tableResize');
  if (tableResizeBtn) tableResizeBtn.onclick = () => {
    room.send('table', { x: (+byId('tableW').value || 20) / 2, z: (+byId('tableD').value || 14) / 2 });
    const tm = byId('tableModal'); if (tm) tm.hidden = true;
  };

  // Scene picker (GM+): load a published scene, replacing the whole table. The
  // message handler always registers (the editor panel gets scenes via the hook);
  // the toolbar/modal wiring is game-page only.
  room.onMessage('sceneList', scenes => {
    const el = byId('sceneSavedList');
    if (el) renderSavedList('sceneSavedList', scenes, {
      emptyNote: 'no scenes published yet',
      labelFor: s => s.name,
      buttonsFor: s => [
        { text: 'Load', onClick: () => { if (confirm(`Load "${s.name}"? This clears the current table.`)) { room.send('sceneLoad', { id: s.id }); byId('scenesModal').hidden = true; } } },
      ],
    });
    if (window.onLibraryList) window.onLibraryList('scene', scenes);
  });
  wire('scenesCancel', () => byId('scenesModal').hidden = true); // roomScene is already wired above (opens + closes the menu)
  { // built-in model boards
    const container = byId('builtinBoards');
    for (const key of Object.keys(BOARDS)) {
      const button = document.createElement('button');
      button.textContent = BOARDS[key].name;
      button.onclick = () => { room.send('spawn', { type: 'board', props: { board: key } }); byId('boardModal').hidden = true; };
      container.appendChild(button);
    }
  }
  wire('boardModelSpawn', async () => {
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
  });
  wire('boardSave', () => {
    let board = null;
    room.state.pieces.forEach(p => { if (p.type === 'board') board = JSON.parse(p.props || '{}'); });
    if (!board) { alert('No board on the table to save.'); return; }
    const name = prompt('Save board as:');
    if (name && name.trim()) room.send('saveBoard', { name: name.trim(), board });
  });
  room.onMessage('boardList', boards => { renderSavedList('boardSavedList', boards, {
    labelFor: b => b.name + (b.kind ? ` (${b.kind})` : ''),
    buttonsFor: b => [
      { text: 'Load', onClick: () => { room.send('loadBoard', { id: b.id }); byId('boardModal').hidden = true; const blm = byId('boardLibraryModal'); if (blm) blm.hidden = true; } },
    ],
  }); if (window.onLibraryList) window.onLibraryList('board', boards); });
  wire('boardCancel', () => byId('boardModal').hidden = true);
  byId('boardCreate').onclick = async () => {
    const btn = byId('boardCreate');
    const w = clamp(+byId('boardW').value || 8, ...CONFIG.ranges.boardW);
    const d = clamp(+byId('boardD').value || 8, ...CONFIG.ranges.boardD);
    const boardImgEl = byId('boardImg');                 // image upload is editor-only
    const imgFile = boardImgEl && boardImgEl.files[0];
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
    if (boardImgEl) boardImgEl.value = '';
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
  wire('deckCreate', async () => {
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
  });
  byId('roll').onclick = () => room.send('roll');
  wire('mySeatBtn', () => applySeat(mySeat)); // snap the camera back to your seat
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
  wire('myAv', () => byId('avatarInput').click()); // click the avatar circle to upload
  wire('reset', () => room.send('reset'));

  // Private notes: a personal scratchpad. Never synced — the server just holds the
  // text so it survives a reconnect (see the 'notebook' message below).
  const notes = byId('notes'), notesText = byId('notesText');
  byId('notesBtn').onclick = () => { notes.hidden = !notes.hidden; if (!notes.hidden) notesText.focus(); };
  byId('notesClose').onclick = () => { notes.hidden = true; };
  let notesTimer = null;
  notesText.addEventListener('input', () => { // debounce so we persist without flooding the socket
    clearTimeout(notesTimer);
    notesTimer = setTimeout(() => room.send('notebook', { text: notesText.value }), 400);
  });

  // Shared timer: controls just send commands; the readout is computed locally
  // from the synced anchor (state.timer), so it ticks smoothly with no per-second
  // patches. The interval also mirrors another client's changes into the controls.
  const timerPanel = byId('timer'), timerReadout = byId('timerReadout'), timerToggle = byId('timerToggle');
  const timerMode = byId('timerMode'), timerDurRow = byId('timerDurRow'), timerDur = byId('timerDur');
  const durMs = () => (+timerDur.value || 0) * 60000;
  byId('timerBtn').onclick = () => { timerPanel.hidden = !timerPanel.hidden; };
  byId('timerClose').onclick = () => { timerPanel.hidden = true; };

  // Scoreboard + room notes panel (game table only — not present in the editor)
  const scorePanel = byId('scorePanel');
  if (scorePanel) {
    byId('scoreBtn').onclick = () => { scorePanel.hidden = !scorePanel.hidden; if (!scorePanel.hidden) { renderScores(); updateRoomNotes(); } };
    byId('scoreClose').onclick = () => { scorePanel.hidden = true; };
    byId('scoreAdd').onclick = () => { const n = byId('scoreAddName'); room.send('score', { action: 'add', label: n.value.trim() || 'Player' }); n.value = ''; };
    byId('scoreAddName').onkeydown = (e) => { if (e.key === 'Enter') byId('scoreAdd').click(); };
    byId('scoreClear').onclick = () => { if (confirm('Clear the whole scoreboard?')) room.send('score', { action: 'clear' }); };
    const roomNotesEl = byId('roomNotes');
    let roomNotesTimer;
    roomNotesEl.oninput = () => { clearTimeout(roomNotesTimer); roomNotesTimer = setTimeout(() => room.send('roomNotes', { text: roomNotesEl.value }), 400); };
    roomNotesEl.onblur = () => { clearTimeout(roomNotesTimer); room.send('roomNotes', { text: roomNotesEl.value }); };
  }
  timerToggle.onclick = () => room.send('timer', { action: room.state.timer.running ? 'pause' : 'start' });
  byId('timerReset').onclick = () => room.send('timer', { action: 'reset' });
  timerMode.onchange = () => room.send('timer', { action: 'set', mode: timerMode.value, duration: durMs() });
  timerDur.onchange = () => room.send('timer', { action: 'set', mode: 'down', duration: durMs() });
  setInterval(() => {
    if (timerPanel.hidden) return; // nothing to draw while the panel is closed
    const t = room.state.timer;
    if (!t) return;
    timerReadout.textContent = fmtTime(timerLive(t, Date.now()));
    timerToggle.textContent = t.running ? 'Pause' : 'Start';
    if (timerMode.value !== t.mode) timerMode.value = t.mode; // reflect another client's switch
    timerDurRow.hidden = t.mode !== 'down';
    if (document.activeElement !== timerDur) timerDur.value = Math.round(t.duration / 60000); // don't fight typing
  }, 100);

  // ---- Members (GM tools): admit / kick / promote ----
  const membersPanel = byId('membersPanel');
  wire('membersBtn', () => { membersPanel.hidden = !membersPanel.hidden; if (!membersPanel.hidden) room.send('members'); });
  byId('membersClose').onclick = () => { membersPanel.hidden = true; };

  // ---- Show cards: pick an audience + scope, then hold the button to reveal ----
  const showPanel = byId('showPanel'), showAudience = byId('showAudience');
  const scopeHand = byId('showScopeHand'), scopeSel = byId('showScopeSel'), showHold = byId('showHold');

  function buildAudienceChips() { // rebuilt each open, so it tracks who's in the room
    showAudience.replaceChildren();
    const everyone = document.createElement('button');
    everyone.className = 'chip'; everyone.dataset.sid = 'all'; everyone.textContent = 'Everyone';
    everyone.onclick = () => {
      everyone.classList.toggle('on');
      if (everyone.classList.contains('on')) showAudience.querySelectorAll('.chip').forEach(c => { if (c !== everyone) c.classList.remove('on'); });
    };
    showAudience.appendChild(everyone);
    const others = [];
    room.state.players.forEach((p, sid) => { if (sid !== mySession) others.push([sid, p]); });
    others.sort((a, b) => a[1].seat - b[1].seat);
    for (const [sid, p] of others) {
      const chip = document.createElement('button');
      chip.className = 'chip'; chip.dataset.sid = sid;
      chip.textContent = p.name; // textContent = safe from HTML in names
      chip.style.borderColor = p.color;
      chip.onclick = () => { everyone.classList.remove('on'); chip.classList.toggle('on'); };
      showAudience.appendChild(chip);
    }
  }
  const currentAudience = () => {
    const everyone = showAudience.querySelector('[data-sid="all"]');
    if (everyone && everyone.classList.contains('on')) return 'all';
    return [...showAudience.querySelectorAll('.chip.on')].map(c => c.dataset.sid);
  };
  const enterSelectMode = () => { selectMode = true; selected.clear(); byId('hand').classList.add('selecting'); renderHand(myHand); };
  const exitSelectMode = () => {
    if (selectMode) { selectMode = false; selected.clear(); byId('hand').classList.remove('selecting'); renderHand(myHand); }
    scopeSel.classList.remove('on'); scopeHand.classList.add('on'); // reset to whole-hand
  };

  byId('showBtn').onclick = () => {
    showPanel.hidden = !showPanel.hidden;
    if (!showPanel.hidden) buildAudienceChips(); else exitSelectMode();
  };
  byId('showClose').onclick = () => { showPanel.hidden = true; exitSelectMode(); };
  scopeHand.onclick = () => { scopeHand.classList.add('on'); scopeSel.classList.remove('on'); if (selectMode) exitSelectMode(); };
  scopeSel.onclick = () => { scopeHand.classList.remove('on'); scopeSel.classList.add('on'); enterSelectMode(); };

  let showLive = false;
  showHold.addEventListener('pointerdown', e => {
    e.preventDefault();
    const to = currentAudience();
    if (to !== 'all' && !to.length) return; // no audience picked
    const hids = scopeSel.classList.contains('on') ? [...selected] : 'all';
    if (Array.isArray(hids) && !hids.length) return; // "selected" scope with nothing picked
    showHold.setPointerCapture(e.pointerId);
    showLive = true;
    room.send('showStart', { to, hids });
  });
  const endShow = () => { if (showLive) { showLive = false; room.send('showStop'); } };
  showHold.addEventListener('pointerup', endShow);
  showHold.addEventListener('pointercancel', endShow);
  showHold.addEventListener('lostpointercapture', endShow);
})().catch(err => {
  // onAuth rejections (not signed in / not a member / awaiting approval / no such
  // room) land here — show the reason and a way back to the lobby.
  showExit((err && err.message) || 'Could not join the table.');
  console.error(err);
});

// A full-screen "you're out" message with a link back to the lobby — used for a
// rejected join, a kick, or the room being closed under you.
function showExit(msg) {
  document.body.replaceChildren();
  const box = document.createElement('div');
  box.style.cssText = 'color:#e8e6e0;font:16px/1.5 system-ui,sans-serif;padding:48px;text-align:center;max-width:520px;margin:10vh auto';
  box.textContent = msg;
  const link = document.createElement('a');
  link.href = '/'; link.textContent = '← Back to lobby';
  link.style.cssText = 'color:#c9a25a;display:block;margin-top:20px;text-decoration:none';
  box.appendChild(link);
  document.body.appendChild(box);
}

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
renderer.domElement.addEventListener('mousedown', e => { // middle-click: snap a held piece, else ping the table
  if (e.button === 1) {
    e.preventDefault();
    if (down && down.grabbed) room.send('snap', { id: down.id });
    else { setPointer(e); sendPing(); }
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
  } else if ((e.key === 'p' || e.key === 'P') && !e.repeat) { // ping the table at the cursor
    sendPing();
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

// Show-cards feature state. revealed: cards another player is showing us, drawn
// face-up in their fan. selectMode/selected: while the Show panel is picking
// specific cards, the hand bar toggles selection instead of playing. myHand: the
// last hand we received, so we can re-render on a select-mode toggle.
const revealed = new Map(); // sid -> [{front,back}]
const selected = new Set(); // hids picked to show
let selectMode = false, myHand = [];
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
    if (selectMode && selected.has(card.hid)) div.classList.add('sel');
    div.addEventListener('pointerdown', ev => {
      if (selectMode) { // picking cards to show — toggle instead of playing
        if (ev.button !== 0) return;
        ev.preventDefault();
        if (selected.has(card.hid)) { selected.delete(card.hid); div.classList.remove('sel'); }
        else { selected.add(card.hid); div.classList.add('sel'); }
        return;
      }
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
// Seats scale with the current table half-extents (state.tableX/tableZ): hands sit
// just inside each edge and cameras pull back proportionally, so markers/hands stay
// at the table's edge on any size. Each client parks its camera at its own seat and
// renders every OTHER player's hand as face-down backs at their seat.
let mySeat = 0;
function seatLayoutFor(hx, hz) {
  const m = 0.8;                          // hand inset from the edge
  const cx = hx * 0.66, cz = hz * 0.69;   // diagonal (corner) seat positions
  const sx = hx / 10, sz = hz / 7, sy = (sx + sz) / 2; // camera scale vs the default 20x14 table
  const cam = (p, t) => ({ pos: [p[0] * sx, p[1] * sy, p[2] * sz], target: [t[0] * sx, t[1] * sy, t[2] * sz] });
  return [
    { hand:[0, 0.25, hz - m],    out:[0,0,1],   cam: cam([0,13,17],    [0,0,1]) },   // front  (+z)
    { hand:[0, 0.25, -(hz - m)], out:[0,0,-1],  cam: cam([0,13,-17],   [0,0,-1]) },  // back   (-z)
    { hand:[hx - m, 0.25, 0],    out:[1,0,0],   cam: cam([17,13,0],    [1,0,0]) },   // right  (+x)
    { hand:[-(hx - m), 0.25, 0], out:[-1,0,0],  cam: cam([-17,13,0],   [-1,0,0]) },  // left   (-x)
    { hand:[cx, 0.25, cz],       out:[1,0,1],   cam: cam([14,13,11],   [0,0,0]) },   // front-right
    { hand:[-cx, 0.25, -cz],     out:[-1,0,-1], cam: cam([-14,13,-11], [0,0,0]) },   // back-left
  ];
}
let seatLayout = seatLayoutFor(10, 7);

// Recompute seats when the table resizes, then reposition everyone's markers, fans,
// and the "YOU" chip. The camera stays put (use the My Seat button to reframe).
function rebuildSeats() {
  if (!room || !room.state) return;
  seatLayout = seatLayoutFor(room.state.tableX || 10, room.state.tableZ || 7);
  room.state.players.forEach((p, sid) => { refreshMarker(sid); refreshFan(sid); });
  refreshMyChip();
}
const handGroups = new Map(); // sid -> THREE.Group of face-down backs

function applySeat(seat) {
  const layout = seatLayout[seat];
  if (!layout) return;
  camera.position.set(...layout.cam.pos);
  controls.target.set(...layout.cam.target);
  controls.update();
}

// Show/hide the toolbar by the player's per-room role. Courtesy only — the server
// gates every one of these actions too, so hiding a button protects no one; it
// just keeps people from clicking things that would be ignored.
function applyRole(role) {
  myRank = ({ owner: 3, gm: 2, helper: 1, player: 0 })[role] ?? 0;
  const rank = myRank;
  const gate = (id, min) => { const el = byId(id); if (el) el.hidden = rank < min; };
  gate('diceBtn', 1);                                          // roll dice: Helper+
  gate('objBtn', 1); gate('deckBtn', 1);                       // game-table spawn menus: Helper+
  gate('boardBtn', 2); gate('roomBtn', 2);                     // game-table board + Room Controls: GM+
  gate('roomCode', 2);                                         // room code display: GM+/owner/admin only
  gate('newProp', 1); gate('newDeck', 1); gate('newBoard', 2); // editor creation toolbar (absent on the table)
  gate('reset', 2); gate('scenesBtn', 2); gate('membersBtn', 2); // legacy standalone buttons (editor / older pages)
  if (window.OTT_EDITOR) { const mb = byId('membersBtn'); if (mb) mb.hidden = true; } // no member mgmt in the workshop
  applyBoardRole(); // scoreboard (helper+) and notes (gm+) edit affordances
}

// Scoreboard is helper+ editable, room notes GM+; everyone else sees them read-only.
function applyBoardRole() {
  const edit = byId('scoreEdit'); if (edit) edit.hidden = myRank < 1;
  const notes = byId('roomNotes'); if (notes) notes.readOnly = myRank < 2;
  renderScores();
}

function renderScores() {
  const tbody = byId('scoreRows'); if (!tbody || !room || !room.state || !room.state.scores) return;
  const mk = (t, fn, cls) => { const b = document.createElement('button'); b.textContent = t; if (cls) b.className = cls; b.onclick = fn; return b; };
  const canEdit = myRank >= 1;
  tbody.replaceChildren();
  room.state.scores.forEach((row, id) => {
    const tr = document.createElement('tr');
    const name = document.createElement('td'); name.className = 'scoreName';
    if (canEdit) {
      const inp = document.createElement('input'); inp.value = row.label; inp.maxLength = 40;
      inp.onchange = () => room.send('score', { action: 'label', id, label: inp.value });
      name.appendChild(inp);
    } else { name.textContent = row.label; }
    const val = document.createElement('td'); val.className = 'scoreVal'; val.textContent = row.score;
    const acts = document.createElement('td'); acts.className = 'scoreActs';
    if (canEdit) acts.append(
      mk('\u2212', () => room.send('score', { action: 'adjust', id, delta: -1 })),
      mk('+', () => room.send('score', { action: 'adjust', id, delta: 1 })),
      mk('\u00d7', () => room.send('score', { action: 'remove', id }), 'danger'),
    );
    tr.append(name, val, acts);
    tbody.appendChild(tr);
  });
  if (!room.state.scores.size) { const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = 3; td.className = 'scoreEmpty'; td.textContent = 'No scores yet.'; tr.appendChild(td); tbody.appendChild(tr); }
}

function updateRoomNotes() {
  const el = byId('roomNotes'); if (!el || !room || !room.state) return;
  if (document.activeElement === el) return;          // don't stomp a GM mid-type
  const notes = room.state.notes || '';
  if (el.value !== notes) el.value = notes;
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
  const shown = revealed.get(sid) || []; // cards this player is showing us (face-up)
  for (let i = 0; i < count; i++) {
    // Shown cards fill the leading fan slots face-up; the rest stay face-down,
    // showing the hand's own back image (public) rather than a generic default.
    const card = i < shown.length ? KIND.card.mesh({ front: shown[i].front, back: shown[i].back }) : KIND.card.mesh({ back: player.handBack || undefined });
    card.castShadow = card.receiveShadow = false;
    const offset = i - (count - 1) / 2;
    // Lift each card a hair above the last so overlapping cards layer cleanly
    // instead of z-fighting (coplanar backs share the stripe texture and tear).
    card.position.set(seat.hand[0] + tangent.x * offset * 0.55, seat.hand[1] + i * 0.012, seat.hand[2] + tangent.z * offset * 0.55);
    card.rotation.y = yaw + offset * 0.06; // slight fan
    card.scale.setScalar(0.8);
    group.add(card);
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
  const { canvas, ctx } = makeCanvas(width, height);

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
    if (player.showing > 0) { // public "is revealing cards" badge — count only, never the content
      ctx.fillStyle = player.color;
      roundRect(ctx, width / 2 - 64, 12, 128, 30, 15);
      ctx.fill();
      ctx.fillStyle = '#14181d';
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText('SHOWING ' + player.showing, width / 2, 28);
      ctx.textBaseline = 'alphabetic';
    }
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

// A small floating name-tag texture: translucent pill, border in the player's
// colour, their name centred. Shown over a piece while someone else holds it.
function nameTag(name, color) {
  const width = 256, height = 80;
  const { canvas, ctx } = makeCanvas(width, height);
  ctx.fillStyle = 'rgba(20,24,29,0.9)';
  roundRect(ctx, 4, 4, width - 8, height - 8, 18);
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = color;
  roundRect(ctx, 4, 4, width - 8, height - 8, 18);
  ctx.stroke();
  ctx.fillStyle = '#e8e6e0';
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((name || 'Player').slice(0, 14), width / 2, height / 2 + 2);
  return cTex(canvas);
}

// Floating name tags over held pieces — everyone sees who's moving what. Created
// and torn down as ownership changes; the render loop keeps each one over its
// piece. Own pieces get no tag (you know it's you), matching the seat markers.
const heldLabels = new Map(); // pieceId -> THREE.Sprite
function updateHeldLabel(id, owner) {
  const existing = heldLabels.get(id);
  if (existing) {
    scene.remove(existing);
    existing.material.map.dispose();
    existing.material.dispose();
    heldLabels.delete(id);
  }
  if (!owner || owner === mySession) return;
  const player = room.state.players.get(owner);
  if (!player) return;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTag(player.name, player.color), transparent: true, depthTest: false }));
  sprite.scale.set(CONFIG.label.w, CONFIG.label.h, 1);
  sprite.renderOrder = 4; // above pieces and the drop marker
  scene.add(sprite);
  heldLabels.set(id, sprite);
}

// Attention pings: a translucent ring pulses out on the table with the pinger's
// name. Triggered by middle-click or P (see the handlers), broadcast to everyone,
// and animated + expired by the render loop.
const pings = []; // { ring, label, start }
function sendPing() { // raycast the cursor onto the table and ask the server to broadcast
  if (!room) return;
  ray.setFromCamera(pointer, camera);
  const spot = new THREE.Vector3();
  if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -boardTopY), spot)) {
    room.send('ping', { x: spot.x, z: spot.z });
  }
}
function spawnPing(sid, x, z) {
  const player = room.state.players.get(sid);
  const color = player ? player.color : '#ffffff';
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(CONFIG.ping.inner, CONFIG.ping.outer, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, boardTopY + CONFIG.ping.lift, z);
  ring.renderOrder = 5;
  scene.add(ring);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTag(player ? player.name : '', color), transparent: true, depthTest: false }));
  label.scale.set(CONFIG.label.w, CONFIG.label.h, 1);
  label.position.set(x, boardTopY + 0.6, z);
  label.renderOrder = 6;
  scene.add(label);
  pings.push({ ring, label, start: performance.now() });
}

// Format milliseconds as m:ss (or h:mm:ss past an hour), flooring to whole seconds.
function fmtTime(ms) {
  const total = Math.floor(ms / 1000);
  const s = total % 60, m = Math.floor(total / 60) % 60, h = Math.floor(total / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
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
    new THREE.PlaneGeometry(2.20, 3.00),
    new THREE.MeshBasicMaterial({ map: makePlayerTexture(player), transparent: true }));
  plane.position.set(px, 1.55, pz);
  plane.lookAt(0, 1.05, 0); // face the table centre
  group.add(plane);

  scene.add(group);
  markers.set(sid, group);
}

function removePlayerVis(sid) {
  removeFan(sid);
  revealed.delete(sid); // drop anything they were showing us
  const marker = markers.get(sid);
  if (marker) { scene.remove(marker); markers.delete(sid); }
}

// A flat "YOU" chip laid on the felt at your own seat, so you know which edge is
// yours (your standing billboard is skipped — no need to see yourself).
let myChip = null;
function makeYouChipTexture(color) {
  const { canvas, ctx } = makeCanvas(128, 128);
  ctx.clearRect(0, 0, 128, 128);
  ctx.beginPath(); ctx.arc(64, 64, 58, 0, 7);
  ctx.fillStyle = 'rgba(20,24,29,0.5)'; ctx.fill();
  ctx.lineWidth = 8; ctx.strokeStyle = color; ctx.stroke();
  ctx.fillStyle = color; ctx.font = 'bold 42px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('YOU', 64, 66);
  return cTex(canvas);
}
function refreshMyChip() {
  if (myChip) { scene.remove(myChip); myChip = null; }
  if (!room || !room.state) return;
  const me = room.state.players.get(mySession);
  if (!me) return;                 // wait until we know our own seat
  const seat = seatLayout[mySeat];
  if (!seat) return;
  const color = me.color || '#c9a25a';
  const out = new THREE.Vector3(...seat.out).normalize();
  const px = seat.hand[0] + out.x * 0.3, pz = seat.hand[2] + out.z * 0.3; // on the felt, at your edge
  const chip = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 1.5),
    new THREE.MeshBasicMaterial({ map: makeYouChipTexture(color), transparent: true, depthWrite: false }));
  chip.rotation.x = -Math.PI / 2; // lie flat on the felt
  chip.position.set(px, 0.03, pz);
  scene.add(chip);
  myChip = chip;
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
    if (player.role && player.role !== 'player') { // badge for helper/gm/owner
      const badge = document.createElement('span');
      badge.className = 'rolebadge';
      badge.textContent = player.role;
      row.appendChild(badge);
    }
    el.appendChild(row);
  }
}

// Pulse the Members button in the accent colour while any join is pending, so a
// GM sees new requests without opening the panel.
function updateMembersPulse(list) {
  const pending = list.some((m) => m.status === 'pending');
  const roomBtn = byId('roomBtn') || byId('membersBtn'); // Room menu on the table; standalone in the editor
  if (roomBtn) roomBtn.classList.toggle('pulse', pending);
  const roomMembers = byId('roomMembers');              // the Members item inside the Room menu
  if (roomMembers) roomMembers.classList.toggle('pulse', pending);
}

// The GM-only Members panel: the full membership (incl. offline/pending, from the
// server's DB list) with admit/kick/promote controls. Buttons just send messages;
// the server authorizes and pushes a fresh list back.
function renderMembers(list) {
  const ul = byId('memberList'); if (!ul) return;
  ul.replaceChildren();
  const me = room.state.players.get(mySession);
  const myName = me ? me.name : '';
  const myRank = ({ owner: 3, gm: 2, helper: 1, player: 0 })[me ? me.role : 'player'] ?? 0;
  const btn = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; return b; };
  if (!list.length) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'No members.'; ul.appendChild(li); return; }
  for (const m of list) {
    const li = document.createElement('li'); li.className = 'memberRow';
    const info = document.createElement('span');
    info.textContent = m.username;
    const tag = document.createElement('span'); tag.className = 'muted';
    tag.textContent = ` \u00b7 ${m.role}${m.status === 'pending' ? ' \u00b7 pending' : ''}`;
    info.appendChild(tag);
    li.appendChild(info);
    const acts = document.createElement('span'); acts.className = 'memberActions';
    const isSelf = m.username === myName;
    if (m.status === 'pending') {
      acts.append(btn('Admit', () => room.send('admit', { userId: m.userId })),
                  btn('Reject', () => room.send('kick', { userId: m.userId })));
    } else if (!isSelf && m.role !== 'owner') {
      if (m.role === 'player') acts.appendChild(btn('→ Helper', () => room.send('setRole', { userId: m.userId, role: 'helper' })));
      if (m.role === 'helper') acts.appendChild(btn('→ Player', () => room.send('setRole', { userId: m.userId, role: 'player' })));
      if (myRank >= 3) { // owner manages co-GMs
        if (m.role !== 'gm') acts.appendChild(btn('→ GM', () => room.send('setRole', { userId: m.userId, role: 'gm' })));
        else acts.appendChild(btn('→ Helper', () => room.send('setRole', { userId: m.userId, role: 'helper' })));
      }
      if (m.role !== 'gm' || myRank >= 3) acts.appendChild(btn('Kick', () => room.send('kick', { userId: m.userId })));
    }
    li.appendChild(acts);
    ul.appendChild(li);
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
  for (const [id, sprite] of heldLabels) { // keep each name tag hovering over its piece
    const entry = meshes.get(id);
    if (entry) sprite.position.set(entry.mesh.position.x, entry.mesh.position.y + CONFIG.label.lift, entry.mesh.position.z);
  }
  for (let i = pings.length - 1; i >= 0; i--) { // expand + fade each active ping, then dispose
    const p = pings[i], t = (performance.now() - p.start) / CONFIG.ping.dur;
    if (t >= 1) {
      scene.remove(p.ring); p.ring.geometry.dispose(); p.ring.material.dispose();
      scene.remove(p.label); p.label.material.map.dispose(); p.label.material.dispose();
      pings.splice(i, 1);
      continue;
    }
    p.ring.scale.setScalar(1 + t * CONFIG.ping.grow);
    p.ring.material.opacity = 0.75 * (1 - t);
    p.label.material.opacity = t < 0.6 ? 1 : (1 - t) / 0.4; // hold, then fade near the end
    p.label.position.y = boardTopY + 0.6 + t * 0.35;        // drift up a touch
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
