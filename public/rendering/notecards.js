import * as THREE from 'three';
import { NOTECARD } from '../../shared/notecards.js';
import { drawCanvasStroke } from './strokes.js';
import { releaseCanvasOnDispose } from './resources.js';

export function paintNotecard(context, drawing, { back = false, name = '' } = {}) {
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
    context.fillText(name ? `${name} is drawing` : 'NOTECARD', width / 2, height / 2, width * 0.85);
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
    paintNotecard(canvas.getContext('2d'), props.drawing, { back, name: props.editingName || '' });
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
    new THREE.BoxGeometry(NOTECARD.width, NOTECARD.thickness, NOTECARD.height),
    [edge, edge, front, back, edge, edge],
  );
  mesh.userData.notecard = true;
  return mesh;
}
