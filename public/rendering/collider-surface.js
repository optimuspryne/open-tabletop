import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';

// Invisible collision geometry, independent of model detail and the diagnostics toggle.
export function createColliderSurface(spec) {
  const root = new THREE.Group();
  root.position.fromArray(spec.offset || [0, 0, 0]);
  root.rotation.set(...(spec.rotation || [0, 0, 0]));
  if (spec.type === 'compound') {
    for (const part of spec.shapes) root.add(createColliderSurface(part));
  } else {
    const geometry =
      spec.type === 'sphere'
        ? new THREE.SphereGeometry(spec.radius, 32, 20)
        : spec.type === 'cylinder'
          ? new THREE.CylinderGeometry(spec.radiusTop, spec.radiusBottom, spec.height, spec.sides)
          : spec.type === 'convex'
            ? new ConvexGeometry(spec.vertices.map((v) => new THREE.Vector3(...v)))
            : new THREE.BoxGeometry(...spec.halfExtents.map((v) => v * 2));
    root.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.FrontSide })));
  }
  return root;
}

export function disposeColliderSurface(root) {
  root.traverse((node) => {
    node.geometry?.dispose();
    node.material?.dispose();
  });
}

const ray = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);
const origin = new THREE.Vector3();

// Query below the held piece, excluding elevated structures above it and all other pieces.
export function colliderSurfaceHeight(root, x, z, fromY) {
  root.updateMatrixWorld(true);
  ray.set(origin.set(x, fromY, z), down);
  ray.far = Math.max(0, fromY);
  const hit = ray.intersectObject(root, true)[0];
  return hit ? Math.max(0, hit.point.y) : 0;
}
