import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as CANNON from 'cannon-es';
import { normalizeColliderOutline, decomposeOutline } from '../shared/collider-outline.js';
import { normalizeBoardOutline } from '../shared/board-geometry.js';
import { compoundColliderSpec, normalizeCompoundCollider } from '../shared/compound-collider.js';
import { buildCollider, attachCollider } from '../server/physics.js';
import { normalizePreset } from '../server/http/routes/collider-presets.js';

const points = [
  [-0.5, 0.5],
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [0.25, 0.5],
  [0.25, -0.25],
  [-0.25, -0.25],
  [-0.25, 0.5],
];
const outline = { type: 'custom', points };
const shape = {
  type: 'outline',
  outline,
  position: [0, 0, 0],
  size: [1, 0.1, 1],
  rotation: [0, 0, 0],
};
const layout = { version: 1, shapes: [shape] };
const area = (p) =>
  Math.abs(
    p.reduce(
      (a, v, i) => a + v[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * v[1],
      0,
    ) / 2,
  );

test('concave loops decompose into convex sections without filling the opening', () => {
  assert.ok(normalizeColliderOutline(outline));
  assert.equal(
    normalizeBoardOutline(outline),
    null,
    'Ordinary board outlines keep the convex contract',
  );
  const parts = decomposeOutline(outline);
  assert.equal(parts.length, 3, 'U shape should merge into three convex sections');
  assert.ok(Math.abs(parts.reduce((sum, p) => sum + area(p.points), 0) - area(points)) < 1e-9);
  for (const part of parts) assert.ok(normalizeBoardOutline(part));
  assert.deepEqual(decomposeOutline({ ...outline, points: [...points].reverse() }), parts);
  assert.deepEqual(normalizeCompoundCollider(layout), layout);
  assert.deepEqual(
    normalizePreset({ name: 'Arch', isPublic: false, size: 1, layout }).layout,
    layout,
  );
});
test('crossings, touches, backtracking, degenerate, and oversized outlines fail closed', () => {
  for (const p of [
    [
      [-0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
      [0.5, -0.5],
    ],
    [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ],
    [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0, 0],
      [0.5, 0.5],
      [-0.5, 0.5],
      [0, 0],
    ],
    [
      [0, 0],
      [0.5, 0],
      [0.25, 0],
    ],
    [
      [0, 0],
      [Infinity, 0],
      [0, 0.5],
    ],
    Array(33).fill([0, 0]),
  ])
    assert.equal(normalizeColliderOutline({ type: 'custom', points: p }), null);
  const straight = {
    type: 'custom',
    points: [
      [-0.5, -0.5],
      [0, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ],
  };
  assert.equal(decomposeOutline(straight).length, 1);
  assert.equal(normalizeColliderOutline(straight).points.length, 4);
});
test('generated sections consume the total 16-part budget', () => {
  const box = { type: 'box', position: [0, 0, 0], size: [0.1, 0.1, 0.1], rotation: [0, 0, 0] };
  assert.equal(
    compoundColliderSpec({ version: 1, shapes: [shape, ...Array(13).fill(box)] }, [0.5, 0.5, 0.5])
      .shapes.length,
    16,
  );
  assert.equal(
    normalizeCompoundCollider({ version: 1, shapes: [shape, ...Array(14).fill(box)] }),
    null,
  );
});
test('decomposed Cannon prisms support pieces on the arms and leave the recess empty', () => {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -10, 0) });
  const body = new CANNON.Body({ mass: 0 });
  const spec = compoundColliderSpec(layout, [0.5, 0.5, 0.5]);
  assert.equal(spec.shapes.length, 3);
  assert.ok(spec.shapes.every((s) => s.sourceIndex === 0));
  attachCollider(
    body,
    buildCollider(
      'board',
      { model: '/arch.glb', box: [0.5, 0.5, 0.5], compoundCollider: layout },
      { cardColliderThickness: 0.04 },
    ),
  );
  world.addBody(body);
  const drop = (x) => {
    const b = new CANNON.Body({
      mass: 1,
      shape: new CANNON.Box(new CANNON.Vec3(0.03, 0.03, 0.03)),
      position: new CANNON.Vec3(x, 1, 0.2),
    });
    world.addBody(b);
    return b;
  };
  const arm = drop(0.375),
    gap = drop(0);
  for (let i = 0; i < 180; i++) world.step(1 / 60);
  assert.ok(Math.abs(arm.position.y - 0.08) < 0.02);
  assert.ok(gap.position.y < -5);
  for (const hull of body.shapes)
    for (let i = 0; i < hull.faces.length; i++) {
      const center = hull.faces[i]
        .reduce((v, j) => v.vadd(hull.vertices[j]), new CANNON.Vec3())
        .scale(1 / hull.faces[i].length);
      assert.ok(center.dot(hull.faceNormals[i]) > 0);
    }
});
test('decomposition preserves rotated, offset and fitted outline geometry', () => {
  const child = {
    ...shape,
    position: [0.2, 0.3, -0.1],
    rotation: [0.4, -0.2, 0.7],
    outline: { ...outline, fit: { scale: [0.8, 0.7], rotation: 0.3 } },
  };
  const spec = compoundColliderSpec({ version: 1, shapes: [child] }, [1, 1, 1]);
  const rotation = new CANNON.Quaternion().setFromEuler(...child.rotation, 'XYZ');
  const expected = points.flatMap(([x, z]) =>
    [-0.1, 0.1].map((y) => {
      const a = x * 1.6,
        b = z * 1.4;
      return rotation
        .vmult(
          new CANNON.Vec3(
            a * Math.cos(0.3) + b * Math.sin(0.3),
            y,
            -a * Math.sin(0.3) + b * Math.cos(0.3),
          ),
        )
        .vadd(new CANNON.Vec3(0.4, 0.6, -0.2));
    }),
  );
  for (const p of spec.shapes)
    for (const vertex of p.vertices) {
      const actual = rotation.vmult(new CANNON.Vec3(...vertex)).vadd(new CANNON.Vec3(...p.offset));
      assert.ok(expected.some((v) => v.distanceTo(actual) < 1e-8));
    }
});
