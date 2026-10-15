import { disposeHierarchy } from '../resources.js';
import { createContactShadows, COZY_SHADOWS } from '../cozy-room-shadows.js';

// One build owns batching, replacement slots and device policy. Theme builders
// receive these operations, never gameplay factories or mutable global state.
export function createRoomAssembly({
  THREE,
  root,
  materials,
  phoneSafe,
  textureAnisotropy,
  modelLoader,
  assets,
  doc,
  isCurrent,
  onChanged,
}) {
  let geometry;
  let contacts;
  const contact = (parent, footprints, height = COZY_SHADOWS.lift) => {
    if (!footprints.length) return;
    contacts ||= createContactShadows(THREE, doc);
    return contacts.add(parent, footprints, height);
  };
  function prepareModelMaterials(model) {
    const replacements = new Map();
    const originalTextures = new Set();
    const retainedTextures = new Set();
    model.traverse((node) => {
      if (!node.isMesh) return;
      node.raycast = () => {};
      node.receiveShadow = !phoneSafe;
      node.castShadow = !phoneSafe;
      const prepare = (source) => {
        if (replacements.has(source)) return replacements.get(source);
        for (const value of Object.values(source))
          if (value?.isTexture) originalTextures.add(value);
        let material = source;
        if (phoneSafe && source.isMeshStandardMaterial) {
          material = new THREE.MeshStandardMaterial().copy(source);
          // Keep base art, alpha cutouts, colors and scalar metal/roughness. Remove
          // the per-pixel detail paths; copy() deliberately omits physical layers.
          for (const key of [
            'normalMap',
            'bumpMap',
            'roughnessMap',
            'metalnessMap',
            'displacementMap',
            'aoMap',
            'lightMap',
            'emissiveMap',
          ])
            material[key] = null;
        }
        for (const value of Object.values(material))
          if (value?.isTexture) {
            value.anisotropy = phoneSafe
              ? 1
              : Math.max(1, Math.min(8, Number(textureAnisotropy) || 1));
            retainedTextures.add(value);
          }
        replacements.set(source, material);
        return material;
      };
      node.material = Array.isArray(node.material)
        ? node.material.map(prepare)
        : prepare(node.material);
    });
    // Each loaded model is independently room-owned. Release only discarded maps;
    // a texture used by another retained material must survive until room cleanup.
    for (const [source, material] of replacements) if (source !== material) source.dispose();
    for (const texture of originalTextures)
      if (
        !retainedTextures.has(texture) &&
        !texture.userData.ottSharedTexture &&
        !texture.userData.ottSharedFinish
      )
        texture.dispose();
  }

  const bins = new Map();
  const modelSlots = new Map();
  function furnishing(kind, parent, fallback, yaw = 0) {
    if (!modelSlots.has(kind)) modelSlots.set(kind, []);
    modelSlots.get(kind).push({ parent, fallback, yaw });
  }
  function box(parent, size, position, color, surface = materials.plain, yaw = 0) {
    if (!bins.has(parent)) bins.set(parent, new Map());
    const key = surface;
    const bucket = bins.get(parent);
    if (!bucket.has(key)) bucket.set(key, []);
    bucket.get(key).push({ size, position, color, yaw });
  }
  function group(name, position = [0, 0, 0], yaw = 0) {
    const node = new THREE.Group();
    node.name = name;
    node.position.set(...position);
    node.rotation.y = yaw;
    root.add(node);
    return node;
  }

  function finish() {
    // Batch repeated boxes by material and cutaway group: books/chairs cost only a few draws.
    const matrix = new THREE.Matrix4(),
      rotation = new THREE.Quaternion(),
      scale = new THREE.Vector3(),
      position = new THREE.Vector3();
    for (const [parent, bucket] of bins)
      for (const [mat, boxes] of bucket) {
        geometry ||= new THREE.BoxGeometry(1, 1, 1);
        const batch = new THREE.InstancedMesh(geometry, mat, boxes.length);
        boxes.forEach((spec, index) => {
          position.set(...spec.position);
          scale.set(...spec.size);
          rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), spec.yaw);
          matrix.compose(position, rotation, scale);
          batch.setMatrixAt(index, matrix);
          batch.setColorAt(index, new THREE.Color(spec.color));
        });
        batch.receiveShadow = true;
        batch.castShadow = !phoneSafe;
        parent.add(batch);
      }
    root.traverse((node) => {
      if (node.isMesh) {
        node.raycast = () => {};
        if (phoneSafe) node.castShadow = node.receiveShadow = false;
      }
    });
  }
  function loadModels(onModelLoaded) {
    // One load per model per room build. Chair copies share resources within this owned root;
    // disposeHierarchy deduplicates them during rebuild/cleanup. Never dispose a live sibling.
    if (modelLoader)
      for (const [kind, slots] of modelSlots) {
        if (!assets[kind]) continue;
        modelLoader.load(
          assets[kind].url,
          ({ scene: model }) => {
            if (!isCurrent()) {
              disposeHierarchy(model);
              return;
            }
            prepareModelMaterials(model);
            for (const { parent, fallback, yaw } of slots) {
              // Hide only fallback meshes. Parent groups also position the authored replacements.
              fallback.traverse((node) => {
                if (node.isMesh && !node.userData.cozyContactShadow) node.visible = false;
              });
              const copy = model.clone(true);
              // Object3D.clone does not copy instance methods such as the picking exclusion.
              copy.traverse((node) => {
                if (node.isMesh) node.raycast = () => {};
              });
              copy.name = assets[kind].resourceName || assets[kind].name;
              copy.scale.multiplyScalar(assets[kind].scale ?? 1);
              copy.rotation.y += yaw;
              parent.add(copy);
            }
            onModelLoaded(kind);
            onChanged();
          },
          undefined,
          () => {}, // A failed optional model leaves the existing procedural furnishing usable.
        );
      }
  }
  return { box, group, furnishing, contact, finish, loadModels };
}
