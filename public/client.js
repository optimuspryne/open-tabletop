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
import { LIGHTING_PRESETS, normalizeLighting } from '/shared/lighting.js';
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
import {
  chatRow,
  emptyRow,
  makeButton,
  memberRow,
  rankOf,
  scoreEmptyRow,
  scoreRow,
  toastContent,
  unclaimedHead,
  unclaimedRow,
} from './rows.js';
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
import {
  applyTransform,
  createPieceView,
  meshPropsOf,
  pieceProperty,
  piecePropsOf,
  snapshot,
  syncDeckMeshHeight,
} from './table/piece-view.js';
import {
  KINDS as PHYS,
  BOARDS,
  DIE_SIDES,
  DICE_SETS,
  DICE_FINISHES,
  DICE_FINISH_FALLBACK,
  readableInk,
  deckHeight,
  timerLive,
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
// Preset colors for the felt + grid-line swatch popovers (the custom picker sits beside them).
const FELT_COLORS = [
  '#2f6b4f',
  '#1e5c3f',
  '#2f4f6b',
  '#1e3a5c',
  '#6b2f3a',
  '#5c1e2a',
  '#3a3a3a',
  '#1a1a1a',
];
const GRID_COLORS = ['#ffffff', '#888888', '#000000', '#e05555', '#55aaff', '#55cc77', '#e0c055'];
const buildColorSwatches = (container, colors, apply) => {
  if (!container || container.childElementCount) return;
  colors.forEach((hex) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'swatch';
    chip.style.background = hex;
    chip.title = hex;
    chip.onclick = () => apply(hex);
    container.appendChild(chip);
  });
};
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

// Append one chat message to the log; auto-scroll if the reader's at the bottom,
// and flag the Tools button as unread when the panel's closed.
function addChatMsg(m) {
  const log = byId('chatLog');
  if (!log || !m) return;
  const mine = (m.from || '') === (byId('myName')?.textContent || '').trim();
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.appendChild(chatRow(m, { mine }));
  if (atBottom) log.scrollTop = log.scrollHeight;
  const chatBtn = byId('chatBtn'),
    reg = byId('regionTL');
  const chatShowing = reg && !reg.hidden && reg.querySelector('.pane[data-pane="chat"].on');
  if (!chatShowing && chatBtn) chatBtn.classList.add('hasUnread');
}

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
let syncLightingPanel = () => {};
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
const { rebuildCard, rebuildPiece, rebuildDeck, setOriginalVisible, sample } = createPieceView({
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

// The table grid (a flat LineSegments on the felt) or null when gridStyle is 'off'.
// Rebuilt whenever the grid fields (cell size / style / colour) or the table size
// change; reads everything from the synced room scale, so every seat draws the same.
let gridLines = null;
// The grid's height above the felt (GM-set, durable); falls back to the overlay lift.
const gridY = () => {
  const v = room && +room.state.scale.gridLift;
  return Number.isFinite(v) ? v : MEASURE.lift;
};
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
// Reflect the current table shape in Customize Table: light the active chip, and for the
// single-size shapes (round/hex) hide the depth field and relabel width as \"Size\".
function syncTableShapeUI() {
  if (!room) return;
  const shape = room.state.tableShape || 'rect';
  document
    .querySelectorAll('#tableShapes [data-tshape]')
    .forEach((b) => b.classList.toggle('on', b.dataset.tshape === shape));
  const locked = shape === 'round' || shape === 'hex';
  const dl = byId('tableDLabel'),
    ds = byId('tableDimSep'),
    di = byId('tableD'),
    wl = byId('tableWLabel');
  const diWrap = (di && di.closest('.stepper')) || di; // hide the whole − / + stepper, not just the input
  if (dl) dl.hidden = locked;
  if (ds) ds.hidden = locked;
  if (diWrap) diWrap.hidden = locked;
  if (wl) wl.textContent = locked ? 'Size' : 'Width';
  document
    .querySelectorAll('#tableWoods [data-wood]')
    .forEach((b) =>
      b.classList.toggle('on', b.dataset.wood === (room.state.rimWood || 'mahogany')),
    );
}

function rebuildGrid() {
  if (gridLines) {
    scene.remove(gridLines);
    gridLines.geometry.dispose();
    gridLines.material.dispose();
    gridLines = null;
  }
  if (!room) return;
  const g = gridMesh(room.state.scale, room.state.tableX, room.state.tableZ, room.state.tableShape);
  if (g) {
    g.position.y = gridY();
    scene.add(g);
    gridLines = g;
  }
}

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

  cb(room.state).pieces.onAdd((piece, id) => {
    noteSceneHydration();
    const mesh = KIND[piece.type].mesh(meshPropsOf(piece, id));
    const castsShadow = PHYS[piece.type].mass > 0;
    applyTransform(mesh, piece);
    mesh.traverse((node) => {
      // stamp the id on the group AND its children, so picking works
      node.userData.id = id;
      if (node.isMesh) {
        node.castShadow = castsShadow;
        node.receiveShadow = true;
      }
    });
    scene.add(mesh);
    meshes.set(id, { mesh, type: piece.type });
    buffers.set(id, [snapshot(performance.now(), piece)]);
    colliderDebug.refresh(id, piece);
    cb(piece).listen(
      'owner',
      () => {
        // name tag while held; also drop it from my selection if someone else grabs it
        updateHeldLabel(id, piece.owner);
        if (piece.owner && piece.owner !== mySession && selection.has(id)) selection.remove(id);
      },
      false,
    );

    if (piece.type === 'deck') {
      // The extruded prism is unit-height; scale Y to reflect how many cards remain. A modeled deck
      // skin (bag/box) is a fixed shape, so leave it alone — it looks the same whatever the count.
      const modeled = !!pieceProperty(piece, 'model', false);
      if (!modeled) {
        const setDeckHeight = (count) => {
          syncDeckMeshHeight(meshes, id, count, deckHeight);
          colliderDebug.refresh(id, piece);
        };
        setDeckHeight(piece.count);
        cb(piece).listen('count', setDeckHeight);
      }
      // Re-render when props change: an open tile set's cover follows its top tile, and a skin's
      // tints can be edited. (The height scale is re-applied inside rebuildDeck.)
      cb(piece).listen('props', () => rebuildDeck(id, piece), false);
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
      const box = builtin
        ? builtin.box
        : boardProps.model && Array.isArray(boardProps.box)
          ? boardProps.box
          : null;
      boardTopY = box ? box[1] * 2 : 0.1;
    }
  });

  cb(room.state).pieces.onRemove((piece, id) => {
    noteSceneHydration();
    const entry = meshes.get(id);
    if (entry) scene.remove(entry.mesh);
    colliderDebug.remove(id);
    if (piece.type === 'board') boardTopY = 0; // back to bare table until a new board arrives
    if (inspection.isInspecting(id)) inspection.releaseInspect();
    updateHeldLabel(id, ''); // drop its name tag if any
    selection.remove(id); // never keep a removed piece selected
    meshes.delete(id);
    const surface = boardDropSurfaces.get(id);
    if (surface) disposeColliderSurface(surface.root);
    boardDropSurfaces.delete(id);
    buffers.delete(id);
  });

  overlays.bindRoom(room, cb, noteSceneHydration);

  whiteboard.bindRoom(room); // install replay handlers before the first state-driven request
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
    whiteboard.sync(state.whiteboard); // board visual, ownership, and holder status
    trays.sync(state.trays); // reflect personal trays appearing / being put away
    syncSkybox(state.skybox); // reflect the room's skybox
  });

  room.onMessage('hand', (cards) => {
    hand.setCards(cards);
  }); // your private hand — never seen by other clients
  room.send('handSync'); // re-fetch our hand now the handler is ready (onJoin's send is missed on reconnect)
  room.onMessage('diceList', (list) => {
    diceTextures = Array.isArray(list) ? list : []; // the custom dice-texture library
    refreshTextureChips();
    if (window.onLibraryList) window.onLibraryList('dice', diceTextures); // editor library list
  });
  room.send('listDice'); // load the finish pickers' custom-texture chips (also refreshed on saves)
  room.onMessage('showFan', ({ sid, cards }) => {
    // cards another player is showing you, face-up in their fan
    hand.setRevealed(sid, cards);
    refreshFan(sid);
  });
  room.onMessage('ping', ({ sid, x, z }) => spawnPing(sid, x, z)); // someone's "look here" marker
  room.onMessage('chatMsg', (m) => addChatMsg(m));
  room.onMessage('chatLog', ({ log } = {}) => {
    const el = byId('chatLog');
    if (el) el.replaceChildren();
    (log || []).forEach(addChatMsg);
  }); // late-join replay
  room.send('chatLog'); // refresh/reconnect: fetch room-memory history after the handler is ready
  room.onMessage('notebook', (text) => {
    byId('notesText').value = text || '';
  }); // private room-memory notes for this account
  room.send('notebookSync');
  room.onMessage('skyList', (list) => {
    if (window.onLibraryList) window.onLibraryList('sky', list || []);
  }); // fans to the library + skybox picker
  room.onMessage('skyError', ({ message } = {}) => {
    const e = byId('skyErr');
    if (e) e.textContent = message || 'Could not add that skybox.';
  });
  let lastAssetErrorAt = 0;
  room.onMessage('assetError', ({ message } = {}) => {
    const now = Date.now();
    if (now - lastAssetErrorAt < 5000) return; // one refresh requests every asset kind; report one outage, not five alerts
    lastAssetErrorAt = now;
    alert(message || 'The library is temporarily unavailable.');
  });
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
  room.onMessage('memberList', (list) => {
    renderMembers(list);
    updateMembersPulse(list);
  }); // panel data + pending-pulse

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
  room.onMessage('shuffled', ({ id }) => {
    startAnim(id, 'shuffle');
    playSfx('shuffle');
  }); // everyone sees + hears the riffle
  room.onMessage('sfx', ({ type } = {}) => playSfx(type)); // shared cue (roll/flip/deal) broadcast by the server
  // The undo may be partial (another player picked some up) or stale (30s window gone).
  room.onMessage('dropUndone', ({ restored } = {}) => {
    if (restored)
      toast('Returned ' + restored + ' card' + (restored === 1 ? '' : 's') + ' to your hand');
    else toast('Those cards are no longer on the table', 'x');
  });
  room.onMessage('inspectCard', ({ front, back, tile, geom }) =>
    inspection.inspectMesh(cardMesh({ front, back, tile, geom }), { drawn: true, type: 'card' }),
  ); // drawn card — front is ours alone; tile/geom → correct proportions
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

  // seats, turn order, and other players' fanned hand-backs (all public info)
  cb(room.state).players.onAdd((player, sid) => {
    noteSceneHydration();
    if (sid === mySession) {
      mySeat = player.seat;
      applySeat(mySeat);
      applyRole(player.role);
      {
        const mn = byId('myName');
        if (mn) mn.textContent = player.name;
      }
      updateMyPreview(player.avatar);
      refreshMyChip();
    }
    refreshFan(sid);
    refreshMarker(sid);
    renderPlayers();
    renderUnclaimed();
    cb(player).listen(
      'hand',
      () => {
        refreshFan(sid);
        renderPlayers();
      },
      false,
    );
    cb(player).listen(
      'seat',
      () => {
        if (sid === mySession) {
          mySeat = player.seat;
          applySeat(mySeat);
          refreshMyChip();
        }
        refreshFan(sid);
        refreshMarker(sid);
      },
      false,
    );
    cb(player).listen(
      'name',
      () => {
        if (sid === mySession) {
          const mn = byId('myName');
          if (mn) mn.textContent = player.name;
        }
        refreshMarker(sid);
        renderPlayers();
      },
      false,
    );
    cb(player).listen(
      'role',
      () => {
        if (sid === mySession) applyRole(player.role);
        renderPlayers();
      },
      false,
    );
    cb(player).listen('order', renderPlayers, false);
    cb(player).listen(
      'avatar',
      () => {
        if (sid === mySession) updateMyPreview(player.avatar);
        else refreshMarker(sid);
        renderPlayers();
      },
      false,
    );
    cb(player).listen(
      'color',
      () => {
        if (sid === mySession) refreshMyChip();
        refreshMarker(sid);
        renderPlayers();
      },
      false,
    );
    cb(player).listen('showing', () => refreshMarker(sid), false); // redraw the seat badge on show/stop
    cb(player).listen('handBack', () => refreshFan(sid), false); // re-skin the fan backs when the deck's back changes
  });
  cb(room.state).players.onRemove((player, sid) => {
    noteSceneHydration();
    removePlayerVis(sid);
    overlays.clearDragPreview(sid);
    renderPlayers();
    renderUnclaimed();
  });
  cb(room.state).listen('turn', renderPlayers, false);

  // Durable scoreboard + room notes (synced like the timer). Register
  // unconditionally: right after join the nested fields haven't decoded yet
  // (room.state.scores is briefly undefined), but the callback proxy tracks them
  // by schema and fires once they arrive. renderScores guards the empty window.
  // The try/catch only covers a theoretical old server missing these fields.
  try {
    cb(room.state).scores.onAdd((row) => {
      renderScores();
      cb(row).listen('score', renderScores, false);
      cb(row).listen('label', renderScores, false);
    });
    cb(room.state).scores.onRemove(() => renderScores());
    cb(room.state).listen('notes', updateRoomNotes, false);
    cb(room.state).listen('roomName', renderPlayers, false);
    cb(room.state).listen(
      'tableX',
      () => {
        resizeTable(room.state.tableX, room.state.tableZ, room.state.tableShape);
        rebuildSeats();
        rebuildGrid();
      },
      false,
    );
    cb(room.state).listen(
      'tableZ',
      () => {
        resizeTable(room.state.tableX, room.state.tableZ, room.state.tableShape);
        rebuildSeats();
        rebuildGrid();
      },
      false,
    );
    cb(room.state).listen(
      'tableShape',
      () => {
        resizeTable(room.state.tableX, room.state.tableZ, room.state.tableShape);
        rebuildGrid();
        syncTableShapeUI();
      },
      false,
    );
    cb(room.state).listen(
      'rimWood',
      () => {
        setRimWood(room.state.rimWood);
        syncTableShapeUI();
      },
      false,
    );
    cb(room.state).listen('feltColor', () => setTableColor(room.state.feltColor), false);
    const onLighting = () => {
      applyLighting(room.state.lighting);
      syncLightingPanel();
    };
    for (const field of [
      'preset',
      'azimuth',
      'elevation',
      'keyIntensity',
      'keyColor',
      'ambientIntensity',
      'ambientColor',
      'shadowSoftness',
    ])
      cb(room.state).lighting.listen(field, onLighting, false);
    cb(room.state).unclaimed.onAdd(() => renderUnclaimed());
    cb(room.state).unclaimed.onRemove(() => renderUnclaimed());
    cb(room.state).listen('turnPending', renderPlayers, false);
    cb(room.state).scale.listen('worldPerUnit', syncScalePanel, false);
    cb(room.state).scale.listen('unitLabel', syncScalePanel, false);
    cb(room.state).scale.listen('roundStep', syncScalePanel, false);
    const onGrid = () => {
      rebuildGrid();
      syncScalePanel();
    }; // redraw + reflect the panel
    cb(room.state).scale.listen('cellWorld', onGrid, false); // grid: cell width (X)
    cb(room.state).scale.listen('cellZ', onGrid, false); // grid: cell depth (Z) — rectangular grids
    cb(room.state).scale.listen('gridX', onGrid, false); // grid: lattice offset X
    cb(room.state).scale.listen('gridZ', onGrid, false); // grid: lattice offset Z
    cb(room.state).scale.listen('gridStyle', onGrid, false); // grid: off / square / hex
    cb(room.state).scale.listen('hexOrient', onGrid, false); // hex: pointy / flat orientation
    cb(room.state).scale.listen('gridHidden', onGrid, false); // grid: shown / hidden (still snaps)
    cb(room.state).scale.listen('gridColor', onGrid, false); // grid: line colour
    cb(room.state).scale.listen(
      'gridLift',
      () => {
        if (gridLines) gridLines.position.y = gridY();
        syncScalePanel();
      },
      false,
    ); // height: just move it, no rebuild
    cb(room.state).scale.listen('snapAnchor', syncScalePanel, false); // snap target only — no redraw
  } catch (e) {
    /* older server without these fields — feature stays inert */
  }
  renderScores();
  updateRoomNotes();
  renderUnclaimed();
  if (room.state.tableX) {
    resizeTable(room.state.tableX, room.state.tableZ, room.state.tableShape);
    rebuildSeats();
  } // initial size (may be default until decode)
  if (room.state.feltColor) setTableColor(room.state.feltColor); // initial felt color
  if (room.state.lighting) applyLighting(room.state.lighting, { duration: 0 });
  setRimWood(room.state.rimWood || 'mahogany'); // initial rim wood
  rebuildGrid(); // initial grid (inert until a GM sets a cell size + square style)
  syncSkybox(room.state.skybox); // include the room's initial environment in the loading gate
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
  // Room Settings modal (UI_Redesign phase 3): tabbed Table Size & Color + Scale & Grid (Whiteboard + Skybox join in 3b).
  {
    const rs = byId('roomSettingsModal');
    let lightingDraft = null;
    let lightingEditing = false;
    const lightingFields = {
      azimuth: byId('lightingAzimuth'),
      elevation: byId('lightingElevation'),
      keyIntensity: byId('lightingKeyIntensity'),
      keyColor: byId('lightingKeyColor'),
      ambientIntensity: byId('lightingAmbientIntensity'),
      ambientColor: byId('lightingAmbientColor'),
      shadowSoftness: byId('lightingShadowSoftness'),
    };
    const lightingValue = () => normalizeLighting(room.state.lighting);
    const renderLightingGlobe = () => {
      if (!lightingDraft) return;
      const globe = byId('lightingGlobe');
      const az = (lightingDraft.azimuth * Math.PI) / 180;
      const el = (lightingDraft.elevation * Math.PI) / 180;
      const x = 50 + Math.sin(az) * Math.cos(el) * 42;
      const y = 50 - Math.sin(el) * 42;
      globe?.style.setProperty('--light-x', `${x}%`);
      globe?.style.setProperty('--light-y', `${y}%`);
      globe?.style.setProperty('--sun-x', `${x}%`);
      globe?.style.setProperty('--sun-y', `${y}%`);
      globe?.style.setProperty('--key-color', lightingDraft.keyColor);
      globe?.style.setProperty('--ambient-color', lightingDraft.ambientColor);
      globe?.style.setProperty(
        '--globe-brightness',
        String(0.35 + lightingDraft.ambientIntensity * 0.35 + lightingDraft.keyIntensity * 0.3),
      );
      globe?.style.setProperty('--shadow-angle', `${lightingDraft.azimuth + 180}deg`);
      globe?.style.setProperty('--shadow-blur', `${1 + lightingDraft.shadowSoftness * 8}px`);
      globe?.style.setProperty(
        '--shadow-opacity',
        String(
          Math.min(0.85, lightingDraft.keyIntensity * (1 - lightingDraft.ambientIntensity * 0.5)),
        ),
      );
      globe?.setAttribute('aria-valuenow', String(Math.round(lightingDraft.azimuth)));
      globe?.setAttribute(
        'aria-valuetext',
        `${Math.round(lightingDraft.azimuth)} degree heading, ${Math.round(lightingDraft.elevation)} degree elevation`,
      );
    };
    const renderLightingControls = () => {
      if (!lightingDraft || !byId('lightingPreset')) return;
      byId('lightingPreset').value = lightingDraft.preset;
      for (const [key, input] of Object.entries(lightingFields))
        if (input) input.value = lightingDraft[key];
      byId('lightingKeyOut').textContent = `${Math.round(lightingDraft.keyIntensity * 100)}%`;
      byId('lightingAmbientOut').textContent =
        `${Math.round(lightingDraft.ambientIntensity * 100)}%`;
      byId('lightingShadowOut').textContent =
        lightingDraft.shadowSoftness < 0.34
          ? 'Hard'
          : lightingDraft.shadowSoftness < 0.67
            ? 'Medium'
            : 'Soft';
      renderLightingGlobe();
    };
    const previewLighting = (custom = true) => {
      if (!lightingDraft) return;
      if (custom) lightingDraft.preset = 'custom';
      lightingDraft = normalizeLighting(lightingDraft);
      renderLightingControls();
      applyLighting(lightingDraft, { duration: 0 });
    };
    syncLightingPanel = () => {
      if (lightingEditing) return;
      lightingDraft = lightingValue();
      const isOwner = room.state.players.get(room.sessionId)?.role === 'owner';
      if (byId('lightingSaveDefault')) byId('lightingSaveDefault').hidden = !isOwner;
      if (byId('lightingFactory')) byId('lightingFactory').hidden = !isOwner;
      renderLightingControls();
    };
    const syncRoomSettings = () => {
      byId('tableW').value = Math.round(room.state.tableX * 2);
      byId('tableD').value = Math.round(room.state.tableZ * 2);
      syncTableShapeUI();
      byId('tableFelt').value = room.state.feltColor || '#2f6b4f';
      syncScalePanel();
      whiteboard.syncSettings(room.state.whiteboard);
      lightingEditing = false;
      syncLightingPanel();
    };
    wire('roomSettings', () => {
      byId('roomGrp').hidden = true;
      if (rs) {
        rs.hidden = false;
        syncRoomSettings();
      }
    });
    wire('roomSettingsClose', () => {
      if (rs) {
        if (lightingEditing) applyLighting(lightingValue(), { duration: 0 });
        lightingEditing = false;
        rs.hidden = true;
      }
    });
    rs?.querySelectorAll('.libTab').forEach(
      (t) =>
        (t.onclick = () => {
          rs.querySelectorAll('.libTab').forEach((x) => x.classList.toggle('on', x === t));
          rs.querySelectorAll('.libPane').forEach((p) => {
            p.hidden = p.dataset.pane !== t.dataset.tab;
          });
        }),
    );

    const preset = byId('lightingPreset');
    if (preset)
      preset.onchange = () => {
        if (preset.value === 'custom') {
          lightingDraft.preset = 'custom';
          lightingEditing = true;
          return previewLighting(false);
        }
        if (!LIGHTING_PRESETS[preset.value]) return;
        lightingDraft = { preset: preset.value, ...LIGHTING_PRESETS[preset.value] };
        lightingEditing = true;
        previewLighting(false);
      };
    for (const [key, input] of Object.entries(lightingFields)) {
      if (!input) continue;
      input.oninput = () => {
        lightingEditing = true;
        lightingDraft[key] = input.type === 'color' ? input.value : +input.value;
        previewLighting();
      };
    }
    const globe = byId('lightingGlobe');
    if (globe) {
      let drag = null;
      globe.onpointerdown = (event) => {
        drag = {
          x: event.clientX,
          y: event.clientY,
          azimuth: lightingDraft.azimuth,
          elevation: lightingDraft.elevation,
        };
        globe.setPointerCapture(event.pointerId);
      };
      globe.onpointermove = (event) => {
        if (!drag) return;
        lightingEditing = true;
        lightingDraft.azimuth = (drag.azimuth + (event.clientX - drag.x) * 1.5 + 360) % 360;
        lightingDraft.elevation = Math.max(
          10,
          Math.min(90, drag.elevation - (event.clientY - drag.y) * 0.65),
        );
        previewLighting();
      };
      globe.onpointerup = globe.onpointercancel = () => (drag = null);
      globe.onkeydown = (event) => {
        const fine = event.shiftKey ? 1 : 5;
        if (event.key === 'ArrowLeft') lightingDraft.azimuth -= fine;
        else if (event.key === 'ArrowRight') lightingDraft.azimuth += fine;
        else if (event.key === 'ArrowUp') lightingDraft.elevation += fine;
        else if (event.key === 'ArrowDown') lightingDraft.elevation -= fine;
        else return;
        event.preventDefault();
        lightingEditing = true;
        lightingDraft.azimuth = (lightingDraft.azimuth + 360) % 360;
        lightingDraft.elevation = Math.max(10, Math.min(90, lightingDraft.elevation));
        previewLighting();
      };
      globe.ondblclick = () => {
        const name = LIGHTING_PRESETS[lightingDraft.preset] ? lightingDraft.preset : 'neutral';
        lightingDraft = { preset: name, ...LIGHTING_PRESETS[name] };
        lightingEditing = true;
        previewLighting(false);
      };
    }
    wire('lightingApply', () => {
      room.send('lightingApply', normalizeLighting(lightingDraft));
      lightingEditing = false;
      if (rs) rs.hidden = true;
    });
    wire('lightingCancel', () => {
      lightingEditing = false;
      applyLighting(lightingValue(), { duration: 0 });
      if (rs) rs.hidden = true;
    });
    wire('lightingRestore', () => {
      lightingEditing = false;
      room.send('lightingRestore');
    });
    wire('lightingSaveDefault', () => {
      const lighting = normalizeLighting(lightingDraft);
      lightingEditing = false;
      room.send('lightingDefaultSave', lighting);
    });
    wire('lightingFactory', () => {
      if (confirm('Reset the room default and current lighting to the factory setup?')) {
        lightingEditing = false;
        room.send('lightingFactoryReset');
      }
    });
  }
  whiteboard.bindControls(); // Room Settings config and the drawing toolbar
  wire('roomReset', () => {
    byId('roomGrp').hidden = true;
    if (confirm('Reset the table? This clears all pieces.')) room.send('reset');
  });
  room.onMessage('deckList', (decks) => {
    if (window.onLibraryList) window.onLibraryList('deck', decks);
  });
  room.onMessage('propList', (props) => {
    if (window.onLibraryList) window.onLibraryList('prop', props);
  });
  // Live table resize: each ± (or a typed change) on width/depth applies immediately.
  {
    const send = () => {
      const shape = room.state.tableShape || 'rect';
      const x = (+byId('tableW').value || 20) / 2;
      const z = shape === 'round' || shape === 'hex' ? x : (+byId('tableD').value || 14) / 2;
      room.send('table', { x, z });
    };
    const w = byId('tableW'),
      d = byId('tableD');
    if (w) w.onchange = send;
    if (d) d.onchange = send;
    // Shape picker: rect/round/oval/hex/roundedRect. round + hex are single-size (send z = x).
    document.querySelectorAll('#tableShapes [data-tshape]').forEach((b) => {
      b.onclick = () => {
        const shape = b.dataset.tshape;
        const msg = { shape };
        if (shape === 'round' || shape === 'hex') {
          msg.x = room.state.tableX;
          msg.z = room.state.tableX; // depth follows width for round/hex
        }
        room.send('table', msg);
      };
    });
    // Rim wood picker (GM-set, durable): swap the wooden border texture.
    document.querySelectorAll('#tableWoods [data-wood]').forEach((b) => {
      b.onclick = () => room.send('table', { rimWood: b.dataset.wood });
    });
    const felt = byId('tableFelt');
    if (felt) felt.oninput = () => room.send('tableColor', { color: felt.value });
    buildColorSwatches(byId('feltSwatches'), FELT_COLORS, (hex) => {
      const f = byId('tableFelt');
      if (f) f.value = hex;
      room.send('tableColor', { color: hex });
    });
  }

  // Measurement scale (GM-set, durable). Reads live from room.state.scale; writes
  // via scaleSet. Drag-calibration lands with the ruler tool (Step 3).
  function syncScalePanel() {
    const sc = room.state.scale;
    if (!sc) return;
    const u = sc.unitLabel || 'u';
    const custom = u !== 'u' && !['in', 'cm', 'mm'].includes(u); // a user-typed label like "hex"
    // Light the matching toggle (or Custom…); reveal the custom field only when custom.
    document
      .querySelectorAll('#scaleUnits [data-unit]')
      .forEach((b) =>
        b.classList.toggle(
          'on',
          b.dataset.unit === u || (custom && b.dataset.unit === '__custom__'),
        ),
      );
    const cRow = byId('scaleCustomRow');
    if (cRow) cRow.hidden = !custom;
    const cInp = byId('scaleUnitCustom');
    if (cInp && document.activeElement !== cInp) cInp.value = custom ? u : '';
    const sEl = byId('scaleStep');
    // roundStep arrives as a float32 from the schema (0.1 → 0.10000000149…), which
    // overflowed the field. Show it at the precision anyone would type.
    if (sEl && document.activeElement !== sEl) sEl.value = String(+(+sc.roundStep).toFixed(4));
    const su = byId('scaleStepUnit');
    if (su) su.textContent = u;
    const wu = byId('scaleWidthUnit');
    if (wu) wu.textContent = u;
    const wv = byId('scaleWidthVal'); // prefill with the table's CURRENT width in display units (editable)
    if (wv && document.activeElement !== wv) {
      const cur = (room.state.tableX * 2) / (+sc.worldPerUnit || 1);
      wv.value = Number.isFinite(cur) ? String(+cur.toFixed(2)) : '';
    }
    // Grid controls: light the active style, reveal cell/color rows when a grid is on,
    // show the cell size in display units, and mirror the line color.
    const gStyle = sc.gridStyle || 'off',
      gridOn = gStyle !== 'off',
      isHex = gStyle === 'hex';
    document
      .querySelectorAll('#gridStyles [data-grid]')
      .forEach((b) => b.classList.toggle('on', b.dataset.grid === gStyle));
    const gorow = byId('gridOrientRow');
    if (gorow) gorow.hidden = !isHex; // orientation (pointy/flat) is hex-only
    const orient = sc.hexOrient === 'flat' ? 'flat' : 'pointy';
    document
      .querySelectorAll('#gridOrients [data-orient]')
      .forEach((b) => b.classList.toggle('on', b.dataset.orient === orient));
    const gclbl = byId('gridCellLabel');
    if (gclbl) gclbl.textContent = isHex ? 'Hex size' : 'Cell size';
    const gczSep = byId('gridCellZSep');
    if (gczSep) gczSep.hidden = isHex; // hex is a single size — no separate depth
    const gczIn = byId('gridCellZ');
    const gczWrap = (gczIn && gczIn.closest('.stepper')) || gczIn; // hide the whole stepper, not just the input
    if (gczWrap) gczWrap.hidden = isHex;
    const gcr = byId('gridCellRow');
    if (gcr) gcr.hidden = !gridOn;
    const gor = byId('gridOffRow');
    if (gor) gor.hidden = !gridOn;
    const gou = byId('gridOffUnit');
    if (gou) gou.textContent = u;
    const gcalr = byId('gridCalibRow');
    if (gcalr) gcalr.hidden = !gridOn;
    const gkr = byId('gridColorRow');
    if (gkr) gkr.hidden = !gridOn;
    const glr = byId('gridLiftRow');
    if (glr) glr.hidden = !gridOn;
    const gl = byId('gridLift');
    if (gl && document.activeElement !== gl)
      gl.value = Number.isFinite(+sc.gridLift) ? sc.gridLift : 0.05;
    const gcu = byId('gridCellUnit');
    if (gcu) gcu.textContent = u;
    const perU = +sc.worldPerUnit || 1;
    const gc = byId('gridCell');
    if (gc && document.activeElement !== gc) {
      const wc = (+sc.cellWorld || 0) / perU;
      gc.value = wc > 0 ? String(+wc.toFixed(3)) : '';
    }
    const gcz = byId('gridCellZ'); // cell DEPTH (Z spacing); falls back to the width for a square grid
    if (gcz && document.activeElement !== gcz) {
      const dc = ((+sc.cellZ > 0 ? +sc.cellZ : +sc.cellWorld) || 0) / perU;
      gcz.value = dc > 0 ? String(+dc.toFixed(3)) : '';
    }
    const gox = byId('gridOffX');
    if (gox && document.activeElement !== gox)
      gox.value = String(+((+sc.gridX || 0) / perU).toFixed(3));
    const goz = byId('gridOffZ');
    if (goz && document.activeElement !== goz)
      goz.value = String(+((+sc.gridZ || 0) / perU).toFixed(3));
    const gk = byId('gridColor');
    if (gk && document.activeElement !== gk && /^#[0-9a-f]{6}$/i.test(sc.gridColor || ''))
      gk.value = sc.gridColor;
    const gsr = byId('gridSnapRow');
    if (gsr) gsr.hidden = !gridOn || isHex; // snap anchor (centres vs crossings); hex is centres-only
    const ghr = byId('gridHideRow');
    if (ghr) ghr.hidden = !gridOn; // hide-grid toggle (snaps, not drawn)
    const ght = byId('gridHideTog');
    if (ght) {
      ght.classList.toggle('on', !!sc.gridHidden);
      setIcon(ght, sc.gridHidden ? 'eye-off' : 'eye');
    }
    const anchor = sc.snapAnchor === 'cross' ? 'cross' : 'center';
    document
      .querySelectorAll('#gridAnchors [data-anchor]')
      .forEach((b) => b.classList.toggle('on', b.dataset.anchor === anchor));
    overlays.relabel(); // scale drives every ruler's label
  }
  {
    const sEl = byId('scaleStep');
    if (sEl)
      sEl.onchange = () => {
        const v = +sEl.value;
        if (v > 0) room.send('scaleSet', { roundStep: v });
      };
    const cRow = byId('scaleCustomRow'),
      cInp = byId('scaleUnitCustom');
    // Unit toggles: inch/cm/mm set the label + a sensible round step; "Custom…" reveals
    // a text field for a free-form label (e.g. "hex"). Mirrors the Measure kind picker.
    document.querySelectorAll('#scaleUnits [data-unit]').forEach((b) => {
      b.onclick = () => {
        if (b.dataset.unit === '__custom__') {
          document
            .querySelectorAll('#scaleUnits [data-unit]')
            .forEach((x) => x.classList.toggle('on', x === b));
          if (cRow) cRow.hidden = false;
          if (cInp) {
            cInp.focus();
            cInp.select();
          }
        } else {
          room.send('scaleSet', { unitLabel: b.dataset.unit, roundStep: +b.dataset.step || 0.5 });
        }
      };
    });
    const sendCustom = () => {
      const v = (cInp.value || '').trim().slice(0, 8);
      if (v) room.send('scaleSet', { unitLabel: v });
    };
    if (cInp) {
      cInp.onchange = sendCustom;
      cInp.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          sendCustom();
          cInp.blur();
        }
      };
    }
    // Calibrate from the typed real width: worldPerUnit = tableWorldWidth / N.
    const setW = byId('scaleWidthSet');
    if (setW)
      setW.onclick = () => {
        const n = parseFloat(byId('scaleWidthVal').value);
        if (n > 0) room.send('scaleSet', { worldPerUnit: (room.state.tableX * 2) / n });
      };
    const wv = byId('scaleWidthVal');
    if (wv)
      wv.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          setW && setW.onclick();
        }
      };
    // Grid: style toggle (Off/Square), cell size (display units → world), line color.
    document.querySelectorAll('#gridStyles [data-grid]').forEach((b) => {
      b.onclick = () => {
        const msg = { gridStyle: b.dataset.grid };
        // Enabling a grid for the first time needs a cell size, or it renders nothing:
        // default to one display unit per cell.
        if (b.dataset.grid !== 'off' && !(+room.state.scale.cellWorld > 0))
          msg.cellWorld = +room.state.scale.worldPerUnit || 1;
        room.send('scaleSet', msg);
      };
    });
    // Cell size — width (X) and depth (Z) independently, so a rectangular board (go) can be
    // matched. Equal values = a square grid.
    const gc = byId('gridCell');
    if (gc)
      gc.onchange = () => {
        const v = +gc.value;
        if (v > 0) room.send('scaleSet', { cellWorld: v * (+room.state.scale.worldPerUnit || 1) });
      };
    const gcz = byId('gridCellZ');
    if (gcz)
      gcz.onchange = () => {
        const v = +gcz.value;
        if (v > 0) room.send('scaleSet', { cellZ: v * (+room.state.scale.worldPerUnit || 1) });
      };
    // Offset — nudge the grid lattice to line up with a printed map's phase (X, Z).
    const gox = byId('gridOffX');
    if (gox)
      gox.onchange = () =>
        room.send('scaleSet', { gridX: (+gox.value || 0) * (+room.state.scale.worldPerUnit || 1) });
    const goz = byId('gridOffZ');
    if (goz)
      goz.onchange = () =>
        room.send('scaleSet', { gridZ: (+goz.value || 0) * (+room.state.scale.worldPerUnit || 1) });
    const gk = byId('gridColor');
    if (gk) gk.oninput = () => room.send('scaleSet', { gridColor: gk.value });
    buildColorSwatches(byId('gridColorSwatches'), GRID_COLORS, (hex) => {
      const g = byId('gridColor');
      if (g) g.value = hex;
      room.send('scaleSet', { gridColor: hex });
    });
    const gl = byId('gridLift');
    if (gl) gl.oninput = () => room.send('scaleSet', { gridLift: +gl.value });
    // Snap anchor: cell centres (chess/checkers) vs line crossings (go). Also tells the
    // "Fit to board" button whether the count you enter means squares or lines.
    document.querySelectorAll('#gridAnchors [data-anchor]').forEach((b) => {
      b.onclick = () => room.send('scaleSet', { snapAnchor: b.dataset.anchor });
    });
    // Hex orientation: pointy-top vs flat-top (hex grids only).
    document.querySelectorAll('#gridOrients [data-orient]').forEach((b) => {
      b.onclick = () => room.send('scaleSet', { hexOrient: b.dataset.orient });
    });
    {
      const b = byId('gridHideTog');
      if (b) b.onclick = () => room.send('scaleSet', { gridHidden: !room.state.scale.gridHidden });
    } // hide the lines, keep snapping
    // Fit to board: size the grid to the board on the table. Built-in boards need nothing (the
    // registry knows their geometry — one click); a custom/image board takes the count you type
    // in the "across" field, read as squares or lines per the current Snap-to setting.
    const calibBtn = byId('gridCalib');
    if (calibBtn)
      calibBtn.onclick = () => {
        let boardPiece = null;
        room.state.pieces.forEach((p) => {
          if (!boardPiece && p.type === 'board') boardPiece = p;
        });
        if (!boardPiece) {
          alert('Place a board on the table first, then fit the grid to it.');
          return;
        }
        const spec = BOARDS[JSON.parse(boardPiece.props || '{}').board];
        const n = parseInt(byId('gridCells').value, 10);
        if (room.state.scale.gridStyle === 'hex') {
          if (n > 0) room.send('calibrateGrid', { cells: n });
          else alert('Enter how many hexes go across the board.');
          return;
        }
        const anchor = room.state.scale.snapAnchor === 'cross' ? 'cross' : 'center';
        if (n > 0) room.send('calibrateGrid', { cells: n, anchor });
        else if (spec && spec.grid)
          room.send('calibrateGrid', {}); // built-in: use its known cell count
        else alert('Enter how many cells (or lines, for a go-style board) go across the board.');
      };
  }

  overlays.bindControls(); // Measure pane kind picker and clear actions

  // Scene list → the Library's Scenes tab (via the hook); loading happens there.
  room.onMessage('sceneList', (scenes) => {
    if (window.onLibraryList) window.onLibraryList('scene', scenes);
  });
  room.onMessage('sceneError', ({ message } = {}) => alert(message || 'Could not save the scene.'));
  wire('roomSaveState', () => room.send('stateSave'));
  room.onMessage('stateSaved', () => {
    const b = byId('roomSaveState');
    if (!b) return;
    const label = b._saveLabel || b.querySelector('.lbl')?.textContent || 'Save Table';
    b._saveLabel = label;
    clearTimeout(b._saveFeedbackTimer);
    setIcon(b, 'square-check');
    setBtnLabel(b, 'Saved ✓');
    b._saveFeedbackTimer = setTimeout(() => {
      setIcon(b, 'device-floppy');
      setBtnLabel(b, label);
    }, 1500);
  });
  room.onMessage('boardList', (boards) => {
    if (window.onLibraryList) window.onLibraryList('board', boards);
  });
  room.onMessage('matList', (mats) => {
    if (window.onLibraryList) window.onLibraryList('mat', mats);
  });
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
  wire('mySeatBtn', () => applySeat(mySeat)); // snap the camera back to your seat
  wire('birdsEyeBtn', applyBirdsEye); // fit the whole table into a straight-down view
  byId('turnBtn').onclick = () => room.send('nextTurn'); // the Your Turn pill advances the turn (server enforces who may)
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
  byId('avatarInput').addEventListener('change', async (e) => {
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
  // Graphics quality (Settings → UI): a client-local render tier, persisted on this device.
  // Picking a tier persists it and live-applies pixel ratio + shadows; antialias (and, on iOS
  // Safari, the pixel-ratio change) only take full effect on reload, so an Apply button appears
  // once the selection differs from the tier the page booted with.
  {
    const qrow = byId('qualityRow');
    const applyBtn = byId('qualityApply');
    if (qrow) {
      const bootedTier = getQuality();
      const chips = [...qrow.querySelectorAll('[data-quality]')];
      const sync = () => {
        chips.forEach((c) => c.classList.toggle('on', c.dataset.quality === getQuality()));
        if (applyBtn) applyBtn.hidden = getQuality() === bootedTier;
      };
      chips.forEach(
        (c) =>
          (c.onclick = () => {
            setQuality(c.dataset.quality);
            sync();
          }),
      );
      if (applyBtn) applyBtn.onclick = () => location.reload();
      sync();
    }
  }
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
  // Skybox resolution (Settings → UI): per-viewer, applies live (no reload needed).
  {
    const srow = byId('skyResRow');
    if (srow) {
      const chips = [...srow.querySelectorAll('[data-skyres]')];
      const sync = () =>
        chips.forEach((c) => c.classList.toggle('on', c.dataset.skyres === getSkyRes()));
      chips.forEach(
        (c) =>
          (c.onclick = () => {
            setSkyRes(c.dataset.skyres);
            sync();
          }),
      );
      sync();
    }
  }
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
  {
    // Public chat panel (Tools)
    const input = byId('chatInput');
    if (input && byId('chatSend')) {
      const send = () => {
        const t = input.value.trim();
        if (t) {
          room.send('chat', { text: t });
          input.value = '';
        }
      };
      byId('chatSend').onclick = send;
      input.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          send();
        }
      };
    }
  }
  let notesTimer = null;
  notesText.addEventListener('input', () => {
    // debounce so we persist without flooding the socket
    clearTimeout(notesTimer);
    notesTimer = setTimeout(() => room.send('notebook', { text: notesText.value }), 400);
  });

  // Shared timer: controls just send commands; the readout is computed locally
  // from the synced anchor (state.timer), so it ticks smoothly with no per-second
  // patches. The interval also mirrors another client's changes into the controls.
  const timerReadout = byId('timerReadout'),
    timerToggle = byId('timerToggle');
  const timerMode = byId('timerMode'),
    timerDurRow = byId('timerDurRow'),
    timerDur = byId('timerDur');
  const durMs = () => (+timerDur.value || 0) * 60000;
  const modeVal = () => {
    const c = timerMode.querySelector('.libTab.on');
    return c ? c.dataset.mode : 'up';
  };
  const setMode = (m) =>
    timerMode
      .querySelectorAll('.libTab')
      .forEach((c) => c.classList.toggle('on', c.dataset.mode === m));
  // Timer open/close is handled by the top-right cluster (wireCluster below); its live value also shows in the button (see the tick loop).

  // Scoreboard + room notes content (now in the top-right region; opened via wireCluster)
  if (byId('scoreRows')) {
    byId('scoreAdd').onclick = () => {
      const n = byId('scoreAddName');
      room.send('score', { action: 'add', label: n.value.trim() || 'Player' });
      n.value = '';
    };
    byId('scoreAddName').onkeydown = (e) => {
      if (e.key === 'Enter') byId('scoreAdd').click();
    };
    byId('scoreClear').onclick = () => {
      if (confirm('Clear the whole scoreboard?')) room.send('score', { action: 'clear' });
    };
    const roomNotesEl = byId('roomNotes');
    let roomNotesTimer;
    roomNotesEl.oninput = () => {
      clearTimeout(roomNotesTimer);
      roomNotesTimer = setTimeout(() => room.send('roomNotes', { text: roomNotesEl.value }), 400);
    };
    roomNotesEl.onblur = () => {
      clearTimeout(roomNotesTimer);
      room.send('roomNotes', { text: roomNotesEl.value });
    };
  }
  timerToggle.onclick = () =>
    room.send('timer', { action: room.state.timer.running ? 'pause' : 'start' });
  byId('timerReset').onclick = () => room.send('timer', { action: 'reset' });
  timerMode.querySelectorAll('.libTab').forEach(
    (c) =>
      (c.onclick = () => {
        setMode(c.dataset.mode);
        room.send('timer', { action: 'set', mode: c.dataset.mode, duration: durMs() });
      }),
  );
  timerDur.onchange = () => room.send('timer', { action: 'set', mode: 'down', duration: durMs() });
  setInterval(() => {
    const t = room.state.timer;
    const btnLbl = byId('timerBtn') && byId('timerBtn').querySelector('.lbl');
    if (btnLbl) btnLbl.textContent = t ? fmtTime(timerLive(t, Date.now())) : '00:00';
    const mini = byId('timerMini'); // touch top bar (7e slice 2): the value only, and only while running
    if (mini) {
      mini.hidden = !(t && t.running);
      if (t && t.running) mini.textContent = fmtTime(timerLive(t, Date.now()));
    }
    const r = byId('regionTR');
    const paneOpen = r && !r.hidden && r.querySelector('.pane[data-pane="timer"].on');
    if (!paneOpen || !t) return; // nothing more to draw unless the timer pane is showing
    timerReadout.textContent = fmtTime(timerLive(t, Date.now()));
    setIcon(timerToggle, t.running ? 'player-pause' : 'player-play');
    if (modeVal() !== t.mode) setMode(t.mode); // reflect another client's switch
    timerDurRow.hidden = t.mode !== 'down';
    if (document.activeElement !== timerDur) timerDur.value = Math.round(t.duration / 60000); // don't fight typing
  }, 100);

  // ---- Members (GM tools): admit / kick / promote — rendered into the dock's #memberSection ----

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
    const s = seatLayout[mySeat] || seatLayout[0];
    const n = byId('hand')?.querySelectorAll('.handcard').length || 0;
    room.send('handToTable', {
      faceDown,
      x: s.hand[0] - s.out[0] * 2,
      z: s.hand[2] - s.out[2] * 2,
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

// ===== Skybox (GM-applied, synced to the room; the picker UI is in editor-panel.js) =====
const BUILTIN_SKIES = [
  // baked-in: drop files in public/sky/ and add entries here
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

const skyDefault = scene.background; // the flat color it ships with
let skyLast = null; // last applied skybox ref (guards against a stale async load)
let skyTex = null; // the current background texture, so we can dispose it when it changes
// Swap the background texture, disposing the one it replaces (null → the flat default color).
function setSkyTexture(tex) {
  if (skyTex && skyTex !== tex) skyTex.dispose();
  skyTex = tex || null;
  scene.background = tex || skyDefault;
}

// Per-viewer skybox resolution (Settings → UI → Graphics). Each level is a MAX equirect width; a
// source wider than the cap is downscaled at load so only the smaller texture stays resident. The
// built-ins are 2048, so 'high' and 'ultra' match on them; a larger custom upload uses 'ultra'.
const SKY_RES = { off: 0, low: 512, medium: 1024, high: 2048, ultra: Infinity };
const SKY_RES_KEY = 'tabletop.skyRes';
function getSkyRes() {
  try {
    const v = localStorage.getItem(SKY_RES_KEY);
    if (v && v in SKY_RES) return v;
  } catch {
    /* storage blocked — fall through to the device default */
  }
  const cls = deviceClass(); // phone→low, tablet→medium, desktop→high (matches the quality tiers)
  return cls === 'phone' ? 'low' : cls === 'tablet' ? 'medium' : 'high';
}
function setSkyRes(v) {
  if (!(v in SKY_RES)) return;
  try {
    localStorage.setItem(SKY_RES_KEY, v);
  } catch {
    /* not remembered, but still applied for this session */
  }
  applySkybox(skyLast || ''); // re-apply the current skybox at the new resolution (live, no reload)
}
// Draw a loaded texture's image down to `cap` px wide (equirect stays 2:1), returning a smaller
// CanvasTexture and disposing the original. Returns it unchanged if already within the cap.
function capTexture(tex, cap) {
  const img = tex.image;
  if (!cap || !img || !img.width || img.width <= cap) return tex;
  const nw = cap,
    nh = Math.max(1, Math.round((img.height * cap) / img.width));
  const canvas = document.createElement('canvas');
  canvas.width = nw;
  canvas.height = nh;
  canvas.getContext('2d').drawImage(img, 0, 0, nw, nh);
  tex.dispose(); // not yet uploaded — this just drops the full-res image reference
  return new THREE.CanvasTexture(canvas);
}
// Same idea for a 6-face cube map: downscale each face to `cap` px, rebuild the CubeTexture.
function capCubeTexture(cube, cap) {
  const imgs = cube.image; // 6 face images, in the loaded order
  if (!cap || !Array.isArray(imgs) || !imgs[0] || !imgs[0].width || imgs[0].width <= cap)
    return cube;
  const faces = imgs.map((img) => {
    const nw = cap,
      nh = Math.max(1, Math.round((img.height * cap) / img.width));
    const canvas = document.createElement('canvas');
    canvas.width = nw;
    canvas.height = nh;
    canvas.getContext('2d').drawImage(img, 0, 0, nw, nh);
    return canvas;
  });
  cube.dispose();
  const ct = new THREE.CubeTexture(faces);
  ct.needsUpdate = true;
  return ct;
}
// A skybox "ref" is '' (default), an equirect URL, or a cube descriptor {"t":"cube","f":[6]}.
function applySkybox(ref) {
  if (getSkyRes() === 'off') ref = ''; // skybox turned off for this viewer
  if (!ref) {
    setSkyTexture(null);
    return;
  }
  const cap = SKY_RES[getSkyRes()];
  const aniso = renderer.capabilities.getMaxAnisotropy(); // sharpen grazing angles (esp. the horizon)
  const set = (tex) => {
    if (skyLast === ref) setSkyTexture(tex);
    else tex.dispose(); // a newer ref won the race — don't leak the texture we just loaded
  };
  const fail = () => {
    if (skyLast === ref) setSkyTexture(null);
  };
  if (ref[0] === '{') {
    // cubemap — capped per face like the equirect path
    let d;
    try {
      d = JSON.parse(ref);
    } catch {
      return fail();
    }
    if (d && d.t === 'cube' && Array.isArray(d.f) && d.f.length === 6)
      new THREE.CubeTextureLoader().load(
        d.f,
        (loaded) => {
          const tex = capCubeTexture(loaded, cap);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = aniso;
          set(tex);
        },
        undefined,
        fail,
      );
    else fail();
  } else {
    // equirectangular
    new THREE.TextureLoader().load(
      ref,
      (loaded) => {
        const tex = capTexture(loaded, cap);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = aniso;
        set(tex);
      },
      undefined,
      fail,
    );
  }
}
function syncSkybox(ref) {
  ref = ref || '';
  if (ref === skyLast) return;
  skyLast = ref;
  applySkybox(ref);
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
// Default player-seat framing: close enough for the near rail and hand to anchor the view while
// retaining the whole play surface, matching the natural seated composition players orbit toward.
const VIEW = { lookFwd: 2, lookH: 4, dist: 15.4, rise: 10, zoom: 0.65 };
function seatLayoutFor(hx, hz) {
  const m = 0.8; // hand inset from the edge
  const cx = hx * 0.66,
    cz = hz * 0.69; // diagonal (corner) seat positions
  const sx = hx / 10,
    sz = hz / 7,
    sy = (sx + sz) / 2; // camera scale vs the default 20x14 table
  const cam = (p, t) => ({
    pos: [p[0] * sx, p[1] * sy, p[2] * sz],
    target: [t[0] * sx, t[1] * sy, t[2] * sz],
  });
  const norm = (v) => {
    const l = Math.hypot(v[0], v[2]) || 1;
    return [v[0] / l, 0, v[2] / l];
  };
  const seatCam = (d) => {
    const D = VIEW.dist * VIEW.zoom,
      R = VIEW.rise * VIEW.zoom; // build a seat's camera from VIEW + its facing dir
    return cam(
      [d[0] * (VIEW.lookFwd + D), VIEW.lookH + R, d[2] * (VIEW.lookFwd + D)],
      [d[0] * VIEW.lookFwd, VIEW.lookH, d[2] * VIEW.lookFwd],
    );
  };
  return [
    { hand: [0, 0.25, hz - m], out: [0, 0, 1], cam: seatCam([0, 0, 1]) }, // front  (+z)
    { hand: [0, 0.25, -(hz - m)], out: [0, 0, -1], cam: seatCam([0, 0, -1]) }, // back   (-z)
    { hand: [hx - m, 0.25, 0], out: [1, 0, 0], cam: seatCam([1, 0, 0]) }, // right  (+x)
    { hand: [-(hx - m), 0.25, 0], out: [-1, 0, 0], cam: seatCam([-1, 0, 0]) }, // left   (-x)
    { hand: [cx, 0.25, cz], out: [1, 0, 1], cam: seatCam(norm([1, 0, 1])) }, // front-right
    { hand: [-cx, 0.25, -cz], out: [-1, 0, -1], cam: seatCam(norm([-1, 0, -1])) }, // back-left
    { hand: [-cx, 0.25, cz], out: [-1, 0, 1], cam: seatCam(norm([-1, 0, 1])) }, // front-left
    { hand: [cx, 0.25, -cz], out: [1, 0, -1], cam: seatCam(norm([1, 0, -1])) }, // back-right
  ];
}
let seatLayout = seatLayoutFor(10, 7);

// Recompute seats when the table resizes, then reposition everyone's markers, fans,
// and the "YOU" chip. The camera stays put (use the My Seat button to reframe).
function rebuildSeats() {
  if (!room || !room.state) return;
  seatLayout = seatLayoutFor(room.state.tableX || 10, room.state.tableZ || 7);
  room.state.players.forEach((p, sid) => {
    refreshMarker(sid);
    refreshFan(sid);
  });
  refreshMyChip();
  whiteboard.position(); // the track radius scales with the table
  trays.position(); // personal trays ride the same track — keep them glued to the edge on resize
}
const handGroups = new Map(); // sid -> THREE.Group of face-down backs

function applySeat(seat) {
  const layout = seatLayout[seat];
  if (!layout) return;
  camera.position.set(...layout.cam.pos);
  controls.target.set(...layout.cam.target);
  controls.update();
  setSeatCameraReady();
}

// Fit the current table into a true overhead view. Derive the height from both axes and the
// viewport aspect so resized tables stay fully visible on portrait phones as well as desktops.
function applyBirdsEye() {
  const hx = (room && room.state && room.state.tableX) || 10;
  const hz = (room && room.state && room.state.tableZ) || 7;
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const fitZ = hz / Math.tan(halfFov);
  const fitX = hx / (Math.tan(halfFov) * camera.aspect);
  const height = Math.max(fitX, fitZ) * 1.15;
  controls.target.set(0, 0, 0);
  // A tiny Z offset avoids an undefined camera roll when its view and up vectors are parallel.
  camera.position.set(0, height, 0.001);
  controls.update();
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
  applyBoardRole(); // scoreboard (helper+) and notes (gm+) edit affordances
}

// Scoreboard is helper+ editable, room notes GM+; everyone else sees them read-only.
function applyBoardRole() {
  const edit = byId('scoreEdit');
  if (edit) edit.hidden = myRank < 1;
  const notes = byId('roomNotes');
  if (notes) notes.readOnly = myRank < 2;
  renderScores();
}

function renderScores() {
  const tbody = byId('scoreRows');
  if (!tbody || !room || !room.state || !room.state.scores) return;
  const canEdit = myRank >= 1;
  const on = {
    label: (id, label) => room.send('score', { action: 'label', id, label }),
    adjust: (id, delta) => room.send('score', { action: 'adjust', id, delta }),
    remove: (id) => room.send('score', { action: 'remove', id }),
  };
  tbody.replaceChildren();
  room.state.scores.forEach((row, id) => tbody.appendChild(scoreRow(row, id, { canEdit, on })));
  if (!room.state.scores.size) tbody.appendChild(scoreEmptyRow());
}

function updateRoomNotes() {
  const el = byId('roomNotes');
  if (!el || !room || !room.state) return;
  if (document.activeElement === el) return; // don't stomp a GM mid-type
  const notes = room.state.notes || '';
  if (el.value !== notes) el.value = notes;
}

// Rebuild the fanned face-down backs shown at a player's seat. This includes our own public
// fan: private card faces stay in the bottom bar, while the table fan keeps the hand zone visible.
function refreshFan(sid) {
  const player = room.state.players.get(sid);
  if (!player) return;
  const seat = seatLayout[player.seat];
  if (!seat) return;

  let group = handGroups.get(sid);
  if (!group) {
    group = new THREE.Group();
    scene.add(group);
    handGroups.set(sid, group);
  }
  while (group.children.length) group.remove(group.children[0]);

  const out = new THREE.Vector3(...seat.out).normalize();
  const tangent = new THREE.Vector3(out.z, 0, -out.x); // along the table edge
  const yaw = Math.atan2(out.x, out.z);
  const count = Math.min(player.hand, 12);
  const shown = hand.revealedFor(sid); // cards this player is showing us (face-up)
  for (let i = 0; i < count; i++) {
    // Shown cards fill the leading fan slots face-up; the rest stay face-down,
    // showing the hand's own back image (public) rather than a generic default.
    const card =
      i < shown.length
        ? KIND.card.mesh({ front: shown[i].front, back: shown[i].back })
        : KIND.card.mesh({ back: player.handBack || undefined });
    card.castShadow = card.receiveShadow = false;
    const offset = i - (count - 1) / 2;
    // Lift each card a hair above the last so overlapping cards layer cleanly
    // instead of z-fighting (coplanar backs share the stripe texture and tear).
    card.position.set(
      seat.hand[0] + tangent.x * offset * 0.55,
      seat.hand[1] + i * 0.012,
      seat.hand[2] + tangent.z * offset * 0.55,
    );
    card.rotation.y = yaw + offset * 0.06; // slight fan
    card.scale.setScalar(0.8);
    group.add(card);
  }
}

function removeFan(sid) {
  const group = handGroups.get(sid);
  if (group) {
    scene.remove(group);
    handGroups.delete(sid);
  }
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
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: nameTag(player.name, player.color),
      transparent: true,
      depthTest: false,
    }),
  );
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

// Format milliseconds as m:ss (or h:mm:ss past an hour), flooring to whole seconds.
function fmtTime(ms) {
  const total = Math.floor(ms / 1000);
  const s = total % 60,
    m = Math.floor(total / 60) % 60,
    h = Math.floor(total / 3600);
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
  if (existing) {
    scene.remove(existing);
    markers.delete(sid);
  }

  const out = new THREE.Vector3(...seat.out).normalize();
  const px = seat.hand[0] + out.x * 1.6,
    pz = seat.hand[2] + out.z * 1.6; // just outside the hand zone
  const group = new THREE.Group();

  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.55, 0.08, 20),
    new THREE.MeshStandardMaterial({ color: player.color, roughness: 0.5 }),
  );
  disc.position.set(px, 0.04, pz);
  group.add(disc);

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 3.0),
    new THREE.MeshBasicMaterial({ map: makePlayerTexture(player), transparent: true }),
  );
  plane.position.set(px, 1.55, pz);
  plane.lookAt(0, 1.05, 0); // face the table centre
  group.add(plane);

  scene.add(group);
  markers.set(sid, group);
}

function removePlayerVis(sid) {
  removeFan(sid);
  hand.clearRevealed(sid); // drop anything they were showing us
  const marker = markers.get(sid);
  if (marker) {
    scene.remove(marker);
    markers.delete(sid);
  }
}

// A flat "YOU" chip laid on the felt at your own seat, so you know which edge is
// yours (your standing billboard is skipped — no need to see yourself).
let myChip = null;
function refreshMyChip() {
  if (myChip) {
    scene.remove(myChip);
    myChip = null;
  }
  if (!room || !room.state) return;
  const me = room.state.players.get(mySession);
  if (!me) return; // wait until we know our own seat
  const seat = seatLayout[mySeat];
  if (!seat) return;
  const color = me.color || '#c9a25a';
  const out = new THREE.Vector3(...seat.out).normalize();
  const px = seat.hand[0] - out.x * 1.3,
    pz = seat.hand[2] - out.z * 1.3; // just above the fan, toward the table centre
  const chip = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 1.5),
    new THREE.MeshBasicMaterial({
      map: makeYouChipTexture(color),
      transparent: true,
      depthWrite: false,
    }),
  );
  chip.rotation.x = -Math.PI / 2; // lie flat on the felt
  chip.rotation.z = seatAngle(mySeat); // spin it to face MY seat, so "YOU" reads upright from any seat (not just the front)
  chip.position.set(px, 0.03, pz);
  scene.add(chip);
  myChip = chip;
}

function updateMyPreview(avatar) {
  const el = byId('myAv');
  if (el) el.style.backgroundImage = avatar ? `url(${avatar})` : 'none';
}

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
  getSeat: () => mySeat,
  getDieProps: myDieProps,
  byId,
});

function renderPlayers() {
  // built with DOM + textContent so a player's name can never inject HTML
  {
    const tm = byId('turnMini');
    if (tm) {
      // the Your Turn pill: state + click-to-advance
      let t = '';
      if (room.state.turnPending) t = '\u23F3 ' + room.state.turnPending;
      else if (room.state.turn) {
        const p = room.state.players.get(room.state.turn);
        t =
          room.state.turn === mySession
            ? 'Your Turn'
            : p && p.name
              ? p.name + "'s turn"
              : 'In play';
      }
      tm.textContent = t;
      const tb = byId('turnBtn');
      if (tb) {
        tb.hidden = !t;
        tb.classList.toggle('myturn', room.state.turn === mySession);
        tb.setAttribute('aria-label', t ? t + ' — advance the turn' : 'Advance the turn');
        tb.title = t || 'Advance the turn'; // the label is hidden on touch; the state must still be readable
      } // emphasize + light the chevron when it's yours
    }
  }
  {
    const rt = byId('roomTitle');
    if (rt) {
      if (!rt.textContent.trim()) rt.textContent = 'Shared Table'; // never let the touch bar read empty
      // dock title: real room name if set, else owner-derived (empty in the ?workshop=1 room)
      const nm = (room.state.roomName || '').trim();
      if (nm) rt.textContent = nm;
      else {
        let owner = '';
        room.state.players.forEach((p) => {
          if (p.role === 'owner') owner = p.name;
        });
        rt.textContent = owner ? owner + '\u2019s Table' : 'Shared Table';
      }
    }
  }
  const el = byId('players');
  if (!el) return;
  const list = [];
  room.state.players.forEach((player, sid) => list.push([sid, player]));
  list.sort((a, b) => a[1].order - b[1].order || a[1].seat - b[1].seat);
  el.replaceChildren();
  if (room.state.turnPending) {
    // the turn is held by someone who hasn't rejoined the saved game
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
    row.dataset.sid = sid;
    if (myRank >= 2) {
      row.draggable = true;
      row.title = 'Drag to change turn order';
      row.addEventListener('dragstart', (event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', sid);
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      });
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        const moved = event.dataTransfer.getData('text/plain');
        const order = list.map(([id]) => id);
        const from = order.indexOf(moved);
        const to = order.indexOf(sid);
        if (from < 0 || to < 0 || from === to) return;
        order.splice(to, 0, order.splice(from, 1)[0]);
        room.send('turnOrder', { order });
      });
    }
    if (player.avatar) {
      // server enforces a data:image URL
      const img = document.createElement('img');
      img.className = 'pav';
      img.src = player.avatar;
      row.appendChild(img);
    } else {
      // color is a server palette value
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = player.color;
      row.appendChild(dot);
    }
    const label = document.createElement('span');
    label.textContent = `${player.name}${sid === mySession ? ' (you)' : ''} \u00b7 ${player.hand}`; // textContent = inert
    row.appendChild(label);
    if (player.role && player.role !== 'player') {
      // badge for helper/gm/owner
      const badge = document.createElement('span');
      badge.className = 'rolebadge';
      badge.textContent = player.role;
      row.appendChild(badge);
    }
    if (myRank >= 2) {
      const controls = document.createElement('span');
      controls.className = 'turnOrderControls';
      const move = (delta, symbol, label) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = symbol;
        button.setAttribute('aria-label', `${label} ${player.name} in turn order`);
        button.disabled =
          (delta < 0 && list[0][0] === sid) || (delta > 0 && list[list.length - 1][0] === sid);
        button.onclick = () => {
          const order = list.map(([id]) => id);
          const at = order.indexOf(sid);
          [order[at], order[at + delta]] = [order[at + delta], order[at]];
          room.send('turnOrder', { order });
        };
        controls.appendChild(button);
      };
      move(-1, '↑', 'Move up');
      move(1, '↓', 'Move down');
      row.appendChild(controls);
    }
    el.appendChild(row);
  }
}

// Pulse the Members button in the accent color while any join is pending, so a
// GM sees new requests without opening the panel.
function updateMembersPulse(list) {
  const pending = list.some((m) => m.status === 'pending');
  const dot = byId('memberPending');
  if (dot) dot.hidden = !pending; // pending indicator in the dock
  const sec = byId('memberSection');
  if (sec) sec.classList.toggle('pulse', pending);
}

// Unclaimed hands from a loaded save whose owner hasn't returned. GM picks a
// present player to hand each one to (server re-checks the GM rank).
function renderUnclaimed() {
  const box = byId('unclaimedHands');
  if (!box) return;
  box.replaceChildren();
  const unclaimed = room.state.unclaimed;
  if (!unclaimed || unclaimed.size === 0) return;
  const present = [];
  room.state.players.forEach((p, sid) => present.push([sid, p.name]));
  present.sort((a, b) => (a[1] > b[1] ? 1 : a[1] < b[1] ? -1 : 0));
  const on = {
    assign: (userId, toSessionId) => room.send('reassignHand', { userId, toSessionId }),
  };
  box.appendChild(unclaimedHead());
  unclaimed.forEach((name, userId) => box.appendChild(unclaimedRow(userId, name, { present, on })));
}

// The GM-only Members panel: the full membership (incl. offline/pending, from the
// server's DB list) with admit/kick/promote controls. Buttons just send messages;
// the server authorizes and pushes a fresh list back.
function renderMembers(list) {
  const ul = byId('memberList');
  if (!ul) return;
  ul.replaceChildren();
  const me = room.state.players.get(mySession);
  const myName = me ? me.name : '';
  const myRank = rankOf(me ? me.role : 'player');
  if (!list.length) {
    ul.appendChild(emptyRow('No members.'));
    return;
  }
  const on = {
    admit: (m) => room.send('admit', { userId: m.userId }),
    reject: (m) => room.send('kick', { userId: m.userId }),
    setRole: (m, role) => room.send('setRole', { userId: m.userId, role }),
    kick: (m) => room.send('kick', { userId: m.userId }),
  };
  for (const m of list) ul.appendChild(memberRow(m, { isSelf: m.username === myName, myRank, on }));
  applyIcons(ul);
}

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
  for (const [id, sprite] of heldLabels) {
    // keep each name tag hovering over its piece
    const entry = meshes.get(id);
    if (entry)
      sprite.position.set(
        entry.mesh.position.x,
        entry.mesh.position.y + CONFIG.label.lift,
        entry.mesh.position.z,
      );
  }
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
          renderScores();
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
      // seatLayout carries geometry, not names — keep these in its order.
      const SEAT_NAMES = [
        'Front',
        'Back',
        'Right',
        'Left',
        'Front-right',
        'Back-left',
        'Front-left',
        'Back-right',
      ];
      const seatName = SEAT_NAMES[mySeat];
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
