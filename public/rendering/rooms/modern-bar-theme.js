import { wallOpeningPanels } from './wall-openings.js';
import { createOakFloor, createPlasterPanel } from '../cozy-room-surfaces.js';
import { tableOutline } from '../../../shared/pieces.js';
import { TABLE_FINISH } from '../table-geometry.js';

export const MODERN_BAR = Object.freeze({
  floorY: -5.15,
  wallHeight: 24.5,
  clearance: 22,
  minimumHalfSize: 30,
  cutawayInset: 0.3,
  cutawayHysteresis: 0.15,
  modelScale: 7,
  chairClearance: 3,
  wallThickness: 0.45,
  wallInteriorFace: 0.1,
  // Rough opening terminates within the frame, clear of all four inner reveals.
  windowWidth: 22.4,
  windowBottom: 9.1,
  windowHeight: 11.2,
  brickRows: 18,
  maximumBrickColumns: 48,
  barInset: 4,
  stoolInset: 11.49,
  pendantCableTop: 24.01,
  doorOffsetRatio: 0.15,
  doorWidth: 7.7,
  doorHeight: 16.24,
  doorSurroundWidth: 9.1,
  nookHalfWidth: 6.16,
  nookCornerMargin: 3.2,
  nookInset: 2.8,
});

function createMaterials(THREE, onLoad, phoneSafe) {
  const loader = new THREE.TextureLoader();
  const texture = (name, color = false) => {
    const map = loader.load(`/textures/${name}.png`, onLoad);
    if (color) map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    return map;
  };
  const walnut = texture('wood-walnut', true);
  const normal = phoneSafe ? null : texture('poker-walnut-normal');
  return {
    plain: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 }),
    walnut: new THREE.MeshStandardMaterial({
      map: walnut,
      normalMap: normal,
      color: '#e2b98e',
      roughness: 0.46,
    }),
    floor: new THREE.MeshStandardMaterial({
      map: walnut,
      normalMap: normal,
      color: '#b99a7e',
      roughness: 0.66,
    }),
    plaster: new THREE.MeshStandardMaterial({
      color: '#3b4848',
      normalMap: phoneSafe ? null : texture('tavern-plaster-normal'),
      roughness: 0.92,
    }),
    brick: new THREE.MeshStandardMaterial({
      color: '#ffffff',
      normalMap: phoneSafe ? null : texture('tavern-stone-normal'),
      roughness: 0.93,
    }),
    mortar: new THREE.MeshStandardMaterial({ color: '#6b6861', roughness: 1 }),
    steel: new THREE.MeshStandardMaterial({ color: '#242b2c', roughness: 0.43, metalness: 0.65 }),
    brass: new THREE.MeshStandardMaterial({ color: '#bc9e68', roughness: 0.32, metalness: 0.82 }),
    stone: new THREE.MeshStandardMaterial({ color: '#252a2c', roughness: 0.27 }),
    leather: new THREE.MeshStandardMaterial({ color: '#ad744e', roughness: 0.47 }),
    teal: new THREE.MeshStandardMaterial({ color: '#305b5b', roughness: 0.57 }),
    glow: new THREE.MeshStandardMaterial({
      color: '#ffd4a0',
      emissive: '#ffd4a0',
      emissiveIntensity: 0.8,
    }),
    doorGlass: new THREE.MeshStandardMaterial({
      color: '#b7cecc',
      transparent: true,
      opacity: 0.09,
      depthWrite: false,
      roughness: 0.16,
      side: THREE.DoubleSide,
    }),
    doorFrost: new THREE.MeshStandardMaterial({
      color: '#b7cecc',
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      roughness: 0.63,
      side: THREE.DoubleSide,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: '#e2eef0',
      transparent: true,
      opacity: 0.035,
      depthWrite: false,
      roughness: 0.1,
      side: THREE.DoubleSide,
    }),
  };
}

function buildStructure({ THREE, root, layout, materials, assembly }) {
  const { floor, top, rx, rz } = layout;
  const { box, group } = assembly;
  const config = MODERN_BAR;
  box(root, [rx * 2, 0.2, rz * 2], [0, floor - 0.1, 0], '#242b2c');
  root.add(createOakFloor(THREE, rx, rz, floor, materials.floor));
  const specs = [
    ['north', [0, 0, -rz], 0, rx * 2, [0, 0, -1]],
    ['south', [0, 0, rz], Math.PI, rx * 2, [0, 0, 1]],
    ['east', [rx, 0, 0], -Math.PI / 2, rz * 2, [1, 0, 0]],
    ['west', [-rx, 0, 0], Math.PI / 2, rz * 2, [-1, 0, 0]],
  ];
  const walls = specs.map(([id, position, yaw, width, direction]) => {
    const wall = group(`Modern ${id} wall`, position, yaw);
    const panel = (size, at, material = materials.plaster) =>
      wall.add(createPlasterPanel(THREE, size, at, material));
    const depth = config.wallThickness,
      z = config.wallInteriorFace - depth / 2;
    const opening =
      id === 'west'
        ? {
            x: 0,
            width: config.windowWidth,
            bottom: floor + config.windowBottom,
            top: floor + config.windowBottom + config.windowHeight,
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
      panel([w, h, depth], [x, y, z], id === 'north' ? materials.mortar : materials.plaster);
    if (id === 'north') {
      const columns = Math.min(config.maximumBrickColumns, Math.ceil(width / 3.15));
      const step = width / columns,
        rowHeight = (top - floor) / config.brickRows;
      const colors = ['#74594c', '#826557', '#917263', '#69544a', '#846254'];
      for (let row = 0; row < config.brickRows; row++)
        for (let column = -1; column <= columns; column++) {
          const a = Math.max(-width / 2, -width / 2 + (column + (row % 2) / 2) * step);
          const b = Math.min(width / 2, -width / 2 + (column + 1 + (row % 2) / 2) * step);
          if (b - a < 0.15) continue;
          box(
            wall,
            [b - a - 0.1, rowHeight - 0.1, 0.6],
            [(a + b) / 2, floor + (row + 0.5) * rowHeight, 0.25],
            colors[(column + row * 3 + columns) % colors.length],
            materials.brick,
          );
        }
    }
    const skirtingOpening = id === 'south' ? { ...opening, width: config.doorSurroundWidth } : null;
    for (const [w, h, x, y] of wallOpeningPanels(width, floor, floor + 0.6, skirtingOpening))
      box(wall, [w, h, 0.2], [x, y, 0.22], '#ffffff', materials.brass);
    box(wall, [width, 0.6, 1], [0, top - 0.3, 0.4], '#ffffff', materials.walnut);
    const normal = new THREE.Vector3(...direction);
    return {
      group: wall,
      width,
      cutawayPlanes: [new THREE.Plane(normal, -normal.dot(wall.position) + config.cutawayInset)],
    };
  });
  const ceiling = group('Modern ceiling');
  ceiling.add(createPlasterPanel(THREE, [rx * 2, 0.2, rz * 2], [0, top, 0], materials.plaster));
  return {
    walls,
    anchors: new Map(specs.map(([id], index) => [id, walls[index]])),
    ceiling: {
      group: ceiling,
      top: top + 0.1,
      cutawayPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), -top + 0.15)],
    },
  };
}

function placeModel(
  { THREE, assembly, materials },
  parent,
  kind,
  position,
  size,
  surface,
  yaw = 0,
  prepare,
) {
  const slot = new THREE.Group();
  slot.name = `Modern ${kind} slot`;
  slot.position.set(...position);
  parent.add(slot);
  const fallback = new THREE.Group();
  slot.add(fallback);
  assembly.box(fallback, size, [0, size[1] / 2, 0], '#ffffff', surface || materials.walnut);
  assembly.furnishing(kind, slot, fallback, yaw, prepare);
  return slot;
}

function buildOpenings(dependencies) {
  const { THREE, structure, layout, assembly, materials, phoneSafe } = dependencies;
  const window = new THREE.Group();
  window.name = 'Modern city window';
  window.position.y = layout.floor;
  structure.anchors.get('west').group.add(window);
  const fallback = new THREE.Group();
  window.add(fallback);
  const { windowWidth: w, windowHeight: h, windowBottom: b } = MODERN_BAR;
  for (const x of [-w / 2, -w / 6, w / 6, w / 2])
    assembly.box(fallback, [0.5, h + 0.5, 0.7], [x, b + h / 2, 0.3], '#ffffff', materials.steel);
  for (const y of [b, b + h])
    assembly.box(fallback, [w + 0.8, 0.5, 0.8], [0, y, 0.3], '#ffffff', materials.steel);
  assembly.furnishing('window', window, fallback, 0, (model) =>
    model.traverse((node) => {
      if (
        !node.isMesh ||
        ![node.material].flat().some((material) => material.name.includes('clear glazing'))
      )
        return;
      node.material = materials.glass;
      node.name = 'Modern clear glazing';
      node.visible = !phoneSafe;
      node.castShadow = node.receiveShadow = false;
    }),
  );
  const door = new THREE.Group();
  door.name = 'Modern glass door';
  door.position.set(layout.rx * MODERN_BAR.doorOffsetRatio, layout.floor, 0);
  structure.anchors.get('south').group.add(door);
  const frame = new THREE.Group();
  door.add(frame);
  for (const x of [-4.2, 4.2])
    assembly.box(frame, [0.7, 16.1, 1.4], [x, 8.05, 0], '#ffffff', materials.steel);
  assembly.box(frame, [9.1, 0.7, 1.4], [0, 16.45, 0], '#ffffff', materials.steel);
  assembly.furnishing('door', door, frame, 0, (model) =>
    model.traverse((node) => {
      if (!node.isMesh) return;
      const name = [node.material]
        .flat()
        .map((m) => m.name)
        .join(' ');
      if (!name.includes('clear glazing')) return;
      node.material = name.includes('privacy band') ? materials.doorFrost : materials.doorGlass;
      node.name = 'Modern door glazing';
      node.visible = !phoneSafe;
      node.castShadow = node.receiveShadow = false;
    }),
  );
}

function buildPlayArea({ layout, assembly, materials }) {
  const { hx, hz, floor } = layout;
  const depth = Math.max(
    ...tableOutline(layout.tableShape, hx, hz).map((point) => Math.abs(point.z)),
  );
  const supports = assembly.group('Modern table supports');
  const width = Math.min(3.5, hx * 0.25, depth * 0.35),
    reach = depth * 0.5;
  const footHeight = 0.3,
    underside = TABLE_FINISH.rimBase;
  for (const x of [-hx * 0.55, hx * 0.55]) {
    assembly.box(
      supports,
      [width, footHeight, reach * 2],
      [x, floor + footHeight / 2, 0],
      '#ffffff',
      materials.steel,
    );
    assembly.box(
      supports,
      [width * 0.35, underside - floor - footHeight, reach * 1.6],
      [x, (underside + floor + footHeight) / 2, 0],
      '#ffffff',
      materials.steel,
    );
  }
  assembly.contact(
    supports,
    [-hx * 0.55, hx * 0.55].map((x) => ({ x, width: width * 1.4, depth: reach * 2 })),
    floor + 0.055,
  );
  const template = assembly.group('Modern chair resources');
  template.visible = false;
  for (const x of [-1.4, 1.4])
    for (const z of [-1.3, 1.3])
      assembly.box(template, [0.25, 3, 0.25], [x, 1.5, z], '#ffffff', materials.steel);
  assembly.box(template, [3.8, 0.6, 3.5], [0, 3.3, 0], '#ffffff', materials.leather);
  assembly.box(template, [3.9, 2.8, 0.7], [0, 4.7, 1.6], '#ffffff', materials.leather);
  assembly.contact(template, [{ width: 4.8, depth: 4.8 }]);
  assembly.furnishing('chair', template, template);
  return { chairTemplate: template, chairModel: 'chair' };
}

function buildFurnishings(dependencies) {
  const { structure, layout, materials, assembly } = dependencies;
  const { floor, top, rx } = layout,
    config = MODERN_BAR;
  const north = structure.anchors.get('north').group,
    west = structure.anchors.get('west').group,
    east = structure.anchors.get('east').group,
    south = structure.anchors.get('south').group;
  const center = rx * 0.25;
  const bar = placeModel(
    dependencies,
    north,
    'bar',
    [center, floor, config.barInset],
    [35, 8, 6],
    materials.walnut,
  );
  assembly.contact(bar, [{ width: 37, depth: 8 }]);
  placeModel(dependencies, north, 'shelves', [center, floor, 1.2], [34, 20, 2], materials.walnut);
  placeModel(dependencies, north, 'sign', [-rx * 0.68, floor, 1], [14, 18, 0.5], materials.steel);
  for (const x of [-11.9, -4.34, 3.22, 10.78])
    placeModel(
      dependencies,
      north,
      'stool',
      [center + x, floor, config.stoolInset],
      [3.1, 5.6, 3.1],
      materials.teal,
    );
  const booth = placeModel(
    dependencies,
    west,
    'booth',
    [0, floor, 3.1],
    [26.5, 8.7, 4.6],
    materials.teal,
    Math.PI,
  );
  assembly.contact(booth, [{ width: 28, depth: 6 }]);
  const nook = placeModel(
    dependencies,
    south,
    'nook',
    [-rx + config.nookHalfWidth + config.nookCornerMargin, floor, config.nookInset],
    [12.3, 8.9, 4.6],
    materials.teal,
  );
  assembly.contact(nook, [
    { width: 13, depth: 5 },
    { width: 5.6, depth: 5.6, z: 5.6 },
  ]);
  placeModel(dependencies, east, 'art', [0, floor, 0.6], [8, 19, 0.4], materials.teal);
  placeModel(dependencies, east, 'plant', [-8, floor, 4.5], [4, 9, 4], materials.teal);
  const pendantY = top - config.pendantCableTop;
  const barPendants = placeModel(
    dependencies,
    structure.ceiling.group,
    'bar-pendants',
    [center, pendantY, -layout.rz + 6.24],
    [25, 0.4, 1.2],
    materials.steel,
  );
  // The light-shaped fallbacks sit at fixture height, not down at the origin.
  barPendants.children[0].position.y = 18;
  const tablePendant = placeModel(
    dependencies,
    structure.ceiling.group,
    'table-pendant',
    [0, pendantY, 0],
    [11.5, 0.4, 0.9],
    materials.brass,
  );
  tablePendant.children[0].position.y = 19.2;
}

export const MODERN_BAR_THEME = Object.freeze({
  id: 'modern-bar',
  name: 'Modern Bar',
  structure: Object.freeze({ ...MODERN_BAR, build: buildStructure }),
  openings: Object.freeze({ build: buildOpenings }),
  playArea: Object.freeze({
    build: buildPlayArea,
    chairClearance: MODERN_BAR.chairClearance,
    chairName: 'Modern occupied chair',
  }),
  furnishings: Object.freeze({ build: buildFurnishings }),
  decoration: Object.freeze({}),
  atmosphere: Object.freeze({ createMaterials, suggestedLighting: 'warm' }),
  assets: Object.freeze(
    Object.fromEntries(
      [
        'chair',
        'stool',
        'booth',
        'bar',
        'shelves',
        'window',
        'bar-pendants',
        'table-pendant',
        'sign',
        'plant',
        'art',
        'door',
        'nook',
      ].map((kind) => [
        kind,
        Object.freeze({
          url: `/models/environments/modern-bar/modern-bar-${kind}.glb`,
          scale: MODERN_BAR.modelScale,
          name: `Modern ${kind} model`,
          ...(kind === 'chair' ? { resourceName: 'Modern chair model resource' } : {}),
        }),
      ]),
    ),
  ),
  matchingTable: Object.freeze({
    rimWood: 'walnut',
    feltColor: '#294b4c',
    description: 'Walnut wood and quiet deep teal felt',
  }),
});
