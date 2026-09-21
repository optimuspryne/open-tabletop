import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MEASURE, OVERLAY_KINDS, OVERLAY_LIMITS, WHITEBOARD_LIMITS } from '../shared/overlays.js';

test('shared overlay protocol exposes immutable kinds and limits', () => {
  assert.deepEqual(OVERLAY_KINDS, ['ruler', 'circle', 'cone', 'line']);
  assert.deepEqual(OVERLAY_LIMITS, { maxRoom: 200, maxPerPlayer: 40 });
  assert.deepEqual(WHITEBOARD_LIMITS, {
    maxStrokes: 2000,
    maxCoordinatesPerStroke: 2000,
    maxColorLength: 24,
    maxStrokeWidth: 0.2,
  });
  assert.equal(MEASURE.maxLen, 80);
  for (const value of [OVERLAY_KINDS, OVERLAY_LIMITS, WHITEBOARD_LIMITS, MEASURE])
    assert.equal(Object.isFrozen(value), true);
});
