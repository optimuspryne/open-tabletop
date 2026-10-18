// Materials and dimension-aware surface geometry for the local cozy environment.
// The caller owns every returned geometry/material/texture through its room hierarchy.
export const ROOM_SURFACES = Object.freeze({
  texturePrefix: '/textures/cozy-',
  plasterTile: 7,
  plankLength: 10.5,
  plankWidth: 1.4,
  plankGap: 0.025,
  maximumRows: 96,
  maximumColumns: 32,
  maximumBoards: 2048,
  glassOpacity: 0.025,
});

export function createRoomMaterials(THREE, onLoad, phoneSafe = false) {
  const loader = new THREE.TextureLoader();
  const texture = (url, color = false) => {
    const map = loader.load(url, onLoad);
    if (color) map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    return map;
  };
  const oakNormal = phoneSafe ? null : texture(`${ROOM_SURFACES.texturePrefix}oak-normal.png`);
  const oakRoughness = phoneSafe
    ? null
    : texture(`${ROOM_SURFACES.texturePrefix}oak-roughness.png`);
  return {
    oak: new THREE.MeshStandardMaterial({
      map: texture('/textures/wood-oak.png', true),
      normalMap: oakNormal,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughnessMap: oakRoughness,
      roughness: 1,
    }),
    floor: new THREE.MeshStandardMaterial({
      map: texture(`${ROOM_SURFACES.texturePrefix}floor-oak-color.png`, true),
      normalMap: oakNormal,
      normalScale: new THREE.Vector2(0.28, 0.28),
      roughnessMap: oakRoughness,
      roughness: 1,
    }),
    plaster: new THREE.MeshStandardMaterial({
      map: texture(`${ROOM_SURFACES.texturePrefix}plaster-color.png`, true),
      normalMap: phoneSafe ? null : texture(`${ROOM_SURFACES.texturePrefix}plaster-normal.png`),
      normalScale: new THREE.Vector2(0.25, 0.25),
      roughnessMap: phoneSafe
        ? null
        : texture(`${ROOM_SURFACES.texturePrefix}plaster-roughness.png`),
      roughness: 1,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: '#eef4f4',
      roughness: 0.08,
      metalness: 0,
      transparent: true,
      opacity: ROOM_SURFACES.glassOpacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  };
}

export function createPlasterPanel(THREE, size, position, material) {
  const geometry = new THREE.BoxGeometry(...size);
  const vertices = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  // Project from physical wall coordinates, so texture scale stays fixed across resizes
  // and neighboring panels meet without stretching a whole texture over each panel.
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i) + position[0];
    const y = vertices.getY(i) + position[1];
    const z = vertices.getZ(i) + position[2];
    const nx = Math.abs(normals.getX(i));
    const ny = Math.abs(normals.getY(i));
    const nz = Math.abs(normals.getZ(i));
    uv.setXY(
      i,
      (nx > nz ? z : x) / ROOM_SURFACES.plasterTile,
      (ny > 0.5 ? z : y) / ROOM_SURFACES.plasterTile,
    );
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Textured plaster panel';
  mesh.position.set(...position);
  mesh.receiveShadow = true;
  return mesh;
}

export function createOakFloor(THREE, rx, rz, floorY, material) {
  const columns = Math.min(
    ROOM_SURFACES.maximumColumns,
    Math.ceil((rx * 2) / ROOM_SURFACES.plankLength),
  );
  const rows = Math.min(
    ROOM_SURFACES.maximumRows,
    Math.floor(ROOM_SURFACES.maximumBoards / (columns + 1)),
    Math.ceil((rz * 2) / ROOM_SURFACES.plankWidth),
  );
  const length = (rx * 2) / columns;
  const width = (rz * 2) / rows;
  const boards = [];
  for (let row = 0; row < rows; row++) {
    const offset = ((row % 3) * length) / 3;
    for (let column = -1; column <= columns; column++) {
      const left = Math.max(-rx, -rx + column * length - offset);
      const right = Math.min(rx, -rx + (column + 1) * length - offset);
      if (right - left <= ROOM_SURFACES.plankGap) continue;
      boards.push({
        x: (left + right) / 2,
        z: -rz + (row + 0.5) * width,
        length: right - left,
        shade: (row * 19 + column * 7 + 3) % 4,
      });
    }
  }
  const outline = new THREE.Shape();
  outline.moveTo(-0.492, -0.492);
  outline.lineTo(0.492, -0.492);
  outline.lineTo(0.492, 0.492);
  outline.lineTo(-0.492, 0.492);
  outline.closePath();
  const geometry = new THREE.ExtrudeGeometry(outline, {
    depth: 0.984,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.008,
    bevelThickness: 0.008,
  });
  geometry.translate(0, 0, -0.492);
  geometry.rotateX(-Math.PI / 2);
  const vertices = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < vertices.count; i++)
    uv.setXY(i, vertices.getZ(i) + 0.5, vertices.getX(i) + 0.5);
  const mesh = new THREE.InstancedMesh(geometry, material, boards.length);
  mesh.name = 'Staggered oak floorboards';
  const transform = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const shades = ['#ffffff', '#f7f0e4', '#f0e8dc', '#faf6ed'];
  boards.forEach((board, i) => {
    transform.compose(
      new THREE.Vector3(board.x, floorY + 0.025, board.z),
      rotation,
      new THREE.Vector3(
        board.length - ROOM_SURFACES.plankGap,
        0.05,
        width - ROOM_SURFACES.plankGap,
      ),
    );
    mesh.setMatrixAt(i, transform);
    mesh.setColorAt(i, new THREE.Color(shades[board.shade]));
  });
  mesh.receiveShadow = true;
  return mesh;
}

export function createOakTrim(THREE, width, material) {
  // A shallow moulded profile, extruded along the wall rather than three separate strips.
  const profile = new THREE.Shape();
  profile.moveTo(0, 0);
  for (const [z, y] of [
    [0.24, 0],
    [0.24, 0.12],
    [0.16, 0.12],
    [0.16, 0.64],
    [0.12, 0.71],
    [0, 0.71],
  ])
    profile.lineTo(-z, y);
  profile.closePath();
  const geometry = new THREE.ExtrudeGeometry(profile, {
    depth: width,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.015,
    bevelThickness: 0.015,
  });
  geometry.translate(0, 0, -width / 2);
  geometry.rotateY(Math.PI / 2);
  const vertices = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < vertices.count; i++) uv.setXY(i, vertices.getY(i), vertices.getX(i) / 7);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Profiled oak wall trim';
  mesh.receiveShadow = true;
  return mesh;
}
