import { wallOpeningPanels } from './wall-openings.js';
import { inTable } from '../../../shared/pieces.js';
import { releaseCanvasOnDispose } from '../resources.js';
import { createOakFloor, createOakTrim, createPlasterPanel } from '../cozy-room-surfaces.js';

// Seven room units per metre; the playable tabletop remains at physics Y=0.
export const POKER_NIGHT = Object.freeze({
  floorY: -5.15,
  wallHeight: 17.5,
  clearance: 10,
  minimumHalfSize: 17,
  cutawayInset: 0.3,
  cutawayHysteresis: 0.15,
  panelHeight: 5.7,
  panelWidth: 3.5,
  maximumPanels: 48,
  windowWidth: 8.505, // Authored clear aperture: 1.215m × 1.315m at seven units/metre.
  windowBottom: 6.8075,
  windowHeight: 9.205,
  chairClearance: 2.7,
  rugMargin: 4.4,
  textureSize: 512,
  phoneTextureSize: 256,
  modelScale: 7,
  sideboardInset: 2.2,
  sideboardTop: 5.6595,
  authoredRugWidth: 28.35,
  authoredRugDepth: 22.75,
  doorOffsetRatio: 0.265625,
  doorWidth: 7.56,
  doorHeight: 15.96,
  doorSurroundWidth: 9.1,
});

function createMaterials(THREE, onLoad, phoneSafe) {
  const loader = new THREE.TextureLoader();
  const texture = (url, color = false) => {
    const map = loader.load(url, onLoad);
    if (color) map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    return map;
  };
  const walnut = texture('/textures/wood-walnut.png', true);
  const walnutNormal = phoneSafe ? null : texture('/textures/poker-walnut-normal.png');
  const walnutRoughness = phoneSafe ? null : texture('/textures/poker-walnut-roughness.png');
  return {
    plain: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 }),
    walnut: new THREE.MeshStandardMaterial({
      map: walnut,
      normalMap: walnutNormal,
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughnessMap: walnutRoughness,
      color: '#796049',
      roughness: phoneSafe ? 0.42 : 1,
    }),
    floor: new THREE.MeshStandardMaterial({
      map: walnut,
      normalMap: walnutNormal,
      normalScale: new THREE.Vector2(0.6, 0.6),
      color: '#5b4230',
      roughness: 0.48,
    }),
    wall: new THREE.MeshStandardMaterial({
      map: texture('/textures/cozy-plaster-color.png', true),
      normalMap: phoneSafe ? null : texture('/textures/cozy-plaster-normal.png'),
      normalScale: new THREE.Vector2(0.18, 0.18),
      color: '#4b4e3a',
      roughness: 1,
    }),
    leather: new THREE.MeshStandardMaterial({ color: '#493127', roughness: 0.58 }),
    brass: new THREE.MeshStandardMaterial({ color: '#b49455', metalness: 0.75, roughness: 0.38 }),
    curtain: new THREE.MeshStandardMaterial({
      color: '#303d2a',
      roughness: 1,
      side: THREE.DoubleSide,
    }),
    shade: new THREE.MeshStandardMaterial({
      color: '#1c4836',
      metalness: 0.25,
      roughness: 0.38,
      side: THREE.DoubleSide,
    }),
    glow: new THREE.MeshStandardMaterial({
      color: '#eedab2',
      emissive: '#e9bd79',
      emissiveIntensity: 0.65,
      roughness: 1,
      side: THREE.DoubleSide,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: '#e1d7b5',
      transparent: true,
      opacity: 0.22,
      roughness: 0.15,
      depthWrite: false,
    }),
    windowGlass: new THREE.MeshStandardMaterial({
      color: '#eef4f4',
      transparent: true,
      opacity: 0.025,
      roughness: 0.08,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  };
}

function buildStructure({ THREE, root, layout, materials, assembly }) {
  const { rx, rz, floor, top } = layout;
  const { box, group } = assembly;
  box(root, [rx * 2, 0.2, rz * 2], [0, floor - 0.1, 0], '#35271d');
  root.add(createOakFloor(THREE, rx, rz, floor, materials.floor));
  const specs = [
    ['north', [0, 0, -rz], 0, rx * 2, [0, 0, -1]],
    ['south', [0, 0, rz], Math.PI, rx * 2, [0, 0, 1]],
    ['east', [rx, 0, 0], -Math.PI / 2, rz * 2, [1, 0, 0]],
    ['west', [-rx, 0, 0], Math.PI / 2, rz * 2, [-1, 0, 0]],
  ];
  const walls = specs.map(([id, position, yaw, width, direction]) => {
    const wall = group(`Poker ${id} wall`, position, yaw);
    const panel = (size, at) => wall.add(createPlasterPanel(THREE, size, at, materials.wall));
    const opening =
      id === 'north'
        ? {
            x: 0,
            width: POKER_NIGHT.windowWidth,
            bottom: floor + POKER_NIGHT.windowBottom,
            top: floor + POKER_NIGHT.windowBottom + POKER_NIGHT.windowHeight,
          }
        : id === 'south'
          ? {
              x: rx * POKER_NIGHT.doorOffsetRatio,
              width: POKER_NIGHT.doorWidth,
              bottom: floor,
              top: floor + POKER_NIGHT.doorHeight,
            }
          : null;
    for (const [w, h, x, y] of wallOpeningPanels(width, floor, top, opening))
      panel([w, h, 1], [x, y, -0.25]);
    // Lower dressing stops against the door casing rather than covering the aperture.
    const lowerOpening =
      id === 'south' ? { ...opening, width: POKER_NIGHT.doorSurroundWidth } : null;
    const spans = wallOpeningPanels(width, floor, floor + POKER_NIGHT.panelHeight, lowerOpening);
    for (const [w, h, x, y] of spans) {
      wall.add(createPlasterPanel(THREE, [w, h, 0.17], [x, y, 0.32], materials.walnut));
      for (const y of [0.55, POKER_NIGHT.panelHeight - 0.3])
        box(wall, [w, 0.16, 0.15], [x, floor + y, 0.46], '#ffffff', materials.walnut);
      for (const y of [floor, floor + POKER_NIGHT.panelHeight]) {
        const trim = createOakTrim(THREE, w, materials.walnut);
        trim.position.set(x, y, 0.43);
        if (y !== floor) {
          trim.rotation.z = Math.PI;
          trim.scale.y = 0.45;
        }
        wall.add(trim);
      }
    }
    const count = Math.min(POKER_NIGHT.maximumPanels, Math.ceil(width / POKER_NIGHT.panelWidth));
    const step = width / count;
    for (let i = 0; i <= count; i++) {
      const x = -width / 2 + i * step;
      if (lowerOpening && Math.abs(x - lowerOpening.x) < lowerOpening.width / 2 + 0.08) continue;
      box(
        wall,
        [0.16, POKER_NIGHT.panelHeight - 0.65, 0.16],
        [x, floor + POKER_NIGHT.panelHeight / 2, 0.46],
        '#ffffff',
        materials.walnut,
      );
    }
    box(wall, [width, 0.28, 0.4], [0, top - 0.15, 0.35], '#ffffff', materials.walnut);
    const normal = new THREE.Vector3(...direction);
    return {
      group: wall,
      width,
      cutawayPlanes: [
        new THREE.Plane(normal, -normal.dot(wall.position) + POKER_NIGHT.cutawayInset),
      ],
    };
  });
  const ceiling = group('Poker ceiling');
  // An opaque shadow-casting roof would block the room's independent sun light.
  ceiling.add(createPlasterPanel(THREE, [rx * 2, 0.2, rz * 2], [0, top, 0], materials.wall));
  for (const x of [-rx * 0.65, 0, rx * 0.65])
    ceiling.add(
      createPlasterPanel(THREE, [0.25, 0.32, rz * 2], [x, top - 0.22, 0], materials.walnut),
    );
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

function buildOpenings({ THREE, layout, structure, materials, assembly, phoneSafe }) {
  const parent = structure.anchors.get('north').group;
  const wall = new THREE.Group();
  wall.name = 'Poker window fallback';
  parent.add(wall);
  const { box } = assembly;
  const half = POKER_NIGHT.windowWidth / 2;
  const y = layout.floor + POKER_NIGHT.windowBottom;
  const height = POKER_NIGHT.windowHeight;
  for (const x of [-half, half])
    box(wall, [0.22, height + 0.45, 0.7], [x, y + height / 2, 0.14], '#ffffff', materials.walnut);
  for (const dy of [0, height])
    box(wall, [half * 2 + 0.45, 0.22, 0.7], [0, y + dy, 0.14], '#ffffff', materials.walnut);
  box(wall, [0.1, height, 0.18], [0, y + height / 2, 0.02], '#ffffff', materials.walnut);
  box(wall, [half * 2, 0.1, 0.18], [0, y + height * 0.55, 0.02], '#ffffff', materials.walnut);
  box(wall, [half * 2 + 1.4, 0.14, 0.16], [0, y + height + 0.5, 0.65], '#ffffff', materials.brass);
  // Folded opaque drapes remain at the sides; no blended window pass on phones.
  for (const sign of [-1, 1]) {
    const geometry = new THREE.PlaneGeometry(1.9, height + 0.75, 16, 1);
    const vertices = geometry.attributes.position;
    for (let i = 0; i < vertices.count; i++)
      vertices.setZ(i, Math.cos(vertices.getX(i) * 19) * 0.16);
    geometry.computeVertexNormals();
    const curtain = new THREE.Mesh(geometry, materials.curtain);
    curtain.name = 'Poker folded curtain';
    curtain.position.set(sign * (half + 0.35), y + height / 2, 0.7);
    wall.add(curtain);
  }
  const window = new THREE.Group();
  window.name = 'Poker authored window';
  window.position.y = layout.floor;
  parent.add(window);
  assembly.furnishing('window', window, wall, 0, (model) => {
    model.traverse((node) => {
      if (
        !node.isMesh ||
        ![node.material].flat().some((material) => material.name.includes('clear cut crystal'))
      )
        return;
      node.name = 'Poker clear window glazing';
      node.material = materials.windowGlass;
      node.visible = !phoneSafe;
      node.castShadow = node.receiveShadow = false;
    });
  });
  const door = new THREE.Group();
  door.name = 'Poker windowed door';
  door.position.set(layout.rx * POKER_NIGHT.doorOffsetRatio, layout.floor, 0);
  structure.anchors.get('south').group.add(door);
  const frame = new THREE.Group();
  door.add(frame);
  for (const x of [-4.13, 4.13])
    box(frame, [0.84, 15.1, 1.05], [x, 7.55, 0], '#ffffff', materials.walnut);
  box(frame, [9.1, 0.91, 1.05], [0, 15.54, 0], '#ffffff', materials.walnut);
  box(frame, [7.2, 10.5, 0.45], [0, 5.25, 0.1], '#ffffff', materials.walnut);
  assembly.furnishing('door', door, frame, 0, (model) =>
    model.traverse((node) => {
      if (!node.isMesh || ![node.material].flat().some((m) => m.name.includes('clear glazing')))
        return;
      node.material = materials.windowGlass;
      node.name = 'Poker clear door glazing';
      node.visible = !phoneSafe;
      node.castShadow = node.receiveShadow = false;
    }),
  );
  return {};
}

// A shared beveled cushion geometry keeps each live chair inexpensive to clone.
function buildPlayArea({ THREE, layout, materials, assembly, phoneSafe }) {
  const { hx, hz, floor, tableShape } = layout;
  const { group, box, contact, furnishing } = assembly;
  const supports = group('Poker table supports');
  const footprints = [];
  for (const x of [-hx * 0.6, hx * 0.6])
    for (const z of [-hz * 0.6, hz * 0.6])
      if (inTable(x, z, tableShape, hx, hz)) {
        box(supports, [0.7, -1 - floor, 0.7], [x, (floor - 1) / 2, z], '#ffffff', materials.walnut);
        footprints.push({ x, z, width: 1.4, depth: 1.4 });
      }
  contact(supports, footprints, floor + 0.025);
  const chairTemplate = group('Poker chair resources');
  chairTemplate.visible = false;
  const shape = new THREE.Shape();
  shape.moveTo(-0.4, -0.5);
  shape.lineTo(0.4, -0.5);
  shape.quadraticCurveTo(0.5, -0.5, 0.5, -0.4);
  shape.lineTo(0.5, 0.4);
  shape.quadraticCurveTo(0.5, 0.5, 0.4, 0.5);
  shape.lineTo(-0.4, 0.5);
  shape.quadraticCurveTo(-0.5, 0.5, -0.5, 0.4);
  shape.lineTo(-0.5, -0.4);
  shape.quadraticCurveTo(-0.5, -0.5, -0.4, -0.5);
  const cushion = new THREE.ExtrudeGeometry(shape, {
    depth: 0.8,
    bevelEnabled: true,
    bevelSize: 0.07,
    bevelThickness: 0.1,
    bevelSegments: 2,
    curveSegments: 4,
    steps: 1,
  });
  cushion.translate(0, 0, -0.4);
  const seat = new THREE.Mesh(cushion, materials.leather);
  seat.name = 'Poker leather seat';
  seat.scale.set(2.8, 2.5, 0.55);
  seat.rotation.x = -Math.PI / 2;
  seat.position.y = 3.15;
  const back = new THREE.Mesh(cushion, materials.leather);
  back.name = 'Poker leather back';
  back.scale.set(2.8, 3.2, 0.5);
  back.position.set(0, 4.7, 1.14);
  back.rotation.x = -0.08;
  chairTemplate.add(seat, back);
  seat.castShadow = back.castShadow = !phoneSafe;
  seat.receiveShadow = back.receiveShadow = !phoneSafe;
  for (const x of [-1.06, 1.06]) {
    for (const z of [-0.92, 0.92])
      box(chairTemplate, [0.22, 3, 0.22], [x, 1.5, z], '#ffffff', materials.walnut);
    box(chairTemplate, [0.16, 3.3, 0.18], [x, 4.6, 1.14], '#ffffff', materials.walnut);
  }
  box(chairTemplate, [2.8, 0.18, 2.5], [0, 2.85, 0], '#ffffff', materials.walnut);
  contact(chairTemplate, [{ width: 4.4, depth: 4.4 }]);
  furnishing('chair', chairTemplate, chairTemplate, Math.PI);
  return { chairTemplate, chairModel: 'chair' };
}

function buildFurnishings({ THREE, layout, structure, materials, assembly, phoneSafe }) {
  const { floor, top } = layout;
  const { box, contact, furnishing } = assembly;
  const east = structure.anchors.get('east').group;
  const sideboard = new THREE.Group();
  sideboard.name = 'Poker sideboard';
  sideboard.position.set(0, floor, POKER_NIGHT.sideboardInset);
  east.add(sideboard);
  const body = new THREE.Group();
  body.name = 'Poker sideboard fallback';
  sideboard.add(body);
  box(body, [9, 4.3, 2.5], [0, 2.65, 0], '#ffffff', materials.walnut);
  box(body, [9.5, 0.25, 2.9], [0, POKER_NIGHT.sideboardTop, 0], '#ffffff', materials.walnut);
  for (const x of [-3.9, 3.9])
    for (const z of [-0.9, 0.9])
      box(body, [0.3, 0.7, 0.3], [x, 0.35, z], '#ffffff', materials.walnut);
  for (const x of [-2.15, 2.15]) {
    box(body, [4.1, 3.55, 0.12], [x, 2.7, 1.31], '#ffffff', materials.walnut);
    box(body, [0.55, 0.08, 0.12], [x, 3.7, 1.43], '#ffffff', materials.brass);
  }
  contact(sideboard, [{ width: 10, depth: 4 }]);
  furnishing('sideboard', sideboard, body);
  const segments = phoneSafe ? 12 : 24;
  for (const x of [0.5, 1.5, 2.5]) {
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.24, 0.7, segments, 1, true),
      phoneSafe ? materials.brass : materials.glass,
    );
    glass.name = 'Poker sideboard glass';
    const slot = new THREE.Group();
    slot.position.set(x, POKER_NIGHT.sideboardTop - 0.014, 0.42);
    glass.position.y = 0.35;
    slot.add(glass);
    sideboard.add(slot);
    furnishing('tumbler', slot, glass);
  }
  const bottle = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        [0, 0],
        [0.43, 0],
        [0.5, 0.15],
        [0.5, 0.9],
        [0.2, 1.15],
        [0.17, 1.65],
        [0.27, 1.7],
        [0.27, 1.85],
        [0, 1.85],
      ].map(([x, y]) => new THREE.Vector2(x, y)),
      segments,
    ),
    materials.brass,
  );
  bottle.name = 'Poker sideboard carafe';
  const carafe = new THREE.Group();
  carafe.position.set(-2.45, POKER_NIGHT.sideboardTop - 0.021, 0.42);
  carafe.add(bottle);
  sideboard.add(carafe);
  furnishing('carafe', carafe, bottle);
  const pendant = new THREE.Group();
  pendant.name = 'Poker pendant';
  structure.ceiling.group.add(pendant);
  const pendantFallback = new THREE.Group();
  pendant.add(pendantFallback);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.1, 8), materials.brass);
  stem.position.y = top - 1.65;
  pendantFallback.add(stem);
  const shade = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        [0.16, 0.9],
        [0.45, 0.85],
        [0.85, 0.6],
        [1.3, 0.25],
        [1.75, -0.2],
        [2, -0.7],
        [2.05, -0.9],
      ].map(([x, y]) => new THREE.Vector2(x, y)),
      segments,
    ),
    materials.shade,
  );
  shade.name = 'Poker green pendant shade';
  shade.position.y = top - 4.1;
  pendantFallback.add(shade);
  const diffuser = new THREE.Mesh(new THREE.CircleGeometry(1.96, segments), materials.glow);
  diffuser.name = 'Poker pendant diffuser';
  diffuser.rotation.x = Math.PI / 2;
  diffuser.position.y = top - 4.95;
  pendantFallback.add(diffuser);
  const pendantModel = new THREE.Group();
  pendantModel.position.y = top - 0.7 * POKER_NIGHT.modelScale;
  pendant.add(pendantModel);
  furnishing('pendant', pendantModel, pendantFallback, 0, (model) => {
    model.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = false;
      if (node.material.name.includes('warm ivory diffuser')) node.material = materials.glow;
    });
  });
  // Fixtures suggest warmth without changing saved lights or shading the game.
  return {};
}

function buildDecoration({
  THREE,
  root,
  layout,
  materials,
  assembly,
  structure,
  phoneSafe,
  doc,
  textureAnisotropy,
}) {
  const canvas = doc.createElement('canvas');
  canvas.width = canvas.height = phoneSafe ? POKER_NIGHT.phoneTextureSize : POKER_NIGHT.textureSize;
  const ctx = canvas.getContext('2d');
  let map = null;
  if (ctx) {
    const s = canvas.width;
    ctx.fillStyle = '#333630';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#777466';
    ctx.lineWidth = s * 0.025;
    ctx.strokeRect(s * 0.05, s * 0.05, s * 0.9, s * 0.9);
    ctx.strokeStyle = '#a29777';
    ctx.lineWidth = s * 0.005;
    ctx.strokeRect(s * 0.09, s * 0.09, s * 0.82, s * 0.82);
    ctx.strokeStyle = '#4c4f44';
    ctx.lineWidth = 1;
    for (let i = 0; i < s; i += 4) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, s);
      ctx.stroke();
    }
    map = releaseCanvasOnDispose(new THREE.CanvasTexture(canvas), canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = phoneSafe ? 1 : Math.max(1, Math.min(8, Number(textureAnisotropy) || 1));
  } else canvas.width = canvas.height = 0;
  const rug = new THREE.Mesh(
    new THREE.BoxGeometry(
      (layout.hx + POKER_NIGHT.rugMargin) * 2,
      0.06,
      (layout.hz + POKER_NIGHT.rugMargin) * 2,
    ),
    new THREE.MeshStandardMaterial({ color: map ? '#ffffff' : '#333630', map, roughness: 1 }),
  );
  rug.name = 'Poker woven rug';
  rug.position.y = layout.floor + 0.09;
  rug.receiveShadow = true;
  root.add(rug);
  const { box, furnishing, contact } = assembly;
  const rugModel = new THREE.Group();
  rugModel.position.y = layout.floor + 0.055;
  root.add(rugModel);
  furnishing('rug', rugModel, rug, 0, (model) => {
    model.scale.x *= ((layout.hx + POKER_NIGHT.rugMargin) * 2) / POKER_NIGHT.authoredRugWidth;
    model.scale.z *= ((layout.hz + POKER_NIGHT.rugMargin) * 2) / POKER_NIGHT.authoredRugDepth;
    model.traverse((node) => {
      if (node.isMesh) node.castShadow = false;
    });
  });
  const artCanvas = doc.createElement('canvas');
  artCanvas.width = phoneSafe ? 256 : 512;
  artCanvas.height = artCanvas.width / 2;
  const artContext = artCanvas.getContext('2d');
  let artMap = null;
  if (artContext) {
    const w = artCanvas.width,
      h = artCanvas.height;
    artContext.fillStyle = '#b3a382';
    artContext.fillRect(0, 0, w, h);
    for (let layer = 0; layer < 4; layer++) {
      artContext.fillStyle = ['#9b9980', '#85856b', '#6b7058', '#4a5845'][layer];
      artContext.beginPath();
      artContext.moveTo(0, h);
      for (let x = 0; x <= w; x += 4)
        artContext.lineTo(
          x,
          h * (0.43 + layer * 0.13) +
            Math.sin((x / w) * 12 + layer * 2) * h * 0.1 +
            Math.cos((x / w) * 23 + layer) * h * 0.035,
        );
      artContext.lineTo(w, h);
      artContext.closePath();
      artContext.fill();
    }
    artMap = releaseCanvasOnDispose(new THREE.CanvasTexture(artCanvas), artCanvas);
    artMap.colorSpace = THREE.SRGBColorSpace;
  } else artCanvas.width = artCanvas.height = 0;
  const artMaterial = new THREE.MeshStandardMaterial({
    map: artMap,
    color: artMap ? '#ffffff' : '#686e58',
    roughness: 1,
  });
  const center = layout.floor + 12.25;
  for (const [anchor, x] of [
    ['west', 0],
    ['north', -layout.rx * 0.55],
    ['north', layout.rx * 0.55],
  ]) {
    const wall = structure.anchors.get(anchor).group;
    const fallback = new THREE.Group();
    wall.add(fallback);
    box(fallback, [6.7, 4.2, 0.18], [x, center, 0.44], '#ffffff', materials.walnut);
    box(fallback, [6.2, 3.7, 0.12], [x, center, 0.56], '#ad9d78');
    const landscape = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 3.3), artMaterial);
    landscape.name = 'Poker framed landscape';
    landscape.position.set(x, center, 0.65);
    fallback.add(landscape);
    const frame = new THREE.Group();
    frame.position.set(x, layout.floor + 10.29, 0.55);
    wall.add(frame);
    furnishing('landscape', frame, fallback);
  }
  for (const x of [-layout.rx + 2.6, layout.rx - 2.6]) {
    const plant = new THREE.Group();
    plant.name = 'Poker corner plant';
    plant.position.set(x, layout.floor, 2.7);
    structure.anchors.get('north').group.add(plant);
    const fallback = new THREE.Group();
    plant.add(fallback);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.72, 1.6, 12), materials.walnut);
    pot.position.y = 0.8;
    fallback.add(pot);
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), materials.curtain);
    leaf.scale.set(1.3, 2.2, 1.3);
    leaf.position.y = 3.4;
    fallback.add(leaf);
    contact(plant, [{ width: 3.6, depth: 3.6 }]);
    furnishing('rubber', plant, fallback);
  }
}

export const POKER_NIGHT_THEME = Object.freeze({
  id: 'poker-night',
  name: 'Poker Night',
  structure: Object.freeze({ ...POKER_NIGHT, build: buildStructure }),
  openings: Object.freeze({ build: buildOpenings }),
  playArea: Object.freeze({
    build: buildPlayArea,
    chairClearance: POKER_NIGHT.chairClearance,
    chairName: 'Poker leather chair',
  }),
  furnishings: Object.freeze({ build: buildFurnishings }),
  decoration: Object.freeze({ build: buildDecoration }),
  atmosphere: Object.freeze({ createMaterials, suggestedLighting: 'warm' }),
  assets: Object.freeze({
    ...Object.fromEntries(
      [
        'chair',
        'sideboard',
        'pendant',
        'carafe',
        'tumbler',
        'landscape',
        'rug',
        'window',
        'door',
      ].map((key) => [
        key,
        Object.freeze({
          url: `/models/environments/poker-night/poker-${key}.glb`,
          scale: POKER_NIGHT.modelScale,
          name: `Poker ${key} model`,
          ...(key === 'chair' ? { resourceName: 'Poker chair model resource' } : {}),
        }),
      ]),
    ),
    rubber: Object.freeze({
      url: '/models/environments/cozy/cozy-rubber-plant.glb',
      scale: 7,
      name: 'Poker rubber plant',
    }),
  }),
  matchingTable: Object.freeze({
    rimWood: 'walnut',
    feltColor: '#1e5c3f',
    description: 'Walnut wood and dark green felt',
  }),
});
