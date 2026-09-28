import { KINDS } from './pieces.js';
import { MAP_FOG } from './map-fog.js';

export const FOG_AURA = Object.freeze({ interval: 100, movement: 0.001, maxSamples: 256 });

export function canHaveFogAura(type, props = {}) {
  return (
    Object.hasOwn(KINDS, type) && type !== 'board' && type !== 'mat' && props?.traySeat == null
  );
}

// Radius is stored in world units, like the manual brush; display scale only changes its label.
export function normalizeFogAura(value) {
  if (
    !value ||
    value.v !== 1 ||
    typeof value.enabled !== 'boolean' ||
    !Number.isFinite(value.radius) ||
    value.radius < MAP_FOG.minRadius ||
    value.radius > MAP_FOG.maxRadius
  )
    return null;
  return { v: 1, enabled: value.enabled, radius: value.radius };
}

export function parseFogAura(value) {
  if (!value) return { v: 1, enabled: false, radius: 1 };
  try {
    return normalizeFogAura(JSON.parse(value));
  } catch {
    return null;
  }
}

// Inverse board quaternion, then project onto its local X/Z plane. Shared by server and preview.
export function fogAuraPoint(piece, board) {
  const values = [
    piece.x,
    piece.y,
    piece.z,
    board.x,
    board.y,
    board.z,
    board.qx,
    board.qy,
    board.qz,
    board.qw,
  ];
  if (!values.every(Number.isFinite)) return null;
  const length = Math.hypot(board.qx, board.qy, board.qz, board.qw);
  if (length < 0.000001) return null;
  const qx = -board.qx / length,
    qy = -board.qy / length,
    qz = -board.qz / length,
    qw = board.qw / length,
    x = piece.x - board.x,
    y = piece.y - board.y,
    z = piece.z - board.z;
  const tx = 2 * (qy * z - qz * y),
    ty = 2 * (qz * x - qx * z),
    tz = 2 * (qx * y - qy * x);
  const result = [x + qw * tx + qy * tz - qz * ty, z + qw * tz + qx * ty - qy * tx];
  return result.every(Number.isFinite) ? result : null;
}
