import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTableScale } from '../server/game/table-scale.js';

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
  const chess = makeRoom({ props: { board: 'chess' }, halfExtents: { x: 4, z: 4 } });
  assert.deepEqual(operations.calibrateGrid(chess), {
    cellX: 1,
    cellZ: 1,
    gaps: 8,
    anchor: 'center',
  });

  const go = makeRoom({ props: { board: 'go' }, halfExtents: null });
  assert.deepEqual(operations.calibrateGrid(go), {
    cellX: 0.42,
    cellZ: 0.45,
    gaps: 18,
    anchor: 'cross',
  });
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
