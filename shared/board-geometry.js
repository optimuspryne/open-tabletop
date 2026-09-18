import { BOARDS } from './pieces.js';

export const BOARD_OUTLINES = ['rectangle', 'circle', 'hexagon', 'clipped', 'custom'];

// Normalized X/Z points, counterclockwise in the top-down editor. Reject concavity,
// crossings, duplicate edges and degenerate outlines rather than silently changing them.
function normalizeBaseOutline(value) {
  if (!value || !BOARD_OUTLINES.includes(value.type)) return null;
  if (value.type === 'clipped') {
    if (!Number.isFinite(value.cut) || value.cut <= 0 || value.cut >= 0.5) return null;
    return { type: value.type, cut: value.cut };
  }
  if (value.type !== 'custom') return { type: value.type };
  const points = value.points;
  if (!Array.isArray(points) || points.length < 3 || points.length > 32) return null;
  if (
    points.some(
      (p) =>
        !Array.isArray(p) ||
        p.length !== 2 ||
        p.some((v) => !Number.isFinite(v) || Math.abs(v) > 0.5),
    )
  )
    return null;
  const area = points.reduce((sum, a, i) => {
    const b = points[(i + 1) % points.length];
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0);
  if (Math.abs(area) < 0.001) return null;
  const ordered = points.map((p) => [...p]);
  if (area < 0) ordered.reverse();
  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i],
      b = ordered[(i + 1) % ordered.length];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.001) return null;
    for (let j = 0; j < ordered.length; j++) {
      if (j === i || j === (i + 1) % ordered.length) continue;
      const c = ordered[j];
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) <= 1e-7) return null;
    }
  }
  return { type: 'custom', points: ordered };
}

export function normalizeBoardOutline(value) {
  const spec = normalizeBaseOutline(value);
  if (!spec) return null;
  if (value.fit !== undefined) {
    const fit = value.fit;
    if (
      !fit ||
      !Array.isArray(fit.scale) ||
      fit.scale.length !== 2 ||
      fit.scale.some((v) => !Number.isFinite(v) || v < 0.01 || v > 2) ||
      !Number.isFinite(fit.rotation) ||
      Math.abs(fit.rotation) > Math.PI * 2
    )
      return null;
    spec.fit = { scale: [...fit.scale], rotation: fit.rotation };
  }
  return spec;
}

// Rotate in physical X/Z space, then return normalized coordinates for the overlay.
export function boardOutlinePoints(outline, aspect = 1) {
  const spec = normalizeBoardOutline(outline) || { type: 'rectangle' };
  const points = baseOutlinePoints(spec);
  if (!spec.fit) return points;
  const { scale, rotation } = spec.fit;
  const c = Math.cos(rotation),
    s = Math.sin(rotation);
  return points.map(([x, z]) => [
    x * scale[0] * c + (z * scale[1] * s) / aspect,
    -x * scale[0] * s * aspect + z * scale[1] * c,
  ]);
}

function baseOutlinePoints(outline) {
  const spec = normalizeBoardOutline(outline) || { type: 'rectangle' };
  if (spec.type === 'custom') return spec.points;
  if (spec.type === 'circle' || spec.type === 'hexagon') {
    const n = spec.type === 'circle' ? 32 : 6;
    return Array.from({ length: n }, (_, i) => [
      Math.cos((i * 2 * Math.PI) / n) / 2,
      Math.sin((i * 2 * Math.PI) / n) / 2,
    ]);
  }
  if (spec.type === 'clipped') {
    const c = spec.cut;
    return [
      [-0.5 + c, -0.5],
      [0.5 - c, -0.5],
      [0.5, -0.5 + c],
      [0.5, 0.5 - c],
      [0.5 - c, 0.5],
      [-0.5 + c, 0.5],
      [-0.5, 0.5 - c],
      [-0.5, -0.5 + c],
    ];
  }
  return [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ];
}

export function boardHalfExtents(props = {}) {
  const builtin = BOARDS[props.board];
  if (builtin) return [...builtin.box];
  if (props.model && Array.isArray(props.box))
    return props.box.map((v) => Math.max(0.001, Math.min(100, +v || 0.05)));
  return [(props.w || 8) / 2, (props.thickness || 0.1) / 2, (props.d || 8) / 2];
}

export function boardGeometry(props = {}) {
  const [hx, hy, hz] = boardHalfExtents(props);
  const points = boardOutlinePoints(props.outline, hx / hz);
  const n = points.length;
  const vertices = [-hy, hy].flatMap((y) => points.map(([x, z]) => [x * 2 * hx, y, z * 2 * hz]));
  const faces = [
    Array.from({ length: n }, (_, i) => i),
    Array.from({ length: n }, (_, i) => 2 * n - 1 - i),
  ];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push([i, i + n, j + n, j]);
  }
  return { vertices, faces };
}
