// public/audio.js — Web Audio sound-effect manager for built-in objects.
// Short clips load once into buffers and play fire-and-forget (overlaps are fine).
// Files live in /sounds/ (self-hosted; the enforced CSP allows same-origin media).
// A file that isn't there yet is skipped silently, so the app runs before you add assets.
import { MUSIC } from './credits.js';

// logical name -> a LIST of files under /sounds/; one is picked at random each play.
// Add variants for variety, e.g. 'die-roll': ['die-roll-1.ogg', 'die-roll-2.ogg', 'die-roll-3.ogg'].
// A bare string still works — it's treated as a one-item list.
const SOUNDS = {
  'die-roll':      ['die-roll-1.ogg', 'die-roll-2.ogg', 'die-roll-3.ogg', 'die-roll-4.ogg'],
  'dice-roll':     ['dice-roll-1.ogg', 'dice-roll-2.ogg', 'dice-roll-3.ogg', 'dice-roll-4.ogg', 'dice-roll-5.ogg', 'dice-roll-6.ogg', 'dice-roll-7.ogg', 'dice-roll-8.ogg', 'dice-roll-9.ogg'],
  'card-flip':     ['card-flip-1.ogg', 'card-flip-2.ogg', 'card-flip-3.ogg', 'card-flip-4.ogg', 'card-flip-5.ogg'],
  'card-pickup':   ['card-pickup-1.ogg', 'card-pickup-2.ogg', 'card-pickup-3.ogg', 'card-pickup-4.ogg', 'card-pickup-5.ogg', 'card-pickup-6.ogg', 'card-pickup-7.ogg'],
  'card-drop':     ['card-drop-1.ogg', 'card-drop-2.ogg', 'card-drop-3.ogg', 'card-drop-4.ogg'],
  'shuffle':       ['shuffle-1.ogg', 'shuffle-2.ogg', 'shuffle-3.ogg'],
  'die-pickup':    ['die-pickup-1.ogg', 'die-pickup-2.ogg'],
  'die-drop':      ['die-drop-1.ogg', 'die-drop-2.ogg', 'die-drop-3.ogg', 'die-drop-4.ogg'],
  'deck-pickup':   ['deck-pickup-1.ogg', 'deck-pickup-2.ogg'],
  'deck-drop':     ['deck-drop-1.ogg', 'deck-drop-2.ogg'],
  'object-pickup': ['object-pickup-1.ogg', 'object-pickup-2.ogg', 'object-pickup-3.ogg', 'object-pickup-4.ogg', 'object-pickup-5.ogg', 'object-pickup-6.ogg'],
  'object-drop':   ['object-drop-1.ogg', 'object-drop-2.ogg', 'object-drop-3.ogg', 'object-drop-4.ogg', 'object-drop-5.ogg', 'object-drop-6.ogg'],
  'hand-drop':     ['hand-drop-1.ogg', 'hand-drop-2.ogg'],
};

const VOL_KEY = 'tabletop.sfxVolume';
const SFX_MUTE_KEY = 'tabletop.sfxMuted';
const MUSIC_MUTE_KEY = 'tabletop.musicMuted';
let ctx = null, master = null;
const buffers = new Map();
let musicEl = null, trackIdx = -1, onTrackChange = null; // background music player state

function loadVolume() {
  const v = parseFloat(localStorage.getItem(VOL_KEY));
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.7;
}
function loadSfxMuted() { return localStorage.getItem(SFX_MUTE_KEY) === '1'; }
function loadMusicMuted() { return localStorage.getItem(MUSIC_MUTE_KEY) === '1'; }
function applyGain() { if (master) master.gain.value = loadSfxMuted() ? 0 : loadVolume(); }

function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = loadSfxMuted() ? 0 : loadVolume();
  master.connect(ctx.destination);
  for (const [name, spec] of Object.entries(SOUNDS)) {   // tolerant load: 404 / decode error -> that variant skipped
    const files = Array.isArray(spec) ? spec : [spec];
    buffers.set(name, []);                                // a pool of decoded variants (fills in as each loads)
    for (const file of files) {
      fetch('/sounds/' + file)
        .then(r => (r.ok ? r.arrayBuffer() : Promise.reject()))
        .then(b => ctx.decodeAudioData(b))
        .then(buf => buffers.get(name).push(buf))         // each decoded variant joins the pool
        .catch(() => {});
    }
  }
  return ctx;
}

// Browsers block audio until a user gesture — call from the first click/keypress.
export function resumeAudio() {
  const c = ensureCtx();
  if (c && c.state === 'suspended') c.resume();
}

// Play a named clip. `volume` is a 0..1 per-shot scale on top of the master volume.
export function playSfx(name, { volume = 1 } = {}) {
  const c = ensureCtx();
  if (!c || c.state !== 'running') return;
  const list = buffers.get(name);
  if (!list || !list.length) return;       // no variant decoded yet — no-op
  const buf = list.length === 1 ? list[0] : list[(Math.random() * list.length) | 0]; // random variant each play
  const src = c.createBufferSource();
  src.buffer = buf;
  if (volume !== 1) { const g = c.createGain(); g.gain.value = volume; src.connect(g); g.connect(master); }
  else src.connect(master);
  src.start();
}

// Master SFX volume 0..1, persisted for next visit (Phase 2's slider will call this).
export function setSfxVolume(v) {
  v = Math.max(0, Math.min(1, v));
  localStorage.setItem(VOL_KEY, String(v));
  applyGain();
}
export function getSfxVolume() { return loadVolume(); }
export function setSfxMuted(m) { localStorage.setItem(SFX_MUTE_KEY, m ? '1' : '0'); applyGain(); }
export function getSfxMuted() { return loadSfxMuted(); }
export function setMusicMuted(m) { localStorage.setItem(MUSIC_MUTE_KEY, m ? '1' : '0'); if (musicEl) musicEl.volume = m ? 0 : loadMusicVolume(); }
export function getMusicMuted() { return loadMusicMuted(); }


// ---- Background music (HTML5 <audio>: streams long tracks; playlist from credits.js) ----
const MUSIC_VOL_KEY = 'tabletop.musicVolume';
function loadMusicVolume() {
  const v = parseFloat(localStorage.getItem(MUSIC_VOL_KEY));
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.4;
}
function ensureMusicEl() {
  if (musicEl) return musicEl;
  musicEl = new Audio();
  musicEl.volume = loadMusicMuted() ? 0 : loadMusicVolume();
  musicEl.addEventListener('ended', nextTrack); // auto-advance the playlist
  return musicEl;
}
function loadTrack(i) {
  ensureMusicEl();
  musicEl.src = '/music/' + MUSIC[i].file;
  if (onTrackChange) onTrackChange(MUSIC[i], i);
}
export function toggleMusic() {
  if (!MUSIC.length) return;
  const el = ensureMusicEl();
  if (!el.paused) { el.pause(); return; }
  if (trackIdx < 0) { trackIdx = 0; loadTrack(0); }
  el.play().catch(() => {}); // gesture-gated; ignore autoplay rejections
}
export function nextTrack() {
  if (!MUSIC.length) return;
  if (getShuffle() && MUSIC.length > 1) {
    let j; do { j = Math.floor(Math.random() * MUSIC.length); } while (j === trackIdx); // avoid repeating current
    trackIdx = j;
  } else {
    trackIdx = (trackIdx + 1) % MUSIC.length;
  }
  loadTrack(trackIdx);
  ensureMusicEl().play().catch(() => {});
}
export function playTrack(i) { if (i < 0 || i >= MUSIC.length) return; trackIdx = i; loadTrack(i); ensureMusicEl().play().catch(() => {}); }
export function currentTrackIndex() { return trackIdx; }
const SHUFFLE_KEY = 'tabletop.musicShuffle';
export function getShuffle() { return localStorage.getItem(SHUFFLE_KEY) === '1'; }
export function setShuffle(on) { localStorage.setItem(SHUFFLE_KEY, on ? '1' : '0'); }
export function setMusicVolume(v) {
  v = Math.max(0, Math.min(1, v));
  localStorage.setItem(MUSIC_VOL_KEY, String(v));
  if (musicEl) musicEl.volume = loadMusicMuted() ? 0 : v;
}
export function getMusicVolume() { return loadMusicVolume(); }
export function isMusicPlaying() { return !!musicEl && !musicEl.paused; }
export function onMusicTrack(cb) { onTrackChange = cb; } // UI callback: (track, index)
