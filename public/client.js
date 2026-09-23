import {
  createColliderSurface,
  disposeColliderSurface,
  colliderSurfaceHeight,
} from './collider-surface.js';
import * as THREE from 'three';
import {
  CONFIG,
  clamp,
  scene,
  camera,
  renderer,
  controls,
  resizeTable,
  setTableColor,
  setRimWood,
  setTableVisible,
  setSeatCameraReady,
  waitForVisualAssets,
  setQuality,
  getQuality,
  deviceClass,
  applyLighting,
} from './core.js';
import { initPerf } from './perf.js';
import {
  KIND,
  OVERLAY,
  trayMesh,
  cTex,
  cardMesh,
  resizeToCanvas,
  parseCardFront,
  cardPreviewURL,
  makePlayerTexture,
  nameTag,
  makeYouChipTexture,
  gridMesh,
} from './graphics.js';
import { applyIcons, setIcon, initTip, wirePopGroups } from './icons.js';
import { makeButton, rankOf, toastContent } from './rows.js';
import { reanchorOffset } from './drag.js';
import { clickRoute } from './clicks.js';
import { colliderSpec } from '/shared/collider-spec.js';
import { createColliderDebug } from './table/collider-debug.js';
import { createUiSurfaces } from './table/ui-surfaces.js';
import { createWhiteboard } from './table/whiteboard.js';
import { createOverlays } from './table/overlays.js';
import { createTrays } from './table/trays.js';
import { createHand } from './table/hand.js';
import { createInspection } from './table/inspection.js';
import { createSelection } from './table/selection.js';
import { createPresence } from './table/presence.js';
import { createChat } from './table/chat.js';
import { createNotebook } from './table/notebook.js';
import { createScoreboard } from './table/scoreboard.js';
import { createTimer } from './table/timer.js';
import { createMembership } from './table/membership.js';
import { bindLibraryMessages } from './table/library-bindings.js';
import { createRoomSettings } from './table/room-settings.js';
import { BUILTIN_SKIES, createSkybox } from './table/skybox.js';
import { createPieceView, meshPropsOf, pieceProperty, piecePropsOf } from './table/piece-view.js';
import {
  KINDS as PHYS,
  DIE_SIDES,
  DICE_SETS,
  DICE_FINISHES,
  DICE_FINISH_FALLBACK,
  readableInk,
  deckHeight,
  formatMeasure,
  dispenserDefinition,
  gridActive,
  gridFootprintCells,
  snapToCell,
  trayCenter,
  seatAngle,
} from '/shared/pieces.js';
import { MEASURE } from '/shared/overlays.js';
import {
  playSfx,
  resumeAudio,
  setSfxVolume,
  getSfxVolume,
  setSfxMuted,
  getSfxMuted,
  setMusicMuted,
  getMusicMuted,
  toggleMusic,
  nextTrack,
  playTrack,
  currentTrackIndex,
  getShuffle,
  setShuffle,
  setMusicVolume,
  getMusicVolume,
  isMusicPlaying,
  onMusicTrack,
} from './audio.js';
import {
  MUSIC,
  MUSIC_CREDIT,
  SFX_CREDITS,
  MODEL_CREDITS,
  ART_CREDITS,
  LIB_CREDITS,
} from './credits.js';
import { attachControls } from './controls.js';
window.addEventListener('pointerdown', resumeAudio, { once: true }); // browsers block audio until a user gesture

// ===== Tiny DOM helpers =====================================================
const byId = (id) => document.getElementById(id);
const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => document.querySelectorAll(selector);
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let sceneHydrationVersion = 0;
const noteSceneHydration = () => sceneHydrationVersion++;

// Keep the page-level loading cover in place until the synchronized scene has created its meshes,
// every initial Three.js texture/model request has settled, and the collection stays quiet long
// enough to catch Colyseus callbacks delivered just after the first state frame.
async function finishTableLoading() {
  for (;;) {
    await waitForVisualAssets();
    const version = sceneHydrationVersion;
    await wait(300);
    await waitForVisualAssets();
    const pieceCount = room?.state?.pieces?.size ?? 0;
    const seated = !!room?.state?.players?.get(mySession);
    if (seated && meshes.size === pieceCount && version === sceneHydrationVersion) break;
  }
  renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);
  await nextFrame();
  await nextFrame();
  const overlay = byId('tableLoading');
  if (!overlay) return;
  overlay.classList.add('is-ready');
  const remove = () => overlay.remove();
  overlay.addEventListener('transitionend', remove, { once: true });
  setTimeout(remove, 700); // reduced motion / interrupted transition fallback
}
// Escape a string for safe interpolation into an innerHTML fragment.
const escapeHtml = (x) =>
  String(x).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
// Per-room role → numeric rank (owner > gm > helper > player); used for gating.
// A <button> from label + click handler (+ optional class) — the shared DOM factory.
// Relabel a button without clobbering an injected icon: update its .lbl + aria-label, or textContent if it has no icon.
const setBtnLabel = (btn, text) => {
  if (!btn) return;
  const l = btn.querySelector('.lbl');
  if (l) {
    l.textContent = text;
    btn.setAttribute('aria-label', text);
  } else btn.textContent = text;
};

// Wrap every number input in a themed − / + stepper (universal number-field style).
// The original input is kept in place, so existing byId() reads still work; the
// buttons just step the value and fire input/change so any listeners react.
function enhanceNumberInputs() {
  document.querySelectorAll('input[type="number"]').forEach((input) => {
    if (input.closest('.stepper')) return; // already wrapped
    const wrap = document.createElement('span');
    wrap.className = 'stepper';
    input.parentNode.insertBefore(wrap, input);
    const fire = () => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const btn = (label, step) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'stepBtn';
      b.textContent = label;
      b.tabIndex = -1;
      b.onclick = () => {
        step > 0 ? input.stepUp() : input.stepDown();
        fire();
      }; // stepUp/Down honour min/max/step
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
const PANEL_MOVABLE = []; // Customize Table + Scale & Grid are movable pop-outs (drag them aside while calibrating); the show/drop/tracks pop-outs became inline controls in 7i–7j
// Every movable panel is resizable (size them to taste); chat/notes additionally
// flex their inner scroll region (see styles.css) so resizing grows the content.
const PANEL_RESIZABLE = new Set(PANEL_MOVABLE);
const PANEL_LS = 'ott.panelLayout';
let panelTopZ = 40;

function readPanelLayout() {
  try {
    return JSON.parse(localStorage.getItem(PANEL_LS)) || {};
  } catch (e) {
    return {};
  }
}
function writePanelLayout(layout) {
  try {
    localStorage.setItem(PANEL_LS, JSON.stringify(layout));
  } catch (e) {
    /* private mode / quota */
  }
}

// Clamp a top-left so the WHOLE panel (incl. its bottom-right resize grip) stays
// on-screen — not just the corner; otherwise a wide panel hangs off the edge.
function clampPos(panel, left, top) {
  const w = panel.offsetWidth || 220,
    h = panel.offsetHeight || 140;
  return {
    left: clamp(left, 0, Math.max(0, innerWidth - w)),
    top: clamp(top, 0, Math.max(0, innerHeight - h)),
  };
}
// Detach a panel from the dock flow into a clamped fixed position (+ optional size).
function floatPanel(panel, id, left, top, width, height) {
  panel.classList.add('floating');
  if (PANEL_RESIZABLE.has(id)) panel.classList.add('resizable');
  if (width) panel.style.width = width + 'px'; // set size first so clampPos measures the final box
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
  layout[id] = {
    left: r.left,
    top: r.top,
    width: r.width,
    height: panel.style.height ? r.height : 0,
  };
  writePanelLayout(layout);
}
function initPanels() {
  if (!matchMedia('(pointer: fine)').matches) return; // desktop / precise pointer only — keep the docked layout on touch
  const layout = readPanelLayout();
  for (const id of PANEL_MOVABLE) {
    const panel = byId(id);
    if (!panel) continue;
    const head = panel.querySelector(':scope > .panel-head');
    if (!head) continue;
    panel.classList.add('movable');
    const saved = layout[id];
    if (saved) floatPanel(panel, id, saved.left, saved.top, saved.width, saved.height);

    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.close-x')) return; // left-drag on the title bar, not the ✕
      const r = panel.getBoundingClientRect(); // measured WITH any centering transform still applied
      // Pin the current (docked) width — else the dock's `width:100%` rule, now
      // viewport-relative under position:fixed, stretches the panel full-screen.
      if (!panel.classList.contains('floating')) floatPanel(panel, id, r.left, r.top, r.width); // pop out of flow on first drag (no visual jump)
      panel.style.zIndex = ++panelTopZ; // bring to front
      const ox = e.clientX - r.left,
        oy = e.clientY - r.top;
      head.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const pos = clampPos(panel, ev.clientX - ox, ev.clientY - oy);
        panel.style.left = pos.left + 'px';
        panel.style.top = pos.top + 'px';
      };
      const up = (ev) => {
        try {
          head.releasePointerCapture(ev.pointerId);
        } catch (err) {
          /* already released */
        }
        head.removeEventListener('pointermove', move);
        head.removeEventListener('pointerup', up);
        persistPanel(panel, id);
      };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
    });
    // Clicking anywhere in a floating panel raises it above the others.
    panel.addEventListener(
      'pointerdown',
      () => {
        if (panel.classList.contains('floating')) panel.style.zIndex = ++panelTopZ;
      },
      true,
    );
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
}
initPanels();

// A brief confirmation for actions that have no visible dialog (drop hand, …).
let toastTimer = null;
function toast(text, icon = 'check', action = null) {
  const el = byId('toast');
  if (!el) return;
  el.replaceChildren();
  el.append(
    ...toastContent(text, icon, action, () => {
      action.fn();
      el.hidden = true;
    }),
  );
  el.hidden = false;
  el.setAttribute('role', 'status');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => {
      el.hidden = true;
    },
    action ? 8000 : 2600,
  ); // an undoable action gets longer to be undone
}

// Last-resort visibility for uncaught client errors: always log, and (throttled) surface the
// message on screen — otherwise a crash mid-init just leaves a half-loaded page with no clue. The
// render context going away is handled separately (WebGL context-loss listener in core.js).
let _lastErrToast = 0;
function surfaceError(what, detail) {
  console.error('[client]', what, detail);
  const now = Date.now();
  if (now - _lastErrToast < 4000) return; // don't storm on a repeating error
  _lastErrToast = now;
  try {
    toast('Error: ' + String(detail || what).slice(0, 140), 'x');
  } catch {
    /* toast not ready this early — the console line still landed */
  }
}
addEventListener('error', (e) => {
  if (!e || (!e.message && !e.error)) return; // ignore resource (img/script) load errors
  surfaceError('error', e.message || (e.error && e.error.message) || e.error);
});
addEventListener('unhandledrejection', (e) =>
  surfaceError('unhandledrejection', (e && e.reason && (e.reason.message || e.reason)) || e),
);

// ===== Networking ===========================================================
const { Client, getStateCallbacks } = Colyseus;
const meshes = new Map(); // id -> { mesh, type }
const buffers = new Map(); // id -> [snapshot]   recent server states, for interpolation
let room, mySession;
let inspection;
let myIsAdmin = false; // set by the server's 'whoami' on join; gates library-creation UI
let myRank = 0; // set by applyRole; gates scoreboard (helper+) + room notes (gm+) editing
const heldTarget = new THREE.Vector3(); // drag target sent to the server
const colliderDebug = createColliderDebug({
  scene,
  getPieces: () => room?.state.pieces,
  getMesh: (id) => meshes.get(id)?.mesh,
  getRank: () => myRank,
  colliderSpec,
  storage: localStorage,
});
const pieceView = createPieceView({
  scene,
  meshes,
  buffers,
  kinds: KIND,
  physics: PHYS,
  deckHeight,
  createQuaternion: () => new THREE.Quaternion(),
  refreshCollider: (id, piece) => colliderDebug.refresh(id, piece),
  isInspected: (id) => inspection.isInspecting(id),
});
const { setOriginalVisible, sample } = pieceView;

function syncColliderDebugButton() {
  const button = byId('colliderToggle');
  if (!button) return;
  const active = colliderDebug.isEnabled() && myRank >= 2;
  button.classList.toggle('on', active);
  button.setAttribute('aria-pressed', active ? 'true' : 'false');
}
// My saved default color per die type — a LOCAL, per-device preference (like the lobby
// accent), never synced. Shape in localStorage['ott-dice']: { "20": {color, textColor}, ... }
// as ints. An absent type just means "no default" → the die spawns plain ivory/ink.
function loadDiceDefaults() {
  try {
    return JSON.parse(localStorage.getItem('ott-dice') || '{}') || {};
  } catch {
    return {};
  }
}
function saveDiceDefault(sides, color, textColor, finish, finishImg) {
  const all = loadDiceDefaults();
  const d = { ...(all[String(sides)] || {}) }; // merge, so setting a finish doesn't wipe the color
  if (Number.isInteger(color)) d.color = color;
  if (Number.isInteger(textColor)) d.textColor = textColor;
  if (typeof finish === 'string') {
    if (finish === 'matte') {
      delete d.finish; // matte is the default look
      delete d.finishImg;
    } else if (finish === 'custom') {
      d.finish = 'custom';
      if (typeof finishImg === 'string') d.finishImg = finishImg; // the uploaded texture URL
    } else {
      d.finish = finish;
      delete d.finishImg; // a non-custom finish drops any stored texture
    }
  }
  all[String(sides)] = d;
  try {
    localStorage.setItem('ott-dice', JSON.stringify(all));
  } catch {}
}
// Spawn props for a die of this type, with my saved default color folded in (if any).
function myDieProps(sides) {
  const p = { sides };
  const d = loadDiceDefaults()[String(sides)];
  if (d) {
    if (Number.isInteger(d.color)) p.color = d.color;
    if (Number.isInteger(d.textColor)) p.textColor = d.textColor;
    if (typeof d.finish === 'string') {
      p.finish = d.finish;
      if (d.finish === 'custom' && typeof d.finishImg === 'string') p.finishImg = d.finishImg;
    }
  }
  return p;
}
// Forget my saved default for one die type (back to plain ivory/ink on the next spawn).
function clearDiceDefault(sides) {
  const all = loadDiceDefaults();
  delete all[String(sides)];
  try {
    localStorage.setItem('ott-dice', JSON.stringify(all));
  } catch {}
}
// Apply a dice set as my default across EVERY die type, and live-recolor the dice already in
// my tray. Numbers are auto-contrasted from the body color. Local-only for the defaults; the
// tray recolor goes through the normal (synced) recolor message so everyone sees it.
function applyDiceSet(color) {
  const textColor = readableInk(color);
  for (const s of DIE_SIDES) saveDiceDefault(s, color, textColor);
  for (const id of trays.dieIds()) room.send('recolor', { id, color, textColor });
}

// Apply a finish as my default across EVERY die type, and live-apply it to the dice already in my
// tray (synced, so everyone sees them). Colors are untouched.
function applyDiceFinish(finish, finishImg) {
  for (const s of DIE_SIDES) saveDiceDefault(s, undefined, undefined, finish, finishImg);
  const extra = finish === 'custom' ? { finish, finishImg } : { finish };
  for (const id of trays.dieIds()) room.send('recolor', { id, ...extra });
}

// Custom dice textures (host-uploaded, ROADMAP §9 phase 2). The library list arrives via the
// 'diceList' message; each becomes an image chip appended to a finish picker. Clicking one applies
// the 'custom' finish with that texture URL. The inspection controller owns its own chips.
let diceTextures = [];
function buildTextureChips(row, apply) {
  if (!row) return;
  row.replaceChildren(); // dedicated texture row → just the thumbnails
  for (const t of diceTextures) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip texChip'; // thumbnail-only: the image IS the chip, name is the tooltip
    chip.dataset.tex = t.id;
    chip.title = t.name;
    chip.style.cssText =
      'width:34px;height:34px;padding:0;background-size:cover;background-position:center;border-radius:6px';
    chip.style.backgroundImage = `url("${t.url}")`;
    chip.onclick = () => apply(t.url);
    row.appendChild(chip);
  }
}
// Rebuild the Custom texture pickers and gate their menu buttons: no textures → no Custom button
// in the dice box; the inspector's Custom button is also gated on the piece being a die (on inspect).
function refreshTextureChips() {
  buildTextureChips(byId('trayTextures'), (url) => applyDiceFinish('custom', url));
  if (inspection) inspection.setDiceTextures(diceTextures);
  const has = diceTextures.length > 0;
  const tg = byId('trayCustomGroup');
  if (tg) tg.hidden = !has;
  const dg = byId('dieCustomGroup');
  if (dg && !has) dg.hidden = true;
}

// Whether a piece carries the per-piece snap-to-grid flag (like keep-upright).
const pieceSnap = (id) => {
  const piece = room?.state.pieces.get(id);
  return piece ? !!pieceProperty(piece, 'snap', false) : false;
};
// The authored N×N grid footprint for a piece (1 for every legacy/ordinary piece).
const pieceCells = (id) => {
  const piece = room?.state.pieces.get(id);
  return piece ? gridFootprintCells(piecePropsOf(piece)) : 1;
};
// Is this piece a TILE (a card/deck carrying a `tile` kind)? Drives tile-vs-card pickup sounds.
const pieceIsTile = (id) => {
  const piece = room?.state.pieces.get(id);
  return piece ? !!pieceProperty(piece, 'tile', false) : false;
};
// The drag target to actually send: snapped to the nearest cell for a snap-flagged piece
// on an active grid (so it tracks cell-to-cell as you drag), else the raw cursor point.
const snapXZ = (x, z) =>
  down && down.snap && gridActive(room.state.scale)
    ? snapToCell(x, z, room.state.scale, down.cells)
    : { x, z };
const skybox = createSkybox({ THREE, scene, renderer, deviceClass, byId });
window.OTT_BUILTIN_SKIES = BUILTIN_SKIES;
const roomSettings = createRoomSettings({
  scene,
  gridMesh,
  gridLiftFallback: MEASURE.lift,
  resizeTable,
  setTableColor,
  setRimWood,
  applyLighting,
  getQuality,
  setQuality,
  getRoom: () => room,
  onTableResize: rebuildSeats,
  syncWhiteboardSettings: (state) => whiteboard.syncSettings(state),
  relabelOverlays: () => overlays.relabel(),
  byId,
  setIcon,
});

const chat = createChat({ getRoom: () => room, byId });
const notebook = createNotebook({ getRoom: () => room, byId });
const scoreboard = createScoreboard({ getRoom: () => room, getRank: () => myRank, byId });
const timer = createTimer({ getRoom: () => room, byId, setIcon });
const membership = createMembership({
  getRoom: () => room,
  getSessionId: () => mySession,
  byId,
  applyIcons,
});

(async () => {
  const client = new Client(location.origin.replace(/^http/, 'ws'));
  const params = new URLSearchParams(location.search);
  if (params.get('workshop') === '1') window.OTT_EDITOR = true; // admins reach the library workshop via table.html?workshop=1
  const editorMode = !!window.OTT_EDITOR; // workshop mode: admin-only room + workshop chrome
  const code = (params.get('room') || 'LOBBY').toUpperCase(); // which table (handed over by the lobby)
  const authToken = localStorage.getItem('tabletop.token') || ''; // who you are (for the onAuth gate)
  const key = 'tt_token:' + code; // per-room reconnection token: survives refresh, distinct per table
  if (editorMode) {
    room = await client.joinOrCreate('editor', { token: authToken }); // admin-only workshop; no code, no reconnect
  } else {
    const saved = sessionStorage.getItem(key);
    if (saved) {
      try {
        room = await client.reconnect(saved);
      } catch (e) {
        room = null;
      }
    }
    if (!room) room = await client.joinOrCreate('table', { code, token: authToken });
    sessionStorage.setItem(key, room.reconnectionToken);
  }
  mySession = room.sessionId;
  if (!editorMode) {
    // room code, top-right — applyRole reveals it to GM+ only
    const rc = byId('roomCode');
    if (rc) {
      rc.textContent = 'Code: ' + code;
      rc.title = 'Click to copy';
      rc.onclick = () => {
        navigator.clipboard && navigator.clipboard.writeText(code);
      };
    }
  }
  const cb = getStateCallbacks(room); // Colyseus state-change callbacks (NOT jQuery)

  pieceView.bindRoom(room, cb, {
    onHydration: noteSceneHydration,
    onOwner: (id, owner) => {
      presence.updateHeldLabel(id, owner);
      if (owner && owner !== mySession && selection.has(id)) selection.remove(id);
    },
    onBoardTop: (height) => {
      boardTopY = height;
    },
    onRemove: (id, piece) => {
      colliderDebug.remove(id);
      if (piece.type === 'board') boardTopY = 0;
      if (inspection.isInspecting(id)) inspection.releaseInspect();
      presence.updateHeldLabel(id, '');
      selection.remove(id);
    },
    disposeSurface: (id) => {
      const surface = boardDropSurfaces.get(id);
      if (surface) disposeColliderSurface(surface.root);
      boardDropSurfaces.delete(id);
    },
  });

  overlays.bindRoom(room, cb, noteSceneHydration);

  whiteboard.bindRoom(room); // install replay handlers before the first state-driven request
  // Record one timestamped snapshot per piece on every patch (~the server patch
  // rate). The render loop plays these back interpolated and slightly delayed, so
  // motion stays smooth at any speed.
  room.onStateChange((state) => {
    pieceView.recordState(state);
    whiteboard.sync(state.whiteboard); // board visual, ownership, and holder status
    trays.sync(state.trays); // reflect personal trays appearing / being put away
    skybox.sync(state.skybox); // reflect the room's skybox
  });

  hand.bindRoom(room);
  bindLibraryMessages(room, {
    onDiceTextures: (list) => {
      diceTextures = list;
      refreshTextureChips();
    },
    byId,
    setIcon,
    setBtnLabel,
  });
  presence.bindMessages(room);
  bindPings(room);
  chat.bindRoom(room);
  notebook.bindRoom(room);
  let lastServerErrorAt = 0;
  room.onMessage('serverError', ({ message } = {}) => {
    const now = Date.now();
    if (now - lastServerErrorAt < 5000) return; // a cascading room failure should produce one useful notice, not an alert storm
    lastServerErrorAt = now;
    alert(
      typeof message === 'string' && message
        ? message
        : 'The table operation could not be completed. Try again.',
    );
  });
  room.onMessage('notice', ({ text, icon } = {}) => {
    if (text) toast(text, icon || 'check'); // soft server-side heads-up (e.g. the piece cap)
  });
  membership.bindMessages(room);

  // Library creation/editing is admin-only; hide those controls for everyone else,
  // leaving the spawn pickers + built-in shapes. (The server enforces it too.)
  room.onMessage('whoami', ({ isAdmin }) => {
    myIsAdmin = !!isAdmin;
    window.OTT_IS_ADMIN = myIsAdmin; // editor-panel.js gates library management on this
    if (window.onLibraryAdmin) window.onLibraryAdmin(); // re-render the library so admin-only buttons appear/hide
    document.body.classList.toggle('not-admin', !myIsAdmin);
    const rb = byId('roomBtn');
    if (rb && myIsAdmin) rb.hidden = false; // late whoami must not leave the menu hidden for an admin
  });

  // Forced exits: the GM kicked me, or the owner closed the room. These end the
  // session for good, so also drop the stale reconnection token — otherwise the
  // next visit tries to resume a seat the server already released, which logs
  // Colyseus's "reconnection token invalid" warning before falling back.
  let leaving = false;
  let exitReason = '';
  room.onMessage('roomClosed', () => {
    exitReason = 'This room was closed by the owner.';
    sessionStorage.removeItem(key);
  });
  room.onMessage('kicked', () => {
    exitReason = 'You have been removed from this room by a GM.';
    sessionStorage.removeItem(key);
  });
  room.onMessage('accessRevoked', () => {
    exitReason = 'Your sign-in or permissions changed. Return to the lobby to join again.';
    sessionStorage.removeItem(key);
  });
  room.onLeave(() => {
    if (!leaving) showExit(exitReason || 'You have been disconnected from the table.');
  });

  // Leaving on purpose is a deliberate leave (no reconnection window), so clear the
  // token before we go — re-entering the same room should join fresh, not reconnect.
  byId('lobbyBtn').onclick = () => {
    leaving = true;
    sessionStorage.removeItem(key);
    try {
      room.leave();
    } catch (e) {}
    location.href = '/';
  };

  if (editorMode) {
    // workshop chrome: no member management, back to the admin console, hand the room to the panel
    const mb = byId('membersBtn');
    if (mb) mb.hidden = true;
    const lb = byId('lobbyBtn');
    lb.querySelectorAll('.ico').forEach((i) => i.remove());
    lb.dataset.icon = 'arrow-back-up user-shield';
    {
      const l = lb.querySelector('.lbl');
      if (l) l.textContent = 'Admin';
    }
    lb.removeAttribute('aria-label');
    applyIcons(lb.parentNode);
    lb.onclick = () => {
      leaving = true;
      try {
        room.leave();
      } catch (e) {}
      location.href = '/admin.html';
    };
  }
  if (window.onOttRoom) window.onOttRoom(room); // hand the room to the library panel (editor + table)
  bindTableEffects(room);
  inspection.bindRoom(room);
  bindPieceDrag(room);

  presence.bindRoom(room, cb);

  // Durable scoreboard + room notes (synced like the timer). Register
  // unconditionally: right after join the nested fields haven't decoded yet
  // (room.state.scores is briefly undefined), but the callback proxy tracks them
  // by schema and fires once they arrive. renderScores guards the empty window.
  // The try/catch only covers a theoretical old server missing these fields.
  try {
    scoreboard.bindRoom(room, cb);
    roomSettings.bindRoom(room, cb);
    membership.bindRoom(room, cb);
  } catch (e) {
    /* older server without these fields — feature stays inert */
  }
  scoreboard.hydrate();
  membership.renderUnclaimed();
  roomSettings.hydrate();
  skybox.sync(room.state.skybox); // include the room's initial environment in the loading gate
  setTableVisible(true); // reveal only after the joined room's complete table appearance is applied
  void finishTableLoading();

  // The game table and the editor have different toolbars but share this file, so
  // every page-specific control is wired defensively (no-op if it isn't on the page).
  const wire = (id, fn) => {
    const el = byId(id);
    if (el) el.onclick = fn;
  };
  const menu = (btnId, grpId) => {
    const b = byId(btnId),
      g = byId(grpId);
    if (!b || !g) return;
    b.onclick = (e) => {
      e.stopPropagation();
      const open = g.hidden;
      qsa('.grp').forEach((x) => {
        if (x !== g) x.hidden = true;
      });
      g.hidden = !open;
    };
    g.onclick = (e) => e.stopPropagation();
    document.addEventListener('click', () => (g.hidden = true));
  };
  // Room Controls menu — the old spawn/add menus are gone; creation + spawning
  // now live in View Library, Built-Ins, and (editor) Add to Library.
  menu('roomBtn', 'roomGrp');
  menu('moreBtn', 'moreGrp'); // Settings + How to Play overflow
  // Members management now lives in the Room Info dock (GM-only #memberSection), populated by the
  // memberList push; no popout to open.
  // roomScene opens the Library on its Scenes tab — wired in editor-panel.js (which owns the panel).
  roomSettings.bindControls();
  whiteboard.bindControls(); // Room Settings config and the drawing toolbar
  wire('roomReset', () => {
    byId('roomGrp').hidden = true;
    if (confirm('Reset the table? This clears all pieces.')) room.send('reset');
  });
  overlays.bindControls(); // Measure pane kind picker and clear actions

  wire('roomSaveState', () => room.send('stateSave'));
  selection.bindModeControls();
  trays.bindControls(); // visit/leave the tray, spawn dice, roll, scoop, and clear
  {
    const setRow = byId('traySetSwatches'); // named dice sets: one click = a matching set for all my dice
    if (setRow)
      for (const s of DICE_SETS) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'swatch';
        chip.title = s.name + ' — set all my dice';
        chip.style.background = '#' + ((s.color >>> 0) & 0xffffff).toString(16).padStart(6, '0');
        chip.onclick = () => applyDiceSet(s.color); // saves defaults for every type + recolors my tray dice
        setRow.appendChild(chip);
      }
  }
  {
    const finRow = byId('trayFinishes'); // finishes: one click = that look for all my dice
    if (finRow) {
      for (const f of DICE_FINISHES) {
        if (f.key === 'custom') continue; // custom = the uploaded-texture chips appended below
        if (DICE_FINISH_FALLBACK[f.key] && deviceClass() === 'phone') continue; // GPU-heavy on phones
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.innerHTML = '<span class="lbl"></span>';
        chip.querySelector('.lbl').textContent = f.name;
        chip.title = f.name + ' — finish for all my dice';
        chip.onclick = () => applyDiceFinish(f.key);
        finRow.appendChild(chip);
      }
      refreshTextureChips(); // Custom textures live in their own #trayTextures menu
    }
  }
  presence.bindControls();
  {
    // Room Info dock: collapse to just the header (name + code). Starts collapsed on mobile/narrow.
    const rail = byId('roomInfo'),
      tog = byId('railToggle');
    if (rail && tog) {
      const apply = (c) => {
        rail.classList.toggle('collapsed', c);
        setIcon(tog, c ? 'chevron-right' : 'chevron-down');
        tog.setAttribute('aria-label', c ? 'Show room info' : 'Collapse');
      };
      tog.onclick = () => apply(!rail.classList.contains('collapsed'));
      apply(matchMedia('(pointer: coarse), (max-width: 720px)').matches); // set initial state + icon
    }
  }
  wire('reset', () => room.send('reset'));

  // Collider diagnostics (Settings → UI): a GM-only, local overlay. It reconstructs the server's
  // current primitive from synchronized props/count and never changes room or physics state.
  {
    const button = byId('colliderToggle');
    if (button) {
      button.onclick = () => {
        colliderDebug.setEnabled(!colliderDebug.isEnabled());
        syncColliderDebugButton();
      };
      syncColliderDebugButton();
    }
  }
  skybox.bindControls();
  // Audio settings (Tools menu): effects volume + mute, persisted client-side.
  const sfxVol = byId('sfxVol');
  {
    // Music open/close is handled by the top-right cluster (audioBtn → music pane; wireCluster below).
    // The audio keeps playing when the pane is closed — only the controls hide.
    if (sfxVol) {
      sfxVol.value = Math.round(getSfxVolume() * 100);
      sfxVol.oninput = () => setSfxVolume(sfxVol.value / 100);
    }
    const muteBtn = (btn, get, set, on, off) => {
      if (!btn) return;
      const sync = () => setIcon(btn, get() ? off : on);
      sync();
      btn.onclick = () => {
        set(!get());
        sync();
      };
    };
    muteBtn(byId('sfxMute'), getSfxMuted, setSfxMuted, 'ear', 'ear-off');
    muteBtn(byId('musicMute'), getMusicMuted, setMusicMuted, 'music', 'music-off');
    // background music
    const musicVol = byId('musicVol'),
      musicToggle = byId('musicToggle'),
      nowPlaying = byId('nowPlaying');
    if (musicVol) {
      musicVol.value = Math.round(getMusicVolume() * 100);
      musicVol.oninput = () => setMusicVolume(musicVol.value / 100);
    }
    const syncMusicBtn = () => {
      if (musicToggle) setIcon(musicToggle, isMusicPlaying() ? 'player-pause' : 'player-play');
    };
    if (musicToggle)
      musicToggle.onclick = () => {
        toggleMusic();
        syncMusicBtn();
      };
    wire('musicNext', () => {
      nextTrack();
      syncMusicBtn();
    });
    const shuffleBtn = byId('musicShuffle');
    if (shuffleBtn) {
      shuffleBtn.classList.toggle('on', getShuffle());
      shuffleBtn.onclick = () => {
        const on = !getShuffle();
        setShuffle(on);
        shuffleBtn.classList.toggle('on', on);
      };
    }
    onMusicTrack((t) => {
      if (nowPlaying)
        nowPlaying.textContent = t
          ? '\u266a ' + t.title + ' \u2014 ' + MUSIC_CREDIT.by + ' (' + MUSIC_CREDIT.license + ')'
          : '';
    });
    // credits panel — attribution for baked-in assets (CC-BY music requires this)
    const renderCredits = () => {
      const body = byId('creditsBody');
      if (!body) return;
      const esc = escapeHtml;
      const A = (t, u) =>
        u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(t) + '</a>' : esc(t);
      const ul = 'style="margin:4px 0 10px;padding-left:18px;font-size:var(--fs-sm)"';
      let h = '';
      if (MUSIC.length) {
        h += '<div class="showLabel"><b>Music</b></div><ul ' + ul + '>';
        for (const t of MUSIC)
          h +=
            '<li>' +
            esc(t.title) +
            ' \u2014 ' +
            A(MUSIC_CREDIT.by, MUSIC_CREDIT.url) +
            ', ' +
            A(MUSIC_CREDIT.license, MUSIC_CREDIT.licenseUrl) +
            '</li>';
        h += '</ul>';
      }
      h += '<div class="showLabel"><b>Sound effects</b></div><ul ' + ul + '>';
      for (const x of SFX_CREDITS)
        h += '<li>' + esc(x.title) + ' \u2014 ' + A(x.by, x.url) + ', ' + esc(x.license) + '</li>';
      h += '</ul>';
      h += '<div class="showLabel"><b>Models</b></div><ul ' + ul + '>';
      for (const x of MODEL_CREDITS)
        h +=
          '<li>' +
          esc(x.title) +
          ' \u2014 ' +
          A(x.by, x.url) +
          ', ' +
          esc(x.license) +
          (x.note ? ' \u2014 ' + esc(x.note) : '') +
          '</li>';
      h += '</ul>';
      h += '<div class="showLabel"><b>Art</b></div><ul ' + ul + '>';
      for (const x of ART_CREDITS)
        h +=
          '<li>' +
          esc(x.title) +
          ' \u2014 ' +
          A(x.by, x.url) +
          ', ' +
          esc(x.license) +
          (x.note ? ' \u2014 ' + esc(x.note) : '') +
          '</li>';
      h += '</ul>';
      h += '<div class="showLabel"><b>Libraries</b></div><ul ' + ul + '>';
      for (const l of LIB_CREDITS)
        h += '<li>' + A(l.title, l.url) + ' \u2014 ' + esc(l.license) + '</li>';
      h += '</ul>';
      body.innerHTML = h;
    };
    // Settings modal (reuses renderCredits above for the Credits section)
    const settingsModal = byId('settingsModal');
    wire('settingsBtn', () => {
      if (settingsModal) {
        settingsModal.hidden = false;
        renderCredits();
      }
    });
    wire('settingsClose', () => {
      if (settingsModal) settingsModal.hidden = true;
    });
    settingsModal?.querySelectorAll('.libTab').forEach(
      (t) =>
        (t.onclick = () => {
          settingsModal
            .querySelectorAll('.libTab')
            .forEach((x) => x.classList.toggle('on', x === t));
          settingsModal.querySelectorAll('.libPane').forEach((p) => {
            p.hidden = p.dataset.pane !== t.dataset.tab;
          });
        }),
    );
    // How-to-Play tabs (Mouse & Keyboard / Touch / Table & Tools / Coming Soon).
    const helpModal = byId('controlsModal');
    helpModal?.querySelectorAll('.libTab').forEach(
      (t) =>
        (t.onclick = () => {
          helpModal.querySelectorAll('.libTab').forEach((x) => x.classList.toggle('on', x === t));
          helpModal.querySelectorAll('.libPane').forEach((p) => {
            p.hidden = p.dataset.pane !== t.dataset.tab;
          });
        }),
    );

    // Full / Compact UI toggle (persisted)
    const uiModeToggle = byId('uiModeToggle');
    const syncUiMode = () => {
      const full = document.body.classList.contains('ui-full');
      if (uiModeToggle) {
        const mode = full ? 'Default UI' : 'Compact UI';
        setIcon(uiModeToggle, full ? 'arrows-minimize' : 'arrows-maximize');
        uiModeToggle.classList.toggle('on', full);
        uiModeToggle.setAttribute('aria-pressed', full ? 'true' : 'false');
        uiModeToggle.setAttribute('aria-label', mode);
        const l = uiModeToggle.querySelector('.lbl');
        if (l) l.textContent = mode;
      }
    };
    syncUiMode();
    wire('uiModeToggle', () => {
      const full = document.body.classList.toggle('ui-full');
      localStorage.setItem('ott-ui-full', full ? '1' : '0');
      syncUiMode();
    });
    // Accent color (personal, saved on this device)
    const applyAccent = (hex) => {
      if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
      const st = document.documentElement.style;
      st.setProperty('--accent', hex);
      st.setProperty(
        '--accent-soft',
        'rgba(' +
          parseInt(hex.slice(1, 3), 16) +
          ',' +
          parseInt(hex.slice(3, 5), 16) +
          ',' +
          parseInt(hex.slice(5, 7), 16) +
          ',.25)',
      );
      localStorage.setItem('ott-accent', hex);
      document
        .querySelectorAll('#accentPicker .accDot')
        .forEach((d) =>
          d.classList.toggle('on', d.dataset.accent.toLowerCase() === hex.toLowerCase()),
        );
      const c = byId('accentCustom');
      if (c) c.value = hex;
    };
    document
      .querySelectorAll('#accentPicker .accDot')
      .forEach((d) => (d.onclick = () => applyAccent(d.dataset.accent)));
    const accCust = byId('accentCustom');
    if (accCust) accCust.oninput = () => applyAccent(accCust.value);
    applyAccent(localStorage.getItem('ott-accent') || '#c9a25a');
    // Track list (7i): inline inside the Sound pane now — the pop-out is gone,
    // so #tracksLink just discloses #tracksBody in place.
    const renderTracks = () => {
      const body = byId('tracksBody');
      if (!body) return;
      if (!MUSIC.length) {
        body.innerHTML = '<div class="muted">No tracks added yet.</div>';
        return;
      }
      const esc = escapeHtml;
      const cur = currentTrackIndex();
      body.innerHTML = MUSIC.map(
        (t, i) => '<button class="trackItem" data-i="' + i + '">' + esc(t.title) + '</button>',
      ).join('');
      body.querySelectorAll('.trackItem').forEach((btn) => {
        btn.classList.toggle('on', +btn.dataset.i === cur);
        btn.onclick = () => {
          playTrack(+btn.dataset.i);
          syncMusicBtn();
          renderTracks();
        };
      });
    };
    wire('tracksLink', (e) => {
      if (e && e.preventDefault) e.preventDefault();
      const body = byId('tracksBody');
      if (!body) return;
      const open = body.hidden;
      if (open) renderTracks();
      body.hidden = !open;
      byId('tracksLink')?.classList.toggle('on', open);
    });
  }
  chat.bindControls();
  notebook.bindControls();

  scoreboard.bindControls();
  timer.bindControls();

  hand.bindShowControls();
})().catch((err) => {
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
  box.style.cssText =
    'color:#e8e6e0;font:16px/1.5 system-ui,sans-serif;padding:48px;text-align:center;max-width:520px;margin:10vh auto';
  box.textContent = msg;
  const link = document.createElement('a');
  link.href = '/';
  link.textContent = '← Back to lobby';
  link.style.cssText = 'color:#c9a25a;display:block;margin-top:20px;text-decoration:none';
  box.appendChild(link);
  document.body.appendChild(box);
}

// ===== Interaction — click vs. drag; the meaning depends on the piece ========
// Adoption must read the current gesture when the server responds, including after release.
function bindPieceDrag(room) {
  room.onMessage('dealt', ({ id }) => {
    // a card you dragged off a deck — adopt it as the dragged piece
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
}

const ray = new THREE.Raycaster(),
  pointer = new THREE.Vector2();
const GRAB_HEIGHT = CONFIG.grab.height; // float height when a piece is first grabbed (scroll to raise/lower)
// A finger sits ON the piece it is holding, where a cursor only points at it, so a touch grab
// starts higher — enough to clear the fingertip without changing where anything lands. Keyed off
// the gesture, not the device: a laptop with a touchscreen gets the right lift for each grab.
const grabHeightFor = (touch) => GRAB_HEIGHT * (touch ? CONFIG.grab.touchLift : 1);
const DRAG_MIN = CONFIG.grab.min,
  DRAG_MAX = CONFIG.grab.max,
  DRAG_STEP = CONFIG.grab.step;
const DECK_DRAG_HEIGHT = CONFIG.grab.deckHeight; // dealt cards ride this high to clear the deck
const DRAG_ROTATE_RAD_PER_PX = 0.01,
  DRAG_ROTATE_SNAP = Math.PI / 12; // Alt-drag: ~0.57°/px, snapped to 15° unless Shift is held
const ROT_STEP = Math.PI / 24; // ~7.5° per tick for the held ⟲ / ⟳ buttons and the A/D keys

// Turn the held piece (or the whole selection) by `raw` radians. Shared by the mouse's Alt-drag
// dial and the touch two-finger twist, so both snap identically and neither loses sub-step
// motion: the raw angle accumulates, and only the *applied* delta goes to the server.
// Unsnapped mode is capped near the move send rate; snapped steps send the moment they land,
// and the 15° quantum doubles as the dead zone that keeps a stray finger from nudging a piece.
function applyHeldRotation(raw, fine = false) {
  if (!(down && down.grabbed) || !room) return;
  down.rotateRaw += raw;
  const angle = fine
      ? down.rotateRaw
      : Math.round(down.rotateRaw / DRAG_ROTATE_SNAP) * DRAG_ROTATE_SNAP,
    delta = angle - down.rotateSent,
    now = performance.now();
  if (Math.abs(delta) > 1e-4 && (!fine || now - down.lastRotateSent > 16)) {
    room.send('rotateGroup', { ids: down.group ? selection.ids() : [down.id], angle: delta });
    down.rotateSent = angle;
    down.lastRotateSent = now;
  }
}
let dragHeight = GRAB_HEIGHT;
let holdSig = -1; // visibility signature for the clustered height/rotate controls (synced each frame)
// XZ correction applied to the drag raycast. A two-finger transform holds the piece still while
// the fingers travel, so when it ends the finger no longer points at the piece. Without this the
// piece snaps to the finger — and, because that jump lands inside the throw estimator's window,
// gets flung at the speed of the jump. Re-anchoring keeps the piece put and preserves the offset
// for the rest of the drag.
const dragOffset = new THREE.Vector3();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
  hit = new THREE.Vector3(); // fixed ground plane (y=0); drag height is applied as a separate Y offset
const prevTarget = new THREE.Vector3(),
  throwVel = new THREE.Vector3(); // hand speed → throw velocity
let lastMoveSent = 0,
  prevThrowTime = 0,
  down = null;
let armedMove = null; // touch: a piece id whose next drag repositions it (the deck/dispenser "Move" menu item) instead of dealing
const sfxKind = (t) =>
  t === 'card' ? 'card' : t === 'die' ? 'die' : t === 'deck' ? 'deck' : 'object'; // pickup family
// "Lean in": a Tools toggle that dollies the camera toward the orbit target for a
// closer look. Applied as a per-frame visual offset (undone before controls.update)
// so it never corrupts the real orbit distance; toggle off and it eases back.
let leanActive = false,
  leanT = 0;
const leanOffset = new THREE.Vector3();
const LEAN_AMOUNT = 0.35; // fraction of the way to the target at full lean (a knob)
const cameraPanForward = new THREE.Vector3(),
  cameraPanRight = new THREE.Vector3(),
  cameraPanDelta = new THREE.Vector3();

// Translate the camera and OrbitControls target together, relative to the current view. This
// preserves orbit distance/angle and makes W/Up mean "toward the top of the table as I see it".
function panCamera(rightAmount, forwardAmount) {
  if (
    !room ||
    inspection.isActive() ||
    whiteboard.isOwning() ||
    trays.isViewing() ||
    trays.isCameraMoving()
  )
    return;
  cameraPanForward.copy(controls.target).sub(camera.position);
  cameraPanForward.y = 0;
  if (cameraPanForward.lengthSq() < 1e-8) cameraPanForward.set(0, 0, -1);
  else cameraPanForward.normalize();
  cameraPanRight.crossVectors(cameraPanForward, camera.up).normalize();
  cameraPanDelta
    .copy(cameraPanRight)
    .multiplyScalar(rightAmount)
    .addScaledVector(cameraPanForward, forwardAmount)
    .multiplyScalar(CONFIG.input.panStep);
  camera.position.add(cameraPanDelta);
  controls.target.add(cameraPanDelta);
}

// Convert a pointer event to normalized device coordinates (−1..1) for raycasting.
const setPointer = (e, leadPx = 0) => {
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -((e.clientY - leadPx) / innerHeight) * 2 + 1;
};

// The piece id under the pointer, if any. Model children live below the
// id-stamped group, so walk up until we reach the stamped ancestor.
const pickId = (radiusPx = 0) => {
  const roots = [...meshes.values()].map((m) => m.mesh);
  const pickAt = (p) => {
    ray.setFromCamera(p, camera);
    let obj = ray.intersectObjects(roots)[0]?.object;
    while (obj && obj.userData.id === undefined) obj = obj.parent;
    const id = obj && obj.userData.id;
    // Boards are static play surfaces, not pieces. Treat their visible mesh like empty table space
    // so clicks can orbit/deselect and never capture a futile grab gesture.
    return id && meshes.get(id)?.type !== 'board' ? id : null;
  };
  const direct = pickAt(pointer);
  if (direct || radiusPx <= 0) return direct;

  // A fingertip hides small pieces and is much less precise than a cursor. Probe a small ring in
  // screen space only after the exact ray misses; this enlarges the touch target without changing
  // the rendered model, its collider, or accurate mouse picking. Nearest samples win.
  const rect = renderer.domElement.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return null;
  const sample = new THREE.Vector2();
  for (const r of [radiusPx * 0.5, radiusPx]) {
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      sample.set(
        pointer.x + (2 * Math.cos(a) * r) / rect.width,
        pointer.y - (2 * Math.sin(a) * r) / rect.height,
      );
      const id = pickAt(sample);
      if (id) return id;
    }
  }
  return null;
};

// Canvas input (context-menu, middle-click, wheel, dblclick) is wired via public/controls.js —
// see the INPUT intent map at the end of this file.
{
  const b = byId('controlsBtn');
  if (b)
    b.onclick = () => {
      byId('controlsModal').hidden = false;
    };
} // open How to Play
{
  const b = byId('controlsClose');
  if (b)
    b.onclick = () => {
      byId('controlsModal').hidden = true;
    };
}
{
  const b = byId('leanBtn');
  if (b)
    b.onclick = () => {
      leanActive = !leanActive;
      b.classList.toggle('on', leanActive);
      const t = leanActive ? 'Lean Out' : 'Lean In';
      const l = b.querySelector('.lbl');
      if (l) l.textContent = t;
      b.setAttribute('aria-label', t);
    };
} // toggle the closer-look camera (keep the icon; relabel only)
{
  // Drop hand (UI_Redesign 7j / mockup 9e): the orientation IS the button — two
  // taps' worth of dialog for a two-outcome action was the whole problem.
  const dropAt = (faceDown) => {
    if (!room) return;
    const n = byId('hand')?.querySelectorAll('.handcard').length || 0;
    room.send('handToTable', {
      faceDown,
      ...presence.handDropPosition(),
    }); // just in front of the marker
    toast(
      (n ? n + ' card' + (n === 1 ? '' : 's') : 'Hand') +
        ' laid out ' +
        (faceDown ? 'face-down' : 'face-up'),
      'check',
      { label: 'Undo', fn: () => room.send('handFromTable') },
    );
  };
  const dropBtn = byId('dropBtn');
  const dropChoices = byId('dropChoices');
  const setDropOpen = (open) => {
    if (!dropBtn || !dropChoices) return;
    dropChoices.hidden = !open;
    dropBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  dropBtn?.addEventListener('click', () => setDropOpen(dropChoices.hidden));
  byId('dropDown')?.addEventListener('click', () => {
    setDropOpen(false);
    dropAt(true);
  });
  byId('dropUp')?.addEventListener('click', () => {
    setDropOpen(false);
    dropAt(false);
  });
}

// Map a click-action name to the server message it sends.
const sendAction = (action, id) => {
  if (action === 'takeCard') {
    room.send('takeCard', { id });
    playSfx(pieceIsTile(id) ? 'tile-pickup' : 'card-pickup');
  } else if (action === 'drawToHand') {
    room.send('drawToHand', { deckId: id });
    playSfx(pieceIsTile(id) ? 'tile-pickup' : 'card-pickup');
  } else if (action === 'deal') room.send('dealToTable', { deckId: id });
  else if (action === 'dispense') {
    room.send('dispense', { id });
    playSfx('object-pickup');
  } else if (action === 'flip') room.send('flip', { id });
  else if (action === 'shuffle') room.send('shuffle', { deckId: id });
  else if (action === 'roll') room.send('rollOne', { id });
};

// Handle a click (no drag). A left-click on an inspectable piece or a deck waits
// briefly for a possible double-click (inspect / draw); everything else fires now.
function handleClick(gesture) {
  const { id, type } = gesture;

  // Right-click raises the piece's menu — the same list the touch long-press builds — for every
  // kind BUT a card. A card's whole vocabulary is take / move / flip, so a menu is more work than
  // the gesture it replaces. Everything else has verbs that were otherwise keys-only or
  // undiscoverable, and a prop or a board had no right-click action at all (KIND gives them no
  // `rclick`), so the menu is what right-click means there now.
  //
  // A right-DRAG is unaffected: handleClick only runs when the gesture never became a drag, so a
  // deck or dispenser still moves on right-drag. The menu also absorbs the two deck shortcuts it
  // replaces — Shuffle was the single right-click, Split the double — which is why secondary no
  // longer takes part in the deferred double-click below.
  const route = clickRoute(type, gesture.secondary, inspection.isInspectable(type));
  if (route === 'menu') {
    openPieceMenu(id, { x: gesture.sx, y: gesture.sy });
    return;
  }
  if (route === 'verb') {
    sendAction(gesture.primary ? gesture.kind.lclick : gesture.kind.rclick, id);
    return;
  }

  inspection.handleDeferredClick(id, type, gesture.kind.lclick);
}
const onPointerDown = (e) => {
  const wasArmed = armedMove;
  armedMove = null; // Move is one-shot: this press consumes it (if on that piece) or cancels it
  if (overlays.isMeasuring()) {
    // Measure mode: left-drag lays the selected overlay (A = press)
    if (overlays.beginMeasure(e)) {
      controls.enabled = false;
      renderer.domElement.setPointerCapture(e.pointerId);
    }
    return;
  }
  if (whiteboard.isOwning()) {
    // drawing on the whiteboard: start a stroke
    if (e.primary) {
      setPointer(e);
      if (whiteboard.beginStroke()) renderer.domElement.setPointerCapture(e.pointerId);
    }
    return;
  }
  if (inspection.beginPointer(e)) return;
  if (!room || (!e.primary && !e.secondary)) return;
  setPointer(e);
  const id = pickId(e.touch ? CONFIG.input.touchHitPx : 0);
  // Multi-select gesture: the additive modifier (Shift) or the Select tool. Click a piece → toggle
  // it in/out; drag empty felt → marquee box. Consumes the gesture so it never grabs or orbits.
  if (selection.beginPointer(e, id)) {
    controls.enabled = false;
    renderer.domElement.setPointerCapture(e.pointerId);
    down = null;
    return;
  }
  if (!id) {
    // no piece under the cursor
    if (e.primary) {
      if (overlays.beginMove(e)) {
        // left-click an overlay you own (or GM) → select + drag to move
        controls.enabled = false;
        renderer.domElement.setPointerCapture(e.pointerId);
        down = null;
        return;
      }
      overlays.select(null); // left-click empty felt → deselect
      selection.clear(); // …and drop any multi-selection (design-tool convention)
    }
    down = null;
    return; // empty felt → let OrbitControls orbit/pan
  }
  const type = meshes.get(id).type;
  // A left-drag on a SELECTED piece moves the whole selection; dragging an unselected piece drops
  // the selection first (design-tool convention). Right-drag (decks) is never a group move.
  const group = e.primary && selection.has(id);
  if (e.primary && !selection.has(id)) selection.clear();
  down = {
    id,
    type,
    kind: KIND[type],
    touch: e.touch,
    forceMove: wasArmed === id,
    primary: e.primary,
    secondary: e.secondary,
    sx: e.clientX,
    sy: e.clientY,
    dragging: false,
    grabbed: false,
    snap: pieceSnap(id),
    cells: pieceCells(id),
    group,
    rotateOnPress: e.rotate,
    rotating: false,
    rotateX: e.clientX,
    rotateRaw: 0,
    rotateSent: 0,
    lastRotateSent: 0,
    transformed: false,
  };
  dragOffset.set(0, 0, 0); // each grab starts anchored to its own finger
  controls.enabled = false; // this gesture belongs to the piece
  dragHeight = grabHeightFor(e.touch); // the lift offset; XZ tracks the fixed ground plane
  renderer.domElement.setPointerCapture(e.pointerId);
};

// wheel (raise/lower a held piece) → public/controls.js → INPUT.raiseAxis

const onPointerMove = (e) => {
  if (selection.movePointer(e)) return;
  if (overlays.isMeasuring()) {
    // live local preview of the overlay being dragged out
    overlays.updateMeasure(e);
    return;
  }
  if (whiteboard.isOwning()) {
    // extend the current stroke along the board surface
    if (whiteboard.isDrawing()) {
      setPointer(e);
      whiteboard.extendStroke();
    }
    return;
  }
  if (inspection.movePointer(e)) return;
  if (overlays.isMoving()) {
    // dragging a selected overlay: translate both ends, synced (throttled)
    overlays.updateMove(e);
    return;
  }
  if (!down) return;
  // Once a touch owns a piece, aim the drag ray above the fingertip so the hand never hides the
  // object or its exact drop point. The initial hit-test still happens directly under the finger.
  setPointer(e, down.touch ? CONFIG.input.touchLeadPx : 0);
  ray.setFromCamera(pointer, camera);
  ray.ray.intersectPlane(dragPlane, hit);
  hit.y = dragHeight; // XZ from the fixed ground plane; height is the independent lift offset
  if (down.grabbed) {
    hit.x += dragOffset.x; // zero until a two-finger transform re-anchors the drag
    hit.z += dragOffset.z;
  }

  // First move past the click threshold decides what this drag means.
  if (!down.dragging) {
    if (Math.hypot(e.clientX - down.sx, e.clientY - down.sy) < CONFIG.input.dragPx) return; // still a click
    down.dragging = true;
    const kind = down.kind;
    const movesThis = down.forceMove || (kind.grab === 2 ? down.secondary : down.primary); // this kind's move button — or an armed touch "Move"
    if (movesThis) {
      // the button that moves this kind (2 = deck, 0 = most)
      down.grabbed = true;
      heldTarget.copy(hit);
      prevTarget.copy(hit);
      prevThrowTime = performance.now();
      throwVel.set(0, 0, 0);
      if (down.group)
        room.send('grabGroup', { ids: selection.ids(), anchor: down.id }); // claim the whole selection
      else room.send('grab', { id: down.id });
      playSfx(
        pieceIsTile(down.id)
          ? down.type === 'deck'
            ? 'tiledeck-pickup'
            : 'tile-pickup'
          : sfxKind(down.type) + '-pickup',
      ); // local, per object type (tiles/tile-boxes get their own)
      {
        const t = snapXZ(hit.x, hit.z);
        if (down.group) room.send('moveGroup', { x: t.x, y: hit.y, z: t.z });
        else room.send('move', { id: down.id, x: t.x, y: hit.y, z: t.z });
      }
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
      heldTarget.copy(hit);
      prevTarget.copy(hit);
      prevThrowTime = performance.now();
      throwVel.set(0, 0, 0);
      if (dealing) room.send('dealDrag', { deckId: down.id, x: hit.x, y: hit.y, z: hit.z });
      else room.send('dispenseDrag', { id: down.id, x: hit.x, y: hit.y, z: hit.z });
      playSfx(dealing ? (pieceIsTile(down.id) ? 'tile-pickup' : 'card-pickup') : 'object-pickup'); // the new piece's drop follows on release
    }
  }

  if (down.grabbed) {
    if (e.transforming) {
      // A two-finger transform owns this gesture: the twist/pinch arrive as their own intents
      // (rotateHeld / raiseAxis), so the moving finger must not also drag the piece across the
      // felt. Freeze XZ the way the Alt-drag dial does, and keep the throw estimator anchored to
      // where the piece actually is, so lifting a finger can never fling it.
      throwVel.set(0, 0, 0);
      prevTarget.copy(heldTarget);
      prevThrowTime = performance.now();
      down.transformed = true; // the next plain move must re-anchor rather than snap
      return;
    }
    if (e.rotate) {
      // Alt turns the held-piece drag into a horizontal rotation dial. Accumulate raw pointer
      // motion so snapped rotation does not lose sub-step movement; Shift exposes that raw angle.
      if (!down.rotating) {
        down.rotating = true;
        if (!down.rotateOnPress) down.rotateX = e.clientX; // Alt pressed after the grab: anchor here
      }
      const raw = (e.clientX - down.rotateX) * DRAG_ROTATE_RAD_PER_PX;
      down.rotateX = e.clientX;
      applyHeldRotation(raw, e.fineRotate);
      throwVel.set(0, 0, 0); // rotating in place should never turn into a throw on release
      prevThrowTime = performance.now();
      return;
    }
    down.rotating = false;
    down.rotateOnPress = false;
    if (down.transformed) {
      // The transform just ended. The fingers moved while the piece stayed put, so bank that
      // separation as an offset instead of letting the piece jump to the finger (see drag.js —
      // the jump is also what flings it, since it lands inside the throw estimator's window).
      down.transformed = false;
      const o = reanchorOffset(heldTarget, hit, dragOffset);
      dragOffset.x = o.x;
      dragOffset.z = o.z;
      hit.x = heldTarget.x;
      hit.z = heldTarget.z;
    }
    heldTarget.copy(hit);
    const now = performance.now(),
      dt = (now - prevThrowTime) / 1000;
    if (dt > 0 && dt < 0.1)
      throwVel.lerp(
        hit
          .clone()
          .sub(prevTarget)
          .multiplyScalar(1 / dt),
        0.4,
      ); // smooth the hand speed
    prevTarget.copy(hit);
    prevThrowTime = now;
    if (now - lastMoveSent > 16) {
      const t = snapXZ(hit.x, hit.z);
      if (down.group) room.send('moveGroup', { x: t.x, y: hit.y, z: t.z });
      else room.send('move', { id: down.id, x: t.x, y: hit.y, z: t.z });
      lastMoveSent = now;
    } // ~60Hz throttle
  }
};
const endGesture = (e) => {
  if (selection.endPointer(e)) {
    try {
      renderer.domElement.releasePointerCapture(e.pointerId);
    } catch {}
    controls.enabled = !inspection.isActive();
    return;
  }
  if (overlays.isMeasuring()) {
    // release: commit the overlay if the drag was long enough
    if (overlays.finishMeasure(e)) {
      controls.enabled = true;
      try {
        renderer.domElement.releasePointerCapture(e.pointerId);
      } catch {}
    }
    return;
  }
  if (whiteboard.isOwning()) {
    // finish the stroke and send it
    if (whiteboard.isDrawing()) whiteboard.endStroke();
    try {
      renderer.domElement.releasePointerCapture(e.pointerId);
    } catch {}
    return;
  }
  if (inspection.endPointer(e)) return;
  if (overlays.isMoving()) {
    // release a moved overlay: commit its final position
    overlays.finishMove(e);
    controls.enabled = true;
    try {
      renderer.domElement.releasePointerCapture(e.pointerId);
    } catch {}
    return;
  }
  if (!down) return;
  if (down.grabbed) {
    const throwVector =
      down.kind.grab === 2 || down.kind.heavy ? [0, 0, 0] : [throwVel.x, throwVel.y, throwVel.z]; // decks & mats don't fly
    if (down.group) room.send('releaseGroup', { v: throwVector });
    else room.send('release', { id: down.id, v: throwVector });
  } else if (!down.dragging) {
    // a click / tap
    handleClick(down);
  }
  controls.enabled = !inspection.isActive(); // stay disabled if this click just entered inspect
  try {
    renderer.domElement.releasePointerCapture(e.pointerId);
  } catch {}
  down = null;
};
// pointerdown / pointermove / pointerup / pointercancel → public/controls.js → INPUT.press / move / release
// dblclick (claim the whiteboard) → public/controls.js → INPUT.doubleClick

// The piece to act on for a keyboard shortcut: the held one, else whatever's hovered.
const heldOrHoveredId = () => (down && down.id) || pickId();

// Keyboard shortcuts (ignored while typing in an input). Delete/Backspace removes
// a piece, U toggles its upright/flat behaviour, G toggles its snap-to-grid.
// The held rotate/raise keys (A/D/W/S and the arrows) are NOT here — they repeat while
// held, so the keyboard profile in controls.js owns them and raises rotateAxis / raiseAxis.
const onKeyDown = (e) => {
  if (!room) return;
  if (e.key === 'Escape' && trays.isViewing()) {
    trays.close();
    return;
  }
  if (e.key === 'Escape' && selection.escape()) return;
  if (e.key === 'Escape' && overlays.isMeasuring()) {
    const r = byId('regionTR');
    if (r && r._close) r._close();
    else overlays.exit();
    return;
  }
  if (e.key === 'Escape' && whiteboard.isOwning()) {
    whiteboard.release();
    return;
  }
  if (e.key === 'Escape' && inspection.isActive()) {
    inspection.releaseInspect();
    return;
  }
  if (e.key === 'Escape' && overlays.hasSelection()) {
    overlays.select(null);
    return;
  }
  const typing =
    document.activeElement &&
    (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
  if (typing) return;

  if (inspection.isDrawn()) {
    // f/d/h/r place a drawn card. This sits BELOW the typing guard: it used to sit above it, so
    // typing "d" in chat with a peek open dealt the card face-down.
    const where = { f: 'field-up', d: 'field-down', h: 'hand', r: 'deck' }[e.key.toLowerCase()];
    if (where) {
      inspection.placeDrawn(where);
      return;
    }
  }

  if (selection.command(e.key)) return;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (e.key === 'Backspace') e.preventDefault();
    if (overlays.removeSelected()) return; // a selected overlay takes priority
    if (selection.removeSelected()) return;
    const id = heldOrHoveredId();
    if (id) {
      room.send('remove', { id });
      if (down && down.id === id) {
        down = null;
        controls.enabled = true;
      }
    }
  } else if (e.key === 'u' || e.key === 'U') {
    // toggle keep-upright / lie-flat
    const id = heldOrHoveredId();
    if (id) room.send('setStand', { id });
  } else if (e.key === 'g' || e.key === 'G') {
    // toggle snap-to-grid for this piece
    const id = heldOrHoveredId();
    if (id) room.send('setSnap', { id });
  } else if ((e.key === 'p' || e.key === 'P') && !e.repeat) {
    // ping the table at the cursor
    sendPing();
  }
};

const hand = createHand({
  scene,
  camera,
  renderer,
  ray,
  pointer,
  dragPlane,
  hit,
  setPointer,
  cardMesh,
  parseCardFront,
  cardPreviewURL,
  applyIcons,
  setIcon,
  getRoom: () => room,
  getSessionId: () => mySession,
  inspectMesh: (mesh, opts) => inspection.inspectMesh(mesh, opts),
  syncControlGuide,
  byId,
  dragThreshold: CONFIG.input.handPx,
  toast,
});
inspection = createInspection({
  THREE,
  scene,
  camera,
  controls,
  canvas: renderer.domElement,
  kinds: KIND,
  config: CONFIG,
  deviceClass,
  getRoom: () => room,
  getPieceVisual: (id) => meshes.get(id),
  setOriginalVisible,
  meshPropsOf,
  byId,
  queryAll: qsa,
  setBtnLabel,
  buildTextureChips,
  saveDiceDefault,
  clearDiceDefault,
  onReleaseHand: () => hand.render(),
  onSingleClick: sendAction,
});
inspection.setDiceTextures(diceTextures);
const presence = createPresence({
  THREE,
  scene,
  camera,
  controls,
  cardMesh: KIND.card.mesh,
  makePlayerTexture,
  makeYouChipTexture,
  nameTag,
  disposeSprite,
  resizeToCanvas,
  seatAngle,
  setSeatCameraReady,
  label: CONFIG.label,
  getRoom: () => room,
  getSessionId: () => mySession,
  getRank: () => myRank,
  getPieceVisual: (id) => meshes.get(id),
  getRevealed: hand.revealedFor,
  setRevealed: hand.setRevealed,
  clearRevealed: hand.clearRevealed,
  onLocalRole: applyRole,
  onPlayersChanged: () => membership.renderUnclaimed(),
  onPlayerRemoved: (sid) => overlays.clearDragPreview(sid),
  onHydration: noteSceneHydration,
  byId,
});

// Seat visuals and the shared track follow table size; camera reframing remains explicit.
function rebuildSeats() {
  if (!room || !room.state) return;
  presence.rebuildSeats();
  whiteboard.position();
  trays.position();
}

// Show/hide the toolbar by the player's per-room role. Courtesy only — the server
// gates every one of these actions too, so hiding a button protects no one; it
// just keeps people from clicking things that would be ignored.
function applyRole(role) {
  myRank = rankOf(role);
  const rank = myRank;
  const gate = (id, min) => {
    const el = byId(id);
    if (el) el.hidden = rank < min;
  };
  {
    // Room Controls menu: GM+ OR admin — the admin-only items live in this menu now
    const rb = byId('roomBtn');
    if (rb) rb.hidden = rank < 2 && !myIsAdmin;
    if (room) room.send('whoami'); // re-fetch on join/reconnect — onJoin's push doesn't repeat
  }
  document.body.classList.toggle('not-gm', rank < 2); // mirrors .not-admin; gates .gm-only
  syncColliderDebugButton();
  colliderDebug.sync();
  gate('memberSection', 2); // Members management (dock): GM+
  if (rank >= 2 && room) room.send('members'); // (re)fetch on join/reconnect/promotion — allowReconnection skips onJoin's push, so the dock would otherwise stay blank after a refresh
  gate('lib2Btn', 1); // Library (combined): Helper+
  // Within those modals, boards/skyboxes/scenes are GM+ — helpers only spawn decks + objects.
  const gmTabs = (modalId, tabs) =>
    tabs.forEach((t) => {
      const el = qs(`#${modalId} .libTab[data-tab="${t}"]`);
      if (el) el.hidden = rank < 2;
    });
  gmTabs('libraryModal', ['boards', 'sky', 'scenes', 'games']); // GM-only tabs within the combined library
  gate('roomCode', 2); // room code display: GM+/owner/admin only
  gate('ctrlHelper', 1);
  gate('ablGM', 2); // How-to-Play sections revealed by role
  gate('ctrlGM', 2); // How-to-Play sections revealed by role
  gate('reset', 2);
  gate('scenesBtn', 2);
  gate('membersBtn', 2); // legacy standalone buttons (editor / older pages)
  gate('measureClearAll', 2); // "Clear all overlays" (Measure panel): GM+
  if (window.OTT_EDITOR) {
    const mb = byId('membersBtn');
    if (mb) mb.hidden = true;
  } // no member mgmt in the workshop
  scoreboard.applyRole(); // scoreboard (helper+) and notes (gm+) edit affordances
}

// Hover readout: a small tooltip over the deck or dispenser under the cursor showing
// how many are left inside (∞ for the infinite go bowl). Pure client-side, shown only
// when idle (not mid-drag / inspect / draw / measure), and kept live by the render loop
// so it updates as a piece is dealt or dispensed without moving the cursor.
const hoverTip = document.createElement('div');
hoverTip.id = 'hoverCount';
hoverTip.hidden = true;
document.body.appendChild(hoverTip);
const controlGuide = document.createElement('aside');
controlGuide.id = 'controlGuide';
controlGuide.setAttribute('aria-label', 'Available controls');
controlGuide.hidden = true;
document.body.appendChild(controlGuide);
const controlGuidePointer = matchMedia('(hover: hover) and (pointer: fine)');
let hoverId = null,
  lastHover = 0,
  controlGuideSig = '';
const hoverIdle = () =>
  !down &&
  !inspection.isActive() &&
  !overlays.isMeasuring() &&
  !whiteboard.isOwning() &&
  !overlays.isMoving() &&
  !hand.isDragging() &&
  !overlays.isDraggingMeasure();
function countLabel(piece) {
  if (piece.type === 'deck') return `${piece.count} card${piece.count === 1 ? '' : 's'}`;
  const d = dispenserDefinition(JSON.parse(piece.props || '{}'));
  if (!d) return null;
  return d.infinite ? '∞' : String(piece.count); // bowl = unlimited
}
function hideHoverTip() {
  if (!hoverTip.hidden) hoverTip.hidden = true;
  hoverId = null;
  syncControlGuide();
}

const PIECE_CONTROL_NAMES = {
  card: 'Card',
  deck: 'Deck',
  die: 'Die',
  prop: 'Object',
  dispenser: 'Dispenser',
  mat: 'Mat',
};
function pieceControlRows(type, held) {
  if (held) {
    const kind = KIND[type];
    return [
      ['Mouse', 'Move'],
      ['Release', kind.grab === 2 || kind.heavy ? 'Drop' : 'Drop / throw'],
      ['W S / ↑ ↓ / wheel', 'Raise / lower'],
      ['A D / ← → / Alt-drag', 'Rotate'],
      ['Shift + Alt-drag', 'Rotate freely'],
      ['Middle-click', 'Turn 45°'],
      ['G', 'Snap to grid'],
      ...(type === 'mat' ? [] : [['U', 'Stand / lay flat']]),
      ['Delete', 'Remove'],
    ];
  }
  const rows = [];
  if (type === 'deck')
    rows.push(
      ['Left-drag', 'Deal a card'],
      ['Left-click', 'Draw to hand'],
      ['Right-drag', 'Move deck'],
      ['Double-click', 'Peek at top card'],
      ['Right-click', 'Deck actions'],
    );
  else if (type === 'dispenser')
    rows.push(
      ['Left-drag / click', 'Dispense'],
      ['Right-drag', 'Move dispenser'],
      ['Double-click', 'Inspect'],
      ['Right-click', 'Dispenser actions'],
    );
  else if (type === 'card')
    rows.push(
      ['Left-drag', 'Move'],
      ['Left-click', 'Take to hand'],
      ['Right-click', 'Flip'],
      ['Double-click', 'Inspect'],
    );
  else {
    rows.push(['Left-drag', 'Move']);
    if (inspection.isInspectable(type)) rows.push(['Double-click', 'Inspect']);
    rows.push(['Right-click', 'Piece actions']);
  }
  if (selection.size)
    rows.push(
      ['W S / ↑ ↓', 'Pan camera'],
      ['A D / ← →', `Rotate ${selection.size} selected`],
      ['U / G', 'Stand / snap selection'],
      ['F / R / H', 'Flip / roll / take selection'],
      ['Delete', 'Remove selection'],
    );
  else
    rows.push(
      ['WASD / arrows', 'Pan camera'],
      ['G', 'Snap to grid'],
      ...(type === 'mat' ? [] : [['U', 'Stand / lay flat']]),
      ['Delete', 'Remove'],
    );
  return rows;
}
function showControlGuide(title, subtitle, rows) {
  const sig = JSON.stringify([title, subtitle, rows]);
  const ham = byId('hamBar');
  if (ham && !ham.hidden) {
    const r = ham.getBoundingClientRect();
    if (r.height) controlGuide.style.bottom = innerHeight - r.top + 10 + 'px';
  }
  if (sig === controlGuideSig && !controlGuide.hidden) return;
  controlGuideSig = sig;
  const head = document.createElement('strong');
  head.textContent = title;
  controlGuide.replaceChildren(head);
  if (subtitle) {
    const meta = document.createElement('span');
    meta.className = 'controlGuideMeta';
    meta.textContent = subtitle;
    controlGuide.appendChild(meta);
  }
  const list = document.createElement('div');
  list.className = 'controlGuideList';
  for (const [keys, action] of rows) {
    const row = document.createElement('div'),
      key = document.createElement('kbd'),
      label = document.createElement('span');
    key.textContent = keys;
    label.textContent = action;
    row.append(key, label);
    list.appendChild(row);
  }
  controlGuide.appendChild(list);
  controlGuide.hidden = false;
}
function syncControlGuide() {
  const region = byId('regionBL');
  if (!controlGuidePointer.matches || (region && !region.hidden)) {
    controlGuideSig = '';
    controlGuide.hidden = true;
    return;
  }
  if (hand.drag()) {
    showControlGuide('Hand card — dragging', null, hand.controlRows(hand.drag()));
    return;
  }
  if (down && down.grabbed) {
    const piece = room && room.state.pieces.get(down.id),
      count =
        piece && (piece.type === 'deck' || piece.type === 'dispenser') ? countLabel(piece) : null;
    showControlGuide(
      `${PIECE_CONTROL_NAMES[down.type] || 'Piece'} — held`,
      count,
      pieceControlRows(down.type, true),
    );
    return;
  }
  if (hand.hoverCard()) {
    showControlGuide('Hand card', null, hand.controlRows(null));
    return;
  }
  const entry = hoverId && meshes.get(hoverId),
    piece = hoverId && room && room.state.pieces.get(hoverId);
  if (entry) {
    const count =
      piece && (piece.type === 'deck' || piece.type === 'dispenser') ? countLabel(piece) : null;
    showControlGuide(
      PIECE_CONTROL_NAMES[entry.type] || 'Piece',
      count,
      pieceControlRows(entry.type, false),
    );
    return;
  }
  controlGuideSig = '';
  controlGuide.hidden = true;
}
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!room || !hoverIdle() || e.pointerType === 'touch') {
    hideHoverTip();
    return;
  }
  hoverTip.style.left = e.clientX + 'px';
  hoverTip.style.top = e.clientY + 'px'; // follow the cursor every move
  const now = performance.now();
  if (now - lastHover < 40) return; // throttle the raycast/pick
  lastHover = now;
  setPointer(e);
  const id = pickId();
  if (!id) {
    hideHoverTip();
    return;
  }
  hoverId = id;
  syncControlGuide();
  const piece = room.state.pieces.get(id);
  if (!piece || (piece.type !== 'deck' && piece.type !== 'dispenser')) {
    hoverTip.hidden = true;
    return;
  }
  const text = countLabel(piece);
  if (text == null) {
    hoverTip.hidden = true;
    return;
  }
  hoverTip.textContent = text;
  hoverTip.hidden = false;
});
renderer.domElement.addEventListener('pointerleave', hideHoverTip);
renderer.domElement.addEventListener('pointerdown', hideHoverTip); // a gesture begins → drop the readout

// Attention pings: a translucent ring pulses out on the table with the pinger's
// name. Triggered by middle-click or P (see the handlers), broadcast to everyone,
// and animated + expired by the render loop.
const pings = []; // { ring, label, start }
function sendPing() {
  // raycast the cursor onto the table and ask the server to broadcast
  if (!room) return;
  ray.setFromCamera(pointer, camera);
  const spot = new THREE.Vector3();
  if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -boardTopY), spot)) {
    room.send('ping', { x: spot.x, z: spot.z });
  }
}
function bindPings(room) {
  room.onMessage('ping', ({ sid, x, z }) => spawnPing(sid, x, z)); // someone's "look here" marker
}

function bindTableEffects(room) {
  room.onMessage('shuffled', ({ id }) => {
    startAnim(id, 'shuffle');
    playSfx('shuffle');
  }); // everyone sees + hears the riffle
  room.onMessage('sfx', ({ type } = {}) => playSfx(type)); // shared cue (roll/flip/deal) broadcast by the server
}

function spawnPing(sid, x, z) {
  const player = room.state.players.get(sid);
  const color = player ? player.color : '#ffffff';
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(CONFIG.ping.inner, CONFIG.ping.outer, 32),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, boardTopY + CONFIG.ping.lift, z);
  ring.renderOrder = 5;
  scene.add(ring);
  const label = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: nameTag(player ? player.name : '', color),
      transparent: true,
      depthTest: false,
    }),
  );
  label.scale.set(CONFIG.label.w, CONFIG.label.h, 1);
  label.position.set(x, boardTopY + 0.6, z);
  label.renderOrder = 6;
  scene.add(label);
  pings.push({ ring, label, start: performance.now() });
}

// Shared player color and sprite cleanup are also used by whiteboard/presence.
function myColor(fallback = '#ffffff') {
  const player = room && room.state.players.get(mySession);
  return (player && player.color) || fallback;
}
function disposeSprite(sprite) {
  scene.remove(sprite);
  sprite.material.map.dispose();
  sprite.material.dispose();
}

// Measurement overlay state, picking, previews, and protocol live together.
const overlays = createOverlays({
  THREE,
  scene,
  camera,
  ray,
  pointer,
  canvas: renderer.domElement,
  registry: OVERLAY,
  measure: MEASURE,
  labelSize: CONFIG.label,
  nameTag,
  formatMeasure,
  disposeSprite,
  getRoom: () => room,
  send: (type, data) => room?.send(type, data),
  getSessionId: () => mySession,
  getRank: () => myRank,
  getColor: myColor,
  getBoardMeshes: () =>
    [...meshes.values()].filter((entry) => entry.type === 'board').map((entry) => entry.mesh),
  setPointer,
  byId,
});

// Whiteboard owns its mesh, stroke history, camera mode, and room protocol.
const whiteboard = createWhiteboard({
  THREE,
  scene,
  camera,
  controls,
  ray,
  pointer,
  createTexture: cTex,
  getRoom: () => room,
  getSessionId: () => mySession,
  getStrokeColor: () => myColor('#e8e6e0'),
  setPointer,
  setIcon,
  toast,
});

// Personal tray visuals, controls, and camera travel stay behind one controller.
const trays = createTrays({
  THREE,
  scene,
  camera,
  controls,
  trayMesh,
  trayCenter,
  seatAngle,
  getRoom: () => room,
  getSeat: presence.getSeat,
  getDieProps: myDieProps,
  byId,
});

// ===== render loop — buffered snapshot interpolation ========================
// Every piece is drawn ~DELAY ms in the past, interpolated between the two real
// server states bracketing that time. Smooth at any speed; one path for all
// pieces (held, thrown, resting) so there are no prediction seams to jutter.
const DELAY = CONFIG.render.delay; // render this far behind live state (interpolation buffer)
const boardDropSurfaces = new Map();
function boardDropHeight(x, z, fromY) {
  let height = 0;
  for (const [id, entry] of meshes) {
    if (entry.type !== 'board' || !entry.mesh.visible) continue;
    const piece = room?.state.pieces.get(id);
    if (!piece) continue;
    let cached = boardDropSurfaces.get(id);
    if (!cached || cached.props !== piece.props) {
      if (cached) disposeColliderSurface(cached.root);
      const spec = colliderSpec('board', meshPropsOf(piece, id));
      if (!spec) {
        boardDropSurfaces.delete(id);
        continue;
      }
      const root = new THREE.Group();
      root.add(createColliderSurface(spec));
      cached = { root, props: piece.props };
      boardDropSurfaces.set(id, cached);
    }
    cached.root.position.copy(entry.mesh.position);
    cached.root.quaternion.copy(entry.mesh.quaternion);
    height = Math.max(height, colliderSurfaceHeight(cached.root, x, z, fromY));
  }
  return height;
}
let boardTopY = 0; // legacy board-wide plane for measurements and pings (0 = bare table)

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
  if (progress >= 1) {
    anims.delete(id);
    return;
  }
  if (anim.kind === 'shuffle') {
    // riffle: a fast fading side-to-side wiggle + a little lift-and-settle
    mesh.rotateY(Math.sin(progress * Math.PI * cfg.cycles) * cfg.yaw * (1 - progress));
    mesh.position.y += Math.sin(progress * Math.PI) * cfg.bob;
  }
}

// "If dropped" marker: a flat ring on the table under whatever you're holding,
// showing where it would land if released now (straight down).
const dropMarker = new THREE.Mesh(
  new THREE.RingGeometry(CONFIG.marker.inner, CONFIG.marker.outer, 40),
  new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: CONFIG.marker.opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),
);
dropMarker.rotation.x = -Math.PI / 2;
dropMarker.renderOrder = 3;
dropMarker.visible = false;
scene.add(dropMarker);
const _dropBox = new THREE.Box3(),
  _dropSize = new THREE.Vector3(); // reused each frame to size the ring to the held piece

const selection = createSelection({
  THREE,
  scene,
  camera,
  canvas: renderer.domElement,
  meshes,
  marker: CONFIG.marker,
  getRoom: () => room,
  getBoardTopY: () => boardTopY,
  byId,
});

const perf = initPerf(); // dev render-cost overlay, off unless ?perf=1 / window.ottPerf(true)
(function animate() {
  // shadow-on-demand: last frame's caster-transform key, in an object so the cross-frame write
  // (updated at the end of each rAF tick) isn't flagged dead by no-useless-assignment. See core.js.
  const shadowSeen = { key: NaN };
  const renderTime = performance.now() - DELAY;
  let shadowKey = 0;
  for (const [id, { mesh }] of meshes) {
    const buf = buffers.get(id);
    if (buf) sample(buf, renderTime, mesh);
    if (anims.size) applyAnim(id, mesh);
    colliderDebug.update(id, mesh);
    // Fold each caster's live transform into a frame key; a change means geometry moved and the
    // shadow map needs one redraw (renderer.shadowMap.autoUpdate is off — see core.js).
    const mp = mesh.position,
      mq = mesh.quaternion,
      ms = mesh.scale;
    shadowKey +=
      mp.x +
      mp.y * 1.7 +
      mp.z * 2.3 +
      mq.x * 3.1 +
      mq.y * 4.7 +
      mq.z * 5.9 +
      mq.w * 7.3 +
      ms.x * 11 +
      ms.y * 13 +
      ms.z * 17;
  }
  overlays.syncSurface(); // GLB boards can finish loading after restored overlays arrive
  presence.update(); // keep held-piece labels over the interpolated meshes
  syncControlGuide(); // held/hovered context can change from state without another pointer move
  if (hoverId != null && !hoverTip.hidden) {
    // keep the hover count live while it's shown (deal/dispense without moving)
    const p = room && room.state.pieces.get(hoverId);
    const t = p && countLabel(p);
    if (t == null) hoverTip.hidden = true;
    else hoverTip.textContent = t;
  }
  for (let i = pings.length - 1; i >= 0; i--) {
    // expand + fade each active ping, then dispose
    const p = pings[i],
      t = (performance.now() - p.start) / CONFIG.ping.dur;
    if (t >= 1) {
      scene.remove(p.ring);
      p.ring.geometry.dispose();
      p.ring.material.dispose();
      disposeSprite(p.label);
      pings.splice(i, 1);
      continue;
    }
    p.ring.scale.setScalar(1 + t * CONFIG.ping.grow);
    p.ring.material.opacity = 0.75 * (1 - t);
    p.label.material.opacity = t < 0.6 ? 1 : (1 - t) / 0.4; // hold, then fade near the end
    p.label.position.y = boardTopY + 0.6 + t * 0.35; // drift up a touch
  }
  const held = down && down.grabbed && meshes.get(down.id); // landing spot under the held piece
  if (held) {
    _dropBox.setFromObject(held.mesh);
    _dropBox.getSize(_dropSize); // fit the ring to the piece's footprint
    dropMarker.scale.setScalar(
      (Math.max(_dropSize.x, _dropSize.z) / 2 + 0.12) / CONFIG.marker.outer,
    );
    const me = room && room.state.players.get(mySession); // tint to my seat color
    if (me && me.color) dropMarker.material.color.set(me.color);
    dropMarker.position.set(
      held.mesh.position.x,
      boardDropHeight(held.mesh.position.x, held.mesh.position.z, held.mesh.position.y) +
        CONFIG.marker.lift,
      held.mesh.position.z,
    );
    dropMarker.visible = true;
  } else {
    dropMarker.visible = false;
  }
  selection.update(); // keep a highlight ring under each selected piece
  if (!trays.updateCamera()) {
    camera.position.sub(leanOffset); // undo last frame's lean so controls sees the true orbit position
    controls.update();
    leanT += ((leanActive ? 1 : 0) - leanT) * 0.18; // ease toward held / released
    if (leanT < 0.0005) leanT = 0;
    leanOffset
      .copy(controls.target)
      .sub(camera.position)
      .multiplyScalar(leanT * LEAN_AMOUNT);
    camera.position.add(leanOffset); // apply the lean for this frame's render
  }
  {
    // clustered height + rotate controls (both edges): rotate while holding a piece or with a selection; height while holding
    const holding = !!(down && down.grabbed && down.touch),
      hasSel = selection.size > 0,
      sig = (holding ? 1 : 0) | (hasSel ? 2 : 0);
    if (sig !== holdSig) {
      holdSig = sig;
      const show = holding || hasSel;
      document.querySelectorAll('.holdControls').forEach((el) => (el.hidden = !show));
      document.querySelectorAll('.rotLeft, .rotRight').forEach((b) => (b.hidden = !show));
      document.querySelectorAll('.heightUp, .heightDown').forEach((b) => (b.hidden = !holding));
    }
  }
  if (shadowKey !== shadowSeen.key) {
    renderer.shadowMap.needsUpdate = true; // geometry moved this frame → refresh shadows
    shadowSeen.key = shadowKey;
  }
  renderer.render(scene, camera);
  perf.frame(renderer); // sample renderer.info for the overlay (no-op when disabled)
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
  if (type === 'card') {
    items.push(['Flip', () => room.send('flip', { id })]);
    items.push(['Take to hand', () => sendAction('takeCard', id)]);
  }
  if (type === 'die') {
    items.push(['Roll', () => room.send('rollOne', { id })]);
  }
  if (type === 'deck') {
    items.push(['Peek at top card', () => room.send('drawInspect', { deckId: id })]);
    items.push(['Draw to hand', () => sendAction('drawToHand', id)]);
    items.push(['Shuffle', () => room.send('shuffle', { deckId: id })]);
    items.push(['Split', () => room.send('splitDeck', { deckId: id })]);
    const deckOpen = (() => {
      try {
        return !!JSON.parse(room.state.pieces.get(id)?.props || '{}').open;
      } catch {
        return false;
      }
    })();
    items.push([
      deckOpen ? 'Make secret' : 'Make 2-sided',
      () => room.send('setOpenGroup', { ids: [id] }),
    ]);
  }
  if (type === 'dispenser') {
    items.push(['Dispense', () => sendAction('dispense', id)]);
  }
  if (KIND[type] && KIND[type].grab === 2)
    items.push([
      'Move',
      () => {
        armedMove = id;
      }, // fallback: a plain click arms the next drag, as it always did
      null,
      (e) => beginMoveFromMenu(id, e), // press and keep dragging — the piece comes with you
    ]); // deck/dispenser: reposition instead of deal
  if (inspection.isInspectable(type)) {
    items.push(['Inspect', () => inspection.enterInspect(id)]);
  }
  if (type !== 'mat') items.push(['Stand / lay flat', () => room.send('setStand', { id })]); // a mat is always flat
  items.push(['Snap to grid', () => room.send('setSnap', { id })]);
  items.push(['Delete', () => room.send('remove', { id }), 'danger']);
  return items;
}
// Pick a piece up NOW, at the pointer, as though a move-drag had just crossed the grab threshold.
// The menu's Move item uses this on POINTERDOWN, so you press Move and keep dragging in one
// gesture instead of tapping Move, then finding the deck again and dragging that. The piece jumps
// to the pointer, which is the point: you already aimed at where the menu is.
function beginMoveFromMenu(id, e) {
  const entry = meshes.get(id);
  if (!entry || !room) return false;
  setPointer(e, e.pointerType === 'touch' ? CONFIG.input.touchLeadPx : 0);
  ray.setFromCamera(pointer, camera);
  if (!ray.ray.intersectPlane(dragPlane, hit)) return false;
  dragHeight = grabHeightFor(e.pointerType === 'touch');
  hit.y = dragHeight;
  down = {
    id,
    type: entry.type,
    kind: KIND[entry.type],
    touch: e.pointerType === 'touch',
    forceMove: true,
    primary: true,
    secondary: false,
    sx: e.clientX,
    sy: e.clientY,
    dragging: true, // already past the threshold: this gesture can never be read as a click
    grabbed: true,
    snap: pieceSnap(id),
    cells: pieceCells(id),
    group: false,
    rotateOnPress: false,
    rotating: false,
    rotateX: e.clientX,
    rotateRaw: 0,
    rotateSent: 0,
    lastRotateSent: 0,
    transformed: false,
  };
  dragOffset.set(0, 0, 0);
  controls.enabled = false;
  heldTarget.copy(hit);
  prevTarget.copy(hit);
  prevThrowTime = performance.now();
  throwVel.set(0, 0, 0);
  room.send('grab', { id });
  playSfx(pieceIsTile(id) ? 'tiledeck-pickup' : sfxKind(entry.type) + '-pickup');
  const t = snapXZ(hit.x, hit.z);
  room.send('move', { id, x: t.x, y: hit.y, z: t.z });
  // Capture on the CANVAS even though the press landed on a menu button, so the rest of the drag
  // reaches the canvas handlers.
  try {
    renderer.domElement.setPointerCapture(e.pointerId);
  } catch {}
  return true;
}

let pieceMenuAway = null; // outside-tap dismiss handler installed while the menu is open
function closePieceMenu() {
  const menu = byId('pieceMenu');
  if (menu) menu.hidden = true;
  if (pieceMenuAway) {
    document.removeEventListener('pointerdown', pieceMenuAway, true);
    pieceMenuAway = null;
  }
}
function openPieceMenu(id, p) {
  const menu = byId('pieceMenu');
  if (!menu) return;
  const entry = meshes.get(id);
  if (!entry) return;
  // Touch gets the radial (7e slice 7) — same items, arced around the press point.
  const arc = pieceMenuItems(id, entry.type);
  if (isSheet() && arc.length <= RADIAL_MAX) {
    closePieceMenu();
    if (
      openRadial(
        p.x,
        p.y,
        arc.map(([label, fn, cls, press]) => ({ label, fn, cls, press })),
      )
    )
      return;
  }
  menu.replaceChildren();
  for (const [label, fn, cls, press] of pieceMenuItems(id, entry.type)) {
    const b = makeButton(
      label,
      () => {
        closePieceMenu();
        fn();
      },
      cls,
    );
    if (press)
      b.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        // Transfer capture while the pressed button is still connected. Removing it first makes
        // Safari lose the active touch after the initial lift, leaving the piece stuck in place.
        const dragging = press(ev);
        closePieceMenu();
        if (dragging) b.onclick = null; // the drag owns the gesture; don't also arm on click
      });
    menu.appendChild(b);
  }
  menu.hidden = false; // show first so it can be measured
  const w = menu.offsetWidth || 180,
    h = menu.offsetHeight || 0;
  menu.style.left = Math.max(8, Math.min(p.x, innerWidth - w - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(p.y, innerHeight - h - 8)) + 'px';
  pieceMenuAway = (ev) => {
    if (!menu.contains(ev.target)) closePieceMenu();
  };
  setTimeout(() => document.addEventListener('pointerdown', pieceMenuAway, true), 0); // dismiss on the next outside tap
}

// ===== Input seam ===========================================================
// Raw canvas events → intents (see public/controls.js). These handlers own what each
// intent MEANS; controls.js owns which device gesture raises it. As Phase 0 proceeds,
// the pointer dispatcher and keyboard shortcuts fold in here too.
const INPUT = {
  press: onPointerDown, // pointerdown → the dispatcher (grab/deal, marquee, overlay, modal starts)
  move: onPointerMove, // pointermove → drag routing for every mode
  release: endGesture, // pointerup / pointercancel → commit/settle the gesture
  command: onKeyDown, // keydown → the command router (Esc-exits, batch ops, per-piece verbs, ping)
  secondaryPress: (p) => {
    // touch long-press → context menu on a piece, or ping on empty felt
    if (
      !room ||
      overlays.isMeasuring() ||
      whiteboard.isOwning() ||
      inspection.isActive() ||
      selection.isActive()
    )
      return; // a modal tool owns the gesture
    const id = down && down.id; // the piece the press landed on (null on empty felt)
    if (down) down.dragging = true; // consume the gesture: no grab on further move, no tap on release
    if (id) openPieceMenu(id, p);
    else {
      setPointer({ clientX: p.x, clientY: p.y });
      sendPing();
    } // long-press empty felt → ping
  },
  hasHeld: () => !!(down && down.grabbed),
  // Axis keys keep their object meaning only where that action has a target. Otherwise the input
  // profile routes the same physical key to camera panning.
  hasAxisTarget: (name) =>
    name === 'raiseAxis'
      ? !!(down && down.grabbed)
      : !!(down && down.grabbed) || selection.size > 0,
  panCamera,
  // Turn the held piece by a raw angle — the device-agnostic form of the Alt-drag dial.
  // The touch profile raises it from a two-finger twist; a gamepad stick would too.
  rotateHeld: (radians) => applyHeldRotation(radians),
  snapHeld: () => {
    if (down && down.grabbed) room.send('snap', { id: down.id });
  },
  ping: (p) => {
    setPointer({ clientX: p.x, clientY: p.y });
    sendPing();
  },
  // Turn the selection (or the held piece) one small step. The continuous complement to the
  // [ / ] 45° keys, and what the ⟲ / ⟳ hold buttons and the A/D + arrow keys all drive.
  rotateAxis: (dir) => {
    if (!room || inspection.isActive()) return; // a peek/inspect view owns the keyboard
    const ids = selection.size ? selection.ids() : down && down.grabbed ? [down.id] : [];
    if (ids.length) room.send('rotateGroup', { ids, angle: dir * ROT_STEP });
  },
  raiseAxis: (dir) => {
    if (inspection.isActive()) return; // ...and must not also nudge a piece behind it
    if (!(down && down.grabbed)) return;
    dragHeight = clamp(dragHeight + dir * DRAG_STEP, DRAG_MIN, DRAG_MAX); // up = raise
    // Raise the piece where it already is, rather than re-deriving XZ from the pointer. Identical
    // for the wheel (the cursor is still while scrolling), and necessary for the two-finger pinch,
    // where the fingers travel but the piece is meant to stay put and only change height.
    const t = snapXZ(heldTarget.x, heldTarget.z);
    if (down.group) room.send('moveGroup', { x: t.x, y: dragHeight, z: t.z });
    else room.send('move', { id: down.id, x: t.x, y: dragHeight, z: t.z });
  },
  // double-click the board to own it and draw; true if a claim was sent
  doubleClick: (p) => {
    return whiteboard.claimAt(
      p,
      [...meshes.values()].map((m) => m.mesh),
    );
  },
};
attachControls(renderer.domElement, INPUT);

// Universal icon buttons: any button labeled "EMOJI text" collapses to just the emoji on small
// screens — its text is wrapped in <span class="lbl"> (hidden by CSS). Skips buttons that are
// already structured (a child element) or have no leading emoji to fall back to (e.g. "+ d4").
function autoIconLabels(root = document) {
  root.querySelectorAll('button').forEach((btn) => {
    if (btn.childElementCount) return; // already wrapped / structured
    const m = btn.textContent.match(/^(.*?)(\p{L}.*)$/u); // split at the first letter
    if (!m || !/\p{Extended_Pictographic}/u.test(m[1])) return; // needs a leading emoji
    btn.textContent = '';
    btn.appendChild(document.createTextNode(m[1]));
    const span = document.createElement('span');
    span.className = 'lbl';
    span.textContent = m[2];
    btn.appendChild(span);
  });
}
autoIconLabels();

wirePopGroups(); // shared with editor-panel.js — see icons.js

// applyIcons / setIcon / initTip are imported from icons.js (see top).
applyIcons();
document.querySelectorAll('.close-x').forEach((el) => setIcon(el, 'x')); // every modal's ✕ → an icon, universally
document.querySelectorAll('label[data-icon]').forEach((el) => setIcon(el, el.dataset.icon)); // icon-only dimension labels (Width/Depth)

// Reusable surface mechanics; table-specific panel/button wiring stays here.
const {
  isSheet,
  clearSheet,
  openAsSheet,
  wireDialog,
  wireCluster,
  holdRepeat,
  wireDrawer,
  createRadialMenu,
} = createUiSurfaces({
  onSheetStop: (region) => {
    const log = region.querySelector('#chatLog');
    if (log) log.scrollTop = log.scrollHeight;
  },
});
wireDialog(byId('settingsModal'), { modal: true });
wireDialog(byId('roomSettingsModal'), { modal: true });
wireDialog(byId('sceneSaveModal'), { modal: true });
wireDialog(byId('controlsModal'), { modal: true, close: byId('controlsClose') });
['libraryModal'].forEach((id) => wireDialog(byId(id), { modal: true }));
// Top-left cluster (UI_Redesign phase 2): Chat + Notes share one region (accordion).
{
  const r = byId('regionTL'),
    cb = byId('chatBtn'),
    nb = byId('notesBtn');
  if (r && cb && nb)
    wireCluster(r, [
      {
        btn: cb,
        pane: 'chat',
        onOpen: () => {
          cb.classList.remove('hasUnread');
          const l = byId('chatLog');
          if (l) l.scrollTop = l.scrollHeight;
        },
      },
      { btn: nb, pane: 'notes' },
    ]);
}
// Top-right cluster (UI_Redesign phase 2b): Score + Music + Measure + Timer.
{
  const r = byId('regionTR'),
    sb = byId('scoreBtn'),
    ab = byId('audioBtn'),
    mb = byId('measureBtn'),
    tb = byId('timerBtn');
  if (r && sb && tb)
    wireCluster(r, [
      {
        btn: sb,
        pane: 'score',
        onOpen: () => {
          scoreboard.render();
        },
      },
      { btn: ab, pane: 'music' },
      { btn: mb, pane: 'measure', onOpen: overlays.enter, onClose: overlays.exit },
      { btn: tb, pane: 'timer' },
    ]);
}
// Bottom-left corner cluster (UI_Redesign phase 2c): Interactions → My Seat / Lean In / Show / Drop.
{
  const r = byId('regionBL'),
    ib = byId('interactHam'),
    ibR = byId('interactHamR');
  const hams = [{ btn: ib, pane: 'interactions' }];
  if (ibR) hams.push({ btn: ibR, pane: 'interactions' }); // mirrored right-corner ham
  if (r && ib) wireCluster(r, hams, { open: 'right', perHam: true });
}
// Library cards render dynamically (editor-panel.js) — icon their data-icon buttons as they appear.
['libraryModal'].forEach((id) => {
  const el = byId(id);
  if (el)
    new MutationObserver(() => applyIcons(el)).observe(el, { childList: true, subtree: true });
});

initTip(); // themed hover-hint (icons.js)

// Touch height control: hold ▲ / ▼ to raise / lower the held piece — the touch analog of the wheel.
// Also the selection rotation buttons: hold ⟲ / ⟳ to spin the selection continuously (server
// rotateGroup with an angle delta), the continuous complement to the [ / ] 45° steps.
{
  document
    .querySelectorAll('.heightUp')
    .forEach((b) => holdRepeat(b, () => INPUT.raiseAxis(1), 120));
  document
    .querySelectorAll('.heightDown')
    .forEach((b) => holdRepeat(b, () => INPUT.raiseAxis(-1), 120));
  document
    .querySelectorAll('.rotLeft')
    .forEach((b) => holdRepeat(b, () => INPUT.rotateAxis(-1), 60));
  document
    .querySelectorAll('.rotRight')
    .forEach((b) => holdRepeat(b, () => INPUT.rotateAxis(1), 60));
}

selection.bindActions();

// Role gating here is by class, not by `hidden`: body.not-gm / body.not-admin hide
// .gm-only / .admin-only in CSS. A collapsed container (.grp menu, closed #regionBL)
// is NOT a gate, which is why we can't just ask whether the button is visible.
function proxyGated(el) {
  if (!el || el.hidden) return true;
  const body = document.body.classList;
  if (body.contains('not-gm') && el.closest('.gm-only')) return true;
  if (body.contains('not-admin') && el.closest('.admin-only')) return true;
  return false;
}

// ---- radial menu primitive (7e slice 7; mockup 10j) ------------------------------------
// One fan for two callers: the ⊕ FAB and long-press on a piece. Items arc away from the
// nearest edges, so the menu never opens off-screen and never lands under your thumb.
const RADIAL_ICONS = {
  Flip: 'eye-up',
  'Take to hand': 'hand-grab',
  Roll: 'dice-5',
  'Draw to hand': 'cards',
  Shuffle: 'refresh',
  Split: 'line',
  Dispense: 'package-off',
  Move: 'hand-move',
  Inspect: 'zoom-in',
  'Stand / lay flat': 'arrow-big-up-line',
  'Snap to grid': 'grid-3x3',
  Delete: 'trash',
};
const RADIAL_MAX = 7; // beyond this an arc stops being readable — callers fall back to a list
const { open: openRadial, close: closeRadial } = createRadialMenu(byId('radial'), {
  icons: RADIAL_ICONS,
  onClose: () => byId('fabBtn')?.classList.remove('on'),
});

// ---- ⊕ table actions (mockup 10j left) -------------------------------------------------
{
  const fab = byId('fabBtn');
  if (fab) {
    const proxy = (label, icon, sel) => {
      const src = typeof sel === 'string' ? document.querySelector(sel) : sel;
      return src && !proxyGated(src) ? { label, icon, fn: () => src.click() } : null;
    };
    fab.addEventListener('click', () => {
      if (byId('radial') && !byId('radial').hidden) return closeRadial();
      const items = [
        proxy('Dice Box', 'dice-5', '#roll'),
        proxy('Library', 'library-plus', '#lib2Btn'),
        proxy('Multi-Select', 'select-all', '#hamBar .selectTool'),
        proxy('Measure', 'ruler-measure', '#measureBtn'),
      ].filter(Boolean);
      const r = fab.getBoundingClientRect();
      if (openRadial(r.left + r.width / 2, r.top + r.height / 2, items)) fab.classList.add('on');
    });
    fab.hidden = false; // every pointer type gets the fan now, not just touch
  }
}

// ---- ☰ drawer (7e slice 3; mockup 10b) -------------------------------------------------
// Both top clusters fold into ONE sheet of grouped rows. The rows are proxies: each one
// dispatches a click on the real button, so every behaviour, role gate and unread badge
// keeps working with no duplicated logic. A hidden or missing source button = no row.
{
  const DRAWER_GROUPS = [
    { label: 'Open', ids: ['lib2Btn', 'chatBtn', 'notesBtn', 'scoreBtn'] },
    {
      label: 'Room',
      ids: ['roomInfoBtn', 'roomScene', 'roomSaveState', 'roomSettings', 'addBtn', 'sceneSaveBtn'],
    },
    { label: 'Table', ids: ['measureBtn', 'audioBtn', 'timerBtn', 'settingsBtn', 'controlsBtn'] },
  ];
  const FOOT = ['roomReset', 'lobbyBtn'];
  const drawer = byId('drawer'),
    btn = byId('drawerBtn');
  if (drawer && btn) {
    const labelOf = (src) => {
      const l = src.querySelector('.lbl');
      return (l && l.textContent.trim()) || src.getAttribute('aria-label') || src.id;
    };
    const rowFor = (src) => {
      if (proxyGated(src)) return null;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'drawerRow' + (src.classList.contains('button--danger') ? ' danger' : '');
      const icon = src.dataset.icon;
      if (icon) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'ico ico-' + icon);
        svg.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', '#i-' + icon);
        svg.appendChild(use);
        row.appendChild(svg);
      }
      const lbl = document.createElement('span');
      lbl.className = 'drawerLbl';
      lbl.textContent = labelOf(src);
      row.appendChild(lbl);
      if (src.classList.contains('hasUnread')) {
        const dot = document.createElement('span');
        dot.className = 'drawerDot';
        dot.textContent = '•';
        row.appendChild(dot);
      }
      row.addEventListener('click', () => {
        close();
        src.click(); // the real handler, including wireCluster's open/close accordion
      });
      return row;
    };
    const build = () => {
      drawer.replaceChildren();
      drawer._sheetReady = false; // rebuilt content: initSheet re-inserts its grabber
      const head = document.createElement('div');
      head.className = 'regionHead';
      const b = document.createElement('b');
      b.textContent = 'Table';
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'close-x';
      x.setAttribute('aria-label', 'Close');
      x.textContent = '✕';
      x.addEventListener('click', close);
      head.append(b, x);
      drawer.appendChild(head);
      const body = document.createElement('div');
      body.className = 'drawerBody';
      for (const g of DRAWER_GROUPS) {
        const rows = g.ids.map((id) => rowFor(byId(id))).filter(Boolean);
        if (!rows.length) continue;
        const wrap = document.createElement('div');
        wrap.className = 'drawerGroup';
        const lab = document.createElement('div');
        lab.className = 'miniLabel';
        lab.textContent = g.label;
        wrap.append(lab, ...rows);
        body.appendChild(wrap);
      }
      drawer.appendChild(body);
      const footRows = FOOT.map((id) => rowFor(byId(id))).filter(Boolean);
      if (footRows.length) {
        const foot = document.createElement('div');
        foot.className = 'drawerFoot';
        foot.append(...footRows);
        drawer.appendChild(foot);
      }
    };
    const close = wireDrawer(drawer, btn, build);
  }
}

// ---- seat button + popover (7e slice 4; mockup 10e) ------------------------------------
// One button replaces #hamBar and #hamBarRight. Rows are proxies onto the real controls,
// and the roster is the LIVE #players node, borrowed while open and returned on close so
// its renderer keeps writing to the same element. Placement is computed from the button's
// own rect — never from which cluster the tap came from, because there is only one now.
{
  const btn = byId('seatBtn'),
    pop = byId('seatPop');
  if (btn && pop) {
    const SEAT_ROWS = ['mySeatBtn', 'birdsEyeBtn', 'leanBtn'];
    const proxyRow = (src, label) => {
      if (proxyGated(src)) return null;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'drawerRow';
      const icon = src.dataset.icon;
      if (icon) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'ico ico-' + icon);
        svg.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', '#i-' + icon);
        svg.appendChild(use);
        row.appendChild(svg);
      }
      const lbl = document.createElement('span');
      lbl.className = 'drawerLbl';
      const own = src.querySelector('.lbl');
      lbl.textContent = label || (own && own.textContent.trim()) || src.id;
      row.appendChild(lbl);
      row.addEventListener('click', () => {
        close();
        src.click();
      });
      return row;
    };
    const label = (text) => {
      const el = document.createElement('div');
      el.className = 'miniLabel';
      el.textContent = text;
      return el;
    };
    const build = () => {
      pop.replaceChildren();
      const seatName = presence.seatName();
      pop.appendChild(label(seatName ? 'Your seat · ' + seatName : 'Your seat'));
      for (const id of SEAT_ROWS) {
        const r = proxyRow(byId(id));
        if (r) pop.appendChild(r);
      }
      const players = byId('players');
      if (players) {
        const rule = document.createElement('div');
        rule.className = 'seatRule';
        pop.append(rule, label('At the table'), players); // live node, moved not cloned
      }
    };
    // Anchored to the button, flipped by the space actually available around it.
    const place = () => {
      const r = btn.getBoundingClientRect();
      const w = pop.offsetWidth,
        h = pop.offsetHeight;
      const pad = 8;
      let left = r.right - w; // right-aligned to the button by default
      if (left < pad) left = Math.min(r.left, innerWidth - w - pad); // no room: flip to its left edge
      left = Math.max(pad, Math.min(left, innerWidth - w - pad));
      let top = r.top - h - pad; // above by default — the hand tab owns everything below
      if (top < pad) top = Math.min(r.bottom + pad, innerHeight - h - pad);
      pop.style.left = Math.round(left) + 'px';
      pop.style.top = Math.round(Math.max(pad, top)) + 'px';
    };
    function close() {
      if (pop.hidden) return;
      const players = pop.querySelector('#players');
      const home = byId('roomInfoBody') && byId('roomInfoBody').querySelector('.dockSection');
      if (players && home) home.appendChild(players); // give the roster back to the dock
      pop.hidden = true;
      btn.classList.remove('on');
      btn.setAttribute('aria-expanded', 'false');
    }
    const open = () => {
      build();
      pop.hidden = false;
      place();
      btn.classList.add('on');
      btn.setAttribute('aria-expanded', 'true');
      pop.setAttribute('tabindex', '-1');
      pop.focus({ preventScroll: true });
    };
    pop._close = close; // other surfaces close us before borrowing #players
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      pop.hidden ? open() : close();
    });
    addEventListener('pointerdown', (e) => {
      if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) close();
    });
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !pop.hidden) {
        close();
        btn.focus({ preventScroll: true });
      }
    });
    addEventListener('resize', () => {
      if (!pop.hidden) place();
    });
    btn.hidden = false; // the seat button is the default at every pointer type
  }
}

// ---- Room info sheet (7e slice 5; mockup 10f) ------------------------------------------
// The top bar stopped carrying the room code and the dock in slice 2; this is where they
// went. The dock's live #roomInfoBody is borrowed while open (same trick as the roster in
// slice 4) so Players / Room notes / Members keep their existing renderers.
{
  const sheet = byId('roomSheet'),
    src = byId('roomInfoBtn');
  if (sheet && src) {
    const row = (icon, text, fn, cls) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'drawerRow' + (cls ? ' ' + cls : '');
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'ico ico-' + icon);
      svg.setAttribute('aria-hidden', 'true');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', '#i-' + icon);
      svg.appendChild(use);
      const lbl = document.createElement('span');
      lbl.className = 'drawerLbl';
      lbl.textContent = text;
      b.append(svg, lbl);
      b.addEventListener('click', fn);
      return b;
    };
    const roomCode = () => {
      const rc = byId('roomCode');
      if (!rc || rc.hidden) return ''; // GM+ only, same gate as the desktop dock
      return (rc.textContent || '').replace(/^Code:\s*/, '').trim();
    };
    const build = () => {
      sheet.replaceChildren();
      sheet._sheetReady = false;
      const head = document.createElement('div');
      head.className = 'regionHead';
      const b = document.createElement('b');
      b.textContent = 'Room info';
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'close-x';
      x.setAttribute('aria-label', 'Close');
      x.textContent = '✕';
      x.addEventListener('click', close);
      head.append(b, x);
      const body = document.createElement('div');
      body.className = 'drawerBody';

      const card = document.createElement('div');
      card.className = 'roomCard';
      const name = document.createElement('div');
      name.className = 'roomCardName';
      name.textContent = (byId('roomTitle') && byId('roomTitle').textContent) || 'Shared Table';
      const meta = document.createElement('div');
      meta.className = 'roomCardMeta';
      const seated = room && room.state ? room.state.players.size : 0;
      meta.textContent = seated + (seated === 1 ? ' player' : ' players') + ' at the table';
      card.append(name, meta);
      const code = roomCode();
      if (code) {
        const cr = document.createElement('div');
        cr.className = 'roomCodeRow';
        const val = document.createElement('span');
        val.className = 'roomCodeVal';
        val.textContent = code;
        cr.appendChild(val);
        cr.appendChild(
          row('copy', 'Copy', () => {
            navigator.clipboard?.writeText(code);
            toast('Room code copied');
          }),
        );
        const url = location.origin + '/?room=' + encodeURIComponent(code);
        if (navigator.share)
          cr.appendChild(
            row('share', 'Share', () => navigator.share({ title: 'Open Tabletop', url })),
          );
        card.appendChild(cr);
      }
      body.appendChild(card);

      const dock = byId('roomInfoBody');
      if (dock) body.appendChild(dock); // live node, returned on close
      sheet.append(head, body);
    };
    function close() {
      if (sheet.hidden) return;
      const dock = sheet.querySelector('#roomInfoBody');
      const home = byId('roomInfo');
      if (dock && home) home.appendChild(dock);
      sheet.hidden = true;
      clearSheet(sheet);
    }
    const open = () => {
      const sp = byId('seatPop'); // it may be holding the live #players node
      if (sp && !sp.hidden && sp._close) sp._close();
      build();
      sheet.hidden = false;
      openAsSheet(sheet);
      sheet.setAttribute('tabindex', '-1');
      sheet.focus({ preventScroll: true });
    };
    sheet._close = close;
    src.addEventListener('click', () => (sheet.hidden ? open() : close()));
    sheet.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    });
    // The room name in the touch top bar is the other way in.
    const title = byId('roomTitle');
    if (title)
      title.addEventListener('click', () => {
        if (isSheet()) sheet.hidden ? open() : close();
      });
  }
}

// ---- hand tray (7e slice 6; mockup 10g) ------------------------------------------------
// The hand stops being a permanent 96px strip and becomes a tab you pull up. Open, it
// stacks the same hand and disclosure actions used by the desktop row.
{
  const row = byId('handRow'),
    tab = byId('handTab'),
    hand = byId('hand');
  if (row && tab && hand) {
    const count = () => hand.querySelectorAll('.handcard').length;
    const sync = () => {
      const n = count();
      tab.hidden = !isSheet();
      const lbl = tab.querySelector('.handCount');
      if (lbl) lbl.textContent = n;
      const fan = tab.querySelector('.handFan');
      if (fan) fan.style.visibility = n ? 'visible' : 'hidden';
      const text = tab.querySelector('.handTabLbl');
      if (text) text.textContent = n ? 'Your hand' : 'Your hand is empty';
      if (!isSheet()) setOpen(false); // leaving touch: the desktop row is always shown
    };
    const setOpen = (open) => {
      row.classList.toggle('trayOpen', open);
      document.body.classList.toggle('trayOpen', open);
      tab.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    tab.addEventListener('click', () => setOpen(!row.classList.contains('trayOpen')));
    new MutationObserver(sync).observe(hand, { childList: true });
    addEventListener('resize', sync);
    sync();
  }
}
