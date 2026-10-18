import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import { TABLE_SHAPES, tableOutline, offsetOutline } from '../shared/pieces.js';
import {
  createTableGeometry,
  createRimGeometry,
  TABLE_FINISH,
} from '../public/rendering/table-geometry.js';

test('felt caps retain shared outlines, physical UV density and top height across shapes and sizes', () => {
  for (const shape of TABLE_SHAPES)
    for (const [x, z] of [
      [2, 2],
      [10, 7],
      [30, 20],
    ]) {
      const geometry = createTableGeometry(THREE, x, z, shape);
      geometry.computeBoundingBox();
      assert.equal(geometry.boundingBox.max.y, 0.5);
      assert.equal(geometry.boundingBox.min.y, -0.5);
      const positions = geometry.attributes.position,
        normals = geometry.attributes.normal,
        uv = geometry.attributes.uv;
      const points = tableOutline(shape, x, z);
      for (const point of points) {
        let found = false;
        for (let i = 0; i < positions.count; i++)
          if (
            Math.abs(positions.getX(i) - point.x) < 1e-5 &&
            Math.abs(positions.getZ(i) - point.z) < 1e-5 &&
            positions.getY(i) === 0.5
          )
            found = true;
        assert.ok(found, 'Visible felt boundary disagrees with the shared wall/grid outline');
      }
      for (let i = 0; i < positions.count; i++)
        if (Math.abs(normals.getY(i)) > 0.5) {
          assert.equal(uv.getX(i), positions.getX(i));
          assert.equal(uv.getY(i), positions.getZ(i));
        }
      geometry.dispose();
    }
});

test('bevelled rails are closed, finite and bounded with UV distance following the perimeter', () => {
  for (const shape of TABLE_SHAPES)
    for (const [x, z] of [
      [2, 2],
      [10, 7],
      [30, 20],
    ]) {
      const geometry = createRimGeometry(THREE, x, z, shape),
        p = geometry.attributes.position,
        uv = geometry.attributes.uv,
        normals = geometry.attributes.normal;
      const points = tableOutline(shape, x, z),
        outer = offsetOutline(points, TABLE_FINISH.rimWidth);
      assert.ok(geometry.index.count / 3 < 1500);
      assert.ok([...p.array, ...uv.array, ...normals.array].every(Number.isFinite));
      geometry.computeBoundingBox();
      assert.ok(Math.abs(geometry.boundingBox.max.y - TABLE_FINISH.rimLip) < 1e-6);
      assert.equal(geometry.boundingBox.min.y, TABLE_FINISH.rimBase);
      assert.ok(Math.abs(geometry.boundingBox.max.x - Math.max(...outer.map((v) => v.x))) < 1e-5);
      const edges = new Map();
      const key = (i) => [p.getX(i), p.getY(i), p.getZ(i)].map((v) => v.toFixed(5)).join(',');
      for (let i = 0; i < geometry.index.count; i += 3) {
        const ids = [0, 1, 2].map((j) => geometry.index.getX(i + j));
        const a = new THREE.Vector3().fromBufferAttribute(p, ids[0]),
          b = new THREE.Vector3().fromBufferAttribute(p, ids[1]),
          c = new THREE.Vector3().fromBufferAttribute(p, ids[2]);
        const face = b.sub(a).cross(c.sub(a));
        const normal = new THREE.Vector3().fromBufferAttribute(normals, ids[0]);
        assert.ok(
          face.dot(normal) > 0,
          'Rail faces must point outward, including bevels and underside',
        );
        for (let j = 0; j < 3; j++) {
          const pair = [key(ids[j]), key(ids[(j + 1) % 3])].sort().join('|');
          edges.set(pair, (edges.get(pair) || 0) + 1);
        }
      }
      assert.ok(
        [...edges.values()].every((count) => count === 2),
        'Rail must have no cracks/open seams',
      );
      const profilePoints = p.count / (points.length * 4);
      for (let i = 0; i < points.length; i++) {
        const next = points[(i + 1) % points.length];
        const index = i * profilePoints * 4;
        const v = uv.getY(index + 1) - uv.getY(index);
        assert.ok(
          Math.abs(
            v * TABLE_FINISH.grainLength - Math.hypot(next.x - points[i].x, next.z - points[i].z),
          ) < 1e-4,
        );
      }
      geometry.dispose();
    }
});
