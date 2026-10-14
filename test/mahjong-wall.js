import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardGeom, TABLE } from '../shared/pieces.js';
import { MAHJONG_WALL, mahjongWallFits, mahjongWallLayout } from '../shared/mahjong-wall.js';

for (const count of [136, 144])
  test(`${count}-tile wall has four separate two-high rows, fits the default table and shares collider dimensions`, () => {
    const layout = mahjongWallLayout(count);
    const { hw, hh, th } = cardGeom({ tile: 'mahjong' });
    assert.equal(layout.stacks, count / 8);
    assert.equal(layout.tiles.length, count);
    assert.equal(mahjongWallFits(layout, { tableX: TABLE.x, tableZ: TABLE.z }), true);
    for (let side = 0; side < 4; side++) {
      const row = layout.tiles.filter((tile) => tile.side === side);
      assert.equal(row.length, count / 4);
      for (let column = 0; column < layout.stacks; column++) {
        const [bottom, top] = row.filter((tile) => tile.column === column);
        assert.equal(bottom.layer, 0);
        assert.equal(top.layer, 1);
        assert.equal(top.position[0], bottom.position[0]);
        assert.equal(top.position[2], bottom.position[2]);
        assert.ok(Math.abs(top.position[1] - bottom.position[1] - th * 2) < 1e-10);
        assert.ok(Math.abs(bottom.position[1] - th - MAHJONG_WALL.floorGap) < 1e-10);
        assert.deepEqual([bottom.halfX, bottom.halfZ], side % 2 ? [hh, hw] : [hw, hh]);
      }
    }
    // Check every same-layer pair, including all four corner joins.
    const floor = layout.tiles.filter((tile) => tile.layer === 0);
    // Every row projects past one neighboring wall by about one stack and joins
    // the next at its inside edge, matching the traditional staggered corners.
    const north = floor.filter((tile) => tile.side === 0);
    const east = floor.filter((tile) => tile.side === 1);
    const west = floor.filter((tile) => tile.side === 3);
    const northStart = Math.min(...north.map((tile) => tile.position[0] - tile.halfX));
    const northEnd = Math.max(...north.map((tile) => tile.position[0] + tile.halfX));
    const eastOutside = east[0].position[0] + east[0].halfX;
    const westInside = west[0].position[0] + west[0].halfX;
    assert.ok(northEnd - eastOutside > hw * 1.9, 'Corner overhang is missing');
    assert.ok(northEnd - eastOutside < hw * 2, 'Corner overhang exceeds a stack');
    assert.ok(Math.abs(northStart - westInside - MAHJONG_WALL.cornerGap / 2) < 1e-10);
    for (const [index, tile] of north.entries()) {
      if (index)
        assert.ok(
          Math.abs(
            tile.position[0] - north[index - 1].position[0] - hw * 2 - MAHJONG_WALL.tileGap,
          ) < 1e-10,
        );
      // The other three rows must repeat the same corner arrangement by rotation.
      for (const side of [1, 2, 3]) {
        const angle = (side * Math.PI) / 2;
        const rotated = floor.find((slot) => slot.side === side && slot.column === tile.column);
        assert.ok(
          Math.abs(
            rotated.position[0] -
              tile.position[0] * Math.cos(angle) +
              tile.position[2] * Math.sin(angle),
          ) < 1e-10,
        );
        assert.ok(
          Math.abs(
            rotated.position[2] -
              tile.position[0] * Math.sin(angle) -
              tile.position[2] * Math.cos(angle),
          ) < 1e-10,
        );
      }
    }
    const actualSpan =
      Math.max(...floor.map((tile) => tile.position[0] + tile.halfX)) -
      Math.min(...floor.map((tile) => tile.position[0] - tile.halfX));
    assert.ok(Math.abs(layout.span - actualSpan) < 1e-10);
    for (let i = 0; i < floor.length; i++)
      for (let j = i + 1; j < floor.length; j++) {
        const a = floor[i],
          b = floor[j];
        assert.ok(
          Math.abs(a.position[0] - b.position[0]) >= a.halfX + b.halfX - 1e-10 ||
            Math.abs(a.position[2] - b.position[2]) >= a.halfZ + b.halfZ - 1e-10,
          `Overlapping wall tiles ${i}/${j}`,
        );
      }
  });

test('wall fit accounts for shape and all tile corners without resizing the table', () => {
  const layout = mahjongWallLayout(144);
  assert.equal(mahjongWallFits(layout, { tableX: 4, tableZ: 4 }), false);
  // The main square fits here, but the projecting corner tiles do not.
  assert.equal(mahjongWallFits(layout, { tableX: 7, tableZ: 6.8 }), false);
  assert.equal(mahjongWallFits(layout, { tableX: 10, tableZ: 7, tableShape: 'oval' }), false);
  for (const tableShape of ['rect', 'roundedRect', 'round', 'oval', 'hex'])
    assert.equal(mahjongWallFits(layout, { tableX: 12, tableZ: 12, tableShape }), true);
  assert.equal(mahjongWallLayout(140), null);
  assert.equal(
    mahjongWallLayout(136, { tile: 'mahjong', geom: { shape: 'hex', w: 1, h: 1 } }),
    null,
  );
});
