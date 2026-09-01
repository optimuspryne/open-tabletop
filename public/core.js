import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TABLE } from '/shared/pieces.js';

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
  measure: { fill: 0.14, edge: 0.08 }, // overlay TEMPLATE look (circle/cone/line): interior fill opacity, outline band width (world units)
  input: { dblMs: 280, clickMs: 300, dragPx: 6, inspectPx: 4, handPx: 8 }, // click/drag feel: double-click window, click-defer (ms), drag thresholds (px)
  tex: { die: 512, board: 1024 }, // canvas texture resolutions (higher = sharper, more GPU memory)
  upload: { cardW: 512, cardH: 716, board: 1024, type: 'image/png', quality: 1.0 }, // uploaded image size + encoding (PNG = lossless; quality only affects lossy types)
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

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 14, 16);

// --- Dev perf knobs (docs/ROADMAP.md §1/§12) -------------------------------
// The iPad frame is fill-rate bound, not draw bound, so these expose the three fixed per-frame
// costs for on-device A/B, e.g. ?px=1&shadow=1024&aa=0. px and shadow also have live toggles
// (window.ottPixelRatio / window.ottShadow, below); antialias is fixed at context creation, so
// ?aa=0 needs a reload. No params → the previous defaults, unchanged.
const _qp = (() => {
  try {
    return new URLSearchParams(location.search);
  } catch {
    return new URLSearchParams();
  }
})();
const SHADOW_SIZES = [512, 1024, 2048, 4096];
const _pxParam = parseFloat(_qp.get('px'));
const _aa = _qp.get('aa') !== '0';
const _shadowParam = _qp.get('shadow'); // 'off' | one of SHADOW_SIZES | null
const _shadowsOn = _shadowParam !== 'off';
const _shadowSize = SHADOW_SIZES.includes(+_shadowParam) ? +_shadowParam : 4096;

const renderer = new THREE.WebGLRenderer({ antialias: _aa });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Number.isFinite(_pxParam) ? _pxParam : Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = _shadowsOn;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Only redraw the (expensive 4096² soft) shadow map when scene geometry actually moved — the
// render loop (client.js animate) sets needsUpdate on frames where a mesh changed. At rest,
// orbiting the camera no longer repays the full shadow pass every frame.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true; // draw it once at startup
document.getElementById('app').appendChild(renderer.domElement);

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

scene.add(new THREE.HemisphereLight(0xffffff, 0x222222, LIGHTING.hemi));

const sun = new THREE.DirectionalLight(0xffffff, LIGHTING.sun);
sun.position.set(10, 18, 8);
sun.castShadow = _shadowsOn;
sun.shadow.mapSize.set(_shadowSize, _shadowSize);
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

// Live perf knobs for on-device A/B (see the URL-param note above). Both force one shadow redraw.
if (typeof window !== 'undefined') {
  window.ottPixelRatio = (v) => {
    renderer.setPixelRatio(+v || 1);
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.needsUpdate = true;
  };
  window.ottShadow = (v) => {
    const off = v === 'off' || v === 0 || v === '0';
    renderer.shadowMap.enabled = !off;
    sun.castShadow = !off;
    if (!off && SHADOW_SIZES.includes(+v)) {
      if (sun.shadow.map) {
        sun.shadow.map.dispose(); // drop the old map so it re-allocates at the new size
        sun.shadow.map = null;
      }
      sun.shadow.mapSize.set(+v, +v);
    }
    scene.traverse((o) => {
      if (o.material) o.material.needsUpdate = true; // recompile shaders for shadow on/off
    });
    renderer.shadowMap.needsUpdate = true;
  };
}

// ===== Table ================================================================
const tableMesh = new THREE.Mesh(
  new THREE.BoxGeometry(TABLE.x * 2, 1, TABLE.z * 2),
  new THREE.MeshStandardMaterial({ color: 0x2f6b4f, roughness: 0.95 }),
);
tableMesh.position.y = -0.5; // top surface sits at y = 0
tableMesh.receiveShadow = true;
scene.add(tableMesh);

// Rebuild the felt at new half-extents (the GM resized the play surface).
function resizeTable(hx, hz) {
  tableMesh.geometry.dispose();
  tableMesh.geometry = new THREE.BoxGeometry(hx * 2, 1, hz * 2);
  fitShadow(hx, hz); // keep the shadow frustum matched to the surface
}

// Recolor the felt (the GM picked a new table color).
function setTableColor(color) {
  if (color) tableMesh.material.color.set(color);
}

export { CONFIG, clamp, scene, camera, renderer, controls, resizeTable, setTableColor };
