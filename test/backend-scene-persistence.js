import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyScene,
  serializeGame,
  serializeScene,
} from '../server/game/scene-persistence.js';

const geoOf = (props) => ({ ...(props.tile ? { tile: props.tile } : {}) });

function serializationRoom() {
  const pieces = new Map([
    ['deck-1', {
      type: 'deck',
      props: JSON.stringify({ back: '/back', model: '/box.glb', tile: { w: 2 } }),
      x: 1, y: 2, z: 3, qx: 0, qy: 0, qz: 0, qw: 1,
    }],
    ['card-1', {
      type: 'card',
      props: JSON.stringify({ back: '/back' }),
      x: 4, y: 5, z: 6, qx: 0, qy: 1, qz: 0, qw: 0,
    }],
  ]);
  return {
    state: {
      pieces,
      overlays: new Map([['o1', {
        kind: 'line', color: '#123456', x: 1, z: 2, x2: 3, z2: 4, w: 5, ang: 6,
      }]]),
      trays: new Map([['0', true], ['1', false], ['2', true]]),
      players: new Map([['live', { name: 'Live Player' }]]),
      tableX: 10,
      tableZ: 8,
      turn: 'live',
    },
    deckCards: new Map([['deck-1', ['/two']]]),
    pendingInspect: new Map([['inspect', { deckId: 'deck-1', front: '/one' }]]),
    cardData: new Map([['card-1', { front: '/secret' }]]),
    hands: new Map([['live', ['/live-card']]]),
    pendingHands: new Map([['departed', { name: 'Departed', cards: ['/held-card'] }]]),
    scaleSnapshot: () => ({ worldPerUnit: 2 }),
    clientBy: (sessionId) => sessionId === 'live'
      ? { auth: { userId: 42 } }
      : null,
  };
}

test('scene serialization preserves public geometry and private card fronts safely', () => {
  const snapshot = serializeScene(serializationRoom(), { geoOf });
  assert.deepEqual(snapshot.table, { x: 10, z: 8 });
  assert.deepEqual(snapshot.trays, [0, 2]);
  assert.deepEqual(snapshot.scale, { worldPerUnit: 2 });
  assert.deepEqual(snapshot.pieces[0].props, {
    back: '/back',
    cards: ['/one', '/two'],
    tile: { w: 2 },
    deckModel: '/box.glb',
  });
  assert.deepEqual(snapshot.pieces[1].props, {
    back: '/back',
    front: '/secret',
    faceDown: true,
  });
  assert.deepEqual(snapshot.overlays[0], {
    kind: 'line', color: '#123456', x: 1, z: 2, x2: 3, z2: 4, w: 5, ang: 6,
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
      unclaimed: new Map([['old', 'Old']]),
      tableX: 0,
      tableZ: 0,
      turn: 'old-session',
      turnPending: 'Old',
    },
    cardData: new Map(),
    pendingHands: new Map([['old', { name: 'Old', cards: ['/old'] }]]),
    pendingTurn: 'old',
    nextOverlayId: 1,
    clearTable() { this.state.pieces.clear(); this.state.overlays.clear(); calls.push(['clear']); },
    buildBounds(...args) { calls.push(['bounds', ...args]); },
    applyScale(value) { calls.push(['scale', value]); },
    applyTrays(value) { calls.push(['trays', value]); },
    swapBoard(value) { calls.push(['board', value]); },
    spawn(type, position, props, quaternion) {
      const id = `piece-${this.state.pieces.size + 1}`;
      this.state.pieces.set(id, { type });
      calls.push(['spawn', type, position, props, quaternion]);
      return id;
    },
    scheduleSave() { calls.push(['save']); },
  };
  return { room, calls };
}

test('scene restoration validates bounds and keeps face-down fronts private', () => {
  const { room, calls } = restorationRoom();
  applyScene(room, {
    table: { x: 999, z: -999 },
    scale: { worldPerUnit: 5 },
    trays: [1],
    pieces: [
      { type: 'card', x: 1, y: 3, z: 2, q: [0, 0, 0, 1], props: { front: '/secret', faceDown: true, back: '/back' } },
      { type: 'not-a-piece', props: {} },
    ],
    overlays: [
      { kind: 'line', color: '#abcdef', x: 999999, z: 2, x2: 3, z2: 4, w: 999999, ang: 1 },
      { kind: 'invalid' },
    ],
    hands: [{ userId: 7, name: 'Returning', cards: ['/card'] }],
    turn: { userId: 7, name: 'Returning' },
  }, {
    createOverlay: () => ({}),
    maxPieces: 80,
    overlayKinds: new Set(['line']),
    overlayMax: 200,
    tableLimits: { minX: 4, maxX: 20, minZ: 3, maxZ: 16 },
  });

  assert.deepEqual(calls.find(([name]) => name === 'bounds'), ['bounds', 20, 3]);
  assert.deepEqual(calls.find(([name]) => name === 'spawn'), [
    'spawn', 'card', [1, 3, 2], { back: '/back' }, [0, 0, 0, 1],
  ]);
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
