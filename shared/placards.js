// Bounded public account appearance; no uploaded code, textures or model references.
export const PLACARD_SHAPES = Object.freeze({
  feminine: 'Body 1 · Feminine',
  masculine: 'Body 2 · Masculine',
  shepherd: 'Dog · Pointed ears',
  retriever: 'Dog · Floppy ears',
  shorthair: 'Cat · Shorthair',
  fluffy: 'Cat · Fluffy',
  frog: 'Frog',
  gecko: 'Gecko',
});
export const PLACARD_PATTERNS = Object.freeze({
  solid: 'Solid',
  gradient: 'Gradient',
  stripes: 'Stripes',
  dots: 'Polka dots',
  stars: 'Stars',
  checker: 'Checkerboard',
});
export const DEFAULT_PLACARD = Object.freeze({
  shape: 'masculine',
  pattern: 'gradient',
  color: '#344759',
  accent: '#17212c',
});
export function normalizePlacard(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 4 || keys.some((key) => !Object.hasOwn(DEFAULT_PLACARD, key))) return null;
  if (
    !Object.hasOwn(PLACARD_SHAPES, value.shape) ||
    !Object.hasOwn(PLACARD_PATTERNS, value.pattern)
  )
    return null;
  if (
    ![value.color, value.accent].every(
      (color) => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color),
    )
  )
    return null;
  return {
    shape: value.shape,
    pattern: value.pattern,
    color: value.color.toLowerCase(),
    accent: value.accent.toLowerCase(),
  };
}
export function readPlacard(value) {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return { ...DEFAULT_PLACARD };
    }
  }
  return normalizePlacard(value) || { ...DEFAULT_PLACARD };
}
