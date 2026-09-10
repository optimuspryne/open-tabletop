import { deckHeight } from '../shared/pieces.js';

// A deck mesh may be replaced when its public props change (for example, an open tile set's cover).
// Resolve the live entry on every count update so later deals never resize a detached old mesh.
export function syncDeckMeshHeight(meshes, id, count) {
  const mesh = meshes.get(id)?.mesh;
  if (!mesh) return false;
  mesh.scale.y = deckHeight(count);
  return true;
}
