import { NOTECARD } from '../../shared/notecards.js';

const ELLIPSE_SEGMENTS = 64;
// Helpers produce the existing bounded stroke format; no shape protocol or server geometry.
export function notecardShapePoints(tool, start, end, constrain = false) {
  const w = NOTECARD.canvasWidth,
    h = NOTECARD.canvasHeight;
  const x = start[0] * w,
    y = start[1] * h;
  let dx = (end[0] - start[0]) * w,
    dy = (end[1] - start[1]) * h;
  if (constrain) {
    if (tool === 'line') {
      const angle = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI) / 4;
      const length = Math.hypot(dx, dy);
      dx = Math.cos(angle) * length;
      dy = Math.sin(angle) * length;
      // Shorten the ray at the paper edge without changing its snapped angle.
      const scale = Math.min(
        1,
        dx > 0 ? (w - x) / dx : dx < 0 ? -x / dx : 1,
        dy > 0 ? (h - y) / dy : dy < 0 ? -y / dy : 1,
      );
      dx *= scale;
      dy *= scale;
    } else {
      const size = Math.min(Math.abs(dx), Math.abs(dy));
      dx = Math.sign(dx) * size;
      dy = Math.sign(dy) * size;
    }
  }
  let points;
  if (tool === 'rectangle') points = [x, y, x + dx, y, x + dx, y + dy, x, y + dy, x, y];
  else if (tool === 'ellipse') {
    points = [];
    for (let i = 0; i <= ELLIPSE_SEGMENTS; i++) {
      const angle = (i / ELLIPSE_SEGMENTS) * Math.PI * 2;
      points.push(x + dx / 2 + (dx / 2) * Math.cos(angle), y + dy / 2 + (dy / 2) * Math.sin(angle));
    }
  } else points = [x, y, x + dx, y + dy];
  return points.map(
    (n, i) => Math.round(Math.max(0, Math.min(1, n / (i % 2 ? h : w))) * 10000) / 10000,
  );
}
