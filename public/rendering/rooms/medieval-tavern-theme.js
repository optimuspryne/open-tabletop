import { wallOpeningPanels } from './wall-openings.js';
import { createOakFloor, createPlasterPanel } from '../cozy-room-surfaces.js';
import { inTable, tableOutline } from '../../../shared/pieces.js';
import { TABLE_FINISH } from '../table-geometry.js';

// Authored in metres, exported Y-up; only the decorative room uses these dimensions.
export const MEDIEVAL_TAVERN = Object.freeze({
  floorY: -5.15,
  wallHeight: 23.1,
  clearance: 16,
  minimumHalfSize: 24,
  cutawayInset: 0.3,
  cutawayHysteresis: 0.15,
  modelScale: 7,
  chairClearance: 2.9,
  foundationHeight: 6.3,
  maximumStonesPerRow: 48,
  maximumPosts: 16,
  // Rough opening edges sit inside the solid jambs/lintels, behind their inner faces.
  windowWidth: 11.76,
  windowBottom: 7.35,
  windowHeight: 10.5,
  wallThickness: 0.8,
  windowWallThickness: 0.55,
  wallInteriorFace: 0.15,
  windowSurroundHalfWidth: 13.5,
  trestleOffsetRatio: 0.55,
  trestleDepthRatio: 0.55,
  trestleFootHeight: 0.4,
  trestleBearerHeight: 0.35,
});

function createMaterials(THREE, onLoad, phoneSafe) {
  const loader = new THREE.TextureLoader();
  const texture = (name, color = false) => {
    const map = loader.load(`/textures/${name}.png`, onLoad);
    if (color) map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    return map;
  };
  const wood = texture('wood-oak', true);
  const normal = phoneSafe ? null : texture('cozy-oak-normal');
  return {
    plain: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 }),
    oak: new THREE.MeshStandardMaterial({
      map: wood,
      normalMap: normal,
      color: '#d0ab75',
      roughness: 0.52,
    }),
    timber: new THREE.MeshStandardMaterial({
      map: wood,
      normalMap: normal,
      color: '#67503a',
      roughness: 0.8,
    }),
    floor: new THREE.MeshStandardMaterial({
      map: wood,
      normalMap: normal,
      color: '#a78b66',
      roughness: 0.7,
    }),
    plaster: new THREE.MeshStandardMaterial({
      map: texture('tavern-plaster-color', true),
      normalMap: phoneSafe ? null : texture('tavern-plaster-normal'),
      roughness: 0.95,
    }),
    stone: new THREE.MeshStandardMaterial({
      map: texture('tavern-stone-color', true),
      normalMap: phoneSafe ? null : texture('tavern-stone-normal'),
      roughness: 0.9,
    }),
    mortar: new THREE.MeshStandardMaterial({ color: '#666459', roughness: 1 }),
    iron: new THREE.MeshStandardMaterial({ color: '#282b29', metalness: 0.78, roughness: 0.42 }),
    wax: new THREE.MeshStandardMaterial({ color: '#d4b879', roughness: 0.65 }),
    glow: new THREE.MeshStandardMaterial({
      color: '#ffad48',
      emissive: '#ff8422',
      emissiveIntensity: 1.2,
      roughness: 1,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: '#eef7ff',
      transparent: true,
      opacity: 0.025,
      depthWrite: false,
      roughness: 0.18,
      side: THREE.DoubleSide,
    }),
  };
}

function buildStructure({ THREE, root, layout, materials, assembly }) {
  const { floor, top, rx, rz } = layout;
  const { box, group } = assembly;
  const config = MEDIEVAL_TAVERN;
  box(root, [rx * 2, 0.2, rz * 2], [0, floor - 0.1, 0], '#31291f');
  root.add(createOakFloor(THREE, rx, rz, floor, materials.floor));
  const specs = [
    ['north', [0, 0, -rz], 0, rx * 2, [0, 0, -1]],
    ['south', [0, 0, rz], Math.PI, rx * 2, [0, 0, 1]],
    ['east', [rx, 0, 0], -Math.PI / 2, rz * 2, [1, 0, 0]],
    ['west', [-rx, 0, 0], Math.PI / 2, rz * 2, [-1, 0, 0]],
  ];
  const walls = specs.map(([id, position, yaw, width, direction]) => {
    const wall = group(`Tavern ${id} wall`, position, yaw);
    const hasWindow = id === 'west' || id === 'south';
    const thickness = hasWindow ? config.windowWallThickness : config.wallThickness;
    const wallZ = config.wallInteriorFace - thickness / 2;
    const panel = (size, at) => wall.add(createPlasterPanel(THREE, size, at, materials.plaster));
    const opening = hasWindow
      ? {
          x: 0,
          width: config.windowWidth,
          bottom: floor + config.windowBottom,
          top: floor + config.windowBottom + config.windowHeight,
        }
      : null;
    for (const [w, h, x, y] of wallOpeningPanels(width, floor, top, opening))
      panel([w, h, thickness], [x, y, wallZ]);
    box(
      wall,
      [width, config.foundationHeight, 0.25],
      [0, floor + config.foundationHeight / 2, 0.22],
      '#ffffff',
      materials.mortar,
    );
    const count = Math.min(config.maximumStonesPerRow, Math.ceil(width / 3.8));
    const step = width / count;
    for (let row = 0; row < 3; row++)
      for (let i = -1; i <= count; i++) {
        const a = Math.max(-width / 2, -width / 2 + (i + (row % 2) / 2) * step);
        const b = Math.min(width / 2, -width / 2 + (i + 1 + (row % 2) / 2) * step);
        if (b - a < 0.15) continue;
        box(
          wall,
          [b - a - 0.12, 1.96, 0.5],
          [(a + b) / 2, floor + row * 2.1 + 1.04, 0.4],
          ['#ffffff', '#ebe6dc', '#e4dfd5'][(i + row + count) % 3],
          materials.stone,
        );
      }
    const posts = Math.min(config.maximumPosts, Math.max(2, Math.ceil(width / 13)));
    for (let i = 0; i <= posts; i++) {
      const x = -width / 2 + (i * width) / posts;
      // Reserve the shutter surround beyond the clear aperture.
      if (hasWindow && Math.abs(x) < config.windowSurroundHalfWidth) continue;
      box(wall, [1.15, top - floor, 1.3], [x, (top + floor) / 2, 0.7], '#ffffff', materials.timber);
    }
    for (const y of [floor + 6.7, top - 0.6])
      box(wall, [width, 1.1, 1.3], [0, y, 0.7], '#ffffff', materials.timber);
    const normal = new THREE.Vector3(...direction);
    return {
      group: wall,
      width,
      cutawayPlanes: [new THREE.Plane(normal, -normal.dot(wall.position) + config.cutawayInset)],
    };
  });
  const ceiling = group('Tavern ceiling');
  ceiling.add(createPlasterPanel(THREE, [rx * 2, 0.2, rz * 2], [0, top, 0], materials.timber));
  for (const z of [-rz * 0.6, 0, rz * 0.6])
    ceiling.add(
      createPlasterPanel(THREE, [rx * 2, 1.5, 1.45], [0, top - 0.75, z], materials.timber),
    );
  return {
    walls,
    anchors: new Map(specs.map(([id], i) => [id, walls[i]])),
    ceiling: {
      group: ceiling,
      top: top + 0.1,
      cutawayPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), -top + 0.15)],
    },
  };
}

// Slots keep fallback ownership separate from their positioning/cutaway anchors.
function addFurnishing(
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
  slot.name = `Tavern ${kind} slot`;
  slot.position.set(...position);
  parent.add(slot);
  const fallback = new THREE.Group();
  slot.add(fallback);
  assembly.box(fallback, size, [0, size[1] / 2, 0], '#ffffff', surface || materials.oak);
  assembly.furnishing(kind, slot, fallback, yaw, prepare);
  return slot;
}

function buildOpenings(dependencies) {
  const { THREE, layout, structure, materials, assembly, phoneSafe } = dependencies;
  for (const side of ['west', 'south']) {
    const parent = structure.anchors.get(side).group;
    const window = new THREE.Group();
    window.name = side === 'west' ? 'Tavern leaded window' : 'Tavern rear leaded window';
    window.position.y = layout.floor;
    parent.add(window);
    const fallback = new THREE.Group();
    window.add(fallback);
    const { windowWidth: w, windowHeight: h, windowBottom: b } = MEDIEVAL_TAVERN;
    for (const x of [-w / 2, 0, w / 2])
      assembly.box(fallback, [0.35, h + 0.5, 0.6], [x, b + h / 2, 0.3], '#ffffff', materials.oak);
    for (const y of [b, b + h])
      assembly.box(fallback, [w + 0.7, 0.35, 0.8], [0, y, 0.3], '#ffffff', materials.oak);
    assembly.furnishing('window', window, fallback, 0, (model) =>
      model.traverse((node) => {
        if (
          !node.isMesh ||
          ![node.material].flat().some((m) => m.name.includes('clear window glazing'))
        )
          return;
        node.material = materials.glass;
        node.name = 'Tavern clear glazing';
        node.visible = !phoneSafe;
        node.castShadow = node.receiveShadow = false;
      }),
    );
  }
}

function buildPlayArea(dependencies) {
  const { THREE, layout, assembly, materials } = dependencies;
  const { hx, floor, tableShape } = layout;
  // Hexes (like circles) are width-sized; use the shared outline rather than saved depth.
  const hz = Math.max(...tableOutline(tableShape, hx, layout.hz).map((point) => Math.abs(point.z)));
  const config = MEDIEVAL_TAVERN;
  const supports = assembly.group('Tavern table supports');
  const width = Math.min(1.1, hx * 0.24, hz * 0.24);
  const reach = hz * config.trestleDepthRatio;
  const top = TABLE_FINISH.rimBase;
  const footTop = floor + config.trestleFootHeight;
  const bearerBottom = top - config.trestleBearerHeight;
  const footprints = [];
  for (const x of [-hx * config.trestleOffsetRatio, hx * config.trestleOffsetRatio]) {
    if (![-1, 1].every((side) => inTable(x + (side * width) / 2, reach, tableShape, hx, hz)))
      continue;
    assembly.box(
      supports,
      [width, config.trestleFootHeight, reach * 2],
      [x, floor + config.trestleFootHeight / 2, 0],
      '#ffffff',
      materials.timber,
    );
    assembly.box(
      supports,
      [width * 0.8, bearerBottom - footTop, width],
      [x, (footTop + bearerBottom) / 2, 0],
      '#ffffff',
      materials.oak,
    );
    assembly.box(
      supports,
      [width, config.trestleBearerHeight, reach * 2],
      [x, top - config.trestleBearerHeight / 2, 0],
      '#ffffff',
      materials.oak,
    );
    for (const side of [-1, 1]) {
      const from = new THREE.Vector3(x, footTop + 0.45, side * Math.min(width / 3, reach / 3));
      const to = new THREE.Vector3(x, bearerBottom, side * reach * 0.85);
      const direction = to.clone().sub(from);
      const brace = new THREE.Mesh(
        new THREE.BoxGeometry(width * 0.35, direction.length(), width * 0.35),
        materials.oak,
      );
      brace.name = 'Tavern trestle brace';
      brace.position.copy(from).add(to).multiplyScalar(0.5);
      brace.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      brace.castShadow = brace.receiveShadow = true;
      supports.add(brace);
    }
    footprints.push({ x, z: 0, width: width * 2, depth: reach * 2 });
  }
  assembly.box(
    supports,
    [hx * config.trestleOffsetRatio * 2 + width, 0.45, width * 0.65],
    [0, footTop + 0.75, 0],
    '#ffffff',
    materials.timber,
  );
  assembly.contact(supports, footprints, floor + 0.055);
  const template = assembly.group('Tavern chair resources');
  template.visible = false;
  for (const x of [-1.35, 1.35]) {
    for (const z of [-1.25, 1.25])
      assembly.box(template, [0.4, 3.3, 0.4], [x, 1.65, z], '#ffffff', materials.oak);
    assembly.box(template, [0.4, 3.8, 0.4], [x, 5, 1.5], '#ffffff', materials.timber);
  }
  assembly.box(template, [3.5, 0.4, 3.4], [0, 3.5, 0], '#ffffff', materials.oak);
  for (const y of [4.8, 6.7])
    assembly.box(template, [3.5, 0.6, 0.4], [0, y, 1.5], '#ffffff', materials.oak);
  assembly.contact(template, [{ width: 4.8, depth: 4.8 }]);
  assembly.furnishing('chair', template, template, Math.PI, (model) => {
    model.position.y -= 0.02316751 * 7;
  });
  return { chairTemplate: template, chairModel: 'chair' };
}

function buildFurnishings(dependencies) {
  const { THREE, structure, layout, materials, assembly } = dependencies;
  const { floor, rx } = layout;
  const north = structure.anchors.get('north').group;
  const hearth = addFurnishing(
    dependencies,
    north,
    'hearth',
    [-rx * 0.32, floor, 1.6],
    [14, 15, 2.5],
    materials.stone,
  );
  assembly.contact(hearth, [{ width: 17, depth: 10, z: 3 }]);
  addFurnishing(dependencies, north, 'bar', [rx * 0.55, floor, 5.3], [13, 7.4, 5.8], materials.oak);
  for (const [x, z] of [
    [-rx + 3, 4.3],
    [rx - 3, 12],
    [rx - 3.5, 4.5],
  ])
    addFurnishing(
      dependencies,
      north,
      'barrel',
      [x, floor - 0.0034, z],
      [4, 6.3, 4],
      materials.oak,
    );
  const east = structure.anchors.get('east').group;
  for (const x of [-4, 4])
    addFurnishing(dependencies, east, 'stool', [x, floor - 0.21, 3.5], [3, 3.65, 3], materials.oak);
  const west = structure.anchors.get('west').group;
  addFurnishing(dependencies, west, 'bench', [0, floor - 0.142, 2.5], [12, 3.6, 3], materials.oak);
  const chandelier = new THREE.Group();
  chandelier.name = 'Tavern candle wheel';
  chandelier.position.y = floor;
  structure.ceiling.group.add(chandelier);
  const fallback = new THREE.Group();
  chandelier.add(fallback);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(4.4, 0.18, 6, 24), materials.iron);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 18.4;
  fallback.add(ring);
  for (let i = 0; i < 6; i++)
    assembly.box(
      fallback,
      [0.3, 1.2, 0.3],
      [Math.cos((i * Math.PI) / 3) * 4.4, 19, Math.sin((i * Math.PI) / 3) * 4.4],
      '#ffffff',
      materials.wax,
    );
  assembly.furnishing('chandelier', chandelier, fallback, 0, (model) =>
    model.traverse((node) => {
      if (node.isMesh) node.castShadow = false;
    }),
  );
  return { hearth };
}

export const MEDIEVAL_TAVERN_THEME = Object.freeze({
  id: 'medieval-tavern',
  name: 'Medieval Tavern',
  structure: Object.freeze({ ...MEDIEVAL_TAVERN, build: buildStructure }),
  openings: Object.freeze({ build: buildOpenings }),
  playArea: Object.freeze({
    build: buildPlayArea,
    chairClearance: MEDIEVAL_TAVERN.chairClearance,
    chairName: 'Tavern occupied chair',
  }),
  furnishings: Object.freeze({ build: buildFurnishings }),
  decoration: Object.freeze({}),
  atmosphere: Object.freeze({ createMaterials, suggestedLighting: 'warm' }),
  assets: Object.freeze(
    Object.fromEntries(
      ['chair', 'stool', 'bench', 'barrel', 'hearth', 'window', 'bar', 'chandelier'].map((kind) => [
        kind,
        Object.freeze({
          url: `/models/environments/medieval-tavern/tavern-${kind}.glb`,
          scale: 7,
          name: `Tavern ${kind} model`,
          ...(kind === 'chair' ? { resourceName: 'Tavern chair model resource' } : {}),
        }),
      ]),
    ),
  ),
  matchingTable: Object.freeze({
    rimWood: 'oak',
    feltColor: '#354c36',
    description: 'Oak wood and muted moss felt',
  }),
});
