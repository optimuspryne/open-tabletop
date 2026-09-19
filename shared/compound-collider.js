import { boardGeometry, normalizeBoardOutline } from './board-geometry.js';
// Shapes use full dimensions and offsets relative to the model's longest side.
// This keeps uniform asset scaling independent of the authored collision layout.
export const COMPOUND_SHAPE_LIMIT = 16;
export const COMPOUND_TYPES = ['box', 'sphere', 'cylinder', 'cone', 'flat', 'outline'];
const tuple = (v, min, max) =>
  Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n) && n >= min && n <= max);
export function normalizeCompoundCollider(value) {
  if (
    !value ||
    value.version !== 1 ||
    !Array.isArray(value.shapes) ||
    value.shapes.length < 1 ||
    value.shapes.length > COMPOUND_SHAPE_LIMIT
  )
    return null;
  const shapes = [];
  for (const shape of value.shapes) {
    if (
      !shape ||
      !COMPOUND_TYPES.includes(shape.type) ||
      !tuple(shape.position, -2, 2) ||
      !tuple(shape.size, 0.001, 2) ||
      !tuple(shape.rotation, -Math.PI * 2, Math.PI * 2)
    )
      return null;
    const outline = shape.type === 'outline' ? normalizeBoardOutline(shape.outline) : null;
    if (shape.type === 'outline' && !outline) return null;
    const size = [...shape.size];
    if (shape.type === 'sphere' && (size[0] !== size[1] || size[0] !== size[2])) return null;
    if (['cylinder', 'cone'].includes(shape.type) && size[0] !== size[2]) return null;
    shapes.push({
      type: shape.type,
      ...(outline ? { outline } : {}),
      position: [...shape.position],
      size,
      rotation: [...shape.rotation],
    });
  }
  return { version: 1, shapes };
}

export function compoundColliderSpec(value, box) {
  const normalized = normalizeCompoundCollider(value);
  if (!normalized || !tuple(box, 0.001, 100)) return null;
  const unit = Math.max(...box) * 2;
  return {
    type: 'compound',
    shapes: normalized.shapes.map((shape) => {
      const [x, y, z] = shape.size.map((v) => v * unit);
      const transform = { offset: shape.position.map((v) => v * unit), rotation: shape.rotation };
      if (shape.type === 'outline')
        return {
          type: 'convex',
          ...boardGeometry({ w: x, d: z, thickness: y, outline: shape.outline }),
          ...transform,
        };
      if (shape.type === 'sphere') return { type: 'sphere', radius: x / 2, ...transform };
      if (shape.type === 'cylinder' || shape.type === 'cone')
        return {
          type: 'cylinder',
          radiusTop: shape.type === 'cone' ? x * 0.025 : x / 2,
          radiusBottom: x / 2,
          height: y,
          sides: 16,
          ...transform,
        };
      return { type: 'box', halfExtents: [x / 2, y / 2, z / 2], ...transform };
    }),
  };
}
