import * as THREE from 'three';
import {
  NOTECARD,
  NOTECARD_TONES,
  normalizeNotecardPaper,
  notecardStackHeight,
} from '../../shared/notecards.js';
import { drawCanvasStroke } from './strokes.js';
import { releaseCanvasOnDispose } from './resources.js';

// One scratch ink layer per live destination, reclaimed with its canvas/context.
const inkLayers = new WeakMap();
const PAPER_GUIDES = Object.freeze({
  columns: 30,
  line: '#a2adb7',
  dot: '#8d9da9',
  dotRadius: 1 / 600,
});

export function paintNotecard(
  context,
  drawing,
  { back = false, name = '', count = 0, paper } = {},
) {
  const { width, height } = context.canvas;
  const style = normalizeNotecardPaper(paper) || normalizeNotecardPaper();
  context.fillStyle = back ? NOTECARD.back : NOTECARD_TONES[style.tone];
  context.fillRect(0, 0, width, height);
  let ink = inkLayers.get(context);
  if (ink) ink.getContext('2d').clearRect(0, 0, ink.width, ink.height);
  if (back) {
    context.strokeStyle = '#91a5b5';
    context.lineWidth = 3;
    context.strokeRect(width * 0.04, height * 0.06, width * 0.92, height * 0.88);
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    context.font = `600 ${Math.round(width * 0.035)}px sans-serif`;
    context.fillText(
      name
        ? `${name} is drawing`
        : count
          ? `${count} NOTECARD${count === 1 ? '' : 'S'}`
          : 'NOTECARD',
      width / 2,
      height / 2,
      width * 0.85,
    );
  } else {
    // Pattern spacing follows the paper, so thumbnails and zoomed faces agree.
    const step = width / PAPER_GUIDES.columns;
    context.strokeStyle = PAPER_GUIDES.line;
    context.fillStyle = PAPER_GUIDES.dot;
    context.lineWidth = width / NOTECARD.canvasWidth;
    context.beginPath();
    if (style.pattern === 'ruled' || style.pattern === 'grid') {
      for (let y = step; y < height; y += step) {
        context.moveTo(0, y);
        context.lineTo(width, y);
      }
      if (style.pattern === 'grid')
        for (let x = step; x < width; x += step) {
          context.moveTo(x, 0);
          context.lineTo(x, height);
        }
      context.stroke();
    } else if (style.pattern === 'dots') {
      for (let y = step; y < height; y += step)
        for (let x = step; x < width; x += step) {
          context.beginPath();
          context.arc(x, y, width * PAPER_GUIDES.dotRadius, 0, Math.PI * 2);
          context.fill();
        }
    }
    if (!ink) {
      ink = document.createElement('canvas');
      inkLayers.set(context, ink);
    }
    if (ink.width !== width || ink.height !== height) {
      ink.width = width;
      ink.height = height;
    }
    const inkContext = ink.getContext('2d');
    for (const stroke of drawing || []) {
      inkContext.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
      drawCanvasStroke(inkContext, stroke, width, height, '#000000', 1);
    }
    context.drawImage(ink, 0, 0);
  }
}

export function notecardMesh(props = {}) {
  const texture = (back) => {
    const canvas = document.createElement('canvas');
    canvas.width = NOTECARD.canvasWidth;
    canvas.height = NOTECARD.canvasHeight;
    paintNotecard(canvas.getContext('2d'), props.drawing, {
      paper: props.paper,
      back,
      name: props.editingName || '',
      count: props.stackCount || 0,
    });
    const map = releaseCanvasOnDispose(new THREE.CanvasTexture(canvas), canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    return map;
  };
  const edge = new THREE.MeshStandardMaterial({ color: 0xd4cebb, roughness: 0.8 });
  const back = new THREE.MeshStandardMaterial({ map: texture(true), roughness: 0.8 });
  const front =
    props.faceDown || props.editing
      ? back
      : new THREE.MeshStandardMaterial({ map: texture(false), roughness: 0.8 });
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(
      NOTECARD.width,
      props.stackCount ? notecardStackHeight(props.stackCount) : NOTECARD.thickness,
      NOTECARD.height,
    ),
    [edge, edge, front, back, edge, edge],
  );
  mesh.userData.notecard = true;
  return mesh;
}

export function notecardStackMesh(props = {}) {
  const mesh = notecardMesh({
    ...props,
    drawing: [],
    faceDown: true,
    stackCount: props.count || 1,
  });
  const count = Math.max(1, Math.min(NOTECARD.maxCards, props.count || 1));
  // Thin seams make the physical stack legible without allocating a texture per card.
  const positions = [];
  for (let i = 1; i < count; i++) {
    const y = -notecardStackHeight(count) / 2 + i * NOTECARD.thickness;
    const x = NOTECARD.width / 2 + 0.001,
      z = NOTECARD.height / 2 + 0.001;
    positions.push(-x, y, -z, x, y, -z, x, y, -z, x, y, z, x, y, z, -x, y, z, -x, y, z, -x, y, -z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  mesh.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xa49e8e })));
  return mesh;
}
