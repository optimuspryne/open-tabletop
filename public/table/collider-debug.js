import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { meshPropsOf } from './piece-view.js';

const STORAGE_KEY = 'ott-show-colliders';

export function createColliderDebug({ scene, getPieces, getMesh, getRank, colliderSpec, storage }) {
  const groups = new Map();
  let enabled = storage.getItem(STORAGE_KEY) === '1';

  const disposeGroup = (group) => {
    if (!group) return;
    scene.remove(group);
    group.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => material?.dispose());
    });
  };

  function buildGroup(spec) {
    if (spec.type === 'compound') {
      const group = new THREE.Group();
      group.userData.localOffset = new THREE.Vector3();
      for (const part of spec.shapes) {
        const child = buildGroup(part);
        child.position.copy(child.userData.localOffset);
        child.rotation.set(...part.rotation);
        group.add(child);
      }
      return group;
    }

    let geometry;
    if (spec.type === 'sphere') geometry = new THREE.SphereGeometry(spec.radius, 20, 12);
    else if (spec.type === 'cylinder') {
      geometry = new THREE.CylinderGeometry(
        spec.radiusTop,
        spec.radiusBottom,
        spec.height,
        spec.sides,
      );
    } else if (spec.type === 'convex') {
      geometry = new ConvexGeometry(spec.vertices.map((vertex) => new THREE.Vector3(...vertex)));
    } else {
      const [hx, hy, hz] = spec.halfExtents;
      geometry = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
    }

    const group = new THREE.Group();
    const fill = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: 0x20e0ff,
        transparent: true,
        opacity: 0.12,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: 0x20e0ff,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
      }),
    );
    group.add(fill, edges);
    group.userData.localOffset = new THREE.Vector3().fromArray(spec.offset || [0, 0, 0]);
    group.renderOrder = 1000;
    group.traverse((node) => {
      node.renderOrder = 1000;
      node.raycast = () => {};
    });
    return group;
  }

  function update(id, mesh = getMesh(id)) {
    const group = groups.get(id);
    if (!group || !mesh) return false;
    group.quaternion.copy(mesh.quaternion);
    group.position
      .copy(group.userData.localOffset)
      .applyQuaternion(mesh.quaternion)
      .add(mesh.position);
    group.visible = mesh.visible;
    return true;
  }

  function remove(id) {
    const group = groups.get(id);
    if (!group) return false;
    disposeGroup(group);
    groups.delete(id);
    return true;
  }

  function refresh(id, piece) {
    remove(id);
    if (!enabled || getRank() < 2 || !piece) return false;
    const spec = colliderSpec(piece.type, meshPropsOf(piece, id), { count: piece.count });
    if (!spec) return false;
    const group = buildGroup(spec);
    groups.set(id, group);
    update(id);
    scene.add(group);
    return true;
  }

  function dispose() {
    for (const group of groups.values()) disposeGroup(group);
    groups.clear();
  }

  function sync() {
    dispose();
    if (!enabled || getRank() < 2) return;
    getPieces()?.forEach((piece, id) => refresh(id, piece));
  }

  function setEnabled(on) {
    enabled = !!on;
    storage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    sync();
  }

  return {
    refresh,
    remove,
    sync,
    setEnabled,
    isEnabled: () => enabled,
    update,
    dispose,
  };
}
