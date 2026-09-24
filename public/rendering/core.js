import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TABLE, tableOutline, offsetOutline } from '/shared/pieces.js';
import { normalizeLighting } from '/shared/lighting.js';

// Core client scene — sets up Three.js: scene, camera, renderer, lights, and the
// table mesh. This module is visual ONLY; the server owns all physics and this
// side just draws what it's told. Also exports CONFIG, the client-side tunables.

// ===== CONFIG — client-side tunables (the visual mirror of the server's SIM) =
// Everything a designer might want to nudge lives here, grouped by concern.
const CONFIG = {
  grab: { height: 1, min: 0.3, max: 6, step: 0.35, deckHeight: 1.6, touchLift: 1.15 }, // held-piece float height + scroll range/step; deckHeight = how high dealt cards ride; touchLift multiplies the grab height for a finger, which covers the piece a cursor only points at
  model: { size: 1.6 }, // custom .glb props normalize their largest dimension to this
  render: { delay: 60 }, // ms: draw this far behind live state (interpolation buffer)
  ranges: { scale: [0.3, 3], qty: [1, 12], boardW: [2, 18], boardD: [2, 12] }, // spawn-modal input clamps [min, max]
  inspect: { fit: 2.4, dist: 5, drop: 0.2 }, // enlarged inspect view: target size, distance from camera, downward offset
  marker: { inner: 0.34, outer: 0.5, opacity: 0.35, lift: 0.02 }, // "drop preview" ring: radii, opacity, height above the surface
  label: { lift: 0.62, w: 1.15, h: 0.36 }, // floating name tag over a held piece: height above the piece + world size
  ping: { dur: 1200, inner: 0.35, outer: 0.5, lift: 0.05, grow: 2.4 }, // attention ping: lifetime (ms), ring radii, height above surface, expansion factor
  highlight: { dur: 3200, pulseMs: 800, padding: 0.35, minSize: 0.8, textureSize: 64 }, // shared attention halo, independent of local selection
  measure: { fill: 0.14, edge: 0.08 }, // overlay TEMPLATE look (circle/cone/line): interior fill opacity, outline band width (world units)
  input: {
    dblMs: 280,
    clickMs: 300,
    dragPx: 6,
    inspectPx: 4,
    handPx: 8,
    touchHitPx: 18,
    touchLeadPx: 48,
    panStep: 0.1,
  }, // click/drag feel, keyboard camera step, plus touch-only grab padding and held-piece lead
  tex: { die: 1024, board: 2048 }, // canvas texture resolutions (higher = sharper, more GPU memory)
  upload: { cardW: 1024, cardH: 1432, board: 1024, type: 'image/png', quality: 1.0 }, // keep enough source detail for the high-quality card derivative; lower tiers still download the smaller display copy
  anim: { shuffle: { dur: 420, yaw: 0.15, bob: 0.15, cycles: 6 } }, // cosmetic shuffle "riffle": duration (ms), yaw wiggle (rad), lift (units), oscillations
};

// Clamp a number into [min, max] (same helper as the server's; exported for reuse).
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// The three lighting intensities most worth tweaking to taste.
const LIGHTING = {
  hemi: 1, // soft sky/ground fill (ambient)
  sun: 1, // main directional light + shadows
  env: 0.45, // environment-map reflection strength (0 = flat, 1 = full studio)
};

// ===== Scene, camera, renderer ==============================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14181d);

const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 14, 16);

// Three's default loading manager is shared by the texture, cube-texture, and GLTF loaders used
// throughout the table client. Track its active requests so room entry can stay covered until the
// initial scene's visual assets have settled, including failures (loaders still call itemEnd).
const visualAssetManager = THREE.DefaultLoadingManager;
const managerItemStart = visualAssetManager.itemStart.bind(visualAssetManager);
const managerItemEnd = visualAssetManager.itemEnd.bind(visualAssetManager);
let visualAssetsPending = 0;
let visualAssetVersion = 0;
const visualAssetWaiters = new Set();
visualAssetManager.itemStart = (url) => {
  visualAssetsPending++;
  visualAssetVersion++;
  managerItemStart(url);
};
visualAssetManager.itemEnd = (url) => {
  managerItemEnd(url);
  visualAssetsPending = Math.max(0, visualAssetsPending - 1);
  if (!visualAssetsPending) {
    for (const resolve of visualAssetWaiters) resolve();
    visualAssetWaiters.clear();
  }
};
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

// Resolve only after all currently registered visual loads finish and no new load begins for a
// full frame. The quiet-frame check catches follow-up requests kicked off by a loader callback.
async function waitForVisualAssets() {
  for (;;) {
    while (visualAssetsPending) await new Promise((resolve) => visualAssetWaiters.add(resolve));
    const version = visualAssetVersion;
    await nextFrame();
    if (!visualAssetsPending && version === visualAssetVersion) return;
  }
}

// --- Graphics quality tiers (docs/ROADMAP.md §1/§12) -----------------------
// The tablet frame is fill-rate bound (pixel ratio × per-fragment shading, incl. soft-shadow
// sampling), not draw bound, so quality is three fill-rate presets. Active tier resolves as:
//   ?q=<tier>  >  localStorage 'tabletop.quality'  >  device default (coarse pointer → medium).
// Per-axis dev knobs (?px, ?shadow, ?shadowtype, ?aa) override individual settings on top, for
// A/B. setQuality() (exported, and window.setQuality) switches live; antialias is fixed at context
// creation, so a tier change only re-applies AA on the next load.
const SHADOW_SIZES = [512, 1024, 2048, 4096];
const SHADOW_TYPES = { pcf: THREE.PCFShadowMap, soft: THREE.PCFSoftShadowMap };
const QUALITY_KEY = 'tabletop.quality';
// All tiers use soft shadows (PCFSoftShadowMap): hard PCFShadowMap black-screened an Android
// phone's GPU, and soft-vs-hard is a minor cost lever next to pixel ratio, shadow size, and AA.
// Tiers differ by pixel ratio, shadow-map size, and antialiasing.
const QUALITY_TIERS = {
  low: { px: 1, shadowType: 'soft', shadowSize: 1024, aa: false },
  medium: { px: Math.min(devicePixelRatio, 1.5), shadowType: 'soft', shadowSize: 2048, aa: true },
  high: { px: Math.min(devicePixelRatio, 2), shadowType: 'soft', shadowSize: 4096, aa: true },
};
const _qp = (() => {
  try {
    return new URLSearchParams(location.search);
  } catch {
    return new URLSearchParams();
  }
})();
const _lsGet = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const _lsSet = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode / storage blocked — the choice just isn't remembered */
  }
};
function isCoarsePointer() {
  try {
    return matchMedia('(pointer: coarse)').matches;
  } catch {
    return false; // no matchMedia → treat as a fine pointer
  }
}
// Rough device class for picking defaults: a fine pointer is a desktop; a coarse pointer splits
// into phone vs tablet by the SHORTER viewport side (orientation-independent). Phones can't take
// the tablet defaults — e.g. an Android phone black-screens on the medium tier's 2048 shadow.
function deviceClass() {
  if (!isCoarsePointer()) return 'desktop';
  const small = Math.min(window.innerWidth || 0, window.innerHeight || 0);
  return small && small <= 600 ? 'phone' : 'tablet';
}
// URL override, else stored preference, else device class (phone→low, tablet→medium, desktop→high).
function resolveQuality() {
  const q = _qp.get('q') || _lsGet(QUALITY_KEY);
  if (q && QUALITY_TIERS[q]) return q;
  const cls = deviceClass();
  return cls === 'phone' ? 'low' : cls === 'tablet' ? 'medium' : 'high';
}
// The tier's settings, with any per-axis dev knob overriding it.
function qualitySettings(tier) {
  const t = QUALITY_TIERS[tier] || QUALITY_TIERS.high;
  const pxParam = parseFloat(_qp.get('px'));
  const shadowParam = _qp.get('shadow'); // 'off' | a SHADOW_SIZES value
  const typeParam = _qp.get('shadowtype'); // 'pcf' | 'soft'
  return {
    px: Number.isFinite(pxParam) ? pxParam : t.px,
    shadowsOn: shadowParam !== 'off',
    shadowSize: SHADOW_SIZES.includes(+shadowParam) ? +shadowParam : t.shadowSize,
    shadowType: typeParam === 'pcf' || typeParam === 'soft' ? typeParam : t.shadowType,
    aa: _qp.get('aa') === '0' ? false : t.aa,
  };
}
let activeQuality = resolveQuality();
const _q0 = qualitySettings(activeQuality);

const renderer = new THREE.WebGLRenderer({ antialias: _q0.aa });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(_q0.px);
renderer.shadowMap.enabled = _q0.shadowsOn;
renderer.shadowMap.type = SHADOW_TYPES[_q0.shadowType];
// Only redraw the shadow map when scene geometry actually moved — the render loop (client.js
// animate) sets needsUpdate on frames where a mesh changed. At rest, orbiting the camera no
// longer repays the shadow pass every frame.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true; // draw it once at startup
document.getElementById('app').appendChild(renderer.domElement);
// Do not expose the arbitrary bootstrap camera while room state and the player's seat are loading.
// The two readiness gates below reveal the canvas only after both are applied.
renderer.domElement.style.visibility = 'hidden';
let tableViewReady = false;
let seatCameraReady = false;
// WebGL can drop the GPU context — Android under memory pressure, a driver reset, a backgrounded
// tab. Without preventDefault the browser never restores it and the canvas stays black forever
// (renders fine for a moment, then goes black). With it, three re-uploads its resources on the next
// render, so we refresh the (autoUpdate-off) shadow map and let the rAF loop pick back up.
renderer.domElement.addEventListener(
  'webglcontextlost',
  (e) => {
    e.preventDefault();
    console.warn('[gl] WebGL context lost — awaiting restore');
  },
  false,
);
renderer.domElement.addEventListener(
  'webglcontextrestored',
  () => {
    console.warn('[gl] WebGL context restored');
    renderer.shadowMap.needsUpdate = true;
  },
  false,
);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49; // don't let the camera drop below the tabletop

// ===== Environment & lights =================================================
// Dim every light and material inside a prebuilt environment by `factor`, so we
// can borrow RoomEnvironment's studio look at a subtler intensity.
const dimEnvironment = (env, factor) => {
  env.traverse((node) => {
    if (node.isLight) node.intensity *= factor;
    if (node.material && node.material.color) node.material.color.multiplyScalar(factor);
  });
  return env;
};

// A neutral studio environment so PBR/metallic materials (including custom .glb)
// reflect something instead of rendering dark. Subtle — mostly helps metals read.
const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(
  dimEnvironment(new RoomEnvironment(), LIGHTING.env),
  0.04,
).texture;

const ambientLight = new THREE.HemisphereLight(0xffffff, 0x222222, LIGHTING.hemi);
scene.add(ambientLight);

const sun = new THREE.DirectionalLight(0xffffff, LIGHTING.sun);
sun.position.set(10, 18, 8);
sun.castShadow = _q0.shadowsOn;
sun.shadow.mapSize.set(_q0.shadowSize, _q0.shadowSize);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 55; // tight depth range = far more precision, so bias can stay tiny
sun.shadow.normalBias = 0.001; // tiny (tight depth range gives the precision) — no peter-panning, still no .glb acne
sun.shadow.bias = -0.0002; // small depth bias to back it up

// Size the sun's shadow frustum to a table half-extent (+ margin for shadows cast past the edge).
const SHADOW_MARGIN = 4;
function fitShadow(hx, hz) {
  Object.assign(sun.shadow.camera, {
    left: -(hx + SHADOW_MARGIN),
    right: hx + SHADOW_MARGIN,
    top: hz + SHADOW_MARGIN,
    bottom: -(hz + SHADOW_MARGIN),
  });
  sun.shadow.camera.updateProjectionMatrix();
}
fitShadow(TABLE.x, TABLE.z); // initial frustum from the default table size
scene.add(sun);

let liveLighting = normalizeLighting();
let lightingAnimation = 0;
const shortestAngle = (from, to) => {
  const delta = ((to - from + 540) % 360) - 180;
  return from + delta;
};
const lightingFrame = (value) => {
  const azimuth = THREE.MathUtils.degToRad(value.azimuth);
  const elevation = THREE.MathUtils.degToRad(value.elevation);
  const horizontal = Math.cos(elevation) * 25;
  sun.position.set(
    Math.sin(azimuth) * horizontal,
    Math.sin(elevation) * 25,
    -Math.cos(azimuth) * horizontal,
  );
  sun.intensity = value.keyIntensity;
  sun.color.set(value.keyColor);
  ambientLight.intensity = value.ambientIntensity;
  ambientLight.color.set(value.ambientColor);
  ambientLight.groundColor.set(value.ambientColor).multiplyScalar(0.16);
  sun.shadow.radius = 1 + value.shadowSoftness * 7;
  renderer.shadowMap.needsUpdate = true;
};

function applyLighting(value, { duration = 500 } = {}) {
  const target = normalizeLighting(value);
  cancelAnimationFrame(lightingAnimation);
  if (!duration) {
    liveLighting = target;
    lightingFrame(target);
    return;
  }
  const from = { ...liveLighting };
  const toAzimuth = shortestAngle(from.azimuth, target.azimuth);
  const fromKey = new THREE.Color(from.keyColor);
  const toKey = new THREE.Color(target.keyColor);
  const fromAmbient = new THREE.Color(from.ambientColor);
  const toAmbient = new THREE.Color(target.ambientColor);
  const started = performance.now();
  const tick = (now) => {
    const raw = Math.min(1, (now - started) / duration);
    const t = raw * raw * (3 - 2 * raw);
    const frame = {
      preset: target.preset,
      azimuth: (from.azimuth + (toAzimuth - from.azimuth) * t + 360) % 360,
      elevation: THREE.MathUtils.lerp(from.elevation, target.elevation, t),
      keyIntensity: THREE.MathUtils.lerp(from.keyIntensity, target.keyIntensity, t),
      keyColor: '#' + fromKey.clone().lerp(toKey, t).getHexString(),
      ambientIntensity: THREE.MathUtils.lerp(from.ambientIntensity, target.ambientIntensity, t),
      ambientColor: '#' + fromAmbient.clone().lerp(toAmbient, t).getHexString(),
      shadowSoftness: THREE.MathUtils.lerp(from.shadowSoftness, target.shadowSoftness, t),
    };
    lightingFrame(frame);
    if (raw < 1) lightingAnimation = requestAnimationFrame(tick);
    else liveLighting = target;
  };
  lightingAnimation = requestAnimationFrame(tick);
}

const getLighting = () => ({ ...liveLighting });
lightingFrame(liveLighting);

// Apply a shadow config (on/off, size, soft/hard) to the live renderer. Recompiles materials so a
// soft↔hard or on↔off change takes effect, and re-allocates the map for a new size.
function applyShadow({ shadowsOn, shadowSize, shadowType }) {
  renderer.shadowMap.enabled = shadowsOn;
  sun.castShadow = shadowsOn;
  renderer.shadowMap.type = SHADOW_TYPES[shadowType] || THREE.PCFSoftShadowMap;
  if (sun.shadow.map) {
    sun.shadow.map.dispose();
    sun.shadow.map = null;
  }
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  scene.traverse((o) => {
    if (o.material) o.material.needsUpdate = true;
  });
  renderer.shadowMap.needsUpdate = true;
}

// Switch quality tier live (settings UI + console): applies pixel ratio + shadows now and persists
// the choice; antialias re-applies on the next load. No-op for an unknown tier.
function setQuality(tier) {
  if (!QUALITY_TIERS[tier]) return;
  activeQuality = tier;
  _lsSet(QUALITY_KEY, tier);
  const q = qualitySettings(tier);
  renderer.setPixelRatio(q.px);
  renderer.setSize(innerWidth, innerHeight);
  applyShadow(q);
}
const getQuality = () => activeQuality;

if (typeof window !== 'undefined') {
  window.setQuality = setQuality; // console + a11y hook
  window.ottPixelRatio = (v) => {
    renderer.setPixelRatio(+v || 1);
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.needsUpdate = true;
  };
  window.ottShadow = (v) => {
    const off = v === 'off' || v === 0 || v === '0';
    applyShadow({
      shadowsOn: !off,
      shadowSize: SHADOW_SIZES.includes(+v) ? +v : _q0.shadowSize,
      shadowType: _q0.shadowType,
    });
  };
}

// ===== Table ================================================================
// Felt: a desaturated fabric texture tinted by the GM's felt colour, so the colour picker still
// works — it now tints the fabric instead of a flat fill. World-unit UVs (the felt is always an
// extruded outline), so the tiling density stays consistent across shapes and sizes.
const feltTex = new THREE.TextureLoader().load('/textures/felt.jpg');
feltTex.colorSpace = THREE.SRGBColorSpace;
feltTex.wrapS = feltTex.wrapT = THREE.MirroredRepeatWrapping; // reflect at tile edges — no visible seam
feltTex.repeat.set(0.35, 0.35);
feltTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

// The felt geometry for a shape: the shared tableOutline extruded to the slab thickness (1) — the
// SAME outline the server walls use, so the visible edge and the physics rim line up. Centred on Y
// so the existing position.y = -0.5 keeps the top surface at y = 0. (Material is DoubleSide, so the
// extruded cap shows regardless of the outline's winding.)
function tableGeometry(hx, hz, shape) {
  const outline = tableOutline(shape || 'rect', hx, hz);
  const s = new THREE.Shape();
  outline.forEach((p, i) => (i ? s.lineTo(p.x, p.z) : s.moveTo(p.x, p.z)));
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2); // shape's plane into world XZ, thickness along +Y (0..1)
  geo.translate(0, -0.5, 0); // centre on Y like the old box slab
  geo.computeVertexNormals();
  return geo;
}

const tableMesh = new THREE.Mesh(
  tableGeometry(TABLE.x, TABLE.z, 'rect'),
  new THREE.MeshStandardMaterial({
    color: 0x2f6b4f,
    roughness: 0.95,
    side: THREE.DoubleSide,
    map: feltTex,
  }),
);
tableMesh.position.y = -0.5; // top surface sits at y = 0
tableMesh.receiveShadow = true;
tableMesh.visible = false; // reveal only after the joined room's durable appearance is applied
scene.add(tableMesh);

// A wooden rim around the felt edge: the shared tableOutline offset outward for the outer edge,
// with a slight inward overlap onto the felt, extruded into a low raised lip. Purely visual — the
// physics walls already sit at the felt edge — and rebuilt with the felt on any resize / reshape.
// The wood is a GM-chosen texture, swapped on the shared material by setRimWood.
const RIM = { width: 0.4, lip: 0.35, base: -1, overlap: 0.06 };
const WOOD_RIM = {
  mahogany: '/textures/wood-mahogany.png',
  walnut: '/textures/wood-walnut.png',
  birch: '/textures/wood-birch.png',
  green: '/textures/wood-green.png',
  oak: '/textures/wood-oak.png',
};
const _woodCache = new Map();
function woodTexture(name) {
  const url = WOOD_RIM[name] || WOOD_RIM.mahogany;
  let t = _woodCache.get(url);
  if (t) return t;
  t = new THREE.TextureLoader().load(url);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(0.5, 0.5);
  t.center.set(0.5, 0.5);
  t.rotation = Math.PI / 2; // run the grain across the rim, not along the image's vertical
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  _woodCache.set(url, t);
  return t;
}
const rimMat = new THREE.MeshStandardMaterial({
  map: woodTexture('mahogany'),
  roughness: 0.6,
  metalness: 0,
});

// Swap the rim to a named wood (GM-set, durable). Unknown names fall back to mahogany.
function setRimWood(name) {
  rimMat.map = woodTexture(name);
  rimMat.needsUpdate = true;
}

function rimGeometry(hx, hz, shape) {
  const felt = tableOutline(shape, hx, hz);
  const outer = offsetOutline(felt, RIM.width);
  const inner = offsetOutline(felt, -RIM.overlap); // slightly onto the felt so there's no seam
  const shp = new THREE.Shape();
  outer.forEach((p, i) => (i ? shp.lineTo(p.x, p.z) : shp.moveTo(p.x, p.z)));
  shp.closePath();
  const hole = new THREE.Path();
  inner.forEach((p, i) => (i ? hole.lineTo(p.x, p.z) : hole.moveTo(p.x, p.z)));
  hole.closePath();
  shp.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shp, { depth: RIM.lip - RIM.base, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2); // into the world XZ plane, height along +Y
  geo.translate(0, RIM.base, 0); // base flush with the felt bottom; the lip rises above the felt
  geo.computeVertexNormals();
  return geo;
}

const rimMesh = new THREE.Mesh(rimGeometry(TABLE.x, TABLE.z, 'rect'), rimMat);
rimMesh.castShadow = true;
rimMesh.receiveShadow = true;
rimMesh.visible = false;
scene.add(rimMesh);

function revealReadyView() {
  if (!tableViewReady || !seatCameraReady) return;
  renderer.render(scene, camera); // replace the hidden bootstrap frame before exposing the canvas
  renderer.domElement.style.visibility = 'visible';
}

// Avoid flashing the local rectangular/mahogany bootstrap meshes while the room join is pending.
function setTableVisible(visible) {
  tableMesh.visible = !!visible;
  rimMesh.visible = !!visible;
  tableViewReady = !!visible;
  if (!visible) renderer.domElement.style.visibility = 'hidden';
  revealReadyView();
}

// The synchronized player record supplies the real seat and therefore the first camera worth
// showing. This is separate from table readiness so callback order cannot reintroduce the flash.
function setSeatCameraReady() {
  seatCameraReady = true;
  revealReadyView();
}

// Rebuild the felt + rim at new half-extents / shape (the GM resized or reshaped the play surface).
function resizeTable(hx, hz, shape = 'rect') {
  tableMesh.geometry.dispose();
  tableMesh.geometry = tableGeometry(hx, hz, shape);
  rimMesh.geometry.dispose();
  rimMesh.geometry = rimGeometry(hx, hz, shape);
  fitShadow(hx, hz); // keep the shadow frustum matched to the (bounding) surface
}

// Recolor the felt (the GM picked a new table color).
function setTableColor(color) {
  if (color) tableMesh.material.color.set(color);
}

export {
  CONFIG,
  clamp,
  scene,
  camera,
  renderer,
  controls,
  resizeTable,
  setTableColor,
  setRimWood,
  applyLighting,
  getLighting,
  setTableVisible,
  setSeatCameraReady,
  waitForVisualAssets,
  setQuality,
  getQuality,
  deviceClass,
  rimMat,
  tableMesh,
};
