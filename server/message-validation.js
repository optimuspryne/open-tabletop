// Normalizers for values arriving across the WebSocket trust boundary.
// Invalid coordinates must never enter the physics engine.
export function finitePosition(message) {
  if (!message || typeof message !== 'object') return null;
  const { x, y, z } = message;
  if (![x, y, z].every(Number.isFinite)) return null;
  return { x, y, z };
}
