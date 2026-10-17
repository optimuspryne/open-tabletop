// Rectangles covering a wall band around a single aperture, in wall-local units.
// Also clips wainscot/trim bands so opaque dressing cannot seal a glazed door.
export function wallOpeningPanels(width, bottom, top, opening) {
  const half = width / 2;
  if (
    !opening ||
    opening.top <= bottom ||
    opening.bottom >= top ||
    opening.x + opening.width / 2 <= -half ||
    opening.x - opening.width / 2 >= half
  )
    return [[width, top - bottom, 0, (top + bottom) / 2]];
  const left = Math.max(-half, opening.x - opening.width / 2);
  const right = Math.min(half, opening.x + opening.width / 2);
  const low = Math.max(bottom, opening.bottom);
  const high = Math.min(top, opening.top);
  return [
    [left + half, top - bottom, (left - half) / 2, (top + bottom) / 2],
    [half - right, top - bottom, (right + half) / 2, (top + bottom) / 2],
    [right - left, low - bottom, (left + right) / 2, (low + bottom) / 2],
    [right - left, top - high, (left + right) / 2, (top + high) / 2],
  ].filter(([w, h]) => w > 0 && h > 0);
}
