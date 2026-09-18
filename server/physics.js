import { compoundColliderSpec } from '../shared/compound-collider.js';
import { boardGeometry, boardHalfExtents } from '../shared/board-geometry.js';
import * as CANNON from 'cannon-es';
import convexHull from 'convex-hull';
import {
  KINDS,
  PROPS,
  cardGeom,
  dieR,
  dieVerts,
  stackVisible,
  dispenserDefinition,
} from '../shared/pieces.js';

export const COLLIDER_TYPES = ['sphere', 'cylinder', 'cone', 'flat'];

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

export function colliderShape(type, hx, hy, hz, options = {}) {
  if (type === 'sphere') return new CANNON.Sphere(Math.max(hx, hy, hz));
  if (type === 'cylinder' || type === 'cone') {
    const radius = Math.max(hx, hz);
    const sides = Math.max(3, options.sides | 0 || 16);
    const top =
      type === 'cone' ? radius * 0.05 : options.top != null ? radius * options.top : radius;
    return new CANNON.Cylinder(top, radius, hy * 2, sides);
  }
  if (type === 'flat') {
    const thickness = 0.06;
    return {
      shape: new CANNON.Box(new CANNON.Vec3(hx, thickness, hz)),
      offset: new CANNON.Vec3(0, -(hy - thickness), 0),
    };
  }
  return new CANNON.Box(new CANNON.Vec3(hx, hy, hz));
}

export function buildCollider(type, props, { cardColliderThickness }) {
  const shape = KINDS[type].shape;
  if ((type === 'prop' || type === 'board') && props.model && props.compoundCollider) {
    const spec = compoundColliderSpec(props.compoundCollider, props.box);
    if (spec)
      return {
        shapes: spec.shapes.map((part) => ({
          shape:
            part.type === 'sphere'
              ? new CANNON.Sphere(part.radius)
              : part.type === 'cylinder'
                ? new CANNON.Cylinder(part.radiusTop, part.radiusBottom, part.height, part.sides)
                : new CANNON.Box(new CANNON.Vec3(...part.halfExtents)),
          offset: new CANNON.Vec3(...part.offset),
          orientation: new CANNON.Quaternion().setFromEuler(...part.rotation, 'XYZ'),
        })),
      };
  }
  if (shape === 'die') return dieShape(props.sides || 6);

  if (shape === 'prop') {
    if (props.model && Array.isArray(props.box)) {
      const [hx, hy, hz] = props.box.map((value) => clamp(+value || 0.5, 0.05, 4));
      return colliderShape(props.collider, hx, hy, hz);
    }
    const spec = (PROPS[props.shape] || PROPS.box).collider;
    const scale = clamp(+props.scale || 1, 0.3, 3);
    const [hx, hy, hz] = spec.box.map((value) => value * scale);
    return colliderShape(spec.type, hx, hy, hz, { sides: spec.sides, top: spec.top });
  }

  if (type === 'board') {
    if (
      props.outline &&
      (props.outline.type !== 'rectangle' || props.outline.fit) &&
      !props.board
    ) {
      const { vertices, faces } = boardGeometry(props);
      return new CANNON.ConvexPolyhedron({
        vertices: vertices.map((v) => new CANNON.Vec3(...v)),
        faces,
      });
    }
    return new CANNON.Box(new CANNON.Vec3(...boardHalfExtents(props)));
  }

  if (shape === 'dispenser') {
    const dispenser = dispenserDefinition(props);
    if (!dispenser) return new CANNON.Box(new CANNON.Vec3(0.4, 0.2, 0.4));
    if (props.asset) {
      if (dispenser.appearance === 'automatic') {
        const [hx, hy, hz] = props.asset.item.box || [0.4, 0.2, 0.4];
        const visible = stackVisible(
          dispenser.infinite ? 8 : (props.count ?? dispenser.defaultCount ?? 1),
        );
        return new CANNON.Box(new CANNON.Vec3(hx, Math.max(hy, visible * hy), hz));
      }
      if (dispenser.appearance === 'custom' && Array.isArray(dispenser.box)) {
        const [hx, hy, hz] = dispenser.box;
        return colliderShape(dispenser.collider, hx, hy, hz);
      }
      const [hx, , hz] = props.asset.item.box || [0.6, 0.4, 0.6];
      return new CANNON.Cylinder(Math.max(hx, hz, 0.55), Math.max(hx, hz, 0.55), 0.7, 20);
    }
    if (dispenser.body === 'stack') {
      const box = PROPS[dispenser.item].collider.box;
      const radius = box[0];
      const discHeight = box[1] * 2;
      const visible = stackVisible(props.count ?? dispenser.count.def);
      return new CANNON.Cylinder(radius, radius, Math.max(discHeight, visible * discHeight), 16);
    }
    const [hx, hy, hz] = dispenser.collider.box;
    return colliderShape(dispenser.collider.type, hx, hy, hz, {
      sides: dispenser.collider.sides,
      top: dispenser.collider.top,
    });
  }

  if (type === 'card' || type === 'mat') {
    // A mat is a big single-faced tile: same solid box, sized from its `geom` — its real top face is
    // the surface pieces rest on. (A mat's own thickness already exceeds cardColliderThickness.)
    const geometry = cardGeom(props);
    const halfThickness = Math.max(geometry.th, cardColliderThickness);
    return geometry.shape === 'hex'
      ? new CANNON.Cylinder(geometry.hh, geometry.hh, halfThickness * 2, 6)
      : new CANNON.Box(new CANNON.Vec3(geometry.hw, halfThickness, geometry.hh));
  }

  return new CANNON.Box(new CANNON.Vec3(...shape.box));
}

export function dieShape(sides) {
  const cube = () => new CANNON.Box(new CANNON.Vec3(dieR(6), dieR(6), dieR(6)));
  if (sides === 6) return cube();
  const vertices = dieVerts(sides);
  if (!vertices) return cube();
  try {
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
    const faces = faceGroups.map((group) => {
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
    return new CANNON.ConvexPolyhedron({
      vertices: vertices.map((vertex) => new CANNON.Vec3(...vertex)),
      faces,
    });
  } catch {
    return cube();
  }
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
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
