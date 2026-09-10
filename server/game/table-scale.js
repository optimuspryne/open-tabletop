import { BOARDS } from '../../shared/pieces.js';
import { readProps } from './props-codec.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Own measurement-scale persistence and board-grid calibration while leaving the room responsible
// for synchronized state, physics bodies, and durable save scheduling.
export function createTableScale({ gridLiftMax }) {
  const scaleSnapshot = (room) => {
    const scale = room.state.scale;
    return {
      worldPerUnit: scale.worldPerUnit,
      unitLabel: scale.unitLabel,
      roundStep: scale.roundStep,
      cellWorld: scale.cellWorld,
      cellZ: scale.cellZ,
      gridX: scale.gridX,
      gridZ: scale.gridZ,
      gridStyle: scale.gridStyle,
      gridColor: scale.gridColor,
      gridLift: scale.gridLift,
      snapAnchor: scale.snapAnchor,
      hexOrient: scale.hexOrient,
      gridHidden: scale.gridHidden,
    };
  };

  const applyScale = (room, value) => {
    if (!value || typeof value !== 'object') return;
    const scale = room.state.scale;
    if (Number.isFinite(+value.worldPerUnit) && +value.worldPerUnit > 0)
      scale.worldPerUnit = clamp(+value.worldPerUnit, 1e-3, 1e3);
    if (typeof value.unitLabel === 'string') scale.unitLabel = value.unitLabel.slice(0, 8);
    if (Number.isFinite(+value.roundStep) && +value.roundStep > 0)
      scale.roundStep = clamp(+value.roundStep, 1e-3, 1e2);
    if (Number.isFinite(+value.cellWorld) && +value.cellWorld >= 0)
      scale.cellWorld = clamp(+value.cellWorld, 0, 1e3);
    if (Number.isFinite(+value.cellZ) && +value.cellZ >= 0)
      scale.cellZ = clamp(+value.cellZ, 0, 1e3);
    if (Number.isFinite(+value.gridX)) scale.gridX = clamp(+value.gridX, -1e3, 1e3);
    if (Number.isFinite(+value.gridZ)) scale.gridZ = clamp(+value.gridZ, -1e3, 1e3);
    if (/^#[0-9a-f]{6}$/i.test(value.gridColor || '')) scale.gridColor = value.gridColor;
    if (Number.isFinite(+value.gridLift)) scale.gridLift = clamp(+value.gridLift, 0, gridLiftMax);
    if (value.snapAnchor === 'center' || value.snapAnchor === 'cross')
      scale.snapAnchor = value.snapAnchor;
    if (value.gridStyle === 'square' || value.gridStyle === 'hex' || value.gridStyle === 'off')
      scale.gridStyle = value.gridStyle;
    if (value.hexOrient === 'pointy' || value.hexOrient === 'flat')
      scale.hexOrient = value.hexOrient;
    if (typeof value.gridHidden === 'boolean') scale.gridHidden = value.gridHidden;
  };

  const calibrateGrid = (room, message = {}) => {
    let boardId = null;
    room.state.pieces.forEach((piece, id) => {
      if (!boardId && piece.type === 'board') boardId = id;
    });
    if (!boardId) return null;

    const scale = room.state.scale;
    const body = room.bodies.get(boardId);
    const shape = body && body.shapes[0];
    const halfExtents = shape && shape.halfExtents;
    const width = halfExtents ? halfExtents.x * 2 : 0;
    const depth = halfExtents ? halfExtents.z * 2 : 0;

    // A hex cell is expressed as its centre-to-vertex size. Adjacent column spacing depends on
    // orientation, so fit the requested number of columns to the board width using that step.
    if (scale.gridStyle === 'hex') {
      const gaps = Math.round(+message.cells);
      if (!(gaps > 0) || !(width > 0)) return null;
      const step = scale.hexOrient === 'flat' ? 1.5 : Math.sqrt(3);
      scale.cellWorld = clamp(width / (gaps * step), 1e-3, 1e3);
      scale.cellZ = 0;
      scale.gridX = 0;
      scale.gridZ = 0;
      room.scheduleSave();
      return { hexSize: scale.cellWorld, gaps, orient: scale.hexOrient };
    }

    const spec = BOARDS[readProps(room.state.pieces.get(boardId)).board];
    let gaps;
    let anchor;
    if (spec && spec.grid) {
      gaps = spec.grid.cells;
      anchor = spec.grid.anchor;
    } else {
      anchor = message.anchor === 'cross' ? 'cross' : 'center';
      const count = Math.round(+message.cells);
      gaps = anchor === 'cross' ? count - 1 : count;
    }
    if (!(gaps > 0)) return null;

    // Built-ins may pin printed-line spacing when a border means the grid does not fill the collider.
    if (spec && spec.grid && spec.grid.cellX > 0) {
      scale.cellWorld = clamp(spec.grid.cellX, 1e-3, 1e3);
      scale.cellZ = clamp(spec.grid.cellZ > 0 ? spec.grid.cellZ : spec.grid.cellX, 1e-3, 1e3);
    } else {
      if (!(width > 0) || !(depth > 0)) return null;
      scale.cellWorld = clamp(width / gaps, 1e-3, 1e3);
      scale.cellZ = clamp(depth / gaps, 1e-3, 1e3);
    }
    scale.gridX = 0;
    scale.gridZ = 0;
    scale.gridStyle = 'square';
    scale.snapAnchor = anchor === 'cross' ? 'cross' : 'center';
    room.scheduleSave();
    return {
      cellX: scale.cellWorld,
      cellZ: scale.cellZ,
      gaps,
      anchor: scale.snapAnchor,
    };
  };

  return { applyScale, calibrateGrid, scaleSnapshot };
}
