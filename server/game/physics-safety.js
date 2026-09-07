// Generous world envelope, well outside the largest table and its player trays.
export const WORLD_COORD_LIMIT = 10_000;
export const isWorldCoordinate = (value) =>
  Number.isFinite(value) && Math.abs(value) <= WORLD_COORD_LIMIT;

export function dragVelocity(position, target, offsetY, stiffness, maxSpeed) {
  if (![target.x, target.y, target.z].every(isWorldCoordinate)) return null;
  let x = (target.x - position.x) * stiffness;
  let y = (target.y - offsetY - position.y) * stiffness;
  let z = (target.z - position.z) * stiffness;
  const speed = Math.hypot(x, y, z);
  if (!Number.isFinite(speed) || !Number.isFinite(maxSpeed) || maxSpeed < 0) return null;
  if (speed > maxSpeed) {
    const scale = maxSpeed / speed;
    x *= scale;
    y *= scale;
    z *= scale;
  }
  return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
}
