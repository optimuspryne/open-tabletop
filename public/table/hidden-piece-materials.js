const GHOST_OPACITY = 0.38;

// Per-instance material copies preserve authored/shared materials. Restoring before mesh disposal
// lets each kind retain ownership of its normal resources. New async model children are included.
export function createHiddenPieceMaterials() {
  const roots = new WeakMap();
  const nodes = new WeakMap();
  function restore(node, entry) {
    node.material = entry.original;
    node.castShadow = entry.castShadow;
    for (const material of entry.copies) material.dispose();
    nodes.delete(node);
  }
  function update(mesh, hidden) {
    const previous = roots.get(mesh) || new Set();
    const current = new Set();
    mesh.traverse((node) => {
      const old = nodes.get(node);
      if (!hidden) {
        if (old) restore(node, old);
        return;
      }
      if (old) current.add(node);
      if (old || !node.isMesh || !node.material) return;
      const originals = Array.isArray(node.material) ? node.material : [node.material];
      const copies = originals.map((material) => {
        const copy = material.clone();
        copy.transparent = true;
        copy.opacity = material.opacity * GHOST_OPACITY;
        copy.depthWrite = false;
        return copy;
      });
      nodes.set(node, { original: node.material, castShadow: node.castShadow, copies });
      current.add(node);
      node.material = Array.isArray(node.material) ? copies : copies[0];
      node.castShadow = false;
    });
    for (const node of previous) {
      if (!current.has(node) && nodes.has(node)) restore(node, nodes.get(node));
    }
    if (current.size) roots.set(mesh, current);
    else roots.delete(mesh);
  }
  return { update, restore: (mesh) => update(mesh, false) };
}
