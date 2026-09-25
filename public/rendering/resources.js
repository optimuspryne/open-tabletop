// Release backing stores explicitly: disposing a GPU texture alone leaves its canvas allocated.
export function releaseCanvasOnDispose(texture, canvas) {
  texture.addEventListener('dispose', () => {
    canvas.width = canvas.height = 0;
  });
  return texture;
}

// For independently built meshes only. Borrowed card/dispenser clones must not use this.
// Shared procedural maps remain usable by other dice and by subsequent previews.
export function disposeHierarchy(root) {
  if (!root || root.userData.ottDisposed) return;
  root.userData.ottDisposed = true;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((node) => {
    if (node.geometry) geometries.add(node.geometry);
    for (const material of Array.isArray(node.material)
      ? node.material
      : node.material
        ? [node.material]
        : []) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture && !value.userData.ottSharedTexture && !value.userData.ottSharedFinish)
          textures.add(value);
      }
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}
