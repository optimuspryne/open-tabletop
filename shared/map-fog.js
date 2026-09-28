import { boardHalfExtents } from './board-geometry.js';

// Persistent, bounded exploration mask. Coordinates, radii and thickness are board-local world units.
export const MAP_FOG = Object.freeze({
  version: 1,
  resolution: 256,
  maxPoints: 256,
  maxRadius: 256,
  minRadius: 0.01,
  maxThickness: 64,
  thicknessStep: 0.05,
  undoDepth: 20,
  editInterval: 75,
  lift: 0.003,
  gmOpacity: 0.5,
});
const bytes = MAP_FOG.resolution ** 2 / 8;
const encodedLength = Math.ceil(bytes / 3) * 4;

export function fogBoardSize(type, props = {}) {
  if (type !== 'board' || !props || typeof props !== 'object') return null;
  const [hx, hy, hz] = boardHalfExtents(props);
  if (![hx, hy, hz].every((v) => Number.isFinite(v) && v > 0)) return null;
  const w = hx * 2,
    d = hz * 2;
  return Number.isFinite(w) && Number.isFinite(d) && w > 0 && d > 0 && w <= 200 && d <= 200
    ? { w, d }
    : null;
}

export function encodeFogMask(mask) {
  return btoa(String.fromCharCode(...mask));
}

export function decodeFogMask(value) {
  if (
    typeof value !== 'string' ||
    value.length !== encodedLength ||
    !/^[A-Za-z0-9+/]+=$/.test(value)
  )
    return null;
  try {
    const raw = atob(value);
    if (raw.length !== bytes || btoa(raw) !== value) return null;
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export function emptyFog() {
  return {
    v: MAP_FOG.version,
    enabled: false,
    revision: 0,
    thickness: 0,
    mask: encodeFogMask(new Uint8Array(bytes).fill(255)),
  };
}

export function normalizeFog(value) {
  // Preserve exploratory masks and slider settings from the earlier raised-sheet slice.
  const thickness =
    value?.thickness !== undefined
      ? value.thickness
      : value?.height !== undefined
        ? value.height
        : 0;
  if (
    !value ||
    value.v !== MAP_FOG.version ||
    typeof value.enabled !== 'boolean' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !Number.isFinite(thickness) ||
    thickness < 0 ||
    thickness > MAP_FOG.maxThickness ||
    !decodeFogMask(value.mask)
  )
    return null;
  return {
    v: MAP_FOG.version,
    enabled: value.enabled,
    revision: value.revision,
    thickness,
    mask: value.mask,
  };
}

export function parseFog(value) {
  if (!value) return emptyFog();
  if (typeof value !== 'string' || value.length > encodedLength + 150) return null;
  try {
    return normalizeFog(JSON.parse(value));
  } catch {
    return null;
  }
}

export function normalizeFogStroke(value, size) {
  if (
    !value ||
    !size ||
    !['reveal', 'cover'].includes(value.mode) ||
    !Number.isFinite(value.radius) ||
    value.radius < MAP_FOG.minRadius ||
    value.radius > MAP_FOG.maxRadius ||
    !Array.isArray(value.points) ||
    !value.points.length ||
    value.points.length > MAP_FOG.maxPoints
  )
    return null;
  if (
    value.points.some(
      (p) =>
        !Array.isArray(p) ||
        p.length !== 2 ||
        !Number.isFinite(p[0]) ||
        !Number.isFinite(p[1]) ||
        Math.abs(p[0]) > size.w / 2 ||
        Math.abs(p[1]) > size.d / 2,
    )
  )
    return null;
  return { mode: value.mode, radius: value.radius, points: value.points.map((p) => [...p]) };
}

// Rasterize capsules between samples, so fast drags have no holes. Both runtimes use the
// same cell-center rule; non-square boards still get circular world-space brushes.
export function paintFog(mask, stroke, { w, d }) {
  const n = MAP_FOG.resolution,
    radius2 = stroke.radius ** 2;
  let changed = false;
  for (let i = 0; i < stroke.points.length; i++) {
    const a = stroke.points[Math.max(0, i - 1)],
      b = stroke.points[i];
    const dx = b[0] - a[0],
      dz = b[1] - a[1],
      len2 = dx * dx + dz * dz;
    const loX = Math.max(0, Math.floor(((Math.min(a[0], b[0]) - stroke.radius) / w + 0.5) * n));
    const hiX = Math.min(n - 1, Math.floor(((Math.max(a[0], b[0]) + stroke.radius) / w + 0.5) * n));
    const loZ = Math.max(0, Math.floor(((Math.min(a[1], b[1]) - stroke.radius) / d + 0.5) * n));
    const hiZ = Math.min(n - 1, Math.floor(((Math.max(a[1], b[1]) + stroke.radius) / d + 0.5) * n));
    for (let z = loZ; z <= hiZ; z++)
      for (let x = loX; x <= hiX; x++) {
        const px = ((x + 0.5) / n - 0.5) * w - a[0],
          pz = ((z + 0.5) / n - 0.5) * d - a[1];
        const t = len2 ? Math.max(0, Math.min(1, (px * dx + pz * dz) / len2)) : 0;
        if ((px - t * dx) ** 2 + (pz - t * dz) ** 2 > radius2) continue;
        const bit = z * n + x,
          index = bit >> 3,
          flag = 1 << (bit & 7),
          old = mask[index];
        mask[index] = stroke.mode === 'cover' ? old | flag : old & ~flag;
        changed ||= old !== mask[index];
      }
  }
  return changed;
}
