import * as THREE from 'three';
import { compoundColliderSpec, normalizeCompoundCollider } from '/shared/compound-collider.js';
import { createColliderSurface, disposeColliderSurface } from './collider-surface.js';

export function groupBounds(shapes) {
  const root = createColliderSurface(compoundColliderSpec({ version: 1, shapes }, [0.5, 0.5, 0.5]));
  const bounds = new THREE.Box3().setFromObject(root, true);
  disposeColliderSurface(root);
  return bounds;
}

// Apply the same rigid transform to every component; reject the whole operation at limits.
export function transformGroup(
  layout,
  indices,
  { position = [0, 0, 0], rotation = [0, 0, 0], scale = 1 } = {},
) {
  const next = structuredClone(layout);
  const pivot = groupBounds(indices.map((i) => layout.shapes[i])).getCenter(new THREE.Vector3());
  const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation));
  for (const i of indices) {
    const shape = next.shapes[i];
    shape.position = new THREE.Vector3(...shape.position)
      .sub(pivot)
      .multiplyScalar(scale)
      .applyQuaternion(turn)
      .add(pivot)
      .add(new THREE.Vector3(...position))
      .toArray();
    const orientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...shape.rotation));
    const euler = new THREE.Euler().setFromQuaternion(turn.clone().multiply(orientation));
    shape.rotation = [euler.x, euler.y, euler.z];
    shape.size = shape.size.map((v) => v * scale);
  }
  return normalizeCompoundCollider(next);
}

export function captureGroup(shapes, unit) {
  if (!shapes.length) throw new Error('Select at least one shape to save.');
  const bounds = groupBounds(shapes);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = Math.max(...bounds.getSize(new THREE.Vector3()).toArray());
  const layout = normalizeCompoundCollider({
    version: 1,
    shapes: shapes.map((shape) => ({
      ...structuredClone(shape),
      position: new THREE.Vector3(...shape.position).sub(center).divideScalar(size).toArray(),
      size: shape.size.map((v) => v / size),
    })),
  });
  if (!layout) throw new Error('This group has components too small relative to its overall size.');
  return { layout, size: size * unit };
}

export function insertGroup(draft, preset, size, unit) {
  const factor = size / unit;
  const copies = preset.layout.shapes.map((shape) => ({
    ...structuredClone(shape),
    position: shape.position.map((v) => v * factor),
    size: shape.size.map((v) => v * factor),
  }));
  const next = normalizeCompoundCollider({ version: 1, shapes: [...draft.shapes, ...copies] });
  if (!next)
    throw new Error('The preset exceeds the 16-physics-part budget or supported size range.');
  return next;
}

// Generate a thumbnail from collider geometry, without saving a model or external image.
export function drawGroupThumbnail(canvas, layout) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!layout) return;
  const root = createColliderSurface(compoundColliderSpec(layout, [0.5, 0.5, 0.5]));
  root.updateMatrixWorld(true);
  const points = [];
  const camera = new THREE.PerspectiveCamera(40, canvas.width / canvas.height, 0.01, 100);
  const bounds = new THREE.Box3().setFromObject(root, true);
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = bounds.getSize(new THREE.Vector3()).length();
  camera.position
    .copy(center)
    .add(new THREE.Vector3(1.5, 1.1, 1.5).normalize().multiplyScalar(radius * 1.5));
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
  root.traverse((node) => {
    if (!node.geometry) return;
    const edges = new THREE.EdgesGeometry(node.geometry);
    const vertices = edges.getAttribute('position');
    for (let i = 0; i < vertices.count; i++)
      points.push(
        new THREE.Vector3()
          .fromBufferAttribute(vertices, i)
          .applyMatrix4(node.matrixWorld)
          .project(camera),
      );
    edges.dispose();
  });
  ctx.strokeStyle = '#56d3ff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < points.length; i += 2) {
    ctx.moveTo(((points[i].x + 1) * canvas.width) / 2, ((1 - points[i].y) * canvas.height) / 2);
    ctx.lineTo(
      ((points[i + 1].x + 1) * canvas.width) / 2,
      ((1 - points[i + 1].y) * canvas.height) / 2,
    );
  }
  ctx.stroke();
  disposeColliderSurface(root);
}
