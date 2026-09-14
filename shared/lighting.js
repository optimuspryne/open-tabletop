export const LIGHTING_PRESETS = Object.freeze({
  neutral: Object.freeze({
    azimuth: 130,
    elevation: 55,
    keyIntensity: 1,
    keyColor: '#ffffff',
    ambientIntensity: 1,
    ambientColor: '#ffffff',
    shadowSoftness: 0.55,
  }),
  warm: Object.freeze({
    azimuth: 125,
    elevation: 48,
    keyIntensity: 1.15,
    keyColor: '#ffd7aa',
    ambientIntensity: 0.72,
    ambientColor: '#ffe8cf',
    shadowSoftness: 0.65,
  }),
  cool: Object.freeze({
    azimuth: 145,
    elevation: 58,
    keyIntensity: 1.05,
    keyColor: '#dcecff',
    ambientIntensity: 0.82,
    ambientColor: '#c8dcff',
    shadowSoftness: 0.58,
  }),
  sunset: Object.freeze({
    azimuth: 265,
    elevation: 18,
    keyIntensity: 1.35,
    keyColor: '#ff985f',
    ambientIntensity: 0.5,
    ambientColor: '#866fa8',
    shadowSoftness: 0.72,
  }),
  moonlight: Object.freeze({
    azimuth: 35,
    elevation: 42,
    keyIntensity: 0.58,
    keyColor: '#adc9ff',
    ambientIntensity: 0.32,
    ambientColor: '#5976a8',
    shadowSoftness: 0.5,
  }),
  dramatic: Object.freeze({
    azimuth: 310,
    elevation: 24,
    keyIntensity: 1.65,
    keyColor: '#fff0dc',
    ambientIntensity: 0.2,
    ambientColor: '#64718a',
    shadowSoftness: 0.18,
  }),
});

export const FACTORY_LIGHTING = Object.freeze({ preset: 'neutral', ...LIGHTING_PRESETS.neutral });

const hex = (value, fallback) =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
const number = (value, fallback, min, max) => {
  const n = typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

export function normalizeLighting(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const preset =
    source.preset == null
      ? FACTORY_LIGHTING.preset
      : LIGHTING_PRESETS[source.preset]
        ? source.preset
        : 'custom';
  return {
    preset,
    azimuth: number(source.azimuth, FACTORY_LIGHTING.azimuth, 0, 360),
    elevation: number(source.elevation, FACTORY_LIGHTING.elevation, 10, 90),
    keyIntensity: number(source.keyIntensity, FACTORY_LIGHTING.keyIntensity, 0, 2),
    keyColor: hex(source.keyColor, FACTORY_LIGHTING.keyColor),
    ambientIntensity: number(source.ambientIntensity, FACTORY_LIGHTING.ambientIntensity, 0, 1),
    ambientColor: hex(source.ambientColor, FACTORY_LIGHTING.ambientColor),
    shadowSoftness: number(source.shadowSoftness, FACTORY_LIGHTING.shadowSoftness, 0, 1),
  };
}

export const lightingSnapshot = (lighting) => normalizeLighting(lighting);
