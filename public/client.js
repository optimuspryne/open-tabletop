import * as THREE from 'three';
import { CONFIG, clamp, scene, camera, renderer, controls, resizeTable, setTableColor } from './core.js';
import { KIND, OVERLAY, trayMesh, cTex, cardMesh, propColor, measureModel, measureBoard, resizeToCanvas, parseCardFront, cardPreviewURL, uploadImage, uploadModel, makePlayerTexture, nameTag, makeYouChipTexture, gridMesh } from './graphics.js';
import { applyIcons, setIcon, initTip } from './icons.js';
import { KINDS as PHYS, PROPS, PROP_LIST, BOARDS, DIE_SIDES, DICE_SETS, PALETTE, COLORS, readableInk, recolorPalette, deckHeight, timerLive, MEASURE, formatMeasure, DISPENSERS, gridActive, snapToCell, trayCenter, seatAngle } from '/shared/pieces.js';
import { playSfx, resumeAudio, setSfxVolume, getSfxVolume, setSfxMuted, getSfxMuted, setMusicMuted, getMusicMuted, toggleMusic, nextTrack, playTrack, currentTrackIndex, getShuffle, setShuffle, setMusicVolume, getMusicVolume, isMusicPlaying, onMusicTrack } from './audio.js';
import { MUSIC, MUSIC_CREDIT, SFX_CREDITS, MODEL_CREDITS, ART_CREDITS, LIB_CREDITS } from './credits.js';
import { attachControls } from './controls.js';
window.addEventListener('pointerdown', resumeAudio, { once: true }); // browsers block audio until a user gesture

// ===== Tiny DOM helpers =====================================================
const byId = (id) => document.getElementById(id);
const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => document.querySelectorAll(selector);
// Escape a string for safe interpolation into an innerHTML fragment.
const escapeHtml = (x) => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Per-room role → numeric rank (owner > gm > helper > player); used for gating.
const rankOf = (role) => ({ owner: 3, gm: 2, helper: 1, player: 0 })[role] ?? 0;
// A <button> from label + click handler (+ optional class) — the shared DOM factory.
const MEMBER_ICON = { 'Helper': 'user-up', 'Player': 'user-down', 'GM': 'user-cog', 'Kick': 'user-minus' };
// Preset colors for the felt + grid-line swatch popovers (the custom picker sits beside them).
const FELT_COLORS = ['#2f6b4f', '#1e5c3f', '#2f4f6b', '#1e3a5c', '#6b2f3a', '#5c1e2a', '#3a3a3a', '#1a1a1a'];
const GRID_COLORS = ['#ffffff', '#888888', '#000000', '#e05555', '#55aaff', '#55cc77', '#e0c055'];
const buildColorSwatches = (container, colors, apply) => { if (!container || container.childElementCount) return; colors.forEach((hex) => { const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'swatch'; chip.style.background = hex; chip.title = hex; chip.onclick = () => apply(hex); container.appendChild(chip); }); };
// Relabel a button without clobbering an injected icon: update its .lbl + aria-label, or textContent if it has no icon.
const setBtnLabel = (btn, text) => { if (!btn) return; const l = btn.querySelector('.lbl'); if (l) { l.textContent = text; btn.setAttribute('aria-label', text); } else btn.textContent = text; };
const makeButton = (label, fn, cls, icon) => { const button = document.createElement('button'); const ic = icon || MEMBER_ICON[label]; if (ic) { button.dataset.icon = ic; button.innerHTML = '<span class="lbl">' + label + '</span>'; } else button.textContent = label; if (cls) button.className = cls; button.onclick = fn; return button; };

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

// ===== Movable / resizable pop-out panels ====================================
// Desktop only (a precise pointer). Drag a panel by its .panel-head to pop it out
// of the dock into a free-floating spot; a few content-heavy ones also resize.
// Layout is remembered per-browser in localStorage — pure-UI state, never synced
// (same instinct as audio settings). "Reset panel layout" (Tools menu) re-docks all.
const PANEL_MOVABLE = ['tracksPanel', 'whiteboard', 'showPanel', 'dropPanel', 'membersPanel']; // Customize Table + Scale & Grid are movable pop-outs (drag them aside while calibrating)
// Every movable panel is resizable (size them to taste); chat/notes additionally
// flex their inner scroll region (see styles.css) so resizing grows the content.
const PANEL_RESIZABLE = new Set(PANEL_MOVABLE);
const PANEL_LS = 'ott.panelLayout';
let panelTopZ = 40;

function readPanelLayout() { try { return JSON.parse(localStorage.getItem(PANEL_LS)) || {}; } catch (e) { return {}; } }
function writePanelLayout(layout) { try { localStorage.setItem(PANEL_LS, JSON.stringify(layout)); } catch (e) { /* private mode / quota */ } }

// Clamp a top-left so the WHOLE panel (incl. its bottom-right resize grip) stays
// on-screen — not just the corner; otherwise a wide panel hangs off the edge.
function clampPos(panel, left, top) {
  const w = panel.offsetWidth || 220, h = panel.offsetHeight || 140;
  return { left: clamp(left, 0, Math.max(0, innerWidth - w)), top: clamp(top, 0, Math.max(0, innerHeight - h)) };
}
// Detach a panel from the dock flow into a clamped fixed position (+ optional size).
function floatPanel(panel, id, left, top, width, height) {
  panel.classList.add('floating');
  if (PANEL_RESIZABLE.has(id)) panel.classList.add('resizable');
  if (width) panel.style.width = width + 'px';   // set size first so clampPos measures the final box
  if (height) panel.style.height = height + 'px';
  const pos = clampPos(panel, left, top);
  panel.style.left = pos.left + 'px';
  panel.style.top = pos.top + 'px';
}
function persistPanel(panel, id) {
  const r = panel.getBoundingClientRect();
  const layout = readPanelLayout();
  // Width is always pinned (prevents the dock's width:100% from re-stretching a
  // restored panel). Height only once the user has actually resized (an inline
  // height exists) — so a drag-only panel keeps auto height and grows with content.
  layout[id] = { left: r.left, top: r.top, width: r.width, height: panel.style.height ? r.height : 0 };
  writePanelLayout(layout);
}
function resetPanelLayout() {
  writePanelLayout({});
  for (const id of PANEL_MOVABLE) {
    const panel = byId(id); if (!panel) continue;
    panel.classList.remove('floating', 'resizable');
    panel.style.left = panel.style.top = panel.style.width = panel.style.height = panel.style.zIndex = '';
  }
}
function initPanels() {
  if (!matchMedia('(pointer: fine)').matches) return; // desktop / precise pointer only — keep the docked layout on touch
  const layout = readPanelLayout();
  for (const id of PANEL_MOVABLE) {
    const panel = byId(id); if (!panel) continue;
    const head = panel.querySelector(':scope > .panel-head'); if (!head) continue;
    panel.classList.add('movable');
    const saved = layout[id];
    if (saved) floatPanel(panel, id, saved.left, saved.top, saved.width, saved.height);

    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.close-x')) return;    // left-drag on the title bar, not the ✕
      const r = panel.getBoundingClientRect();                       // measured WITH any centering transform still applied
      // Pin the current (docked) width — else the dock's `width:100%` rule, now
      // viewport-relative under position:fixed, stretches the panel full-screen.
      if (!panel.classList.contains('floating')) floatPanel(panel, id, r.left, r.top, r.width); // pop out of flow on first drag (no visual jump)
      panel.style.zIndex = ++panelTopZ;                              // bring to front
      const ox = e.clientX - r.left, oy = e.clientY - r.top;
      head.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const pos = clampPos(panel, ev.clientX - ox, ev.clientY - oy);
        panel.style.left = pos.left + 'px';
        panel.style.top = pos.top + 'px';
      };
      const up = (ev) => {
        try { head.releasePointerCapture(ev.pointerId); } catch (err) { /* already released */ }
        head.removeEventListener('pointermove', move);
        head.removeEventListener('pointerup', up);
        persistPanel(panel, id);
      };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
    });
    // Clicking anywhere in a floating panel raises it above the others.
    panel.addEventListener('pointerdown', () => { if (panel.classList.contains('floating')) panel.style.zIndex = ++panelTopZ; }, true);
    // Remember size changes on the resizable ones (debounced to a frame).
    if (PANEL_RESIZABLE.has(id) && 'ResizeObserver' in window) {
      let raf = 0;
      new ResizeObserver(() => {
        if (!panel.classList.contains('floating')) return;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => persistPanel(panel, id));
      }).observe(panel);
    }
  }
  const reset = byId('resetPanelsBtn');
  if (reset) { reset.hidden = false; reset.onclick = resetPanelLayout; }
}
initPanels();

// Tools menu is a 2-column grid: mark the odd last VISIBLE button `.span2` so it fills
// its row. `!b.hidden` reflects both the GM gate (Whiteboard) and the desktop-only Reset
// button, so a non-GM cleanly gets How-to-Play in the empty Whiteboard slot. Re-run
// whenever those visibilities change (applyRole, and here after initPanels).
function layoutToolsMenu() {
  const menu = byId('toolsMenu'); if (!menu) return;
  const btns = [...menu.querySelectorAll('button')];
  btns.forEach(b => b.classList.remove('span2'));
  const visible = btns.filter(b => !b.hidden);
  if (visible.length % 2 === 1) visible[visible.length - 1].classList.add('span2');
}
layoutToolsMenu();

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
  const chatBtn = byId('chatBtn'), reg = byId('regionTL');
  const chatShowing = reg && !reg.hidden && reg.querySelector('.pane[data-pane="chat"].on');
  if (!chatShowing && chatBtn) chatBtn.classList.add('hasUnread');
}


// ===== Networking ===========================================================
const { Client, getStateCallbacks } = Colyseus;
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
// My saved default color per die type — a LOCAL, per-device preference (like the lobby
// accent), never synced. Shape in localStorage['ott-dice']: { "20": {color, textColor}, ... }
// as ints. An absent type just means "no default" → the die spawns plain ivory/ink.
function loadDiceDefaults() { try { return JSON.parse(localStorage.getItem('ott-dice') || '{}') || {}; } catch { return {}; } }
function saveDiceDefault(sides, color, textColor) {
  const all = loadDiceDefaults(); const d = {};
  if (Number.isInteger(color)) d.color = color;
  if (Number.isInteger(textColor)) d.textColor = textColor;
  all[String(sides)] = d;
  try { localStorage.setItem('ott-dice', JSON.stringify(all)); } catch {}
}
// Spawn props for a die of this type, with my saved default color folded in (if any).
function myDieProps(sides) {
  const p = { sides };
  const d = loadDiceDefaults()[String(sides)];
  if (d) { if (Number.isInteger(d.color)) p.color = d.color; if (Number.isInteger(d.textColor)) p.textColor = d.textColor; }
  return p;
}
// Forget my saved default for one die type (back to plain ivory/ink on the next spawn).
function clearDiceDefault(sides) {
  const all = loadDiceDefaults(); delete all[String(sides)];
  try { localStorage.setItem('ott-dice', JSON.stringify(all)); } catch {}
}
// The ids of the dice currently in MY tray (so a dice-set pick can recolor them live).
function myTrayDieIds() {
  const ids = [];
  if (!room) return ids;
  room.state.pieces.forEach((piece, id) => {
    if (piece.type !== 'die') return;
    try { if (JSON.parse(piece.props || '{}').traySeat === mySeat) ids.push(id); } catch {}
  });
  return ids;
}
// Apply a dice set as my default across EVERY die type, and live-recolor the dice already in
// my tray. Numbers are auto-contrasted from the body color. Local-only for the defaults; the
// tray recolor goes through the normal (synced) recolor message so everyone sees it.
function applyDiceSet(color) {
  const textColor = readableInk(color);
  for (const s of DIE_SIDES) saveDiceDefault(s, color, textColor);
  for (const id of myTrayDieIds()) room.send('recolor', { id, color, textColor });
}

// Mesh-build props for a piece. Dispensers stack their body to the live `count`,
// which lives in its own schema field (not props), so fold it in for the mesh.
const meshPropsOf = (piece, id) => {
  const p = JSON.parse(piece.props || '{}');
  if (piece.type === 'dispenser') { p.count = piece.count; p._seed = id; } // _seed → per-stack facing jitter
  return p;
};

// The table grid (a flat LineSegments on the felt) or null when gridStyle is 'off'.
// Rebuilt whenever the grid fields (cell size / style / colour) or the table size
// change; reads everything from the synced room scale, so every seat draws the same.
let gridLines = null;
// The grid's height above the felt (GM-set, durable); falls back to the overlay lift.
const gridY = () => { const v = room && +room.state.scale.gridLift; return Number.isFinite(v) ? v : MEASURE.lift; };
// Whether a piece carries the per-piece snap-to-grid flag (like keep-upright).
const pieceSnap = (id) => { const p = room && room.state.pieces.get(id); if (!p) return false; try { return !!JSON.parse(p.props || '{}').snap; } catch { return false; } };
// Is this piece a TILE (a card/deck carrying a `tile` kind)? Drives tile-vs-card pickup sounds.
const pieceIsTile = (id) => { const p = room && room.state.pieces.get(id); if (!p) return false; try { return !!JSON.parse(p.props || '{}').tile; } catch { return false; } };
// The drag target to actually send: snapped to the nearest cell for a snap-flagged piece
// on an active grid (so it tracks cell-to-cell as you drag), else the raw cursor point.
const snapXZ = (x, z) => (down && down.snap && gridActive(room.state.scale)) ? snapToCell(x, z, room.state.scale) : { x, z };
function rebuildGrid() {
  if (gridLines) { scene.remove(gridLines); gridLines.geometry.dispose(); gridLines.material.dispose(); gridLines = null; }
  if (!room) return;
  const g = gridMesh(room.state.scale, room.state.tableX, room.state.tableZ);
  if (g) { g.position.y = gridY(); scene.add(g); gridLines = g; }
}

(async () => {
  const client = new Client(location.origin.replace(/^http/, 'ws'));
  const params = new URLSearchParams(location.search);
  if (params.get('workshop') === '1') window.OTT_EDITOR = true;    // admins reach the library workshop via table.html?workshop=1
  const editorMode = !!window.OTT_EDITOR;                          // workshop mode: admin-only room + workshop chrome
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
  if (!editorMode) { // room code, top-right — applyRole reveals it to GM+ only
    const rc = byId('roomCode');
    if (rc) { rc.textContent = 'Room Code: ' + code; rc.title = 'Click to copy'; rc.onclick = () => { navigator.clipboard && navigator.clipboard.writeText(code); }; }
  }
  const cb = getStateCallbacks(room); // Colyseus state-change callbacks (NOT jQuery)

  cb(room.state).pieces.onAdd((piece, id) => {
    const mesh = KIND[piece.type].mesh(meshPropsOf(piece, id));
    const castsShadow = PHYS[piece.type].mass > 0;
    applyTransform(mesh, piece);
    mesh.traverse(node => { // stamp the id on the group AND its children, so picking works
      node.userData.id = id;
      if (node.isMesh) { node.castShadow = castsShadow; node.receiveShadow = true; }
    });
    scene.add(mesh);
    meshes.set(id, { mesh, type: piece.type });
    buffers.set(id, [snapshot(performance.now(), piece)]);
    cb(piece).listen('owner', () => { // name tag while held; also drop it from my selection if someone else grabs it
      updateHeldLabel(id, piece.owner);
      if (piece.owner && piece.owner !== mySession && selection.has(id)) selection.delete(id);
    }, false);

    if (piece.type === 'deck') {
      // The extruded prism is unit-height; scale Y to reflect how many cards remain. A modeled deck
      // skin (bag/box) is a fixed shape, so leave it alone — it looks the same whatever the count.
      const modeled = !!(() => { try { return JSON.parse(piece.props || '{}').model; } catch { return false; } })();
      if (!modeled) {
        const setDeckHeight = (count) => { mesh.scale.y = deckHeight(count); };
        setDeckHeight(piece.count);
        cb(piece).listen('count', setDeckHeight);
      }
    }
    if (piece.type === 'card') {
      // Rebuild the card mesh when its props change (front revealed/hidden on flip).
      cb(piece).listen('props', () => rebuildCard(id, piece), false);
    }
    if (piece.type === 'die' || piece.type === 'prop') {
      cb(piece).listen('props', () => rebuildPiece(id, piece), false); // recolor / prop tweaks
    }
    if (piece.type === 'dispenser') {
      // Rebuild the stack body when it dispenses (count drops) so its height tracks the amount left,
      // and when its props change (color/team edited via inspect) so the new tint shows.
      cb(piece).listen('count', () => rebuildPiece(id, piece), false);
      cb(piece).listen('props', () => rebuildPiece(id, piece), false);
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
    selection.delete(id);    // never keep a removed piece selected
    meshes.delete(id);
    buffers.delete(id);
  });

  // Overlays (measurement/templates) are public synced state, so a late joiner gets
  // them in the initial state — no replay needed. Immutable once placed in Step 3
  // (no overlayMove wired yet), so add/remove is the whole lifecycle here.
  cb(room.state).overlays.onAdd((o, id) => {
    addOverlay(id, o);
    // Re-render on any geometry/color change so a moved overlay (overlayMove) updates live.
    ['x', 'z', 'x2', 'z2', 'w', 'ang', 'color'].forEach(f => cb(o).listen(f, () => addOverlay(id, o), false));
  });
  cb(room.state).overlays.onRemove((o, id) => { removeOverlay(id); if (id === selOverlayId) selectOverlay(null); });
  // Live measurement previews from other players (transient — never in state).
  room.onMessage('overlayDrag', (m) => {
    if (!m || m.from == null) return;
    clearDragPreview(m.from);                       // replace this sender's previous frame
    if (!m.kind) return;                            // kind null = their drag ended
    const o = { kind: m.kind, color: m.color || '#ffffff', x: m.x, z: m.z, x2: m.x2, z2: m.z2, w: m.w, ang: m.ang };
    const group = (OVERLAY[m.kind] || OVERLAY.ruler).build(o);
    group.position.y = boardTopY + MEASURE.lift;
    scene.add(group);
    const label = overlayLabelSprite(formatMeasure(Math.hypot(o.x2 - o.x, o.z2 - o.z), room.state.scale), o.color, (o.x + o.x2) / 2, (o.z + o.z2) / 2);
    scene.add(label);
    dragPreviews.set(m.from, { group, label });
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
    syncWhiteboard(state.whiteboard); // reflect enable / slide / style changes
    syncTrays(state.trays);           // reflect personal trays appearing / being put away
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
    const lb = byId('lobbyBtn'); lb.querySelectorAll('.ico').forEach((i) => i.remove()); lb.dataset.icon = 'arrow-back-up user-shield'; { const l = lb.querySelector('.lbl'); if (l) l.textContent = 'Admin'; } lb.removeAttribute('aria-label'); applyIcons(lb.parentNode);
    lb.onclick = () => { leaving = true; try { room.leave(); } catch (e) {} location.href = '/admin.html'; };
  }
  if (window.onOttRoom) window.onOttRoom(room); // hand the room to the library panel (editor + table)
  room.onMessage('notebook', text => { byId('notesText').value = text || ''; }); // your private notes, restored on reconnect
  room.onMessage('shuffled', ({ id }) => { startAnim(id, 'shuffle'); playSfx('shuffle'); }); // everyone sees + hears the riffle
  room.onMessage('sfx', ({ type } = {}) => playSfx(type)); // shared cue (roll/flip/deal) broadcast by the server
  room.onMessage('inspectCard', ({ front, back, tile, geom }) => inspectMesh(cardMesh({ front, back, tile, geom }), { drawn: true, type: 'card' })); // drawn card — front is ours alone; tile/geom → correct proportions
  room.onMessage('dealt', ({ id }) => { // a card you dragged off a deck — adopt it as the dragged piece
    if (down && down.pendingDeal) {
      down.id = id;
      down.type = down.adoptType || 'card'; // 'card' from a deck, 'prop' from a dispenser
      down.kind = KIND[down.type];
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
  cb(room.state).players.onRemove((player, sid) => { removePlayerVis(sid); clearDragPreview(sid); renderPlayers(); renderUnclaimed(); });
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
    cb(room.state).listen('tableX', () => { resizeTable(room.state.tableX, room.state.tableZ); rebuildSeats(); rebuildGrid(); }, false);
    cb(room.state).listen('tableZ', () => { resizeTable(room.state.tableX, room.state.tableZ); rebuildSeats(); rebuildGrid(); }, false);
    cb(room.state).listen('feltColor', () => setTableColor(room.state.feltColor), false);
    cb(room.state).unclaimed.onAdd(() => renderUnclaimed());
    cb(room.state).unclaimed.onRemove(() => renderUnclaimed());
    cb(room.state).listen('turnPending', renderPlayers, false);
    cb(room.state).scale.listen('worldPerUnit', syncScalePanel, false);
    cb(room.state).scale.listen('unitLabel', syncScalePanel, false);
    cb(room.state).scale.listen('roundStep', syncScalePanel, false);
    const onGrid = () => { rebuildGrid(); syncScalePanel(); }; // redraw + reflect the panel
    cb(room.state).scale.listen('cellWorld', onGrid, false);   // grid: cell width (X)
    cb(room.state).scale.listen('cellZ', onGrid, false);       // grid: cell depth (Z) — rectangular grids
    cb(room.state).scale.listen('gridX', onGrid, false);       // grid: lattice offset X
    cb(room.state).scale.listen('gridZ', onGrid, false);       // grid: lattice offset Z
    cb(room.state).scale.listen('gridStyle', onGrid, false);   // grid: off / square / hex
    cb(room.state).scale.listen('gridHidden', onGrid, false);  // grid: shown / hidden (still snaps)
    cb(room.state).scale.listen('gridColor', onGrid, false);   // grid: line colour
    cb(room.state).scale.listen('gridLift', () => { if (gridLines) gridLines.position.y = gridY(); syncScalePanel(); }, false); // height: just move it, no rebuild
    cb(room.state).scale.listen('snapAnchor', syncScalePanel, false); // snap target only — no redraw
  } catch (e) { /* older server without these fields — feature stays inert */ }
  renderScores(); updateRoomNotes(); renderUnclaimed();
  if (room.state.tableX) { resizeTable(room.state.tableX, room.state.tableZ); rebuildSeats(); } // initial size (may be default until decode)
  if (room.state.feltColor) setTableColor(room.state.feltColor); // initial felt color
  rebuildGrid(); // initial grid (inert until a GM sets a cell size + square style)


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
  // Room Settings modal (UI_Redesign phase 3): tabbed Table Size & Color + Scale & Grid (Whiteboard + Skybox join in 3b).
  { const rs = byId('roomSettingsModal');
    const syncRoomSettings = () => {
      byId('tableW').value = Math.round(room.state.tableX * 2);
      byId('tableD').value = Math.round(room.state.tableZ * 2);
      byId('tableFelt').value = room.state.feltColor || '#2f6b4f';
      syncScalePanel();
    };
    wire('roomSettings', () => { byId('roomGrp').hidden = true; if (rs) { rs.hidden = false; syncRoomSettings(); } });
    wire('roomSettingsClose', () => { if (rs) rs.hidden = true; });
    rs?.querySelectorAll('.libTab').forEach((t) => t.onclick = () => {
      rs.querySelectorAll('.libTab').forEach((x) => x.classList.toggle('on', x === t));
      rs.querySelectorAll('.libPane').forEach((p) => { p.hidden = p.dataset.pane !== t.dataset.tab; });
    });
  }
  { // GM: whiteboard config — a Tools-menu panel that flows below the menu (not a full-screen modal)
    const wbPanel = byId('whiteboard'), wbBtn = byId('wbBtn');
    if (wbPanel && wbBtn) {
      wbBtn.onclick = () => {
        wbPanel.hidden = !wbPanel.hidden;
        if (!wbPanel.hidden) { // sync controls from current room state on open
          const wb = room.state.whiteboard;
          byId('wbEnabled').classList.toggle('on', wb.enabled); setIcon(byId('wbEnabled'), wb.enabled ? 'eye' : 'eye-off');
          qsa('#whiteboard [data-wbstyle]').forEach(c => c.classList.toggle('on', c.dataset.wbstyle === (wb.dark ? 'dark' : 'light')));
          byId('wbAngle').value = Math.round(wb.angle * 180 / Math.PI);
        }
      };
      const wbClose = byId('wbClose'); if (wbClose) wbClose.onclick = () => { wbPanel.hidden = true; };
    }
  }
  { const el = byId('wbEnabled'); if (el) el.onclick = () => { const on = !el.classList.contains('on'); el.classList.toggle('on', on); setIcon(el, on ? 'eye' : 'eye-off'); room.send('wbEnable', { on }); }; }
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
    const felt = byId('tableFelt'); if (felt) felt.oninput = () => room.send('tableColor', { color: felt.value });
    buildColorSwatches(byId('feltSwatches'), FELT_COLORS, (hex) => { const f = byId('tableFelt'); if (f) f.value = hex; room.send('tableColor', { color: hex }); }); }

  // Measurement scale (GM-set, durable). Reads live from room.state.scale; writes
  // via scaleSet. Drag-calibration lands with the ruler tool (Step 3).
  function syncScalePanel() {
    const sc = room.state.scale; if (!sc) return;
    const u = sc.unitLabel || 'u';
    const custom = u !== 'u' && !['in', 'cm', 'mm'].includes(u); // a user-typed label like "hex"
    // Light the matching toggle (or Custom…); reveal the custom field only when custom.
    document.querySelectorAll('#scaleUnits [data-unit]').forEach(b => b.classList.toggle('on', b.dataset.unit === u || (custom && b.dataset.unit === '__custom__')));
    const cRow = byId('scaleCustomRow'); if (cRow) cRow.hidden = !custom;
    const cInp = byId('scaleUnitCustom'); if (cInp && document.activeElement !== cInp) cInp.value = custom ? u : '';
    const sEl = byId('scaleStep'); if (sEl && document.activeElement !== sEl) sEl.value = sc.roundStep;
    const su = byId('scaleStepUnit'); if (su) su.textContent = u;
    const wu = byId('scaleWidthUnit'); if (wu) wu.textContent = u;
    const wv = byId('scaleWidthVal'); // prefill with the table's CURRENT width in display units (editable)
    if (wv && document.activeElement !== wv) { const cur = (room.state.tableX * 2) / (+sc.worldPerUnit || 1); wv.value = Number.isFinite(cur) ? String(+cur.toFixed(2)) : ''; }
    // Grid controls: light the active style, reveal cell/color rows when a grid is on,
    // show the cell size in display units, and mirror the line color.
    const gStyle = sc.gridStyle || 'off', gridOn = gStyle !== 'off';
    document.querySelectorAll('#gridStyles [data-grid]').forEach(b => b.classList.toggle('on', b.dataset.grid === gStyle));
    const gcr = byId('gridCellRow'); if (gcr) gcr.hidden = !gridOn;
    const gor = byId('gridOffRow'); if (gor) gor.hidden = !gridOn;
    const gou = byId('gridOffUnit'); if (gou) gou.textContent = u;
    const gcalr = byId('gridCalibRow'); if (gcalr) gcalr.hidden = !gridOn;
    const gkr = byId('gridColorRow'); if (gkr) gkr.hidden = !gridOn;
    const glr = byId('gridLiftRow'); if (glr) glr.hidden = !gridOn;
    const gl = byId('gridLift'); if (gl && document.activeElement !== gl) gl.value = Number.isFinite(+sc.gridLift) ? sc.gridLift : 0.05;
    const gcu = byId('gridCellUnit'); if (gcu) gcu.textContent = u;
    const perU = +sc.worldPerUnit || 1;
    const gc = byId('gridCell');
    if (gc && document.activeElement !== gc) { const wc = (+sc.cellWorld || 0) / perU; gc.value = wc > 0 ? String(+wc.toFixed(3)) : ''; }
    const gcz = byId('gridCellZ'); // cell DEPTH (Z spacing); falls back to the width for a square grid
    if (gcz && document.activeElement !== gcz) { const dc = ((+sc.cellZ > 0 ? +sc.cellZ : +sc.cellWorld) || 0) / perU; gcz.value = dc > 0 ? String(+dc.toFixed(3)) : ''; }
    const gox = byId('gridOffX'); if (gox && document.activeElement !== gox) gox.value = String(+(((+sc.gridX || 0) / perU).toFixed(3)));
    const goz = byId('gridOffZ'); if (goz && document.activeElement !== goz) goz.value = String(+(((+sc.gridZ || 0) / perU).toFixed(3)));
    const gk = byId('gridColor');
    if (gk && document.activeElement !== gk && /^#[0-9a-f]{6}$/i.test(sc.gridColor || '')) gk.value = sc.gridColor;
    const gsr = byId('gridSnapRow'); if (gsr) gsr.hidden = !gridOn; // snap-anchor toggle (centers vs crossings)
    const ghr = byId('gridHideRow'); if (ghr) ghr.hidden = !gridOn; // hide-grid toggle (snaps, not drawn)
    const ght = byId('gridHideTog'); if (ght) { ght.classList.toggle('on', !!sc.gridHidden); setIcon(ght, sc.gridHidden ? 'eye-off' : 'eye'); }
    const anchor = sc.snapAnchor === 'cross' ? 'cross' : 'center';
    document.querySelectorAll('#gridAnchors [data-anchor]').forEach(b => b.classList.toggle('on', b.dataset.anchor === anchor));
    relabelOverlays(); // scale drives every ruler's label
  }
  {
    const sEl = byId('scaleStep'); if (sEl) sEl.onchange = () => { const v = +sEl.value; if (v > 0) room.send('scaleSet', { roundStep: v }); };
    const cRow = byId('scaleCustomRow'), cInp = byId('scaleUnitCustom');
    // Unit toggles: inch/cm/mm set the label + a sensible round step; "Custom…" reveals
    // a text field for a free-form label (e.g. "hex"). Mirrors the Measure kind picker.
    document.querySelectorAll('#scaleUnits [data-unit]').forEach(b => {
      b.onclick = () => {
        if (b.dataset.unit === '__custom__') {
          document.querySelectorAll('#scaleUnits [data-unit]').forEach(x => x.classList.toggle('on', x === b));
          if (cRow) cRow.hidden = false;
          if (cInp) { cInp.focus(); cInp.select(); }
        } else {
          room.send('scaleSet', { unitLabel: b.dataset.unit, roundStep: +b.dataset.step || 0.5 });
        }
      };
    });
    const sendCustom = () => { const v = (cInp.value || '').trim().slice(0, 8); if (v) room.send('scaleSet', { unitLabel: v }); };
    if (cInp) { cInp.onchange = sendCustom; cInp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); sendCustom(); cInp.blur(); } }; }
    // Calibrate from the typed real width: worldPerUnit = tableWorldWidth / N.
    const setW = byId('scaleWidthSet'); if (setW) setW.onclick = () => {
      const n = parseFloat(byId('scaleWidthVal').value);
      if (n > 0) room.send('scaleSet', { worldPerUnit: (room.state.tableX * 2) / n });
    };
    const wv = byId('scaleWidthVal'); if (wv) wv.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); setW && setW.onclick(); } };
    // Grid: style toggle (Off/Square), cell size (display units → world), line color.
    document.querySelectorAll('#gridStyles [data-grid]').forEach(b => {
      b.onclick = () => {
        const msg = { gridStyle: b.dataset.grid };
        // Enabling a grid for the first time needs a cell size, or it renders nothing:
        // default to one display unit per cell.
        if (b.dataset.grid !== 'off' && !(+room.state.scale.cellWorld > 0)) msg.cellWorld = +room.state.scale.worldPerUnit || 1;
        room.send('scaleSet', msg);
      };
    });
    // Cell size — width (X) and depth (Z) independently, so a rectangular board (go) can be
    // matched. Equal values = a square grid.
    const gc = byId('gridCell'); if (gc) gc.onchange = () => { const v = +gc.value; if (v > 0) room.send('scaleSet', { cellWorld: v * (+room.state.scale.worldPerUnit || 1) }); };
    const gcz = byId('gridCellZ'); if (gcz) gcz.onchange = () => { const v = +gcz.value; if (v > 0) room.send('scaleSet', { cellZ: v * (+room.state.scale.worldPerUnit || 1) }); };
    // Offset — nudge the grid lattice to line up with a printed map's phase (X, Z).
    const gox = byId('gridOffX'); if (gox) gox.onchange = () => room.send('scaleSet', { gridX: (+gox.value || 0) * (+room.state.scale.worldPerUnit || 1) });
    const goz = byId('gridOffZ'); if (goz) goz.onchange = () => room.send('scaleSet', { gridZ: (+goz.value || 0) * (+room.state.scale.worldPerUnit || 1) });
    const gk = byId('gridColor'); if (gk) gk.oninput = () => room.send('scaleSet', { gridColor: gk.value });
    buildColorSwatches(byId('gridColorSwatches'), GRID_COLORS, (hex) => { const g = byId('gridColor'); if (g) g.value = hex; room.send('scaleSet', { gridColor: hex }); });
    const gl = byId('gridLift'); if (gl) gl.oninput = () => room.send('scaleSet', { gridLift: +gl.value });
    // Snap anchor: cell centres (chess/checkers) vs line crossings (go). Also tells the
    // "Fit to board" button whether the count you enter means squares or lines.
    document.querySelectorAll('#gridAnchors [data-anchor]').forEach(b => { b.onclick = () => room.send('scaleSet', { snapAnchor: b.dataset.anchor }); });
    { const b = byId('gridHideTog'); if (b) b.onclick = () => room.send('scaleSet', { gridHidden: !room.state.scale.gridHidden }); } // hide the lines, keep snapping
    // Fit to board: size the grid to the board on the table. Built-in boards need nothing (the
    // registry knows their geometry — one click); a custom/image board takes the count you type
    // in the "across" field, read as squares or lines per the current Snap-to setting.
    const calibBtn = byId('gridCalib');
    if (calibBtn) calibBtn.onclick = () => {
      let boardPiece = null; room.state.pieces.forEach(p => { if (!boardPiece && p.type === 'board') boardPiece = p; });
      if (!boardPiece) { alert('Place a board on the table first, then fit the grid to it.'); return; }
      const spec = BOARDS[JSON.parse(boardPiece.props || '{}').board];
      const n = parseInt(byId('gridCells').value, 10);
      const anchor = room.state.scale.snapAnchor === 'cross' ? 'cross' : 'center';
      if (n > 0) room.send('calibrateGrid', { cells: n, anchor });
      else if (spec && spec.grid) room.send('calibrateGrid', {}); // built-in: use its known cell count
      else alert('Enter how many cells (or lines, for a go-style board) go across the board.');
    };
  }

  // Measure tool (Tools menu): toggle a modal mode; drag on the felt to lay the
  // selected overlay (ruler / circle / cone / line — picked in the kind row).
  { // Measure open/close is handled by the top-right cluster (onOpen=enterMeasure, onClose=exitMeasure).
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
  document.querySelectorAll('.selectTool').forEach((b) => b.onclick = () => setSelMode(!selMode)); // Select tool: felt-drag boxes a selection
  // (the #selSwatches row is built per-selection by refreshSelTools — it depends on what's selected)
  byId('roll').onclick = () => openTray();          // Roll hops to YOUR tray (placing it if it isn't out)
  { const b = byId('trayBack');  if (b) b.onclick = () => closeTray(); }                 // leave the view, tray stays
  { const b = byId('trayAway');  if (b) b.onclick = () => putTrayAway(); }               // put my tray away (clears its dice)
  qsa('#trayTools .trayDie').forEach(b => b.onclick = () => room.send('spawn', { type: 'die', props: { ...myDieProps(+b.dataset.sides), tray: true } })); // add a die to MY tray (in my saved color)
  { const setRow = byId('traySetSwatches');                                             // named dice sets: one click = a matching set for all my dice
    if (setRow) for (const s of DICE_SETS) {
      const chip = document.createElement('button');
      chip.type = 'button'; chip.className = 'swatch'; chip.title = s.name + ' — set all my dice';
      chip.style.background = '#' + ((s.color >>> 0) & 0xffffff).toString(16).padStart(6, '0');
      chip.onclick = () => applyDiceSet(s.color);                                        // saves defaults for every type + recolors my tray dice
      setRow.appendChild(chip);
    } }
  { const b = byId('trayRoll');     if (b) b.onclick = () => room.send('roll'); }      // fling every die in MY tray
  { const b = byId('trayScoop');    if (b) b.onclick = () => room.send('trayScoop'); } // gather MY dice back to the middle
  { const b = byId('trayClearBtn'); if (b) b.onclick = () => room.send('trayClear'); } // remove MY dice
  wire('mySeatBtn', () => applySeat(mySeat)); // snap the camera back to your seat
  byId('nextTurn').onclick = () => room.send('nextTurn');
  { // Right rail: collapse to a compact pinned head (toggle + turn + Next turn). Starts collapsed on mobile/narrow.
    const rail = byId('rightRail'), tog = byId('railToggle');
    if (rail && tog) {
      const apply = (c) => { rail.classList.toggle('collapsed', c); setIcon(tog, c ? 'square-chevron-left' : 'square-chevron-right'); tog.setAttribute('aria-label', c ? 'Show panel' : 'Collapse panel'); };
      tog.onclick = () => apply(!rail.classList.contains('collapsed'));
      apply(matchMedia('(pointer: coarse), (max-width: 720px)').matches); // set initial state + icon
    }
  }
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
  const notesText = byId('notesText'); // Notes now opens via the shared-region cluster (see wireCluster below)
  // Audio settings (Tools menu): effects volume + mute, persisted client-side.
  const sfxVol = byId('sfxVol'), sfxMute = byId('sfxMute');
  {
    // Music open/close is handled by the top-right cluster (audioBtn → music pane; wireCluster below).
    // The audio keeps playing when the pane is closed — only the controls hide.
    if (sfxVol) { sfxVol.value = Math.round(getSfxVolume() * 100); sfxVol.oninput = () => setSfxVolume(sfxVol.value / 100); }
    const muteBtn = (btn, get, set, on, off) => { if (!btn) return; const sync = () => setIcon(btn, get() ? off : on); sync(); btn.onclick = () => { set(!get()); sync(); }; };
    muteBtn(byId('sfxMute'), getSfxMuted, setSfxMuted, 'ear', 'ear-off');
    muteBtn(byId('musicMute'), getMusicMuted, setMusicMuted, 'music', 'music-off');
    // background music
    const musicVol = byId('musicVol'), musicToggle = byId('musicToggle'), nowPlaying = byId('nowPlaying');
    if (musicVol) { musicVol.value = Math.round(getMusicVolume() * 100); musicVol.oninput = () => setMusicVolume(musicVol.value / 100); }
    const syncMusicBtn = () => { if (musicToggle) setIcon(musicToggle, isMusicPlaying() ? 'player-pause' : 'player-play'); };
    if (musicToggle) musicToggle.onclick = () => { toggleMusic(); syncMusicBtn(); };
    wire('musicNext', () => { nextTrack(); syncMusicBtn(); });
    const shuffleBtn = byId('musicShuffle');
    if (shuffleBtn) { shuffleBtn.classList.toggle('on', getShuffle()); shuffleBtn.onclick = () => { const on = !getShuffle(); setShuffle(on); shuffleBtn.classList.toggle('on', on); }; }
    onMusicTrack((t) => { if (nowPlaying) nowPlaying.textContent = t ? ('\u266a ' + t.title + ' \u2014 ' + MUSIC_CREDIT.by + ' (' + MUSIC_CREDIT.license + ')') : ''; });
    // credits panel — attribution for baked-in assets (CC-BY music requires this)
    const renderCredits = () => {
      const body = byId('creditsBody'); if (!body) return;
      const esc = escapeHtml;
      const A = (t, u) => u ? ('<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(t) + '</a>') : esc(t);
      const ul = 'style="margin:4px 0 10px;padding-left:18px;font-size:var(--fs-sm)"';
      let h = '';
      if (MUSIC.length) { h += '<div class="showLabel"><b>Music</b></div><ul ' + ul + '>'; for (const t of MUSIC) h += '<li>' + esc(t.title) + ' \u2014 ' + A(MUSIC_CREDIT.by, MUSIC_CREDIT.url) + ', ' + A(MUSIC_CREDIT.license, MUSIC_CREDIT.licenseUrl) + '</li>'; h += '</ul>'; }
      h += '<div class="showLabel"><b>Sound effects</b></div><ul ' + ul + '>'; for (const x of SFX_CREDITS) h += '<li>' + esc(x.title) + ' \u2014 ' + A(x.by, x.url) + ', ' + esc(x.license) + '</li>'; h += '</ul>';
      h += '<div class="showLabel"><b>Models</b></div><ul ' + ul + '>'; for (const x of MODEL_CREDITS) h += '<li>' + esc(x.title) + ' \u2014 ' + A(x.by, x.url) + ', ' + esc(x.license) + (x.note ? ' \u2014 ' + esc(x.note) : '') + '</li>'; h += '</ul>';
      h += '<div class="showLabel"><b>Art</b></div><ul ' + ul + '>'; for (const x of ART_CREDITS) h += '<li>' + esc(x.title) + ' \u2014 ' + A(x.by, x.url) + ', ' + esc(x.license) + (x.note ? ' \u2014 ' + esc(x.note) : '') + '</li>'; h += '</ul>';
      h += '<div class="showLabel"><b>Libraries</b></div><ul ' + ul + '>'; for (const l of LIB_CREDITS) h += '<li>' + A(l.title, l.url) + ' \u2014 ' + esc(l.license) + '</li>'; h += '</ul>';
      body.innerHTML = h;
    };
    // Settings modal (reuses renderCredits above for the Credits section)
    const settingsModal = byId('settingsModal');
    wire('settingsBtn', () => { if (settingsModal) { settingsModal.hidden = false; renderCredits(); } });
    wire('settingsClose', () => { if (settingsModal) settingsModal.hidden = true; });
    settingsModal?.querySelectorAll('.libTab').forEach((t) => t.onclick = () => {
      settingsModal.querySelectorAll('.libTab').forEach((x) => x.classList.toggle('on', x === t));
      settingsModal.querySelectorAll('.libPane').forEach((p) => { p.hidden = p.dataset.pane !== t.dataset.tab; });
    });
    // Full / Compact UI toggle (persisted)
    const uiModeToggle = byId('uiModeToggle');
    const syncUiMode = () => { const full = document.body.classList.contains('ui-full'); if (uiModeToggle) { const mode = full ? 'Default UI' : 'Compact UI'; setIcon(uiModeToggle, full ? 'arrows-minimize' : 'arrows-maximize'); uiModeToggle.classList.toggle('on', full); uiModeToggle.setAttribute('aria-pressed', full ? 'true' : 'false'); uiModeToggle.setAttribute('aria-label', mode); const l = uiModeToggle.querySelector('.lbl'); if (l) l.textContent = mode; } };
    syncUiMode();
    wire('uiModeToggle', () => { const full = document.body.classList.toggle('ui-full'); localStorage.setItem('ott-ui-full', full ? '1' : '0'); syncUiMode(); });
    // Accent color (personal, saved on this device)
    const applyAccent = (hex) => {
      if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
      const st = document.documentElement.style;
      st.setProperty('--accent', hex);
      st.setProperty('--accent-soft', 'rgba(' + parseInt(hex.slice(1, 3), 16) + ',' + parseInt(hex.slice(3, 5), 16) + ',' + parseInt(hex.slice(5, 7), 16) + ',.25)');
      localStorage.setItem('ott-accent', hex);
      document.querySelectorAll('#accentPicker .accDot').forEach((d) => d.classList.toggle('on', d.dataset.accent.toLowerCase() === hex.toLowerCase()));
      const c = byId('accentCustom'); if (c) c.value = hex;
    };
    document.querySelectorAll('#accentPicker .accDot').forEach((d) => d.onclick = () => applyAccent(d.dataset.accent));
    const accCust = byId('accentCustom'); if (accCust) accCust.oninput = () => applyAccent(accCust.value);
    applyAccent(localStorage.getItem('ott-accent') || '#c9a25a');
    // track picker — click a track to play it (opens over the Sound panel too)
    const tracksPanel = byId('tracksPanel');
    const renderTracks = () => {
      const body = byId('tracksBody'); if (!body) return;
      if (!MUSIC.length) { body.innerHTML = '<div class="muted">No tracks added yet.</div>'; return; }
      const esc = escapeHtml;
      const cur = currentTrackIndex();
      body.innerHTML = MUSIC.map((t, i) => '<button class="trackItem" data-i="' + i + '">' + esc(t.title) + '</button>').join('');
      body.querySelectorAll('.trackItem').forEach(btn => { btn.classList.toggle('on', +btn.dataset.i === cur); btn.onclick = () => { playTrack(+btn.dataset.i); syncMusicBtn(); renderTracks(); }; });
    };
    wire('tracksLink', (e) => { if (e && e.preventDefault) e.preventDefault(); renderTracks(); if (tracksPanel) tracksPanel.hidden = false; });
    wire('tracksClose', () => { if (tracksPanel) tracksPanel.hidden = true; });
  }
  { // Public chat panel (Tools)
    const input = byId('chatInput');
    if (input && byId('chatSend')) {
      const send = () => { const t = input.value.trim(); if (t) { room.send('chat', { text: t }); input.value = ''; } };
      byId('chatSend').onclick = send;
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
  const timerReadout = byId('timerReadout'), timerToggle = byId('timerToggle');
  const timerMode = byId('timerMode'), timerDurRow = byId('timerDurRow'), timerDur = byId('timerDur');
  const durMs = () => (+timerDur.value || 0) * 60000;
  const modeVal = () => { const c = timerMode.querySelector('.libTab.on'); return c ? c.dataset.mode : 'up'; };
  const setMode = (m) => timerMode.querySelectorAll('.libTab').forEach(c => c.classList.toggle('on', c.dataset.mode === m));
  // Timer open/close is handled by the top-right cluster (wireCluster below); its live value also shows in the button (see the tick loop).

  // Scoreboard + room notes content (now in the top-right region; opened via wireCluster)
  if (byId('scoreRows')) {
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
    const t = room.state.timer;
    const btnLbl = byId('timerBtn') && byId('timerBtn').querySelector('.lbl');
    if (btnLbl) btnLbl.textContent = (t && t.running) ? fmtTime(timerLive(t, Date.now())) : 'Timer'; // live value in the button
    const r = byId('regionTR');
    const paneOpen = r && !r.hidden && r.querySelector('.pane[data-pane="timer"].on');
    if (!paneOpen || !t) return; // nothing more to draw unless the timer pane is showing
    timerReadout.textContent = fmtTime(timerLive(t, Date.now()));
    setIcon(timerToggle, t.running ? 'player-pause' : 'player-play');
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
    everyone.className = 'chip'; everyone.dataset.sid = 'all'; everyone.dataset.icon = 'friends'; everyone.innerHTML = '<span class="lbl">Everyone</span>';
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
    applyIcons(showAudience);
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
    showLive = true; setIcon(showHold, 'eye');
    room.send('showStart', { to, hids });
  });
  const endShow = () => { if (showLive) { showLive = false; room.send('showStop'); setIcon(showHold, 'eye-off'); } };
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
let holdSig = -1; // visibility signature for the clustered height/rotate controls (synced each frame)
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3(); // fixed ground plane (y=0); drag height is applied as a separate Y offset
const prevTarget = new THREE.Vector3(), throwVel = new THREE.Vector3(); // hand speed → throw velocity
let lastMoveSent = 0, prevThrowTime = 0, down = null;
let armedMove = null; // touch: a piece id whose next drag repositions it (the deck/dispenser "Move" menu item) instead of dealing
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

// Canvas input (context-menu, middle-click, wheel, dblclick) is wired via public/controls.js —
// see the INPUT intent map at the end of this file.
// Bottom-left: the Tools ham toggles the (shrinking) Tools menu; Interactions is now a corner cluster (wireCluster below).
{
  const tools = byId('toolsMenu');
  const placeAboveHam = (menu) => { if (!menu || menu.hidden) return; const bar = byId('hamBar'); if (bar) menu.style.bottom = (innerHeight - bar.getBoundingClientRect().top + 8) + 'px'; }; // open above the vertical hamburger stack
  byId('toolsHam')?.addEventListener('click', () => { if (tools) { tools.hidden = !tools.hidden; placeAboveHam(tools); } });
}
{ const b = byId('controlsBtn'); if (b) b.onclick = () => { byId('controlsModal').hidden = false; }; } // open How to Play
{ const b = byId('controlsClose'); if (b) b.onclick = () => { byId('controlsModal').hidden = true; }; }
{ const b = byId('leanBtn'); if (b) b.onclick = () => { leanActive = !leanActive; b.classList.toggle('on', leanActive); const t = leanActive ? 'Lean Out' : 'Lean In'; const l = b.querySelector('.lbl'); if (l) l.textContent = t; b.setAttribute('aria-label', t); }; } // toggle the closer-look camera (keep the icon; relabel only)
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

const skyDefault = scene.background;   // the flat color it ships with
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
{ const body = byId('inspectColorBody'), text = byId('inspectColorText'), teamBtn = byId('inspectTeamBtn');
  const commit = () => {
    if (!inspect || !inspect.origId) return;
    const b = parseInt(body.value.slice(1), 16);
    if (inspect.type === 'die') {
      const t = parseInt(text.value.slice(1), 16);
      inspect.props = { ...(inspect.props || {}), color: b, textColor: t };
      swapInspect(inspect.props);                                                      // preview on the inspected die
      room.send('recolor', { id: inspect.origId, color: b, textColor: t });
    } else if (inspect.type === 'dispenser') {                                          // poker/coin stack tint
      inspect.props = { ...(inspect.props || {}), color: b };
      swapInspect(inspect.props);
      room.send('recolor', { id: inspect.origId, color: b });
    } else {                                                                            // custom prop
      room.send('recolor', { id: inspect.origId, color: b });
    }
  };
  const toHex = (c) => '#' + ((c >>> 0) & 0xffffff).toString(16).padStart(6, '0'); // local (hexStr is defined lower — TDZ)
  // Paint the inspected die: body = color, numbers auto-contrasted for legibility. Reused by
  // the freeform body picker and the preset swatches; commits through the normal recolor path.
  const paintDie = (color) => {
    if (!inspect || inspect.type !== 'die') return;
    body.value = toHex(color);
    if (text) text.value = toHex(readableInk(color));
    commit();
  };
  if (body) { // live preview while dragging: props tint blunt; stacks reclone (cached, cheap)
    body.oninput = () => {
      if (!inspect) return;
      const c = parseInt(body.value.slice(1), 16);
      if (inspect.type === 'prop') tintInspect(c);
      else if (inspect.type === 'dispenser') swapInspect({ ...(inspect.props || {}), color: c });
    };
    body.onchange = () => {
      if (inspect && inspect.type === 'die' && text) text.value = toHex(readableInk(parseInt(body.value.slice(1), 16))); // auto-contrast numbers to the new body
      commit();
    };
  }
  if (text) text.onchange = commit;                                                    // an explicit number override still wins
  if (teamBtn) teamBtn.onclick = () => {                                                // go bowl: black ⇄ white interior
    if (!inspect || inspect.type !== 'dispenser') return;
    const team = inspect.props.team ? 0 : 1;
    inspect.props = { ...(inspect.props || {}), team };
    teamBtn.textContent = team ? 'White' : 'Black';
    swapInspect(inspect.props);
    room.send('recolor', { id: inspect.origId, team });
  };
  const swatchRow = byId('dieSwatches');                                                // preset body colors (the named dice sets)
  if (swatchRow) for (const s of DICE_SETS) {
    const chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'swatch'; chip.title = s.name;
    chip.style.background = toHex(s.color);
    chip.onclick = () => paintDie(s.color);
    swatchRow.appendChild(chip);
  }
  const defBtn = byId('inspectDefaultBtn');                                             // remember this die's color as my default for its type
  if (defBtn) defBtn.onclick = () => {
    if (!inspect || inspect.type !== 'die' || !inspect.props) return;
    const sides = +inspect.props.sides;
    if (!DIE_SIDES.includes(sides)) return;
    const b = parseInt(byId('inspectColorBody').value.slice(1), 16);                    // read what's on screen now
    const t = parseInt(byId('inspectColorText').value.slice(1), 16);
    saveDiceDefault(sides, b, t);                                                       // local only — never synced
    setBtnLabel(defBtn, `Saved · d${sides}`); defBtn.disabled = true;                   // brief confirmation
    setTimeout(() => { if (byId('inspectDefaultBtn') === defBtn) { setBtnLabel(defBtn, 'Set as my default'); defBtn.disabled = false; } }, 1300);
  };
  const resetBtn = byId('inspectResetBtn');                                             // forget this type's default + plain this die
  if (resetBtn) resetBtn.onclick = () => {
    if (!inspect || inspect.type !== 'die' || !inspect.props) return;
    const sides = +inspect.props.sides;
    if (DIE_SIDES.includes(sides)) clearDiceDefault(sides);
    paintDie(0xf4f1ea);                                                                 // back to plain ivory (ink auto)
    setBtnLabel(resetBtn, 'Reset ✓');
    setTimeout(() => { if (byId('inspectResetBtn') === resetBtn) setBtnLabel(resetBtn, 'Reset'); }, 1200);
  };
}

// --- Prop / dispenser recolor swatches (built per-object from the piece's allowed palette) ---
// Recolor the inspected prop/dispenser to a freeform/palette color (preview + send).
function recolorInspectedColor(hex) {
  if (!inspect || (inspect.type !== 'prop' && inspect.type !== 'dispenser')) return;
  const color = hex == null ? COLORS.neutralProp : hex;
  inspect.props = { ...(inspect.props || {}), color };
  if (inspect.type === 'dispenser') swapInspect(inspect.props); else tintInspect(color);
  const body = byId('inspectColorBody'); if (body) body.value = hexStr(color);          // keep the freeform picker in sync
  room.send('recolor', { id: inspect.origId, color });
}
// Recolor the inspected TEAM piece by switching its set (0/1) — colors are fixed, so this
// picks a side, not a hue. Preview uses the set's color; the server stores props.team.
function recolorInspectedTeam(i, hex) {
  if (!inspect) return;
  inspect.props = { ...(inspect.props || {}), team: i ? 1 : 0 };
  if (inspect.type === 'dispenser') swapInspect(inspect.props); else tintInspect(hex);
  room.send('recolor', { id: inspect.origId, team: i ? 1 : 0 });
}
// Rebuild the #propSwatches row for the inspected object from its allowed palette (recolorPalette):
// a team piece gets its two set colors, a limited-palette piece (coins) gets that palette, a
// general prop gets the full palette. Returns the descriptor so the caller can hide the freeform
// picker when the object is constrained.
function rebuildPropSwatches(opt) {
  const row = byId('propSwatches'); if (row) {
    row.innerHTML = '';
    if (opt) opt.swatches.forEach((s, i) => {
      const chip = document.createElement('button');
      chip.type = 'button'; chip.className = 'swatch' + (s.hex == null ? ' neutral' : ''); chip.title = s.name;
      if (s.hex != null) chip.style.background = hexStr(s.hex);
      chip.onclick = opt.team ? () => recolorInspectedTeam(i, s.hex) : () => recolorInspectedColor(s.hex);
      row.appendChild(chip);
    });
  }
  return opt;
}

// Map a click-action name to the server message it sends.
const sendAction = (action, id) => {
  if (action === 'takeCard') { room.send('takeCard', { id }); playSfx(pieceIsTile(id) ? 'tile-pickup' : 'card-pickup'); }
  else if (action === 'drawToHand') { room.send('drawToHand', { deckId: id }); playSfx(pieceIsTile(id) ? 'tile-pickup' : 'card-pickup'); }
  else if (action === 'deal') room.send('dealToTable', { deckId: id });
  else if (action === 'dispense') { room.send('dispense', { id }); playSfx('object-pickup'); }
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
const INSPECTABLE = (type) => type === 'die' || type === 'card' || type === 'prop' || type === 'dispenser'; // not boards/decks

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

  inspect = { pivot, origId: opts.origId || null, type: opts.type, props: null, drag: null, drawn: !!opts.drawn, placed: false, hid: opts.hid || null };
  controls.enabled = false;
  byId('inspectHint').hidden = !!opts.drawn; // a drawn card shows the action panel instead
  byId('drawActions').hidden = !opts.drawn;
  { const db = byId('drawActions') && byId('drawActions').querySelector('[data-place="deck"]'); if (db) db.hidden = !!opts.hid; } // a hand card has no deck to return to
  const piece0 = opts.origId && room.state.pieces.get(opts.origId);
  const props0 = piece0 ? JSON.parse(piece0.props || '{}') : {};
  const spec = opts.type === 'dispenser' ? DISPENSERS[props0.disp] : null;
  const teamMode = !!(spec && spec.team);                          // go bowl → black/white toggle
  const colorMode = opts.type === 'die' || opts.type === 'prop' || !!(spec && spec.color); // freeform picker
  const colorable = (colorMode || teamMode) && !opts.drawn;
  const row = byId('inspectColorRow');
  if (row) {
    row.hidden = !colorable;
    if (colorable) {
      inspect.props = props0;
      if (opts.type === 'dispenser') inspect.props.count = piece0.count; // carry stack height into reclone previews
      const isDie = opts.type === 'die';
      // A prop/dispenser's ALLOWED palette (team set / limited palette / general) — mirrors the
      // spawn cards, so an object can't be tinted off its intended colors. null for a die.
      const opt = (colorMode && !isDie) ? recolorPalette(opts.type, props0, spec) : null;
      rebuildPropSwatches(opt);
      const constrained = !!(opt && !opt.free);                      // team piece or limited palette → no freeform
      const bodyLab = byId('inspectBodyLab'), textLab = byId('inspectTextLab'), teamLab = byId('inspectTeamLab');
      if (bodyLab) bodyLab.hidden = teamMode || constrained;         // hide the freeform picker when the object is constrained
      if (textLab) textLab.hidden = !isDie;                          // dice also get a number color
      if (teamLab) teamLab.hidden = !teamMode;
      if (colorMode && bodyLab) {
        bodyLab.firstChild.nodeValue = isDie ? 'Body ' : 'Color ';
        byId('inspectColorBody').value = hexStr(inspect.props.color ?? (isDie ? 0xf4f1ea : 0xffffff)); // die = ivory blank face
        if (isDie) byId('inspectColorText').value = hexStr(inspect.props.textColor ?? 0x141414);       // die = ink numbers
      }
      const defBtn = byId('inspectDefaultBtn');                       // dice only: "make this my default d?"
      if (defBtn) { defBtn.hidden = !isDie; defBtn.disabled = false; setBtnLabel(defBtn, 'Set as my default'); }
      const swRow = byId('dieSwatches'); if (swRow) swRow.hidden = !isDie;             // dice sets (dice only)
      const propRow = byId('propSwatches'); if (propRow) propRow.hidden = !(opt && opt.swatches.length); // per-object palette
      const resetBtn = byId('inspectResetBtn'); if (resetBtn) { resetBtn.hidden = !isDie; setBtnLabel(resetBtn, 'Reset'); }
      if (teamMode) { const tb = byId('inspectTeamBtn'); if (tb) tb.textContent = inspect.props.team ? 'White' : 'Black'; }
    }
  }
}
const hexStr = (c) => '#' + ((c >>> 0) & 0xffffff).toString(16).padStart(6, '0');
// Rebuild the inspected mesh with new props (live preview for die colors and
// dispenser color/team). Cheap for stacks — they reclone from the cached model.
function swapInspect(props) {
  if (!inspect || !inspect.pivot || (inspect.type !== 'die' && inspect.type !== 'dispenser')) return;
  const old = inspect.pivot.children[0];
  if (old) inspect.pivot.remove(old);
  if (inspect.type === 'dispenser') props = { ...props, _seed: inspect.origId }; // keep the preview's scramble stable
  const mesh = KIND[inspect.type].mesh(props);
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
  const fresh = (entry.type === 'die' || entry.type === 'prop' || entry.type === 'dispenser') && piece
    ? KIND[entry.type].mesh(meshPropsOf(piece, id)) // own materials → live-recolorable, no shared-material bleed
    : entry.mesh.clone(true);                    // clone respects hidden info (face-down card = back only)
  inspectMesh(fresh, { origId: id, type: entry.type });
  entry.mesh.visible = false;
}

function releaseInspect() {
  if (!inspect) return;
  const wasHand = inspect.hid;
  if (inspect.drawn && !inspect.placed && !inspect.hid) room.send('inspectPlace', { where: 'deck' }); // a real drawn card closed without choosing → back to deck
  camera.remove(inspect.pivot); // shares geometry/materials — never dispose
  const entry = inspect.origId && meshes.get(inspect.origId);
  if (entry) entry.mesh.visible = true;
  inspect = null;
  controls.enabled = true;
  byId('inspectHint').hidden = true;
  byId('drawActions').hidden = true;
  const row = byId('inspectColorRow'); if (row) row.hidden = true;
  if (wasHand) renderHand(myHand); // restore the hand we hid for the inspect
}

// Resolve a drawn card to its destination: field-up | field-down | hand | deck.
function placeDrawn(where) {
  if (!inspect) return;
  if (inspect.hid) { // hand-card inspect: play with the chosen face, or keep it in hand
    if (where === 'field-up') room.send('playCard', { hid: inspect.hid, faceDown: false });
    else if (where === 'field-down') room.send('playCard', { hid: inspect.hid, faceDown: true });
    inspect.placed = true; // 'hand' just closes; 'deck' is hidden for hand cards
    releaseInspect();
    return;
  }
  if (!inspect.drawn) return;
  room.send('inspectPlace', { where });
  inspect.placed = true;
  releaseInspect();
}

// Handle a click (no drag). A left-click on an inspectable piece or a deck waits
// briefly for a possible double-click (inspect / draw); everything else fires now.
function handleClick(gesture) {
  const { id, type } = gesture;
  const wantsDouble = (gesture.primary && (INSPECTABLE(type) || type === 'deck')) || (gesture.secondary && type === 'deck');

  if (!wantsDouble) {
    sendAction(gesture.primary ? gesture.kind.lclick : gesture.kind.rclick, id); // secondary / non-inspectable
    return;
  }

  const isSecondClick = pendingClick && pendingClick.id === id && pendingClick.secondary === gesture.secondary && performance.now() - pendingClick.t < CONFIG.input.dblMs;
  if (isSecondClick) {
    clearTimeout(pendingClick.timer);
    pendingClick = null;
    if (gesture.secondary) room.send('splitDeck', { deckId: id });     // double secondary on a deck = split it
    else if (type === 'deck') room.send('drawInspect', { deckId: id }); // double primary on a deck = draw to inspect
    else enterInspect(id);                                             // double primary on a piece = inspect it
  } else {
    if (pendingClick) clearTimeout(pendingClick.timer);
    const single = gesture.primary ? gesture.kind.lclick : gesture.kind.rclick; // deferred single (shuffle for secondary on a deck)
    pendingClick = { id, secondary: gesture.secondary, t: performance.now(), timer: setTimeout(() => { pendingClick = null; sendAction(single, id); }, CONFIG.input.clickMs) };
  }
}
const onPointerDown = (e) => {
  const wasArmed = armedMove; armedMove = null; // Move is one-shot: this press consumes it (if on that piece) or cancels it
  if (measuring) { // Measure mode: left-drag lays the selected overlay (A = press)
    if (e.primary) { const p = overlayPoint(e); if (p) { measureDrag = { ax: p.x, az: p.z }; controls.enabled = false; renderer.domElement.setPointerCapture(e.pointerId); } }
    return;
  }
  if (wbOwning) { // drawing on the whiteboard: start a stroke
    if (e.primary) {
      setPointer(e);
      const uv = wbHitUV();
      if (uv) {
        wbCur = { pts: [uv[0], uv[1]], color: wbTool === 'eraser' ? wbBg() : myColor('#e8e6e0'), width: wbTool === 'eraser' ? 0.03 : 0.005, erase: wbTool === 'eraser' };
        wbActive = true;
        renderer.domElement.setPointerCapture(e.pointerId);
      }
    }
    return;
  }
  if (inspect) { // in inspect mode, a left-drag spins the item (trackball)
    if (e.primary) {
      inspect.drag = { sx: e.clientX, sy: e.clientY, px: e.clientX, py: e.clientY, moved: false };
      renderer.domElement.setPointerCapture(e.pointerId);
    }
    return;
  }
  if (!room || (!e.primary && !e.secondary)) return;
  setPointer(e);
  const id = pickId();
  // Multi-select gesture: the additive modifier (Shift) or the Select tool. Click a piece → toggle
  // it in/out; drag empty felt → marquee box. Consumes the gesture so it never grabs or orbits.
  if (e.primary && (e.additive || selMode)) {
    selGesture = true;
    controls.enabled = false;
    renderer.domElement.setPointerCapture(e.pointerId);
    if (id) { selToggle(id); }
    else { marquee = { sx: e.clientX, sy: e.clientY, add: e.additive || selMode }; showMarquee(e.clientX, e.clientY, e.clientX, e.clientY); } // Select tool (touch) adds by default; Shift adds on desktop
    down = null; return;
  }
  if (!id) { // no piece under the cursor
    if (e.primary) {
      const oid = pickOverlay(), oo = oid && room.state.overlays.get(oid);
      if (oid && canEditOverlay(oo)) { // left-click an overlay you own (or GM) → select + drag to move
        selectOverlay(oid);
        const p = overlayPoint(e);
        overlayMove = { id: oid, gx: p ? p.x : 0, gz: p ? p.z : 0, x: oo.x, z: oo.z, x2: oo.x2, z2: oo.z2, moved: false };
        controls.enabled = false; renderer.domElement.setPointerCapture(e.pointerId);
        down = null; return;
      }
      selectOverlay(null); // left-click empty felt → deselect
      clearSelection();    // …and drop any multi-selection (design-tool convention)
    }
    down = null; return; // empty felt → let OrbitControls orbit/pan
  }
  const type = meshes.get(id).type;
  // A left-drag on a SELECTED piece moves the whole selection; dragging an unselected piece drops
  // the selection first (design-tool convention). Right-drag (decks) is never a group move.
  const group = e.primary && selection.has(id);
  if (e.primary && !selection.has(id)) clearSelection();
  down = { id, type, kind: KIND[type], touch: e.touch, forceMove: wasArmed === id, primary: e.primary, secondary: e.secondary, sx: e.clientX, sy: e.clientY, dragging: false, grabbed: false, snap: pieceSnap(id), group };
  controls.enabled = false; // this gesture belongs to the piece
  dragHeight = GRAB_HEIGHT; // the lift offset; XZ tracks the fixed ground plane
  renderer.domElement.setPointerCapture(e.pointerId);
};

// wheel (raise/lower a held piece) → public/controls.js → INPUT.raiseAxis

const onPointerMove = (e) => {
  if (marquee) { showMarquee(marquee.sx, marquee.sy, e.clientX, e.clientY); return; } // painting a selection box
  if (measuring) { // live local preview of the overlay being dragged out
    if (measureDrag) {
      const p = overlayPoint(e);
      if (p) {
        drawPreview(measureDrag.ax, measureDrag.az, p.x, p.z);
        const now = performance.now();
        if (now - lastDragSent > 55) { lastDragSent = now; room.send('overlayDrag', overlayAddMsg(measureDrag.ax, measureDrag.az, p.x, p.z)); } // let others watch it form
      }
    }
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
  if (overlayMove) { // dragging a selected overlay: translate both ends, synced (throttled)
    const p = overlayPoint(e);
    if (p) {
      const dx = p.x - overlayMove.gx, dz = p.z - overlayMove.gz;
      if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) overlayMove.moved = true;
      const now = performance.now();
      if (now - lastDragSent > 55) { lastDragSent = now; room.send('overlayMove', { id: overlayMove.id, x: overlayMove.x + dx, z: overlayMove.z + dz, x2: overlayMove.x2 + dx, z2: overlayMove.z2 + dz }); }
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
    const movesThis = down.forceMove || (kind.grab === 2 ? down.secondary : down.primary); // this kind's move button — or an armed touch "Move"
    if (movesThis) { // the button that moves this kind (2 = deck, 0 = most)
      down.grabbed = true;
      heldTarget.copy(hit); prevTarget.copy(hit); prevThrowTime = performance.now(); throwVel.set(0, 0, 0);
      if (down.group) room.send('grabGroup', { ids: [...selection], anchor: down.id }); // claim the whole selection
      else room.send('grab', { id: down.id });
      playSfx(pieceIsTile(down.id) ? (down.type === 'deck' ? 'tiledeck-pickup' : 'tile-pickup') : (sfxKind(down.type) + '-pickup')); // local, per object type (tiles/tile-boxes get their own)
      { const t = snapXZ(hit.x, hit.z); if (down.group) room.send('moveGroup', { x: t.x, y: hit.y, z: t.z }); else room.send('move', { id: down.id, x: t.x, y: hit.y, z: t.z }); }
    } else if (down.primary && (kind.ldrag === 'deal' || kind.ldrag === 'dispense')) {
      // Left-drag spawns one item and carries it out: a card off a deck, or a chip/stone
      // off a dispenser. Both reuse the server's "adopt the spawned piece" flow (see 'dealt').
      const dealing = kind.ldrag === 'deal';
      down.pendingDeal = true;
      down.adoptType = dealing ? 'card' : 'prop'; // what the carried piece becomes on adoption
      dragHeight = DECK_DRAG_HEIGHT; // lift above the source so the new piece doesn't fight its collider
      ray.setFromCamera(pointer, camera);
      ray.ray.intersectPlane(dragPlane, hit);
      hit.y = dragHeight;
      heldTarget.copy(hit); prevTarget.copy(hit); prevThrowTime = performance.now(); throwVel.set(0, 0, 0);
      if (dealing) room.send('dealDrag', { deckId: down.id, x: hit.x, y: hit.y, z: hit.z });
      else room.send('dispenseDrag', { id: down.id, x: hit.x, y: hit.y, z: hit.z });
      playSfx(dealing ? (pieceIsTile(down.id) ? 'tile-pickup' : 'card-pickup') : 'object-pickup'); // the new piece's drop follows on release
    }
  }

  if (down.grabbed) {
    heldTarget.copy(hit);
    const now = performance.now(), dt = (now - prevThrowTime) / 1000;
    if (dt > 0 && dt < 0.1) throwVel.lerp(hit.clone().sub(prevTarget).multiplyScalar(1 / dt), 0.4); // smooth the hand speed
    prevTarget.copy(hit); prevThrowTime = now;
    if (now - lastMoveSent > 16) { const t = snapXZ(hit.x, hit.z); if (down.group) room.send('moveGroup', { x: t.x, y: hit.y, z: t.z }); else room.send('move', { id: down.id, x: t.x, y: hit.y, z: t.z }); lastMoveSent = now; } // ~60Hz throttle
  }
};
const endGesture = e => {
  if (selGesture) { // finish a shift/select gesture: commit the marquee box, then hand control back
    if (marquee) { finalizeMarquee(marquee.sx, marquee.sy, e.clientX, e.clientY, marquee.add); hideMarquee(); marquee = null; }
    selGesture = false;
    try { renderer.domElement.releasePointerCapture(e.pointerId); } catch {}
    controls.enabled = !inspect;
    return;
  }
  if (measuring) { // release: commit the overlay if the drag was long enough
    if (measureDrag) {
      const p = overlayPoint(e);
      if (p) { const len = Math.hypot(p.x - measureDrag.ax, p.z - measureDrag.az); if (len >= MEASURE.minDrag) room.send('overlayAdd', overlayAddMsg(measureDrag.ax, measureDrag.az, p.x, p.z)); }
      measureDrag = null; clearPreview(); controls.enabled = true;
      room.send('overlayDrag', {}); // drop everyone else's live preview of my drag
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
  if (overlayMove) { // release a moved overlay: commit its final position
    const p = overlayPoint(e);
    if (p && overlayMove.moved) { const dx = p.x - overlayMove.gx, dz = p.z - overlayMove.gz; room.send('overlayMove', { id: overlayMove.id, x: overlayMove.x + dx, z: overlayMove.z + dz, x2: overlayMove.x2 + dx, z2: overlayMove.z2 + dz }); }
    overlayMove = null; controls.enabled = true;
    try { renderer.domElement.releasePointerCapture(e.pointerId); } catch {}
    return;
  }
  if (!down) return;
  if (down.grabbed) {
    const throwVector = down.kind.grab === 2 ? [0, 0, 0] : [throwVel.x, throwVel.y, throwVel.z]; // decks don't fly
    if (down.group) room.send('releaseGroup', { v: throwVector });
    else room.send('release', { id: down.id, v: throwVector });
  } else if (!down.dragging) { // a click / tap
    handleClick(down);
  }
  controls.enabled = !inspect; // stay disabled if this click just entered inspect
  try { renderer.domElement.releasePointerCapture(e.pointerId); } catch {}
  down = null;
};
// pointerdown / pointermove / pointerup / pointercancel → public/controls.js → INPUT.press / move / release
// dblclick (claim the whiteboard) → public/controls.js → INPUT.doubleClick

// The piece to act on for a keyboard shortcut: the held one, else whatever's hovered.
const heldOrHoveredId = () => (down && down.id) || pickId();

// Keyboard shortcuts (ignored while typing in an input). Delete/Backspace removes
// a piece, U toggles its upright/flat behaviour, G toggles its snap-to-grid, S saves
// a hovered deck.
const onKeyDown = (e) => {
  if (!room) return;
  if (e.key === 'Escape' && trayView) { closeTray(); return; }
  if (e.key === 'Escape' && selMode) { setSelMode(false); return; } // exit the Select tool first
  if (e.key === 'Escape' && selection.size) { clearSelection(); return; } // …then clear a selection
  if (e.key === 'Escape' && measuring) { const r = byId('regionTR'); if (r && r._close) r._close(); else exitMeasure(); return; }
  if (e.key === 'Escape' && wbOwning) { room.send('wbRelease'); return; }
  if (e.key === 'Escape' && inspect) { releaseInspect(); return; }
  if (e.key === 'Escape' && selOverlayId) { selectOverlay(null); return; }
  if (inspect && inspect.drawn) { // f/d/h/r place a drawn card
    const where = { f: 'field-up', d: 'field-down', h: 'hand', r: 'deck' }[e.key.toLowerCase()];
    if (where) { placeDrawn(where); return; }
  }
  const typing = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
  if (typing) return;

  // Multi-select batch ops — act on the whole selection (dice/cards ops hit only the matching kind).
  if (selection.size) {
    const ids = [...selection], k = e.key.toLowerCase();
    if (k === 'u') { room.send('setStandGroup', { ids }); return; }   // stand / lie flat, as a unit
    if (k === 'g') { room.send('setSnapGroup', { ids }); return; }    // snap-to-grid, as a unit
    if (e.key === '[') { room.send('rotateGroup', { ids, dir: -1 }); return; } // rotate the formation −45°
    if (e.key === ']') { room.send('rotateGroup', { ids, dir: 1 }); return; }  // rotate the formation +45°
    if (k === 'r') { room.send('rollGroup', { ids }); return; }       // roll every die in the selection
    if (k === 'f') { room.send('flipGroup', { ids }); return; }       // flip every card in the selection
    if (k === 'h') { room.send('takeGroup', { ids }); return; }       // take every card into your hand
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (e.key === 'Backspace') e.preventDefault();
    if (selOverlayId) { room.send('overlayRemove', { id: selOverlayId }); selectOverlay(null); return; } // a selected overlay takes priority
    if (selection.size) { room.send('removeGroup', { ids: [...selection] }); clearSelection(); return; } // delete the whole multi-selection
    const id = heldOrHoveredId();
    if (id) {
      room.send('remove', { id });
      if (down && down.id === id) { down = null; controls.enabled = true; }
    }
  } else if (e.key === 'u' || e.key === 'U') { // toggle keep-upright / lie-flat
    const id = heldOrHoveredId();
    if (id) room.send('setStand', { id });
  } else if (e.key === 'g' || e.key === 'G') { // toggle snap-to-grid for this piece
    const id = heldOrHoveredId();
    if (id) room.send('setSnap', { id });
  } else if (e.key === 's' || e.key === 'S') { // save a hovered deck to the shared library
    const id = heldOrHoveredId();
    if (id && meshes.get(id).type === 'deck') {
      const name = prompt('Save this deck as:');
      if (name && name.trim()) room.send('saveDeck', { deckId: id, name: name.trim() });
    }
  } else if ((e.key === 'p' || e.key === 'P') && !e.repeat) { // ping the table at the cursor
    sendPing();
  }
};

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
  const mesh = KIND[piece.type].mesh(meshPropsOf(piece, id));
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
const dropPreview = (m) => { if (!m) return; scene.remove(m); m.geometry && m.geometry.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x && x.dispose()); };
let handClickTimer = null; // a pending single-click play, cancelled if a double-click (inspect) follows
const HAND_HOVER = 0.6; // the drag preview floats this high above the felt so it clears boards/tiles (e.g. Wordy)
function inspectHandCard(card) { inspectMesh(cardMesh({ front: card.front, back: card.back, geom: card.geom, tile: card.tile }), { drawn: true, type: 'card', hid: card.hid }); byId('hand').style.display = 'none'; } // hide the hand behind the inspect view
const touchIds = new Set(); // active touch pointers → a hand drag reads this: 1 finger = face-down, 2 = face-up
addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') return; touchIds.add(e.pointerId); if (handDrag && handDrag.touch) handDrag.faceDown = touchIds.size < 2; }, true); // a 2nd finger (even a still tap) → face-up
addEventListener('pointerup', (e) => touchIds.delete(e.pointerId), true);
addEventListener('pointercancel', (e) => touchIds.delete(e.pointerId), true);

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
  if (e.pointerId !== handDrag.pointerId) return; // only the finger that armed the drag drives it
  if (!handDrag.dragging) {
    if (Math.hypot(e.clientX - handDrag.sx, e.clientY - handDrag.sy) < CONFIG.input.handPx) return;
    handDrag.dragging = true;
    byId('hand').classList.add('hand-dragging'); // hide the hand while dragging so it doesn't obscure the table
    document.body.style.userSelect = document.body.style.webkitUserSelect = 'none'; // stop the text-selection sweep
    const selection = window.getSelection && window.getSelection();
    if (selection) selection.removeAllRanges();
    // A real (local, unsynced) card mesh that rides the table under the pointer — same look as a played card.
    const d = handDrag;
    const mesh = cardMesh({ front: d.front, back: d.back, geom: d.geom, tile: d.tile });
    mesh.renderOrder = 6;
    scene.add(mesh);
    handDrag.mesh = mesh;
  }
  if (handDrag.touch) handDrag.faceDown = touchIds.size < 2; // live-flip the face as fingers change during the drag
  if (handDrag.mesh) handDrag.mesh.rotation.x = handDrag.faceDown ? Math.PI : 0; // face-down shows the back
  setPointer(e);
  ray.setFromCamera(pointer, camera);
  if (ray.ray.intersectPlane(dragPlane, hit)) handDrag.mesh.position.set(hit.x, HAND_HOVER, hit.z); // hover above the felt so the card clears boards/tiles
});
addEventListener('pointerup', e => {
  if (!handDrag) return;
  if (e.pointerId !== handDrag.pointerId) return; // only the arming finger ends the drag/tap
  const drag = handDrag;
  handDrag = null;
  document.body.style.userSelect = document.body.style.webkitUserSelect = ''; // re-enable selection
  dropPreview(drag.mesh); // discard the local preview
  if (!drag.dragging) { const d = drag; clearTimeout(handClickTimer); handClickTimer = setTimeout(() => room.send('playCard', { hid: d.hid, faceDown: d.faceDown }), 240); return; } // click = quick play (delayed so a double-click inspects instead)
  if (document.elementFromPoint(e.clientX, e.clientY) !== renderer.domElement) { byId('hand').classList.remove('hand-dragging'); return; } // dropped on UI → cancel, reveal the hand
  setPointer(e);
  ray.setFromCamera(pointer, camera);
  ray.ray.intersectPlane(dragPlane, hit); // where on the table
  room.send('playCard', { hid: drag.hid, faceDown: drag.faceDown, x: hit.x, z: hit.z });
});
addEventListener('pointercancel', (e) => { // a cancelled drag must still discard its preview
  if (!handDrag || e.pointerId !== handDrag.pointerId) return;
  dropPreview(handDrag.mesh);
  handDrag = null;
  byId('hand').classList.remove('hand-dragging');
  document.body.style.userSelect = document.body.style.webkitUserSelect = '';
});

function renderHand(cards) {
  const el = byId('hand');
  el.innerHTML = '';
  el.classList.remove('collapsed');
  el.classList.remove('hand-dragging'); // a fresh render (after a play/cancel) reveals the hand
  if (handCollapsed && cards.length && !selectMode) { // hidden: show only a peek tab (never while picking cards to show)
    el.classList.add('collapsed');
    const tab = document.createElement('button');
    tab.className = 'handToggle';
    tab.dataset.icon = 'cards square-chevron-up';
    tab.setAttribute('aria-label', `Show hand (${cards.length})`);
    tab.onclick = () => setHandCollapsed(false);
    el.appendChild(tab); applyIcons(el);
    el.style.display = 'flex';
    return;
  }
  const scroll = document.createElement('div'); scroll.className = 'handScroll'; // horizontally scrollable card strip
  for (const card of cards) {
    const div = document.createElement('div');
    div.className = 'handcard';
    const cf = parseCardFront(card.front);
    if (cf.kind === 'rank') {
      div.textContent = cf.rank + cf.suit;
      div.style.color = cf.color || '#111';
    } else if (cf.kind === 'text' || cf.kind === 'joker' || cf.kind === 'domino' || cf.kind === 'letter') {
      div.classList.add('img'); // render the same texture the table uses (wrapped text / joker / domino / letter face)
      if (cf.kind === 'domino') div.classList.add('tile'); // a domino slot is 1:2, so the tile fills it without clipping
      if (cf.kind === 'letter') div.classList.add('tileSq'); // a letter tile is square
      const u = cardPreviewURL(card.front);
      if (u) div.style.backgroundImage = `url("${u}")`;
    } else if (cf.kind === 'image') {
      div.classList.add('img');
      if (card.geom && card.geom.shape === 'hex') div.classList.add('shape-hex'); // match the tabletop silhouette
      else if (card.geom && card.geom.round === 0) div.classList.add('shape-square');
      div.style.backgroundImage = `url("${cf.ref}")`; // uploaded/file card art
    }
    div.title = 'Left drag/click: face-down · Right drag/click: face-up';
    div.oncontextmenu = ev => ev.preventDefault(); // right-click is handled by the pointer events
    if (selectMode && selected.has(card.hid)) div.classList.add('sel');
    div.addEventListener('pointerdown', ev => {
      if (handDrag) return; // a drag is already in progress (e.g. a second finger) — don't re-arm
      if (selectMode) { // picking cards to show — toggle instead of playing
        if (ev.button !== 0) return;
        ev.preventDefault();
        if (selected.has(card.hid)) { selected.delete(card.hid); div.classList.remove('sel'); }
        else { selected.add(card.hid); div.classList.add('sel'); }
        return;
      }
      if (ev.button === 0 || ev.button === 2) {
        ev.preventDefault();
        handDrag = { hid: card.hid, faceDown: ev.button !== 2, touch: ev.pointerType === 'touch', pointerId: ev.pointerId, front: card.front, back: card.back, geom: card.geom, tile: card.tile, sx: ev.clientX, sy: ev.clientY, dragging: false, mesh: null }; // mouse: left=down, right=up. touch: 1 finger=down, 2=up (set live from touchIds)
      }
    });
    div.ondblclick = () => { clearTimeout(handClickTimer); inspectHandCard(card); }; // desktop: double-click to inspect
    const eye = document.createElement('button'); eye.className = 'cardEye'; eye.setAttribute('aria-label', 'Inspect card');
    setIcon(eye, 'eye');
    eye.addEventListener('pointerdown', (ev) => ev.stopPropagation()); // tapping the eye must not arm a drag
    eye.onclick = (ev) => { ev.stopPropagation(); inspectHandCard(card); };
    div.appendChild(eye);
    scroll.appendChild(div);
  }
  const mkChev = (dir, icon, label) => { const b = document.createElement('button'); b.className = 'handScrollBtn'; b.setAttribute('aria-label', label); setIcon(b, icon); b.onclick = () => scroll.scrollBy({ left: dir * scroll.clientWidth * 0.7, behavior: 'smooth' }); return b; };
  const leftChev = mkChev(-1, 'square-chevron-left', 'Scroll left');
  const rightChev = mkChev(1, 'square-chevron-right', 'Scroll right');
  el.append(leftChev, scroll, rightChev);
  const syncChevrons = () => { const sc = scroll.scrollWidth > scroll.clientWidth + 2; leftChev.hidden = rightChev.hidden = !sc; if (sc) { leftChev.disabled = scroll.scrollLeft <= 0; rightChev.disabled = scroll.scrollLeft >= scroll.scrollWidth - scroll.clientWidth - 2; } };
  scroll.addEventListener('scroll', syncChevrons); requestAnimationFrame(syncChevrons);
  if (cards.length && !selectMode) { // a small handle to hide the hand from your view
    const hide = document.createElement('button');
    hide.className = 'handToggle hide';
    setIcon(hide, 'square-chevron-down');
    hide.setAttribute('aria-label', 'Hide your hand');
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
  positionTrays();      // personal trays ride the same track — keep them glued to the edge on resize
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
  myRank = rankOf(role);
  const rank = myRank;
  const gate = (id, min) => { const el = byId(id); if (el) el.hidden = rank < min; };
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
  layoutToolsMenu(); // Whiteboard just changed visibility → re-balance the 2-column Tools grid
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
  const mk = makeButton;
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
// makePlayerTexture / nameTag / makeYouChipTexture (the seat marker, held-piece
// name tag, and "YOU" chip textures) live in graphics.js with the other canvas
// texture builders; this file just places what they return in the scene.

// Floating name tags over held pieces — everyone sees who's moving what. Created
// and torn down as ownership changes; the render loop keeps each one over its
// piece. Own pieces get no tag (you know it's you), matching the seat markers.
const heldLabels = new Map(); // pieceId -> THREE.Sprite
function updateHeldLabel(id, owner) {
  const existing = heldLabels.get(id);
  if (existing) {
    disposeSprite(existing);
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

// Hover readout: a small tooltip over the deck or dispenser under the cursor showing
// how many are left inside (∞ for the infinite go bowl). Pure client-side, shown only
// when idle (not mid-drag / inspect / draw / measure), and kept live by the render loop
// so it updates as a piece is dealt or dispensed without moving the cursor.
const hoverTip = document.createElement('div');
hoverTip.id = 'hoverCount'; hoverTip.hidden = true;
document.body.appendChild(hoverTip);
let hoverId = null, lastHover = 0;
const hoverIdle = () => !down && !inspect && !measuring && !wbOwning && !overlayMove && !handDrag && !measureDrag;
function countLabel(piece) {
  if (piece.type === 'deck') return `${piece.count} card${piece.count === 1 ? '' : 's'}`;
  const d = DISPENSERS[JSON.parse(piece.props || '{}').disp];
  if (!d) return null;
  return d.infinite ? '∞' : String(piece.count); // bowl = unlimited
}
function hideHoverTip() { if (!hoverTip.hidden) hoverTip.hidden = true; hoverId = null; }
renderer.domElement.addEventListener('pointermove', e => {
  if (!room || !hoverIdle()) { hideHoverTip(); return; }
  hoverTip.style.left = e.clientX + 'px'; hoverTip.style.top = e.clientY + 'px'; // follow the cursor every move
  const now = performance.now();
  if (now - lastHover < 40) return; // throttle the raycast/pick
  lastHover = now;
  setPointer(e);
  const id = pickId();
  const piece = id && room.state.pieces.get(id);
  if (!piece || (piece.type !== 'deck' && piece.type !== 'dispenser')) { hideHoverTip(); return; }
  const text = countLabel(piece); if (text == null) { hideHoverTip(); return; }
  hoverId = id; hoverTip.textContent = text; hoverTip.hidden = false;
});
renderer.domElement.addEventListener('pointerleave', hideHoverTip);
renderer.domElement.addEventListener('pointerdown', hideHoverTip); // a gesture begins → drop the readout

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
let lastDragSent = 0;            // throttle for live-drag broadcast + overlay move
const dragPreviews = new Map();  // other players' in-progress measurements: sessionId -> { group, label }
let selOverlayId = null;         // selected overlay (click to select → move / Delete)
let selHandles = null;           // white handle rings marking the selected overlay's A/B points
let overlayMove = null;          // { id, gx, gz, x, z, x2, z2, moved } while dragging a selected overlay

// Only the creator (or a GM) may move/remove an overlay — mirrors the server gate.
function canEditOverlay(o) { return !!o && (o.owner === mySession || myRank >= 2); }
// Ray-pick the overlay whose geometry is under the cursor (labels/handles excluded).
function pickOverlay() {
  ray.setFromCamera(pointer, camera);
  let best = null, bestDist = Infinity;
  for (const [id, e] of overlayObjs) {
    const hits = ray.intersectObject(e.group, true);
    if (hits.length && hits[0].distance < bestDist) { bestDist = hits[0].distance; best = id; }
  }
  return best;
}
// Highlight the selected overlay with a small white ring at each of its A/B points.
function selectOverlay(id) {
  if (selHandles) { scene.remove(selHandles); disposeGroup(selHandles); selHandles = null; }
  selOverlayId = (id && overlayObjs.has(id)) ? id : null;
  if (!selOverlayId) return;
  const o = room.state.overlays.get(selOverlayId); if (!o) { selOverlayId = null; return; }
  const g = new THREE.Group();
  for (const [px, pz] of [[o.x, o.z], [o.x2, o.z2]]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.2, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(px, boardTopY + MEASURE.lift + 0.02, pz); ring.renderOrder = 7;
    g.add(ring);
  }
  scene.add(g); selHandles = g;
}
function clearDragPreview(sid) {
  const e = dragPreviews.get(sid); if (!e) return;
  scene.remove(e.group); disposeGroup(e.group);
  if (e.label) disposeSprite(e.label);
  dragPreviews.delete(sid);
}

// The overlayAdd payload for the current kind: A→B always, plus the extra scalar
// each template needs (cone's angle, line's width) so it survives save/reload.
function overlayAddMsg(ax, az, bx, bz) {
  const m = { kind: measureKind, x: ax, z: az, x2: bx, z2: bz };
  if (measureKind === 'cone') m.ang = MEASURE.coneAngle;
  if (measureKind === 'line') m.w = MEASURE.lineWidth;
  return m;
}

function myColor(fallback = '#ffffff') { const p = room && room.state.players.get(mySession); return (p && p.color) || fallback; }
function overlayLabelSprite(text, color, mx, mz) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTag(text, color), transparent: true, depthTest: false }));
  s.scale.set(CONFIG.label.w, CONFIG.label.h, 1);
  s.position.set(mx, boardTopY + MEASURE.labelLift, mz);
  s.renderOrder = 6;
  return s;
}
function overlayText(o) { return formatMeasure(Math.hypot(o.x2 - o.x, o.z2 - o.z), room.state.scale); }
function disposeGroup(g) { g.traverse(n => { if (n.isMesh) { n.geometry.dispose(); n.material.dispose(); } }); }
// Tear down a label/name-tag sprite: pull it from the scene and free its texture + material.
function disposeSprite(sprite) { scene.remove(sprite); sprite.material.map.dispose(); sprite.material.dispose(); }
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
  if (id === selOverlayId) selectOverlay(id); // rebuilt (e.g. moved) — reposition its handles
}
function removeOverlay(id) {
  const e = overlayObjs.get(id); if (!e) return;
  scene.remove(e.group); disposeGroup(e.group);
  if (e.label) disposeSprite(e.label);
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
  if (previewLabel) { disposeSprite(previewLabel); previewLabel = null; }
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
  selectOverlay(null); // measuring and editing are separate modes
  renderer.domElement.classList.add('measuring');
  const b = byId('measureBtn'); if (b) b.classList.add('on');
}
function exitMeasure() {
  if (!measuring) return;
  measuring = false; measureDrag = null; clearPreview();
  if (room) room.send('overlayDrag', {}); // clear any in-progress preview others may see
  renderer.domElement.classList.remove('measuring');
  const b = byId('measureBtn'); if (b) b.classList.remove('on');
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
  chip.rotation.x = -Math.PI / 2;          // lie flat on the felt
  chip.rotation.z = seatAngle(mySeat);     // spin it to face MY seat, so "YOU" reads upright from any seat (not just the front)
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
  if (s.dark !== wbLast.dark) { wbLast.dark = s.dark; if (wbGroup) redrawStrokes(); } // recolor + replay
  if (s.owner !== wbLast.owner) { wbLast.owner = s.owner; if (s.owner === mySession) enterWbDraw(); else exitWbDraw(); }
  wbLast.angle = s.angle;
}

// --- Dice tray (Phase 1: placement) — a physics-backed box on the same track as the ---
// whiteboard. This is only the visual + placement; the walls/dice live server-side. Built
// from the shared trayMesh so the picture matches the collider; parked at the tray's track
// position and rotated by its angle (Three's rotation.y matches the server's trayPlace).
// Personal trays: one mesh per enabled seat, on the track behind that seat. `state.trays`
// (seat → true) drives which are shown; each sits at its seat angle (matching the server walls).
const trayGroups = new Map(); // seat -> THREE.Group
function trayGroupFor(seat) {
  const g = trayMesh(room.state.feltColor);
  const a = seatAngle(seat), c = trayCenter(a, room.state.tableX, room.state.tableZ);
  g.position.set(c.x, 0, c.z); g.rotation.y = a; // Three's rotation.y matches the server's trayPlace
  scene.add(g); return g;
}
function positionTrays() { // keep every tray glued to the track on table resize
  if (!room) return;
  for (const [seat, g] of trayGroups) {
    const a = seatAngle(seat), c = trayCenter(a, room.state.tableX, room.state.tableZ);
    g.position.set(c.x, 0, c.z); g.rotation.y = a;
  }
}
function syncTrays(trays) {
  if (!room) return;
  const want = new Set();
  if (trays) trays.forEach((on, seat) => { if (on) want.add(+seat); });
  for (const seat of want) if (!trayGroups.has(seat)) trayGroups.set(seat, trayGroupFor(seat)); // add newly-shown
  for (const [seat, g] of [...trayGroups]) if (!want.has(seat)) { scene.remove(g); trayGroups.delete(seat); } // drop put-away
  const mineOut = want.has(mySeat);
  if (mineOut && pendingTrayOpen) { pendingTrayOpen = false; openTray(); } // my tray just appeared (I pressed Roll) → hop in
  if (!mineOut && trayView) closeTray();                                    // my tray was put away → leave the view
}

// --- Camera transport: the Roll button hops YOUR view to a top-down look at YOUR tray; Back ---
// (or Esc) returns. Purely local — nobody else's camera or the play field moves.
const TRAY_CAM = { height: 12, back: 5, dur: 550 };   // height over the tray, how far back toward the player, tween ms
let trayView = false, trayCamSave = null, camTween = null, pendingTrayOpen = false;
// The camera pose looking down into MY tray, approached from BEHIND my seat (the outward
// direction) so the view is oriented the same way I see the table — left/right and near/far
// match my seat for every seat, instead of a fixed world orientation (which read 180°/90° off
// for anyone not facing +Z). The slight `back` offset gives the look vector a horizontal
// component, so screen-up lands on the table side consistently.
function trayCamPose() {
  const a = seatAngle(mySeat);
  const c = trayCenter(a, room.state.tableX, room.state.tableZ);
  const ox = Math.sin(a), oz = Math.cos(a); // outward: from table centre toward my seat/tray
  return { pos: new THREE.Vector3(c.x + ox * TRAY_CAM.back, TRAY_CAM.height, c.z + oz * TRAY_CAM.back),
           target: new THREE.Vector3(c.x, 0, c.z) };
}
function startCamTween(pose, onDone) {
  camTween = { fromPos: camera.position.clone(), toPos: pose.pos.clone(),
               fromTarget: controls.target.clone(), toTarget: pose.target.clone(),
               start: performance.now(), dur: TRAY_CAM.dur, onDone };
  controls.enabled = false; // the tween drives the camera; hand control back when it lands
}
function aimTray(instant) {
  const pose = trayCamPose();
  if (instant) { camera.position.copy(pose.pos); controls.target.copy(pose.target); controls.update(); }
  else startCamTween(pose, () => { controls.enabled = true; controls.target.copy(pose.target); controls.update(); });
}
function openTray() {
  if (!room || !room.state.trays) return;
  if (!room.state.trays.get(String(mySeat))) {          // my tray isn't out yet → place my own, then hop in
    pendingTrayOpen = true; room.send('trayShow', { on: true });
    return;
  }
  if (!trayView) trayCamSave = { pos: camera.position.clone(), target: controls.target.clone() };
  trayView = true;
  const tt = byId('trayTools'); if (tt) tt.hidden = false;
  aimTray(false);
}
function putTrayAway() { if (room) room.send('trayShow', { on: false }); } // removes my tray + its dice (closeTray fires when it's gone)
function closeTray() {
  if (!trayView) return;
  trayView = false;
  const tt = byId('trayTools'); if (tt) tt.hidden = true;
  const save = trayCamSave;
  if (save) startCamTween({ pos: save.pos, target: save.target }, () => { controls.enabled = true; controls.target.copy(save.target); controls.update(); trayCamSave = null; });
  else controls.enabled = true;
}

// --- drawing: strokes are [x0,y0,x1,y1,...] in canvas-normalized [0,1] (y top-down) ---
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
  { const tm = byId('turnMini'); if (tm) { // compact turn indicator for the collapsed rail
    let t = '';
    if (room.state.turnPending) t = '\u23F3 ' + room.state.turnPending;
    else if (room.state.turn) { const p = room.state.players.get(room.state.turn); t = room.state.turn === mySession ? 'Your turn' : (p && p.name ? p.name + "'s turn" : 'In play'); }
    tm.textContent = t;
  } }
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
    } else { // color is a server palette value
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

// Pulse the Members button in the accent color while any join is pending, so a
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
  const myRank = rankOf(me ? me.role : 'player');
  const btn = makeButton;
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
        else {
          acts.appendChild(btn('Helper', () => room.send('setRole', { userId: m.userId, role: 'helper' }), null, 'user-down')); // demote GM -> Helper (down)
          acts.appendChild(btn('Player', () => room.send('setRole', { userId: m.userId, role: 'player' })));                     // demote GM -> Player
        }
      }
      if (m.role !== 'gm' || myRank >= 3) acts.appendChild(btn('Kick', () => room.send('kick', { userId: m.userId })));
    }
    li.appendChild(acts);
    ul.appendChild(li);
  }
  applyIcons(ul);
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

// ===== Multi-select (Phase 1): a LOCAL selection set + on-felt highlight. Two gestures feed it —
// a Shift modifier and a Select tool — and neither touches synced state (selection is personal,
// like a cursor). Moving/deleting the group comes in later phases.
const selection = new Set();     // selected piece ids (mine only)
let selMode = false;             // the Select tool is active → a felt drag boxes instead of orbiting
let marquee = null;              // { sx, sy, add } while boxing; null otherwise
let selGesture = false;          // a shift/select pointer gesture is in progress (so pointerup finalizes it)
const selRings = new Map();      // id -> highlight ring mesh (pooled)
const SEL_COLOR = '#c9a25a';     // fallback if the accent var isn't a valid hex
// MY UI accent colour (the one chosen in the lobby, stored as the `--accent` CSS var). The
// selection is private to me, so it's tinted with my own accent.
const selColor = () => {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v : SEL_COLOR;
};

const selectable = (id) => { const e = meshes.get(id); return !!e && PHYS[e.type].mass > 0; }; // static boards can't be selected
function selToggle(id) { if (!selectable(id)) return; if (selection.has(id)) selection.delete(id); else selection.add(id); }
function clearSelection() { selection.clear(); }
// The color options for ONE selected piece: dice + general props are freeform (the general
// palette); coins are metals; team pieces pick a set. Returns { sig, team, swatches } — `sig`
// is a canonical string so a whole selection can be checked for agreement — or null if the
// piece isn't recolorable (cards). Dice fold in with general props (any color, 'free').
function selColorDesc(piece) {
  if (piece.type === 'die') return { sig: 'free', team: false, swatches: PALETTE };
  if (piece.type !== 'prop' && piece.type !== 'dispenser') return null;   // cards, etc.
  let props; try { props = JSON.parse(piece.props || '{}'); } catch { props = {}; }
  const dispDef = piece.type === 'dispenser' ? DISPENSERS[props.disp] : null;
  const opt = recolorPalette(piece.type, props, dispDef);
  if (!opt) return null;
  const key = opt.swatches.map(s => s.hex).join(',');
  const sig = opt.team ? 'team:' + key : (opt.free ? 'free' : 'pal:' + key);
  return { sig, team: opt.team, swatches: opt.swatches };
}
// The palette shared by the WHOLE selection, for the recolor bar:
//   null            → nothing recolorable is selected (all cards) → hide the bar
//   { mixed:true }  → recolorable pieces disagree (e.g. a coin + a token) → show the bar disabled
//   { sig,team,swatches } → they all share one palette → show those swatches
function selectionPalette() {
  let common = null;
  for (const id of selection) {
    const piece = room.state.pieces.get(id); if (!piece) continue;
    const desc = selColorDesc(piece); if (!desc) continue;               // ignore non-colorable (they'd be skipped anyway)
    if (!common) common = desc;
    else if (desc.sig !== common.sig) return { mixed: true };
  }
  return common;
}
// Recolor the whole selection to a freeform/palette color (Neutral → the neutral tint). Dice
// numbers auto-contrast; the server applies the color only where it fits.
function recolorSelColor(hex) {
  if (!selection.size || !room) return;
  const color = hex == null ? COLORS.neutralProp : hex;
  room.send('recolorGroup', { ids: [...selection], color, textColor: readableInk(color) });
}
// Recolor a team-only selection by switching every piece to set 0/1.
function recolorSelTeam(i) {
  if (!selection.size || !room) return;
  room.send('recolorGroup', { ids: [...selection], team: i ? 1 : 0 });
}
// Rebuild the recolor bar to match the current selection: the shared palette's swatches when the
// selection agrees, a disabled "mixed" state when it doesn't, hidden when nothing's recolorable.
let selBarSig = null;                                                     // last-rendered state, to avoid rebuilding every frame
function refreshSelTools() {
  const abar = byId('selActions'); if (abar) abar.hidden = !selection.size; // batch-op bar shows for any selection (also in the editor, which has no recolor bar)
  const bar = byId('selRecolor'); if (!bar) return;
  const desc = selection.size ? selectionPalette() : null;
  const sig = !selection.size ? '' : !desc ? 'none' : desc.mixed ? 'mixed' : desc.sig;
  bar.hidden = !selection.size || sig === 'none';                        // no selection, or nothing colorable → hide
  if (bar.hidden) { selBarSig = null; return; }
  if (sig === selBarSig) return;                                         // unchanged → keep the DOM
  selBarSig = sig;
  const row = byId('selSwatches'), note = byId('selNote'); if (row) row.innerHTML = '';
  if (sig === 'mixed') {
    bar.classList.add('disabled');
    if (note) note.textContent = 'Mixed selection — recolor unavailable';
    return;
  }
  bar.classList.remove('disabled');
  if (note) note.textContent = 'Recolor selection';
  if (row) desc.swatches.forEach((s, i) => {
    const chip = document.createElement('button');
    chip.type = 'button'; chip.className = 'swatch' + (s.hex == null ? ' neutral' : ''); chip.title = s.name;
    if (s.hex != null) chip.style.background = '#' + ((s.hex >>> 0) & 0xffffff).toString(16).padStart(6, '0');
    chip.onclick = desc.team ? () => recolorSelTeam(i) : () => recolorSelColor(s.hex);
    row.appendChild(chip);
  });
}
function setSelMode(on) {
  selMode = on;
  document.querySelectorAll('.selectTool').forEach((b) => b.classList.toggle('on', on));
  renderer.domElement.classList.toggle('selecting', on);
}
// A flat ring under a selected piece, styled like dropMarker but tinted + opaque.
function makeSelRing() {
  const m = new THREE.Mesh(new THREE.RingGeometry(CONFIG.marker.inner, CONFIG.marker.outer, 40),
    new THREE.MeshBasicMaterial({ color: selColor(), transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 3; scene.add(m); return m;
}
const _selBox = new THREE.Box3(), _selSize = new THREE.Vector3();
function updateSelectionRings() {
  for (const [id, ring] of selRings) if (!selection.has(id) || !meshes.get(id)) { // drop stale rings
    scene.remove(ring); ring.geometry.dispose(); ring.material.dispose(); selRings.delete(id);
  }
  for (const id of selection) {
    const entry = meshes.get(id); if (!entry) continue;
    let ring = selRings.get(id); if (!ring) { ring = makeSelRing(); selRings.set(id, ring); } // tinted with my accent at creation
    _selBox.setFromObject(entry.mesh); _selBox.getSize(_selSize);
    ring.scale.setScalar((Math.max(_selSize.x, _selSize.z) / 2 + 0.15) / CONFIG.marker.outer);
    ring.position.set(entry.mesh.position.x, boardTopY + CONFIG.marker.lift + 0.012, entry.mesh.position.z);
  }
  refreshSelTools(); // the recolor bar: shown/hidden + its swatches match what's selected
}
// Screen-space marquee: a fixed-position div the drag paints, then every piece whose projected
// centre lands inside joins the selection (replace, or add when Shift-held).
const _selV = new THREE.Vector3();
function showMarquee(x0, y0, x1, y1) {
  const el = byId('marquee'); if (!el) return;
  const c = selColor();
  el.style.borderColor = c; el.style.background = c + '24'; // my colour + ~14% alpha (8-digit hex)
  el.style.left = Math.min(x0, x1) + 'px'; el.style.top = Math.min(y0, y1) + 'px';
  el.style.width = Math.abs(x1 - x0) + 'px'; el.style.height = Math.abs(y1 - y0) + 'px';
  el.hidden = false;
}
function hideMarquee() { const el = byId('marquee'); if (el) el.hidden = true; }
function finalizeMarquee(x0, y0, x1, y1, add) {
  if (!add) clearSelection();
  const rect = renderer.domElement.getBoundingClientRect();
  const minX = Math.min(x0, x1), maxX = Math.max(x0, x1), minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
  for (const [id, entry] of meshes) {
    if (PHYS[entry.type].mass <= 0) continue;                 // skip static boards
    _selV.copy(entry.mesh.position).project(camera);
    if (_selV.z > 1) continue;                                // behind the camera
    const sx = rect.left + (_selV.x * 0.5 + 0.5) * rect.width;
    const sy = rect.top + (-_selV.y * 0.5 + 0.5) * rect.height;
    if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) selection.add(id);
  }
}

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
  if (hoverId != null && !hoverTip.hidden) { // keep the hover count live while it's shown (deal/dispense without moving)
    const p = room && room.state.pieces.get(hoverId);
    const t = p && countLabel(p);
    if (t == null) hideHoverTip(); else hoverTip.textContent = t;
  }
  for (let i = pings.length - 1; i >= 0; i--) { // expand + fade each active ping, then dispose
    const p = pings[i], t = (performance.now() - p.start) / CONFIG.ping.dur;
    if (t >= 1) {
      scene.remove(p.ring); p.ring.geometry.dispose(); p.ring.material.dispose();
      disposeSprite(p.label);
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
    const me = room && room.state.players.get(mySession);                                 // tint to my seat color
    if (me && me.color) dropMarker.material.color.set(me.color);
    dropMarker.position.set(held.mesh.position.x, boardTopY + CONFIG.marker.lift, held.mesh.position.z);
    dropMarker.visible = true;
  } else {
    dropMarker.visible = false;
  }
  updateSelectionRings(); // keep a highlight ring under each selected piece
  if (camTween) {                    // tray camera hop: drive pos+target directly, no orbit input
    const raw = Math.min(1, (performance.now() - camTween.start) / camTween.dur);
    const e = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2; // easeInOutQuad
    camera.position.lerpVectors(camTween.fromPos, camTween.toPos, e);
    controls.target.lerpVectors(camTween.fromTarget, camTween.toTarget, e);
    camera.lookAt(controls.target);
    if (raw >= 1) { const done = camTween.onDone; camTween = null; if (done) done(); }
  } else {
    camera.position.sub(leanOffset);   // undo last frame's lean so controls sees the true orbit position
    controls.update();
    leanT += ((leanActive ? 1 : 0) - leanT) * 0.18; // ease toward held / released
    if (leanT < 0.0005) leanT = 0;
    leanOffset.copy(controls.target).sub(camera.position).multiplyScalar(leanT * LEAN_AMOUNT);
    camera.position.add(leanOffset);   // apply the lean for this frame's render
  }
  { // clustered height + rotate controls (both edges): rotate while holding a piece or with a selection; height while holding
    const holding = !!(down && down.grabbed && down.touch), hasSel = selection.size > 0, sig = (holding ? 1 : 0) | (hasSel ? 2 : 0);
    if (sig !== holdSig) { holdSig = sig; const show = holding || hasSel;
      document.querySelectorAll('.holdControls').forEach(el => el.hidden = !show);
      document.querySelectorAll('.rotLeft, .rotRight').forEach(b => b.hidden = !show);
      document.querySelectorAll('.heightUp, .heightDown').forEach(b => b.hidden = !holding);
    }
  }
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
})();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ===== Touch context menu (long-press a piece) ==============================
// A small floating menu of a piece's verbs; each item runs the same action a key or click
// would. Long-press raises secondaryPress (see public/controls.js): on a piece we open this,
// on empty felt we ping. Verbs are filtered by kind.
function pieceMenuItems(id, type) {
  const items = [];
  if (type === 'card') { items.push(['Flip', () => room.send('flip', { id })]); items.push(['Take to hand', () => sendAction('takeCard', id)]); }
  if (type === 'die') { items.push(['Roll', () => room.send('rollOne', { id })]); }
  if (type === 'deck') {
    items.push(['Draw to hand', () => sendAction('drawToHand', id)]);
    items.push(['Shuffle', () => room.send('shuffle', { deckId: id })]);
    items.push(['Split', () => room.send('splitDeck', { deckId: id })]);
    items.push(['Save…', () => { const name = prompt('Save this deck as:'); if (name && name.trim()) room.send('saveDeck', { deckId: id, name: name.trim() }); }]);
  }
  if (type === 'dispenser') { items.push(['Dispense', () => sendAction('dispense', id)]); }
  if (KIND[type] && KIND[type].grab === 2) items.push(['Move (then drag)', () => { armedMove = id; }]); // deck/dispenser: reposition instead of deal
  if (INSPECTABLE(type)) { items.push(['Inspect', () => enterInspect(id)]); }
  items.push(['Stand / lay flat', () => room.send('setStand', { id })]);
  items.push(['Snap to grid', () => room.send('setSnap', { id })]);
  items.push(['Delete', () => room.send('remove', { id }), 'danger']);
  return items;
}
let pieceMenuAway = null; // outside-tap dismiss handler installed while the menu is open
function closePieceMenu() {
  const menu = byId('pieceMenu'); if (menu) menu.hidden = true;
  if (pieceMenuAway) { document.removeEventListener('pointerdown', pieceMenuAway, true); pieceMenuAway = null; }
}
function openPieceMenu(id, p) {
  const menu = byId('pieceMenu'); if (!menu) return;
  const entry = meshes.get(id); if (!entry) return;
  menu.replaceChildren();
  for (const [label, fn, cls] of pieceMenuItems(id, entry.type)) {
    menu.appendChild(makeButton(label, () => { closePieceMenu(); fn(); }, cls));
  }
  menu.hidden = false; // show first so it can be measured
  const w = menu.offsetWidth || 180, h = menu.offsetHeight || 0;
  menu.style.left = Math.max(8, Math.min(p.x, innerWidth - w - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(p.y, innerHeight - h - 8)) + 'px';
  pieceMenuAway = (ev) => { if (!menu.contains(ev.target)) closePieceMenu(); };
  setTimeout(() => document.addEventListener('pointerdown', pieceMenuAway, true), 0); // dismiss on the next outside tap
}

// ===== Input seam ===========================================================
// Raw canvas events → intents (see public/controls.js). These handlers own what each
// intent MEANS; controls.js owns which device gesture raises it. As Phase 0 proceeds,
// the pointer dispatcher and keyboard shortcuts fold in here too.
const INPUT = {
  press: onPointerDown,   // pointerdown → the dispatcher (grab/deal, marquee, overlay, modal starts)
  move: onPointerMove,    // pointermove → drag routing for every mode
  release: endGesture,    // pointerup / pointercancel → commit/settle the gesture
  command: onKeyDown,     // keydown → the command router (Esc-exits, batch ops, per-piece verbs, ping)
  secondaryPress: (p) => { // touch long-press → context menu on a piece, or ping on empty felt
    if (!room || measuring || wbOwning || inspect || selMode) return; // a modal tool owns the gesture
    const id = down && down.id;      // the piece the press landed on (null on empty felt)
    if (down) down.dragging = true;  // consume the gesture: no grab on further move, no tap on release
    if (id) openPieceMenu(id, p);
    else { setPointer({ clientX: p.x, clientY: p.y }); sendPing(); } // long-press empty felt → ping
  },
  hasHeld: () => !!(down && down.grabbed),
  snapHeld: () => { if (down && down.grabbed) room.send('snap', { id: down.id }); },
  ping: (p) => { setPointer({ clientX: p.x, clientY: p.y }); sendPing(); },
  raiseAxis: (dir) => {
    if (!(down && down.grabbed)) return;
    dragHeight = clamp(dragHeight + dir * DRAG_STEP, DRAG_MIN, DRAG_MAX); // up = raise
    ray.setFromCamera(pointer, camera);
    ray.ray.intersectPlane(dragPlane, hit); // fixed ground plane → XZ under the cursor
    const t = snapXZ(hit.x, hit.z);
    if (down.group) room.send('moveGroup', { x: t.x, y: dragHeight, z: t.z });
    else room.send('move', { id: down.id, x: t.x, y: dragHeight, z: t.z });
  },
  // double-click the board to own it and draw; true if a claim was sent
  doubleClick: (p) => {
    if (!room || !room.state.whiteboard || !room.state.whiteboard.enabled || wbOwning || room.state.whiteboard.owner) return false;
    const surf = wbGroup && wbGroup.getObjectByName('wbSurface'); if (!surf) return false;
    setPointer({ clientX: p.x, clientY: p.y });
    ray.setFromCamera(pointer, camera);
    const bh = ray.intersectObject(surf)[0]; if (!bh) return false;
    const ph = ray.intersectObjects([...meshes.values()].map(m => m.mesh))[0];
    if (ph && ph.distance < bh.distance) return false; // a piece is in front → inspect, not the board
    room.send('wbClaim'); return true;
  },
};
attachControls(renderer.domElement, INPUT);

// Universal icon buttons: any button labeled "EMOJI text" collapses to just the emoji on small
// screens — its text is wrapped in <span class="lbl"> (hidden by CSS). Skips buttons that are
// already structured (a child element) or have no leading emoji to fall back to (e.g. "+ d4").
function autoIconLabels(root = document) {
  root.querySelectorAll('button').forEach((btn) => {
    if (btn.childElementCount) return;                            // already wrapped / structured
    const m = btn.textContent.match(/^(.*?)(\p{L}.*)$/u);          // split at the first letter
    if (!m || !/\p{Extended_Pictographic}/u.test(m[1])) return;    // needs a leading emoji
    btn.textContent = '';
    btn.appendChild(document.createTextNode(m[1]));
    const span = document.createElement('span');
    span.className = 'lbl';
    span.textContent = m[2];
    btn.appendChild(span);
  });
}
autoIconLabels();

// Reusable pop-out groups: a `.pop-group` = a `.pop-trigger` button + a `.pop-menu`. Tapping the
// trigger toggles its menu (closing any other open one); a click anywhere else closes them. Groups
// marked `data-close` also close when you pick something inside (e.g. a color swatch); groups without
// it stay open so you can pick several (e.g. adding multiple dice).
function wirePopGroups(root = document) {
  root.querySelectorAll('.pop-group').forEach((group) => {
    const trigger = group.querySelector(':scope > .pop-trigger');
    const menu = group.querySelector(':scope > .pop-menu');
    if (!trigger || !menu) return;
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menu.hidden;
      document.querySelectorAll('.pop-menu').forEach((m) => { m.hidden = true; });
      menu.hidden = !open;
    });
    menu.addEventListener('click', (e) => {
      e.stopPropagation();                                   // clicks inside don't reach the document-level closer
      if (group.hasAttribute('data-close') && e.target.closest('button, .swatch')) menu.hidden = true;
    });
  });
  document.addEventListener('click', () => document.querySelectorAll('.pop-menu').forEach((m) => { m.hidden = true; }));
}
wirePopGroups();

// applyIcons / setIcon / initTip are imported from icons.js (see top).
applyIcons();
document.querySelectorAll('.close-x').forEach((el) => setIcon(el, 'x')); // every modal's ✕ → an icon, universally
document.querySelectorAll('label[data-icon]').forEach((el) => setIcon(el, el.dataset.icon)); // icon-only dimension labels (Width/Depth)

// ---- shared dialog focus management ----------------------------------------------------
// Layers keyboard/focus behavior onto panels that already toggle via [hidden], WITHOUT
// touching their bespoke open/close handlers. On open: remember what had focus and move it
// into the panel (unless the panel already self-focuses a control, e.g. chat/notes). On
// close: return focus to whatever opened the panel. True modals also get aria-modal + a Tab
// focus-trap; non-modal popouts don't trap (you can still work at the table while they're open).
// esc:false leaves Escape to the table's own handler (whiteboard release / exit-measure).
let lastFocusOutsideDialog = null;
document.addEventListener('focusin', (e) => { if (!e.target.closest || !e.target.closest('[role="dialog"]')) lastFocusOutsideDialog = e.target; });
// Esc fallback: if focus drifts out of an open dialog (e.g. a panel re-renders its body and
// drops focus), Escape still closes the most-recently-opened esc-enabled dialog. When focus IS
// inside a dialog, its own keydown handler runs instead — this guard avoids double-firing.
const openEscDialogs = []; // stack of { panel, close } for esc-enabled dialogs currently open
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !openEscDialogs.length) return;
  if (document.activeElement && document.activeElement.closest && document.activeElement.closest('[role="dialog"]')) return;
  const top = openEscDialogs[openEscDialogs.length - 1];
  const x = top.close || top.panel.querySelector('.close-x');
  if (x) { e.preventDefault(); e.stopPropagation(); x.click(); }
}, true); // capture: take Escape before the table's own handler when a dialog is open
function wireDialog(panel, { modal = false, esc = true, close = null } = {}) {
  if (!panel) return;
  panel.setAttribute('role', 'dialog');
  if (modal) panel.setAttribute('aria-modal', 'true');
  if (!panel.hasAttribute('tabindex')) panel.tabIndex = -1;
  const title = panel.querySelector('.panel-head b, h3');
  if (title && !panel.hasAttribute('aria-label')) panel.setAttribute('aria-label', title.textContent.trim());
  const focusables = () => [...panel.querySelectorAll('a[href], button, input, textarea, select, [tabindex]')]
    .filter((n) => !n.disabled && n.tabIndex !== -1 && n.type !== 'hidden' && n.getClientRects().length);
  let returnTo = null;
  new MutationObserver(() => {
    const at = openEscDialogs.findIndex((d) => d.panel === panel);
    if (panel.hidden) { // closed → restore focus only if the panel had it
      const r = returnTo; returnTo = null;
      if (r && r.focus && document.contains(r) && (document.activeElement === document.body || panel.contains(document.activeElement))) r.focus();
      if (at >= 0) openEscDialogs.splice(at, 1);
    } else { // opened → remember opener, then move focus in unless the panel self-focused
      returnTo = (lastFocusOutsideDialog && document.contains(lastFocusOutsideDialog)) ? lastFocusOutsideDialog : document.activeElement;
      if (!panel.contains(document.activeElement)) { const f = focusables(); (f[0] || panel).focus(); }
      if (esc) { if (at >= 0) openEscDialogs.splice(at, 1); openEscDialogs.push({ panel, close }); } // move to top
    }
  }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  panel.addEventListener('keydown', (e) => {
    if (esc && e.key === 'Escape') { const x = close || panel.querySelector('.close-x'); if (x) { e.preventDefault(); e.stopPropagation(); x.click(); } }
    else if (e.key === 'Tab' && modal) {
      const f = focusables(); if (!f.length) return; const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
}
['showPanel','dropPanel','membersPanel','tracksPanel','whiteboard'].forEach((id) => wireDialog(byId(id)));
wireDialog(byId('settingsModal'), { modal: true });
wireDialog(byId('roomSettingsModal'), { modal: true });
wireDialog(byId('controlsModal'), { modal: true, close: byId('controlsClose') });
['libraryPanel', 'builtinModal', 'skyPickModal'].forEach((id) => wireDialog(byId(id), { modal: true })); // library modals (content wired in editor-panel.js)

// ---- shared-region cluster primitive (UI_Redesign phase 1) -----------------------------
// N hamburger buttons share ONE region. Accordion within the cluster: one pane open at a
// time; clicking the active ham collapses it. Desktop: the region is an overlay anchored
// under the first ham (position set here); mobile (≤720px): CSS reshapes it into a bottom
// sheet. Esc, or the region's own ✕, closes it and returns focus to the opener.
function wireCluster(region, hams, opts = {}) {
  if (!region || !hams.length) return;
  const anchor = hams[0].btn;
  const sheet = () => matchMedia('(max-width: 720px)').matches;
  const place = () => {
    if (sheet()) { region.style.left = region.style.top = ''; return; } // bottom sheet: let CSS own it
    const r = anchor.getBoundingClientRect();
    const clampX = (x) => Math.round(Math.max(8, Math.min(x, innerWidth - region.offsetWidth - 8)));
    const clampY = (y) => Math.round(Math.max(8, Math.min(y, innerHeight - region.offsetHeight - 8)));
    if (opts.open === 'right') { region.style.left = clampX(r.right + 8) + 'px'; region.style.top = clampY(r.bottom - region.offsetHeight) + 'px'; }        // beside the ham, bottom-aligned
    else if (opts.open === 'above') { region.style.left = clampX(r.left) + 'px'; region.style.top = clampY(r.top - region.offsetHeight - 8) + 'px'; }        // above the ham
    else { region.style.left = clampX(r.left) + 'px'; region.style.top = Math.round(r.bottom + 8) + 'px'; }                                                    // below (default)
  };
  let current = null;
  const deactivate = () => { const c = current; current = null; if (c && c.onClose) c.onClose(); }; // null first — onClose may re-enter
  const close = () => { deactivate(); region.hidden = true; hams.forEach((h) => h.btn.classList.remove('on')); };
  const open = (h) => {
    if (current && current !== h) deactivate(); // switching panes: close the outgoing one
    hams.forEach((x) => x.btn.classList.remove('on'));
    region.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === h.pane));
    h.btn.classList.add('on'); region.hidden = false; place(); current = h;
    const f = region.querySelector('.pane.on textarea, .pane.on input:not([type=hidden])')
           || region.querySelector('.pane.on button:not(.regionClose), .pane.on [tabindex]');
    if (f) f.focus();
    if (h.onOpen) h.onOpen(); // per-pane hook (e.g. chat: clear unread + scroll to bottom)
  };
  region._close = close; // let external code collapse the region (e.g. measure's global-Esc handler)
  hams.forEach((h) => h.btn.addEventListener('click', () => {
    (current === h) ? close() : open(h);
  }));
  region.querySelectorAll('.regionClose').forEach((b) => b.addEventListener('click', () => { close(); anchor.focus(); }));
  region.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); anchor.focus(); } });
  addEventListener('resize', () => { if (!region.hidden) place(); });
}
// Top-left cluster (UI_Redesign phase 2): Chat + Notes share one region (accordion).
{ const r = byId('regionTL'), cb = byId('chatBtn'), nb = byId('notesBtn');
  if (r && cb && nb) wireCluster(r, [
    { btn: cb, pane: 'chat', onOpen: () => { cb.classList.remove('hasUnread'); const l = byId('chatLog'); if (l) l.scrollTop = l.scrollHeight; } },
    { btn: nb, pane: 'notes' },
  ]);
}
// Top-right cluster (UI_Redesign phase 2b): Score + Music + Measure + Timer.
{ const r = byId('regionTR'), sb = byId('scoreBtn'), ab = byId('audioBtn'), mb = byId('measureBtn'), tb = byId('timerBtn');
  if (r && sb && tb) wireCluster(r, [
    { btn: sb, pane: 'score', onOpen: () => { renderScores(); updateRoomNotes(); } },
    { btn: ab, pane: 'music' },
    { btn: mb, pane: 'measure', onOpen: enterMeasure, onClose: exitMeasure },
    { btn: tb, pane: 'timer' },
  ]);
}
// Bottom-left corner cluster (UI_Redesign phase 2c): Interactions → My Seat / Lean In / Show / Drop.
{ const r = byId('regionBL'), ib = byId('interactHam');
  if (r && ib) wireCluster(r, [{ btn: ib, pane: 'interactions' }], { open: 'right' });
}
// Library cards render dynamically (editor-panel.js) — icon their data-icon buttons as they appear.
['libraryPanel', 'builtinModal', 'skyPickModal'].forEach((id) => {
  const el = byId(id);
  if (el) new MutationObserver(() => applyIcons(el)).observe(el, { childList: true, subtree: true });
});

initTip(); // themed hover-hint (icons.js)

// Touch height control: hold ▲ / ▼ to raise / lower the held piece — the touch analog of the wheel.
// Also the selection rotation buttons: hold ⟲ / ⟳ to spin the selection continuously (server
// rotateGroup with an angle delta), the continuous complement to the [ / ] 45° steps.
{
  const holdRepeat = (btn, fn, ms = 100) => {
    if (!btn) return;
    let iv = null;
    const start = (e) => { e.preventDefault(); fn(); iv = setInterval(fn, ms); };
    const stop = () => { if (iv) { clearInterval(iv); iv = null; } };
    btn.addEventListener('pointerdown', start);
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointerleave', stop);
    btn.addEventListener('pointercancel', stop);
    btn.addEventListener('contextmenu', (e) => e.preventDefault()); // a sustained hold shouldn't pop the browser menu
  };
  document.querySelectorAll('.heightUp').forEach((b) => holdRepeat(b, () => INPUT.raiseAxis(1), 120));
  document.querySelectorAll('.heightDown').forEach((b) => holdRepeat(b, () => INPUT.raiseAxis(-1), 120));
  const rotStep = Math.PI / 24; // ~7.5° per tick
  const rotate = (sign) => () => { const ids = selection.size ? [...selection] : (down && down.grabbed ? [down.id] : []); if (ids.length) room.send('rotateGroup', { ids, angle: sign * rotStep }); };
  document.querySelectorAll('.rotLeft').forEach((b) => holdRepeat(b, rotate(-1), 60));
  document.querySelectorAll('.rotRight').forEach((b) => holdRepeat(b, rotate(1), 60));
}

// Selection batch-op bar: touch-accessible equivalents of the U/G/R/F/H/Delete group keys.
// (Rotation lives in the edge clusters; recolor stays in #selTools.)
{
  const send = (msg) => () => { if (room && selection.size) room.send(msg, { ids: [...selection] }); };
  const on = (id, fn) => { const el = byId(id); if (el) el.onclick = fn; };
  on('selStand', send('setStandGroup'));
  on('selSnap', send('setSnapGroup'));
  on('selFlip', send('flipGroup'));
  on('selRoll', send('rollGroup'));
  on('selTake', send('takeGroup'));
  on('selDelete', () => { if (room && selection.size) { room.send('removeGroup', { ids: [...selection] }); clearSelection(); } });
  on('selClear', () => clearSelection());
}
