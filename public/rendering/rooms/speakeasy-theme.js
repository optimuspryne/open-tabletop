import { ROOM_COMPANION_ASSETS } from './room-companion.js';
import { createOakFloor, createPlasterPanel } from '../cozy-room-surfaces.js';
import { wallOpeningPanels } from './wall-openings.js';
import { tableOutline } from '../../../shared/pieces.js';
import { TABLE_FINISH } from '../table-geometry.js';

export const SPEAKEASY = Object.freeze({
  floorY: -6.377,
  wallHeight: 24.29,
  clearance: 22,
  minimumHalfSize: 32,
  modelScale: 7,
  chairClearance: 3.2,
  cutawayInset: 0.3,
  cutawayHysteresis: 0.15,
  doorOffsetRatio: -0.6,
  consoleOffsetRatio: 0.4,
  doorWidth: 8.26,
  doorHeight: 17.64,
  doorSurroundWidth: 9.8,
  pendantReach: 6.447,
});

function createMaterials(THREE, onLoad, phoneSafe) {
  const oak = new THREE.TextureLoader().load('/textures/wood-oak.png', onLoad);
  oak.colorSpace = THREE.SRGBColorSpace;
  oak.wrapS = oak.wrapT = THREE.RepeatWrapping;
  const normal = phoneSafe
    ? null
    : new THREE.TextureLoader().load('/textures/tavern-plaster-normal.png', onLoad);
  if (normal) normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  return {
    plain: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 }),
    floor: new THREE.MeshStandardMaterial({ map: oak, color: '#4f4137', roughness: 0.67 }),
    wood: new THREE.MeshStandardMaterial({ map: oak, color: '#51382e', roughness: 0.54 }),
    wall: new THREE.MeshStandardMaterial({
      color: '#443c48',
      roughness: 0.9,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.15, 0.15),
    }),
    velvet: new THREE.MeshStandardMaterial({ color: '#73384e', roughness: 0.87 }),
    brass: new THREE.MeshStandardMaterial({ color: '#c7a05a', roughness: 0.42, metalness: 0.75 }),
    rug: new THREE.MeshStandardMaterial({ color: '#493745', roughness: 1 }),
    stone: new THREE.MeshStandardMaterial({ color: '#393b3e', roughness: 0.35 }),
  };
}

function buildStructure({ THREE, root, layout, materials, assembly }) {
  const { floor, top, rx, rz } = layout;
  const { box, group } = assembly;
  box(root, [rx * 2, 0.2, rz * 2], [0, floor - 0.1, 0], '#ffffff', materials.wood);
  root.add(createOakFloor(THREE, rx, rz, floor, materials.floor));
  const specs = [
    ['north', [0, 0, -rz], 0, rx * 2, [0, 0, -1]],
    ['south', [0, 0, rz], Math.PI, rx * 2, [0, 0, 1]],
    ['east', [rx, 0, 0], -Math.PI / 2, rz * 2, [1, 0, 0]],
    ['west', [-rx, 0, 0], Math.PI / 2, rz * 2, [-1, 0, 0]],
  ];
  const walls = specs.map(([id, position, yaw, width, direction]) => {
    const wall = group(`Speakeasy ${id} wall`, position, yaw);
    const opening =
      id === 'south'
        ? {
            x: rx * SPEAKEASY.doorOffsetRatio,
            width: SPEAKEASY.doorWidth,
            bottom: floor,
            top: floor + SPEAKEASY.doorHeight,
          }
        : null;
    for (const [w, h, x, y] of wallOpeningPanels(width, floor, top, opening))
      wall.add(createPlasterPanel(THREE, [w, h, 0.45], [x, y, -0.225], materials.wall));
    const trimOpening = opening ? { ...opening, width: SPEAKEASY.doorSurroundWidth } : null;
    for (const [w, h, x, y] of wallOpeningPanels(width, floor, floor + 0.7, trimOpening))
      box(wall, [w, h, 0.22], [x, y, 0.12], '#ffffff', materials.wood);
    box(wall, [width, 0.45, 0.55], [0, top - 0.225, 0.15], '#ffffff', materials.brass);
    const normal = new THREE.Vector3(...direction);
    return {
      group: wall,
      cutawayPlanes: [new THREE.Plane(normal, -normal.dot(wall.position) + SPEAKEASY.cutawayInset)],
    };
  });
  const ceiling = group('Speakeasy ceiling');
  // top is the underside: the authored canopy intersects it by 1 mm.
  ceiling.add(
    createPlasterPanel(THREE, [rx * 2, 0.84, rz * 2], [0, top + 0.42, 0], materials.wall),
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

function placeModel({ THREE, assembly }, parent, kind, position, size, material, prepare) {
  const slot = new THREE.Group();
  slot.name = `Speakeasy ${kind} slot`;
  slot.position.set(...position);
  parent.add(slot);
  const fallback = new THREE.Group();
  slot.add(fallback);
  assembly.box(fallback, size, [0, size[1] / 2, 0], '#ffffff', material);
  assembly.furnishing(kind, slot, fallback, 0, prepare);
  return slot;
}

function buildOpenings(dependencies) {
  const { structure, layout, materials } = dependencies;
  placeModel(
    dependencies,
    structure.anchors.get('south').group,
    'door',
    [layout.rx * SPEAKEASY.doorOffsetRatio, layout.floor, 0.05],
    [9.8, 18.62, 0.8],
    materials.wood,
  );
}

function buildPlayArea({ layout, assembly, materials }) {
  const { hx, hz, floor } = layout;
  const depth = Math.max(...tableOutline(layout.tableShape, hx, hz).map((p) => Math.abs(p.z)));
  const supports = assembly.group('Speakeasy table supports');
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
  assembly.contact(
    supports,
    [-hx * 0.55, hx * 0.55].map((x) => ({ x, width: width * 1.6, depth: depth * 1.1 })),
    floor + 0.055,
  );
  const template = assembly.group('Speakeasy chair resources');
  template.visible = false;
  for (const x of [-1.6, 1.6])
    for (const z of [-1.4, 1.4])
      assembly.box(template, [0.35, 3.2, 0.35], [x, 1.6, z], '#ffffff', materials.wood);
  assembly.box(template, [3.8, 0.6, 3.5], [0, 3.5, 0], '#ffffff', materials.velvet);
  assembly.box(template, [3.8, 3.6, 0.65], [0, 5.6, 1.5], '#ffffff', materials.velvet);
  assembly.contact(template, [{ width: 4.8, depth: 4.8 }]);
  // This export faces +Z; occupied seating expects the backrest toward +Z.
  assembly.furnishing('chair', template, template, Math.PI);
  return { chairTemplate: template, chairModel: 'chair' };
}

function buildFurnishings(dependencies) {
  const { THREE, structure, layout, materials, assembly } = dependencies;
  const { floor, top, rx } = layout;
  const north = structure.anchors.get('north').group;
  const booth = placeModel(
    dependencies,
    north,
    'booth',
    [-rx * 0.44, floor, 5.53],
    [21.7, 10.5, 5.5],
    materials.velvet,
  );
  assembly.contact(booth, [{ width: 22, depth: 6 }]);
  const bar = placeModel(
    dependencies,
    north,
    'bar',
    [rx * 0.53, floor, 4.83],
    [17.5, 8, 6],
    materials.wood,
  );
  assembly.contact(bar, [{ width: 18, depth: 6.5 }]);
  placeModel(
    dependencies,
    north,
    'north-fans',
    [0, floor, 0.25],
    [0.01, 0.01, 0.01],
    materials.brass,
  );
  const consoleWall = placeModel(
    dependencies,
    structure.anchors.get('south').group,
    'console-wall',
    [rx * SPEAKEASY.consoleOffsetRatio, floor, 0.28],
    [18.9, 6.4, 4.55],
    materials.wood,
  );
  assembly.contact(consoleWall, [{ width: 19, depth: 5, z: 3.85 }]);
  for (const x of [-7.35, 7.35]) {
    const pendant = placeModel(
      dependencies,
      structure.ceiling.group,
      'pendant',
      [x, top, 0],
      [4.48, 0.25, 4.48],
      materials.brass,
      (model) =>
        model.traverse((node) => {
          if (node.isMesh) node.castShadow = node.receiveShadow = false;
        }),
    );
    const fallback = pendant.children[0];
    fallback.position.y = -SPEAKEASY.pendantReach;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.084, 0.084, 6.4, 12), materials.brass);
    stem.position.y = SPEAKEASY.pendantReach - 3.2;
    fallback.add(stem);
    const canopy = new THREE.Mesh(
      new THREE.CylinderGeometry(0.91, 0.1, 0.924, 24),
      materials.brass,
    );
    canopy.position.y = SPEAKEASY.pendantReach - 0.455;
    fallback.add(canopy);
  }
}

function buildDecoration(dependencies) {
  const { layout, root, materials } = dependencies;
  const { hx, hz, floor } = layout;
  placeModel(
    dependencies,
    root,
    'rug',
    [0, floor, 0],
    [(hx + 8.4) * 2, 0.25, (hz + 7) * 2],
    materials.rug,
    (model) => {
      model.scale.x *= (hx + 8.4) / 18.375;
      model.scale.z *= (hz + 7) / 14.7;
    },
  );
}

export const SPEAKEASY_THEME = Object.freeze({
  id: '1920s-speakeasy',
  name: '1920s Speakeasy',
  structure: Object.freeze({ ...SPEAKEASY, build: buildStructure }),
  openings: Object.freeze({ build: buildOpenings }),
  playArea: Object.freeze({
    build: buildPlayArea,
    chairClearance: SPEAKEASY.chairClearance,
    chairName: 'Speakeasy occupied chair',
  }),
  furnishings: Object.freeze({ build: buildFurnishings }),
  decoration: Object.freeze({ build: buildDecoration }),
  atmosphere: Object.freeze({ createMaterials, suggestedLighting: 'warm' }),
  assets: Object.freeze({
    ...ROOM_COMPANION_ASSETS,
    ...Object.fromEntries(
      ['chair', 'booth', 'bar', 'console-wall', 'door', 'north-fans', 'pendant', 'rug'].map(
        (kind) => [
          kind,
          Object.freeze({
            url: `/models/environments/speakeasy/speakeasy-${kind}.glb`,
            scale: SPEAKEASY.modelScale,
            name: `Speakeasy ${kind} model`,
            ...(kind === 'chair' ? { resourceName: 'Speakeasy chair model resource' } : {}),
          }),
        ],
      ),
    ),
  }),
  matchingTable: Object.freeze({
    rimWood: 'walnut',
    feltColor: '#493745',
    description: 'Walnut wood and quiet burgundy felt',
  }),
});
