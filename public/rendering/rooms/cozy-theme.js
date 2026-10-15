import { inTable } from '../../../shared/pieces.js';
import { releaseCanvasOnDispose } from '../resources.js';
import { COZY_SHADOWS } from '../cozy-room-shadows.js';
import {
  createRoomMaterials,
  createPlasterPanel,
  createOakFloor,
  createOakTrim,
} from '../cozy-room-surfaces.js';

export const COZY_ROOM = Object.freeze({
  floorY: -5.5,
  wallHeight: 15,
  clearance: 10,
  minimumHalfSize: 17,
  wallThickness: 1.05,
  rugMargin: 3,
  cutawayThreshold: 0.22,
  overheadSlope: 3,
  textureSize: 1024,
  phoneTextureSize: 512,
  // A 5.5-unit table height corresponds to a roughly 0.79m dining table.
  furnitureScale: 7,
  shelfWallInset: 1.6,
  shelfTop: 12.061, // Owner's corrected shelf: 1.723m, scaled by seven.
  chairClearance: 2.5,
  furnitureURLs: Object.freeze({
    chair: '/models/environments/cozy/cozy-chair.glb',
    shelf: '/models/environments/cozy/cozy-game-shelf.glb',
    lamp: '/models/environments/cozy/cozy-floor-lamp.glb',
    window: '/models/environments/cozy/cozy-window.glb',
    rubber: '/models/environments/cozy/cozy-rubber-plant.glb',
    snake: '/models/environments/cozy/cozy-snake-plant.glb',
    pothos: '/models/environments/cozy/cozy-pothos.glb',
  }),
});
function roomTexture({ THREE, doc, phoneSafe, textureAnisotropy }) {
  const canvas = doc.createElement('canvas');
  canvas.width = canvas.height = phoneSafe ? COZY_ROOM.phoneTextureSize : COZY_ROOM.textureSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.width = canvas.height = 0;
    return null;
  }
  const s = canvas.width;
  const scale = s / 256;
  ctx.fillStyle = '#b3a085';
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = '#948269';
  ctx.lineWidth = scale / 4;
  for (let i = 0; i < s; i += scale) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(s, i);
    ctx.stroke();
  }
  ctx.strokeStyle = '#5c6754';
  ctx.lineWidth = 7 * scale;
  ctx.strokeRect(9 * scale, 9 * scale, s - 18 * scale, s - 18 * scale);
  ctx.strokeStyle = '#e1d3b9';
  ctx.lineWidth = 2 * scale;
  ctx.strokeRect(17 * scale, 17 * scale, s - 34 * scale, s - 34 * scale);
  // A restrained woven border, not a busy pattern competing with the game.
  const texture = releaseCanvasOnDispose(new THREE.CanvasTexture(canvas), canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = phoneSafe ? 1 : Math.max(1, Math.min(8, Number(textureAnisotropy) || 1));
  return texture;
}

function buildStructure({ THREE, root, layout, materials: surfaces, assembly }) {
  const { rx, rz, floor, top } = layout;
  const woodMaterial = surfaces.oak;
  const { group } = assembly;
  const floorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(rx * 2, 0.2, rz * 2),
    new THREE.MeshStandardMaterial({ color: '#66513d', roughness: 0.95 }),
  );
  floorMesh.position.y = floor - 0.1;
  floorMesh.receiveShadow = true;
  floorMesh.name = 'Oak floor';
  root.add(floorMesh);
  root.add(createOakFloor(THREE, rx, rz, floor, surfaces.floor));
  const wallSpecs = [
    { name: 'North wall', position: [0, 0, -rz], yaw: 0, width: rx * 2, normal: [0, -1] },
    { name: 'South wall', position: [0, 0, rz], yaw: Math.PI, width: rx * 2, normal: [0, 1] },
    { name: 'East wall', position: [rx, 0, 0], yaw: -Math.PI / 2, width: rz * 2, normal: [1, 0] },
    {
      name: 'West wall',
      position: [-rx, 0, 0],
      yaw: Math.PI / 2,
      width: rz * 2,
      normal: [-1, 0],
    },
  ];
  const walls = wallSpecs.map((spec, index) => {
    const wall = group(spec.name, spec.position, spec.yaw);
    const panel = (size, position) =>
      wall.add(createPlasterPanel(THREE, size, position, surfaces.plaster));
    // Actual openings reveal the existing scene sky/background through clear glazing.
    if (index < 2) {
      const centers = [-spec.width * 0.2, spec.width * 0.2];
      const edges = [
        -spec.width / 2,
        centers[0] - 2.15,
        centers[0] + 2.15,
        centers[1] - 2.15,
        centers[1] + 2.15,
        spec.width / 2,
      ];
      for (let i = 0; i < edges.length; i += 2)
        panel(
          [edges[i + 1] - edges[i], 5.5, COZY_ROOM.wallThickness],
          [(edges[i] + edges[i + 1]) / 2, 3.1, -0.25],
        );
      panel([spec.width, 0.35 - floor, COZY_ROOM.wallThickness], [0, (floor + 0.35) / 2, -0.25]);
      panel([spec.width, top - 5.85, COZY_ROOM.wallThickness], [0, (top + 5.85) / 2, -0.25]);
    } else
      panel(
        [spec.width, COZY_ROOM.wallHeight, COZY_ROOM.wallThickness],
        [0, (floor + top) / 2, -0.25],
      );
    const skirting = createOakTrim(THREE, spec.width, woodMaterial);
    skirting.position.set(0, floor, COZY_ROOM.wallThickness / 2 - 0.25 + 0.015);
    wall.add(skirting);
    const cap = createOakTrim(THREE, spec.width, woodMaterial);
    cap.position.set(0, top, skirting.position.z);
    cap.rotation.z = Math.PI;
    cap.scale.y = 0.4;
    wall.add(cap);
    return { group: wall, normal: spec.normal, width: spec.width };
  });

  return {
    walls,
    anchors: new Map(['north', 'south', 'east', 'west'].map((id, i) => [id, walls[i]])),
  };
}
function buildOpenings({ THREE, structure, materials: surfaces, assembly, phoneSafe }) {
  const materials = surfaces;
  const { box, furnishing } = assembly;
  function windowPane(parent, x) {
    const surround = new THREE.Group();
    surround.name = 'Oak casement window';
    surround.position.set(x, 3.1, 0);
    parent.add(surround);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(3.64, 4.82), surfaces.glass);
    pane.name = 'Clear window glazing';
    pane.position.z = -0.16;
    // The opening already shows the sky. Phones omit the almost-invisible
    // transparent pane instead of compiling another blended lighting shader.
    pane.visible = !phoneSafe;
    surround.add(pane);
    const fallback = new THREE.Group();
    fallback.name = 'Window frame fallback';
    surround.add(fallback);
    for (const dx of [-2.15, 2.15])
      box(fallback, [0.3, 5.6, 1.1], [dx, 0, -0.2], '#ffffff', materials.oak);
    for (const y of [-2.75, 2.75])
      box(fallback, [4.6, 0.3, 1.1], [0, y, -0.2], '#ffffff', materials.oak);
    box(fallback, [5.15, 0.18, 1.55], [0, -2.94, 0.4], '#ffffff', materials.oak);
    box(fallback, [0.1, 5.0, 0.18], [0, 0, -0.16], '#ffffff', materials.oak);
    box(fallback, [3.8, 0.1, 0.18], [0, 0, -0.16], '#ffffff', materials.oak);
    furnishing('window', surround, fallback);
  }

  for (const { group: wall, width } of structure.walls.slice(0, 2))
    [-width * 0.2, width * 0.2].forEach((x) => windowPane(wall, x));
  const north = structure.anchors.get('north');
  return { sill: { parent: north.group, position: [-north.width * 0.2 - 1.1, 0.25, 0.73] } };
}
function buildPlayArea({ layout, materials, assembly }) {
  const { hx, hz, floor, tableShape } = layout;
  const { group, box, furnishing, contact } = assembly;
  const furniture = group('Table supports');
  const legContacts = [];
  for (const x of [-hx * 0.6, hx * 0.6])
    for (const z of [-hz * 0.6, hz * 0.6]) {
      // Reuse the playable outline policy so supports remain under round/hex/oval tables too.
      if (inTable(x, z, tableShape, hx, hz)) {
        box(furniture, [0.65, -1 - floor, 0.65], [x, (floor - 1) / 2, z], '#715139', materials.oak);
        legContacts.push({ x, z, width: 1.5, depth: 1.5 });
      }
    }
  contact(furniture, legContacts, floor + COZY_SHADOWS.lift);
  // The hidden template owns resources even when the last player leaves. Live
  // copies share geometry/materials, but their instance buffers belong to each copy.
  const chairTemplate = group('Chair resources');
  chairTemplate.visible = false;
  contact(chairTemplate, [
    { width: 4.6, depth: 4.5 },
    ...[-0.85, 0.85].flatMap((x) => [-0.75, 0.75].map((z) => ({ x, z, width: 0.9, depth: 0.9 }))),
  ]);
  {
    box(chairTemplate, [2.4, 0.45, 2.25], [0, 2.45, 0], '#666a51');
    box(chairTemplate, [2.4, 2.4, 0.4], [0, 3.7, 1], '#666a51');
    for (const lx of [-0.85, 0.85])
      for (const lz of [-0.75, 0.75])
        box(chairTemplate, [0.22, 2.25, 0.22], [lx, 1.125, lz], '#72513a', materials.oak);
    // Fallback fronts point -Z; the authored GLB front is +Z.
    furnishing('chair', chairTemplate, chairTemplate, Math.PI);
  }

  return { chairTemplate, chairModel: 'chair' };
}
function buildFurnishings({ THREE, layout, structure, materials, assembly, phoneSafe }) {
  const { floor, rx, rz } = layout;
  const { group, box, furnishing, contact } = assembly;
  function bookcase(parent, x) {
    const y = floor + 4.5,
      z = 1.1;
    box(parent, [5, 9, 0.25], [x, y, z - 0.8], '#785c43', materials.oak);
    for (const dx of [-2.4, 2.4])
      box(parent, [0.25, 9, 1.8], [x + dx, y, z], '#785c43', materials.oak);
    for (let shelf = 0; shelf < 5; shelf++) {
      const sy = floor + 0.25 + shelf * 2.1;
      box(parent, [5, 0.2, 1.8], [x, sy, z], '#94704a', materials.oak);
      if (shelf === 4) continue;
      for (let book = 0; book < 8; book++) {
        const height = 1.2 + ((book * 7 + shelf) % 5) * 0.12;
        const colors = ['#536c65', '#a27651', '#46576b', '#a18f69', '#76594b'];
        box(
          parent,
          [0.45, height, 1.2],
          [x - 1.95 + book * 0.54, sy + 0.1 + height / 2, z + 0.15],
          colors[(book + shelf) % colors.length],
        );
      }
    }
  }

  const east = structure.anchors.get('east');
  const fallback = new THREE.Group();
  fallback.name = 'Procedural shelf fallback';
  east.group.add(fallback);
  bookcase(fallback, -east.width * 0.24);
  const shelf = new THREE.Group();
  shelf.name = 'Authored game shelf';
  shelf.position.set(-east.width * 0.24, floor, COZY_ROOM.shelfWallInset);
  east.group.add(shelf);
  contact(shelf, [{ z: 0.15, width: 8.6, depth: 4 }]);
  furnishing('shelf', shelf, fallback);
  const lamp = group('Warm lamp', [rx - 4, floor, -rz + 2.5]);
  box(lamp, [2, 0.15, 2], [0, 0.1, 0], '#765f46', materials.oak);
  box(lamp, [0.2, 7, 0.2], [0, 3.6, 0], '#8d7457', materials.oak);
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 1.25, 1.8, 12),
    new THREE.MeshStandardMaterial({
      color: '#e5c998',
      emissive: '#dcaa61',
      emissiveIntensity: 0.5,
      roughness: 1,
    }),
  );
  shade.position.y = 7;
  shade.castShadow = !phoneSafe;
  lamp.add(shade);
  contact(lamp, [{ width: 4, depth: 4 }]);
  furnishing('lamp', lamp, lamp);

  return { shelf, east };
}
function buildDecoration({
  THREE,
  root,
  layout,
  materials,
  assembly,
  phoneSafe,
  textureAnisotropy,
  doc,
  structure,
  openings,
  furnishings,
}) {
  const { floor, hx, hz, rx, rz } = layout;
  const { furnishing, contact } = assembly;
  const rug = new THREE.Mesh(
    new THREE.BoxGeometry((hx + COZY_ROOM.rugMargin) * 2, 0.06, (hz + COZY_ROOM.rugMargin) * 2),
    new THREE.MeshStandardMaterial({
      map: roomTexture({ THREE, doc, phoneSafe, textureAnisotropy }),
      color: '#ffffff',
      roughness: 1,
    }),
  );
  rug.position.y = floor + 0.04;
  rug.receiveShadow = true;
  rug.name = 'Woven rug';
  root.add(rug);

  const plantPotGeometry = new THREE.CylinderGeometry(1, 0.75, 1, 12);
  const plantLeafGeometry = new THREE.SphereGeometry(1, 8, 6);
  function plant(kind, parent, position, yaw = 0, scale = 1) {
    const plant = new THREE.Group();
    plant.name = `Potted ${kind}`;
    plant.position.set(...position);
    plant.rotation.y = yaw;
    plant.scale.setScalar(scale);
    parent.add(plant);
    const fallback = new THREE.Group();
    fallback.name = 'Plant fallback';
    plant.add(fallback);
    const shadowSize = kind === 'rubber' ? 3.6 : kind === 'snake' ? 2.6 : 1.2;
    contact(plant, [{ width: shadowSize, depth: shadowSize }]);
    const [radius, height] =
      kind === 'rubber' ? [1.26, 2.03] : kind === 'snake' ? [0.98, 1.715] : [0.42, 0.91];
    const pot = new THREE.InstancedMesh(plantPotGeometry, materials.plain, 1);
    const leaves = new THREE.InstancedMesh(plantLeafGeometry, materials.plain, 8);
    const matrix = new THREE.Matrix4();
    matrix.compose(
      new THREE.Vector3(0, height / 2, 0),
      new THREE.Quaternion(),
      new THREE.Vector3(radius, height, radius),
    );
    pot.setMatrixAt(0, matrix);
    pot.setColorAt(0, new THREE.Color(kind === 'snake' ? '#a17458' : '#d2c2a5'));
    for (let leaf = 0; leaf < 8; leaf++) {
      const angle = leaf * 2.4;
      matrix.compose(
        new THREE.Vector3(
          Math.sin(angle) * radius * 0.7,
          height + radius * (1 + leaf * 0.24),
          Math.cos(angle) * radius * 0.7,
        ),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, angle, 0)),
        new THREE.Vector3(radius * 0.6, radius * 0.15, radius),
      );
      leaves.setMatrixAt(leaf, matrix);
      leaves.setColorAt(leaf, new THREE.Color(leaf % 2 ? '#697d4d' : '#516d46'));
    }
    pot.castShadow = leaves.castShadow = !phoneSafe;
    fallback.add(pot, leaves);
    furnishing(kind, plant, fallback);
  }

  plant('pothos', openings.sill.parent, openings.sill.position, 0.4);
  plant('pothos', furnishings.shelf, [2.1, COZY_ROOM.shelfTop, 0.8], -0.3, 1.1);
  plant(
    'snake',
    furnishings.east.group,
    [-furnishings.east.width * 0.24 + 6.4, floor, 2.6],
    0.8,
    0.95,
  );
  const west = structure.anchors.get('west');
  plant('snake', west.group, [west.width * 0.12, floor, 2.6], 2.2, 0.85);
  plant('rubber', root, [-rx + 3, floor, -rz + 3], 0.3);
  plant('rubber', root, [rx - 3, floor, rz - 3], 2.5, 0.9);
}

export const COZY_ROOM_THEME = Object.freeze({
  id: 'cozy',
  name: 'Cozy game room',
  rootName: 'Cozy game room prototype',
  structure: Object.freeze({
    floorY: COZY_ROOM.floorY,
    wallHeight: COZY_ROOM.wallHeight,
    clearance: COZY_ROOM.clearance,
    minimumHalfSize: COZY_ROOM.minimumHalfSize,
    cutawayThreshold: COZY_ROOM.cutawayThreshold,
    overheadSlope: COZY_ROOM.overheadSlope,
    build: buildStructure,
  }),
  openings: Object.freeze({ build: buildOpenings }),
  playArea: Object.freeze({
    build: buildPlayArea,
    chairClearance: COZY_ROOM.chairClearance,
    chairName: 'Upholstered chair',
  }),
  furnishings: Object.freeze({ build: buildFurnishings }),
  decoration: Object.freeze({ build: buildDecoration }),
  atmosphere: Object.freeze({
    suggestedLighting: 'warm',
    createMaterials(THREE, onLoad, phoneSafe) {
      return {
        ...createRoomMaterials(THREE, onLoad, phoneSafe),
        plain: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }),
      };
    },
  }),
  assets: Object.freeze(
    Object.fromEntries(
      Object.entries(COZY_ROOM.furnitureURLs).map(([kind, url]) => [
        kind,
        Object.freeze({
          url,
          scale: COZY_ROOM.furnitureScale,
          name: `Cozy ${kind} model`,
          ...(kind === 'chair' ? { resourceName: 'Chair model resource' } : {}),
        }),
      ]),
    ),
  ),
  matchingTable: Object.freeze({
    rimWood: 'oak',
    feltColor: '#2f6b4f',
    description: 'Oak rim + green felt',
  }),
});
