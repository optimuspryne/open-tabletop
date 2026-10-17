import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wallOpeningPanels } from '../public/rendering/rooms/wall-openings.js';

test('wall bands retain exactly their opaque area around centered, offset and edge apertures', () => {
  for (const opening of [
    { x: 0, width: 4, bottom: 2, top: 8 },
    { x: 3, width: 4, bottom: 0, top: 8 },
    { x: 5, width: 4, bottom: -2, top: 12 },
    { x: 20, width: 4, bottom: 2, top: 8 },
  ]) {
    const panels = wallOpeningPanels(12, 0, 10, opening);
    const holeWidth = Math.max(
      0,
      Math.min(6, opening.x + opening.width / 2) - Math.max(-6, opening.x - opening.width / 2),
    );
    const holeHeight = Math.max(0, Math.min(10, opening.top) - Math.max(0, opening.bottom));
    assert.equal(
      panels.reduce((sum, [w, h]) => sum + w * h, 0),
      120 - holeWidth * holeHeight,
    );
    for (let x = -5.9; x < 6; x += 0.2)
      for (let y = 0.1; y < 10; y += 0.2) {
        const covered = panels.filter(
          ([w, h, px, py]) => Math.abs(x - px) < w / 2 && Math.abs(y - py) < h / 2,
        ).length;
        const inHole =
          Math.abs(x - opening.x) < opening.width / 2 && y > opening.bottom && y < opening.top;
        assert.equal(
          covered,
          inHole ? 0 : 1,
          'Wall must have neither overlaps nor gaps outside its aperture',
        );
      }
  }
});

test('wainscot and trim bands clip floor-level doors while retaining bands below windows', () => {
  const door = { x: 2, width: 4, bottom: 0, top: 16 };
  for (const [bottom, top] of [
    [0, 0.6],
    [0, 6],
    [5.5, 5.8],
  ]) {
    const panels = wallOpeningPanels(20, bottom, top, door);
    assert.equal(panels.length, 2);
    assert.equal(
      panels.reduce((sum, [w]) => sum + w, 0),
      16,
    );
  }
  assert.deepEqual(wallOpeningPanels(20, 0, 6, { x: 0, width: 8, bottom: 7, top: 17 }), [
    [20, 6, 0, 3],
  ]);
  assert.deepEqual(wallOpeningPanels(20, 0, 6, null), [[20, 6, 0, 3]]);
});
