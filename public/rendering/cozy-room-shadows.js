import { releaseCanvasOnDispose } from './resources.js';

export const COZY_SHADOWS = Object.freeze({ size: 128, lift: 0.085, opacity: 0.7 });

// One tiny map/material/plane per room. Attached batches own these resources through
// the normal room hierarchy; clones own only their instance buffers.
export function createContactShadows(THREE, doc) {
  const canvas = doc.createElement('canvas');
  canvas.width = canvas.height = COZY_SHADOWS.size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.width = canvas.height = 0;
    return { add() {} };
  }
  const half = COZY_SHADOWS.size / 2;
  const gradient = ctx.createRadialGradient(half, half, 4, half, half, half);
  gradient.addColorStop(0, 'rgba(0,0,0,.42)');
  gradient.addColorStop(0.45, 'rgba(0,0,0,.22)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, COZY_SHADOWS.size, COZY_SHADOWS.size);
  const texture = releaseCanvasOnDispose(new THREE.CanvasTexture(canvas), canvas);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    opacity: COZY_SHADOWS.opacity,
    toneMapped: false,
  });
  const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  return {
    add(parent, footprints, height = COZY_SHADOWS.lift) {
      if (!footprints.length) return;
      const mesh = new THREE.InstancedMesh(geometry, material, footprints.length);
      const transform = new THREE.Matrix4();
      footprints.forEach(({ x = 0, z = 0, width, depth }, i) => {
        transform.makeScale(width, 1, depth).setPosition(x, height, z);
        mesh.setMatrixAt(i, transform);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.name = 'Furniture contact shading';
      mesh.userData.cozyContactShadow = true;
      mesh.raycast = () => {};
      parent.add(mesh);
      return mesh;
    },
  };
}
