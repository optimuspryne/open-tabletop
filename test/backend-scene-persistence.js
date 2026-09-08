import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyScene,
  clearGameTable,
  serializeGame,
  serializeScene,
} from '../server/game/scene-persistence.js';
import { saveFinalRoomState, saveRoomStateNow } from '../server/game/handlers/room-state.js';

const geoOf = (props) => ({ ...(props.tile ? { tile: props.tile } : {}) });

function serializationRoom() {
  const pieces = new Map([
    [
      'deck-1',
      {
        type: 'deck',
        props: JSON.stringify({ back: '/back', model: '/box.glb', tile: { w: 2 } }),
        x: 1,
        y: 2,
        z: 3,
        qx: 0,
        qy: 0,
        qz: 0,
        qw: 1,
      },
    ],
    [
      'card-1',
      {
        type: 'card',
        props: JSON.stringify({ back: '/back' }),
        x: 4,
        y: 5,
        z: 6,
        qx: 0,
        qy: 1,
        qz: 0,
        qw: 0,
      },
    ],
  ]);
  return {
    state: {
      pieces,
      overlays: new Map([
        [
          'o1',
          {
            kind: 'line',
            color: '#123456',
            x: 1,
            z: 2,
            x2: 3,
            z2: 4,
            w: 5,
            ang: 6,
          },
        ],
      ]),
      trays: new Map([
        ['0', true],
        ['1', false],
        ['2', true],
      ]),
      players: new Map([['live', { name: 'Live Player' }]]),
      tableX: 10,
      tableZ: 8,
      tableShape: 'rect',
      rimWood: 'mahogany',
      turn: 'live',
    },
    deckCards: new Map([['deck-1', ['/two']]]),
    pendingInspect: new Map([['inspect', { deckId: 'deck-1', front: '/one' }]]),
    cardData: new Map([['card-1', { front: '/secret' }]]),
    hands: new Map([['live', ['/live-card']]]),
    pendingHands: new Map([['departed', { name: 'Departed', cards: ['/held-card'] }]]),
    scaleSnapshot: () => ({ worldPerUnit: 2 }),
    clientBy: (sessionId) => (sessionId === 'live' ? { auth: { userId: 42 } } : null),
  };
}

test('scene serialization preserves public geometry and private card fronts safely', () => {
  const snapshot = serializeScene(serializationRoom(), { geoOf });
  assert.deepEqual(snapshot.table, { x: 10, z: 8, shape: 'rect', rimWood: 'mahogany' });
  assert.deepEqual(snapshot.trays, [0, 2]);
  assert.deepEqual(snapshot.scale, { worldPerUnit: 2 });
  assert.deepEqual(snapshot.pieces[0].props, {
    back: '/back',
    cards: ['/two', '/one'],
    tile: { w: 2 },
    deckModel: '/box.glb',
  });
  assert.deepEqual(snapshot.pieces[1].props, {
    back: '/back',
    front: '/secret',
    faceDown: true,
  });
  assert.deepEqual(snapshot.overlays[0], {
    kind: 'line',
    color: '#123456',
    x: 1,
    z: 2,
    x2: 3,
    z2: 4,
    w: 5,
    ang: 6,
  });
});

test('game serialization converts live sessions and departed hands to stable user IDs', () => {
  const snapshot = serializeGame(serializationRoom(), { geoOf });
  assert.deepEqual(snapshot.hands, [
    { userId: '42', name: 'Live Player', cards: ['/live-card'] },
    { userId: 'departed', name: 'Departed', cards: ['/held-card'] },
  ]);
  assert.deepEqual(snapshot.turn, { userId: '42', name: 'Live Player' });
});

function restorationRoom() {
  const calls = [];
  const room = {
    state: {
      pieces: new Map(),
      overlays: new Map(),
      scores: new Map(),
      unclaimed: new Map([['old', 'Old']]),
      tableX: 0,
      tableZ: 0,
      turn: 'old-session',
      turnPending: 'Old',
    },
    cardData: new Map(),
    hands: new Map(),
    pendingInspect: new Map(),
    drafts: new Map(),
    deckCards: new Map(),
    flips: new Map(),
    targets: new Map(),
    groups: new Map(),
    _released: new Map(),
    lastDrop: new Map(),
    shows: new Map(),
    clients: [],
    pendingHands: new Map([['old', { name: 'Old', cards: ['/old'] }]]),
    pendingTurn: 'old',
    nextOverlayId: 1,
    clearTable() {
      clearGameTable(this);
      calls.push(['clear']);
    },
    removePiece(id) {
      this.state.pieces.delete(id);
      calls.push(['remove', id]);
    },
    stopShow(sid) {
      this.shows.delete(sid);
      calls.push(['stopShow', sid]);
    },
    sendHand(client) {
      calls.push(['hand', client.sessionId, this.hands.get(client.sessionId) || []]);
    },
    buildBounds(...args) {
      calls.push(['bounds', ...args]);
    },
    applyScale(value) {
      calls.push(['scale', value]);
    },
    applyTrays(value) {
      calls.push(['trays', value]);
    },
    swapBoard(value) {
      calls.push(['board', value]);
    },
    spawn(type, position, props, quaternion) {
      const id = `piece-${this.state.pieces.size + 1}`;
      this.state.pieces.set(id, { type });
      calls.push(['spawn', type, position, props, quaternion]);
      return id;
    },
    scheduleSave() {
      calls.push(['save']);
    },
  };
  return { room, calls };
}

test('scene restoration validates bounds and keeps face-down fronts private', () => {
  const { room, calls } = restorationRoom();
  applyScene(
    room,
    {
      table: { x: 999, z: -999 },
      scale: { worldPerUnit: 5 },
      trays: [1],
      pieces: [
        {
          type: 'card',
          x: 1,
          y: 3,
          z: 2,
          q: [0, 0, 0, 1],
          props: { front: '/secret', faceDown: true, back: '/back' },
        },
        { type: 'not-a-piece', props: {} },
      ],
      overlays: [
        { kind: 'line', color: '#abcdef', x: 999999, z: 2, x2: 3, z2: 4, w: 999999, ang: 1 },
        { kind: 'invalid' },
      ],
      hands: [{ userId: 7, name: 'Returning', cards: ['/card'] }],
      turn: { userId: 7, name: 'Returning' },
    },
    {
      createOverlay: () => ({}),
      maxPieces: 80,
      overlayKinds: new Set(['line']),
      overlayMax: 200,
      tableLimits: { minX: 4, maxX: 20, minZ: 3, maxZ: 16 },
    },
  );

  assert.deepEqual(
    calls.find(([name]) => name === 'bounds'),
    ['bounds', 20, 3, 'rect'],
  );
  assert.deepEqual(
    calls.find(([name]) => name === 'spawn'),
    ['spawn', 'card', [1, 3, 2], { back: '/back' }, [0, 0, 0, 1]],
  );
  assert.deepEqual(room.cardData.get('piece-1'), { front: '/secret' });
  assert.equal(room.state.overlays.size, 1);
  assert.equal(room.state.overlays.get('o1').owner, '');
  assert.equal(room.state.overlays.get('o1').x, 80);
  assert.equal(room.state.overlays.get('o1').w, 80);
  assert.deepEqual(room.pendingHands.get('7'), { name: 'Returning', cards: ['/card'] });
  assert.equal(room.pendingTurn, '7');
  assert.equal(room.state.turn, '');
  assert.equal(calls.at(-1)[0], 'save');
});

const restoreOptions = {
  createOverlay: () => ({}),
  maxPieces: 250,
  overlayKinds: new Set(['line']),
  overlayMax: 200,
  tableLimits: { minX: 4, maxX: 20, minZ: 3, maxZ: 16 },
};

test('reset removes pending game state and undo data while preserving room features', () => {
  const { room, calls } = restorationRoom();
  room.state.pieces.set('old-piece', { type: 'card' });
  room.state.overlays.set('old-overlay', {});
  room.savedScene = { pieces: [{ type: 'card' }] };
  room.clients = [{ sessionId: 'live' }];
  for (const map of [
    room.hands,
    room.pendingInspect,
    room.drafts,
    room.deckCards,
    room.cardData,
    room.flips,
    room.targets,
    room.groups,
    room._released,
    room.lastDrop,
    room.shows,
  ])
    map.set('live', ['old-card']);
  room.state.notes = 'campaign notes';
  room.state.scores.set('score', { score: 7 });
  room.state.timer = { running: true };
  room.state.whiteboard = { enabled: true };
  room.notebooks = new Map([['user:7', 'private note']]);
  room.chatLog = ['hello'];
  room.strokes = ['stroke'];
  const preserved = structuredClone({
    notes: room.state.notes,
    scores: room.state.scores,
    timer: room.state.timer,
    whiteboard: room.state.whiteboard,
    notebooks: room.notebooks,
    chatLog: room.chatLog,
    strokes: room.strokes,
  });

  room.clearTable();
  for (const map of [
    room.state.pieces,
    room.state.overlays,
    room.state.unclaimed,
    room.hands,
    room.pendingHands,
    room.pendingInspect,
    room.drafts,
    room.deckCards,
    room.cardData,
    room.flips,
    room.targets,
    room.groups,
    room._released,
    room.lastDrop,
    room.shows,
  ])
    assert.equal(map.size, 0);
  assert.equal(room.pendingTurn, null);
  assert.equal(room.state.turn, '');
  assert.equal(room.state.turnPending, '');
  assert.equal(room.savedScene, null);
  assert.ok(calls.some(([type]) => type === 'save'));
  assert.deepEqual(
    calls.find(([type]) => type === 'hand'),
    ['hand', 'live', []],
  );
  assert.deepEqual(
    {
      notes: room.state.notes,
      scores: room.state.scores,
      timer: room.state.timer,
      whiteboard: room.state.whiteboard,
      notebooks: room.notebooks,
      chatLog: room.chatLog,
      strokes: room.strokes,
    },
    preserved,
  );
});

test('loading a scene without hands or a turn removes the previous game and replaces its checkpoint', () => {
  const { room } = restorationRoom();
  room.savedScene = { pieces: [{ type: 'card' }] };
  const scene = { pieces: [] };
  applyScene(room, scene, restoreOptions);
  assert.equal(room.pendingHands.size, 0);
  assert.equal(room.state.unclaimed.size, 0);
  assert.equal(room.pendingTurn, null);
  assert.equal(room.state.turnPending, '');
  assert.equal(room.state.turn, '');
  assert.deepEqual(room.savedScene, scene);
});

test('final save persists hands without table pieces and restores them on reopen', async () => {
  const room = serializationRoom();
  room.roomId = 'room';
  room.state.pieces.clear();
  room.state.scores = new Map();
  room.pendingTurn = 'departed';
  room.state.turnPending = 'Departed';
  room.savedScene = { pieces: [{ type: 'die' }] };
  room.serializeGame = () => serializeGame(room, { geoOf });
  let written;
  room.saveStateNow = () =>
    saveRoomStateNow(room, {
      db: {
        async saveRoomState(id, value) {
          written = structuredClone(value);
        },
      },
    });
  room._saveTimer = { pending: true };
  const cancelled = [];
  await saveFinalRoomState(room, {
    sceneMaxBytes: 2_000_000,
    clearTimer: (timer) => cancelled.push(timer),
  });
  assert.equal(cancelled.length, 1);
  assert.equal(room._saveTimer, null);
  assert.deepEqual(written.scene.pieces, []);
  assert.equal(written.scene.hands.length, 2);
  assert.deepEqual(written.scene.turn, { userId: 'departed', name: 'Departed' });
  const { room: reopened } = restorationRoom();
  applyScene(reopened, written.scene, restoreOptions);
  assert.equal(reopened.state.pieces.size, 0);
  assert.deepEqual(reopened.pendingHands.get('42').cards, ['/live-card']);
  assert.deepEqual(reopened.pendingHands.get('departed').cards, ['/held-card']);
  assert.equal(reopened.pendingTurn, 'departed');
  assert.deepEqual(reopened.savedScene, written.scene);
});

test('final save of an empty game replaces an older populated checkpoint', async () => {
  const room = serializationRoom();
  room.state.pieces.clear();
  room.hands.clear();
  room.pendingHands.clear();
  room.state.turn = '';
  room.savedScene = { pieces: [{ type: 'die' }], hands: [{ cards: ['/old'] }] };
  room.serializeGame = () => serializeGame(room, { geoOf });
  let saved;
  room.saveStateNow = async () => {
    saved = structuredClone(room.savedScene);
  };
  await saveFinalRoomState(room, { sceneMaxBytes: 2_000_000 });
  assert.deepEqual(saved.pieces, []);
  assert.deepEqual(saved.hands, []);
  assert.equal(saved.turn, null);
  const { room: reopened } = restorationRoom();
  applyScene(reopened, saved, restoreOptions);
  assert.equal(reopened.state.pieces.size, 0);
  assert.equal(reopened.pendingHands.size, 0);
});

test('final save retains the size limit and propagates persistence failures', async () => {
  const previous = { pieces: [] };
  const room = {
    savedScene: previous,
    serializeGame: () => ({ data: 'x'.repeat(100) }),
    async saveStateNow() {
      throw new Error('database unavailable');
    },
  };
  await assert.rejects(saveFinalRoomState(room, { sceneMaxBytes: 20 }), /database unavailable/);
  assert.equal(room.savedScene, previous);
});

test('snapshot combines same-account live, reconnecting, and pending hands without overwrites', () => {
  const room = serializationRoom();
  room.handOwners = new Map([
    ['live', '42'],
    ['reconnecting', '42'],
  ]);
  room.hands.set('reconnecting', ['/reconnecting-card']);
  room.pendingHands.set('42', { name: 'Live Player', cards: ['/parked-card'] });
  const snapshot = serializeGame(room, { geoOf });
  assert.deepEqual(snapshot.hands.find((hand) => hand.userId === '42').cards, [
    '/live-card',
    '/reconnecting-card',
    '/parked-card',
  ]);
  assert.deepEqual(room.hands.get('live'), ['/live-card']);
  assert.deepEqual(room.pendingHands.get('42').cards, ['/parked-card']);
});

test('restoring duplicate account entries preserves cards and replaces stale hand IDs', () => {
  const { room } = restorationRoom();
  room.nextHid = 1;
  const card = { hid: 'h1', front: '/same', back: '/custom', open: true, geom: { w: 2 } };
  const scene = {
    pieces: [],
    hands: [
      { userId: 7, name: 'Player', cards: [card] },
      { userId: '7', name: 'Player', cards: [card] },
    ],
  };
  applyScene(room, scene, restoreOptions);
  assert.deepEqual(room.pendingHands.get('7').cards, [card, { ...card, hid: 'h2' }]);
  assert.equal(room.nextHid, 3); // the next newly drawn card cannot collide
  assert.equal(scene.hands[1].cards[0].hid, 'h1');
});

test('snapshot restores inspected top cards in draw order with backs and deck appearance intact', () => {
  const room = serializationRoom();
  room.state.pieces.get('deck-1').props = JSON.stringify({
    back: 'shared',
    model: 'pouch',
    color: '#123456',
    textColor: '#abcdef',
    open: true,
    geom: { w: 2, h: 3 },
    snap: true,
    cover: 'derived-cover',
  });
  room.deckCards.set('deck-1', ['bottom']);
  room.pendingInspect = new Map([
    ['first', { deckId: 'deck-1', front: 'top', cardBack: 'top-back' }],
    ['second', { deckId: 'deck-1', front: 'middle', cardBack: 'middle-back' }],
  ]);
  const scene = serializeScene(room);
  const deck = scene.pieces[0].props;
  assert.deepEqual(deck, {
    back: 'shared',
    deckModel: 'pouch',
    color: '#123456',
    textColor: '#abcdef',
    open: true,
    snap: true,
    geom: { w: 2, h: 3 },
    cards: ['bottom', { front: 'middle', back: 'middle-back' }, { front: 'top', back: 'top-back' }],
  });
  assert.deepEqual(room.deckCards.get('deck-1'), ['bottom']);
  assert.equal(room.pendingInspect.size, 2);
  const { room: restored, calls } = restorationRoom();
  applyScene(restored, scene, restoreOptions);
  const spawn = calls.find(([type, kind]) => type === 'spawn' && kind === 'deck');
  assert.deepEqual(spawn[3], deck);
});
