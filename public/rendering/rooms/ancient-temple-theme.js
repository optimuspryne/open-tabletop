import { buildRoomPaving } from './room-paving.js';
import { ROOM_COMPANION_ASSETS } from './room-companion.js';
import { createPlasterPanel } from '../cozy-room-surfaces.js';
import { wallOpeningPanels } from './wall-openings.js';
import { tableOutline } from '../../../shared/pieces.js';
import { TABLE_FINISH } from '../table-geometry.js';

export const ANCIENT_TEMPLE = Object.freeze({
  floorY: -6.377,
  wallHeight: 24.29,
  clearance: 22,
  minimumHalfSize: 32,
  modelScale: 7,
  chairClearance: 3.2,
  cutawayInset: 0.3,
  cutawayHysteresis: 0.15,
  openingWidth: 54.6,
  openingBottom: 6.125,
  openingTop: 21.175,
  frameInset: 0.595,
  columnInset: 2.59,
  columnOffsets: Object.freeze([-25.55, -8.75, 8.75, 25.55]),
  brazierOffset: 24.5,
  brazierInset: 9.24,
  doorOffsetRatio: -0.6,
  doorWidth: 8.26,
  doorHeight: 17.64,
  doorSurroundWidth: 9.8,
  paverStep: 7,
  paverGap: 0.105,
  maximumPaverAxis: 32,
});

function createMaterials(THREE, onLoad, phoneSafe) {
  const normal = phoneSafe
    ? null
    : new THREE.TextureLoader().load('/textures/tavern-stone-normal.png', onLoad);
  if (normal) normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  return {
    plain: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }),
    stone: new THREE.MeshStandardMaterial({
      color: '#b5a88c',
      roughness: 0.86,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.18, 0.18),
    }),
    trim: new THREE.MeshStandardMaterial({ color: '#8f8268', roughness: 0.65 }),
    bronze: new THREE.MeshStandardMaterial({ color: '#80734e', roughness: 0.42, metalness: 0.72 }),
  };
}

function buildPaving(dependencies) {
  buildRoomPaving(dependencies, { ...ANCIENT_TEMPLE, name: 'Temple' });
}

function buildStructure(dependencies) {
  const { THREE, root, layout, materials, assembly } = dependencies;
  const { floor, top, rx, rz } = layout;
  const { box, group } = assembly;
  box(root, [rx * 2, 0.3, rz * 2], [0, floor - 0.15, 0], '#ffffff', materials.trim);
  buildPaving(dependencies);
  const specs = [
    ['north', [0, 0, -rz], 0, rx * 2, [0, 0, -1]],
    ['south', [0, 0, rz], Math.PI, rx * 2, [0, 0, 1]],
    ['east', [rx, 0, 0], -Math.PI / 2, rz * 2, [1, 0, 0]],
    ['west', [-rx, 0, 0], Math.PI / 2, rz * 2, [-1, 0, 0]],
  ];
  const walls = specs.map(([id, position, yaw, width, direction]) => {
    const wall = group(`Temple ${id} wall`, position, yaw),
      config = ANCIENT_TEMPLE;
    const opening =
      id === 'north'
        ? {
            x: 0,
            width: config.openingWidth,
            bottom: floor + config.openingBottom,
            top: floor + config.openingTop,
          }
        : id === 'south'
          ? {
              x: rx * config.doorOffsetRatio,
              width: config.doorWidth,
              bottom: floor,
              top: floor + config.doorHeight,
            }
          : null;
    for (const [w, h, x, y] of wallOpeningPanels(width, floor, top, opening))
      wall.add(createPlasterPanel(THREE, [w, h, 0.45], [x, y, -0.225], materials.stone));
    const trimOpening = id === 'south' ? { ...opening, width: config.doorSurroundWidth } : null;
    for (const [w, h, x, y] of wallOpeningPanels(width, floor, floor + 1.68, trimOpening))
      box(wall, [w, h, 0.7], [x, y, 0.14], '#ffffff', materials.trim);
    box(wall, [width, 1.12, 0.91], [0, floor + 22.75, 0.14], '#ffffff', materials.trim);
    const normal = new THREE.Vector3(...direction);
    return {
      group: wall,
      cutawayPlanes: [new THREE.Plane(normal, -normal.dot(wall.position) + config.cutawayInset)],
    };
  });
  const ceiling = group('Temple ceiling');
  ceiling.add(
    createPlasterPanel(THREE, [rx * 2, 0.84, rz * 2], [0, top + 0.42, 0], materials.trim),
  );
  return {
    walls,
    anchors: new Map(specs.map(([id], index) => [id, walls[index]])),
    ceiling: {
      group: ceiling,
      top: top + 0.84,
      cutawayPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), -top + 0.15)],
    },
  };
}

function placeModel({ THREE, assembly }, parent, kind, position, size, material) {
  const slot = new THREE.Group();
  slot.name = `Temple ${kind} slot`;
  slot.position.set(...position);
  parent.add(slot);
  const fallback = new THREE.Group();
  slot.add(fallback);
  assembly.box(fallback, size, [0, size[1] / 2, 0], '#ffffff', material);
  assembly.furnishing(kind, slot, fallback);
  return slot;
}

function buildOpenings(dependencies) {
  const { THREE, structure, layout, materials, assembly } = dependencies;
  const config = ANCIENT_TEMPLE;
  const slot = new THREE.Group();
  slot.name = 'Temple loggia opening';
  slot.position.set(0, layout.floor, config.frameInset);
  structure.anchors.get('north').group.add(slot);
  const frame = new THREE.Group();
  slot.add(frame);
  for (const x of [-config.openingWidth / 2, config.openingWidth / 2])
    assembly.box(frame, [0.63, 15.89, 1.54], [x, 13.65, 0.28], '#ffffff', materials.bronze);
  for (const y of [config.openingBottom, config.openingTop])
    assembly.box(frame, [55.65, 0.63, 1.68], [0, y, 0.28], '#ffffff', materials.bronze);
  assembly.furnishing('opening-frame', slot, frame);
  placeModel(
    dependencies,
    structure.anchors.get('south').group,
    'door',
    [layout.rx * config.doorOffsetRatio, layout.floor, 0.05],
    [9.8, 18.62, 0.8],
    materials.trim,
  );
}

function buildPlayArea({ layout, assembly, materials }) {
  const { hx, hz, floor } = layout;
  const depth = Math.max(...tableOutline(layout.tableShape, hx, hz).map((p) => Math.abs(p.z)));
  const supports = assembly.group('Temple table supports');
  const width = Math.min(2.94, hx * 0.25, depth * 0.35);
  for (const x of [-hx * 0.55, hx * 0.55])
    assembly.box(
      supports,
      [width, TABLE_FINISH.rimBase - floor, depth * 1.1],
      [x, (TABLE_FINISH.rimBase + floor) / 2, 0],
      '#ffffff',
      materials.stone,
    );
  assembly.contact(
    supports,
    [-hx * 0.55, hx * 0.55].map((x) => ({ x, width: width * 1.2, depth: depth * 1.2 })),
    floor + 0.055,
  );
  const template = assembly.group('Temple chair resources');
  template.visible = false;
  assembly.box(template, [2.94, 3.08, 2.94], [0, 1.54, 0], '#ffffff', materials.stone);
  assembly.box(template, [3.92, 0.63, 3.85], [0, 3.15, 0], '#ffffff', materials.trim);
  assembly.box(template, [3.92, 3.85, 0.98], [0, 5.32, 1.68], '#ffffff', materials.stone);
  assembly.contact(template, [{ width: 4.8, depth: 4.8 }]);
  assembly.furnishing('chair', template, template, Math.PI);
  return { chairTemplate: template, chairModel: 'chair' };
}

function buildFurnishings(dependencies) {
  const { structure, layout, materials, assembly } = dependencies;
  const { floor, rx } = layout,
    config = ANCIENT_TEMPLE;
  const north = structure.anchors.get('north').group;
  for (const x of config.columnOffsets)
    placeModel(
      dependencies,
      north,
      'column',
      [x, floor, config.columnInset],
      [5.6, 23.17, 5.6],
      materials.stone,
    );
  for (const direction of [-1, 1]) {
    const brazier = placeModel(
      dependencies,
      north,
      'brazier',
      [config.brazierOffset * direction, floor, config.brazierInset],
      [4.76, 8.47, 4.76],
      materials.bronze,
    );
    assembly.contact(brazier, [{ width: 5.5, depth: 5.5 }]);
  }
  placeModel(
    dependencies,
    structure.anchors.get('west').group,
    'relief',
    [0, floor, 1.05],
    [22.4, 10.15, 0.8],
    materials.stone,
  );
  const console = placeModel(
    dependencies,
    structure.anchors.get('south').group,
    'console',
    [rx * 0.36, floor, 3.78],
    [18.9, 6.426, 4.55],
    materials.trim,
  );
  assembly.contact(console, [{ width: 19, depth: 5 }]);
}

export const ANCIENT_TEMPLE_THEME = Object.freeze({
  id: 'ancient-temple',
  name: 'Ancient Temple',
  structure: Object.freeze({ ...ANCIENT_TEMPLE, build: buildStructure }),
  openings: Object.freeze({ build: buildOpenings }),
  playArea: Object.freeze({
    build: buildPlayArea,
    chairClearance: ANCIENT_TEMPLE.chairClearance,
    chairName: 'Temple occupied chair',
  }),
  furnishings: Object.freeze({ build: buildFurnishings }),
  decoration: Object.freeze({}),
  atmosphere: Object.freeze({ createMaterials, suggestedLighting: 'day' }),
  assets: Object.freeze({
    ...ROOM_COMPANION_ASSETS,
    ...Object.fromEntries(
      ['chair', 'column', 'brazier', 'relief', 'console', 'door', 'opening-frame', 'paver'].map(
        (kind) => [
          kind,
          Object.freeze({
            url: `/models/environments/ancient-temple/temple-${kind}.glb`,
            scale: ANCIENT_TEMPLE.modelScale,
            name: `Temple ${kind} model`,
            ...(kind === 'chair' ? { resourceName: 'Temple chair model resource' } : {}),
          }),
        ],
      ),
    ),
  }),
  matchingTable: Object.freeze({
    rimWood: 'oak',
    feltColor: '#655f4d',
    description: 'Oak wood and quiet sandstone olive felt',
  }),
});
