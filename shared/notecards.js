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
export const NOTECARD_TEXT = Object.freeze({
  maxBoxes: 8,
  maxLength: 500,
  minWidth: 0.15,
  sizes: Object.freeze([0.03, 0.04, 0.06]),
  lineHeight: 1.25,
  padding: 0.004,
  font: 'Arial, sans-serif',
});

export function normalizeNotecardTextBoxes(value = []) {
  if (!Array.isArray(value) || value.length > NOTECARD_TEXT.maxBoxes) return null;
  const ids = new Set();
  const result = [];
  for (const box of value) {
    if (
      !box ||
      typeof box !== 'object' ||
      Array.isArray(box) ||
      Object.keys(box).some(
        (key) => !['id', 'text', 'x', 'y', 'w', 'size', 'color', 'align'].includes(key),
      ) ||
      !Number.isInteger(box.id) ||
      box.id < 1 ||
      box.id > NOTECARD_TEXT.maxBoxes ||
      ids.has(box.id) ||
      typeof box.text !== 'string' ||
      box.text.length > NOTECARD_TEXT.maxLength ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(box.text) ||
      ![box.x, box.y, box.w].every(Number.isFinite) ||
      box.x < 0 ||
      box.y < 0 ||
      box.y > 1 ||
      box.w < NOTECARD_TEXT.minWidth ||
      box.x + box.w > 1 + 1e-8 ||
      !NOTECARD_TEXT.sizes.includes(box.size) ||
      !NOTECARD_COLORS.includes(box.color) ||
      !['left', 'center', 'right'].includes(box.align)
    )
      return null;
    ids.add(box.id);
    const x = Math.round(box.x * 10000) / 10000;
    result.push({
      id: box.id,
      text: box.text.replace(/\r\n?/g, '\n'),
      x,
      y: Math.round(box.y * 10000) / 10000,
      // Independent rounding at the right edge must not make a saved box invalid on reload.
      w: Math.min(Math.round(box.w * 10000), Math.round((1 - x) * 10000)) / 10000,
      size: box.size,
      color: box.color,
      align: box.align,
    });
  }
  return result;
}

// One private content boundary for pieces, hands and stack entries.
export function normalizeNotecardContent(value) {
  const drawing = normalizeNotecardDrawing(value?.drawing);
  const paper = normalizeNotecardPaper(value?.paper);
  const textBoxes = normalizeNotecardTextBoxes(value?.textBoxes);
  return drawing && paper && textBoxes ? { drawing, paper, textBoxes } : null;
}
export const NOTECARD_PATTERNS = Object.freeze(['blank', 'ruled', 'grid', 'dots']);
export const NOTECARD_TONES = Object.freeze({
  ivory: NOTECARD.paper,
  white: '#ffffff',
  yellow: '#fff1b8',
});

// Missing paper in older snapshots means blank ivory. Invalid explicit values fail closed.
export function normalizeNotecardPaper(value = { pattern: 'blank', tone: 'ivory' }) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !['pattern', 'tone'].includes(key)) ||
    typeof value.pattern !== 'string' ||
    typeof value.tone !== 'string' ||
    !NOTECARD_PATTERNS.includes(value.pattern) ||
    !Object.hasOwn(NOTECARD_TONES, value.tone)
  )
    return null;
  return { pattern: value.pattern, tone: value.tone };
}

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
    const content = normalizeNotecardContent(entry);
    const props = entry?.noteProps ?? {};
    if (
      !content ||
      !props ||
      typeof props !== 'object' ||
      Array.isArray(props) ||
      (props.snap !== undefined && typeof props.snap !== 'boolean') ||
      (props.stand !== undefined && ![true, false, 'flat'].includes(props.stand)) ||
      (props.label !== undefined && (typeof props.label !== 'string' || props.label.length > 60))
    )
      return null;
    cards.push({
      ...content,
      noteProps: Object.fromEntries(
        ['snap', 'stand', 'label']
          .filter((key) => props[key] !== undefined)
          .map((key) => [key, props[key]]),
      ),
    });
  }
  return cards;
}
