import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStarterSetup } from '../server/game/starters.js';
import { clearGameTable } from '../server/game/scene-persistence.js';
import { BOARDS, PROPS } from '../shared/pieces.js';

function makeHarness({ maxPieces = 250, grid = { cellX: 2, cellZ: 3 } } = {}) {
  const events = [];
  const builderCalls = [];
  const deckBuilders = {
    buildSimpleDeck(jokers) {
      builderCalls.push(['simple', jokers]);
      return { back: 'standard-back', cards: ['ace', 'king'] };
    },
    buildDominoSet() {
      builderCalls.push(['domino']);
      return {
        back: 'domino-back',
        cards: ['double-six'],
        tile: 'domino',
        deckModel: 'bentwood',
      };
    },
    buildScrabbleBag() {
      builderCalls.push(['letter']);
      return { back: 'letter-back', cards: ['A'], tile: 'letter', snap: true };
    },
    buildMahjongWall() {
      builderCalls.push(['mahjong']);
      return { back: 'mahjong-back', cards: ['east'], tile: 'mahjong' };
    },
  };
  const privateMapNames = [
    'hands',
    'pendingHands',
    'pendingInspect',
    'drafts',
    'deckCards',
    'cardData',
    'flips',
    'targets',
    'groups',
    '_released',
    'lastDrop',
  ];
  const room = {
    state: {
      pieces: new Map([['old-piece', { type: 'prop' }]]),
      scale: { gridStyle: 'hex', gridHidden: false },
      turn: 'old-session',
      turnPending: 'Old player',
      unclaimed: new Map([['42', 'Old player']]),
      overlays: new Map([['old-overlay', {}]]),
    },
    clients: [{ sessionId: 'client-1' }],
    shows: new Map([['client-1', {}]]),
    pendingTurn: '42',
    savedScene: { pieces: ['old'] },
    nextPieceId: 1,
    removePiece(id) {
      events.push(['remove', id]);
      this.state.pieces.delete(id);
    },
    stopShow(sessionId) {
      events.push(['stopShow', sessionId]);
      this.shows.delete(sessionId);
    },
    sendHand(client) {
      events.push(['sendHand', client.sessionId]);
    },
    scheduleSave() {
      events.push(['save']);
    },
    clearTable() {
      events.push(['clear']);
      clearGameTable(this);
    },
    spawn(type, pos, props, quaternion) {
      if (this.state.pieces.size >= maxPieces) return null;
      const id = `new-${this.nextPieceId++}`;
      this.state.pieces.set(id, { type, pos, props, quaternion });
      events.push(['spawn', id, type, pos, props, quaternion]);
      return id;
    },
    swapBoard(props) {
      events.push(['swapBoard', props]);
      return this.spawn('board', [0, BOARDS[props.board].box[1], 0], props);
    },
    calibrateGrid() {
      events.push(['calibrateGrid']);
      if (!grid) return null;
      this.state.scale.gridStyle = 'square';
      return grid;
    },
    dealFromDeckToSeats(deckId, count) {
      events.push(['deal', deckId, count]);
    },
  };
  for (const name of privateMapNames) room[name] = new Map([['old', {}]]);

  const setupStarter = createStarterSetup({
    deckBuilders,
    geoOf: (props) => ({
      ...(props.tile ? { tile: props.tile } : {}),
      ...(props.snap ? { snap: true } : {}),
    }),
    maxPieces,
    spawnY: 4,
  });
  return { room, events, builderCalls, privateMapNames, setupStarter };
}

test('unknown starters leave an existing table untouched', () => {
  const { room, events, setupStarter } = makeHarness();
  assert.equal(setupStarter(room, 'missing'), false);
  assert.equal(room.state.pieces.has('old-piece'), true);
  assert.deepEqual(events, []);
});

test('a board starter clears all old public and private game state before placing pieces', () => {
  const { room, events, privateMapNames, setupStarter } = makeHarness();
  assert.equal(setupStarter(room, 'chess'), true);

  assert.equal(events[0][0], 'clear');
  assert.equal(room.state.pieces.has('old-piece'), false);
  assert.equal(room.state.pieces.size, 33); // board + 32 chess pieces
  assert.equal(room.state.scale.gridHidden, true);
  assert.equal(room.state.turn, '');
  assert.equal(room.state.turnPending, '');
  assert.equal(room.pendingTurn, null);
  assert.equal(room.savedScene, null);
  assert.equal(room.state.unclaimed.size, 0);
  assert.equal(room.state.overlays.size, 0);
  assert.equal(room.shows.size, 0);
  for (const name of privateMapNames) assert.equal(room[name].size, 0, `${name} should be cleared`);

  const spawns = events.filter((event) => event[0] === 'spawn');
  assert.equal(spawns[0][2], 'board');
  const props = spawns.slice(1);
  assert.equal(props.length, 32);
  assert.ok(props.every((event) => event[2] === 'prop'));
  assert.ok(props.every((event) => event[4].snap === true));
  assert.ok(props.every((event) => event[5].join(',') === '0,0,0,1'));

  const firstRook = props[0];
  const rookHalfHeight = PROPS['chess-rook'].collider.box[1];
  assert.deepEqual(firstRook[3], [
    -3.5 * 2,
    BOARDS.chess.box[1] * 2 + rookHalfHeight + 0.03,
    -3.5 * 3,
  ]);
});

test('piece placement stops at capacity after reserving the board slot', () => {
  const { room, setupStarter } = makeHarness({ maxPieces: 5 });
  assert.equal(setupStarter(room, 'chess'), true);
  assert.equal(room.state.pieces.size, 5);
  assert.equal([...room.state.pieces.values()].filter((piece) => piece.type === 'prop').length, 4);
});

test('tile starters select the extracted builder, clear stale grids, and preserve initial dealing', () => {
  const { room, events, builderCalls, setupStarter } = makeHarness();
  assert.equal(setupStarter(room, 'dominoes'), true);

  assert.deepEqual(builderCalls, [['domino']]);
  assert.equal(room.state.scale.gridStyle, 'off');
  const deckSpawn = events.find((event) => event[0] === 'spawn' && event[2] === 'deck');
  assert.deepEqual(deckSpawn.slice(3), [
    [0, 4, 0],
    {
      back: 'domino-back',
      cards: ['double-six'],
      tile: 'domino',
      deckModel: 'bentwood',
    },
    undefined,
  ]);
  assert.deepEqual(
    events.find((event) => event[0] === 'deal'),
    ['deal', deckSpawn[1], 7],
  );
});

test('standard-card starters use the simple builder and create every configured chip stack', () => {
  const { room, events, builderCalls, setupStarter } = makeHarness();
  assert.equal(setupStarter(room, 'poker'), true);

  assert.deepEqual(builderCalls, [['simple', false]]);
  const spawns = events.filter((event) => event[0] === 'spawn');
  assert.equal(spawns.filter((event) => event[2] === 'deck').length, 1);
  const stacks = spawns.filter((event) => event[2] === 'dispenser');
  assert.equal(stacks.length, 3);
  assert.ok(stacks.every((event) => event[3][1] === 4));
  assert.ok(stacks.every((event) => event[4].disp === 'pokerStack'));
});
