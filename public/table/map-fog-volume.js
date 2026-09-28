import { MAP_FOG } from '../../shared/map-fog.js';

// Boundary walls only: caps reuse the exploration texture. Y is normalized so thickness
// changes stretch existing walls without rebuilding them. Outline must be convex, as boards are.
export function fogWallPositions(mask, { w, d }, outline) {
  const n = MAP_FOG.resolution,
    positions = [];
  const covered = (x, z) => {
    const bit = Math.max(0, Math.min(n - 1, z)) * n + Math.max(0, Math.min(n - 1, x));
    return !!(mask[bit >> 3] & (1 << (bit & 7)));
  };
  const minX = Math.min(...outline.map((p) => p[0])),
    maxX = Math.max(...outline.map((p) => p[0]));
  const minZ = Math.min(...outline.map((p) => p[1])),
    maxZ = Math.max(...outline.map((p) => p[1]));
  const orientation = Math.sign(
    outline.reduce((area, a, i) => {
      const b = outline[(i + 1) % outline.length];
      return area + a[0] * b[1] - b[0] * a[1];
    }, 0),
  );
  const wall = (a, b, clip = true) => {
    const dx = b[0] - a[0],
      dz = b[1] - a[1];
    let lo = 0,
      hi = 1;
    if (clip)
      for (let i = 0; i < outline.length; i++) {
        const p = outline[i],
          q = outline[(i + 1) % outline.length];
        const ex = q[0] - p[0],
          ez = q[1] - p[1];
        const start = orientation * (ex * (a[1] - p[1]) - ez * (a[0] - p[0]));
        const delta = orientation * (ex * dz - ez * dx);
        if (Math.abs(delta) < 1e-12) {
          if (start < -1e-10) return;
        } else if (delta > 0) lo = Math.max(lo, -start / delta);
        else hi = Math.min(hi, -start / delta);
        if (hi <= lo) return;
      }
    const x0 = a[0] + lo * dx,
      z0 = a[1] + lo * dz;
    const x1 = a[0] + hi * dx,
      z1 = a[1] + hi * dz;
    if (Math.hypot(x1 - x0, z1 - z0) < 1e-10) return;
    positions.push(x0, 0, z0, x1, 0, z1, x1, 1, z1, x0, 0, z0, x1, 1, z1, x0, 1, z0);
  };
  // Merge collinear cell boundaries into runs. Edge cells extend to the authored outline,
  // matching the cap texture's clamp-to-edge behavior on fitted/rotated board outlines.
  for (let x = 1; x < n; x++) {
    const px = (x / n - 0.5) * w;
    let start = -1;
    for (let z = 0; z <= n; z++) {
      const boundary = z < n && covered(x - 1, z) !== covered(x, z);
      if (boundary && start < 0) start = z;
      if (!boundary && start >= 0) {
        wall(
          [px, start === 0 ? minZ : (start / n - 0.5) * d],
          [px, z === n ? maxZ : (z / n - 0.5) * d],
        );
        start = -1;
      }
    }
  }
  for (let z = 1; z < n; z++) {
    const pz = (z / n - 0.5) * d;
    let start = -1;
    for (let x = 0; x <= n; x++) {
      const boundary = x < n && covered(x, z - 1) !== covered(x, z);
      if (boundary && start < 0) start = x;
      if (!boundary && start >= 0) {
        wall(
          [start === 0 ? minX : (start / n - 0.5) * w, pz],
          [x === n ? maxX : (x / n - 0.5) * w, pz],
        );
        start = -1;
      }
    }
  }
  // Seal the perimeter, splitting each outline edge where it crosses a mask cell.
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i],
      b = outline[(i + 1) % outline.length];
    const dx = b[0] - a[0],
      dz = b[1] - a[1],
      cuts = [0, 1];
    for (let k = 1; k < n; k++) {
      for (const t of [((k / n - 0.5) * w - a[0]) / dx, ((k / n - 0.5) * d - a[1]) / dz])
        if (Number.isFinite(t) && t > 0 && t < 1) cuts.push(t);
    }
    cuts.sort((a, b) => a - b);
    let start = null;
    for (let j = 0; j < cuts.length - 1; j++) {
      const t = (cuts[j] + cuts[j + 1]) / 2;
      const filled = covered(
        Math.floor(((a[0] + t * dx) / w + 0.5) * n),
        Math.floor(((a[1] + t * dz) / d + 0.5) * n),
      );
      if (filled && start === null) start = cuts[j];
      if (start !== null && (!filled || j === cuts.length - 2)) {
        const end = filled ? cuts[j + 1] : cuts[j];
        wall([a[0] + start * dx, a[1] + start * dz], [a[0] + end * dx, a[1] + end * dz], false);
        start = null;
      }
    }
  }
  return new Float32Array(positions);
}
