import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG, renderer } from './core.js';
import { KINDS as PHYS, PROPS, COLORS, DECK_VISUAL, CARD_ROUND, dieVerts, DIE_RADIUS, BOARDS, BOARD_SIZE, MEASURE, DISPENSERS, stackDiscH, stackVisible } from '/shared/pieces.js';

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
// and large in the middle. `color` is the suit colour (black or red).
function cardFront(rank, suit, color) {
  const S = 2, w = 300, h = 420;
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

  ctx.save(); ctx.translate(34, 52); drawIndex(); ctx.restore();                                // top-left
  ctx.save(); ctx.translate(w - 34, h - 52); ctx.rotate(Math.PI); drawIndex(); ctx.restore();   // bottom-right, rotated 180°

  ctx.font = 'bold 140px Georgia';
  ctx.fillText(rank, w / 2, h / 2 + 56); // big centre rank
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
  const squares = 8, size = CONFIG.tex.board;
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
  const w = 4, h = 256;
  const { canvas, ctx } = makeCanvas(w, h);

  ctx.fillStyle = '#' + COLORS.deckEdge.toString(16).padStart(6, '0'); // paper base colour
  ctx.fillRect(0, 0, w, h);
  ctx.lineWidth = 1;
  for (let y = 2; y < h; y += 4) {
    // Alternate a shadow line and a highlight line to fake stacked paper layers.
    ctx.strokeStyle = (y % 8 < 4) ? 'rgba(120,108,90,0.75)' : 'rgba(255,255,255,0.22)';
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
const _digitTex = new Map(), _faceTex = new Map();

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
function numberFaceTexture(value, body, text) {
  const def = body == null && text == null;                 // the shared, cached ivory face
  if (def && _faceTex.has(value)) return _faceTex.get(value);
  const size = CONFIG.tex.die;
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = body != null ? hexOf(body) : COLORS.ivory;
  ctx.fillRect(0, 0, size, size);
  drawNumber(ctx, size, value, text != null ? hexOf(text) : null);
  const texture = cTex(canvas);
  if (def) _faceTex.set(value, texture);                    // only the default is cached (custom faces are per-die)
  return texture;
}

// A flat plane showing one die number, for laying onto a polyhedron's face.
function numberLabel(value, size, text) {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: digitTexture(value, text), transparent: true, depthWrite: false }),
  );
}

// Build a numbered polyhedral die: a convex mesh plus one number laid flat on
// each face. ConvexGeometry gives us triangles, so we recover the real polygon
// faces by grouping triangles that share a normal (same trick as the server's
// collider), then drop a numbered label at each face's centre.
function convexDie(sides, color, textColor) {
  const points = dieVerts(sides, DIE_RADIUS[sides] || 1).map(v => new THREE.Vector3(v[0], v[1], v[2]));
  const geo = new ConvexGeometry(points);
  const die = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: color ?? COLORS.ivory, roughness: 0.45, flatShading: true }));
  die.castShadow = true;
  die.receiveShadow = true;

  const group = new THREE.Group();
  group.add(die);

  // Group the mesh's triangles into faces by shared normal.
  const pos = geo.getAttribute('position');
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), normal = new THREE.Vector3();
  const faces = [];
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    normal.crossVectors(ab, ac).normalize();

    let face = faces.find(f => f.normal.dot(normal) > 0.999);
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
    verts.forEach(v => centroid.add(v));
    centroid.multiplyScalar(1 / verts.length);

    let circumRadius = 0;
    verts.forEach(v => circumRadius = Math.max(circumRadius, v.distanceTo(centroid)));
    const inRadius = circumRadius * Math.cos(Math.PI / verts.length);

    const label = numberLabel(index + 1, inRadius * 1.25, textColor);
    label.position.copy(centroid).addScaledVector(face.normal, 0.015); // float just above the surface
    label.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), face.normal);
    group.add(label);
  });
  return group;
}

// A d4 is read by its top vertex, not a top face — so each of the 4 vertices
// carries a number, printed at that corner on all three faces touching it.
function numberedD4(color, textColor) {
  const verts = dieVerts(4, DIE_RADIUS[4]).map(v => new THREE.Vector3(v[0], v[1], v[2]));
  const geo = new ConvexGeometry(verts);
  const die = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: color ?? COLORS.ivory, roughness: 0.45, flatShading: true }));
  die.castShadow = true;
  die.receiveShadow = true;

  const group = new THREE.Group();
  group.add(die);

  // Which vertex number (1..4) a given corner is — the nearest of the 4 verts.
  const vertexNumber = (corner) => {
    let best = 0, bestDist = 1e9;
    verts.forEach((v, i) => {
      const dist = v.distanceTo(corner);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    return best + 1;
  };

  const pos = geo.getAttribute('position');
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), normal = new THREE.Vector3();
  const right = new THREE.Vector3(), up = new THREE.Vector3(), basis = new THREE.Matrix4();

  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    normal.crossVectors(ab, ac).normalize();

    const centroid = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3);
    const circumRadius = Math.max(a.distanceTo(centroid), b.distanceTo(centroid), c.distanceTo(centroid));

    // One label per corner of this face, oriented so the digit points outward
    // toward its own vertex (that's why each number appears three times).
    for (const corner of [a, b, c]) {
      const label = numberLabel(vertexNumber(corner), circumRadius * 0.55, textColor);
      up.subVectors(corner, centroid).normalize();
      right.crossVectors(up, normal).normalize();
      up.crossVectors(normal, right).normalize();
      basis.makeBasis(right, up, normal);
      label.quaternion.setFromRotationMatrix(basis);
      label.position.copy(corner).lerp(centroid, 0.30).addScaledVector(normal, 0.015);
      group.add(label);
    }
  }
  return group;
}

// Collider box half-extents for a kind, shared with the server's shape descriptor.
const halfExtents = (type) => PHYS[type].shape.box;

// Resolve a texture REFERENCE (a short string) to a THREE texture, cached:
//   'back'                    → the procedural classic card back
//   'rank:A:♠:#000'           → a procedural playing-card face
//   'text:[#col:][#bg:]words' → a procedural text card face
//   'tback:color:[#tc:]words' → a procedural text card back
//   'data:...' or a URL       → a loaded image (uploaded card art or a file)
const _texCache = new Map(), _texLoader = new THREE.TextureLoader();

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
  if (ref.startsWith('text:')) {
    const [color, r1] = splitColorText(ref.slice(5), COLORS.ink);
    const [bg, r2] = splitColorText(r1, '#fbfbf7');
    const [accent, text] = splitColorText(r2, '#ddd'); // 4th colour optional (border); default on old refs
    return { kind: 'text', color, bg, accent, text };
  }
  if (ref.startsWith('tback:')) {
    const [bg, r1] = splitColorText(ref.slice(6), '#7d2b2b');
    const [textColor, r2] = splitColorText(r1, '#f4f1ea');
    const [accent, text] = splitColorText(r2, 'rgba(255,255,255,.45)'); // 4th colour optional; default on old refs
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
  else if (parsed.kind === 'text') texture = textFaceTexture(parsed.text, parsed.color, parsed.bg, parsed.accent);
  else if (parsed.kind === 'tback') texture = textBackTexture(parsed.bg, parsed.text, parsed.textColor, parsed.accent);
  else texture = loadImageTexture(parsed.ref);

  _texCache.set(ref, texture);
  return texture;
}

// Split "color:rest" when the prefix is a hex colour; otherwise return the
// default colour and the whole string unchanged.
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
  const overflows = () => lines.length * fontSize * 1.25 > h - pad * 2 || lines.some((l) => ctx.measureText(l).width > w - pad * 2);
  while (overflows() && fontSize > 8) {
    fontSize -= 2;
    ctx.font = `${weight} ${fontSize}px system-ui,sans-serif`;
    lines = wrapLines(ctx, text, w - pad * 2);
  }

  const lineHeight = fontSize * 1.25;
  let y = h / 2 - (lines.length - 1) * lineHeight / 2;
  for (const line of lines) {
    ctx.fillText(line, w / 2, y);
    y += lineHeight;
  }
}

// A procedural card FACE showing wrapped text (for custom text decks).
function textFaceTexture(text, color, bg, accent) {
  const S = 2, w = 300, h = 420;
  const { canvas, ctx } = makeCanvas(w * S, h * S);
  ctx.scale(S, S); // render at 2× so text stays crisp when a card is near the camera (draw in logical 300×420)

  ctx.fillStyle = bg || '#fbfbf7';
  ctx.fillRect(0, 0, w, h);
  const inset = 6, r = Math.max(0, CARD_ROUND * w - inset); // rounded frame, following the card's corners
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
  const w = 256, h = 358;
  const { canvas, ctx } = makeCanvas(w, h);

  ctx.fillStyle = color || '#7d2b2b';
  ctx.fillRect(0, 0, w, h);
  const inset = 8, r = Math.max(0, CARD_ROUND * w - inset); // rounded frame, following the card's corners
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
        const drawW = img.width * scale, drawH = img.height * scale;
        ctx.drawImage(img, (w - drawW) / 2, (h - drawH) / 2, drawW, drawH);
      } else {
        // Cover-fit: scale up to fill, centre, and let the overflow crop.
        const scale = Math.max(w / img.width, h / img.height);
        const drawW = img.width * scale, drawH = img.height * scale;
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
  return resizeToCanvas(file, w, h, fit, bg)
    .then(canvas => new Promise(resolve => canvas.toBlob(blob => resolve(blob), CONFIG.upload.type, CONFIG.upload.quality)));
}

// POST a body to an upload endpoint with the auth token; return the stored URL ref.
// (The raw token read here is auth plumbing that really belongs in a shared api
// helper — parked with the cross-file util-module refactor.)
async function postUpload(path, contentType, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': contentType, 'Authorization': 'Bearer ' + (localStorage.getItem('tabletop.token') || '') },
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
  return new Promise((resolve, reject) => gltfLoader.load(url, gltf => {
    if (rot) { gltf.scene.rotation.set(rot[0], rot[1], rot[2]); gltf.scene.updateMatrixWorld(true); } // measure the reoriented model
    const box = new THREE.Box3().setFromObject(gltf.scene);
    resolve({ size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()) });
  }, undefined, reject));
}

// Centre a loaded model at the origin, then scale it — either by a fixed factor
// (opts.scale) or by normalizing its largest dimension to opts.target. Returns
// the scale that was applied.
function fitModel(obj, opts) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const scale = opts.scale != null ? opts.scale : (opts.target / (Math.max(size.x, size.y, size.z) || 1));
  obj.scale.setScalar(scale);
  obj.position.copy(center).multiplyScalar(-scale);
  return scale;
}

// The normalized collider half-extents [hx, hy, hz] for an uploaded model prop.
function measureModel(url, scale = 1, rot) {
  return measureGlb(url, rot).then(({ size }) => {
    const normScale = MODEL_SIZE * scale / (Math.max(size.x, size.y, size.z) || 1);
    return [size.x * normScale / 2, size.y * normScale / 2, size.z * normScale / 2];
  });
}

// Resize one image and POST it; return the URL ref the server stored it under.
async function uploadImage(file, w = CONFIG.upload.cardW, h = CONFIG.upload.cardH, fit, kind, bg) {
  const blob = await imgToBlob(file, w, h, fit, bg);
  const query = kind ? ('?kind=' + encodeURIComponent(kind)) : '';
  return postUpload('/upload' + query, CONFIG.upload.type, blob);
}
// --- Die, card, and mask meshes ---------------------------------------------

// The visual mesh for a die. A d6 is a textured box (a number per face); a d4
// uses the special vertex-numbered build; everything else is a convex polyhedron.
function dieMesh(props = {}) {
  const sides = props.sides || 6;
  if (sides === 6) {
    const faceOrder = [1, 6, 2, 5, 3, 4]; // opposite faces sum to 7
    return new THREE.Mesh(
      new THREE.BoxGeometry(DIE_RADIUS[6] * 2, DIE_RADIUS[6] * 2, DIE_RADIUS[6] * 2),
      faceOrder.map(n => new THREE.MeshStandardMaterial({ map: numberFaceTexture(n, props.color, props.textColor), roughness: 0.5 })),
    );
  }
  if (sides === 4) return numberedD4(props.color, props.textColor);
  return convexDie(sides, props.color, props.textColor);
}

// A rounded-rectangle alpha mask (white card shape on black), so cards render
// with rounded corners. Cached and reused by every card. Not sRGB — it's a mask.
let _roundMask;
function roundMask() {
  if (_roundMask) return _roundMask;
  const w = 300, h = 420;
  const { canvas, ctx } = makeCanvas(w, h);

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, CARD_ROUND * w);
  ctx.fill();

  _roundMask = cTex(canvas, false);
  return _roundMask;
}

// A card mesh: a thin box whose top/bottom faces carry the front/back textures
// and whose four edges are invisible. A face-down card omits the front texture
// so its hidden face can never even be rendered client-side.
function cardMesh(props = {}) {
  const side = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }); // invisible edge
  const back = new THREE.MeshStandardMaterial({ map: resolveTexture(props.back), roughness: 0.6, alphaMap: roundMask(), alphaTest: 0.5 });
  const geo = new THREE.BoxGeometry(...halfExtents('card').map(v => v * 2));

  // Box face order is [+x, -x, +y, -y, +z, -z]; front/back sit on ±y.
  if (!props.front) return new THREE.Mesh(geo, [side, side, back, back, side, side]); // face-down
  const front = new THREE.MeshStandardMaterial({ map: resolveTexture(props.front), roughness: 0.6, alphaMap: roundMask(), alphaTest: 0.5 });
  return new THREE.Mesh(geo, [side, side, front, back, side, side]);
}
// --- Props: models (async .glb) and built-in shapes -------------------------

// The colour a built-in prop should render in: a fixed team colour for two-sided
// game sets (checkers/chess), otherwise the player's picked colour, else neutral.
function propColor(props) {
  const spec = PROPS[props.shape] || PROPS.box;
  if (spec.team) return COLORS.team[spec.team][props.team ? 1 : 0];
  return props.color ?? COLORS.neutralProp;
}

const propMat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.05 });
const gltfLoader = new GLTFLoader();
const MODEL_SIZE = CONFIG.model.size; // custom-model normalization target

// Load a .glb into a fresh group and return the group immediately; the model
// populates it asynchronously once loaded. `fitOpts` is passed to fitModel;
// `onMesh(node)` runs for each mesh (shadow/material handling); optional
// `beforeFit(scene)` runs on the raw scene before fitting (e.g. to reorient it).
function loadModelGroup(url, fitOpts, onMesh, beforeFit) {
  const group = new THREE.Group();
  gltfLoader.load(url, gltf => {
    const obj = gltf.scene;
    if (beforeFit) beforeFit(obj);
    fitModel(obj, fitOpts);
    obj.traverse(node => { if (node.isMesh) onMesh(node); });
    group.add(obj);
  }, undefined, () => {});
  return group;
}

// Build a prop's visual mesh. A prop is either a bundled/custom .glb MODEL or a
// simple built-in SHAPE (box/sphere/cone/…). Models load asynchronously into a
// placeholder group and colour themselves in when ready; shapes build instantly.
function propMesh(props = {}) {
  const spec = PROPS[props.shape] || {};
  const modelUrl = props.model || spec.model; // custom upload (instance) OR bundled built-in (definition)

  if (modelUrl) {
    const builtin = !props.model && !!spec.model; // built-ins keep FIXED set proportions; custom uploads normalize

    // Work out how the model gets coloured (used by paint below):
    const teamTint = builtin && spec.team ? propColor(props) : null;                                  // a team set → recolour every slot
    const pick = (!builtin || !spec.ownMaterial || spec.tintMaterial) ? (props.color ?? null) : null; // the player's picked colour
    const matte = (color, side) => new THREE.MeshStandardMaterial({ color, metalness: 0, roughness: 0.6, side });

    // Decide the fate of one material slot on the loaded model.
    const paint = (material) => {
      if (teamTint != null) return matte(teamTint, material.side); // team set: recolour everything
      if (builtin && spec.tintMaterial) {
        // Only the one named slot takes the picked colour; de-metal the rest so
        // their own baked-in colours read correctly.
        if (material.name === spec.tintMaterial && pick != null) return matte(pick, material.side);
        material.metalness = 0;
        return material;
      }
      if (builtin && spec.ownMaterial) { // keep the model's own materials, just de-metal
        material.metalness = 0;
        return material;
      }
      return pick != null ? matte(pick, material.side) : material; // full tint (colour-picker / custom upload)
    };

    return loadModelGroup(
      modelUrl,
      builtin ? { scale: (spec.modelScale || 1) * (props.scale || 1) } : { target: MODEL_SIZE * (props.scale || 1) },
      node => {
        if (node.geometry) node.geometry.computeVertexNormals(); // smooth normals — kills the flat-shading seam on flat .glb faces
        if (!node.material) return;
        node.castShadow = true;
        node.receiveShadow = true;
        node.material = Array.isArray(node.material) ? node.material.map(paint) : paint(node.material);
      },
      (obj) => { const mr = builtin ? spec.modelRot : props.modelRot; if (mr) obj.rotation.set(mr[0], mr[1], mr[2]); }, // reorient: built-in template, or a per-upload modelRot
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
    case 'sphere': return new THREE.Mesh(new THREE.SphereGeometry(render.r, 24, 16), material);
    case 'cone':   return new THREE.Mesh(new THREE.ConeGeometry(render.r, render.h, render.seg), material);
    case 'cyl':    return new THREE.Mesh(new THREE.CylinderGeometry(render.rTop ?? render.r, render.r, render.h, render.seg ?? 32), material);
    case 'lens': {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(render.r, 24, 16), material);
      mesh.scale.y = render.sy; // squash the sphere into a lens
      return mesh;
    }
    default: return new THREE.Mesh(new THREE.BoxGeometry(...(render.size || [1, 1, 1])), material);
  }
}
// A rounded-rectangle THREE.Shape (w×d, corner radius `radius`), centred on the
// origin — used as the extruded footprint of the deck mesh.
function roundedRectShape(w, d, radius) {
  const shape = new THREE.Shape();
  const hw = w / 2, hd = d / 2;
  shape.moveTo(-hw + radius, -hd);
  shape.lineTo(hw - radius, -hd);   shape.quadraticCurveTo(hw, -hd, hw, -hd + radius);
  shape.lineTo(hw, hd - radius);    shape.quadraticCurveTo(hw, hd, hw - radius, hd);
  shape.lineTo(-hw + radius, hd);   shape.quadraticCurveTo(-hw, hd, -hw, hd - radius);
  shape.lineTo(-hw, -hd + radius);  shape.quadraticCurveTo(-hw, -hd, -hw + radius, -hd);
  return shape;
}

// The deck mesh: a rounded footprint extruded upward, whose height scales with
// the card count. Custom UVs map the card-back texture flat across the top and
// tile the layer-line edge texture around the sides.
function deckMesh(props = {}) {
  const W = DECK_VISUAL[0], D = DECK_VISUAL[2];
  const radius = Math.min(CARD_ROUND * W, W * 0.49, D * 0.49);

  const uvGenerator = {
    generateTopUV(geometry, vertices, indexA, indexB, indexC) {
      const uvForIndex = i => new THREE.Vector2((vertices[i * 3] + W / 2) / W, (vertices[i * 3 + 1] + D / 2) / D);
      return [uvForIndex(indexA), uvForIndex(indexB), uvForIndex(indexC)];
    },
    generateSideWallUV() {
      return [new THREE.Vector2(0, 0), new THREE.Vector2(1, 0), new THREE.Vector2(1, 1), new THREE.Vector2(0, 1)];
    },
  };

  const geo = new THREE.ExtrudeGeometry(roundedRectShape(W, D, radius), { depth: 1, bevelEnabled: false, UVGenerator: uvGenerator });
  geo.translate(0, 0, -0.5);
  geo.rotateX(-Math.PI / 2); // extrude direction Z → up (Y), centred on the origin

  const back = new THREE.MeshStandardMaterial({ map: resolveTexture(props.back), roughness: 0.6 });
  const edge = new THREE.MeshStandardMaterial({ map: deckEdgeTex(), roughness: 0.85 });
  return new THREE.Mesh(geo, [back, edge]); // material group 0 = top/bottom caps, 1 = side walls
}

// Normalize an uploaded board so its footprint is BOARD_SIZE wide; returns
// { scale, box:[hx,hy,hz] } for the server-side collider.
function measureBoard(url) {
  return measureGlb(url).then(({ size }) => {
    const scale = BOARD_SIZE / (Math.max(size.x, size.z) || 1); // fit the X/Z footprint
    return { scale, box: [size.x * scale / 2, size.y * scale / 2, size.z * scale / 2] };
  });
}

// The board mesh: a built-in/uploaded .glb model, or a plain textured slab.
function boardMesh(props = {}) {
  const builtin = props.board && BOARDS[props.board]; // a built-in model board
  const modelUrl = builtin ? builtin.model : props.model; // or an uploaded .glb board

  if (modelUrl) {
    // centre at origin (the server sits it on the table by half-height)
    return loadModelGroup(
      modelUrl,
      { scale: builtin ? builtin.modelScale : (props.modelScale || 1) },
      node => {
        node.receiveShadow = true;
        node.castShadow = false;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach(m => { if (m) m.metalness = 0; }); // de-metal so the board's own colours read
      },
    );
  }

  // A plain procedural board: a textured slab.
  const w = props.w || 8, d = props.d || 8;
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
const isTintSlot = (name, slot) => !!slot && typeof name === 'string' && (name === slot || name.startsWith(slot + '.'));

// Parsed stack item models, keyed by item shape. The first build loads the .glb
// async; every rebuild after (a dispense changes count → the mesh is rebuilt) clones
// from the cached scene SYNCHRONOUSLY, so the stack never blinks out while a reload
// resolves. Stored raw/unpainted — each build clones, fits, and tints its own copy.
const _stackProto = new Map();

// colour. `props` carries { disp, color?, team?, count? }.
function dispenserMesh(props = {}) {
  const spec = DISPENSERS[props.disp];
  if (!spec) return new THREE.Group();
  const matte = (color, side) => new THREE.MeshStandardMaterial({ color, metalness: 0, roughness: 0.6, side });

  if (spec.body === 'model') {
    const teamTint = spec.team ? COLORS.team[spec.team][props.team ? 1 : 0] : null;
    const paint = (m) => {
      if (teamTint != null && isTintSlot(m.name, spec.tintMaterial)) return matte(teamTint, m.side);
      m.metalness = 0; return m; // shell keeps its baked look
    };
    return loadModelGroup(spec.model, { target: MODEL_SIZE * (spec.modelScale || 1) }, node => {
      if (!node.material) return;
      node.castShadow = true; node.receiveShadow = true;
      node.material = Array.isArray(node.material) ? node.material.map(paint) : paint(node.material);
    });
  }

  // 'stack' — load the item model once, paint it like a spawned item, clone up Y.
  const item = PROPS[spec.item] || {};
  const discH = stackDiscH(spec.item);
  const n = stackVisible(props.count ?? spec.count.def);
  const tint = props.color ?? null;
  const paint = (m) => {
    if (item.tintMaterial) { if (tint != null && isTintSlot(m.name, item.tintMaterial)) return matte(tint, m.side); m.metalness = 0; return m; }
    if (item.ownMaterial) { m.metalness = 0; return m; }
    return tint != null ? matte(tint, m.side) : m;
  };
  const group = new THREE.Group();
  const fill = (rawScene) => {                              // build the stack from a cached raw scene
    const proto = rawScene.clone(true);
    fitModel(proto, { scale: item.modelScale || 1 });      // centre + scale, matching a spawned item
    proto.traverse(node => {
      if (!node.isMesh || !node.material) return;
      node.castShadow = true; node.receiveShadow = true;
      node.material = Array.isArray(node.material) ? node.material.map(paint) : paint(node.material);
    });
    for (let i = 0; i < n; i++) {
      const clone = proto.clone(true);                     // shares geometry/material — cheap
      clone.position.y = (i - (n - 1) / 2) * discH;         // centred stack, discs flush
      group.add(clone);
    }
  };
  const cached = _stackProto.get(spec.item);
  if (cached) fill(cached);                                 // rebuild path: synchronous, no blink
  else gltfLoader.load(item.model, gltf => { _stackProto.set(spec.item, gltf.scene); fill(gltf.scene); }, undefined, () => {});
  return group;
}

// --- KIND registry: the client-side half of each piece kind -----------------
// mesh:            builder for its Three.js mesh.
// grab:            which mouse button moves it (0 = left, 2 = right).
// ldrag:           a special left-drag action (message name).
// lclick / rclick: click actions (message names).
// Adding a kind = one entry here + one in the shared KINDS descriptor.
const KIND = {
  die:   { mesh: dieMesh,   grab: 0, rclick: 'roll' },
  card:  { mesh: cardMesh,  grab: 0, lclick: 'takeCard', rclick: 'flip' },
  prop:  { mesh: propMesh,  grab: 0 },
  deck:  { mesh: deckMesh,  grab: 2, ldrag: 'deal', lclick: 'deal', rclick: 'shuffle' },
  board: { mesh: boardMesh },
  dispenser: { mesh: dispenserMesh, grab: 2, ldrag: 'dispense', lclick: 'dispense' }, // right-drag moves; left dispenses one
};

// ---- Overlays: flat, non-physics annotations (measurement + templates) ------
// A registry parallel to KIND: each kind builds a THREE.Group in table-space (XZ,
// at y=0; the client lifts it just above the felt). The distance LABEL is a sprite
// the client owns (it needs the room's scale + formatMeasure). A new overlay kind
// is one entry here + one server-side kind string — the sync/interaction is generic.
function overlayBar(ax, az, bx, bz, color, thick = 0.06) {
  const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 0.0001;
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false });
  const g = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.02, thick), mat);
  bar.position.set((ax + bx) / 2, 0, (az + bz) / 2);
  bar.rotation.y = Math.atan2(-dz, dx);           // align the bar's +X along A→B
  g.add(bar);
  for (const [px, pz] of [[ax, az], [bx, bz]]) {  // small end dots mark the two points
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(thick, thick, 0.03, 12), mat);
    cap.position.set(px, 0, pz);
    g.add(cap);
  }
  return g;
}
function rulerMesh(o) { return overlayBar(o.x, o.z, o.x2, o.z2, o.color); }

// Template materials: a faint interior FILL and a solid EDGE, both flat and
// unlit like the ruler bar. Fill opacity + edge weight are client-feel tunables
// (CONFIG.measure); DoubleSide so a template reads from under the table too.
function overlayFill(color) { return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: CONFIG.measure.fill, depthWrite: false, side: THREE.DoubleSide }); }
function overlayEdge(color) { return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }); }

// A flat pie-slice in the XZ plane: apex at the origin, bisector along +X,
// spanning ±half out to radius L. Built directly flat (every y = 0) so a single
// rotation.y aims it — the same trick overlayBar uses to avoid tilt composition.
function sectorGeometry(L, half, seg = 40) {
  const pos = [], step = (2 * half) / seg;
  for (let i = 0; i < seg; i++) {
    const t0 = -half + step * i, t1 = -half + step * (i + 1);
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
  disc.rotation.x = -Math.PI / 2; disc.position.set(o.x, 0, o.z);
  g.add(disc);
  const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(0, r - CONFIG.measure.edge), r, 64), overlayEdge(o.color));
  ring.rotation.x = -Math.PI / 2; ring.position.set(o.x, 0.002, o.z); // lift the rim off the disc to avoid z-fighting
  g.add(ring);
  return g;
}

// cone: a flat sector. Apex A, facing A→B, length = |A→B|, half-angle o.ang
// (default MEASURE.coneAngle). rotation.y aims the +X bisector down A→B.
function coneTemplate(o) {
  const dx = o.x2 - o.x, dz = o.z2 - o.z, L = Math.hypot(dx, dz) || 0.0001;
  const half = o.ang > 0 ? o.ang : MEASURE.coneAngle;
  const sector = new THREE.Mesh(sectorGeometry(L, half), overlayFill(o.color));
  sector.position.set(o.x, 0, o.z);
  sector.rotation.y = Math.atan2(-dz, dx);        // +X bisector along A→B (overlayBar's convention)
  const g = new THREE.Group();
  g.add(sector);
  return g;
}

// line: a width×length lane. From A toward B, length = |A→B|, width o.w
// (default MEASURE.lineWidth). A faint band plus a solid centre line for read.
function lineTemplate(o) {
  const dx = o.x2 - o.x, dz = o.z2 - o.z, L = Math.hypot(dx, dz) || 0.0001;
  const w = o.w > 0 ? o.w : MEASURE.lineWidth;
  const band = new THREE.Mesh(new THREE.BoxGeometry(L, 0.02, w), overlayFill(o.color));
  band.position.set((o.x + o.x2) / 2, -0.005, (o.z + o.z2) / 2); // just under the centre line (avoid z-fight)
  band.rotation.y = Math.atan2(-dz, dx);          // long axis along A→B
  const g = new THREE.Group();
  g.add(band);
  g.add(overlayBar(o.x, o.z, o.x2, o.z2, o.color, 0.04)); // the centre line
  return g;
}

// A registry parallel to KIND (see the block above): kind → mesh builder. Adding
// an overlay kind is one entry here + one string in the server's OVERLAY_KINDS.
const OVERLAY = {
  ruler:  { build: rulerMesh },
  circle: { build: circleTemplate },
  cone:   { build: coneTemplate },
  line:   { build: lineTemplate },
};

// ---- Library preview thumbnails (editor) -----------------------------------
// A tiny offscreen renderer that snapshots a mesh/model to a PNG data-URL, so the
// library can show a picture of each asset. Card faces don't need it — they draw
// straight to a 2D canvas (see cardPreviewURL). Results are cached by a key.
let _thumb = null;
function thumbRig() {
  if (_thumb) return _thumb;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(220, 220); renderer.setPixelRatio(1); renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 1.15); key.position.set(4, 6, 5); scene.add(key);
  const cam = new THREE.PerspectiveCamera(32, 1, 0.01, 5000);
  _thumb = { renderer, scene, cam };
  return _thumb;
}
function snapshot(obj) {
  const { renderer, scene, cam } = thumbRig();
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return null;
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  obj.position.sub(center);                                    // centre it at the origin
  scene.add(obj);
  const d = maxDim * 2.4;
  cam.position.set(d * 0.85, d * 0.72, d); cam.lookAt(0, 0, 0);
  cam.near = maxDim / 100; cam.far = maxDim * 40; cam.updateProjectionMatrix();
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(obj);
  return url;
}

const _prevCache = new Map();
// A card ref → preview image URL. Image refs pass straight through; procedural refs
// (back / rank: / text: / tback:) are drawn to a canvas and returned as a data-URL.
export function cardPreviewURL(ref) {
  const r = ref || 'back';
  if (r.startsWith('/') || r.startsWith('http') || r.startsWith('data:')) return r;
  if (_prevCache.has(r)) return _prevCache.get(r);
  const tex = resolveTexture(r);
  const url = (tex && tex.image && tex.image.toDataURL) ? tex.image.toDataURL('image/jpeg', 0.85) : null;
  if (url) _prevCache.set(r, url);
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
    if (modelUrl) { const gltf = await gltfLoader.loadAsync(modelUrl); url = snapshot(gltf.scene); }
    else url = snapshot(propShapeMesh(props));
  } catch (e) { /* leave null → the card shows a placeholder */ }
  if (url) _prevCache.set(key, url);
  return url;
}
// A board preview: an image URL passes through; a .glb is rendered; else null.
export async function boardPreviewURL(fileUrl) {
  if (!fileUrl) return null;
  const key = 'b:' + fileUrl;
  if (_prevCache.has(key)) return _prevCache.get(key);
  let url = null;
  if (/\.glb$/i.test(fileUrl)) { try { const gltf = await gltfLoader.loadAsync(fileUrl); url = snapshot(gltf.scene); } catch (e) { /* null */ } }
  else url = fileUrl; // an image URL (jpg/png/webp…)
  if (url) _prevCache.set(key, url);
  return url;
}

// A built-in die (d4…d20) → a rendered thumbnail data-URL. Synchronous (no load).
export function diePreviewURL(sides) {
  const key = 'd:' + sides;
  if (_prevCache.has(key)) return _prevCache.get(key);
  let url = null;
  try { url = snapshot(dieMesh({ sides })); } catch (e) { /* null → placeholder */ }
  if (url) _prevCache.set(key, url);
  return url;
}

// A local (not-yet-uploaded) .glb File → a rendered thumbnail data-URL, for previews.
export async function glbFilePreviewURL(file, rot) {
  const url = URL.createObjectURL(file);
  try { const gltf = await gltfLoader.loadAsync(url); if (rot) gltf.scene.rotation.set(rot[0], rot[1], rot[2]); return snapshot(gltf.scene); }
  catch (e) { return null; }
  finally { URL.revokeObjectURL(url); }
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

// A flat "YOU" chip texture, laid on the felt at your own seat.
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

export { KIND, OVERLAY, makeCanvas, cTex, cardMesh, propColor, measureModel, measureBoard, resizeToCanvas, splitColorText, uploadImage, uploadModel, makePlayerTexture, nameTag, makeYouChipTexture };
