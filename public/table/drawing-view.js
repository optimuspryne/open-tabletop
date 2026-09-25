// View-only normalized transform. Saved strokes always stay in paper coordinates.
export function createDrawingView(maxZoom = 8) {
  let scale = 1,
    x = 0,
    y = 0;
  const clamp = () => {
    x = Math.max(1 - scale, Math.min(0, x));
    y = Math.max(1 - scale, Math.min(0, y));
  };
  return {
    get scale() {
      return scale;
    },
    get x() {
      return x;
    },
    get y() {
      return y;
    },
    point(px, py) {
      return [(px - x) / scale, (py - y) / scale];
    },
    transform(from, to, factor = 1) {
      const [px, py] = this.point(...from);
      scale = Math.max(1, Math.min(maxZoom, scale * factor));
      x = to[0] - px * scale;
      y = to[1] - py * scale;
      clamp();
    },
    reset() {
      scale = 1;
      x = y = 0;
    },
  };
}
