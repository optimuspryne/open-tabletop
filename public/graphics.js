import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG, renderer, deviceClass } from './core.js';
import {
  PROPS,
  COLORS,
  CARD_ROUND,
  TILES,
  HEX_HH,
  cardGeom,
  dieVerts,
  dieR,
  DIE_GLYPH,
  BOARDS,
  BOARD_SIZE,
  DECK_MODELS,
  TABLE,
  MEASURE,
  DISPENSERS,
  DICE_FINISH_FALLBACK,
  DICE_MODELS,
  stackDiscH,
  stackVisible,
  gridActive,
  trayParts,
} from '/shared/pieces.js';

// ===== Shared helpers =======================================================

// Create a w×h canvas and return it together with its 2D context.
function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') };
}

// The max anisotropic-filtering level the GPU supports, cached after the first
// query. Higher = textures stay sharp at grazing angles and distance.
let _maxAniso = 0;
function maxAnisotropy() {
  return _maxAniso || (_maxAniso = renderer.capabilities.getMaxAnisotropy());
}

// ===== Texture builders (procedural canvas textures) ========================
// Each returns a THREE texture via cTex(). Cards, dice, boards, and deck edges
// are all drawn onto a 2D canvas rather than shipped as image files.

// The face of a standard playing card: rank + suit small in two opposite corners
// and large in the middle. `color` is the suit color (black or red).
function cardFront(rank, suit, color) {
  const S = 2,
    w = 300,
    h = 420;
  const { canvas, ctx } = makeCanvas(w * S, h * S);
  ctx.scale(S, S); // render at 2× for crisper rank/suit text

  ctx.fillStyle = '#fbfbf7';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, w - 6, h - 6);

  ctx.fillStyle = color;
  ctx.textAlign = 'center';

  // The small rank-over-suit index, drawn at the current canvas origin.
  const drawIndex = () => {
    ctx.font = 'bold 66px Georgia';
    ctx.fillText(rank, 0, 0);
    ctx.font = 'bold 66px Georgia';
    ctx.fillText(suit, 0, 42);
  };

  ctx.save();
  ctx.translate(34, 52);
  drawIndex();
  ctx.restore(); // top-left
  ctx.save();
  ctx.translate(w - 34, h - 52);
  ctx.rotate(Math.PI);
  drawIndex();
  ctx.restore(); // bottom-right, rotated 180°

  ctx.font = 'bold 140px Georgia';
  ctx.fillText(rank, w / 2, h / 2 + 56); // big centre rank
  return cTex(canvas);
}

// A joker face: a star motif over "JOKER", in the joker's color (a deck ships one
// warm-red and one near-black joker). Same card proportions/border as cardFront.
function jokerFace(color) {
  const S = 2,
    w = 300,
    h = 420;
  const { canvas, ctx } = makeCanvas(w * S, h * S);
  ctx.scale(S, S);
  ctx.fillStyle = '#fbfbf7';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, w - 6, h - 6);

  ctx.fillStyle = color || '#141414';
  ctx.textAlign = 'center';
  // Corner index: a "J" over a small star, mirrored bottom-right like a rank index.
  const drawIndex = () => {
    ctx.font = 'bold 60px Georgia';
    ctx.fillText('J', 0, 0);
    ctx.font = '34px Georgia';
    ctx.fillText('★', 0, 38);
  };
  ctx.save();
  ctx.translate(34, 48);
  drawIndex();
  ctx.restore();
  ctx.save();
  ctx.translate(w - 34, h - 48);
  ctx.rotate(Math.PI);
  drawIndex();
  ctx.restore();
  // Centre: a big star over the word JOKER.
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 120px Georgia';
  ctx.fillText('★', w / 2, h / 2 - 46);
  ctx.font = 'bold 52px Georgia';
  ctx.fillText('JOKER', w / 2, h / 2 + 84);
  return cTex(canvas);
}

// The pips (0–6) for one half of a domino, in the standard 3×3 layout, within [x0,y0,cw,ch].
function drawPips(ctx, n, x0, y0, cw, ch, color) {
  if (!n) return;
  const P = {
    c: [0.5, 0.5],
    tl: [0.28, 0.28],
    tr: [0.72, 0.28],
    ml: [0.28, 0.5],
    mr: [0.72, 0.5],
    bl: [0.28, 0.72],
    br: [0.72, 0.72],
  };
  const SETS = {
    1: ['c'],
    2: ['tl', 'br'],
    3: ['tl', 'c', 'br'],
    4: ['tl', 'tr', 'bl', 'br'],
    5: ['tl', 'tr', 'c', 'bl', 'br'],
    6: ['tl', 'ml', 'bl', 'tr', 'mr', 'br'],
  };
  const r = Math.min(cw, ch) * 0.1;
  ctx.fillStyle = color || '#1a1a1a';
  for (const key of SETS[n] || []) {
    const [fx, fy] = P[key];
    ctx.beginPath();
    ctx.arc(x0 + fx * cw, y0 + fy * ch, r, 0, Math.PI * 2);
    ctx.fill();
  }
}
// A domino tile face: two pip halves (a over b) split by a divider. Drawn at the tile's 1:2
// footprint so it maps cleanly onto the domino geometry (no stretch).
function dominoFace(a, b) {
  const w = 300,
    h = 600;
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(0, 0, w, h); // full square fill; the mesh's mask rounds the corners
  const m = w * 0.12; // the dividing bar across the middle
  ctx.strokeStyle = '#888';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(m, h / 2);
  ctx.lineTo(w - m, h / 2);
  ctx.stroke();
  drawPips(ctx, a, m, m, w - 2 * m, h / 2 - 2 * m); // top half = a
  drawPips(ctx, b, m, h / 2 + m, w - 2 * m, h / 2 - 2 * m); // bottom half = b
  return cTex(canvas);
}
// A blank domino back: ivory tile with a subtle inset border (not the playing-card cross-hatch).
function dominoBack() {
  const w = 300,
    h = 600;
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.fillStyle = '#efe9da';
  ctx.fillRect(0, 0, w, h); // full square fill; the mesh's mask rounds the corners
  ctx.strokeStyle = '#c9bfa6';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(22, 22, w - 44, h - 44, 0.06 * w);
  ctx.stroke();
  return cTex(canvas);
}
// A word-tile FACE: a big letter with a small point value in the lower-right (blank = an empty tile).
function letterTileFace(letter, value) {
  const S = 300;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.fillStyle = '#f2e8cf'; // warm wood; the mesh's mask rounds the corners
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#2c2115'; // ink (matches WORDY_COLORS.ink)
  const L = String(letter || '').toUpperCase();
  if (L) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 190px Georgia, "Times New Roman", serif';
    ctx.fillText(L, S * 0.46, S * 0.52);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '600 60px Georgia, serif';
    ctx.fillText(String(value ?? ''), S * 0.9, S * 0.88); // point value, lower-right
  } else {
    ctx.strokeStyle = 'rgba(44,33,21,0.18)';
    ctx.lineWidth = 6; // blank tile: a faint frame so it still reads as a tile
    ctx.beginPath();
    ctx.roundRect(40, 40, S - 80, S - 80, 24);
    ctx.stroke();
  }
  return cTex(canvas);
}
// A word-tile BACK: a blank warm-wood tile (the face-down bag).
function letterBack() {
  const S = 300;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.fillStyle = '#e7dcc0';
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = '#c9bfa6';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(24, 24, S - 48, S - 48, 0.08 * S);
  ctx.stroke();
  return cTex(canvas);
}
// A mahjong tile BACK: the iconic green bakelite face (the wall, face-down tiles).
function mahjongBack() {
  const w = 300,
    h = 418;
  const { canvas, ctx } = makeCanvas(w, h);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#2f7d5b');
  g.addColorStop(1, '#245f45');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.roundRect(20, 20, w - 40, h - 40, 0.06 * w);
  ctx.stroke();
  return cTex(canvas);
}

// The classic diagonal cross-hatch card back.
function cardBack() {
  const { canvas, ctx } = makeCanvas(256, 256);

  ctx.fillStyle = '#7d2b2b';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#c9a25a';
  ctx.lineWidth = 3;
  for (let i = -256; i < 256; i += 20) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 256, 256);
    ctx.stroke();
  }
  return cTex(canvas);
}

// An 8×8 checker/felt texture — the default procedural board top.
function boardTex() {
  const squares = 8,
    size = CONFIG.tex.board;
  const { canvas, ctx } = makeCanvas(size, size);

  const cell = size / squares;
  for (let i = 0; i < squares; i++) {
    for (let j = 0; j < squares; j++) {
      ctx.fillStyle = (i + j) % 2 ? COLORS.felt[0] : COLORS.felt[1];
      ctx.fillRect(i * cell, j * cell, cell, cell);
    }
  }
  return cTex(canvas);
}

// The deck's side texture: fine horizontal layer-lines that read as a stack of
// cards. Cached, since every deck shares the same edge.
let _deckEdgeTex;
function deckEdgeTex() {
  if (_deckEdgeTex) return _deckEdgeTex;
  const w = 4,
    h = 256;
  const { canvas, ctx } = makeCanvas(w, h);

  ctx.fillStyle = '#' + COLORS.deckEdge.toString(16).padStart(6, '0'); // paper base color
  ctx.fillRect(0, 0, w, h);
  ctx.lineWidth = 1;
  for (let y = 2; y < h; y += 4) {
    // Alternate a shadow line and a highlight line to fake stacked paper layers.
    ctx.strokeStyle = y % 8 < 4 ? 'rgba(120,108,90,0.75)' : 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
    ctx.stroke();
  }
  _deckEdgeTex = cTex(canvas);
  return _deckEdgeTex;
}

// Wrap a canvas as a THREE texture with anisotropic filtering (see maxAnisotropy).
function cTex(canvas, srgb = true) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = maxAnisotropy();
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

// --- Dice numbering ---------------------------------------------------------

// Draw a die number centred on a `size`×`size` canvas, shrinking the font until
// it fits. 6 and 9 get an underline so they can't be confused upside-down.
function drawNumber(ctx, size, value, color) {
  const ink = color || COLORS.ink;
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const text = String(value);
  let fontSize = size * 0.59;
  ctx.font = `bold ${fontSize}px system-ui,sans-serif`;
  while (ctx.measureText(text).width > size * 0.72 && fontSize > size * 0.08) {
    fontSize -= size * 0.047;
    ctx.font = `bold ${fontSize}px system-ui,sans-serif`;
  }
  ctx.fillText(text, size / 2, size / 2 + size * 0.016);

  if (value === 6 || value === 9) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = size * 0.047;
    ctx.beginPath();
    ctx.moveTo(size * 0.34, size * 0.74);
    ctx.lineTo(size * 0.66, size * 0.74);
    ctx.stroke();
  }
}

// Cached number textures: transparent-background digits for the label planes on
// polyhedral dice, and ivory-background digits for the flat d6 box faces.
const _digitTex = new Map(),
  _faceTex = new Map();

function digitTexture(value, text) {
  const def = text == null;
  if (def && _digitTex.has(value)) return _digitTex.get(value);
  const size = CONFIG.tex.die;
  const { canvas, ctx } = makeCanvas(size, size);
  drawNumber(ctx, size, value, text != null ? hexOf(text) : null);
  const texture = cTex(canvas);
  if (def) _digitTex.set(value, texture);
  return texture;
}

const hexOf = (c) => '#' + ((c >>> 0) & 0xffffff).toString(16).padStart(6, '0');
function numberFaceTexture(value, body, text, finishKey, finishImg) {
  if (FINISHES[finishKey]?.image && finishImg) return customFaceTexture(value, text, finishImg);
  const marble = FINISHES[finishKey]?.marble;
  const def = body == null && text == null && !marble; // the shared, cached ivory face
  if (def && _faceTex.has(value)) return _faceTex.get(value);
  const size = CONFIG.tex.die;
  const { canvas, ctx } = makeCanvas(size, size);
  if (marble)
    ctx.drawImage(marbleCanvas(Number.isInteger(body) ? body : 0xf4f1ea), 0, 0, size, size);
  else {
    ctx.fillStyle = body != null ? hexOf(body) : COLORS.ivory;
    ctx.fillRect(0, 0, size, size);
  }
  drawNumber(ctx, size, value, text != null ? hexOf(text) : null);
  const texture = cTex(canvas);
  if (def) _faceTex.set(value, texture); // only the default is cached (custom faces are per-die)
  return texture;
}

// ===== Dice finishes (ROADMAP §9) ===========================================
// A finish is a material look layered on top of the die's color. Param-only ones (matte/satin/
// glossy/metallic/pearl) just tune roughness/metalness (and read the scene env map for real
// reflections); 'marbled' generates a procedural swirl texture tinted from the die's color.
const FINISHES = {
  matte: { roughness: 0.5, metalness: 0.0 },
  satin: { roughness: 0.3, metalness: 0.0 },
  glossy: { roughness: 0.1, metalness: 0.05 },
  metallic: { roughness: 0.35, metalness: 0.95 }, // material.color = the die color → tinted metal
  pearl: {
    roughness: 0.3,
    metalness: 0.1,
    physical: { clearcoat: 0.8, clearcoatRoughness: 0.3, sheen: 0.5, sheenRoughness: 0.5 },
  },
  marbled: { roughness: 0.3, metalness: 0.05, marble: true },
  brushed: { roughness: 1, metalness: 1, brushed: true }, // metallic + directional roughness map
  glow: { roughness: 0.5, metalness: 0, emissive: true, emissiveIntensity: 0.75 }, // glows its color
  translucent: {
    roughness: 0.5,
    metalness: 0,
    opacity: 0.75,
  }, // plain transparent MeshStandard — no clearcoat, so Android GPUs don't choke on it
  custom: { roughness: 0.45, metalness: 0.0, image: true }, // an uploaded texture as the die surface (needs finishImg)
};
const DIE_MARBLE_UV = 0.9; // triplanar UV scale for the marble map on convex dice (tune to taste)

// --- Procedural marble: value-noise turbulence, base↔vein by a warped sine (classic marble). ---
function _hash2(ix, iy) {
  let h = (ix * 374761393 + iy * 668265263) | 0;
  h = Math.imul(h ^ (h >> 13), 1274126177);
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}
function _vnoise(x, y) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx),
    uy = fy * fy * (3 - 2 * fy);
  const a = _hash2(ix, iy),
    b = _hash2(ix + 1, iy),
    c = _hash2(ix, iy + 1),
    d = _hash2(ix + 1, iy + 1);
  return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
}
function _turb(x, y, oct) {
  let sum = 0,
    amp = 1,
    freq = 1,
    norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * _vnoise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
const _marbleCanvas = new Map();
// Procedural marble tinted from the die color. Domain-warped coordinates (so veins meander instead
// of running in even bands) feed two ridged vein layers at different scales/orientations — a thin
// sharp set and a thicker soft set — combined for varied thickness. Vein color contrasts the base:
// dark veins on a light die, light veins on a dark one.
function marbleCanvas(colorInt) {
  const key = colorInt >>> 0;
  if (_marbleCanvas.has(key)) return _marbleCanvas.get(key);
  const size = 256;
  const { canvas, ctx } = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const px = img.data;
  const br = (colorInt >> 16) & 255,
    bg = (colorInt >> 8) & 255,
    bb = colorInt & 255;
  const lum = (0.299 * br + 0.587 * bg + 0.114 * bb) / 255;
  const toward = lum > 0.5 ? 0 : 255; // dark veins on a light die, light on a dark one
  const mixV = 0.62;
  const vr = br + (toward - br) * mixV,
    vg = bg + (toward - bg) * mixV,
    vb = bb + (toward - bb) * mixV;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size,
        ny = y / size;
      const wx = nx + 0.6 * _turb(nx * 2 + 11, ny * 2 + 3, 4); // domain warp → meandering veins
      const wy = ny + 0.6 * _turb(nx * 2 + 7, ny * 2 + 19, 4);
      const t1 = _turb(wx * 3, wy * 3, 5);
      const v1 = Math.pow(1 - Math.abs(Math.sin((wx * 5 + t1 * 4) * Math.PI)), 3.0); // thin, sharp
      const t2 = _turb(wy * 2 + 5, wx * 2 + 2, 4);
      const v2 = Math.pow(1 - Math.abs(Math.sin((wy * 2.3 + t2 * 3) * Math.PI)), 1.6); // thicker, soft
      const m = Math.min(1, Math.max(v1 * 0.95, v2 * 0.55));
      const i = (y * size + x) * 4;
      px[i] = br + (vr - br) * m;
      px[i + 1] = bg + (vg - bg) * m;
      px[i + 2] = bb + (vb - bb) * m;
      px[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  _marbleCanvas.set(key, canvas);
  return canvas;
}
let _brushedTex = null;
// A grayscale roughness map of fine horizontal streaks — metal + this reads as brushed. Color-
// independent, so one cached texture serves every brushed die (tiled via RepeatWrapping).
function brushedTexture() {
  if (_brushedTex) return _brushedTex;
  const size = 256;
  const { canvas, ctx } = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const px = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = _turb(x * 0.04, y * 22, 2); // slow in x, fast in y → fine horizontal streaks
      const g = Math.round((0.25 + 0.5 * s) * 255); // roughness ~0.25..0.75 along the grain
      const i = (y * size + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = g;
      px[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = cTex(canvas, false); // data map, not sRGB
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  _brushedTex = tex;
  return _brushedTex;
}
const _marbleTex = new Map();
function marbleTexture(colorInt) {
  const key = colorInt >>> 0;
  if (_marbleTex.has(key)) return _marbleTex.get(key);
  const tex = cTex(marbleCanvas(colorInt));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  _marbleTex.set(key, tex);
  return tex;
}

// --- Custom dice texture (ROADMAP §9 phase 2): a host-uploaded seamless image used as the die
// surface. On a convex/d4 body it's a repeat-wrapped map over triplanar UVs (like marble). On a
// d6 the image is composited under each number on a per-face canvas — the image loads async, so
// the face texture starts as the number on ivory and fills in the image on load. ---
const _customTex = new Map();
function customTexture(url) {
  if (_customTex.has(url)) return _customTex.get(url);
  const tex = loadImageTexture(url); // sRGB + anisotropy
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  _customTex.set(url, tex);
  return tex;
}

// Draw an image to fill a size×size canvas, cropping to cover (CSS background-size: cover).
function drawImageCover(ctx, img, size) {
  const iw = img.naturalWidth || img.width,
    ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const scale = Math.max(size / iw, size / ih);
  const w = iw * scale,
    h = ih * scale;
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
}

const _customFaceTex = new Map();
function customFaceTexture(value, text, url) {
  const key = value + '|' + (text ?? '') + '|' + url;
  if (_customFaceTex.has(key)) return _customFaceTex.get(key);
  const size = CONFIG.tex.die;
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = COLORS.ivory;
  ctx.fillRect(0, 0, size, size);
  drawNumber(ctx, size, value, text != null ? hexOf(text) : null); // legible before the image loads
  const texture = cTex(canvas);
  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, size, size);
    drawImageCover(ctx, img, size);
    drawNumber(ctx, size, value, text != null ? hexOf(text) : null); // number stays on top of the art
    texture.needsUpdate = true;
  };
  img.src = url;
  _customFaceTex.set(key, texture);
  return texture;
}

// Give a ConvexGeometry per-face triplanar UVs so a marble map maps without stretching (it ships
// with none). Non-indexed, so each triangle's 3 verts share the projection of its dominant axis.
function addTriplanarUV(geo, scale) {
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    e1 = new THREE.Vector3(),
    e2 = new THREE.Vector3(),
    n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
    const ax = Math.abs(n.x),
      ay = Math.abs(n.y),
      az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? a : k === 1 ? b : c;
      let u, w;
      if (ax >= ay && ax >= az) {
        u = v.z;
        w = v.y;
      } else if (ay >= az) {
        u = v.x;
        w = v.z;
      } else {
        u = v.x;
        w = v.y;
      }
      uv[(i + k) * 2] = u * scale + 0.5;
      uv[(i + k) * 2 + 1] = w * scale + 0.5;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// The body material for a die, given its color + finish. Convex dice + d4 use this directly; the
// d6 uses dieFaceMaterial (its faces bake the number into the map).
function dieBodyMaterial(color, finishKey, finishImg) {
  const f = FINISHES[finishKey] || FINISHES.matte;
  const c = Number.isInteger(color) ? color : 0xf4f1ea;
  const params = {
    color: f.marble || (f.image && finishImg) ? 0xffffff : (color ?? COLORS.ivory),
    roughness: f.roughness,
    metalness: f.metalness || 0,
    flatShading: true,
  };
  if (f.marble) params.map = marbleTexture(c);
  if (f.image && finishImg) params.map = customTexture(finishImg);
  if (f.brushed) params.roughnessMap = brushedTexture();
  if (f.emissive) {
    params.emissive = c; // convex body glows the die color; the number planes sit on top
    params.emissiveIntensity = f.emissiveIntensity;
  }
  if (f.opacity != null) {
    params.transparent = true;
    params.opacity = f.opacity;
  }
  return f.physical
    ? new THREE.MeshPhysicalMaterial({ ...params, ...f.physical })
    : new THREE.MeshStandardMaterial(params);
}
// A d6 face material: the composited (solid or marble) number face as the map, plus the finish params.
function dieFaceMaterial(value, color, textColor, finishKey, finishImg) {
  const f = FINISHES[finishKey] || FINISHES.matte;
  const map = numberFaceTexture(value, color, textColor, finishKey, finishImg);
  const params = { map, roughness: f.roughness, metalness: f.metalness || 0 };
  if (f.brushed) params.roughnessMap = brushedTexture();
  if (f.emissive) {
    params.emissive = 0xffffff; // glow the face art itself → numbers stay legible as dark glow
    params.emissiveMap = map;
    params.emissiveIntensity = f.emissiveIntensity;
  }
  if (f.opacity != null) {
    params.transparent = true;
    params.opacity = f.opacity;
  }
  return f.physical
    ? new THREE.MeshPhysicalMaterial({ ...params, ...f.physical })
    : new THREE.MeshStandardMaterial(params);
}

// A flat plane showing one die number, for laying onto a polyhedron's face.
function numberLabel(value, size, text) {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({
      map: digitTexture(value, text),
      transparent: true,
      depthWrite: false,
    }),
  );
}

// Build a numbered polyhedral die: a convex mesh plus one number laid flat on
// each face. ConvexGeometry gives us triangles, so we recover the real polygon
// faces by grouping triangles that share a normal (same trick as the server's
// collider), then drop a numbered label at each face's centre.
function convexDie(sides, color, textColor, finish, finishImg) {
  const points = dieVerts(sides).map((v) => new THREE.Vector3(v[0], v[1], v[2]));
  const geo = new ConvexGeometry(points);
  if (FINISHES[finish]?.marble || FINISHES[finish]?.brushed || FINISHES[finish]?.image)
    addTriplanarUV(geo, DIE_MARBLE_UV);
  const die = new THREE.Mesh(geo, dieBodyMaterial(color, finish, finishImg));
  die.castShadow = true;
  die.receiveShadow = true;

  const group = new THREE.Group();
  group.add(die);

  // Group the mesh's triangles into faces by shared normal.
  const pos = geo.getAttribute('position');
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const ab = new THREE.Vector3(),
    ac = new THREE.Vector3(),
    normal = new THREE.Vector3();
  const faces = [];
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    normal.crossVectors(ab, ac).normalize();

    let face = faces.find((f) => f.normal.dot(normal) > 0.999);
    if (!face) {
      face = { normal: normal.clone(), verts: new Map() };
      faces.push(face);
    }
    // Collect the face's unique vertices (dedup by rounded position key).
    for (const vertex of [a, b, c]) {
      const key = `${vertex.x.toFixed(3)},${vertex.y.toFixed(3)},${vertex.z.toFixed(3)}`;
      if (!face.verts.has(key)) face.verts.set(key, vertex.clone());
    }
  }

  // Lay a numbered label flat on each face, sized to the face's inscribed circle.
  faces.forEach((face, index) => {
    const verts = [...face.verts.values()];
    const centroid = new THREE.Vector3();
    verts.forEach((v) => centroid.add(v));
    centroid.multiplyScalar(1 / verts.length);

    let circumRadius = 0;
    verts.forEach((v) => (circumRadius = Math.max(circumRadius, v.distanceTo(centroid))));
    const inRadius = circumRadius * Math.cos(Math.PI / verts.length);

    const label = numberLabel(index + 1, inRadius * 1.25 * DIE_GLYPH, textColor);
    label.position.copy(centroid).addScaledVector(face.normal, 0.015); // float just above the surface
    label.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), face.normal);
    group.add(label);
  });
  return group;
}

// A d4 is read by its top vertex, not a top face — so each of the 4 vertices
// carries a number, printed at that corner on all three faces touching it.
function numberedD4(color, textColor, finish, finishImg) {
  const verts = dieVerts(4).map((v) => new THREE.Vector3(v[0], v[1], v[2]));
  const geo = new ConvexGeometry(verts);
  if (FINISHES[finish]?.marble || FINISHES[finish]?.brushed || FINISHES[finish]?.image)
    addTriplanarUV(geo, DIE_MARBLE_UV);
  const die = new THREE.Mesh(geo, dieBodyMaterial(color, finish, finishImg));
  die.castShadow = true;
  die.receiveShadow = true;

  const group = new THREE.Group();
  group.add(die);

  // Which vertex number (1..4) a given corner is — the nearest of the 4 verts.
  const vertexNumber = (corner) => {
    let best = 0,
      bestDist = 1e9;
    verts.forEach((v, i) => {
      const dist = v.distanceTo(corner);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    return best + 1;
  };

  const pos = geo.getAttribute('position');
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const ab = new THREE.Vector3(),
    ac = new THREE.Vector3(),
    normal = new THREE.Vector3();
  const right = new THREE.Vector3(),
    up = new THREE.Vector3(),
    basis = new THREE.Matrix4();

  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    normal.crossVectors(ab, ac).normalize();

    const centroid = new THREE.Vector3()
      .add(a)
      .add(b)
      .add(c)
      .multiplyScalar(1 / 3);
    const circumRadius = Math.max(
      a.distanceTo(centroid),
      b.distanceTo(centroid),
      c.distanceTo(centroid),
    );

    // One label per corner of this face, oriented so the digit points outward
    // toward its own vertex (that's why each number appears three times). Unlike the
    // face-centred dice, the d4 reads at its CORNERS, which have little room — so it
    // takes only a damped share of DIE_GLYPH and sits pulled further in, or the digits
    // spill over the edges.
    const g4 = 1 + (DIE_GLYPH - 1) * 0.5; // half the global bump
    for (const corner of [a, b, c]) {
      const label = numberLabel(vertexNumber(corner), circumRadius * 0.52 * g4, textColor);
      up.subVectors(corner, centroid).normalize();
      right.crossVectors(up, normal).normalize();
      up.crossVectors(normal, right).normalize();
      basis.makeBasis(right, up, normal);
      label.quaternion.setFromRotationMatrix(basis);
      label.position.copy(corner).lerp(centroid, 0.4).addScaledVector(normal, 0.015);
      group.add(label);
    }
  }
  return group;
}

// Resolve a texture REFERENCE (a short string) to a THREE texture, cached:
//   'back'                    → the procedural classic card back
//   'rank:A:♠:#000'           → a procedural playing-card face
//   'text:[#col:][#bg:]words' → a procedural text card face
//   'tback:color:[#tc:]words' → a procedural text card back
//   'data:...' or a URL       → a loaded image (uploaded card art or a file)
const _texCache = new Map(),
  _texLoader = new THREE.TextureLoader();

// Load an external image URL as an sRGB texture with anisotropic filtering.
function loadImageTexture(url) {
  const texture = _texLoader.load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy();
  return texture;
}

// Decode a card "front" ref into a structured descriptor. The tagged-string
// encoding (rank: / text: / tback: / back / image) is defined HERE ONLY — both
// the 3D texture path (below) and the DOM hand-card path (client.js) decode via
// this helper, so the format has a single source of truth.
export function parseCardFront(ref) {
  if (!ref || ref === 'back') return { kind: 'back' };
  if (ref.startsWith('rank:')) {
    const [, rank, suit, color] = ref.split(':');
    return { kind: 'rank', rank, suit, color };
  }
  if (ref.startsWith('joker:')) return { kind: 'joker', color: ref.slice(6) || COLORS.ink };
  if (ref.startsWith('domino:')) {
    const [, a, b] = ref.split(':');
    return { kind: 'domino', a: +a || 0, b: +b || 0 };
  }
  if (ref === 'domback') return { kind: 'domback' };
  if (ref.startsWith('letter:')) {
    const [, l, v] = ref.split(':');
    return { kind: 'letter', letter: l || '', value: +v || 0 };
  } // 'letter:A:1'; blank = 'letter::0'
  if (ref === 'lback') return { kind: 'lback' };
  if (ref === 'mjback') return { kind: 'mjback' };
  if (ref.startsWith('text:')) {
    const [color, r1] = splitColorText(ref.slice(5), COLORS.ink);
    const [bg, r2] = splitColorText(r1, '#fbfbf7');
    const [accent, text] = splitColorText(r2, '#ddd'); // 4th color optional (border); default on old refs
    return { kind: 'text', color, bg, accent, text };
  }
  if (ref.startsWith('tback:')) {
    const [bg, r1] = splitColorText(ref.slice(6), '#7d2b2b');
    const [textColor, r2] = splitColorText(r1, '#f4f1ea');
    const [accent, text] = splitColorText(r2, 'rgba(255,255,255,.45)'); // 4th color optional; default on old refs
    return { kind: 'tback', bg, textColor, accent, text };
  }
  return { kind: 'image', ref };
}

function resolveTexture(ref) {
  if (!ref) ref = 'back';
  if (_texCache.has(ref)) return _texCache.get(ref);

  const parsed = parseCardFront(ref);
  let texture;
  if (parsed.kind === 'back') texture = cardBack();
  else if (parsed.kind === 'rank') texture = cardFront(parsed.rank, parsed.suit, parsed.color);
  else if (parsed.kind === 'joker') texture = jokerFace(parsed.color);
  else if (parsed.kind === 'domino') texture = dominoFace(parsed.a, parsed.b);
  else if (parsed.kind === 'domback') texture = dominoBack();
  else if (parsed.kind === 'letter') texture = letterTileFace(parsed.letter, parsed.value);
  else if (parsed.kind === 'lback') texture = letterBack();
  else if (parsed.kind === 'mjback') texture = mahjongBack();
  else if (parsed.kind === 'text')
    texture = textFaceTexture(parsed.text, parsed.color, parsed.bg, parsed.accent);
  else if (parsed.kind === 'tback')
    texture = textBackTexture(parsed.bg, parsed.text, parsed.textColor, parsed.accent);
  else texture = loadImageTexture(parsed.ref);

  _texCache.set(ref, texture);
  return texture;
}

// Split "color:rest" when the prefix is a hex color; otherwise return the
// default color and the whole string unchanged.
function splitColorText(str, defaultColor) {
  const sep = str.indexOf(':');
  if (sep > 0 && /^#[0-9a-fA-F]{3,8}$/.test(str.slice(0, sep))) {
    return [str.slice(0, sep), str.slice(sep + 1)];
  }
  return [defaultColor, str];
}

// Greedily wrap `text` into lines no wider than maxWidth (in the ctx's font).
function wrapLines(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? line + ' ' + word : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

// Draw wrapped, centred text into a w×h canvas, shrinking the font until the
// lines fit vertically within the padding.
function drawWrapped(ctx, text, w, h, pad, weight) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let fontSize = 30;
  ctx.font = `${weight} ${fontSize}px system-ui,sans-serif`;
  let lines = wrapLines(ctx, text, w - pad * 2);
  // shrink until the block fits vertically AND no single line overflows horizontally (long/unbreakable words)
  const overflows = () =>
    lines.length * fontSize * 1.25 > h - pad * 2 ||
    lines.some((l) => ctx.measureText(l).width > w - pad * 2);
  while (overflows() && fontSize > 8) {
    fontSize -= 2;
    ctx.font = `${weight} ${fontSize}px system-ui,sans-serif`;
    lines = wrapLines(ctx, text, w - pad * 2);
  }

  const lineHeight = fontSize * 1.25;
  let y = h / 2 - ((lines.length - 1) * lineHeight) / 2;
  for (const line of lines) {
    ctx.fillText(line, w / 2, y);
    y += lineHeight;
  }
}

// A procedural card FACE showing wrapped text (for custom text decks).
function textFaceTexture(text, color, bg, accent) {
  const S = 2,
    w = 300,
    h = 420;
  const { canvas, ctx } = makeCanvas(w * S, h * S);
  ctx.scale(S, S); // render at 2× so text stays crisp when a card is near the camera (draw in logical 300×420)

  ctx.fillStyle = bg || '#fbfbf7';
  ctx.fillRect(0, 0, w, h);
  const inset = 6,
    r = Math.max(0, CARD_ROUND * w - inset); // rounded frame, following the card's corners
  ctx.strokeStyle = accent || '#ddd';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(inset, inset, w - inset * 2, h - inset * 2, r);
  ctx.stroke();

  ctx.fillStyle = color || COLORS.ink;
  drawWrapped(ctx, text, w, h, 26, '600');
  return cTex(canvas);
}

// A procedural card BACK showing optional wrapped text (for custom text decks).
function textBackTexture(color, text, textColor, accent) {
  const w = 256,
    h = 358;
  const { canvas, ctx } = makeCanvas(w, h);

  ctx.fillStyle = color || '#7d2b2b';
  ctx.fillRect(0, 0, w, h);
  const inset = 8,
    r = Math.max(0, CARD_ROUND * w - inset); // rounded frame, following the card's corners
  ctx.strokeStyle = accent || 'rgba(255,255,255,.45)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(inset, inset, w - inset * 2, h - inset * 2, r);
  ctx.stroke();

  if (text) {
    ctx.fillStyle = textColor || '#f4f1ea';
    drawWrapped(ctx, text, w, h, 22, '700');
  }
  return cTex(canvas);
}

// --- Image & model upload / measurement helpers -----------------------------

// Draw `file` onto a w×h canvas, cover-fitting by default (or 'stretch' to fill).
// Resolves with the canvas. Used to normalize uploaded card/board art.
function resizeToCanvas(file, w, h, fit, bg) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const { canvas, ctx } = makeCanvas(w, h);
      if (fit === 'stretch') {
        ctx.drawImage(img, 0, 0, w, h); // whole image squashed to fit (boards)
      } else if (fit === 'contain') {
        // Fit the whole image inside, centre, and pad the leftover with bg (no crop).
        ctx.fillStyle = bg || '#ffffff';
        ctx.fillRect(0, 0, w, h);
        const scale = Math.min(w / img.width, h / img.height);
        const drawW = img.width * scale,
          drawH = img.height * scale;
        ctx.drawImage(img, (w - drawW) / 2, (h - drawH) / 2, drawW, drawH);
      } else {
        // Cover-fit: scale up to fill, centre, and let the overflow crop.
        const scale = Math.max(w / img.width, h / img.height);
        const drawW = img.width * scale,
          drawH = img.height * scale;
        ctx.drawImage(img, (w - drawW) / 2, (h - drawH) / 2, drawW, drawH);
      }
      URL.revokeObjectURL(img.src);
      resolve(canvas);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// Resize `file` and encode it to an image Blob for HTTP upload (format/quality
// come from CONFIG.upload).
function imgToBlob(file, w, h, fit, bg) {
  return resizeToCanvas(file, w, h, fit, bg).then(
    (canvas) =>
      new Promise((resolve) =>
        canvas.toBlob((blob) => resolve(blob), CONFIG.upload.type, CONFIG.upload.quality),
      ),
  );
}

// POST a body to an upload endpoint with the auth token; return the stored URL ref.
// (The raw token read here is auth plumbing that really belongs in a shared api
// helper — parked with the cross-file util-module refactor.)
async function postUpload(path, contentType, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      Authorization: 'Bearer ' + (localStorage.getItem('tabletop.token') || ''),
    },
    body,
  });
  if (!response.ok) throw new Error('upload failed');
  return (await response.json()).url;
}

// POST a raw .glb model; return the URL ref the server stored it under.
function uploadModel(file) {
  return postUpload('/upload-model?kind=props', 'model/gltf-binary', file);
}

// Load a .glb and return its true world-space bounds { size, center }, with all
// node transforms baked in.
function measureGlb(url, rot) {
  return new Promise((resolve, reject) =>
    gltfLoader.load(
      url,
      (gltf) => {
        if (rot) {
          gltf.scene.rotation.set(rot[0], rot[1], rot[2]);
          gltf.scene.updateMatrixWorld(true);
        } // measure the reoriented model
        const box = new THREE.Box3().setFromObject(gltf.scene);
        resolve({
          size: box.getSize(new THREE.Vector3()),
          center: box.getCenter(new THREE.Vector3()),
        });
      },
      undefined,
      reject,
    ),
  );
}

// Centre a loaded model at the origin, then scale it — either by a fixed factor
// (opts.scale) or by normalizing its largest dimension to opts.target. Returns
// the scale that was applied.
function fitModel(obj, opts) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale =
    opts.scale != null ? opts.scale : opts.target / (Math.max(size.x, size.y, size.z) || 1);
  obj.scale.setScalar(scale);
  obj.position.copy(center).multiplyScalar(-scale);
  return scale;
}

// The normalized collider half-extents [hx, hy, hz] for an uploaded model prop.
function measureModel(url, scale = 1, rot) {
  return measureGlb(url, rot).then(({ size }) => {
    const normScale = (MODEL_SIZE * scale) / (Math.max(size.x, size.y, size.z) || 1);
    return [(size.x * normScale) / 2, (size.y * normScale) / 2, (size.z * normScale) / 2];
  });
}

// Resize one image and POST it; return the URL ref the server stored it under.
async function uploadImage(file, w = CONFIG.upload.cardW, h = CONFIG.upload.cardH, fit, kind, bg) {
  const blob = await imgToBlob(file, w, h, fit, bg);
  const query = kind ? '?kind=' + encodeURIComponent(kind) : '';
  return postUpload('/upload' + query, CONFIG.upload.type, blob);
}
// The natural pixel size of an image file → { w, h }, or null on error. Used to size a card/tile
// deck to its art's aspect ratio (see geomFromImage).
function measureImage(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ w: img.naturalWidth, h: img.naturalHeight, round: cornerRadiusFrac(img) });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

// Read a card art's rounded-corner radius from its ALPHA, as a fraction of the art's opaque width.
// Card PNGs bake their rounded shape as transparency (the corners are see-through); measuring that
// radius lets the card mesh AND the deck round to the SAME corner the art uses, so their silhouettes
// match the image and no transparent corner is ever left to render as a dark chunk. Returns 0 for a
// square / fully-opaque image (a plain photo fills its rectangle edge-to-edge). Falls back to the
// standard card radius if the pixels can't be read.
function cornerRadiusFrac(img) {
  const NW = img.naturalWidth,
    NH = img.naturalHeight;
  if (!NW || !NH) return CARD_ROUND;
  const scale = Math.min(1, 400 / Math.max(NW, NH)); // sample at reduced res — plenty for a radius
  const w = Math.max(2, Math.round(NW * scale)),
    h = Math.max(2, Math.round(NH * scale));
  const { ctx } = makeCanvas(w, h);
  ctx.drawImage(img, 0, 0, w, h);
  let data;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch (e) {
    return CARD_ROUND;
  } // tainted canvas
  const A = 128,
    alpha = (x, y) => data[(y * w + x) * 4 + 3];
  let minX = w,
    minY = h,
    maxX = -1,
    maxY = -1; // bounding box of the opaque pixels
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (alpha(x, y) >= A) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (maxX < minX || maxY < minY) return CARD_ROUND; // no opaque pixels (shouldn't happen)
  const bw = maxX - minX + 1;
  if (alpha(minX, minY) >= A && alpha(maxX, minY) >= A && alpha(minX, maxY) >= A) return 0; // corners solid → square
  // On a rounded rect, the top edge's opaque span starts `r` in from the left, and the left edge's
  // opaque span starts `r` down from the top. Average the two estimates for robustness.
  let rv = 0;
  for (let y = minY; y <= maxY; y++)
    if (alpha(minX, y) >= A) {
      rv = y - minY;
      break;
    }
  let rh = 0;
  for (let x = minX; x <= maxX; x++)
    if (alpha(x, minY) >= A) {
      rh = x - minX;
      break;
    }
  return Math.max(0, Math.min(0.5, +((rh + rv) / 2 / bw).toFixed(4)));
}
// --- Die, card, and mask meshes ---------------------------------------------

// The visual mesh for a die. A d6 is a textured box (a number per face); a d4
// A bundled pipped d6 (DICE_MODELS): the .glb scaled to the d6 box size, its body material
// (`Ivory`) tinted with the die color and its pips (`Dots`) with the number color — matte, like
// the numbered dice. Physics/value are a normal d6, so only the mesh differs.
function pippedDieMesh(url, color, textColor) {
  const body = Number.isInteger(color) ? color : 0xf4f1ea;
  const pip = Number.isInteger(textColor) ? textColor : 0x141414;
  const paint = (material) =>
    new THREE.MeshStandardMaterial({
      color: material.name === 'Dots' ? pip : body,
      metalness: 0,
      roughness: 0.5,
    });
  return loadModelGroup(url, { target: dieR(6) * 2 }, (node) => {
    node.castShadow = true;
    node.receiveShadow = true;
    if (!node.material) return;
    node.material = Array.isArray(node.material) ? node.material.map(paint) : paint(node.material);
  });
}

// uses the special vertex-numbered build; everything else is a convex polyhedron.
function dieMesh(props = {}) {
  const sides = props.sides || 6;
  const dm = props.model && DICE_MODELS[props.model];
  if (dm) return pippedDieMesh(dm.model, props.color, props.textColor); // a bundled pipped d6

  // Phones fall back from GPU-heavy finishes to a safe look (regardless of who set the finish) —
  // this Android class black-screens on the physical / transparent / roughness-map shaders.
  let finish = props.finish;
  if (finish && DICE_FINISH_FALLBACK[finish] && deviceClass() === 'phone')
    finish = DICE_FINISH_FALLBACK[finish];
  const finishImg = finish === 'custom' ? props.finishImg : null; // only the custom finish uses it
  if (sides === 6) {
    const faceOrder = [1, 6, 2, 5, 3, 4]; // opposite faces sum to 7
    return new THREE.Mesh(
      new THREE.BoxGeometry(dieR(6) * 2, dieR(6) * 2, dieR(6) * 2),
      faceOrder.map((n) => dieFaceMaterial(n, props.color, props.textColor, finish, finishImg)),
    );
  }
  if (sides === 4) return numberedD4(props.color, props.textColor, finish, finishImg);
  return convexDie(sides, props.color, props.textColor, finish, finishImg);
}

// A rounded-rectangle alpha mask (white card shape on black), so cards render
// with rounded corners. Cached and reused by every card. Not sRGB — it's a mask.
// A rounded-rectangle alpha mask for a card/tile's faces. The canvas matches the face's aspect
// (height/width) so the corner radius maps to a circular arc; cached per (aspect, round). A plain
// card reuses one mask; tiles (domino/…) get their own.
const _roundMasks = new Map();
function roundMask(hw = TILES.card.w, hh = TILES.card.h, round = CARD_ROUND) {
  const aspect = hh / hw;
  const key = round.toFixed(3) + ':' + aspect.toFixed(3);
  let tex = _roundMasks.get(key);
  if (tex) return tex;
  const w = 300,
    h = Math.max(1, Math.round(300 * aspect));
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, round * w);
  ctx.fill();
  tex = cTex(canvas, false);
  _roundMasks.set(key, tex);
  return tex;
}

// A card mesh: a thin box whose top/bottom faces carry the front/back textures
// and whose four edges are invisible. A face-down card omits the front texture
// so its hidden face can never even be rendered client-side.
function cardMesh(props = {}) {
  const { hw, hh, th, round, shape } = cardGeom(props); // footprint/thickness/shape (standard card, a tile, or explicit geom)
  // Which face renders up vs down. A double-sided (open) tile shows its BACK when face-down (`down`);
  // otherwise the top is the front and the bottom is the back. A secret face-down card has no
  // `front`, so the top falls back to the back — the existing behavior.
  const up = props.open && props.down ? props.back : props.front;
  const dn = props.open && props.down ? props.front : props.back;

  // A HEXAGON card/tile: a regular flat-top hex prism — the GEOMETRY is the silhouette (no alpha mask),
  // and it matches the 6-gon collider exactly, so it's ready for hex grids. Thin → invisible edges;
  // thick → ivory sides. The image maps across the hex's bounding box (art outside the hex is clipped).
  if (shape === 'hex') {
    const geo = hexGeo(hh, th * 2); // hh = the hexagon's circumradius (pointy-top)
    const edge =
      th > 0.03
        ? new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.7 })
        : new THREE.MeshBasicMaterial({ visible: false });
    const faceMat = (ref) =>
      new THREE.MeshStandardMaterial({ map: resolveTexture(ref), alphaTest: 0.5, roughness: 0.6 });
    const dnMat = faceMat(dn);
    const upMat = up ? faceMat(up) : dnMat;
    return new THREE.Mesh(geo, [upMat, dnMat, edge]); // groups: 0=top(up face), 1=bottom(down face), 2=sides
  }

  // A chunky TILE (domino) is a rounded SOLID — real rounded side walls and opaque procedural faces,
  // so its thick silhouette reads correctly from any angle. (Threshold on thickness, not on tile-ness.)
  if (th > 0.03) {
    const geo = tileGeo(hw * 2, hh * 2, round * hw * 2, th * 2);
    const edge = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.7 });
    // Caps carry the face art. An uploaded IMAGE (thick custom tile) has transparent rounded corners —
    // alpha-cut it to the tile's rounded corner so a transparent pixel is discarded, not drawn black.
    // Procedural faces (dominoes) are opaque and already fit the rounded cap, so they stay plain.
    const capMask = roundMask(hw, hh, round);
    const capMat = (ref) => {
      const m = { map: resolveTexture(ref), roughness: 0.6 };
      if (parseCardFront(ref || 'back').kind === 'image') {
        m.alphaMap = capMask;
        m.alphaTest = 0.5;
      }
      return new THREE.MeshStandardMaterial(m);
    };
    const dnMat = capMat(dn);
    if (!up) return new THREE.Mesh(geo, [dnMat, dnMat, edge]);
    return new THREE.Mesh(geo, [capMat(up), dnMat, edge]);
  }

  // A THIN card: a thin box whose top/bottom faces carry the front/back art and whose four edges are
  // invisible. The faces are ALPHA-CUT to the card's rounded silhouette — by the art texture's OWN
  // transparency (uploaded card PNGs have transparent rounded corners) AND a rounded-rect mask (for
  // procedural faces, which are opaque). So the card matches its art exactly: no mesh-imposed frame or
  // thickness, and a transparent corner pixel is discarded instead of rendering as a dark chunk.
  const mask = roundMask(hw, hh, round); // round is measured from the art for image decks
  const invisible = new THREE.MeshBasicMaterial({ visible: false });
  const faceMat = (ref) =>
    new THREE.MeshStandardMaterial({
      map: resolveTexture(ref),
      alphaMap: mask,
      alphaTest: 0.5,
      roughness: 0.6,
    });
  const dnMat = faceMat(dn);
  const upMat = up ? faceMat(up) : dnMat; // secret face-down (no front): both faces show the back
  const geo = new THREE.BoxGeometry(hw * 2, th * 2, hh * 2);
  // Box material order: +X, -X, +Y(top), -Y(bottom), +Z, -Z → up face on top, down face beneath, edges hidden.
  const mesh = new THREE.Mesh(geo, [invisible, invisible, upMat, dnMat, invisible, invisible]);
  // Cast a shadow that follows the alpha silhouette, not the square box — no dark sliver at the corners.
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: resolveTexture(up || dn),
    alphaMap: mask,
    alphaTest: 0.5,
  });
  return mesh;
}
// --- Props: models (async .glb) and built-in shapes -------------------------

// The color a built-in prop should render in: a fixed team color for two-sided
// game sets (checkers/chess), otherwise the player's picked color, else neutral.
function propColor(props) {
  const spec = PROPS[props.shape] || PROPS.box;
  if (spec.team) return COLORS.team[spec.team][props.team ? 1 : 0];
  return props.color ?? COLORS.neutralProp;
}

const propMat = (color) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.05 });
const gltfLoader = new GLTFLoader();
const MODEL_SIZE = CONFIG.model.size; // custom-model normalization target

// Load a .glb into a fresh group and return the group immediately; the model
// populates it asynchronously once loaded. `fitOpts` is passed to fitModel;
// `onMesh(node)` runs for each mesh (shadow/material handling); optional
// `beforeFit(scene)` runs on the raw scene before fitting (e.g. to reorient it).
function loadModelGroup(url, fitOpts, onMesh, beforeFit) {
  const group = new THREE.Group();
  gltfLoader.load(
    url,
    (gltf) => {
      const obj = gltf.scene;
      if (beforeFit) beforeFit(obj);
      fitModel(obj, fitOpts);
      obj.traverse((node) => {
        if (node.isMesh) onMesh(node);
      });
      group.add(obj);
    },
    undefined,
    () => {},
  );
  return group;
}

// The surface for a tinted prop/stack slot, honoring the spec's finish flag: `metal` renders
// metallic and `glossy` a clear-gloss sheen (both catch the scene env map, like the Metallic /
// Glossy dice finishes); everything else stays matte. One place, so a spawned prop and its
// dispenser stack always match.
function itemSurface(spec, color, side) {
  if (spec && spec.metal)
    return new THREE.MeshStandardMaterial({ color, metalness: 0.95, roughness: 0.35, side });
  if (spec && spec.glossy)
    return new THREE.MeshStandardMaterial({ color, metalness: 0.05, roughness: 0.1, side });
  return new THREE.MeshStandardMaterial({ color, metalness: 0, roughness: 0.6, side });
}

// Build a prop's visual mesh. A prop is either a bundled/custom .glb MODEL or a
// simple built-in SHAPE (box/sphere/cone/…). Models load asynchronously into a
// placeholder group and color themselves in when ready; shapes build instantly.
function propMesh(props = {}) {
  const spec = PROPS[props.shape] || {};
  const modelUrl = props.model || spec.model; // custom upload (instance) OR bundled built-in (definition)

  if (modelUrl) {
    const builtin = !props.model && !!spec.model; // built-ins keep FIXED set proportions; custom uploads normalize

    // Work out how the model gets colored (used by paint below):
    const teamTint = builtin && spec.team ? propColor(props) : null; // a team set → recolor every slot
    const pick = !builtin || !spec.ownMaterial || spec.tintMaterial ? (props.color ?? null) : null; // the player's picked color
    const matte = (color, side) => itemSurface(spec, color, side); // metal/glossy per spec, else matte

    // Decide the fate of one material slot on the loaded model.
    const paint = (material) => {
      if (teamTint != null) return matte(teamTint, material.side); // team set: recolor everything
      if (builtin && spec.tintMaterial) {
        // Only the one named slot takes the picked color; de-metal the rest so
        // their own baked-in colors read correctly.
        if (material.name === spec.tintMaterial && pick != null) return matte(pick, material.side);
        material.metalness = 0;
        return material;
      }
      if (builtin && spec.ownMaterial) {
        // keep the model's own materials, just de-metal
        material.metalness = 0;
        return material;
      }
      return pick != null ? matte(pick, material.side) : material; // full tint (color-picker / custom upload)
    };

    return loadModelGroup(
      modelUrl,
      builtin
        ? { scale: (spec.modelScale || 1) * (props.scale || 1) }
        : { target: MODEL_SIZE * (props.scale || 1) },
      (node) => {
        if (node.geometry) node.geometry.computeVertexNormals(); // smooth normals — kills the flat-shading seam on flat .glb faces
        if (!node.material) return;
        node.castShadow = true;
        node.receiveShadow = true;
        node.material = Array.isArray(node.material)
          ? node.material.map(paint)
          : paint(node.material);
      },
      (obj) => {
        const mr = builtin ? spec.modelRot : props.modelRot;
        if (mr) obj.rotation.set(mr[0], mr[1], mr[2]);
      }, // reorient: built-in template, or a per-upload modelRot
    );
  }

  // A simple built-in shape.
  const mesh = propShapeMesh(props);
  if (props.scale && props.scale !== 1) mesh.scale.multiplyScalar(props.scale); // MULTIPLY so a shape's own scale (e.g. lens y-flatten) survives
  return mesh;
}

// Build a simple built-in prop shape from its PROPS[shape].render descriptor.
function propShapeMesh(props = {}) {
  const spec = PROPS[props.shape] || PROPS.box;
  const render = spec.render;
  const material = propMat(propColor(props));
  switch (render.prim) {
    case 'sphere':
      return new THREE.Mesh(new THREE.SphereGeometry(render.r, 24, 16), material);
    case 'cone':
      return new THREE.Mesh(new THREE.ConeGeometry(render.r, render.h, render.seg), material);
    case 'cyl':
      return new THREE.Mesh(
        new THREE.CylinderGeometry(render.rTop ?? render.r, render.r, render.h, render.seg ?? 32),
        material,
      );
    case 'lens': {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(render.r, 24, 16), material);
      mesh.scale.y = render.sy; // squash the sphere into a lens
      return mesh;
    }
    default:
      return new THREE.Mesh(new THREE.BoxGeometry(...(render.size || [1, 1, 1])), material);
  }
}
// A rounded-rectangle THREE.Shape (w×d, corner radius `radius`), centred on the origin — used as the
// extruded footprint of the deck mesh (and the domino tile). Corners are TRUE CIRCULAR ARCS (absarc),
// not quadratic Béziers: a Bézier corner sits fuller/boxier than an arc of the same radius, so it
// wouldn't match the card art's rounded corner (baked as a circular-arc alpha via roundRect) or the
// alpha corner masks. Using the same arc everywhere makes the side wall's corner match the card on top.
function roundedRectShape(w, d, radius) {
  const shape = new THREE.Shape();
  const hw = w / 2,
    hd = d / 2,
    r = Math.max(0, Math.min(radius, hw, hd));
  const HALF_PI = Math.PI / 2;
  shape.moveTo(-hw + r, -hd);
  shape.lineTo(hw - r, -hd);
  shape.absarc(hw - r, -hd + r, r, -HALF_PI, 0, false); // bottom-right
  shape.lineTo(hw, hd - r);
  shape.absarc(hw - r, hd - r, r, 0, HALF_PI, false); // top-right
  shape.lineTo(-hw + r, hd);
  shape.absarc(-hw + r, hd - r, r, HALF_PI, Math.PI, false); // top-left
  shape.lineTo(-hw, -hd + r);
  shape.absarc(-hw + r, -hd + r, r, Math.PI, 3 * HALF_PI, false); // bottom-left
  return shape;
}

// Extrude a centred THREE.Shape (drawn in XY, bounds W×D) to `depth` along +Y, centred on the origin.
// Cap UVs are normalized so a face texture maps flat across the top/bottom bounds; material groups are
// split by face normal → 0 = top cap (front), 1 = bottom cap (back), 2 = the side walls (edge). Shared
// by every extruded tile so a rounded card, a domino, and a hexagon all build the same way.
function extrudeShape(shape, W, D, depth) {
  const uvGenerator = {
    generateTopUV(geometry, vertices, iA, iB, iC) {
      const uv = (i) =>
        new THREE.Vector2((vertices[i * 3] + W / 2) / W, (vertices[i * 3 + 1] + D / 2) / D);
      return [uv(iA), uv(iB), uv(iC)];
    },
    generateSideWallUV() {
      return [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(1, 0),
        new THREE.Vector2(1, 1),
        new THREE.Vector2(0, 1),
      ];
    },
  };
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    UVGenerator: uvGenerator,
  });
  geo.translate(0, 0, -depth / 2);
  geo.rotateX(-Math.PI / 2); // extrude direction Z → up (Y), centred
  const pos = geo.attributes.position;
  const A = new THREE.Vector3(),
    B = new THREE.Vector3(),
    C = new THREE.Vector3(),
    AB = new THREE.Vector3(),
    AC = new THREE.Vector3(),
    N = new THREE.Vector3();
  const tris = pos.count / 3;
  geo.clearGroups();
  let runStart = 0,
    runMat = -1;
  for (let t = 0; t < tris; t++) {
    // classify each triangle: +Y top, -Y bottom, else wall
    A.fromBufferAttribute(pos, t * 3);
    B.fromBufferAttribute(pos, t * 3 + 1);
    C.fromBufferAttribute(pos, t * 3 + 2);
    AB.subVectors(B, A);
    AC.subVectors(C, A);
    N.crossVectors(AB, AC).normalize();
    const mat = N.y > 0.5 ? 0 : N.y < -0.5 ? 1 : 2;
    if (mat !== runMat) {
      if (runMat >= 0) geo.addGroup(runStart * 3, (t - runStart) * 3, runMat);
      runStart = t;
      runMat = mat;
    }
  }
  geo.addGroup(runStart * 3, (tris - runStart) * 3, runMat);
  return geo;
}
// A rounded SOLID tile geometry (rounded vertical edges too, unlike a plain box): a rounded-rect
// footprint W×D extruded to `depth`, centred, thickness along Y.
function tileGeo(W, D, radius, depth) {
  return extrudeShape(roundedRectShape(W, D, radius), W, D, depth);
}
// A regular POINTY-TOP hexagon THREE.Shape, circumradius `r` (vertices point at top & bottom). After
// the extrude's rotateX its vertices land at world XZ angles ±30°/±90°/±150° — exactly where cannon's
// default 6-gon collider puts them, so mesh and collider match with no rotation. Height = 2r, width = r·√3.
function hexShape(r) {
  const s = HEX_HH * r; // half-width = r·√3/2
  const shape = new THREE.Shape();
  shape.moveTo(0, r);
  shape.lineTo(s, r / 2);
  shape.lineTo(s, -r / 2);
  shape.lineTo(0, -r);
  shape.lineTo(-s, -r / 2);
  shape.lineTo(-s, r / 2);
  shape.closePath();
  return shape;
}
// A regular pointy-top hexagonal prism (circumradius `r`, thickness `depth`), image on the caps.
function hexGeo(r, depth) {
  return extrudeShape(hexShape(r), r * 2 * HEX_HH, r * 2, depth);
}

// The deck mesh: a rounded footprint extruded upward, whose height scales with
// the card count. Custom UVs map the card-back texture flat across the top and
// tile the layer-line edge texture around the sides.
function deckMesh(props = {}) {
  const skin = props.model && DECK_MODELS[props.model];
  if (skin) {
    // a modeled deck skin (bag/box/pile): the .glb replaces the card stack
    return loadModelGroup(skin.model, { scale: skin.modelScale }, (node) => {
      node.castShadow = true;
      node.receiveShadow = true;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach((m) => {
        if (m) m.metalness = 0;
      }); // de-metal so the wood reads under the table lights
    });
  }

  const g = cardGeom(props); // a deck of tiles (dominoes) is shaped like its tiles
  // A deck IS a stack of its cards, so its footprint and corner are the card's exactly — the paper side
  // wall then hugs the card silhouette and its rounded corner is concentric with the card's on top,
  // instead of bulging past it (the old fixed +0.06 margin rounded off a wider box, so the side-wall
  // curve never matched a custom card's).
  const hex = g.shape === 'hex'; // a deck of hexagon cards is a hex stack
  const W = g.hw * 2,
    D = g.hh * 2;
  const radius = Math.min(g.round * W, W * 0.49, D * 0.49);

  const uvGenerator = {
    generateTopUV(geometry, vertices, indexA, indexB, indexC) {
      const uvForIndex = (i) =>
        new THREE.Vector2((vertices[i * 3] + W / 2) / W, (vertices[i * 3 + 1] + D / 2) / D);
      return [uvForIndex(indexA), uvForIndex(indexB), uvForIndex(indexC)];
    },
    generateSideWallUV() {
      return [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(1, 0),
        new THREE.Vector2(1, 1),
        new THREE.Vector2(0, 1),
      ];
    },
  };

  const geo = new THREE.ExtrudeGeometry(hex ? hexShape(g.hh) : roundedRectShape(W, D, radius), {
    depth: 1,
    bevelEnabled: false,
    UVGenerator: uvGenerator,
  });
  geo.translate(0, 0, -0.5);
  geo.rotateX(-Math.PI / 2); // extrude direction Z → up (Y), centred on the origin

  // The top/bottom caps carry the back art. For a rect deck, alpha-cut to the same rounded corner as
  // the card mesh (footprint matches, so radius/W == g.round) so a transparent corner is discarded, not
  // rendered as a dark chunk. For a hex deck the GEOMETRY is the silhouette, so just alpha-test the art.
  const back = hex
    ? new THREE.MeshStandardMaterial({
        map: resolveTexture(props.back),
        alphaTest: 0.5,
        roughness: 0.6,
      })
    : new THREE.MeshStandardMaterial({
        map: resolveTexture(props.back),
        alphaMap: roundMask(g.hw, g.hh, g.round),
        alphaTest: 0.4,
        roughness: 0.6,
      });
  const edge = new THREE.MeshStandardMaterial({ map: deckEdgeTex(), roughness: 0.85 });
  return new THREE.Mesh(geo, [back, edge]); // material group 0 = top/bottom caps, 1 = side walls
}

// Normalize an uploaded board so its footprint is BOARD_SIZE wide; returns
// { scale, box:[hx,hy,hz] } for the server-side collider.
function measureBoard(url) {
  return measureGlb(url).then(({ size }) => {
    const scale = BOARD_SIZE / (Math.max(size.x, size.z) || 1); // fit the X/Z footprint
    return { scale, box: [(size.x * scale) / 2, (size.y * scale) / 2, (size.z * scale) / 2] };
  });
}

// --- Procedural boards: a top texture drawn from data ------------------------
// The reusable procedural-board framework. A BOARDS entry with `proc: <name>` is painted by the
// matching function here from its `paint` spec — no art file. Add a painter + a BOARDS entry and a
// new grid / premium / battlemap board travels the same swapBoard/collider/calibrateGrid plumbing.
function drawStar(ctx, cx, cy, outer, inner, points) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer,
      a = (Math.PI * i) / points - Math.PI / 2;
    ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
}
// Wordy McWordface board: a cells×cells grid with coloured premium squares (from WORDY_PREMIUM /
// WORDY_COLORS via the board's `paint`). The texture is divided into equal cells, so its squares line
// up 1:1 with the snap grid (calibrateGrid derives cell = board width ÷ cells).
function wordGridTex(paint = {}) {
  const cells = paint.cells || 15,
    prem = paint.premium || [],
    col = paint.colors || {};
  const px = 900,
    cell = px / cells;
  const { canvas, ctx } = makeCanvas(px, px);
  ctx.fillStyle = col.base || '#e9ddc2';
  ctx.fillRect(0, 0, px, px);
  const fillFor = { T: col.T, D: col.D, t: col.t, d: col.d, '*': col.star || col.D };
  const label = { T: 'TW', D: 'DW', t: 'TL', d: 'DL' };
  for (let r = 0; r < cells; r++) {
    const row = prem[r] || '';
    for (let c = 0; c < cells; c++) {
      const ch = row[c] || '.',
        x = c * cell,
        y = r * cell;
      if (fillFor[ch]) {
        ctx.fillStyle = fillFor[ch];
        ctx.fillRect(x, y, cell, cell);
      }
      if (ch === '*') {
        ctx.fillStyle = col.ink || '#2c2115';
        drawStar(ctx, x + cell / 2, y + cell / 2, cell * 0.3, cell * 0.14, 5);
      } else if (label[ch]) {
        ctx.fillStyle = 'rgba(44,33,21,0.72)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `700 ${Math.round(cell * 0.24)}px system-ui, sans-serif`;
        ctx.fillText(label[ch], x + cell / 2, y + cell / 2);
      }
    }
  }
  ctx.strokeStyle = col.line || '#c3b184';
  ctx.lineWidth = Math.max(1, px / 600);
  for (let i = 0; i <= cells; i++) {
    const p = Math.round(i * cell) + 0.5;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, px);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(px, p);
    ctx.stroke();
  }
  return cTex(canvas);
}
const BOARD_PAINTERS = { wordgrid: wordGridTex };
// A data-URL preview of a procedural board's top, for the library (proc boards have no .glb to snapshot).
export function procBoardTexURL(key) {
  const b = BOARDS[key];
  if (!b || !b.proc) return null;
  const ck = 'proc:' + key;
  if (_prevCache.has(ck)) return _prevCache.get(ck);
  const painter = BOARD_PAINTERS[b.proc];
  if (!painter) return null;
  const tex = painter(b.paint || {});
  const url =
    tex && tex.image && tex.image.toDataURL ? tex.image.toDataURL('image/jpeg', 0.85) : null;
  if (url) rememberPreview(ck, url);
  return url;
}

// The board mesh: a built-in/uploaded .glb model, a procedural board, or a plain textured slab.
function boardMesh(props = {}) {
  const builtin = props.board && BOARDS[props.board]; // a built-in model board
  const modelUrl = builtin ? builtin.model : props.model; // or an uploaded .glb board

  if (modelUrl) {
    // centre at origin (the server sits it on the table by half-height)
    return loadModelGroup(
      modelUrl,
      { scale: builtin ? builtin.modelScale : props.modelScale || 1 },
      (node) => {
        node.receiveShadow = true;
        node.castShadow = false;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach((m) => {
          if (m) m.metalness = 0;
        }); // de-metal so the board's own colors read
      },
    );
  }

  if (builtin && builtin.proc) {
    // a procedural board: a slab sized by its box, top painted from data
    const [hx, hy, hz] = builtin.box;
    const painter = BOARD_PAINTERS[builtin.proc];
    const map = painter ? painter(builtin.paint || {}) : boardTex();
    const top = new THREE.MeshStandardMaterial({ map, roughness: 0.85 });
    const edge = new THREE.MeshStandardMaterial({ color: COLORS.boardEdge });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), [
      edge,
      edge,
      top,
      edge,
      edge,
      edge,
    ]);
    mesh.receiveShadow = true;
    return mesh;
  }

  // A plain procedural board: a textured slab.
  const w = props.w || 8,
    d = props.d || 8;
  let map = boardTex();
  if (props.tex) map = loadImageTexture(props.tex); // a full uploaded image, stretched across the top
  const top = new THREE.MeshStandardMaterial({ map, roughness: 0.8 });
  const edge = new THREE.MeshStandardMaterial({ color: COLORS.boardEdge });
  return new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), [edge, edge, top, edge, edge, edge]);
}

// --- Dispensers: a body that hands out copies of a child piece --------------
// 'stack' clones the item's .glb up the Y axis (poker chips / coins), tinted and
// count-scaled; 'model' loads a bowl .glb and tints its interior slot to the team
// A material name matches a tint slot if it equals the slot OR is a Blender-style
// duplicate of it ("c1.001", "c1.002") — one logical slot can split across meshes on
// export, so tinting must catch every copy, not just the first.
const isTintSlot = (name, slot) =>
  !!slot && typeof name === 'string' && (name === slot || name.startsWith(slot + '.'));

// A small stable number from a dispenser's id, to seed its stack's facing jitter so two
// otherwise-identical stacks don't face the same way. Any missing id → 0 (a fixed but
// valid scramble). Reduced to a mid-range float to keep the sin() in spin() well-behaved.
function stackSeed(id) {
  let h = 2166136261 >>> 0;
  const s = id == null ? '' : String(id);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (((h >>> 0) % 9973) / 9973) * 1000;
}

// Parsed stack item models, keyed by item shape. The first build loads the .glb
// async; every rebuild after (a dispense changes count → the mesh is rebuilt) clones
// from the cached scene SYNCHRONOUSLY, so the stack never blinks out while a reload
// resolves. Stored raw/unpainted — each build clones, fits, and tints its own copy.
const _stackProto = new Map();

// color. `props` carries { disp, color?, team?, count?, _seed? } (_seed = the piece id,
// stamped by meshPropsOf, seeds the stack's facing jitter; absent → a fixed scramble).
function dispenserMesh(props = {}) {
  const spec = DISPENSERS[props.disp];
  if (!spec) return new THREE.Group();
  const matte = (color, side) =>
    new THREE.MeshStandardMaterial({ color, metalness: 0, roughness: 0.6, side });

  if (spec.body === 'model') {
    const tint = spec.team
      ? COLORS.team[spec.team][props.team ? 1 : 0]
      : spec.color
        ? (props.color ?? null)
        : null;
    const paint = (m) => {
      // A named slot preserves the rest of the model's baked materials (Go bowl); without one,
      // a colorable model dispenser takes the picked color across the whole model (train stack).
      if (tint != null && (!spec.tintMaterial || isTintSlot(m.name, spec.tintMaterial)))
        return matte(tint, m.side);
      m.metalness = 0;
      return m; // shell keeps its baked look
    };
    return loadModelGroup(spec.model, { target: MODEL_SIZE * (spec.modelScale || 1) }, (node) => {
      if (!node.material) return;
      node.castShadow = true;
      node.receiveShadow = true;
      node.material = Array.isArray(node.material)
        ? node.material.map(paint)
        : paint(node.material);
    });
  }

  // 'stack' — load the item model once, paint it like a spawned item, clone up Y.
  const item = PROPS[spec.item] || {};
  const discH = stackDiscH(spec.item);
  const n = stackVisible(props.count ?? spec.count.def);
  const tint = props.color ?? null;
  const paint = (m) => {
    if (item.tintMaterial) {
      if (tint != null && isTintSlot(m.name, item.tintMaterial))
        return itemSurface(item, tint, m.side);
      m.metalness = 0;
      return m;
    }
    if (item.ownMaterial) {
      m.metalness = 0;
      return m;
    }
    return tint != null ? itemSurface(item, tint, m.side) : m;
  };
  // Per-disc facing jitter so a chip stack looks tumbled, not machine-aligned.
  // Deterministic in (index, seed): a given disc keeps its angle as the stack grows or
  // shrinks (dealing just drops the top disc — the rest don't reshuffle), and the seed
  // (the piece id) makes two identical stacks side by side face differently.
  const seed = stackSeed(props._seed);
  const spin = (i) => {
    const x = Math.sin((i + 1) * 127.1 + seed) * 43758.5453;
    return (x - Math.floor(x)) * Math.PI * 2;
  };
  const group = new THREE.Group();
  const fill = (rawScene) => {
    // build the stack from a cached raw scene
    const proto = rawScene.clone(true);
    fitModel(proto, { scale: item.modelScale || 1 }); // centre + scale, matching a spawned item
    proto.traverse((node) => {
      if (!node.isMesh || !node.material) return;
      node.castShadow = true;
      node.receiveShadow = true;
      node.material = Array.isArray(node.material)
        ? node.material.map(paint)
        : paint(node.material);
    });
    for (let i = 0; i < n; i++) {
      const clone = proto.clone(true); // shares geometry/material — cheap
      clone.position.y = (i - (n - 1) / 2) * discH; // centred stack, discs flush
      clone.rotation.y = spin(i); // tumbled facing (see spin above)
      group.add(clone);
    }
  };
  const cached = _stackProto.get(spec.item);
  if (cached)
    fill(cached); // rebuild path: synchronous, no blink
  else
    gltfLoader.load(
      item.model,
      (gltf) => {
        _stackProto.set(spec.item, gltf.scene);
        fill(gltf.scene);
      },
      undefined,
      () => {},
    );
  return group;
}

// --- KIND registry: the client-side half of each piece kind -----------------
// mesh:            builder for its Three.js mesh.
// grab:            which mouse button moves it (0 = left, 2 = right).
// ldrag:           a special left-drag action (message name).
// lclick / rclick: click actions (message names).
// Adding a kind = one entry here + one in the shared KINDS descriptor.
const KIND = {
  die: { mesh: dieMesh, grab: 0, rclick: 'roll' },
  card: { mesh: cardMesh, grab: 0, lclick: 'takeCard', rclick: 'flip' },
  prop: { mesh: propMesh, grab: 0 },
  deck: { mesh: deckMesh, grab: 2, ldrag: 'deal', lclick: 'drawToHand', rclick: 'shuffle' }, // left-click → top card to your hand; left-drag → deal to table
  board: { mesh: boardMesh },
  dispenser: { mesh: dispenserMesh, grab: 2, ldrag: 'dispense', lclick: 'dispense' }, // right-drag moves; left dispenses one
};

// ---- Table grid: a flat line grid on the felt (snap-to-grid, Phase 2) --------
// Lines on cell multiples through the world origin (matching snapToCell, whose cell
// CENTRES sit half a cell between them), spanning the whole table. Built flat at y=0;
// the client lifts it just above the felt. Colour is GM-set (`scale.gridColor`) so it
// reads on any felt. Returns null when there's no grid to draw. Square only for now.
export function gridMesh(scale = {}, tableX = TABLE.x, tableZ = TABLE.z) {
  if (!gridActive(scale) || scale.gridStyle !== 'square' || scale.gridHidden) return null; // hidden: still snaps, just not drawn
  const cell = +scale.cellWorld,
    hx = +tableX,
    hz = +tableZ;
  const cz = +scale.cellZ > 0 ? +scale.cellZ : cell; // rectangular grids: separate depth spacing
  const ox = +scale.gridX || 0,
    oz = +scale.gridZ || 0; // lattice offset (align to a printed map)
  if (!(cell > 0) || !(hx > 0) || !(hz > 0)) return null;
  if ((hx / cell) * 2 > 300 || (hz / cz) * 2 > 300) return null; // sanity cap: skip a hair-fine grid (perf)
  const pts = [];
  for (let m = Math.ceil((-hx - ox) / cell); m <= Math.floor((hx - ox) / cell); m++) {
    // constant-x lines, spaced by cell
    const x = ox + m * cell;
    pts.push(x, 0, -hz, x, 0, hz);
  }
  for (let m = Math.ceil((-hz - oz) / cz); m <= Math.floor((hz - oz) / cz); m++) {
    // constant-z lines, spaced by cz
    const z = oz + m * cz;
    pts.push(-hx, 0, z, hx, 0, z);
  }
  const color = /^#[0-9a-f]{6}$/i.test(scale.gridColor || '') ? scale.gridColor : '#ffffff';
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.renderOrder = 2; // over the felt, under floating labels; pieces still occlude it (depthTest on)
  return lines;
}

// ---- Dice tray: the visual box (floor + 4 walls), matching the server's physics ----
// Built from the SAME trayParts() the collider uses, in tray-LOCAL space, so the mesh and the
// walls line up exactly. The client parks the group at the tray's track position and rotates
// it by the tray angle (Three's rotation.y matches the server's trayPlace transform).
function trayMesh(feltColor) {
  const g = new THREE.Group();
  const felt = new THREE.MeshStandardMaterial({
    color: feltColor || 0x2f6b4f,
    roughness: 0.85,
    metalness: 0,
  });
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3b2a, roughness: 0.8, metalness: 0 });
  trayParts().forEach((p, i) => {
    if (p.noMesh) return; // the lid is a physics-only cap — never drawn, or it'd block the top-down view
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(p.hx * 2, p.hy * 2, p.hz * 2),
      i === 0 ? felt : wood,
    );
    m.position.set(p.x, p.y, p.z);
    m.castShadow = i !== 0;
    m.receiveShadow = true;
    g.add(m);
  });
  return g;
}

// ---- Overlays: flat, non-physics annotations (measurement + templates) ------
// A registry parallel to KIND: each kind builds a THREE.Group in table-space (XZ,
// at y=0; the client lifts it just above the felt). The distance LABEL is a sprite
// the client owns (it needs the room's scale + formatMeasure). A new overlay kind
// is one entry here + one server-side kind string — the sync/interaction is generic.
function overlayBar(ax, az, bx, bz, color, thick = 0.06) {
  const dx = bx - ax,
    dz = bz - az,
    len = Math.hypot(dx, dz) || 0.0001;
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const g = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.02, thick), mat);
  bar.position.set((ax + bx) / 2, 0, (az + bz) / 2);
  bar.rotation.y = Math.atan2(-dz, dx); // align the bar's +X along A→B
  g.add(bar);
  for (const [px, pz] of [
    [ax, az],
    [bx, bz],
  ]) {
    // small end dots mark the two points
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(thick, thick, 0.03, 12), mat);
    cap.position.set(px, 0, pz);
    g.add(cap);
  }
  return g;
}
function rulerMesh(o) {
  return overlayBar(o.x, o.z, o.x2, o.z2, o.color);
}

// Template materials: a faint interior FILL and a solid EDGE, both flat and
// unlit like the ruler bar. Fill opacity + edge weight are client-feel tunables
// (CONFIG.measure); DoubleSide so a template reads from under the table too.
function overlayFill(color) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: CONFIG.measure.fill,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
function overlayEdge(color) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// A flat pie-slice in the XZ plane: apex at the origin, bisector along +X,
// spanning ±half out to radius L. Built directly flat (every y = 0) so a single
// rotation.y aims it — the same trick overlayBar uses to avoid tilt composition.
function sectorGeometry(L, half, seg = 40) {
  const pos = [],
    step = (2 * half) / seg;
  for (let i = 0; i < seg; i++) {
    const t0 = -half + step * i,
      t1 = -half + step * (i + 1);
    pos.push(0, 0, 0, Math.cos(t0) * L, 0, Math.sin(t0) * L, Math.cos(t1) * L, 0, Math.sin(t1) * L);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

// circle: a burst radius. Origin A, radius = |A→B|. Faint filled disc + a solid
// ring outline. (Label — the radius — is the client's sprite, like every kind.)
function circleTemplate(o) {
  const r = Math.hypot(o.x2 - o.x, o.z2 - o.z) || 0.0001;
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 64), overlayFill(o.color));
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(o.x, 0, o.z);
  g.add(disc);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(Math.max(0, r - CONFIG.measure.edge), r, 64),
    overlayEdge(o.color),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(o.x, 0.002, o.z); // lift the rim off the disc to avoid z-fighting
  g.add(ring);
  return g;
}

// cone: a flat sector. Apex A, facing A→B, length = |A→B|, half-angle o.ang
// (default MEASURE.coneAngle). rotation.y aims the +X bisector down A→B.
function coneTemplate(o) {
  const dx = o.x2 - o.x,
    dz = o.z2 - o.z,
    L = Math.hypot(dx, dz) || 0.0001;
  const half = o.ang > 0 ? o.ang : MEASURE.coneAngle;
  const sector = new THREE.Mesh(sectorGeometry(L, half), overlayFill(o.color));
  sector.position.set(o.x, 0, o.z);
  sector.rotation.y = Math.atan2(-dz, dx); // +X bisector along A→B (overlayBar's convention)
  const g = new THREE.Group();
  g.add(sector);
  return g;
}

// line: a width×length lane. From A toward B, length = |A→B|, width o.w
// (default MEASURE.lineWidth). A faint band plus a solid centre line for read.
function lineTemplate(o) {
  const dx = o.x2 - o.x,
    dz = o.z2 - o.z,
    L = Math.hypot(dx, dz) || 0.0001;
  const w = o.w > 0 ? o.w : MEASURE.lineWidth;
  const band = new THREE.Mesh(new THREE.BoxGeometry(L, 0.02, w), overlayFill(o.color));
  band.position.set((o.x + o.x2) / 2, -0.005, (o.z + o.z2) / 2); // just under the centre line (avoid z-fight)
  band.rotation.y = Math.atan2(-dz, dx); // long axis along A→B
  const g = new THREE.Group();
  g.add(band);
  g.add(overlayBar(o.x, o.z, o.x2, o.z2, o.color, 0.04)); // the centre line
  return g;
}

// A registry parallel to KIND (see the block above): kind → mesh builder. Adding
// an overlay kind is one entry here + one string in the server's OVERLAY_KINDS.
const OVERLAY = {
  ruler: { build: rulerMesh },
  circle: { build: circleTemplate },
  cone: { build: coneTemplate },
  line: { build: lineTemplate },
};

// ---- Library preview thumbnails (editor) -----------------------------------
// A tiny offscreen renderer that snapshots a mesh/model to a PNG data-URL, so the
// library can show a picture of each asset. Card faces don't need it — they draw
// straight to a 2D canvas (see cardPreviewURL). Results are cached by a key.
let _thumb = null;
function thumbRig() {
  if (_thumb) return _thumb;
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(220, 220);
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 1.15);
  key.position.set(4, 6, 5);
  scene.add(key);
  const cam = new THREE.PerspectiveCamera(32, 1, 0.01, 5000);
  _thumb = { renderer, scene, cam };
  return _thumb;
}
// Free a loaded model's GPU resources once it's been snapshotted for a library thumbnail. The
// gltfLoader is uncached, so each preview owns its scene outright — disposing it can't affect a
// piece placed on the table (those do their own load). Only the 220px data-URL is retained.
function disposeHierarchy(root) {
  root.traverse((n) => {
    if (n.geometry) n.geometry.dispose();
    const mats = Array.isArray(n.material) ? n.material : n.material ? [n.material] : [];
    for (const m of mats) {
      for (const key in m) {
        const val = m[key];
        if (val && val.isTexture) val.dispose();
      }
      m.dispose();
    }
  });
}
function snapshot(obj) {
  const { renderer, scene, cam } = thumbRig();
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return null;
  const size = box.getSize(new THREE.Vector3()),
    center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  obj.position.sub(center); // centre it at the origin
  scene.add(obj);
  const d = maxDim * 2.4;
  cam.position.set(d * 0.85, d * 0.72, d);
  cam.lookAt(0, 0, 0);
  cam.near = maxDim / 100;
  cam.far = maxDim * 40;
  cam.updateProjectionMatrix();
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(obj);
  return url;
}

const _prevCache = new Map();
const PREV_CACHE_CAP = 160; // preview data-URLs (JS strings, ~10-20KB each) — FIFO-evict oldest
function rememberPreview(key, url) {
  if (_prevCache.size >= PREV_CACHE_CAP) {
    const oldest = _prevCache.keys().next().value;
    if (oldest !== undefined) _prevCache.delete(oldest);
  }
  _prevCache.set(key, url);
}
// A card ref → preview image URL. Image refs pass straight through; procedural refs
// (back / rank: / text: / tback:) are drawn to a canvas and returned as a data-URL.
export function cardPreviewURL(ref) {
  const r = ref || 'back';
  if (r.startsWith('/') || r.startsWith('http') || r.startsWith('data:')) return r;
  if (_prevCache.has(r)) return _prevCache.get(r);
  const wasCached = _texCache.has(r); // already resident for a placed piece?
  const tex = resolveTexture(r);
  const url =
    tex && tex.image && tex.image.toDataURL ? tex.image.toDataURL('image/jpeg', 0.85) : null;
  if (!wasCached && tex) {
    // Built only to snapshot — don't leave a GPU texture behind. A later placement rebuilds on
    // demand; if a piece was already using it, wasCached is true and we leave it alone.
    _texCache.delete(r);
    tex.dispose();
  }
  if (url) rememberPreview(r, url);
  return url;
}
// A prop (a .glb in the library, or a built-in shape) → a rendered thumbnail data-URL.
export async function propPreviewURL(props = {}) {
  const spec = PROPS[props.shape] || {};
  const modelUrl = props.model || spec.model;
  const key = modelUrl ? 'm:' + modelUrl : 's:' + props.shape + ':' + (props.color ?? '');
  if (_prevCache.has(key)) return _prevCache.get(key);
  let url = null;
  try {
    if (modelUrl) {
      const gltf = await gltfLoader.loadAsync(modelUrl);
      url = snapshot(gltf.scene);
      disposeHierarchy(gltf.scene);
    } else url = snapshot(propShapeMesh(props));
  } catch (e) {
    /* leave null → the card shows a placeholder */
  }
  if (url) rememberPreview(key, url);
  return url;
}
// A board preview: an image URL passes through; a .glb is rendered; else null.
export async function boardPreviewURL(fileUrl) {
  if (!fileUrl) return null;
  const key = 'b:' + fileUrl;
  if (_prevCache.has(key)) return _prevCache.get(key);
  let url = null;
  if (/\.glb$/i.test(fileUrl)) {
    try {
      const gltf = await gltfLoader.loadAsync(fileUrl);
      url = snapshot(gltf.scene);
      disposeHierarchy(gltf.scene);
    } catch (e) {
      /* null */
    }
  } else url = fileUrl; // an image URL (jpg/png/webp…)
  if (url) rememberPreview(key, url);
  return url;
}

// A built-in die (d4…d20) → a rendered thumbnail data-URL. Synchronous (no load).
// A pipped-die model preview (async): load the .glb, tint with the default die colors, snapshot.
// Cached like the other previews. Returns null on failure (the card shows a placeholder).
export async function dieModelPreviewURL(key) {
  const dm = DICE_MODELS[key];
  if (!dm) return null;
  const cacheKey = 'diemodel:' + key;
  if (_prevCache.has(cacheKey)) return _prevCache.get(cacheKey);
  let url = null;
  try {
    const gltf = await gltfLoader.loadAsync(dm.model);
    gltf.scene.traverse((n) => {
      if (!n.isMesh || !n.material) return;
      const paint = (m) =>
        new THREE.MeshStandardMaterial({
          color: m.name === 'Dots' ? 0x141414 : 0xf4f1ea,
          metalness: 0,
          roughness: 0.5,
        });
      n.material = Array.isArray(n.material) ? n.material.map(paint) : paint(n.material);
    });
    url = snapshot(gltf.scene);
    disposeHierarchy(gltf.scene);
  } catch (e) {
    /* leave null → placeholder */
  }
  if (url) rememberPreview(cacheKey, url);
  return url;
}

export function diePreviewURL(sides, finish) {
  const key = 'd:' + sides + (finish ? ':' + finish : '');
  if (_prevCache.has(key)) return _prevCache.get(key);
  let url = null;
  try {
    url = snapshot(dieMesh({ sides, finish }));
  } catch (e) {
    /* null → placeholder */
  }
  if (url) rememberPreview(key, url);
  return url;
}

// A local (not-yet-uploaded) .glb File → a rendered thumbnail data-URL, for previews.
export async function glbFilePreviewURL(file, rot) {
  const url = URL.createObjectURL(file);
  try {
    const gltf = await gltfLoader.loadAsync(url);
    if (rot) gltf.scene.rotation.set(rot[0], rot[1], rot[2]);
    const out = snapshot(gltf.scene);
    disposeHierarchy(gltf.scene);
    return out;
  } catch (e) {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---- Player / UI textures (seat markers, name tags, the "YOU" chip) ---------
// Procedural canvas textures for the table's player chrome. Kept here with the
// other canvas texture builders; the client owns their placement in the scene.

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

// A standing seat-marker texture: a colored card with the player's avatar (or a
// default silhouette) clipped to a circle, their name, and a "SHOWING n" badge
// while they're revealing cards. Redrawn once the avatar image loads.
function makePlayerTexture(player) {
  const width = 256,
    height = 320;
  const { canvas, ctx } = makeCanvas(width, height);

  const draw = (img) => {
    ctx.clearRect(0, 0, width, height);
    // Card-ish background with a border tinted in the player's color.
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
      ctx.beginPath();
      ctx.arc(width / 2, 104, 34, 0, 7);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(width / 2, 210, 62, 52, 0, Math.PI, 0);
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = player.color;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(width / 2, 120, 78, 0, 7);
    ctx.stroke();
    // Name.
    ctx.fillStyle = '#e8e6e0';
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText((player.name || 'Player').slice(0, 14), width / 2, 270);
    if (player.showing > 0) {
      // public "is revealing cards" badge — count only, never the content
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
  if (player.avatar) {
    const img = new Image();
    img.onload = () => draw(img);
    img.src = player.avatar;
  }
  return tex;
}

// A small floating name-tag texture: translucent pill, border in the player's
// color, their name centred. Shown over a piece while someone else holds it.
function nameTag(name, color) {
  const width = 256,
    height = 80;
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

// A flat "YOU" chip texture, laid on the felt at your own seat.
function makeYouChipTexture(color) {
  const { canvas, ctx } = makeCanvas(128, 128);
  ctx.clearRect(0, 0, 128, 128);
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, 7);
  ctx.fillStyle = 'rgba(20,24,29,0.5)';
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = 'bold 42px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('YOU', 64, 66);
  return cTex(canvas);
}

export {
  KIND,
  OVERLAY,
  trayMesh,
  makeCanvas,
  cTex,
  cardMesh,
  propColor,
  measureModel,
  measureBoard,
  resizeToCanvas,
  splitColorText,
  uploadImage,
  uploadModel,
  measureImage,
  makePlayerTexture,
  nameTag,
  makeYouChipTexture,
};
