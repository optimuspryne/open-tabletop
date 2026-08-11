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
  grab:    { height: 1, min: 0.30, max: 6, step: 0.35, deckHeight: 1.6 }, // held-piece float height + scroll range/step; deckHeight = how high dealt cards ride
  model:   { size: 1.6 },                       // custom .glb props normalize their largest dimension to this
  render:  { delay: 60 },                       // ms: draw this far behind live state (interpolation buffer)
  ranges:  { scale: [0.3, 3], qty: [1, 12], boardW: [2, 18], boardD: [2, 12] }, // spawn-modal input clamps [min, max]
  inspect: { fit: 2.4, dist: 5, drop: 0.2 },    // enlarged inspect view: target size, distance from camera, downward offset
  marker:  { inner: 0.34, outer: 0.5, opacity: 0.35, lift: 0.02 }, // "drop preview" ring: radii, opacity, height above the surface
  input:   { dblMs: 280, clickMs: 300, dragPx: 6, inspectPx: 4, handPx: 8 }, // click/drag feel: double-click window, click-defer (ms), drag thresholds (px)
  tex:     { die: 256, board: 512 },            // canvas texture resolutions (higher = sharper, more GPU memory)
  upload:  { cardW: 512, cardH: 716, board: 1024, type: 'image/png', quality: 1.0 }, // uploaded image size + encoding (PNG = lossless; quality only affects lossy types)
  anim:    { shuffle: { dur: 420, yaw: 0.15, bob: 0.15, cycles: 6 } }, // cosmetic shuffle "riffle": duration (ms), yaw wiggle (rad), lift (units), oscillations
};

// Clamp a number into [min, max] (same helper as the server's; exported for reuse).
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// The three lighting intensities most worth tweaking to taste.
const LIGHTING = {
  hemi: 0.30, // soft sky/ground fill (ambient)
  sun:  2.50, // main directional light + shadows
  env:  0.45, // environment-map reflection strength (0 = flat, 1 = full studio)
};

// ===== Scene, camera, renderer ==============================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14181d);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 14, 16);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('app').appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49; // don't let the camera drop below the tabletop

// ===== Environment & lights =================================================
// Dim every light and material inside a prebuilt environment by `factor`, so we
// can borrow RoomEnvironment's studio look at a subtler intensity.
const dimEnvironment = (env, factor) => {
  env.traverse(node => {
    if (node.isLight) node.intensity *= factor;
    if (node.material && node.material.color) node.material.color.multiplyScalar(factor);
  });
  return env;
};

// A neutral studio environment so PBR/metallic materials (including custom .glb)
// reflect something instead of rendering dark. Subtle — mostly helps metals read.
const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(dimEnvironment(new RoomEnvironment(), LIGHTING.env), 0.04).texture;

scene.add(new THREE.HemisphereLight(0xffffff, 0x222222, LIGHTING.hemi));

const sun = new THREE.DirectionalLight(0xffffff, LIGHTING.sun);
sun.position.set(10, 18, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 12, bottom: -12 });
scene.add(sun);

// ===== Table ================================================================
const tableMesh = new THREE.Mesh(
  new THREE.BoxGeometry(TABLE.x * 2, 1, TABLE.z * 2),
  new THREE.MeshStandardMaterial({ color: 0x2f6b4f, roughness: 0.95 }),
);
tableMesh.position.y = -0.5; // top surface sits at y = 0
tableMesh.receiveShadow = true;
scene.add(tableMesh);

export { CONFIG, clamp, scene, camera, renderer, controls };
