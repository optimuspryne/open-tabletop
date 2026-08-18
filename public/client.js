import * as THREE from 'three';
import { CONFIG, clamp, scene, camera, renderer, controls, resizeTable, setTableColor } from './core.js';
import { KIND, OVERLAY, makeCanvas, cTex, cardMesh, propColor, measureModel, measureBoard, resizeToCanvas, parseCardFront, cardPreviewURL, uploadImage, uploadModel } from './graphics.js';
import { KINDS as PHYS, PROPS, PROP_LIST, BOARDS, DIE_SIDES, deckHeight, timerLive, MEASURE, formatMeasure } from '/shared/pieces.js';
import { playSfx, resumeAudio, setSfxVolume, getSfxVolume, setSfxMuted, getSfxMuted, setMusicMuted, getMusicMuted, toggleMusic, nextTrack, playTrack, currentTrackIndex, getShuffle, setShuffle, setMusicVolume, getMusicVolume, isMusicPlaying, onMusicTrack } from './audio.js';
import { MUSIC, MUSIC_CREDIT, SFX_CREDITS, LIB_CREDITS } from './credits.js';
window.addEventListener('pointerdown', resumeAudio, { once: true }); // browsers block audio until a user gesture

// ===== Tiny DOM helpers =====================================================
const byId = (id) => document.getElementById(id);
const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => document.querySelectorAll(selector);

// Wrap every number input in a themed − / + stepper (universal number-field style).
// The original input is kept in place, so existing byId() reads still work; the
// buttons just step the value and fire input/change so any listeners react.
function enhanceNumberInputs() {
  document.querySelectorAll('input[type="number"]').forEach((input) => {
    if (input.closest('.stepper')) return; // already wrapped
    const wrap = document.createElement('span');
    wrap.className = 'stepper';
    input.parentNode.insertBefore(wrap, input);
    const fire = () => { input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); };
    const btn = (label, step) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'stepBtn'; b.textContent = label; b.tabIndex = -1;
      b.onclick = () => { step > 0 ? input.stepUp() : input.stepDown(); fire(); }; // stepUp/Down honour min/max/step
      return b;
    };
    wrap.append(btn('\u2212', -1), input, btn('+', 1));
  });
}
enhanceNumberInputs();

// Append one chat message to the log; auto-scroll if the reader's at the bottom,
// and flag the Tools button as unread when the panel's closed.
function addChatMsg(m) {
  const log = byId('chatLog'); if (!log || !m) return;
  const row = document.createElement('div'); row.className = 'chatMsg';
  const who = document.createElement('span'); who.className = 'chatFrom'; who.textContent = (m.from || 'Player') + ': ';
  row.append(who, document.createTextNode(m.text || ''));
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.appendChild(row);
  if (atBottom) log.scrollTop = log.scrollHeight;
  const chat = byId('chat'), chatBtn = byId('chatBtn');
  if (chat && chat.hidden && chatBtn) chatBtn.classList.add('hasUnread');
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
    if (piece.type === 'die' || piece.type === 'prop') {
      cb(piece).listen('props', () => rebuildPiece(id, piece), false); // recolor / prop tweaks
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

  // Overlays (measurement/templates) are public synced state, so a late joiner gets
  // them in the initial state — no replay needed. Immutable once placed in Step 3
  // (no overlayMove wired yet), so add/remove is the whole lifecycle here.
  cb(room.state).overlays.onAdd((o, id) => addOverlay(id, o));
  cb(room.state).overlays.onRemove((o, id) => removeOverlay(id));

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
    syncWhiteboard(state.whiteboard); // reflect enable / slide / style changes
    syncSkybox(state.skybox);         // reflect the room's skybox
  });

  room.onMessage('hand', cards => { myHand = cards; renderHand(cards); }); // your private hand — never seen by other clients
  room.send('handSync'); // re-fetch our hand now the handler is ready (onJoin's send is missed on reconnect)
  room.onMessage('showFan', ({ sid, cards }) => { // cards another player is showing you, face-up in their fan
    if (cards && cards.length) revealed.set(sid, cards); else revealed.delete(sid);
    refreshFan(sid);
  });
  room.onMessage('ping', ({ sid, x, z }) => spawnPing(sid, x, z)); // someone's "look here" marker
  room.onMessage('wbStroke', (s) => { if (!s || s.sid === mySession) return; pushStroke(s); }); // another player drew (skip our own echo)
  room.onMessage('wbStrokes', ({ strokes } = {}) => { wbStrokesLocal.length = 0; for (const s of (strokes || [])) wbStrokesLocal.push(s); redrawStrokes(); }); // full replay (late join)
  room.onMessage('chatMsg', (m) => addChatMsg(m));
  room.onMessage('chatLog', ({ log } = {}) => { const el = byId('chatLog'); if (el) el.replaceChildren(); (log || []).forEach(addChatMsg); }); // late-join replay
  room.onMessage('wbClear', () => { wbStrokesLocal.length = 0; if (wbTex) wbClearCanvas(); });
  room.onMessage('skyList', (list) => { if (window.onLibraryList) window.onLibraryList('sky', list || []); }); // fans to the library + skybox picker
  room.onMessage('skyError', ({ message } = {}) => { const e = byId('skyErr'); if (e) e.textContent = message || 'Could not add that skybox.'; });
  room.onMessage('memberList', (list) => { renderMembers(list); updateMembersPulse(list); }); // panel data + pending-pulse

  // Library creation/editing is admin-only; hide those controls for everyone else,
  // leaving the spawn pickers + built-in shapes. (The server enforces it too.)
  room.onMessage('whoami', ({ isAdmin }) => {
    myIsAdmin = !!isAdmin;
    window.OTT_IS_ADMIN = myIsAdmin;                   // editor-panel.js gates library management on this
    if (window.onLibraryAdmin) window.onLibraryAdmin(); // re-render the library so admin-only buttons appear/hide
    document.body.classList.toggle('not-admin', !myIsAdmin);
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
    const lb = byId('lobbyBtn'); lb.textContent = '🔙 Admin';
    lb.onclick = () => { leaving = true; try { room.leave(); } catch (e) {} location.href = '/admin.html'; };
  }
  if (window.onOttRoom) window.onOttRoom(room); // hand the room to the library panel (editor + table)
  room.onMessage('notebook', text => { byId('notesText').value = text || ''; }); // your private notes, restored on reconnect
  room.onMessage('shuffled', ({ id }) => { startAnim(id, 'shuffle'); playSfx('shuffle'); }); // everyone sees + hears the riffle
  room.onMessage('sfx', ({ type } = {}) => playSfx(type)); // shared cue (roll/flip/deal) broadcast by the server
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
    refreshFan(sid); refreshMarker(sid); renderPlayers(); renderUnclaimed();
    cb(player).listen('hand', () => { refreshFan(sid); renderPlayers(); }, false);
    cb(player).listen('seat', () => { if (sid === mySession) { mySeat = player.seat; applySeat(mySeat); refreshMyChip(); } refreshFan(sid); refreshMarker(sid); }, false);
    cb(player).listen('name', () => { refreshMarker(sid); renderPlayers(); }, false);
    cb(player).listen('role', () => { if (sid === mySession) applyRole(player.role); renderPlayers(); }, false);
    cb(player).listen('avatar', () => { if (sid === mySession) updateMyPreview(player.avatar); else refreshMarker(sid); renderPlayers(); }, false);
    cb(player).listen('color', () => { if (sid === mySession) refreshMyChip(); refreshMarker(sid); renderPlayers(); }, false);
    cb(player).listen('showing', () => refreshMarker(sid), false); // redraw the seat badge on show/stop
    cb(player).listen('handBack', () => refreshFan(sid), false); // re-skin the fan backs when the deck's back changes
  });
  cb(room.state).players.onRemove((player, sid) => { removePlayerVis(sid); renderPlayers(); renderUnclaimed(); });
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
    cb(room.state).listen('feltColor', () => setTableColor(room.state.feltColor), false);
    cb(room.state).unclaimed.onAdd(() => renderUnclaimed());
    cb(room.state).unclaimed.onRemove(() => renderUnclaimed());
    cb(room.state).listen('turnPending', renderPlayers, false);
    cb(room.state).scale.listen('worldPerUnit', syncScalePanel, false);
    cb(room.state).scale.listen('unitLabel', syncScalePanel, false);
    cb(room.state).scale.listen('roundStep', syncScalePanel, false);
  } catch (e) { /* older server without these fields — feature stays inert */ }
  renderScores(); updateRoomNotes(); renderUnclaimed();
  if (room.state.tableX) { resizeTable(room.state.tableX, room.state.tableZ); rebuildSeats(); } // initial size (may be default until decode)
  if (room.state.feltColor) setTableColor(room.state.feltColor); // initial felt colour

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
  // Room Controls menu — the old spawn/add menus are gone; creation + spawning
  // now live in View Library, Built-Ins, and (editor) Add to Library.
  menu('roomBtn', 'roomGrp');
  wire('roomMembers', () => { byId('roomGrp').hidden = true; const mp = byId('membersPanel'); mp.hidden = !mp.hidden; if (!mp.hidden) room.send('members'); renderUnclaimed(); });
  // roomScene opens the Library on its Scenes tab — wired in editor-panel.js (which owns the panel).
  wire('roomTable', () => { byId('roomGrp').hidden = true; const tm = byId('tableModal'); tm.hidden = !tm.hidden; if (!tm.hidden) { byId('tableW').value = Math.round(room.state.tableX * 2); byId('tableD').value = Math.round(room.state.tableZ * 2); byId('tableFelt').value = room.state.feltColor || '#2f6b4f'; syncScalePanel(); } });
  wire('tableClose', () => byId('tableModal').hidden = true);
  { // GM: whiteboard config — a Tools-menu panel that flows below the menu (not a full-screen modal)
    const wbPanel = byId('whiteboard'), wbBtn = byId('wbBtn');
    if (wbPanel && wbBtn) {
      wbBtn.onclick = () => {
        wbPanel.hidden = !wbPanel.hidden;
        if (!wbPanel.hidden) { // sync controls from current room state on open
          const wb = room.state.whiteboard;
          byId('wbEnabled').classList.toggle('on', wb.enabled);
          qsa('#whiteboard [data-wbstyle]').forEach(c => c.classList.toggle('on', c.dataset.wbstyle === (wb.dark ? 'dark' : 'light')));
          byId('wbAngle').value = Math.round(wb.angle * 180 / Math.PI);
        }
      };
      const wbClose = byId('wbClose'); if (wbClose) wbClose.onclick = () => { wbPanel.hidden = true; };
    }
  }
  { const el = byId('wbEnabled'); if (el) el.onclick = () => { const on = !el.classList.contains('on'); el.classList.toggle('on', on); room.send('wbEnable', { on }); }; }
  { const el = byId('wbAngle'); if (el) el.oninput = () => room.send('wbSet', { angle: (+el.value) * Math.PI / 180 }); }
  qsa('#whiteboard [data-wbstyle]').forEach(c => c.onclick = () => {
    qsa('#whiteboard [data-wbstyle]').forEach(x => x.classList.remove('on'));
    c.classList.add('on');
    room.send('wbSet', { dark: c.dataset.wbstyle === 'dark' });
  });
  wire('wbPen', () => { wbTool = 'pen'; wbSyncToolButtons(); });
  wire('wbEraser', () => { wbTool = 'eraser'; wbSyncToolButtons(); });
  wire('wbClearBtn', () => room.send('wbClear'));
  wire('wbDone', () => room.send('wbRelease'));
  wire('roomReset', () => { byId('roomGrp').hidden = true; if (confirm('Reset the table? This clears all pieces.')) room.send('reset'); });
  room.onMessage('deckList',  decks  => { if (window.onLibraryList) window.onLibraryList('deck', decks); });
  room.onMessage('propList',  props  => { if (window.onLibraryList) window.onLibraryList('prop', props); });
  // Live table resize: each ± (or a typed change) on width/depth applies immediately.
  { const send = () => room.send('table', { x: (+byId('tableW').value || 20) / 2, z: (+byId('tableD').value || 14) / 2 });
    const w = byId('tableW'), d = byId('tableD');
    if (w) w.onchange = send;
    if (d) d.onchange = send;
    const felt = byId('tableFelt'); if (felt) felt.oninput = () => room.send('tableColor', { color: felt.value }); }

  // Measurement scale (GM-set, durable). Reads live from room.state.scale; writes
  // via scaleSet. Drag-calibration lands with the ruler tool (Step 3).
  function syncScalePanel() {
    const sc = room.state.scale; if (!sc) return;
    const u = sc.unitLabel || 'u';
    const uEl = byId('scaleUnit'); if (uEl && document.activeElement !== uEl) uEl.value = u;
    const sEl = byId('scaleStep'); if (sEl && document.activeElement !== sEl) sEl.value = sc.roundStep;
    const su = byId('scaleStepUnit'); if (su) su.textContent = u;
    const wu = byId('scaleWidthUnit'); if (wu) wu.textContent = u;
    const wv = byId('scaleWidthVal'); // prefill with the table's CURRENT width in display units (editable)
    if (wv && document.activeElement !== wv) { const cur = (room.state.tableX * 2) / (+sc.worldPerUnit || 1); wv.value = Number.isFinite(cur) ? String(+cur.toFixed(2)) : ''; }
    const now = byId('scaleNow');
    if (now) now.textContent = (sc.worldPerUnit === 1 && u === 'u')
      ? 'Uncalibrated — 1 u = 1 table unit.'
      : `1 ${u} = ${(+sc.worldPerUnit).toFixed(3)} table units · round to ${sc.roundStep} ${u}`;
    relabelOverlays(); // scale drives every ruler's label
  }
  {
    const uEl = byId('scaleUnit'); if (uEl) uEl.onchange = () => room.send('scaleSet', { unitLabel: uEl.value });
    const sEl = byId('scaleStep'); if (sEl) sEl.onchange = () => { const v = +sEl.value; if (v > 0) room.send('scaleSet', { roundStep: v }); };
    // Presets set the label + a sensible round step — NOT worldPerUnit (calibration does that).
    const preset = (label, step) => room.send('scaleSet', { unitLabel: label, roundStep: step });
    const pin = byId('scalePreIn'); if (pin) pin.onclick = () => preset('in', 0.5);
    const pcm = byId('scalePreCm'); if (pcm) pcm.onclick = () => preset('cm', 1);
    const pmm = byId('scalePreMm'); if (pmm) pmm.onclick = () => preset('mm', 1);
    // Calibrate from the typed real width: worldPerUnit = tableWorldWidth / N.
    const setW = byId('scaleWidthSet'); if (setW) setW.onclick = () => {
      const n = parseFloat(byId('scaleWidthVal').value);
      if (n > 0) room.send('scaleSet', { worldPerUnit: (room.state.tableX * 2) / n });
    };
    const wv = byId('scaleWidthVal'); if (wv) wv.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); setW && setW.onclick(); } };
  }

  // Measure tool (Tools menu): toggle a modal mode; drag on the felt to lay the
  // selected overlay (ruler / circle / cone / line — picked in the kind row).
  { const mb = byId('measureBtn');
    if (mb) mb.onclick = () => { measuring ? exitMeasure() : enterMeasure(); };
    wire('measureClose', () => exitMeasure());
    wire('measureClear', () => { if (room) room.send('overlayClear', { scope: 'mine' }); });    // just your own
    wire('measureClearAll', () => { if (room) room.send('overlayClear', { scope: 'all' }); });   // GM: everyone's (server re-checks rank)
    const kinds = document.querySelectorAll('#measureKinds [data-kind]');
    const setKind = (k) => { measureKind = k; kinds.forEach(b => b.classList.toggle('on', b.dataset.kind === k)); };
    kinds.forEach(b => { b.onclick = () => setKind(b.dataset.kind); });
    setKind(measureKind); // reflect the default (ruler) in the row
  }

  // Scene list → the Library's Scenes tab (via the hook); loading happens there.
  room.onMessage('sceneList', scenes => { if (window.onLibraryList) window.onLibraryList('scene', scenes); });
  room.onMessage('sceneError', ({ message } = {}) => alert(message || 'Could not save the scene.'));
  wire('roomSaveState', () => room.send('stateSave'));
  room.onMessage('stateSaved', () => { const b = byId('roomSaveState'); if (!b) return; const t = b.textContent; b.textContent = '💾 Saved ✓'; setTimeout(() => { b.textContent = t; }, 1500); });
  room.onMessage('boardList', boards => { if (window.onLibraryList) window.onLibraryList('board', boards); });
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
  // Audio settings (Tools menu): effects volume + mute, persisted client-side.
  const audioPanel = byId('audioPanel'), sfxVol = byId('sfxVol'), sfxMute = byId('sfxMute');
  if (audioPanel && byId('audioBtn')) {
    byId('audioBtn').onclick = () => { audioPanel.hidden = !audioPanel.hidden; };
    wire('audioClose', () => audioPanel.hidden = true);
    if (sfxVol) { sfxVol.value = Math.round(getSfxVolume() * 100); sfxVol.oninput = () => setSfxVolume(sfxVol.value / 100); }
    const muteBtn = (btn, get, set) => { if (!btn) return; const sync = () => btn.textContent = get() ? '\u{1F507}' : '\u{1F50A}'; sync(); btn.onclick = () => { set(!get()); sync(); }; };
    muteBtn(byId('sfxMute'), getSfxMuted, setSfxMuted);
    muteBtn(byId('musicMute'), getMusicMuted, setMusicMuted);
    // background music
    const musicVol = byId('musicVol'), musicToggle = byId('musicToggle'), nowPlaying = byId('nowPlaying');
    if (musicVol) { musicVol.value = Math.round(getMusicVolume() * 100); musicVol.oninput = () => setMusicVolume(musicVol.value / 100); }
    const syncMusicBtn = () => { if (musicToggle) musicToggle.textContent = isMusicPlaying() ? '\u23f8 Music' : '\u25b6 Music'; };
    if (musicToggle) musicToggle.onclick = () => { toggleMusic(); syncMusicBtn(); };
    wire('musicNext', () => { nextTrack(); syncMusicBtn(); });
    const shuffleBtn = byId('musicShuffle');
    if (shuffleBtn) { shuffleBtn.classList.toggle('on', getShuffle()); shuffleBtn.onclick = () => { const on = !getShuffle(); setShuffle(on); shuffleBtn.classList.toggle('on', on); }; }
    onMusicTrack((t) => { if (nowPlaying) nowPlaying.textContent = t ? ('\u266a ' + t.title + ' \u2014 ' + MUSIC_CREDIT.by + ' (' + MUSIC_CREDIT.license + ')') : ''; });
    // credits panel — attribution for baked-in assets (CC-BY music requires this)
    const creditsPanel = byId('creditsPanel');
    const renderCredits = () => {
      const body = byId('creditsBody'); if (!body) return;
      const esc = (x) => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const A = (t, u) => u ? ('<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(t) + '</a>') : esc(t);
      const ul = 'style="margin:4px 0 10px;padding-left:18px;font-size:var(--fs-sm)"';
      let h = '';
      if (MUSIC.length) { h += '<div class="showLabel"><b>Music</b></div><ul ' + ul + '>'; for (const t of MUSIC) h += '<li>' + esc(t.title) + ' \u2014 ' + A(MUSIC_CREDIT.by, MUSIC_CREDIT.url) + ', ' + A(MUSIC_CREDIT.license, MUSIC_CREDIT.licenseUrl) + '</li>'; h += '</ul>'; }
      h += '<div class="showLabel"><b>Sound effects</b></div><ul ' + ul + '>'; for (const x of SFX_CREDITS) h += '<li>' + esc(x.title) + ' \u2014 ' + A(x.by, x.url) + ', ' + esc(x.license) + '</li>'; h += '</ul>';
      h += '<div class="showLabel"><b>Libraries</b></div><ul ' + ul + '>'; for (const l of LIB_CREDITS) h += '<li>' + A(l.title, l.url) + ' \u2014 ' + esc(l.license) + '</li>'; h += '</ul>';
      body.innerHTML = h;
    };
    wire('creditsLink', (e) => { if (e && e.preventDefault) e.preventDefault(); renderCredits(); if (creditsPanel) creditsPanel.hidden = false; });
    wire('creditsClose', () => { if (creditsPanel) creditsPanel.hidden = true; });
    // track picker — click a track to play it (opens over the Sound panel too)
    const tracksPanel = byId('tracksPanel');
    const renderTracks = () => {
      const body = byId('tracksBody'); if (!body) return;
      if (!MUSIC.length) { body.innerHTML = '<div class="muted">No tracks added yet.</div>'; return; }
      const esc = (x) => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const cur = currentTrackIndex();
      body.innerHTML = MUSIC.map((t, i) => '<button class="trackItem" data-i="' + i + '">' + esc(t.title) + '</button>').join('');
      body.querySelectorAll('.trackItem').forEach(btn => { btn.classList.toggle('on', +btn.dataset.i === cur); btn.onclick = () => { playTrack(+btn.dataset.i); syncMusicBtn(); renderTracks(); }; });
    };
    wire('tracksLink', (e) => { if (e && e.preventDefault) e.preventDefault(); renderTracks(); if (tracksPanel) tracksPanel.hidden = false; });
    wire('tracksClose', () => { if (tracksPanel) tracksPanel.hidden = true; });
  }
  byId('notesClose').onclick = () => { notes.hidden = true; };
  { // Public chat panel (Tools)
    const chat = byId('chat'), input = byId('chatInput');
    if (chat && byId('chatBtn')) {
      const send = () => { const t = input.value.trim(); if (t) { room.send('chat', { text: t }); input.value = ''; } };
      byId('chatBtn').onclick = () => { chat.hidden = !chat.hidden; if (!chat.hidden) { input.focus(); byId('chatBtn').classList.remove('hasUnread'); const l = byId('chatLog'); if (l) l.scrollTop = l.scrollHeight; } };
      byId('chatClose').onclick = () => { chat.hidden = true; };
      const sb = byId('chatSend'); if (sb) sb.onclick = send;
      input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } };
    }
  }
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
  const modeVal = () => { const c = timerMode.querySelector('.libTab.on'); return c ? c.dataset.mode : 'up'; };
  const setMode = (m) => timerMode.querySelectorAll('.libTab').forEach(c => c.classList.toggle('on', c.dataset.mode === m));
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
  timerMode.querySelectorAll('.libTab').forEach(c => c.onclick = () => { setMode(c.dataset.mode); room.send('timer', { action: 'set', mode: c.dataset.mode, duration: durMs() }); });
  timerDur.onchange = () => room.send('timer', { action: 'set', mode: 'down', duration: durMs() });
  setInterval(() => {
    if (timerPanel.hidden) return; // nothing to draw while the panel is closed
    const t = room.state.timer;
    if (!t) return;
    timerReadout.textContent = fmtTime(timerLive(t, Date.now()));
    timerToggle.textContent = t.running ? 'Pause' : 'Start';
    if (modeVal() !== t.mode) setMode(t.mode); // reflect another client's switch
    timerDurRow.hidden = t.mode !== 'down';
    if (document.activeElement !== timerDur) timerDur.value = Math.round(t.duration / 60000); // don't fight typing
  }, 100);

  // ---- Members (GM tools): admit / kick / promote ----
  const membersPanel = byId('membersPanel');
  wire('membersBtn', () => { membersPanel.hidden = !membersPanel.hidden; if (!membersPanel.hidden) room.send('members'); renderUnclaimed(); });
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
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3(); // fixed ground plane (y=0); drag height is applied as a separate Y offset
const prevTarget = new THREE.Vector3(), throwVel = new THREE.Vector3(); // hand speed → throw velocity
let lastMoveSent = 0, prevThrowTime = 0, down = null;
const sfxKind = (t) => t === 'card' ? 'card' : t === 'die' ? 'die' : t === 'deck' ? 'deck' : 'object'; // pickup family
// "Lean in": a Tools toggle that dollies the camera toward the orbit target for a
// closer look. Applied as a per-frame visual offset (undone before controls.update)
// so it never corrupts the real orbit distance; toggle off and it eases back.
let leanActive = false, leanT = 0;
const leanOffset = new THREE.Vector3();
const LEAN_AMOUNT = 0.35;   // fraction of the way to the target at full lean (a knob)

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
{ const t = byId('toolsToggle'); if (t) t.onclick = () => byId('toolsMenu').classList.toggle('collapsed'); } // collapse/expand the Tools menu
{ const t = byId('interactToggle'); if (t) t.onclick = () => byId('interactMenu').classList.toggle('collapsed'); } // collapse/expand Interactions
{ const b = byId('controlsBtn'); if (b) b.onclick = () => { byId('controlsModal').hidden = false; }; } // open How to Play
{ const b = byId('controlsClose'); if (b) b.onclick = () => { byId('controlsModal').hidden = true; }; }
{ const b = byId('leanBtn'); if (b) b.onclick = () => { leanActive = !leanActive; b.classList.toggle('on', leanActive); b.textContent = leanActive ? '🔎 Lean Out' : '🔎 Lean In'; }; } // toggle the closer-look camera
{ // Drop hand: a little menu — lay your whole hand out just in front of your marker, face up or down
  const dropPanel = byId('dropPanel');
  const dropAt = (faceDown) => {
    if (!room) return;
    const s = seatLayout[mySeat] || seatLayout[0];
    room.send('handToTable', { faceDown, x: s.hand[0] - s.out[0] * 2, z: s.hand[2] - s.out[2] * 2 }); // just in front of the marker
    if (dropPanel) dropPanel.hidden = true;
  };
  { const b = byId('dropBtn'); if (b) b.onclick = () => { if (dropPanel) dropPanel.hidden = !dropPanel.hidden; }; }
  { const b = byId('dropDown'); if (b) b.onclick = () => dropAt(true); }
  { const b = byId('dropUp'); if (b) b.onclick = () => dropAt(false); }
  { const b = byId('dropClose'); if (b) b.onclick = () => { if (dropPanel) dropPanel.hidden = true; }; }
}

// ===== Skybox (GM-applied, synced to the room; the picker UI is in editor-panel.js) =====
const BUILTIN_SKIES = [ // baked-in: drop files in public/sky/ and add entries here
  // equirect: { name: 'Observatory', url: '/sky/observatory.jpg' }
  { name: 'Cloudy - Chaotic', url: '/sky/equirect/cloudy_chaotic.png' },
  { name: 'Cloudy - Clear Afternoon', url: '/sky/equirect/cloudy_clear_afternoon.png' },
  { name: 'Cloudy - Clear Night', url: '/sky/equirect/cloudy_clear_night.png' },
  { name: 'Cloudy - Clear Sunrise', url: '/sky/equirect/cloudy_clear_sunrise.png' },
  { name: 'Cloudy - Clear Sunset', url: '/sky/equirect/cloudy_clear_sunset.png' },
  { name: 'Cloudy - Dark Blue', url: '/sky/equirect/cloudy_dark_blue.png' },
  { name: 'Cloudy - Dawn', url: '/sky/equirect/cloudy_dawn.png' },
  { name: 'Cloudy - Dusk', url: '/sky/equirect/cloudy_dusk.png' },
  { name: 'Cloudy - Early Morning', url: '/sky/equirect/cloudy_early_morning.png' },
  { name: 'Cloudy - Green', url: '/sky/equirect/cloudy_green.png' },
  { name: 'Cloudy - Hazy', url: '/sky/equirect/cloudy_hazy.png' },
  { name: 'Cloudy - Inverted Colors', url: '/sky/equirect/cloudy_inverted_colors.png' },
  { name: 'Cloudy - Light Green', url: '/sky/equirect/cloudy_light_green.png' },
  { name: 'Cloudy - Mist', url: '/sky/equirect/cloudy_mist.png' },
  { name: 'Cloudy - Moody', url: '/sky/equirect/cloudy_moody.png' },
  { name: 'Cloudy - Night', url: '/sky/equirect/cloudy_night.png' },
  { name: 'Cloudy - Noon', url: '/sky/equirect/cloudy_noon.png' },
  { name: 'Cloudy - Obscured Sun', url: '/sky/equirect/cloudy_obscured_sun.png' },
  { name: 'Cloudy - Purple', url: '/sky/equirect/cloudy_purple.png' },
  { name: 'Cloudy - Red At Night', url: '/sky/equirect/cloudy_red_at_night.png' },
  { name: 'Cloudy - Red', url: '/sky/equirect/cloudy_red.png' },
  { name: 'Cloudy - Stormy', url: '/sky/equirect/cloudy_stormy.png' },
  { name: 'Cloudy - Sunrise', url: '/sky/equirect/cloudy_sunrise.png' },
  { name: 'Cloudy - Sunset', url: '/sky/equirect/cloudy_sunset.png' },
  { name: 'Cloudy - Yellow', url: '/sky/equirect/cloudy_yellow.png' },
  // cubemap:  { name: 'Space', faces: ['/sky/px.jpg','/sky/nx.jpg','/sky/py.jpg','/sky/ny.jpg','/sky/pz.jpg','/sky/nz.jpg'] }
];

window.OTT_BUILTIN_SKIES = BUILTIN_SKIES; // the built-in library reads these (editor + table)

const skyDefault = scene.background;   // the flat colour it ships with
let skyLast = null;                    // last applied skybox ref (guards against a stale async load)
// A skybox "ref" is '' (default), an equirect URL, or a cube descriptor {"t":"cube","f":[6]}.
function applySkybox(ref) {
  if (!ref) { scene.background = skyDefault; return; }
  const aniso = renderer.capabilities.getMaxAnisotropy();          // sharpen grazing angles (esp. the horizon)
  const set = (tex) => { if (skyLast === ref) scene.background = tex; }; // ignore a stale load if it changed
  const fail = () => { if (skyLast === ref) scene.background = skyDefault; };
  if (ref[0] === '{') { // cubemap
    let d; try { d = JSON.parse(ref); } catch { return fail(); }
    if (d && d.t === 'cube' && Array.isArray(d.f) && d.f.length === 6)
      new THREE.CubeTextureLoader().load(d.f, (tex) => { tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = aniso; set(tex); }, undefined, fail);
    else fail();
  } else { // equirectangular
    new THREE.TextureLoader().load(ref, (tex) => { tex.mapping = THREE.EquirectangularReflectionMapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = aniso; set(tex); }, undefined, fail);
  }
}
function syncSkybox(ref) { ref = ref || ''; if (ref === skyLast) return; skyLast = ref; applySkybox(ref); }
qsa('[data-place]').forEach(b => b.onclick = () => placeDrawn(b.dataset.place)); // drawn-card placement
{ const body = byId('inspectColorBody'), text = byId('inspectColorText');
  const commit = () => {
    if (!inspect || !inspect.origId) return;
    const b = parseInt(body.value.slice(1), 16);
    if (inspect.type === 'die') {
      const t = parseInt(text.value.slice(1), 16);
      inspect.props = { ...(inspect.props || {}), color: b, textColor: t };
      swapInspectDie(inspect.props);                                                   // preview on the inspected die
      room.send('recolor', { id: inspect.origId, color: b, textColor: t });
    } else {
      room.send('recolor', { id: inspect.origId, color: b });
    }
  };
  if (body) { body.oninput = () => { if (inspect && inspect.type === 'prop') tintInspect(parseInt(body.value.slice(1), 16)); }; body.onchange = commit; } // props preview live via material tint
  if (text) text.onchange = commit;
}

// Map a click-action name to the server message it sends.
const sendAction = (action, id) => {
  if (action === 'takeCard') { room.send('takeCard', { id }); playSfx('card-pickup'); }
  else if (action === 'deal') room.send('dealToTable', { deckId: id });
  else if (action === 'flip') room.send('flip', { id });
  else if (action === 'shuffle') room.send('shuffle', { deckId: id });
  else if (action === 'roll') room.send('rollOne', { id });
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

  inspect = { pivot, origId: opts.origId || null, type: opts.type, props: null, drag: null, drawn: !!opts.drawn, placed: false };
  controls.enabled = false;
  byId('inspectHint').hidden = !!opts.drawn; // a drawn card shows the action panel instead
  byId('drawActions').hidden = !opts.drawn;
  const colorable = (opts.type === 'die' || opts.type === 'prop') && !opts.drawn;
  const row = byId('inspectColorRow');
  if (row) {
    row.hidden = !colorable;
    if (colorable) {
      const piece = opts.origId && room.state.pieces.get(opts.origId);
      inspect.props = piece ? JSON.parse(piece.props || '{}') : {};
      const isDie = opts.type === 'die';
      byId('inspectBodyLab').firstChild.nodeValue = isDie ? 'Body '  : 'Colour ';
      byId('inspectColorBody').value = hexStr(inspect.props.color ?? (isDie ? 0xf4f1ea : 0xffffff)); // die = ivory blank face
      byId('inspectTextLab').hidden = !isDie;                       // dice also get a number colour
      if (isDie) byId('inspectColorText').value = hexStr(inspect.props.textColor ?? 0x141414);       // die = ink numbers
    }
  }
}
const hexStr = (c) => '#' + ((c >>> 0) & 0xffffff).toString(16).padStart(6, '0');
// Swap the inspected die's mesh for one built with new colours (live preview).
function swapInspectDie(props) {
  if (!inspect || inspect.type !== 'die' || !inspect.pivot) return;
  const old = inspect.pivot.children[0];
  if (old) inspect.pivot.remove(old);
  const mesh = KIND.die.mesh(props);
  mesh.userData.id = inspect.origId;
  inspect.pivot.add(mesh);
}

// Live-tint the inspected mesh (its materials are its own — see enterInspect).
function tintInspect(color) {
  if (!inspect || !inspect.pivot) return;
  inspect.pivot.traverse(node => {
    if (node.isMesh && node.material)
      (Array.isArray(node.material) ? node.material : [node.material]).forEach(m => m.color && m.color.setHex(color));
  });
}

// Inspect an on-table piece by cloning its mesh (the clone respects hidden info —
// a face-down card clones back-only), then hide the real piece behind the copy.
function enterInspect(id) {
  const entry = meshes.get(id);
  if (!entry) return;
  const piece = room.state.pieces.get(id);
  const fresh = (entry.type === 'die' || entry.type === 'prop') && piece
    ? KIND[entry.type].mesh(JSON.parse(piece.props || '{}')) // own materials → live-recolorable, no shared-material bleed
    : entry.mesh.clone(true);                                // clone respects hidden info (face-down card = back only)
  inspectMesh(fresh, { origId: id, type: entry.type });
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
  const row = byId('inspectColorRow'); if (row) row.hidden = true;
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
  const wantsDouble = (button === 0 && (INSPECTABLE(type) || type === 'deck')) || (button === 2 && type === 'deck');

  if (!wantsDouble) {
    sendAction(button === 0 ? gesture.kind.lclick : gesture.kind.rclick, id); // right-click / non-inspectable
    return;
  }

  const isSecondClick = pendingClick && pendingClick.id === id && pendingClick.button === button && performance.now() - pendingClick.t < CONFIG.input.dblMs;
  if (isSecondClick) {
    clearTimeout(pendingClick.timer);
    pendingClick = null;
    if (button === 2) room.send('splitDeck', { deckId: id });        // double-right-click a deck = split it
    else if (type === 'deck') room.send('drawInspect', { deckId: id }); // double-left a deck = draw to inspect
    else enterInspect(id);                                            // double-left a piece = inspect it
  } else {
    if (pendingClick) clearTimeout(pendingClick.timer);
    const single = button === 0 ? gesture.kind.lclick : gesture.kind.rclick; // deferred single (shuffle for right-click on a deck)
    pendingClick = { id, button, t: performance.now(), timer: setTimeout(() => { pendingClick = null; sendAction(single, id); }, CONFIG.input.clickMs) };
  }
}
renderer.domElement.addEventListener('pointerdown', e => {
  if (measuring) { // Measure mode: left-drag lays the selected overlay (A = press)
    if (e.button === 0) { const p = overlayPoint(e); if (p) { measureDrag = { ax: p.x, az: p.z }; controls.enabled = false; renderer.domElement.setPointerCapture(e.pointerId); } }
    return;
  }
  if (wbOwning) { // drawing on the whiteboard: start a stroke
    if (e.button === 0) {
      setPointer(e);
      const uv = wbHitUV();
      if (uv) {
        wbCur = { pts: [uv[0], uv[1]], color: wbTool === 'eraser' ? wbBg() : wbMyColor(), width: wbTool === 'eraser' ? 0.03 : 0.005, erase: wbTool === 'eraser' };
        wbActive = true;
        renderer.domElement.setPointerCapture(e.pointerId);
      }
    }
    return;
  }
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
  dragHeight = GRAB_HEIGHT; // the lift offset; XZ tracks the fixed ground plane
  renderer.domElement.setPointerCapture(e.pointerId);
});

renderer.domElement.addEventListener('wheel', e => {
  if (!(down && down.grabbed)) return; // not holding a piece → let OrbitControls zoom
  e.preventDefault();
  dragHeight = clamp(dragHeight - Math.sign(e.deltaY) * DRAG_STEP, DRAG_MIN, DRAG_MAX); // scroll up = raise
  ray.setFromCamera(pointer, camera);
  ray.ray.intersectPlane(dragPlane, hit); // fixed ground plane → XZ under the cursor, stable at any height
  room.send('move', { id: down.id, x: hit.x, y: dragHeight, z: hit.z });
}, { passive: false });

renderer.domElement.addEventListener('pointermove', e => {
  if (measuring) { // live local preview of the overlay being dragged out
    if (measureDrag) { const p = overlayPoint(e); if (p) drawPreview(measureDrag.ax, measureDrag.az, p.x, p.z); }
    return;
  }
  if (wbOwning) { // extend the current stroke along the board surface
    if (wbActive && wbCur) {
      setPointer(e);
      const uv = wbHitUV();
      if (uv && wbCur.pts.length < 1998) {
        const n = wbCur.pts.length, lx = wbCur.pts[n - 2], ly = wbCur.pts[n - 1];
        if (Math.hypot(uv[0] - lx, uv[1] - ly) > 0.003) { // min spacing → fewer, smoother points
          wbCur.pts.push(uv[0], uv[1]);
          drawSegment(lx, ly, uv[0], uv[1], wbCur.color, wbCur.width); // live ink
        }
      }
    }
    return;
  }
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
  hit.y = dragHeight; // XZ from the fixed ground plane; height is the independent lift offset

  // First move past the click threshold decides what this drag means.
  if (!down.dragging) {
    if (Math.hypot(e.clientX - down.sx, e.clientY - down.sy) < CONFIG.input.dragPx) return; // still a click
    down.dragging = true;
    const kind = down.kind;
    if (down.button === kind.grab) { // the button that moves this kind (2 = deck, 0 = most)
      down.grabbed = true;
      heldTarget.copy(hit); prevTarget.copy(hit); prevThrowTime = performance.now(); throwVel.set(0, 0, 0);
      room.send('grab', { id: down.id });
      playSfx(sfxKind(down.type) + '-pickup'); // local, per object type
      room.send('move', { id: down.id, x: hit.x, y: hit.y, z: hit.z });
    } else if (down.button === 0 && kind.ldrag === 'deal') { // deck left-drag = deal a card and carry it
      down.pendingDeal = true;
      dragHeight = DECK_DRAG_HEIGHT; // lift above the deck so the dealt card doesn't fight its collider
      ray.setFromCamera(pointer, camera);
      ray.ray.intersectPlane(dragPlane, hit);
      hit.y = dragHeight;
      heldTarget.copy(hit); prevTarget.copy(hit); prevThrowTime = performance.now(); throwVel.set(0, 0, 0);
      room.send('dealDrag', { deckId: down.id, x: hit.x, y: hit.y, z: hit.z });
      playSfx('card-pickup'); // dealing a card off the deck; its drop follows on release
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
  if (measuring) { // release: commit the overlay if the drag was long enough
    if (measureDrag) {
      const p = overlayPoint(e);
      if (p) { const len = Math.hypot(p.x - measureDrag.ax, p.z - measureDrag.az); if (len >= MEASURE.minDrag) room.send('overlayAdd', overlayAddMsg(measureDrag.ax, measureDrag.az, p.x, p.z)); }
      measureDrag = null; clearPreview(); controls.enabled = true;
      try { renderer.domElement.releasePointerCapture(e.pointerId); } catch {}
    }
    return;
  }
  if (wbOwning) { // finish the stroke and send it
    if (wbActive) endWbStroke();
    try { renderer.domElement.releasePointerCapture(e.pointerId); } catch {}
    return;
  }
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
renderer.domElement.addEventListener('dblclick', e => { // double-click the board to own it and draw
  if (!room || !room.state.whiteboard || !room.state.whiteboard.enabled || wbOwning || room.state.whiteboard.owner) return;
  const surf = wbGroup && wbGroup.getObjectByName('wbSurface'); if (!surf) return;
  setPointer(e);
  ray.setFromCamera(pointer, camera);
  const bh = ray.intersectObject(surf)[0]; if (!bh) return;
  const ph = ray.intersectObjects([...meshes.values()].map(m => m.mesh))[0];
  if (ph && ph.distance < bh.distance) return; // a piece is in front → that's an inspect, not the board
  room.send('wbClaim'); e.preventDefault();
});

// The piece to act on for a keyboard shortcut: the held one, else whatever's hovered.
const heldOrHoveredId = () => (down && down.id) || pickId();

// Keyboard shortcuts (ignored while typing in an input). Delete/Backspace removes
// a piece, U toggles its upright/flat behaviour, S saves a hovered deck.
addEventListener('keydown', e => {
  if (!room) return;
  if (e.key === 'Escape' && measuring) { exitMeasure(); return; }
  if (e.key === 'Escape' && wbOwning) { room.send('wbRelease'); return; }
  if (e.key === 'Escape' && inspect) { releaseInspect(); return; }
  if (inspect && inspect.drawn) { // f/d/h/r place a drawn card
    const where = { f: 'field-up', d: 'field-down', h: 'hand', r: 'deck' }[e.key.toLowerCase()];
    if (where) { placeDrawn(where); return; }
  }
  const typing = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
  if (typing) return;
  if (e.key === '`') { byId('camDebug')?.toggleAttribute('hidden'); return; } // ` toggles the camera debug readout

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

// Rebuild a die/prop mesh from its current props (used on recolor).
function rebuildPiece(id, piece) {
  const entry = meshes.get(id);
  if (!entry) return;
  scene.remove(entry.mesh);
  const mesh = KIND[piece.type].mesh(JSON.parse(piece.props || '{}'));
  const casts = PHYS[piece.type].mass > 0;
  mesh.traverse(node => { node.userData.id = id; if (node.isMesh) { node.castShadow = casts; node.receiveShadow = true; } });
  const buf = buffers.get(id), last = buf && buf[buf.length - 1];
  if (last) applyTransform(mesh, last);
  scene.add(mesh);
  entry.mesh = mesh;
  if (inspect && inspect.origId === id) entry.mesh.visible = false; // keep it hidden behind the inspect view
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
let handCollapsed = false;
try { handCollapsed = localStorage.getItem('ott.handHidden') === '1'; } catch {} // personal view preference, remembered across refreshes
function setHandCollapsed(v) { handCollapsed = v; try { localStorage.setItem('ott.handHidden', v ? '1' : '0'); } catch {} renderHand(myHand); }
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
  el.classList.remove('collapsed');
  if (handCollapsed && cards.length && !selectMode) { // hidden: show only a peek tab (never while picking cards to show)
    el.classList.add('collapsed');
    const tab = document.createElement('button');
    tab.className = 'handToggle';
    tab.textContent = `🃏 Show hand (${cards.length})`;
    tab.onclick = () => setHandCollapsed(false);
    el.appendChild(tab);
    el.style.display = 'flex';
    return;
  }
  for (const card of cards) {
    const div = document.createElement('div');
    div.className = 'handcard';
    const cf = parseCardFront(card.front);
    if (cf.kind === 'rank') {
      div.textContent = cf.rank + cf.suit;
      div.style.color = cf.color || '#111';
    } else if (cf.kind === 'text') {
      div.classList.add('img'); // render the same wrapped/shrunk-to-fit texture the table uses, so long text isn't clipped
      const u = cardPreviewURL(card.front);
      if (u) div.style.backgroundImage = `url("${u}")`;
    } else if (cf.kind === 'image') {
      div.classList.add('img');
      div.style.backgroundImage = `url("${cf.ref}")`; // uploaded/file card art
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
  if (cards.length && !selectMode) { // a small handle to hide the hand from your view
    const hide = document.createElement('button');
    hide.className = 'handToggle hide';
    hide.textContent = '▾';
    hide.title = 'Hide your hand';
    hide.onclick = () => setHandCollapsed(true);
    el.appendChild(hide);
  }
  el.style.display = cards.length ? 'flex' : 'none';
}

// ===== seats, other players' fanned hands, and turn order ===================
// Seats scale with the current table half-extents (state.tableX/tableZ): hands sit
// just inside each edge and cameras pull back proportionally, so markers/hands stay
// at the table's edge on any size. Each client parks its camera at its own seat and
// renders every OTHER player's hand as face-down backs at their seat.
let mySeat = 0;
// Seat-camera framing — the ONE place to tune the default view for every seat.
//   lookFwd / lookH : the point a seat looks at (from table centre, in its direction).
//   dist / rise     : how far the camera sits back / up from that point (their ratio = the angle).
//   zoom            : <1 dollies in, >1 pulls back — scales the offset, so the ANGLE is unchanged.
// Table sits lower in frame → raise lookH and rise together.
const VIEW = { lookFwd: 3.1, lookH: 4, dist: 15.4, rise: 3.7, zoom: 0.85 };
function seatLayoutFor(hx, hz) {
  const m = 0.8;                          // hand inset from the edge
  const cx = hx * 0.66, cz = hz * 0.69;   // diagonal (corner) seat positions
  const sx = hx / 10, sz = hz / 7, sy = (sx + sz) / 2; // camera scale vs the default 20x14 table
  const cam = (p, t) => ({ pos: [p[0] * sx, p[1] * sy, p[2] * sz], target: [t[0] * sx, t[1] * sy, t[2] * sz] });
  const norm = (v) => { const l = Math.hypot(v[0], v[2]) || 1; return [v[0] / l, 0, v[2] / l]; };
  const seatCam = (d) => { const D = VIEW.dist * VIEW.zoom, R = VIEW.rise * VIEW.zoom; // build a seat's camera from VIEW + its facing dir
    return cam([d[0] * (VIEW.lookFwd + D), VIEW.lookH + R, d[2] * (VIEW.lookFwd + D)],
               [d[0] * VIEW.lookFwd,       VIEW.lookH,     d[2] * VIEW.lookFwd]); };
  return [
    { hand:[0, 0.25, hz - m],    out:[0,0,1],   cam: seatCam([0,0,1]) },          // front  (+z)
    { hand:[0, 0.25, -(hz - m)], out:[0,0,-1],  cam: seatCam([0,0,-1]) },         // back   (-z)
    { hand:[hx - m, 0.25, 0],    out:[1,0,0],   cam: seatCam([1,0,0]) },          // right  (+x)
    { hand:[-(hx - m), 0.25, 0], out:[-1,0,0],  cam: seatCam([-1,0,0]) },         // left   (-x)
    { hand:[cx, 0.25, cz],       out:[1,0,1],   cam: seatCam(norm([1,0,1])) },    // front-right
    { hand:[-cx, 0.25, -cz],     out:[-1,0,-1], cam: seatCam(norm([-1,0,-1])) },  // back-left
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
  positionWhiteboard(); // the track radius scales with the table
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
  gate('roomBtn', 2);                                          // Room Controls menu: GM+
  gate('wbBtn', 2);                                            // Whiteboard config (Tools menu): GM+
  gate('libraryBtn', 1); gate('builtinBtn', 1);                // View Library + Built-Ins: Helper+ (both pages)
  // Within those modals, boards/skyboxes/scenes are GM+ — helpers only spawn decks + objects.
  const gmTabs = (modalId, tabs) => tabs.forEach((t) => { const el = qs(`#${modalId} .libTab[data-tab="${t}"]`); if (el) el.hidden = rank < 2; });
  gmTabs('libraryPanel', ['boards', 'sky', 'scenes']);
  gmTabs('builtinModal', ['boards', 'sky']);
  gate('roomCode', 2);                                         // room code display: GM+/owner/admin only
  gate('ctrlHelper', 1); gate('ctrlGM', 2);                    // How-to-Play sections revealed by role
  gate('reset', 2); gate('scenesBtn', 2); gate('membersBtn', 2); // legacy standalone buttons (editor / older pages)
  gate('measureClearAll', 2);                                  // "Clear all overlays" (Measure panel): GM+
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

// --- Overlays + the Measure tool ---------------------------------------------
// Overlays (ruler + circle/cone/line templates) are flat, non-physics annotations
// synced in room.state.overlays. Geometry comes from the OVERLAY registry; the
// measure LABEL is a client-owned sprite because it depends on the room's scale.
const overlayObjs = new Map();   // overlayId -> { group, label }
let measuring = false;           // Measure mode active (modal, like whiteboard draw)
let measureKind = 'ruler';       // which overlay the drag lays: ruler | circle | cone | line
let measureDrag = null;          // { ax, az } while dragging out an overlay
let previewGroup = null, previewLabel = null; // local drag preview (synced only on release)

// The overlayAdd payload for the current kind: A→B always, plus the extra scalar
// each template needs (cone's angle, line's width) so it survives save/reload.
function overlayAddMsg(ax, az, bx, bz) {
  const m = { kind: measureKind, x: ax, z: az, x2: bx, z2: bz };
  if (measureKind === 'cone') m.ang = MEASURE.coneAngle;
  if (measureKind === 'line') m.w = MEASURE.lineWidth;
  return m;
}

function myColor() { const p = room && room.state.players.get(mySession); return (p && p.color) || '#ffffff'; }
function overlayLabelSprite(text, color, mx, mz) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTag(text, color), transparent: true, depthTest: false }));
  s.scale.set(CONFIG.label.w, CONFIG.label.h, 1);
  s.position.set(mx, boardTopY + MEASURE.labelLift, mz);
  s.renderOrder = 6;
  return s;
}
function overlayText(o) { return formatMeasure(Math.hypot(o.x2 - o.x, o.z2 - o.z), room.state.scale); }
function disposeGroup(g) { g.traverse(n => { if (n.isMesh) { n.geometry.dispose(); n.material.dispose(); } }); }
function addOverlay(id, o) {
  removeOverlay(id);
  const kind = OVERLAY[o.kind]; if (!kind) return;
  const group = kind.build(o);
  group.position.y = boardTopY + MEASURE.lift;
  scene.add(group);
  // Every kind carries the same floating measure label (ruler = distance, circle =
  // radius, cone = range, line = length — all just |A→B|), placed at the midpoint.
  const label = overlayLabelSprite(overlayText(o), o.color, (o.x + o.x2) / 2, (o.z + o.z2) / 2);
  scene.add(label);
  overlayObjs.set(id, { group, label });
}
function removeOverlay(id) {
  const e = overlayObjs.get(id); if (!e) return;
  scene.remove(e.group); disposeGroup(e.group);
  if (e.label) { scene.remove(e.label); e.label.material.map.dispose(); e.label.material.dispose(); }
  overlayObjs.delete(id);
}
function relabelOverlays() { // scale changed → recompute every overlay's measure label
  for (const [id, e] of overlayObjs) {
    const o = room.state.overlays.get(id);
    if (o && e.label) { e.label.material.map.dispose(); e.label.material.map = nameTag(overlayText(o), o.color); e.label.material.needsUpdate = true; }
  }
}

function overlayPoint(e) { // pointer → world (x,z) on the felt surface (the ping plane)
  setPointer(e); ray.setFromCamera(pointer, camera);
  const p = new THREE.Vector3();
  return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -boardTopY), p) ? p : null;
}
function clearPreview() {
  if (previewGroup) { scene.remove(previewGroup); disposeGroup(previewGroup); previewGroup = null; }
  if (previewLabel) { scene.remove(previewLabel); previewLabel.material.map.dispose(); previewLabel.material.dispose(); previewLabel = null; }
}
function drawPreview(ax, az, bx, bz) {
  clearPreview();
  const color = myColor();
  // Build the CURRENT kind locally (defaults for cone angle / line width match
  // what overlayAddMsg will send on release, so the preview is what you commit).
  const o = { kind: measureKind, color, x: ax, z: az, x2: bx, z2: bz, ang: MEASURE.coneAngle, w: MEASURE.lineWidth };
  previewGroup = (OVERLAY[measureKind] || OVERLAY.ruler).build(o);
  previewGroup.position.y = boardTopY + MEASURE.lift;
  scene.add(previewGroup);
  previewLabel = overlayLabelSprite(formatMeasure(Math.hypot(bx - ax, bz - az), room.state.scale), color, (ax + bx) / 2, (az + bz) / 2);
  scene.add(previewLabel);
}
function enterMeasure() {
  if (measuring) return;
  measuring = true;
  renderer.domElement.classList.add('measuring');
  const b = byId('measureBtn'); if (b) b.classList.add('on');
  const p = byId('measurePanel'); if (p) p.hidden = false;
}
function exitMeasure() {
  if (!measuring) return;
  measuring = false; measureDrag = null; clearPreview();
  renderer.domElement.classList.remove('measuring');
  const b = byId('measureBtn'); if (b) b.classList.remove('on');
  const p = byId('measurePanel'); if (p) p.hidden = true;
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

// ===== Whiteboard: a synced board on a circular track behind the players ======
// Slice 1: placement only — a blank chalkboard/whiteboard the GM can show, slide
// around the track, and style. It carries no physics; drawing comes next.
const WHITEBOARD_RES = 1024;               // drawing-canvas resolution (a knob)
const WHITEBOARD_MAX_STROKES = 2000;       // local stroke-mirror cap (match the server knob)
const WB = { w: 8, h: 4.5, margin: 5, gap: 0.5 }; // board size + track clearance
let wbGroup = null, wbCanvas = null, wbCtx = null, wbTex = null;
const wbLast = { enabled: null, angle: null, dark: null, owner: null };
const wbStrokesLocal = [];              // mirror of the server's strokes (for replay on a dark<->light flip)
let wbOwning = false, wbActive = false, wbCur = null, wbTool = 'pen', wbCamSave = null;

function wbBg() { return room.state.whiteboard.dark ? '#1b1b1b' : '#f4f1ea'; }
function ensureWbCanvas() {
  if (wbCanvas) return;
  wbCanvas = document.createElement('canvas');
  wbCanvas.width = WHITEBOARD_RES;
  wbCanvas.height = Math.round(WHITEBOARD_RES * WB.h / WB.w);
  wbCtx = wbCanvas.getContext('2d');
  wbTex = cTex(wbCanvas); // app's texture helper (correct colorSpace + reliable re-upload on needsUpdate)
}
function wbClearCanvas() { ensureWbCanvas(); wbCtx.fillStyle = wbBg(); wbCtx.fillRect(0, 0, wbCanvas.width, wbCanvas.height); wbTex.needsUpdate = true; }

function buildWhiteboard() {
  if (wbGroup) { scene.remove(wbGroup); wbGroup = null; }
  if (!room || !room.state.whiteboard || !room.state.whiteboard.enabled) return;
  ensureWbCanvas(); wbClearCanvas();
  const g = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(WB.w + 0.4, WB.h + 0.4),
    new THREE.MeshStandardMaterial({ color: 0x4a3b2a, roughness: 0.85 }));
  frame.position.z = -0.03;
  const surf = new THREE.Mesh(new THREE.PlaneGeometry(WB.w, WB.h), new THREE.MeshBasicMaterial({ map: wbTex }));
  surf.name = 'wbSurface'; // slice 2 raycasts against this to draw
  surf.frustumCulled = false; // always render so its texture uploads even when off to the side
  g.add(frame, surf);
  scene.add(g);
  wbGroup = g;
  positionWhiteboard();
  if (room) room.send('wbStrokes'); // fetch the current drawing (late-join replay)
  if (room) room.send('chatLog');   // fetch recent chat (late-join replay)
}
function positionWhiteboard() {
  if (!wbGroup || !room) return;
  const s = room.state.whiteboard;
  const R = Math.max(room.state.tableX, room.state.tableZ) + WB.margin; // outside the seat ring
  const cy = WB.h / 2 + WB.gap;
  wbGroup.position.set(Math.sin(s.angle) * R, cy, Math.cos(s.angle) * R);
  wbGroup.lookAt(0, cy, 0); // drawing face toward the table centre
}
// Reflect enable/slide/style/owner changes from synced state (called each state patch).
function syncWhiteboard(s) {
  if (!s) return;
  if (s.enabled !== wbLast.enabled) { wbLast.enabled = s.enabled; buildWhiteboard(); }
  if (wbGroup && s.angle !== wbLast.angle) positionWhiteboard();
  if (s.dark !== wbLast.dark) { wbLast.dark = s.dark; if (wbGroup) redrawStrokes(); } // recolour + replay
  if (s.owner !== wbLast.owner) { wbLast.owner = s.owner; if (s.owner === mySession) enterWbDraw(); else exitWbDraw(); }
  wbLast.angle = s.angle;
}

// --- drawing: strokes are [x0,y0,x1,y1,...] in canvas-normalized [0,1] (y top-down) ---
function wbMyColor() { const p = room.state.players.get(mySession); return (p && p.color) || '#e8e6e0'; }
function drawSegment(x0, y0, x1, y1, color, width) {
  ensureWbCanvas();
  const W = wbCanvas.width, H = wbCanvas.height;
  wbCtx.strokeStyle = color; wbCtx.lineWidth = Math.max(1.5, width * W);
  wbCtx.lineCap = 'round'; wbCtx.lineJoin = 'round';
  wbCtx.beginPath(); wbCtx.moveTo(x0 * W, y0 * H); wbCtx.lineTo(x1 * W, y1 * H); wbCtx.stroke();
  wbTex.needsUpdate = true;
}
function drawStroke(s) {
  const pts = s && s.pts ? Array.from(s.pts) : null;
  if (!pts || pts.length < 4) return; // ignore anything malformed instead of aborting the whole repaint
  ensureWbCanvas();
  const W = wbCanvas.width, H = wbCanvas.height;
  wbCtx.strokeStyle = s.erase ? wbBg() : (s.color || '#e8e6e0'); wbCtx.lineWidth = Math.max(1.5, (s.width || 0.005) * W);
  wbCtx.lineCap = 'round'; wbCtx.lineJoin = 'round';
  wbCtx.beginPath();
  for (let i = 0; i < pts.length; i += 2) (i === 0 ? wbCtx.moveTo : wbCtx.lineTo).call(wbCtx, pts[i] * W, pts[i + 1] * H);
  wbCtx.stroke(); wbTex.needsUpdate = true;
}
function redrawStrokes() { wbClearCanvas(); for (const s of wbStrokesLocal) drawStroke(s); } // clear bg + replay all (dark-flip / late-join)
function pushStroke(s) {
  wbStrokesLocal.push(s);
  if (wbStrokesLocal.length > WHITEBOARD_MAX_STROKES) wbStrokesLocal.shift();
  drawStroke(s); // just ink the new stroke — cheap, and needsUpdate re-uploads fine
}

// Raycast the pointer onto the board surface -> [x, y] in canvas-normalized [0,1], or null.
function wbHitUV() {
  const surf = wbGroup && wbGroup.getObjectByName('wbSurface'); if (!surf) return null;
  ray.setFromCamera(pointer, camera);
  const h = ray.intersectObject(surf)[0];
  return h && h.uv ? [h.uv.x, 1 - h.uv.y] : null; // UV y is bottom-up; canvas y is top-down
}
function endWbStroke() {
  wbActive = false;
  if (wbCur && wbCur.pts.length >= 4) { // >= 2 points
    room.send('wbStroke', wbCur);
    wbStrokesLocal.push(wbCur); // already drawn live; just keep it for replay
    if (wbStrokesLocal.length > WHITEBOARD_MAX_STROKES) wbStrokesLocal.shift();
  }
  wbCur = null;
}
function wbSyncToolButtons() {
  const pen = byId('wbPen'), er = byId('wbEraser');
  if (pen) pen.classList.toggle('on', wbTool === 'pen');
  if (er) er.classList.toggle('on', wbTool === 'eraser');
}
// Own the board: face it straight-on, lock the camera, show the pen toolbar.
function enterWbDraw() {
  if (wbOwning || !wbGroup) return;
  wbOwning = true; wbTool = 'pen';
  wbCamSave = { pos: camera.position.clone(), target: controls.target.clone() };
  const s = room.state.whiteboard;
  const R = Math.max(room.state.tableX, room.state.tableZ) + WB.margin, cy = WB.h / 2 + WB.gap;
  const dir = new THREE.Vector3(Math.sin(s.angle), 0, Math.cos(s.angle));
  const boardPos = dir.clone().multiplyScalar(R); boardPos.y = cy;
  camera.position.copy(boardPos.clone().sub(dir.clone().multiplyScalar(6.5))); camera.position.y = cy + 0.4;
  controls.target.copy(boardPos); controls.update(); controls.enabled = false;
  const tb = byId('wbTools'); if (tb) tb.hidden = false;
  wbSyncToolButtons();
}
function exitWbDraw() {
  if (!wbOwning) return;
  wbOwning = false; wbActive = false; wbCur = null;
  if (wbCamSave) { camera.position.copy(wbCamSave.pos); controls.target.copy(wbCamSave.target); controls.update(); wbCamSave = null; }
  controls.enabled = true;
  const tb = byId('wbTools'); if (tb) tb.hidden = true;
}

function renderPlayers() { // built with DOM + textContent so a player's name can never inject HTML
  const el = byId('players');
  if (!el) return;
  const list = [];
  room.state.players.forEach((player, sid) => list.push([sid, player]));
  list.sort((a, b) => a[1].seat - b[1].seat);
  el.replaceChildren();
  if (room.state.turnPending) { // the turn is held by someone who hasn't rejoined the saved game
    const w = document.createElement('div');
    w.className = 'prow turn-waiting';
    w.textContent = '\u23F3 Waiting on ' + room.state.turnPending + ' (not present)';
    el.appendChild(w);
  }
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

// Unclaimed hands from a loaded save whose owner hasn't returned. GM picks a
// present player to hand each one to (server re-checks the GM rank).
function renderUnclaimed() {
  const box = byId('unclaimedHands'); if (!box) return;
  box.replaceChildren();
  const unclaimed = room.state.unclaimed;
  if (!unclaimed || unclaimed.size === 0) return;
  const present = [];
  room.state.players.forEach((p, sid) => present.push([sid, p.name]));
  present.sort((a, b) => (a[1] > b[1] ? 1 : a[1] < b[1] ? -1 : 0));
  const head = document.createElement('div');
  head.className = 'unclaimed-head';
  head.textContent = 'Unclaimed hands';
  box.appendChild(head);
  unclaimed.forEach((name, userId) => {
    const row = document.createElement('div'); row.className = 'unclaimed-row';
    const label = document.createElement('span'); label.className = 'unclaimed-name';
    label.textContent = name || 'A player';
    row.appendChild(label);
    const sel = document.createElement('select'); sel.className = 'unclaimed-assign';
    const def = document.createElement('option'); def.value = ''; def.textContent = 'Give to\u2026'; sel.appendChild(def);
    for (const [sid, pname] of present) { const o = document.createElement('option'); o.value = sid; o.textContent = pname; sel.appendChild(o); }
    sel.onchange = () => { if (sel.value) { room.send('reassignHand', { userId, toSessionId: sel.value }); sel.value = ''; } };
    row.appendChild(sel);
    box.appendChild(row);
  });
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
    const acts = document.createElement('span'); acts.className = 'actions';
    const isSelf = m.username === myName;
    if (m.status === 'pending') {
      acts.append(btn('Admit', () => room.send('admit', { userId: m.userId })),
                  btn('Reject', () => room.send('kick', { userId: m.userId })));
    } else if (!isSelf && m.role !== 'owner') {
      if (m.role === 'player') acts.appendChild(btn('Helper', () => room.send('setRole', { userId: m.userId, role: 'helper' })));
      if (m.role === 'helper') acts.appendChild(btn('Player', () => room.send('setRole', { userId: m.userId, role: 'player' })));
      if (myRank >= 3) { // owner manages co-GMs
        if (m.role !== 'gm') acts.appendChild(btn('GM', () => room.send('setRole', { userId: m.userId, role: 'gm' })));
        else acts.appendChild(btn('Helper', () => room.send('setRole', { userId: m.userId, role: 'helper' })));
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
const _dropBox = new THREE.Box3(), _dropSize = new THREE.Vector3(); // reused each frame to size the ring to the held piece

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
    _dropBox.setFromObject(held.mesh); _dropBox.getSize(_dropSize);                       // fit the ring to the piece's footprint
    dropMarker.scale.setScalar((Math.max(_dropSize.x, _dropSize.z) / 2 + 0.12) / CONFIG.marker.outer);
    const me = room && room.state.players.get(mySession);                                 // tint to my seat colour
    if (me && me.color) dropMarker.material.color.set(me.color);
    dropMarker.position.set(held.mesh.position.x, boardTopY + CONFIG.marker.lift, held.mesh.position.z);
    dropMarker.visible = true;
  } else {
    dropMarker.visible = false;
  }
  camera.position.sub(leanOffset);   // undo last frame's lean so controls sees the true orbit position
  controls.update();
  leanT += ((leanActive ? 1 : 0) - leanT) * 0.18; // ease toward held / released
  if (leanT < 0.0005) leanT = 0;
  leanOffset.copy(controls.target).sub(camera.position).multiplyScalar(leanT * LEAN_AMOUNT);
  camera.position.add(leanOffset);   // apply the lean for this frame's render
  { const c = camera.position, t = controls.target, d = byId('camDebug'); // live camera readout for tuning the default view
    if (d && !d.hidden) d.textContent =
      `cam  ${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)}\n` +
      `tgt  ${t.x.toFixed(2)}, ${t.y.toFixed(2)}, ${t.z.toFixed(2)}\n` +
      `dist ${c.distanceTo(t).toFixed(2)}`; }
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
})();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
