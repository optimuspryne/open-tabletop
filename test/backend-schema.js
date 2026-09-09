import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Encoder, MapSchema, Reflection } from '@colyseus/schema';
import { TABLE } from '../shared/pieces.js';
import {
  Piece,
  Player,
  Timer,
  ScoreRow,
  Whiteboard,
  RoomScale,
  Overlay,
  State,
} from '../server/game/schema.js';

const STATE_FIELDS = [
  'pieces',
  'players',
  'turn',
  'timer',
  'scores',
  'notes',
  'tableX',
  'tableZ',
  'tableShape',
  'rimWood',
  'whiteboard',
  'trays',
  'skybox',
  'feltColor',
  'roomName',
  'turnPending',
  'unclaimed',
  'scale',
  'overlays',
];

test('State preserves synchronized defaults and collection construction', () => {
  const state = new State();
  assert.deepEqual(Object.keys(state.toJSON()), STATE_FIELDS);
  for (const field of ['pieces', 'players', 'scores', 'trays', 'unclaimed', 'overlays']) {
    assert.ok(state[field] instanceof MapSchema, `${field} should be a MapSchema`);
  }
  assert.deepEqual(
    {
      turn: state.turn,
      notes: state.notes,
      tableX: state.tableX,
      tableZ: state.tableZ,
      tableShape: state.tableShape,
      rimWood: state.rimWood,
      skybox: state.skybox,
      feltColor: state.feltColor,
      roomName: state.roomName,
      turnPending: state.turnPending,
    },
    {
      turn: '',
      notes: '',
      tableX: TABLE.x,
      tableZ: TABLE.z,
      tableShape: 'rect',
      rimWood: 'mahogany',
      skybox: '',
      feltColor: '#2f6b4f',
      roomName: '',
      turnPending: '',
    },
  );
  assert.deepEqual(state.timer.toJSON(), {
    running: false,
    mode: 'up',
    base: 0,
    since: 0,
    duration: 300000,
  });
  assert.deepEqual(state.whiteboard.toJSON(), {
    enabled: false,
    angle: 0,
    owner: '',
    dark: true,
  });
  assert.deepEqual(state.scale.toJSON(), {
    worldPerUnit: 1,
    unitLabel: 'u',
    roundStep: 0.1,
    cellWorld: 0,
    cellZ: 0,
    gridX: 0,
    gridZ: 0,
    gridStyle: 'off',
    gridColor: '#ffffff',
    gridLift: 0.05,
    snapAnchor: 'center',
    hexOrient: 'pointy',
    gridHidden: false,
  });
});

test('schema reflection round-trips every synchronized class and preserves field order', () => {
  const state = new State();
  const piece = new Piece();
  Object.assign(piece, {
    type: 'card',
    owner: 'client-1',
    props: '{"front":"ace"}',
    count: 1,
    x: 1,
    y: 2,
    z: 3,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
  });
  const player = new Player();
  Object.assign(player, {
    seat: 2,
    order: 3,
    hand: 4,
    name: 'Ada',
    color: '#123456',
    avatar: '/avatar.png',
    showing: 1,
    handBack: '/back.png',
    role: 'gm',
  });
  state.pieces.set('piece-1', piece);
  state.players.set('client-1', player);
  state.scores.set('score-1', new ScoreRow('Wins', 7));
  state.overlays.set('overlay-1', new Overlay());
  state.trays.set('2', true);
  state.unclaimed.set('42', 'Departed');

  const encoder = new Encoder(state);
  const decoder = Reflection.decode(Reflection.encode(encoder));
  decoder.decode(encoder.encodeAll());

  const decoded = decoder.state.toJSON();
  const original = state.toJSON();
  assert.deepEqual(Object.keys(decoded), STATE_FIELDS);
  // Colyseus encodes `number` as float32, so non-binary fractions round slightly on the wire.
  assert.ok(Math.abs(decoded.scale.roundStep - original.scale.roundStep) < 1e-7);
  assert.ok(Math.abs(decoded.scale.gridLift - original.scale.gridLift) < 1e-7);
  decoded.scale.roundStep = original.scale.roundStep;
  decoded.scale.gridLift = original.scale.gridLift;
  assert.deepEqual(decoded, original);
  assert.ok(state.timer instanceof Timer);
  assert.ok(state.whiteboard instanceof Whiteboard);
  assert.ok(state.scale instanceof RoomScale);
});
