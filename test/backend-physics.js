import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as CANNON from 'cannon-es';
import {
  COLLIDER_TYPES,
  buildCollider,
  buildWorld,
  colliderShape,
  dieShape,
} from '../server/physics.js';

const colliderOptions = { cardColliderThickness: 0.04 };

test('physics world applies shared gravity, solver, contact, and sleep tuning', () => {
  const world = buildWorld({
    gravity: -20,
    solverIterations: 12,
    friction: 0.35,
    restitution: 0.2,
    contact: { stiffness: 1e7, relaxation: 3 },
  });
  assert.equal(world.gravity.y, -20);
  assert.equal(world.solver.iterations, 12);
  assert.equal(world.allowSleep, true);
  assert.ok(world.broadphase instanceof CANNON.SAPBroadphase);
  assert.ok(world.__mat instanceof CANNON.Material);
  assert.equal(world.contactmaterials.length, 1);
  assert.equal(world.contactmaterials[0].friction, 0.35);
  assert.equal(world.contactmaterials[0].restitution, 0.2);
});

test('primitive collider factory covers the public allowlist and box fallback', () => {
  assert.deepEqual(COLLIDER_TYPES, ['sphere', 'cylinder', 'cone', 'flat']);
  assert.equal(colliderShape('sphere', 1, 2, 1).radius, 2);
  const cylinder = colliderShape('cylinder', 1, 2, 1, { sides: 8 });
  assert.equal(cylinder.height, 4);
  assert.equal(cylinder.numSegments, 8);
  const cone = colliderShape('cone', 2, 3, 1);
  assert.equal(cone.radiusBottom, 2);
  assert.equal(cone.radiusTop, 0.1);
  const flat = colliderShape('flat', 2, 1, 3);
  assert.ok(flat.shape instanceof CANNON.Box);
  assert.equal(flat.shape.halfExtents.y, 0.06);
  assert.equal(flat.offset.y, -0.94);
  assert.ok(colliderShape('unknown', 1, 2, 3) instanceof CANNON.Box);
});

test('die colliders use a cube for d6 and convex hulls for polyhedra', () => {
  assert.ok(dieShape(6) instanceof CANNON.Box);
  assert.ok(dieShape(20) instanceof CANNON.ConvexPolyhedron);
  assert.ok(dieShape(999) instanceof CANNON.Box);
});

test('card colliders preserve footprint while enforcing stability thickness', () => {
  const rectangle = buildCollider(
    'card',
    {
      geom: { w: 2, h: 3, t: 0.01, round: 0, shape: 'rect' },
    },
    colliderOptions,
  );
  assert.ok(rectangle instanceof CANNON.Box);
  assert.deepEqual(
    [rectangle.halfExtents.x, rectangle.halfExtents.y, rectangle.halfExtents.z],
    [2, 0.04, 3],
  );
  const hexagon = buildCollider(
    'card',
    {
      geom: { w: 2, h: 2, t: 0.01, round: 0, shape: 'hex' },
    },
    colliderOptions,
  );
  assert.ok(hexagon instanceof CANNON.Cylinder);
  assert.equal(hexagon.numSegments, 6);
  assert.equal(hexagon.height, 0.08);
});

test('uploaded props clamp dimensions and retain requested primitive type', () => {
  const shape = buildCollider(
    'prop',
    {
      model: '/assets/props/model.glb',
      box: [10, 0, 2],
      collider: 'sphere',
    },
    colliderOptions,
  );
  assert.ok(shape instanceof CANNON.Sphere);
  assert.equal(shape.radius, 4);
});

test('procedural board colliders use half width and depth', () => {
  const shape = buildCollider('board', { w: 12, d: 8 }, colliderOptions);
  assert.ok(shape instanceof CANNON.Box);
  assert.deepEqual([shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z], [6, 0.05, 4]);
});
