// Shared overlay and whiteboard protocol configuration. Keep renderer-specific
// builders and authoritative server behavior in their respective layers.
export const OVERLAY_KINDS = Object.freeze(['ruler', 'circle', 'cone', 'line']);

export const OVERLAY_LIMITS = Object.freeze({
  maxRoom: 200,
  maxPerPlayer: 40,
});

export const WHITEBOARD_LIMITS = Object.freeze({
  maxStrokes: 2000,
  maxCoordinatesPerStroke: 2000,
  maxColorLength: 24,
  maxStrokeWidth: 0.2,
});

export const MEASURE = Object.freeze({
  lift: 0.05,
  labelLift: 0.6,
  minDrag: 0.2,
  maxLen: 80,
  coneAngle: Math.PI / 6,
  lineWidth: 1,
});
