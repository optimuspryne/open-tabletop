import { createNotecardEditor } from './table/notecards.js';
import { createDeckBrowser } from './table/deck-browsing.js';
import { createParticipation } from './table/participation.js';
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
} from './rendering/core.js';
import { initPerf } from './rendering/perf.js';
import {
  KIND,
  OVERLAY,
  trayMesh,
  cTex,
  cardMesh,
  createCardBrowsePreview,
  resizeToCanvas,
  parseCardFront,
  cardPreviewURL,
  notecardPreviewURL,
  makePlayerTexture,
  nameTag,
  makeYouChipTexture,
  gridMesh,
} from './rendering/graphics.js';
import { applyIcons, setIcon } from './ui/icons.js';
import { rankOf } from './ui/rows.js';
import { colliderSpec } from '/shared/collider-spec.js';
import { createColliderDebug } from './table/collider-debug.js';
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
import { createPieceView, meshPropsOf } from './table/piece-view.js';
import { KINDS as PHYS, deckHeight, formatMeasure, trayCenter, seatAngle } from '/shared/pieces.js';
import { MEASURE } from '/shared/overlays.js';
import { playSfx, resumeAudio } from './table/audio.js';
import { attachControls } from './table/controls.js';
import { createInputRouter } from './table/input-router.js';
import { createPieceDrag } from './table/piece-drag.js';
import { createTableShell } from './table/table-shell.js';
import { bindPreferences } from './table/preferences.js';
import { createDicePreferences } from './table/dice-preferences.js';
import { createPieceUi } from './table/piece-ui.js';
import { createTableEffects } from './table/effects.js';
import { createPieceLabels } from './table/piece-labels.js';
window.addEventListener('pointerdown', resumeAudio, { once: true }); // browsers block audio until a user gesture

// ===== Tiny DOM helpers =====================================================
const byId = (id) => document.getElementById(id);
const qs = (selector) => document.querySelector(selector);
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
// Relabel a button without clobbering an injected icon: update its .lbl + aria-label, or textContent if it has no icon.
const setBtnLabel = (btn, text) => {
  if (!btn) return;
  const l = btn.querySelector('.lbl');
  if (l) {
    l.textContent = text;
    btn.setAttribute('aria-label', text);
  } else btn.textContent = text;
};

const shell = createTableShell({ byId, clamp, getRoom: () => room });
const { toast } = shell;
shell.prepare();

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
const dicePreferences = createDicePreferences({
  byId,
  deviceClass,
  getRoom: () => room,
  getDieIds: () => trays.dieIds(),
  onTextures: (list) => inspection?.setDiceTextures(list),
});
const { myDieProps, saveDiceDefault, clearDiceDefault } = dicePreferences;

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
const participation = createParticipation({
  setIcon,
  setBtnLabel,
  canChoose: () => !window.OTT_EDITOR,
  toast,
  getRoom: () => room,
  onBlocked: () => {
    pieceDrag.cancel();
    hand.cancelGesture({ resetModes: true });
    selection.cancel();
    overlays.cancel();
    whiteboard.cancel();
    inspection.cancel();
    deckBrowser.cancel();
    notecards.cancel();
    pieceUi.closePieceMenu();
    pieceLabels.close();
    shell.closeRadial();
    for (const id of ['roomSettingsModal', 'showStrip']) {
      const element = byId(id);
      if (element) element.hidden = true;
    }
    controls.enabled = true;
  },
});
const membership = createMembership({
  toast,
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
    const watch = params.get('spectate') === '1';
    if (saved && !watch) {
      try {
        room = await client.reconnect(saved);
      } catch (e) {
        room = null;
      }
    }
    if (!room)
      room = await client.joinOrCreate('table', {
        code,
        token: authToken,
        ...(watch ? { participation: 'spectator' } : {}),
      });
    if (watch) {
      params.delete('spectate');
      history.replaceState(null, '', location.pathname + '?' + params.toString());
    }
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

  participation.bindRoom(room, cb);

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
      effects.disposeSurface(id);
      pieceLabels.remove(id);
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
    onDiceTextures: dicePreferences.setTextures,
    byId,
    setIcon,
    setBtnLabel,
  });
  presence.bindMessages(room);
  effects.bindPings(room);
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
  room.onMessage('whoami', ({ isAdmin, userId }) => {
    window.OTT_USER_ID = userId;
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
  effects.bindTableEffects(room);
  notecards.bindRoom(room);
  inspection.bindRoom(room);
  deckBrowser.bindRoom(room);
  pieceDrag.bindRoom(room);

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

  shell.bindRoomControls();
  roomSettings.bindControls();
  whiteboard.bindControls(); // Room Settings config and the drawing toolbar
  overlays.bindControls(); // Measure pane kind picker and clear actions

  selection.bindModeControls();
  trays.bindControls(); // visit/leave the tray, spawn dice, roll, scoop, and clear
  dicePreferences.bindControls();
  presence.bindControls();
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
  bindPreferences({ byId, setIcon });
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

// ===== Scene/input adapters shared by the composed controllers ===============
const ray = new THREE.Raycaster(),
  pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
  hit = new THREE.Vector3(); // fixed ground plane (y=0); drag height is applied as a separate Y offset
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

shell.bindInteractionControls({
  handDropPosition: () => presence.handDropPosition(),
  toggleLean: () => (leanActive = !leanActive),
});

const hand = createHand({
  notecardMesh: KIND.notecard.mesh,
  disposeNotecard: KIND.notecard.dispose,
  notecardPreviewURL,
  openHandNotecard: (card) => notecards.openHand(card),
  onCardsChanged: (cards) => notecards.syncHand(cards),
  canInteract: participation.canInteract,
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
  syncControlGuide: () => pieceUi.syncControlGuide(),
  byId,
  dragThreshold: CONFIG.input.handPx,
  toast,
});
const notecards = createNotecardEditor({
  getRoom: () => room,
  byId,
  canInteract: participation.canInteract,
  toast,
  beforeOpen: () => {
    pieceDrag.cancel();
    inspection.cancel();
    deckBrowser.cancel();
    whiteboard.cancel();
    selection.cancel();
    overlays.cancel();
    pieceUi.closePieceMenu();
  },
});
inspection = createInspection({
  openNotecard: (id) => notecards.open(id),
  makeBrowsePreview: createCardBrowsePreview,
  canInteract: participation.canInteract,
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
  queryAll: (selector) => document.querySelectorAll(selector),
  setBtnLabel,
  buildTextureChips: dicePreferences.buildTextureChips,
  saveDiceDefault,
  clearDiceDefault,
  onReleaseHand: () => hand.render(),
  onSingleClick: (...args) => pieceDrag.sendAction(...args),
});
const deckBrowser = createDeckBrowser({
  getRoom: () => room,
  inspection,
  byId,
  canInteract: participation.canInteract,
  toast,
});
dicePreferences.syncTextures();
const presence = createPresence({
  THREE,
  scene,
  camera,
  controls,
  cardMesh: KIND.card.mesh,
  notecardMesh: KIND.notecard.mesh,
  disposeNotecard: KIND.notecard.dispose,
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
let boardTopY = 0; // legacy board-wide plane for measurements and pings (0 = bare table)

const selection = createSelection({
  THREE,
  scene,
  camera,
  canvas: renderer.domElement,
  meshes,
  marker: CONFIG.marker,
  dragThreshold: CONFIG.input.dragPx,
  getRoom: () => room,
  getBoardTopY: () => boardTopY,
  byId,
});

const perf = initPerf(); // dev render-cost overlay, off unless ?perf=1 / window.ottPerf(true)
const pieceDrag = createPieceDrag({
  THREE,
  config: CONFIG,
  kinds: KIND,
  meshes,
  controls,
  canvas: renderer.domElement,
  ray,
  pointer,
  camera,
  dragPlane,
  hit,
  selection,
  getRoom: () => room,
  getInspection: () => inspection,
  setPointer,
  openPieceMenu: (...args) => pieceUi.openPieceMenu(...args),
  playSfx,
  clamp,
});

const pieceLabels = createPieceLabels({
  THREE,
  scene,
  meshes,
  getRoom: () => room,
  getRank: () => myRank,
});
const pieceUi = createPieceUi({
  browseDeck: (id) => deckBrowser.open(id),
  canInteract: participation.canInteract,
  byId,
  canvas: renderer.domElement,
  meshes,
  kinds: KIND,
  getRoom: () => room,
  pieceDrag,
  hand,
  inspection,
  selection,
  overlays,
  whiteboard,
  setPointer,
  pickId,
  isSheet: shell.isSheet,
  openRadial: shell.openRadial,
  highlightPiece: (id) => effects.highlightPiece(id),
  getRank: () => myRank,
  editLabels: pieceLabels.edit,
});
const effects = createTableEffects({
  THREE,
  config: CONFIG,
  scene,
  camera,
  ray,
  pointer,
  meshes,
  getRoom: () => room,
  getSessionId: () => mySession,
  getBoardTopY: () => boardTopY,
  nameTag,
  disposeSprite,
  playSfx,
});

(function animate() {
  // shadow-on-demand: last frame's caster-transform key, in an object so the cross-frame write
  // (updated at the end of each rAF tick) isn't flagged dead by no-useless-assignment. See core.js.
  const shadowSeen = { key: NaN };
  const renderTime = performance.now() - DELAY;
  let shadowKey = 0;
  for (const [id, { mesh }] of meshes) {
    const buf = buffers.get(id);
    if (buf) sample(buf, renderTime, mesh);
    effects.applyAnim(id, mesh);
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
  pieceUi.update(); // contextual guide and live hover counts
  pieceLabels.update(); // persistent object annotations follow interpolated bounds
  effects.updatePings();
  effects.updateDropMarker(pieceDrag.current());
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
  pieceUi.updateHoldControls();
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

// ===== Input seam ===========================================================
// Raw canvas events → intents (see public/table/controls.js). These handlers own what each
// intent means through the composed router; controls.js owns which device gesture raises it.
const INPUT = createInputRouter({
  isModalActive: () => notecards.isActive(),
  canInteract: participation.canInteract,
  getRoom: () => room,
  canvas: renderer.domElement,
  controls,
  selection,
  overlays,
  whiteboard,
  inspection,
  trays,
  pieces: pieceDrag,
  setPointer,
  pickId,
  touchHitPx: CONFIG.input.touchHitPx,
  getPieceMeshes: () => [...meshes.values()].map((m) => m.mesh),
  panCamera,
  openPieceMenu: (...args) => pieceUi.openPieceMenu(...args),
  sendPing: effects.sendPing,
  highlightPiece: effects.highlightPiece,
  editLabels: pieceLabels.edit,
  byId,
});
attachControls(renderer.domElement, INPUT);

shell.bindControls({ input: INPUT, selection, overlays, scoreboard, presence });
