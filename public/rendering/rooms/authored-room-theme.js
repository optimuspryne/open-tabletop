import { ROOM_COMPANION_ASSETS } from './room-companion.js';
import { createOakFloor, createPlasterPanel } from '../cozy-room-surfaces.js';
import { wallOpeningPanels } from './wall-openings.js';
import { buildRoomPaving } from './room-paving.js';
import { tableOutline } from '../../../shared/pieces.js';
import { TABLE_FINISH } from '../table-geometry.js';

// Nine studies share collection ownership, metre scale and staged-table exclusion.
// Keep their native dressing rigid while the enclosing shell follows table size.
export const AUTHORED_ROOM = Object.freeze({
  floorY: -6.377,
  wallHeight: 24.29,
  minimumHalfSize: 32,
  clearance: 24,
  gardenClearance: 28,
  modelScale: 7,
  chairClearance: 3.2,
  cutawayHysteresis: 0.15,
});

function createMaterials(THREE, onLoad, phoneSafe, config) {
  const wood = config.sci ? null : new THREE.TextureLoader().load('/textures/wood-oak.png', onLoad);
  if (wood) {
    wood.colorSpace = THREE.SRGBColorSpace;
    wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
  }
  const normal = phoneSafe
    ? null
    : new THREE.TextureLoader().load('/textures/tavern-plaster-normal.png', onLoad);
  if (normal) normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  return {
    plain: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 }),
    wood: new THREE.MeshStandardMaterial({
      color: '#' + config.wood,
      map: config.sci ? null : wood,
      metalness: config.sci ? 0.65 : 0,
      roughness: 0.48,
    }),
    floor: new THREE.MeshStandardMaterial({
      color: '#' + config.floor,
      map: config.sci || config.garden ? null : wood,
      roughness: 0.67,
    }),
    wall: new THREE.MeshStandardMaterial({
      color: '#' + config.wall,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.15, 0.15),
      roughness: 0.8,
    }),
    seat: new THREE.MeshStandardMaterial({ color: '#' + config.seat, roughness: 0.8 }),
    metal: new THREE.MeshStandardMaterial({
      color: '#' + config.metal,
      roughness: 0.42,
      metalness: 0.72,
    }),
    stone: new THREE.MeshStandardMaterial({ color: '#' + config.wall, roughness: 0.86 }),
  };
}

function placeModel({ THREE, assembly, materials }, parent, kind, position, prepare) {
  const slot = new THREE.Group();
  slot.name = kind + ' slot';
  slot.position.set(...position);
  parent.add(slot);
  const fallback = new THREE.Group();
  slot.add(fallback);
  // Small peripheral fallback, hidden after load; architecture stays usable on failure.
  if (['north', 'south', 'east', 'west'].includes(kind))
    assembly.box(fallback, [2, 2, 1], [0, 1, 2], '#ffffff', materials.wood);
  assembly.furnishing(kind, slot, fallback, 0, prepare);
  return slot;
}

function buildStructure(dependencies, config) {
  const { THREE, root, layout, materials, assembly } = dependencies;
  const { rx, rz, floor, top } = layout;
  // A continuous backing keeps tile/plank joints from revealing the sky below.
  assembly.box(root, [rx * 2, 0.3, rz * 2], [0, floor - 0.3, 0], '#ffffff', materials.floor);
  if (config.garden)
    buildRoomPaving(dependencies, {
      ...AUTHORED_ROOM,
      name: config.title,
      maximumPaverAxis: 32,
      paverStep: 7,
      paverGap: 0.105,
    });
  else if (config.sci)
    root.add(
      createPlasterPanel(THREE, [rx * 2, 0.18, rz * 2], [0, floor - 0.09, 0], materials.floor),
    );
  else root.add(createOakFloor(THREE, rx, rz, floor, materials.floor));
  const specs = [
    ['north', [0, 0, -rz], 0, rx * 2, [0, 0, -1]],
    ['south', [0, 0, rz], Math.PI, rx * 2, [0, 0, 1]],
    ['east', [rx, 0, 0], -Math.PI / 2, rz * 2, [1, 0, 0]],
    ['west', [-rx, 0, 0], Math.PI / 2, rz * 2, [-1, 0, 0]],
  ];
  const walls = specs.map(([id, position, yaw, width, direction]) => {
    const wall = assembly.group(config.title + ' ' + id + ' wall', position, yaw);
    const [x, w, z, h] = config.opening;
    const aperture =
      id === 'north'
        ? { x: x * 7, width: w * 7, bottom: floor + (z - h / 2) * 7, top: floor + (z + h / 2) * 7 }
        : config.garden && ['east', 'west'].includes(id)
          ? { x: 0, width: width - 0.6, bottom: floor + 4.2, top: floor + 23.8 }
          : null;
    for (const [w, h, x, y] of wallOpeningPanels(width, floor, top, aperture))
      wall.add(createPlasterPanel(THREE, [w, h, 1.26], [x, y, 0], materials.wall));
    assembly.box(wall, [width, 1.68, 0.7], [0, floor + 0.84, 0.91], '#ffffff', materials.wood);
    if (!config.sci)
      assembly.box(wall, [width, 1.12, 0.91], [0, floor + 22.75, 0.91], '#ffffff', materials.wood);
    const normal = new THREE.Vector3(...direction);
    return {
      group: wall,
      cutawayPlanes: [new THREE.Plane(normal, -normal.dot(wall.position) + 0.3)],
    };
  });
  const anchors = new Map(specs.map(([id], i) => [id, walls[i]]));
  const ceiling = assembly.group(config.title + ' ceiling', [0, floor, 0]);
  placeModel(dependencies, ceiling, 'roof', [0, 0, 0], (model) => {
    // Stretch only structural roof members. Separate fixtures keep round canopies.
    model.scale.x *= rx / 31.5;
    model.scale.z *= rz / 26.1;
  });
  return {
    walls,
    anchors,
    ceiling: {
      group: ceiling,
      top: floor + config.roofHeight * 7,
      cutawayPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), -top + 0.15)],
    },
  };
}

function buildPlayArea({ layout, assembly, materials }, config) {
  const { hx, floor } = layout;
  const depth = Math.max(
    ...tableOutline(layout.tableShape, hx, layout.hz).map((p) => Math.abs(p.z)),
  );
  const supports = assembly.group(config.title + ' table supports');
  const width = Math.min(1.5, hx * 0.25, depth * 0.35);
  for (const x of [-hx * 0.55, hx * 0.55]) {
    assembly.box(
      supports,
      [width * 1.5, 0.6, depth],
      [x, floor + 0.3, 0],
      '#ffffff',
      materials.wood,
    );
    assembly.box(
      supports,
      [width, TABLE_FINISH.rimBase - floor - 0.6, depth * 0.65],
      [x, (TABLE_FINISH.rimBase + floor + 0.6) / 2, 0],
      '#ffffff',
      materials.wood,
    );
  }
  const template = assembly.group(config.title + ' chair resources');
  template.visible = false;
  for (const x of [-1.6, 1.6])
    for (const z of [-1.4, 1.4])
      assembly.box(template, [0.35, 3.2, 0.35], [x, 1.6, z], '#ffffff', materials.wood);
  assembly.box(template, [3.8, 0.6, 3.5], [0, 3.5, 0], '#ffffff', materials.seat);
  assembly.box(template, [3.8, 3.6, 0.65], [0, 5.6, 1.5], '#ffffff', materials.seat);
  assembly.contact(template, [{ width: 4.8, depth: 4.8 }]);
  // Native local back is +Y in Blender / -Z in glTF; seat owners expect +Z.
  assembly.furnishing('chair', template, template, Math.PI);
  return { chairTemplate: template, chairModel: 'chair' };
}

function buildFurnishings(dependencies, config) {
  const { structure, layout, root } = dependencies;
  for (const kind of ['north', 'south', 'west', 'east'])
    if (config.assetKeys.includes(kind))
      placeModel(
        dependencies,
        structure.anchors.get(kind).group,
        kind,
        [0, layout.floor, config.wallOffsets?.[kind] ?? 0],
        config.wallSpans?.[kind]
          ? (model) => {
              const width = ['north', 'south'].includes(kind) ? layout.rx * 2 : layout.rz * 2;
              model.scale.x *= width / (config.wallSpans[kind] * AUTHORED_ROOM.modelScale);
            }
          : undefined,
      );
  if (config.assetKeys.includes('floor-decor'))
    placeModel(dependencies, root, 'floor-decor', [0, layout.floor, 0], (model) => {
      // Rugs follow the playable envelope; they never define tabletop geometry.
      model.scale.x *= Math.max(1, (layout.hx + 4) / 18.375);
      model.scale.z *= Math.max(1, (layout.hz + 4) / 14.7);
    });
  for (const fixture of config.fixtures)
    placeModel(dependencies, structure.ceiling.group, fixture.kind, [
      (fixture.position[0] * 7 * layout.rx) / 31.5,
      fixture.position[1] * 7,
      (fixture.position[2] * 7 * layout.rz) / 26.1,
    ]);
}

export function createAuthoredRoomTheme(config) {
  const assets = {
    ...ROOM_COMPANION_ASSETS,
    ...Object.fromEntries(
      config.assetKeys.map((kind) => [
        kind,
        Object.freeze({
          url: `/models/environments/${config.id}/${kind}.glb`,
          scale: 7,
          name: config.title + ' ' + kind + ' model',
          ...(kind === 'chair' ? { resourceName: config.title + ' chair model resource' } : {}),
        }),
      ]),
    ),
  };
  return Object.freeze({
    id: config.id,
    name: config.title,
    structure: Object.freeze({
      ...AUTHORED_ROOM,
      clearance: config.garden ? AUTHORED_ROOM.gardenClearance : AUTHORED_ROOM.clearance,
      build: (dependencies) => buildStructure(dependencies, config),
    }),
    openings: Object.freeze({}),
    playArea: Object.freeze({
      build: (dependencies) => buildPlayArea(dependencies, config),
      chairClearance: AUTHORED_ROOM.chairClearance,
      chairName: config.title + ' occupied chair',
    }),
    furnishings: Object.freeze({ build: (dependencies) => buildFurnishings(dependencies, config) }),
    decoration: Object.freeze({}),
    atmosphere: Object.freeze({
      createMaterials: (THREE, onLoad, phoneSafe) =>
        createMaterials(THREE, onLoad, phoneSafe, config),
    }),
    assets: Object.freeze(assets),
    matchingTable: Object.freeze({
      rimWood: config.matchingWood,
      feltColor: '#' + config.felt,
      description:
        (config.matchingWood === 'oak' ? 'Oak' : 'Walnut') + ' wood and quiet matching felt',
    }),
  });
}
