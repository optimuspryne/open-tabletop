import * as THREE from 'three';
import { NOTECARD, notecardStackHeight } from '../../shared/notecards.js';
import { drawCanvasStroke } from './strokes.js';
import { releaseCanvasOnDispose } from './resources.js';

export function paintNotecard(context, drawing, { back = false, name = '', count = 0 } = {}) {
  const { width, height } = context.canvas;
  context.fillStyle = back ? NOTECARD.back : NOTECARD.paper;
  context.fillRect(0, 0, width, height);
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
    for (const stroke of drawing || [])
      drawCanvasStroke(context, stroke, width, height, NOTECARD.paper, 1);
  }
}

export function notecardMesh(props = {}) {
  const texture = (back) => {
    const canvas = document.createElement('canvas');
    canvas.width = NOTECARD.canvasWidth;
    canvas.height = NOTECARD.canvasHeight;
    paintNotecard(canvas.getContext('2d'), props.drawing, {
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
