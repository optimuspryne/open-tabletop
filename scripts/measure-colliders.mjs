#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BOARD_SIZE, BOARDS, DECK_MODELS, DISPENSERS, PROPS } from '../shared/pieces.js';

const ROOT = resolve(import.meta.dirname, '..');
const MODEL_SIZE = 1.6; // public/core.js CONFIG.model.size; modeled dispensers normalize to this
const JSON_CHUNK = 0x4e4f534a;
const GLB_MAGIC = 0x46546c67;

const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// Column-major 4×4 multiplication, matching glTF and Three.js matrices.
const multiply = (a, b) => {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++)
      for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
  return out;
};

const transformPoint = (m, [x, y, z]) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

const quaternionMatrix = ([x, y, z, w]) => {
  const x2 = x + x,
    y2 = y + y,
    z2 = z + z;
  const xx = x * x2,
    xy = x * y2,
    xz = x * z2;
  const yy = y * y2,
    yz = y * z2,
    zz = z * z2;
  const wx = w * x2,
    wy = w * y2,
    wz = w * z2;
  return [
    1 - (yy + zz),
    xy + wz,
    xz - wy,
    0,
    xy - wz,
    1 - (xx + zz),
    yz + wx,
    0,
    xz + wy,
    yz - wx,
    1 - (xx + yy),
    0,
    0,
    0,
    0,
    1,
  ];
};

const nodeMatrix = (node) => {
  if (node.matrix) return [...node.matrix];
  const matrix = quaternionMatrix(node.rotation || [0, 0, 0, 1]);
  const scale = node.scale || [1, 1, 1];
  for (let col = 0; col < 3; col++)
    for (let row = 0; row < 3; row++) matrix[col * 4 + row] *= scale[col];
  const translation = node.translation || [0, 0, 0];
  matrix[12] = translation[0];
  matrix[13] = translation[1];
  matrix[14] = translation[2];
  return matrix;
};

const eulerMatrix = ([x = 0, y = 0, z = 0] = []) => {
  const cx = Math.cos(x / 2),
    sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2),
    sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2),
    sz = Math.sin(z / 2);
  return quaternionMatrix([
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ]);
};

const corners = (min, max) => {
  const out = [];
  for (const x of [min[0], max[0]])
    for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) out.push([x, y, z]);
  return out;
};

const includePoint = (bounds, point) => {
  for (let axis = 0; axis < 3; axis++) {
    bounds.min[axis] = Math.min(bounds.min[axis], point[axis]);
    bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
  }
};

export async function measureGlbFile(file, rootRotation) {
  const data = await readFile(file);
  if (data.length < 20 || data.readUInt32LE(0) !== GLB_MAGIC) throw new Error('not a GLB file');
  if (data.readUInt32LE(4) !== 2) throw new Error('only GLB version 2 is supported');
  let json;
  for (let offset = 12; offset + 8 <= data.length;) {
    const length = data.readUInt32LE(offset);
    const type = data.readUInt32LE(offset + 4);
    if (type === JSON_CHUNK)
      json = JSON.parse(
        data
          .subarray(offset + 8, offset + 8 + length)
          .toString('utf8')
          .trim(),
      );
    offset += 8 + length;
  }
  if (!json) throw new Error('missing GLB JSON chunk');

  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const childNodes = new Set((json.nodes || []).flatMap((node) => node.children || []));
  const scene = json.scenes?.[json.scene ?? 0];
  const roots =
    scene?.nodes || (json.nodes || []).map((_, i) => i).filter((i) => !childNodes.has(i));
  const visit = (index, parent) => {
    const node = json.nodes?.[index];
    if (!node) return;
    const world = multiply(parent, nodeMatrix(node));
    const mesh = json.meshes?.[node.mesh];
    for (const primitive of mesh?.primitives || []) {
      const accessor = json.accessors?.[primitive.attributes?.POSITION];
      if (!accessor?.min || !accessor?.max)
        throw new Error(`POSITION accessor ${primitive.attributes?.POSITION} has no min/max`);
      for (const point of corners(accessor.min, accessor.max))
        includePoint(bounds, transformPoint(world, point));
    }
    for (const child of node.children || []) visit(child, world);
  };
  const rootMatrix = rootRotation ? eulerMatrix(rootRotation) : identity();
  for (const root of roots) visit(root, rootMatrix);
  if (!Number.isFinite(bounds.min[0])) throw new Error('GLB has no measurable mesh positions');
  return bounds;
}

const sizeOf = ({ min, max }) => max.map((value, axis) => value - min[axis]);
const rounded = (values) => values.map((value) => +value.toFixed(4));
const halfExtents = (bounds, scale) => rounded(sizeOf(bounds).map((value) => (value * scale) / 2));

const registrations = () => [
  ...Object.entries(BOARDS)
    .filter(([, spec]) => spec.model)
    .map(([key, spec]) => ({ family: 'board', key, spec, box: spec.box, mode: 'board' })),
  ...Object.entries(PROPS)
    .filter(([, spec]) => spec.model)
    .map(([key, spec]) => ({
      family: 'prop',
      key,
      spec,
      box: spec.collider?.box,
      mode: 'scale',
    })),
  ...Object.entries(DECK_MODELS)
    .filter(([, spec]) => spec.model)
    .map(([key, spec]) => ({ family: 'deck', key, spec, box: spec.box, mode: 'scale' })),
  ...Object.entries(DISPENSERS)
    .filter(([, spec]) => spec.model && spec.collider?.box)
    .map(([key, spec]) => ({
      family: 'dispenser',
      key,
      spec,
      box: spec.collider.box,
      mode: 'normalized',
    })),
];

export async function measureRegisteredColliders() {
  const rows = [];
  for (const registration of registrations()) {
    const { family, key, spec, box, mode } = registration;
    const file = resolve(ROOT, 'public', spec.model.replace(/^\//, ''));
    const rawBounds = await measureGlbFile(file, spec.modelRot);
    const rawSize = sizeOf(rawBounds);
    const configuredModelScale = spec.modelScale || 1;
    let effectiveScale = configuredModelScale;
    let suggestedScale = configuredModelScale;
    if (mode === 'normalized')
      effectiveScale = (MODEL_SIZE * configuredModelScale) / (Math.max(...rawSize) || 1);
    if (mode === 'board') suggestedScale = BOARD_SIZE / (Math.max(rawSize[0], rawSize[2]) || 1);
    const measured = halfExtents(rawBounds, effectiveScale);
    const suggestedBox = mode === 'board' ? halfExtents(rawBounds, suggestedScale) : measured;
    const delta = box ? rounded(measured.map((value, axis) => value - box[axis])) : null;
    rows.push({
      family,
      key,
      model: spec.model,
      configuredModelScale,
      effectiveScale: +effectiveScale.toFixed(6),
      configuredBox: box ? rounded(box) : null,
      measuredBox: measured,
      delta,
      suggestedModelScale: +suggestedScale.toFixed(6),
      suggestedBox,
    });
  }
  return rows;
}

const run = async () => {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const check = args.includes('--check');
  const toleranceArg = args.find((arg) => arg.startsWith('--tolerance='));
  const tolerance = toleranceArg ? +toleranceArg.split('=')[1] : 0.03;
  const filter = args.find((arg) => !arg.startsWith('--'))?.toLowerCase();
  let rows = await measureRegisteredColliders();
  if (filter)
    rows = rows.filter((row) =>
      `${row.family}:${row.key} ${row.model}`.toLowerCase().includes(filter),
    );
  if (!rows.length)
    throw new Error(filter ? `no registered models match "${filter}"` : 'no models');

  if (json) console.log(JSON.stringify(rows, null, 2));
  else {
    for (const row of rows) {
      console.log(
        `${row.family}:${row.key}`,
        `configured box=${JSON.stringify(row.configuredBox)} scale=${row.configuredModelScale}`,
      );
      console.log(
        `  measured box=${JSON.stringify(row.measuredBox)}; suggested box=${JSON.stringify(row.suggestedBox)} scale=${row.suggestedModelScale}`,
      );
    }
    console.log(
      '\nUse --json for copyable values; --check to fail when any axis differs from the registry.',
    );
  }

  if (check) {
    const mismatches = rows.filter(
      (row) => !row.configuredBox || row.delta.some((value) => Math.abs(value) > tolerance),
    );
    if (mismatches.length) {
      console.error(
        `\n${mismatches.length} collider${mismatches.length === 1 ? '' : 's'} differ by more than ${tolerance}: ${mismatches.map((row) => `${row.family}:${row.key}`).join(', ')}`,
      );
      process.exitCode = 1;
    }
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  run().catch((error) => {
    console.error(`measure-colliders: ${error.message}`);
    process.exitCode = 1;
  });
