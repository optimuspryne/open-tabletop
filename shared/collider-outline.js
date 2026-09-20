import { normalizeBoardOutline } from './board-geometry.js';

const EPS = 1e-9;
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const area = (p) =>
  p.reduce((sum, a, i) => {
    const b = p[(i + 1) % p.length];
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0) / 2;
const onSegment = (a, b, p) =>
  Math.abs(cross(a, b, p)) <= EPS &&
  p[0] >= Math.min(a[0], b[0]) - EPS &&
  p[0] <= Math.max(a[0], b[0]) + EPS &&
  p[1] >= Math.min(a[1], b[1]) - EPS &&
  p[1] <= Math.max(a[1], b[1]) + EPS;
function intersects(a, b, c, d) {
  return (
    (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) ||
    onSegment(a, b, c) ||
    onSegment(a, b, d) ||
    onSegment(c, d, a) ||
    onSegment(c, d, b)
  );
}
function simplify(points) {
  const result = points.map((p) => [...p]);
  let changed = true;
  while (changed && result.length > 3) {
    changed = false;
    for (let i = 0; i < result.length; i++) {
      if (
        onSegment(
          result[(i + result.length - 1) % result.length],
          result[(i + 1) % result.length],
          result[i],
        )
      ) {
        result.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return result;
}

// Concave custom outlines are supported only inside compound colliders. Board outlines
// keep their existing convex contract. One simple loop; no crossings or enclosed holes.
export function normalizeColliderOutline(value) {
  if (value?.type !== 'custom') return normalizeBoardOutline(value);
  const p = value.points;
  if (
    !Array.isArray(p) ||
    p.length < 3 ||
    p.length > 32 ||
    p.some(
      (v) =>
        !Array.isArray(v) ||
        v.length !== 2 ||
        v.some((n) => !Number.isFinite(n) || Math.abs(n) > 0.5),
    )
  )
    return null;
  for (let i = 0; i < p.length; i++) {
    const next = (i + 1) % p.length;
    if (Math.hypot(p[i][0] - p[next][0], p[i][1] - p[next][1]) < 0.001) return null;
    // Reject doubled-back adjacent edges as well as non-adjacent touches/crossings.
    const previous = p[(i + p.length - 1) % p.length];
    if (onSegment(previous, p[i], p[next]) || onSegment(p[i], p[next], previous)) return null;
    for (let j = i + 1; j < p.length; j++) {
      const after = (j + 1) % p.length;
      if (j === next || after === i) continue;
      if (intersects(p[i], p[next], p[j], p[after])) return null;
    }
  }
  if (Math.abs(area(p)) < 0.001) return null;
  const points = simplify(area(p) < 0 ? [...p].reverse() : p);
  const fit = normalizeBoardOutline({
    type: 'rectangle',
    ...(value.fit !== undefined ? { fit: value.fit } : {}),
  });
  if (!fit) return null;
  return { type: 'custom', points, ...(fit.fit ? { fit: fit.fit } : {}) };
}

// Deterministic ear clipping followed by greedy convex merging, bounded to 32 vertices.
export function decomposeOutline(outline) {
  const normalized = normalizeColliderOutline(outline);
  if (!normalized) return null;
  if (normalized.type !== 'custom') return [normalized];
  const points = normalized.points;
  const convex = (ids) =>
    ids.every(
      (id, i) =>
        cross(points[id], points[ids[(i + 1) % ids.length]], points[ids[(i + 2) % ids.length]]) >=
        -EPS,
    );
  const remaining = points.map((_, i) => i),
    pieces = [];
  if (convex(remaining)) return [normalized];
  while (remaining.length > 3) {
    let found = false;
    for (let i = 0; i < remaining.length; i++) {
      const a = remaining[(i + remaining.length - 1) % remaining.length],
        b = remaining[i],
        c = remaining[(i + 1) % remaining.length];
      if (cross(points[a], points[b], points[c]) <= EPS) continue;
      if (
        remaining.some(
          (j) =>
            j !== a &&
            j !== b &&
            j !== c &&
            cross(points[a], points[b], points[j]) >= -EPS &&
            cross(points[b], points[c], points[j]) >= -EPS &&
            cross(points[c], points[a], points[j]) >= -EPS,
        )
      )
        continue;
      pieces.push([a, b, c]);
      remaining.splice(i, 1);
      found = true;
      break;
    }
    if (!found) return null;
  }
  pieces.push(remaining);
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < pieces.length; i++)
      for (let j = i + 1; j < pieces.length; j++) {
        const edges = [pieces[i], pieces[j]].flatMap((ids) =>
          ids.map((id, k) => [id, ids[(k + 1) % ids.length]]),
        );
        const boundary = edges.filter(([a, b]) => !edges.some(([c, d]) => a === d && b === c));
        if (boundary.length !== edges.length - 2) continue;
        const ids = [boundary[0][0]];
        while (ids.length < boundary.length) {
          const next = boundary.find(([a]) => a === ids.at(-1))?.[1];
          if (next === undefined || ids.includes(next)) break;
          ids.push(next);
        }
        if (ids.length !== boundary.length || !convex(ids)) continue;
        pieces[i] = ids;
        pieces.splice(j, 1);
        merged = true;
        break outer;
      }
  }
  return pieces.map((ids) => ({
    type: 'custom',
    points: simplify(ids.map((i) => points[i])),
    ...(normalized.fit ? { fit: normalized.fit } : {}),
  }));
}

export function outlinePrism(points, width, depth, thickness) {
  const n = points.length;
  return {
    vertices: [-thickness / 2, thickness / 2].flatMap((y) =>
      points.map(([x, z]) => [x * width, y, z * depth]),
    ),
    faces: [
      Array.from({ length: n }, (_, i) => i),
      Array.from({ length: n }, (_, i) => 2 * n - 1 - i),
      ...points.map((_, i) => [i, i + n, ((i + 1) % n) + n, (i + 1) % n]),
    ],
  };
}
