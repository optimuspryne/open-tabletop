// The approved Blender ceiling, fitted piece by piece to the current room.
// Authoring metadata keeps timber sections, joinery offsets and UV density fixed.
import { createPlasterPanel } from '../cozy-room-surfaces.js';

export const COZY_CEILING = Object.freeze({
  url: '/models/environments/cozy/cozy-ceiling.glb',
  scale: 7,
  sourceHalfSize: 3,
  risePerHalfWidth: 0.5,
  skylightHalfLengthRatio: 0.54,
});

// Keep the detailed editable parts in Blender; draw one batch per runtime material.
function batch(THREE, model, geometries) {
  const groups = new Map();
  model.updateMatrixWorld(true);
  model.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrix);
    geometries.add(geometry);
    const end = mesh.userData.ceilingGable || 'roof';
    if (!groups.has(end)) groups.set(end, new Map());
    const bucket = groups.get(end);
    if (!bucket.has(mesh.material)) bucket.set(mesh.material, []);
    bucket.get(mesh.material).push(geometry);
  });
  model.clear();
  for (const [end, bucket] of groups)
    for (const [material, parts] of bucket) {
      const geometry = new THREE.BufferGeometry();
      for (const name of ['position', 'normal', 'uv', 'tangent']) {
        if (!parts.every((part) => part.getAttribute(name))) continue;
        const size = parts[0].getAttribute(name).itemSize;
        const values = new Float32Array(
          parts.reduce((sum, part) => sum + part.getAttribute(name).count * size, 0),
        );
        let offset = 0;
        for (const part of parts) {
          const attribute = part.getAttribute(name);
          for (let i = 0; i < attribute.count; i++)
            for (let j = 0; j < size; j++) values[offset++] = attribute.getComponent(i, j);
        }
        geometry.setAttribute(name, new THREE.BufferAttribute(values, size));
      }
      const indices = [];
      let offset = 0;
      for (const part of parts) {
        const count = part.getAttribute('position').count;
        for (let i = 0; i < (part.index?.count ?? count); i++)
          indices.push(offset + (part.index ? part.index.getX(i) : i));
        offset += count;
      }
      geometry.setIndex(indices);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = material.transparent ? 'Clear skylight glazing' : 'Cozy ceiling joinery';
      mesh.raycast = () => {};
      // The roof must not black out tabletop lighting when viewed from below.
      mesh.castShadow = false;
      if (end !== 'roof') mesh.userData.ceilingGable = end;
      model.add(mesh);
    }
  for (const geometry of geometries) geometry.dispose();
}

export function fitCozyCeiling(THREE, model, layout, materials, phoneSafe, gables = new Map()) {
  const widthDelta = layout.rx / COZY_CEILING.scale - COZY_CEILING.sourceHalfSize;
  const depthDelta = layout.rz / COZY_CEILING.scale - COZY_CEILING.sourceHalfSize;
  const geometries = new Set();
  model.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.userData.cozyCeiling) return;
    const spec = mesh.userData.cozyCeiling;
    const geometry = mesh.geometry.clone();
    geometries.add(geometry);
    mesh.geometry = geometry;
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    const size = [0, 1, 2].map(
      (axis) =>
        (spec.sizeWidth?.[axis] ?? 0) * widthDelta + (spec.sizeDepth?.[axis] ?? 0) * depthDelta,
    );
    const point = new THREE.Vector3();
    geometry.computeBoundingBox();
    const originalSize = geometry.boundingBox.getSize(new THREE.Vector3()).toArray();
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i);
      if (spec.kind === 'gable') {
        point.x *= 1 + widthDelta / 3;
        point.y *= 1 + widthDelta / 3;
        point.z += Math.sign(point.z) * depthDelta;
        uv.setXY(i, point.x / 0.42, point.y / 0.42);
      } else {
        for (let axis = 0; axis < 3; axis++)
          point.setComponent(
            axis,
            point.getComponent(axis) + (Math.sign(point.getComponent(axis)) * size[axis]) / 2,
          );
        const normal = [
          Math.abs(normals.getX(i)),
          Math.abs(normals.getY(i)),
          Math.abs(normals.getZ(i)),
        ];
        const dominant = normal.indexOf(Math.max(...normal));
        const axes = [0, 1, 2].filter((axis) => axis !== dominant);
        if (originalSize[axes[0]] > originalSize[axes[1]]) axes.reverse();
        uv.setXY(i, point.getComponent(axes[0]) / 0.42, point.getComponent(axes[1]) / 0.42);
      }
      positions.setXYZ(i, point.x, point.y, point.z);
    }
    positions.needsUpdate = uv.needsUpdate = true;
    geometry.computeTangents();
    if (spec.kind !== 'gable')
      for (let axis = 0; axis < 3; axis++)
        mesh.position.setComponent(
          axis,
          mesh.position.getComponent(axis) +
            spec.moveWidth[axis] * widthDelta +
            spec.moveDepth[axis] * depthDelta,
        );
    else mesh.userData.ceilingGable = positions.getZ(0) < 0 ? 'north' : 'south';
    if (mesh.material.transparent) mesh.material = materials.glass;
    mesh.updateMatrix();
  });
  if (!geometries.size) return;
  batch(THREE, model, geometries);
  model.traverse((mesh) => {
    if (!mesh.isMesh) return;
    mesh.receiveShadow = !phoneSafe && !mesh.material.transparent;
    if (mesh.material.transparent) mesh.visible = !phoneSafe;
  });
  for (const mesh of [...model.children]) {
    const parent = gables.get(mesh.userData.ceilingGable);
    if (parent) parent.add(mesh);
  }
}

export function createCozyCeiling({ THREE, layout, materials, assembly, phoneSafe }) {
  const { rx, rz, top } = layout;
  const roof = assembly.group('Vaulted oak ceiling', [0, top, 0]);
  roof.visible = false;
  const gables = new Map(
    ['north', 'south'].map((end) => {
      const group = new THREE.Group();
      group.name = `${end} ceiling gable`;
      group.scale.setScalar(COZY_CEILING.scale);
      roof.add(group);
      return [end, group];
    }),
  );
  const fallback = new THREE.Group();
  fallback.name = 'Ceiling fallback';
  roof.add(fallback);
  const rise = rx * COZY_CEILING.risePerHalfWidth;
  const slope = Math.hypot(rx, rise);
  const angle = Math.atan2(rise, rx);
  const sky0 = slope * (0.68 / Math.hypot(3, 1.5));
  const sky1 = slope * (2.62 / Math.hypot(3, 1.5));
  const skyLength = rz * COZY_CEILING.skylightHalfLengthRatio;
  const addBox = (size, position, material, tilt = 0) => {
    const mesh = createPlasterPanel(THREE, size, position, material);
    mesh.rotation.z = tilt;
    fallback.add(mesh);
    return mesh;
  };
  addBox([1.68, 1.96, rz * 2], [0, rise - 0.7, 0], materials.oak);
  for (const side of [-1, 1]) {
    const part = (u0, u1, z0, z1, depth, material, offset = 0) => {
      const u = (u0 + u1) / 2;
      return addBox(
        [u1 - u0, depth, z1 - z0],
        [side * u * Math.cos(angle), rise - u * Math.sin(angle) + offset, (z0 + z1) / 2],
        material,
        -side * angle,
      );
    };
    for (const [u0, u1, z0, z1] of [
      [0, slope, -rz, -skyLength],
      [0, slope, skyLength, rz],
      [0, sky0, -skyLength, skyLength],
      [sky1, slope, -skyLength, skyLength],
    ])
      part(u0, u1, z0, z1, 0.84, materials.plaster, 0.42);
    for (const z of [-rz + 0.56, -skyLength - 1.12, skyLength + 1.12, rz - 0.56])
      part(0, slope, z - 0.525, z + 0.525, 1.61, materials.oak, -0.7);
    for (const u of [sky0, sky1])
      part(u - 0.56, u + 0.56, -skyLength, skyLength, 1.54, materials.oak);
    for (const z of [-skyLength, skyLength])
      part(sky0, sky1, z - 0.49, z + 0.49, 1.54, materials.oak);
  }
  const sources = new Set();
  fallback.traverse((mesh) => {
    if (mesh.geometry) sources.add(mesh.geometry);
  });
  batch(THREE, fallback, sources);
  fallback.traverse((mesh) => {
    if (mesh.isMesh) mesh.receiveShadow = !phoneSafe;
  });
  assembly.furnishing('ceiling', roof, fallback, 0, (model) =>
    fitCozyCeiling(THREE, model, layout, materials, phoneSafe, gables),
  );
  return {
    group: roof,
    // Both outward-facing slope planes enclose the space below the pitched roof.
    cutawayPlanes: [-1, 1].map((side) =>
      new THREE.Plane(
        new THREE.Vector3(side * COZY_CEILING.risePerHalfWidth, 1, 0),
        -(top + rise),
      ).normalize(),
    ),
    top: top + rise + 1,
    gables: [...gables].map(([end, group]) => ({ group, end })),
  };
}
