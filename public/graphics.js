import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG, renderer } from './core.js';
import { KINDS as PHYS, PROPS, COLORS, DECK_VISUAL, CARD_ROUND, dieVerts, DIE_RADIUS, BOARDS, BOARD_SIZE } from '/shared/pieces.js';

// ===== texture + mesh builders (keyed by piece type) ========================
function cardFront(rank,suite,color){ const w=300,h=420,c=document.createElement('canvas');c.width=w;c.height=h;
  const x=c.getContext('2d');x.fillStyle='#fbfbf7';x.fillRect(0,0,w,h);x.strokeStyle='#ddd';x.lineWidth=6;x.strokeRect(3,3,w-6,h-6);
  x.fillStyle=color;x.textAlign='center';
  const index = () => { x.font='bold 46px Georgia'; x.fillText(rank,0,0); x.font='bold 40px Georgia'; x.fillText(suite,0,42); };
  x.save(); x.translate(34,52); index(); x.restore();                       // top-left: rank over suit
  x.save(); x.translate(w-34,h-52); x.rotate(Math.PI); index(); x.restore(); // bottom-right: same, rotated 180°
  x.font='bold 140px Georgia'; x.fillText(rank,w/2,h/2+56);                  // big center rank
  return cTex(c); }
function cardBack(){ const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');
  x.fillStyle='#7d2b2b';x.fillRect(0,0,256,256);x.strokeStyle='#c9a25a';x.lineWidth=3;
  for(let i=-256;i<256;i+=20){x.beginPath();x.moveTo(i,0);x.lineTo(i+256,256);x.stroke();} return cTex(c); }
function boardTex(){ const n=8,s=CONFIG.tex.board,c=document.createElement('canvas');c.width=c.height=s;const x=c.getContext('2d');
  for(let i=0;i<n;i++)for(let j=0;j<n;j++){x.fillStyle=(i+j)%2?COLORS.felt[0]:COLORS.felt[1];x.fillRect(i*s/n,j*s/n,s/n,s/n);} return cTex(c); }
let _deckEdgeTex;
function deckEdgeTex(){ if(_deckEdgeTex) return _deckEdgeTex; // deck side: fine horizontal layer lines = stacked cards
  const w=4,h=256,c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');
  x.fillStyle='#'+COLORS.deckEdge.toString(16).padStart(6,'0');x.fillRect(0,0,w,h); // paper base (COLORS.deckEdge)
  x.lineWidth=1;
  for(let y=2;y<h;y+=4){ x.strokeStyle=(y%8<4)?'rgba(120,108,90,0.75)':'rgba(255,255,255,0.22)'; // alternating shade/highlight per layer
    x.beginPath();x.moveTo(0,y+0.5);x.lineTo(w,y+0.5);x.stroke(); }
  return _deckEdgeTex=cTex(c); }

// Canvas textures default to no anisotropic filtering, which makes them blur at
// grazing angles/distance (dice numbers especially). This adds max anisotropy.
let _maxAniso = 0;
function cTex(canvas, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.anisotropy = _maxAniso || (_maxAniso = renderer.capabilities.getMaxAnisotropy());
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true; return t;
}

// --- dice numbering ---------------------------------------------------------
function drawNumber(x, s, n){ x.fillStyle=COLORS.ink; x.textAlign='center'; x.textBaseline='middle';
  const str=String(n); let fs=s*0.59; x.font=`bold ${fs}px system-ui,sans-serif`;
  while(x.measureText(str).width > s*0.72 && fs>s*0.08){ fs-=s*0.047; x.font=`bold ${fs}px system-ui,sans-serif`; }
  x.fillText(str, s/2, s/2+s*0.016);
  if(n===6||n===9){ x.strokeStyle=COLORS.ink; x.lineWidth=s*0.047; x.beginPath(); x.moveTo(s*0.34,s*0.74); x.lineTo(s*0.66,s*0.74); x.stroke(); } } // underline to disambiguate
const _digitTex=new Map(), _faceTex=new Map();
function digitTexture(n){ if(_digitTex.has(n))return _digitTex.get(n); // transparent bg, for label planes
  const s=CONFIG.tex.die,c=document.createElement('canvas');c.width=c.height=s;const x=c.getContext('2d');
  drawNumber(x,s,n); const t=cTex(c); _digitTex.set(n,t); return t; }
function numberFaceTexture(n){ if(_faceTex.has(n))return _faceTex.get(n); // ivory bg, for the d6 box faces
  const s=CONFIG.tex.die,c=document.createElement('canvas');c.width=c.height=s;const x=c.getContext('2d');
  x.fillStyle=COLORS.ivory;x.fillRect(0,0,s,s); drawNumber(x,s,n); const t=cTex(c); _faceTex.set(n,t); return t; }
function numberLabel(n, size){ return new THREE.Mesh(new THREE.PlaneGeometry(size,size),
  new THREE.MeshBasicMaterial({ map:digitTexture(n), transparent:true, depthWrite:false })); }

// Build a numbered polyhedral die: convex mesh + one number laid on each face.
// Faces are recovered by grouping the mesh's triangles that share a normal.
function convexDie(sides){
  const pts = dieVerts(sides, DIE_RADIUS[sides]||1).map(v=>new THREE.Vector3(v[0],v[1],v[2]));
  const geo = new ConvexGeometry(pts);
  const die = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color:COLORS.ivory, roughness:0.45, flatShading:true }));
  die.castShadow = true; die.receiveShadow = true;
  const group = new THREE.Group(); group.add(die);

  const pos = geo.getAttribute('position');
  const a=new THREE.Vector3(), b=new THREE.Vector3(), c=new THREE.Vector3(), ab=new THREE.Vector3(), ac=new THREE.Vector3(), nrm=new THREE.Vector3();
  const faces=[];
  for(let i=0;i<pos.count;i+=3){
    a.fromBufferAttribute(pos,i); b.fromBufferAttribute(pos,i+1); c.fromBufferAttribute(pos,i+2);
    ab.subVectors(b,a); ac.subVectors(c,a); nrm.crossVectors(ab,ac).normalize();
    let f = faces.find(f=>f.n.dot(nrm) > 0.999);
    if(!f){ f={ n:nrm.clone(), verts:new Map() }; faces.push(f); }
    for(const v of [a,b,c]){ const key=`${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`; if(!f.verts.has(key)) f.verts.set(key, v.clone()); }
  }
  faces.forEach((f, idx)=>{
    const vs=[...f.verts.values()], centroid=new THREE.Vector3();
    vs.forEach(v=>centroid.add(v)); centroid.multiplyScalar(1/vs.length);
    let circ=0; vs.forEach(v=>circ=Math.max(circ, v.distanceTo(centroid)));
    const inR = circ*Math.cos(Math.PI/vs.length), lbl = numberLabel(idx+1, inR*1.25);
    lbl.position.copy(centroid).addScaledVector(f.n, 0.015);
    lbl.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), f.n);
    group.add(lbl);
  });
  return group;
}

// d4 reads by its top vertex, so each of the 4 vertices carries a number that's
// printed at that corner on every face touching it (three copies per number).
function numberedD4(){
  const raw = dieVerts(4, DIE_RADIUS[4]);
  const V = raw.map(v=>new THREE.Vector3(v[0],v[1],v[2]));
  const geo = new ConvexGeometry(V);
  const die = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color:COLORS.ivory, roughness:0.45, flatShading:true }));
  die.castShadow = true; die.receiveShadow = true;
  const group = new THREE.Group(); group.add(die);
  const vertNum = v => { let best=0, bd=1e9; V.forEach((u,i)=>{ const d=u.distanceTo(v); if(d<bd){bd=d;best=i;} }); return best+1; };
  const pos = geo.getAttribute('position');
  const a=new THREE.Vector3(), b=new THREE.Vector3(), c=new THREE.Vector3(), ab=new THREE.Vector3(), ac=new THREE.Vector3(), n=new THREE.Vector3();
  const right=new THREE.Vector3(), up=new THREE.Vector3(), m=new THREE.Matrix4();
  for(let i=0;i<pos.count;i+=3){
    a.fromBufferAttribute(pos,i); b.fromBufferAttribute(pos,i+1); c.fromBufferAttribute(pos,i+2);
    ab.subVectors(b,a); ac.subVectors(c,a); n.crossVectors(ab,ac).normalize();
    const centroid = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1/3);
    const circ = Math.max(a.distanceTo(centroid), b.distanceTo(centroid), c.distanceTo(centroid));
    for(const v of [a,b,c]){
      const lbl = numberLabel(vertNum(v), circ*0.55);
      up.subVectors(v, centroid).normalize();               // digit points toward its vertex
      right.crossVectors(up, n).normalize();
      up.crossVectors(n, right).normalize();
      m.makeBasis(right, up, n); lbl.quaternion.setFromRotationMatrix(m);
      lbl.position.copy(v).lerp(centroid, 0.30).addScaledVector(n, 0.015);
      group.add(lbl);
    }
  }
  return group;
}

const H = t => PHYS[t].shape.box; // collider box half-extents, shared with the server

// Resolve a texture REFERENCE to a THREE texture (cached):
//   'back'            -> procedural classic card back
//   'rank:A:#111'     -> procedural card face
//   'data:...' / URL  -> loaded image (uploaded card art or a file)
const _texCache = new Map(), _texLoader = new THREE.TextureLoader();
function resolveTexture(ref) {
  if (!ref) ref = 'back';
  if (_texCache.has(ref)) return _texCache.get(ref);
  let tex;
  if (ref === 'back') tex = cardBack();
  else if (ref.startsWith('rank:')) { const p = ref.split(':'); tex = cardFront(p[1], p[2], p[3]); }
  else if (ref.startsWith('text:')) { const [c, r1] = splitColorText(ref.slice(5), COLORS.ink); const [bg, t] = splitColorText(r1, '#fbfbf7'); tex = textFaceTexture(t, c, bg); }
  else if (ref.startsWith('tback:')) { const r = ref.slice(6), i = r.indexOf(':'); const [tc, t] = splitColorText(r.slice(i + 1), '#f4f1ea'); tex = textBackTexture(r.slice(0, i), t, tc); }
  else { tex = _texLoader.load(ref); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = _maxAniso || (_maxAniso = renderer.capabilities.getMaxAnisotropy()); }
  _texCache.set(ref, tex);
  return tex;
}
// split 'colorPrefix:rest' when the prefix is a hex color; else default color + whole string
function splitColorText(str, def) {
  const i = str.indexOf(':');
  if (i > 0 && /^#[0-9a-fA-F]{3,8}$/.test(str.slice(0, i))) return [str.slice(0, i), str.slice(i + 1)];
  return [def, str];
}
function wrapLines(ctx, text, maxW) {
  const words = String(text).split(/\s+/), lines = []; let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line); return lines.length ? lines : [''];
}
function drawWrapped(x, text, w, h, pad, weight) {
  x.textAlign = 'center'; x.textBaseline = 'middle';
  let fs = 30; x.font = `${weight} ${fs}px system-ui,sans-serif`;
  let lines = wrapLines(x, text, w - pad * 2);
  while (lines.length * fs * 1.25 > h - pad * 2 && fs > 11) { fs -= 2; x.font = `${weight} ${fs}px system-ui,sans-serif`; lines = wrapLines(x, text, w - pad * 2); }
  const lh = fs * 1.25; let y = h / 2 - (lines.length - 1) * lh / 2;
  for (const l of lines) { x.fillText(l, w / 2, y); y += lh; }
}
function textFaceTexture(text, color, bg) {
  const w = 300, h = 420, c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  x.fillStyle = bg || '#fbfbf7'; x.fillRect(0, 0, w, h); x.strokeStyle = '#ddd'; x.lineWidth = 6; x.strokeRect(6, 6, w - 12, h - 12);
  x.fillStyle = color || COLORS.ink; drawWrapped(x, text, w, h, 26, '600');
  return cTex(c);
}
function textBackTexture(color, text, textColor) {
  const w = 256, h = 358, c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  x.fillStyle = color || '#7d2b2b'; x.fillRect(0, 0, w, h); x.strokeStyle = 'rgba(255,255,255,.45)'; x.lineWidth = 6; x.strokeRect(8, 8, w - 16, h - 16);
  if (text) { x.fillStyle = textColor || '#f4f1ea'; drawWrapped(x, text, w, h, 22, '700'); }
  return cTex(c);
}

// --- mesh builders (the render half of each kind) ---------------------------
function resizeToCanvas(file, w, h, fit) { // cover-fit (or 'stretch') an image onto a w×h canvas
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
      if (fit === 'stretch') x.drawImage(img, 0, 0, w, h);       // whole image, squashed to fit (boards)
      else { const s = Math.max(w / img.width, h / img.height), dw = img.width * s, dh = img.height * s; x.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh); }
      URL.revokeObjectURL(img.src); res(c); };
    img.onerror = rej; img.src = URL.createObjectURL(file);
  });
}
function imgToBlob(file, w, h, fit) { // resize to an encoded image Blob (for HTTP upload) — format/quality from CONFIG.upload
  return resizeToCanvas(file, w, h, fit).then(c => new Promise(res => c.toBlob(b => res(b), CONFIG.upload.type, CONFIG.upload.quality)));
}
async function uploadModel(file) { // POST a raw .glb, get back its URL ref
  const r = await fetch('/upload-model?kind=props', { method: 'POST', headers: { 'Content-Type': 'model/gltf-binary' }, body: file });
  if (!r.ok) throw new Error('model upload failed');
  return (await r.json()).url;
}
function measureGlb(url) { // load a .glb, return its true loaded bounds { size, center } (node transforms applied)
  return new Promise((res, rej) => gltfLoader.load(url, g => {
    const b = new THREE.Box3().setFromObject(g.scene);
    res({ size: b.getSize(new THREE.Vector3()), center: b.getCenter(new THREE.Vector3()) });
  }, undefined, rej));
}
function fitModel(obj, opts) { // center at origin, then scale — by a fixed factor or to normalize maxdim to a target
  const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const s = opts.scale != null ? opts.scale : (opts.target / (Math.max(size.x, size.y, size.z) || 1));
  obj.scale.setScalar(s); obj.position.copy(center).multiplyScalar(-s);
  return s;
}
function measureModel(url, scale = 1) { // normalized half-extents [hx,hy,hz] for the collider
  return measureGlb(url).then(({ size }) => { const s = MODEL_SIZE * scale / (Math.max(size.x, size.y, size.z) || 1);
    return [size.x * s / 2, size.y * s / 2, size.z * s / 2]; });
}
async function uploadImage(file, w = CONFIG.upload.cardW, h = CONFIG.upload.cardH, fit, kind) { // resize + POST one image, get back its URL ref
  const blob = await imgToBlob(file, w, h, fit);
  const q = kind ? ('?kind=' + encodeURIComponent(kind)) : '';
  const r = await fetch('/upload' + q, { method: 'POST', headers: { 'Content-Type': CONFIG.upload.type }, body: blob });
  if (!r.ok) throw new Error('upload failed');
  return (await r.json()).url;
}
function dieMesh(p={}){ const sides = p.sides || 6;
  if (sides === 6) return new THREE.Mesh(new THREE.BoxGeometry(DIE_RADIUS[6]*2, DIE_RADIUS[6]*2, DIE_RADIUS[6]*2),
    [1,6,2,5,3,4].map(n=>new THREE.MeshStandardMaterial({ map:numberFaceTexture(n), roughness:0.5 })));
  if (sides === 4) return numberedD4();
  return convexDie(sides); }
let _roundMask;
function roundMask(){ if(_roundMask) return _roundMask;
  const w=300,h=420,c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');
  x.fillStyle='#000';x.fillRect(0,0,w,h);
  x.fillStyle='#fff';x.beginPath();x.roundRect(0,0,w,h,CARD_ROUND*w);x.fill();
  _roundMask=cTex(c, false); return _roundMask; }
function cardMesh(p={}){ const side=new THREE.MeshBasicMaterial({ transparent:true, opacity:0, depthWrite:false }); // no visible edge
  const back=new THREE.MeshStandardMaterial({ map:resolveTexture(p.back), roughness:0.6, alphaMap:roundMask(), alphaTest:0.5 });
  const geo=new THREE.BoxGeometry(...H('card').map(v=>v*2));
  if (!p.front) return new THREE.Mesh(geo, [side,side,back,back,side,side]); // face-down: front hidden
  const front=new THREE.MeshStandardMaterial({ map:resolveTexture(p.front), roughness:0.6, alphaMap:roundMask(), alphaTest:0.5 });
  return new THREE.Mesh(geo, [side,side,front,back,side,side]); }
// --- props: one generic mesh builder driven by PROPS[shape].render ----------
function propColor(p){ const def = PROPS[p.shape] || PROPS.box;
  if (def.team) return COLORS.team[def.team][p.team ? 1 : 0];  // fixed two-colour game sets
  return p.color ?? COLORS.neutralProp; }                       // neutral: picked colour
const propMat = c => new THREE.MeshStandardMaterial({ color:c, roughness:0.5, metalness:0.05 });
const gltfLoader = new GLTFLoader();
const MODEL_SIZE = CONFIG.model.size; // custom-model normalization target
function propMesh(p={}){
  const def = PROPS[p.shape] || {};
  const modelUrl = p.model || def.model;            // custom upload (instance) OR bundled built-in (definition)
  if (modelUrl) {
    const g = new THREE.Group();
    const builtin = !p.model && !!def.model;         // built-ins use a FIXED uniform scale (keep set proportions); customs normalize
    const teamTint = builtin && def.team ? propColor(p) : null;                    // team set -> recolour every slot
    const pick = (!builtin || !def.ownMaterial || def.tintMaterial) ? (p.color ?? null) : null; // picked colour (full/partial tint, or custom)
    gltfLoader.load(modelUrl, gltf => { const obj = gltf.scene;
      if (builtin && def.modelRot) obj.rotation.set(def.modelRot[0], def.modelRot[1], def.modelRot[2]); // reorient (e.g. lay a coin flat)
      fitModel(obj, builtin ? { scale: (def.modelScale || 1) * (p.scale || 1) } : { target: MODEL_SIZE * (p.scale || 1) }); // center + scale
      const matte = (c, side) => new THREE.MeshStandardMaterial({ color: c, metalness: 0, roughness: 0.6, side });
      const paint = m => {                             // decide each material slot's fate
        if (teamTint != null) return matte(teamTint, m.side);                                        // team: all slots
        if (builtin && def.tintMaterial) { if (m.name === def.tintMaterial && pick != null) return matte(pick, m.side); m.metalness = 0; return m; } // only the named slot; de-metal the rest so their own colour shows
        if (builtin && def.ownMaterial) { m.metalness = 0; return m; }                               // keep all, de-metal so colours show
        return pick != null ? matte(pick, m.side) : m;                                               // full tint (colour-picker / custom)
      };
      obj.traverse(o => { if (o.isMesh && o.material) { o.castShadow = true; o.receiveShadow = true;
        o.material = Array.isArray(o.material) ? o.material.map(paint) : paint(o.material); } });
      g.add(obj);
    }, undefined, () => {});
    return g;
  }
  const mesh = propShapeMesh(p);                    // built-in shape
  if (p.scale && p.scale !== 1) mesh.scale.multiplyScalar(p.scale); // universal prop scale — multiply so a shape's own scale (lens y-flatten) survives
  return mesh;
}
function propShapeMesh(p={}){
  const def = PROPS[p.shape] || PROPS.box, r = def.render, mat = propMat(propColor(p));
  switch (r.prim) {
    case 'sphere': return new THREE.Mesh(new THREE.SphereGeometry(r.r, 24, 16), mat);
    case 'cone':   return new THREE.Mesh(new THREE.ConeGeometry(r.r, r.h, r.seg), mat);
    case 'cyl':    return new THREE.Mesh(new THREE.CylinderGeometry(r.r, r.r, r.h, 32), mat);
    case 'lens': { const m = new THREE.Mesh(new THREE.SphereGeometry(r.r, 24, 16), mat); m.scale.y = r.sy; return m; }
    default: return new THREE.Mesh(new THREE.BoxGeometry(...(r.size || [1,1,1])), mat);
  }
}
function roundedRectShape(w, d, r){ const s=new THREE.Shape(), hw=w/2, hd=d/2;
  s.moveTo(-hw+r,-hd); s.lineTo(hw-r,-hd); s.quadraticCurveTo(hw,-hd,hw,-hd+r);
  s.lineTo(hw,hd-r);   s.quadraticCurveTo(hw,hd,hw-r,hd);
  s.lineTo(-hw+r,hd);  s.quadraticCurveTo(-hw,hd,-hw,hd-r);
  s.lineTo(-hw,-hd+r); s.quadraticCurveTo(-hw,-hd,-hw+r,-hd); return s; }
function deckMesh(p={}){ const W=DECK_VISUAL[0], D=DECK_VISUAL[2], r=Math.min(CARD_ROUND*W, W*0.49, D*0.49);
  // rounded footprint extruded along Y: corners round in XZ, height scales freely
  const uv = { generateTopUV(g,v,a,b,c){ const f=i=>new THREE.Vector2((v[i*3]+W/2)/W,(v[i*3+1]+D/2)/D); return [f(a),f(b),f(c)]; },
    generateSideWallUV(){ return [new THREE.Vector2(0,0),new THREE.Vector2(1,0),new THREE.Vector2(1,1),new THREE.Vector2(0,1)]; } };
  const geo=new THREE.ExtrudeGeometry(roundedRectShape(W,D,r), { depth:1, bevelEnabled:false, UVGenerator:uv });
  geo.translate(0,0,-0.5); geo.rotateX(-Math.PI/2); // extrude Z -> up (Y), centered on origin
  const back=new THREE.MeshStandardMaterial({ map:resolveTexture(p.back), roughness:0.6 });
  const edge=new THREE.MeshStandardMaterial({ map:deckEdgeTex(), roughness:0.85 });
  return new THREE.Mesh(geo, [back, edge]); } // group 0 = top/bottom caps, group 1 = side walls
function measureBoard(url) { // normalize an uploaded board to BOARD_SIZE wide; returns { scale, box:[hx,hy,hz] }
  return measureGlb(url).then(({ size }) => { const scale = BOARD_SIZE / (Math.max(size.x, size.z) || 1); // fit the footprint
    return { scale, box: [size.x*scale/2, size.y*scale/2, size.z*scale/2] }; });
}
function boardMesh(p={}){
  const bd = p.board && BOARDS[p.board];               // built-in model board
  const modelUrl = bd ? bd.model : p.model;            // or an uploaded .glb board
  if (modelUrl) {
    const g = new THREE.Group(), scale = bd ? bd.modelScale : (p.modelScale || 1);
    gltfLoader.load(modelUrl, gltf => { const obj = gltf.scene;
      fitModel(obj, { scale }); // center at origin (server sits it on the table by half-height)
      obj.traverse(o => { if (o.isMesh) { o.receiveShadow = true; o.castShadow = false;
        const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { if (m) m.metalness = 0; }); } }); // de-metal so the board's own colours read
      g.add(obj);
    }, undefined, () => {});
    return g;
  }
  const w = p.w || 8, d = p.d || 8;
  let map = boardTex();
  if (p.tex) { map = new THREE.TextureLoader().load(p.tex); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = _maxAniso || (_maxAniso = renderer.capabilities.getMaxAnisotropy()); } // full image, stretched 0..1 across the top
  const top=new THREE.MeshStandardMaterial({ map, roughness:0.8 });
  const edge=new THREE.MeshStandardMaterial({ color:COLORS.boardEdge });
  return new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), [edge,edge,top,edge,edge,edge]); }

// --- KIND registry: the client half of each kind ----------------------------
// mesh:  how to render it.  grab: mouse button (0=left, 2=right) that moves it.
// ldrag: a special left-drag action.  lclick/rclick: click actions (message names).
// Adding a new kind means one entry here + one in the shared KINDS descriptor.
const KIND = {
  die:   { mesh: dieMesh,   grab: 0 },
  card:  { mesh: cardMesh,  grab: 0, lclick: 'takeCard', rclick: 'flip' },
  prop:  { mesh: propMesh,  grab: 0 },
  deck:  { mesh: deckMesh,  grab: 2, ldrag: 'deal', lclick: 'deal', rclick: 'shuffle' },
  board: { mesh: boardMesh },
};

export { KIND, cTex, cardMesh, propColor, measureModel, measureBoard, resizeToCanvas, splitColorText, uploadImage, uploadModel };
