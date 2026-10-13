import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTableScale } from '../server/game/table-scale.js';
import { BOARDS, snapToCell } from '../shared/pieces.js';

const operations = createTableScale({ gridLiftMax: 3 });

function makeRoom({ props = {}, halfExtents = { x: 6, z: 4 }, scale = {} } = {}) {
  const boardId = 'board-1';
  const saves = [];
  return {
    saves,
    state: {
      pieces: new Map([[boardId, { type: 'board', props: JSON.stringify(props) }]]),
      scale: {
        worldPerUnit: 1,
        unitLabel: 'ft',
        roundStep: 1,
        cellWorld: 0,
        cellZ: 0,
        gridX: 2,
        gridZ: -2,
        gridStyle: 'off',
        gridColor: '#ffffff',
        gridLift: 0,
        snapAnchor: 'center',
        hexOrient: 'pointy',
        gridHidden: false,
        ...scale,
      },
    },
    bodies: new Map([[boardId, { shapes: [{ halfExtents }] }]]),
    scheduleSave() {
      saves.push('save');
    },
  };
}

test('scale snapshots preserve the durable measurement and grid format exactly', () => {
  const room = makeRoom();
  room.state.scale.futureField = 'not persisted yet';
  assert.deepEqual(operations.scaleSnapshot(room), {
    worldPerUnit: 1,
    unitLabel: 'ft',
    roundStep: 1,
    cellWorld: 0,
    cellZ: 0,
    gridX: 2,
    gridZ: -2,
    gridStyle: 'off',
    gridColor: '#ffffff',
    gridLift: 0,
    snapAnchor: 'center',
    hexOrient: 'pointy',
    gridHidden: false,
  });
});

test('scale restoration accepts partial snapshots and retains every validation boundary', () => {
  const room = makeRoom();
  operations.applyScale(room, {
    worldPerUnit: '2000',
    unitLabel: 'squares-long',
    roundStep: 0.0001,
    cellWorld: -1,
    cellZ: '50',
    gridX: -2000,
    gridZ: 2000,
    gridStyle: 'hex',
    gridColor: '#ABCDEF',
    gridLift: 99,
    snapAnchor: 'cross',
    hexOrient: 'flat',
    gridHidden: true,
  });
  assert.deepEqual(room.state.scale, {
    worldPerUnit: 1000,
    unitLabel: 'squares-',
    roundStep: 0.001,
    cellWorld: 0,
    cellZ: 50,
    gridX: -1000,
    gridZ: 1000,
    gridStyle: 'hex',
    gridColor: '#ABCDEF',
    gridLift: 3,
    snapAnchor: 'cross',
    hexOrient: 'flat',
    gridHidden: true,
  });

  const restored = { ...room.state.scale };
  operations.applyScale(room, {
    worldPerUnit: 0,
    roundStep: Infinity,
    gridStyle: 'triangular',
    gridColor: 'red',
    snapAnchor: 'corner',
    hexOrient: 'diagonal',
    gridHidden: 'yes',
  });
  assert.deepEqual(room.state.scale, restored);
});

test('custom square grids derive center and crossing spacing from the board collider', () => {
  const centered = makeRoom();
  assert.deepEqual(operations.calibrateGrid(centered, { cells: 6, anchor: 'center' }), {
    cellX: 2,
    cellZ: 4 / 3,
    gaps: 6,
    anchor: 'center',
  });
  assert.deepEqual(centered.saves, ['save']);
  assert.deepEqual(
    {
      gridStyle: centered.state.scale.gridStyle,
      gridX: centered.state.scale.gridX,
      gridZ: centered.state.scale.gridZ,
    },
    { gridStyle: 'square', gridX: 0, gridZ: 0 },
  );

  const crossed = makeRoom();
  assert.deepEqual(operations.calibrateGrid(crossed, { cells: 5, anchor: 'cross' }), {
    cellX: 3,
    cellZ: 2,
    gaps: 4,
    anchor: 'cross',
  });
});

test('built-in boards retain authored grid rules and pinned printed-line spacing', () => {
  for (const [key, { grid, box }] of Object.entries(BOARDS)) {
    if (!grid) continue;
    const room = makeRoom({ props: { board: key }, halfExtents: null });
    const cellX = grid.cellX > 0 ? grid.cellX : (box[0] * 2) / grid.cells;
    const cellZ = grid.cellX > 0 ? grid.cellZ || cellX : (box[2] * 2) / grid.cells;
    assert.deepEqual(operations.calibrateGrid(room), {
      cellX,
      cellZ,
      gaps: grid.cells,
      anchor: grid.anchor,
    });
    assert.equal(room.state.scale.gridX, grid.offsetX || 0);
    assert.equal(room.state.scale.gridZ, grid.offsetZ || 0);
  }
});

test('retuned board grids preserve rectangular spacing, anchor, offsets and saved snapping', () => {
  const originalGrid = BOARDS.wordy.grid;
  try {
    for (const grid of [
      { cells: 5, anchor: 'cross', cellX: 0.83, cellZ: 0.57, offsetX: 1.25, offsetZ: -0.42 },
      { cells: 4, anchor: 'center', cellX: 1.13, cellZ: 1.37, offsetX: -0.9, offsetZ: 1.4 },
    ]) {
      BOARDS.wordy.grid = grid;
      const room = makeRoom({ props: { board: 'wordy' }, halfExtents: null });
      assert.deepEqual(operations.calibrateGrid(room), {
        cellX: grid.cellX,
        cellZ: grid.cellZ,
        gaps: grid.cells,
        anchor: grid.anchor,
      });
      const restored = makeRoom();
      operations.applyScale(restored, operations.scaleSnapshot(room));
      assert.deepEqual(operations.scaleSnapshot(restored), operations.scaleSnapshot(room));
      assert.deepEqual(room.saves, ['save']);
      assert.deepEqual(restored.saves, []);
      const phase = grid.anchor === 'center' ? 0.5 : 0;
      for (let row = 0; row < grid.cells; row++) {
        for (let col = 0; col < grid.cells; col++) {
          const x = (col - Math.floor(grid.cells / 2) + phase) * grid.cellX + grid.offsetX;
          const z = (row - Math.floor(grid.cells / 2) + phase) * grid.cellZ + grid.offsetZ;
          const snapped = snapToCell(
            x + grid.cellX * 0.2,
            z - grid.cellZ * 0.2,
            restored.state.scale,
          );
          assert.ok(Math.abs(snapped.x - x) < 1e-10, `column ${col}: ${grid.anchor}`);
          assert.ok(Math.abs(snapped.z - z) < 1e-10, `row ${row}: ${grid.anchor}`);
        }
      }
    }
  } finally {
    BOARDS.wordy.grid = originalGrid;
  }
});

test('hex calibration preserves orientation and rejects unusable requests without saving', () => {
  const pointy = makeRoom({ scale: { gridStyle: 'hex', hexOrient: 'pointy' } });
  const result = operations.calibrateGrid(pointy, { cells: 6 });
  assert.equal(result.gaps, 6);
  assert.equal(result.orient, 'pointy');
  assert.ok(Math.abs(result.hexSize - 2 / Math.sqrt(3)) < 1e-12);
  assert.equal(pointy.state.scale.cellZ, 0);
  assert.deepEqual(pointy.saves, ['save']);

  const flat = makeRoom({ scale: { gridStyle: 'hex', hexOrient: 'flat' } });
  assert.equal(operations.calibrateGrid(flat, { cells: 6 }).hexSize, 4 / 3);

  const invalid = makeRoom({ scale: { gridStyle: 'hex' } });
  assert.equal(operations.calibrateGrid(invalid, { cells: 0 }), null);
  assert.deepEqual(invalid.saves, []);
  invalid.state.pieces.clear();
  assert.equal(operations.calibrateGrid(invalid, { cells: 6 }), null);
});

test('grid calibration accepts a shaped board without box half extents', () => {
  const room = makeRoom({
    props: { w: 12, d: 8, outline: { type: 'clipped', cut: 0.2 } },
    halfExtents: null,
  });
  const result = operations.calibrateGrid(room, { cells: 4, anchor: 'center' });
  assert.ok(result);
  assert.equal(room.state.scale.cellWorld, 3);
  assert.equal(room.state.scale.cellZ, 2);
});

test('compound board calibration uses the model bounds rather than its first small shape', () => {
  const room = makeRoom({
    props: {
      model: '/assets/boards/test.glb',
      box: [6, 0.1, 4],
      compoundCollider: { version: 1, shapes: [] },
    },
    halfExtents: { x: 0.1, z: 0.1 },
  });
  assert.ok(operations.calibrateGrid(room, { cells: 4, anchor: 'center' }));
  assert.equal(room.state.scale.cellWorld, 3);
  assert.equal(room.state.scale.cellZ, 2);
});
