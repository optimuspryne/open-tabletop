import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG, renderer } from './core.js';
import { KINDS as PHYS, PROPS, COLORS, DECK_VISUAL, CARD_ROUND, dieVerts, DIE_RADIUS, BOARDS, BOARD_SIZE } from '/shared/pieces.js';

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

  const c = parseCardFront(ref);
  let texture;
  if (c.kind === 'back') texture = cardBack();
  else if (c.kind === 'rank') texture = cardFront(c.rank, c.suit, c.color);
  else if (c.kind === 'text') texture = textFaceTexture(c.text, c.color, c.bg, c.accent);
  else if (c.kind === 'tback') texture = textBackTexture(c.bg, c.text, c.textColor, c.accent);
  else texture = loadImageTexture(c.ref);

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

// POST a raw .glb model; return the URL ref the server stored it under.
async function uploadModel(file) {
  const response = await fetch('/upload-model?kind=props', {
    method: 'POST',
    headers: { 'Content-Type': 'model/gltf-binary' },
    body: file,
  });
  if (!response.ok) throw new Error('model upload failed');
  return (await response.json()).url;
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
  const response = await fetch('/upload' + query, {
    method: 'POST',
    headers: { 'Content-Type': CONFIG.upload.type },
    body: blob,
  });
  if (!response.ok) throw new Error('upload failed');
  return (await response.json()).url;
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

export { KIND, makeCanvas, cTex, cardMesh, propColor, measureModel, measureBoard, resizeToCanvas, splitColorText, uploadImage, uploadModel };
