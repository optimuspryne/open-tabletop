import { disposeHierarchy } from '../resources.js';
import { createRoomAssembly } from './room-assembly.js';
import { createRoomSeating } from './room-seating.js';

// Own the local backdrop lifecycle. A theme supplies component builders and art;
// this owner supplies dimensions, occupancy, cutaways, GPU policy and cleanup.
export function createRoomEnvironment({
  theme,
  THREE,
  scene,
  modelLoader,
  seatLayoutFor,
  deviceClass = () => 'desktop',
  textureAnisotropy = 1,
  doc = document,
  onChanged = () => {},
  onShadowBoundsChanged = () => {},
}) {
  if (!theme?.structure?.build || !theme?.atmosphere?.createMaterials)
    throw new TypeError('A room theme needs structure and atmosphere builders');
  const phoneSafe = deviceClass() === 'phone';
  let root = null;
  let materials = {};
  let walls = [];
  let ceiling = null;
  let seating = null;
  let lastSize = '';
  let disposed = false;

  function clear() {
    if (!root) return;
    scene.remove(root);
    root.traverse((node) => {
      if (node.isInstancedMesh) node.dispose();
    });
    // Optional components may leave part of the palette unused by any mesh.
    disposeHierarchy(root, Object.values(materials));
    onShadowBoundsChanged(null);
    root = null;
    materials = {};
    walls = [];
    ceiling = null;
    seating = null;
    lastSize = '';
  }

  function sync({ tableX, tableZ, tableShape = 'rect', players }) {
    if (
      disposed ||
      !Number.isFinite(tableX) ||
      !Number.isFinite(tableZ) ||
      tableX <= 0 ||
      tableZ <= 0
    )
      return;
    const key = `${tableX}:${tableZ}:${tableShape}`;
    if (key === lastSize) return seating?.sync(players);
    clear();
    const config = theme.structure;
    const hx = tableX,
      hz = tableShape === 'round' ? tableX : tableZ;
    const rx = Math.max(config.minimumHalfSize, hx + config.clearance);
    const rz = Math.max(config.minimumHalfSize, hz + config.clearance);
    const floor = config.floorY,
      top = floor + config.wallHeight;
    const layout = Object.freeze({ tableX, tableZ, tableShape, hx, hz, rx, rz, floor, top });
    root = new THREE.Group();
    root.name = theme.rootName || theme.name;
    root.userData.halfSize = { x: rx, z: rz };
    root.userData.roomTheme = theme.id;
    const buildRoot = root;
    const isCurrent = () => root === buildRoot && !disposed;
    const changed = () => {
      if (isCurrent()) onChanged();
    };
    try {
      materials = theme.atmosphere.createMaterials(THREE, changed, phoneSafe);
      const assembly = createRoomAssembly({
        THREE,
        root,
        materials,
        phoneSafe,
        textureAnisotropy,
        modelLoader,
        assets: theme.assets || {},
        doc,
        isCurrent,
        onChanged: changed,
      });
      const dependencies = Object.freeze({
        THREE,
        root,
        layout,
        materials,
        assembly,
        phoneSafe,
        textureAnisotropy,
        doc,
      });
      const structure = theme.structure.build(dependencies) || {};
      walls = structure.walls || [];
      ceiling = structure.ceiling || null;
      walls = [...walls, ...(ceiling?.gables || [])];
      const openings = theme.openings?.build?.({ ...dependencies, structure }) || {};
      const playArea = theme.playArea?.build?.({ ...dependencies, structure, openings }) || {};
      const furnishings =
        theme.furnishings?.build?.({ ...dependencies, structure, openings, playArea }) || {};
      theme.decoration?.build?.({ ...dependencies, structure, openings, playArea, furnishings });
      if (playArea.chairTemplate) {
        const asset = theme.assets?.[playArea.chairModel];
        seating = createRoomSeating({
          THREE,
          root,
          layout,
          chairTemplate: playArea.chairTemplate,
          seatLayoutFor,
          clearance: theme.playArea.chairClearance,
          name: theme.playArea.chairName,
          resourceName: asset?.resourceName,
          modelName: asset?.name,
          onChanged: changed,
        });
      }
      assembly.finish();
      scene.add(root);
      lastSize = key;
      const shadowPadding = ceiling ? 1 : 0;
      onShadowBoundsChanged(
        phoneSafe
          ? null
          : new THREE.Box3(
              new THREE.Vector3(-rx - shadowPadding, floor, -rz - shadowPadding),
              new THREE.Vector3(rx + shadowPadding, ceiling?.top ?? top, rz + shadowPadding),
            ),
      );
      seating?.sync(players);
      changed();
      assembly.loadModels((kind) => {
        if (kind === playArea.chairModel) seating?.refresh();
      });
    } catch (error) {
      clear();
      throw error;
    }
  }

  function update(cameraPosition, target) {
    if (!root || disposed) return;
    const dx = cameraPosition.x - target.x,
      dz = cameraPosition.z - target.z;
    const length = Math.hypot(dx, dz);
    const overhead = cameraPosition.y - target.y > length * theme.structure.overheadSlope;
    let changed = false;
    if (ceiling) {
      // Below the eaves the roof cannot obstruct the playable tabletop. Above
      // them it cuts away as a whole, including its shadows and gable infills.
      const visible = !overhead && cameraPosition.y < ceiling.hideAbove;
      if (ceiling.group.visible !== visible) {
        ceiling.group.visible = visible;
        changed = true;
      }
    }
    for (const wall of walls) {
      const towardCamera =
        length > 0.001 &&
        (wall.normal[0] * dx + wall.normal[1] * dz) / length > theme.structure.cutawayThreshold;
      const visible = !towardCamera && !overhead;
      if (wall.group.visible !== visible) {
        wall.group.visible = visible;
        changed = true;
      }
    }
    if (changed) onChanged();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    clear();
    onChanged();
  }
  return { sync, update, dispose };
}
