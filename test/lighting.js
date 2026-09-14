import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACTORY_LIGHTING, LIGHTING_PRESETS, normalizeLighting } from '../shared/lighting.js';

test('every lighting preset normalizes without changing its authored values', () => {
  for (const [preset, values] of Object.entries(LIGHTING_PRESETS)) {
    assert.deepEqual(normalizeLighting({ preset, ...values }), { preset, ...values });
  }
});

test('lighting normalization supplies defaults and clamps untrusted snapshots', () => {
  assert.deepEqual(normalizeLighting(), FACTORY_LIGHTING);
  assert.deepEqual(
    normalizeLighting({
      preset: 'unknown',
      azimuth: 999,
      elevation: -20,
      keyIntensity: 8,
      keyColor: 'orange',
      ambientIntensity: -1,
      ambientColor: '#ABCDEF',
      shadowSoftness: 4,
    }),
    {
      preset: 'custom',
      azimuth: 360,
      elevation: 10,
      keyIntensity: 2,
      keyColor: '#ffffff',
      ambientIntensity: 0,
      ambientColor: '#abcdef',
      shadowSoftness: 1,
    },
  );
});
