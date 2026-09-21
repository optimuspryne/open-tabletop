import { boardHalfExtents } from '../shared/board-geometry.js';
import { COLLIDER_TYPES, colliderSpec, primitiveColliderSpec } from '../shared/collider-spec.js';
import * as CANNON from 'cannon-es';
import convexHull from 'convex-hull';

export { COLLIDER_TYPES };

export function buildWorld(simulation) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, simulation.gravity, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  world.solver.iterations = simulation.solverIterations;
  const material = new CANNON.Material('surface');
  world.addContactMaterial(
    new CANNON.ContactMaterial(material, material, {
      friction: simulation.friction,
      restitution: simulation.restitution,
      contactEquationStiffness: simulation.contact.stiffness,
      contactEquationRelaxation: simulation.contact.relaxation,
    }),
  );
  world.__mat = material;
  return world;
}

function convexFaces(vertices) {
  const faceGroups = [];
  for (const [a, b, c] of convexHull(vertices)) {
    const normal = normalize(
      cross(subtract(vertices[b], vertices[a]), subtract(vertices[c], vertices[a])),
    );
    let group = faceGroups.find((candidate) => dot(candidate.normal, normal) > 0.999);
    if (!group) {
      group = { normal, indices: new Set() };
      faceGroups.push(group);
    }
    group.indices.add(a);
    group.indices.add(b);
    group.indices.add(c);
  }
  return faceGroups.map((group) => {
    const indices = [...group.indices];
    const centroid = averagePoint(indices.map((index) => vertices[index]));
    const reference = normalize(subtract(vertices[indices[0]], centroid));
    const perpendicular = cross(group.normal, reference);
    const angleOf = (index) =>
      Math.atan2(
        dot(subtract(vertices[index], centroid), perpendicular),
        dot(subtract(vertices[index], centroid), reference),
      );
    indices.sort((left, right) => angleOf(left) - angleOf(right));
    const woundNormal = cross(
      subtract(vertices[indices[1]], vertices[indices[0]]),
      subtract(vertices[indices[2]], vertices[indices[0]]),
    );
    if (dot(woundNormal, group.normal) < 0) indices.reverse();
    return indices;
  });
}

const subtract = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (vector) => {
  const length = Math.hypot(...vector) || 1;
  return vector.map((component) => component / length);
};
const averagePoint = (points) => {
  const sum = points.reduce(
    (total, point) => total.map((component, index) => component + point[index]),
    [0, 0, 0],
  );
  return sum.map((component) => component / points.length);
};

function cannonShapeFromSpec(spec) {
  if (spec.type === 'box') return new CANNON.Box(new CANNON.Vec3(...spec.halfExtents));
  if (spec.type === 'sphere') return new CANNON.Sphere(spec.radius);
  if (spec.type === 'cylinder')
    return new CANNON.Cylinder(spec.radiusTop, spec.radiusBottom, spec.height, spec.sides);
  if (spec.type === 'convex')
    return new CANNON.ConvexPolyhedron({
      vertices: spec.vertices.map((vertex) => new CANNON.Vec3(...vertex)),
      faces: spec.faces || convexFaces(spec.vertices),
    });
  throw new TypeError(`Unsupported collider spec: ${spec.type}`);
}

const cannonPartFromSpec = (spec) => ({
  shape: cannonShapeFromSpec(spec),
  ...(spec.offset ? { offset: new CANNON.Vec3(...spec.offset) } : {}),
  ...(spec.rotation
    ? { orientation: new CANNON.Quaternion().setFromEuler(...spec.rotation, 'XYZ') }
    : {}),
});

// Convert a renderer-neutral shared collider spec into the shape/compound contract consumed by
// attachCollider. Keeping this adapter here isolates Cannon objects from shared browser code.
export function colliderFromSpec(spec) {
  if (!spec) throw new TypeError('Missing collider spec');
  if (spec.type === 'compound') return { shapes: spec.shapes.map(cannonPartFromSpec) };
  const part = cannonPartFromSpec(spec);
  return part.offset || part.orientation ? part : part.shape;
}

export function colliderShape(type, hx, hy, hz, options = {}) {
  return colliderFromSpec(primitiveColliderSpec(type, hx, hy, hz, options));
}

export function dieShape(sides) {
  try {
    return colliderFromSpec(colliderSpec('die', { sides }));
  } catch {
    return colliderFromSpec(colliderSpec('die', { sides: 6 }));
  }
}

export function buildCollider(type, props, options = {}) {
  if (type === 'die') return dieShape(props.sides || 6);
  return colliderFromSpec(colliderSpec(type, props, options));
}

// Attach every component to one rigid body, preserving local offsets and rotations.
export function attachCollider(body, collider) {
  if (collider.shapes) {
    for (const part of collider.shapes) body.addShape(part.shape, part.offset, part.orientation);
  } else if (collider.shape) body.addShape(collider.shape, collider.offset, collider.orientation);
  else body.addShape(collider);
}

// Keep both the visual model and any authored shapes above the table at spawn.
export function boardSpawnHeight(props) {
  const visualHeight = boardHalfExtents(props)[1];
  if (!props.compoundCollider) return visualHeight;
  const collider = buildCollider('board', props, { cardColliderThickness: 0.04 });
  let height = visualHeight;
  for (const part of collider.shapes || []) {
    const min = new CANNON.Vec3(),
      max = new CANNON.Vec3();
    part.shape.calculateWorldAABB(part.offset, part.orientation, min, max);
    height = Math.max(height, -min.y);
  }
  return height;
}
