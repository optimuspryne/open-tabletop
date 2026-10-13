import { cardGeom, inTable } from './pieces.js';

export const MAHJONG_WALL = Object.freeze({
  tileGap: 0.002,
  cornerGap: 0.04,
  cornerOverhangStacks: 1,
  floorGap: 0.002,
  edgeMargin: 0.1,
  rectEdgeMargin: 0.04,
});

// Traditional staggered walls: one end projects past its neighbor, while the
// other meets the next row's inside edge. All dimensions match the colliders.
export function mahjongWallLayout(count, props = { tile: 'mahjong' }) {
  if (count !== 136 && count !== 144) return null;
  const { hw, hh, th, shape } = cardGeom(props);
  if (shape !== 'rect') return null;
  const stacks = count / 8;
  const pitch = hw * 2 + MAHJONG_WALL.tileGap;
  const rowLength = stacks * hw * 2 + (stacks - 1) * MAHJONG_WALL.tileGap;
  const stagger = hw * MAHJONG_WALL.cornerOverhangStacks;
  const rowOffset = hh + stagger;
  const radius = (rowLength + MAHJONG_WALL.cornerGap) / 2 - stagger;
  const tiles = [];
  for (let side = 0; side < 4; side++) {
    const angle = (side * Math.PI) / 2;
    const cos = Math.round(Math.cos(angle));
    const sin = Math.round(Math.sin(angle));
    for (let column = 0; column < stacks; column++) {
      const along = (column - (stacks - 1) / 2) * pitch + rowOffset;
      const x = along * cos + radius * sin;
      const z = along * sin - radius * cos;
      for (let layer = 0; layer < 2; layer++)
        tiles.push({
          side,
          column,
          layer,
          position: [x, th * (1 + layer * 2) + MAHJONG_WALL.floorGap, z],
          quaternion: [0, Math.sin(-angle / 2), 0, Math.cos(-angle / 2)],
          halfX: side % 2 ? hh : hw,
          halfZ: side % 2 ? hw : hh,
          halfY: th,
        });
    }
  }
  const span = 2 * Math.max(radius + hh, rowLength / 2 + rowOffset);
  return { stacks, span, tiles };
}

export function mahjongWallFits(layout, { tableX, tableZ, tableShape = 'rect' }) {
  if (!layout || !Number.isFinite(tableX) || !Number.isFinite(tableZ)) return false;
  return layout.tiles.every(({ position: [x, , z], halfX, halfZ }) =>
    [-1, 1].every((sx) =>
      [-1, 1].every((sz) =>
        inTable(
          x + sx * halfX,
          z + sz * halfZ,
          tableShape,
          tableX,
          tableZ,
          tableShape === 'rect' ? MAHJONG_WALL.rectEdgeMargin : MAHJONG_WALL.edgeMargin,
        ),
      ),
    ),
  );
}
