import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notecardShapePoints } from '../public/table/notecard-shapes.js';
import { NOTECARD, normalizeNotecardDrawing } from '../shared/notecards.js';

test('drawing helpers are single bounded ordinary strokes in either drag direction', () => {
  for (const tool of ['line', 'rectangle', 'ellipse'])
    for (const [a, b] of [
      [
        [0.1, 0.2],
        [0.8, 0.9],
      ],
      [
        [0.9, 0.8],
        [0.1, 0.2],
      ],
      [
        [0, 0],
        [1, 1],
      ],
      [
        [1, 1],
        [1, 1],
      ],
    ])
      for (const locked of [false, true]) {
        const pts = notecardShapePoints(tool, a, b, locked);
        assert.equal(pts.length, tool === 'ellipse' ? 130 : tool === 'rectangle' ? 10 : 4);
        assert.ok(
          normalizeNotecardDrawing([{ pts, color: '#202830', width: 0.007, erase: false }]),
        );
        if (tool !== 'line') assert.deepEqual(pts.slice(0, 2), pts.slice(-2));
      }
});

test('constrained squares and circles use physical paper aspect, not normalized aspect', () => {
  for (const tool of ['rectangle', 'ellipse']) {
    const pts = notecardShapePoints(tool, [0.2, 0.2], [0.8, 0.7], true);
    const xs = pts.filter((_, i) => i % 2 === 0),
      ys = pts.filter((_, i) => i % 2 === 1);
    const width = (Math.max(...xs) - Math.min(...xs)) * NOTECARD.canvasWidth;
    const height = (Math.max(...ys) - Math.min(...ys)) * NOTECARD.canvasHeight;
    assert.ok(Math.abs(width - height) < 0.15);
  }
});

test('constrained line angles remain snapped even at the paper edge', () => {
  for (const [a, b] of [
    [
      [0.1, 0.3],
      [0.95, 0.95],
    ],
    [
      [0.9, 0.8],
      [0, 0],
    ],
    [
      [0.4, 0.2],
      [0.4, 0.9],
    ],
    [
      [0.8, 0.7],
      [0.99, 0.72],
    ],
  ]) {
    const pts = notecardShapePoints('line', a, b, true);
    const angle =
      Math.atan2(
        (pts[3] - pts[1]) * NOTECARD.canvasHeight,
        (pts[2] - pts[0]) * NOTECARD.canvasWidth,
      ) /
      (Math.PI / 4);
    assert.ok(Math.abs(angle - Math.round(angle)) < 0.002);
    assert.ok(pts.every((n) => n >= 0 && n <= 1));
  }
});
