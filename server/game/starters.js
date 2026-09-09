import { BOARDS, PROPS, STARTERS } from '../../shared/pieces.js';

// Build the starter-layout orchestrator around the room's existing inventory and geometry rules.
// The room remains authoritative for clearing, spawning, calibration, dealing, and persistence.
export function createStarterSetup({ deckBuilders, geoOf, maxPieces, spawnY }) {
  const { buildSimpleDeck, buildDominoSet, buildScrabbleBag, buildMahjongWall } = deckBuilders;

  return function setupStarter(room, game) {
    const def = STARTERS[game];
    if (!def) return false;
    room.clearTable();
    let gridded = false;
    if (def.board) {
      room.swapBoard({ board: def.board });
      // Chess/checkers derive cell size from the board; Go pins its printed-line spacing.
      const grid = room.calibrateGrid();
      if (grid) {
        gridded = true;
        room.state.scale.gridHidden = true;
        if (def.pieces) {
          const cells = def.cells || 8;
          const half = (cells - 1) / 2;
          const boardTop = (BOARDS[def.board].box[1] || 0.15) * 2;
          for (const piece of def.pieces()) {
            if (room.state.pieces.size >= maxPieces) break;
            const x = (piece.col - half) * grid.cellX;
            const z = (piece.row - half) * grid.cellZ;
            const box = ((PROPS[piece.shape] || {}).collider || {}).box;
            const restY = boardTop + (box ? box[1] : 0.2) + 0.03;
            // Spawn upright so tall pieces do not fall across neighboring squares while settling.
            room.spawn(
              'prop',
              [x, restY, z],
              { shape: piece.shape, team: piece.team, snap: true },
              [0, 0, 0, 1],
            );
          }
        }
      }
    }
    if (!gridded) {
      room.state.scale.gridStyle = 'off';
      room.scheduleSave();
    }
    for (const bowl of def.bowls || []) {
      room.spawn('dispenser', [bowl.x, spawnY, bowl.z], {
        disp: bowl.disp,
        team: bowl.team,
      });
    }
    if (def.deck) {
      const deck = def.deck === true ? {} : def.deck;
      const built =
        deck.set === 'domino'
          ? buildDominoSet()
          : deck.set === 'letter'
            ? buildScrabbleBag()
            : deck.set === 'mahjong'
              ? buildMahjongWall()
              : buildSimpleDeck(!!deck.jokers);
      const deckId = room.spawn('deck', [0, spawnY, def.deckZ ?? 0], {
        back: built.back,
        cards: built.cards,
        ...geoOf(built),
        deckModel: built.deckModel,
      });
      if (deck.deal > 0) room.dealFromDeckToSeats(deckId, deck.deal);
    }
    for (const stack of def.stacks || []) {
      room.spawn('dispenser', [stack.x, spawnY, stack.z], {
        disp: stack.disp,
        color: stack.color,
      });
    }
    return true;
  };
}
