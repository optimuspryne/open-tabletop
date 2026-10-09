import { cardGeom, tileModel } from '../../shared/pieces.js';

// Registered families supply a bounded set of immutable templates. Each instance owns its materials; geometry
// stays shared unless a finish needs generated UVs. Loading never associates a hidden piece
// with its private face: the public props alone select the concealed model.
export function createTileRenderer({
  THREE,
  loader,
  fitModel,
  paintMesh,
  dispose,
  modelOf = tileModel,
}) {
  const templates = new Map();
  const load = (url) => {
    if (!templates.has(url)) {
      const pending = loader.loadAsync(url).then(({ scene }) => {
        scene.traverse((node) => {
          if (node.geometry) node.geometry.userData.sharedCardGeometry = true;
        });
        return scene;
      });
      templates.set(url, pending);
      pending.catch(() => templates.delete(url)); // a transient failure can be retried
    }
    return templates.get(url);
  };
  function mesh(props, fallback) {
    const model = modelOf(props);
    if (!model) return fallback();
    const group = new THREE.Group();
    group.userData.tileModel = true;
    const placeholder = fallback();
    group.add(placeholder);
    group.userData.tileModelReady = load(model.url)
      .then((template) => {
        if (group.userData.ottDisposed) return false;
        const obj = template.clone(true);
        if (model.turn) obj.rotation.y = Math.PI;
        if (model.down) obj.rotation.x = Math.PI;
        const { hw, hh, th } = cardGeom(props);
        fitModel(obj, { size: [hw * 2, th * 2, hh * 2] });
        obj.traverse((node) => {
          node.userData.id = group.userData.id;
          if (node.isMesh) {
            paintMesh(node, props);
            node.castShadow = group.castShadow;
            node.receiveShadow = group.receiveShadow;
          }
        });
        group.remove(placeholder);
        dispose(placeholder);
        group.add(obj);
        group.dispatchEvent({ type: 'tileModelLoaded' });
        return true;
      })
      .catch(() => false); // keep a playable procedural tile on load failure
    return group;
  }
  return { mesh };
}
