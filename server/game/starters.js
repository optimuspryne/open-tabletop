import { BOARDS, PROPS, STARTERS, dieR } from '../../shared/pieces.js';
import { mahjongWallFits, mahjongWallLayout } from '../../shared/mahjong-wall.js';

// Build the starter-layout orchestrator around the room's existing inventory and geometry rules.
// The room remains authoritative for clearing, spawning, calibration, dealing, and persistence.
export function createStarterSetup({ deckBuilders, spawnMahjongWall, geoOf, maxPieces, spawnY }) {
  const { buildSimpleDeck, buildDominoSet, buildScrabbleBag, buildMahjongWall } = deckBuilders;

  return function setupStarter(room, game) {
    if (typeof game !== 'string' || !Object.hasOwn(STARTERS, game)) return false;
    const def = STARTERS[game];
    if (def.mahjongWall) {
      const count = def.mahjongWall.bonusTiles ? 144 : 136;
      if (count + def.dice.length > maxPieces)
        return { ok: false, message: 'The Mahjong starter exceeds this room’s piece limit.' };
      if (!mahjongWallFits(mahjongWallLayout(count), room.state))
        return {
          ok: false,
          message: 'The Mahjong wall does not fit this table. Enlarge the play surface first.',
        };
    }
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
    if (def.mahjongWall) {
      const result = spawnMahjongWall(room, def.mahjongWall.bonusTiles);
      if (!result.ok) return result;
    }
    for (const { x, z, ...props } of def.dice || [])
      room.spawn('die', [x, dieR(props.sides) + 0.03, z], props, [0, 0, 0, 1]);
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
