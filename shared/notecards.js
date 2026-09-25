// One landscape drawing surface. Limits bound messages, textures and saved scenes.
export const NOTECARD = Object.freeze({
  width: 4.5,
  height: 3,
  thickness: 0.1,
  mass: 0.18,
  maxCards: 16,
  maxStrokes: 256,
  maxCoordinates: 8192,
  maxStrokeCoordinates: 1024,
  leaseMs: 120_000,
  canvasWidth: 1024,
  canvasHeight: 682,
  paper: '#fffdf5',
  back: '#344759',
});
export const NOTECARD_COLORS = Object.freeze([
  '#202830',
  '#d43b3b',
  '#e98621',
  '#dfb52b',
  '#31865a',
  '#2878ba',
  '#8457b5',
  '#ffffff',
]);
export const NOTECARD_WIDTHS = Object.freeze([0.003, 0.007, 0.015]);

export function normalizeNotecardDrawing(value) {
  if (!Array.isArray(value) || value.length > NOTECARD.maxStrokes) return null;
  let coordinates = 0;
  const result = [];
  for (const stroke of value) {
    if (
      !stroke ||
      typeof stroke !== 'object' ||
      Array.isArray(stroke) ||
      Object.keys(stroke).some((key) => !['pts', 'color', 'width', 'erase'].includes(key)) ||
      !Array.isArray(stroke.pts) ||
      stroke.pts.length < 2 ||
      stroke.pts.length % 2 ||
      stroke.pts.length > NOTECARD.maxStrokeCoordinates ||
      !NOTECARD_COLORS.includes(stroke.color) ||
      !NOTECARD_WIDTHS.includes(stroke.width) ||
      typeof stroke.erase !== 'boolean'
    )
      return null;
    coordinates += stroke.pts.length;
    if (
      coordinates > NOTECARD.maxCoordinates ||
      !stroke.pts.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)
    )
      return null;
    result.push({
      pts: stroke.pts.map((n) => Math.round(n * 10000) / 10000),
      color: stroke.color,
      width: stroke.width,
      erase: stroke.erase,
    });
  }
  return result;
}

// Stacks keep the last entry on top. Only counts/dimensions cross the public boundary.
export const notecardStackHeight = (count = 1) =>
  NOTECARD.thickness * Math.max(1, Math.min(NOTECARD.maxCards, Math.trunc(count) || 1));

export function normalizeNotecardStack(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > NOTECARD.maxCards) return null;
  const cards = [];
  for (const entry of value) {
    const drawing = normalizeNotecardDrawing(entry?.drawing);
    const props = entry?.noteProps ?? {};
    if (
      !drawing ||
      !props ||
      typeof props !== 'object' ||
      Array.isArray(props) ||
      (props.snap !== undefined && typeof props.snap !== 'boolean') ||
      (props.stand !== undefined && ![true, false, 'flat'].includes(props.stand)) ||
      (props.label !== undefined && (typeof props.label !== 'string' || props.label.length > 60))
    )
      return null;
    cards.push({
      drawing,
      noteProps: Object.fromEntries(
        ['snap', 'stand', 'label']
          .filter((key) => props[key] !== undefined)
          .map((key) => [key, props[key]]),
      ),
    });
  }
  return cards;
}
