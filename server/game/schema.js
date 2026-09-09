import { Schema, MapSchema, defineTypes } from '@colyseus/schema';
import { TABLE } from '../../shared/pieces.js';

// defineTypes() is the no-build-step way to declare schema in plain JS.
// Clients rebuild this schema automatically via reflection, so declaration order is part of the
// wire contract.
export class Piece extends Schema {}
defineTypes(Piece, {
  type: 'string',
  owner: 'string',
  props: 'string',
  count: 'number', // count = cards in a deck (0 for other pieces)
  x: 'number',
  y: 'number',
  z: 'number',
  qx: 'number',
  qy: 'number',
  qz: 'number',
  qw: 'number',
});

// PUBLIC per-player info: seat/turn order + hand count (never card identities).
export class Player extends Schema {}
defineTypes(Player, {
  seat: 'number',
  order: 'number',
  hand: 'number',
  name: 'string',
  color: 'string',
  avatar: 'string',
  showing: 'number',
  handBack: 'string',
  role: 'string',
}); // showing = revealed hand-card count; handBack = public hand back; role = per-room role

// PUBLIC shared timer. Only its anchor is synchronized; clients compute its live value locally.
export class Timer extends Schema {
  constructor() {
    super();
    this.running = false;
    this.mode = 'up';
    this.base = 0;
    this.since = 0;
    this.duration = 300000;
  }
}
defineTypes(Timer, {
  running: 'boolean',
  mode: 'string',
  base: 'number',
  since: 'number',
  duration: 'number',
});

export class ScoreRow extends Schema {
  constructor(label = '', score = 0) {
    super();
    this.label = label;
    this.score = score;
  }
}
defineTypes(ScoreRow, { label: 'string', score: 'number' });

// Synced singleton; stroke history remains ephemeral server-owned state outside the schema.
export class Whiteboard extends Schema {
  constructor() {
    super();
    this.enabled = false;
    this.angle = 0;
    this.owner = '';
    this.dark = true;
  }
}
defineTypes(Whiteboard, { enabled: 'boolean', angle: 'number', owner: 'string', dark: 'boolean' });

// PUBLIC display and grid scale; it never rescales physics or piece geometry.
export class RoomScale extends Schema {
  constructor() {
    super();
    this.worldPerUnit = 1;
    this.unitLabel = 'u';
    this.roundStep = 0.1;
    this.cellWorld = 0;
    this.cellZ = 0;
    this.gridX = 0;
    this.gridZ = 0;
    this.gridStyle = 'off';
    this.gridColor = '#ffffff';
    this.gridLift = 0.05;
    this.snapAnchor = 'center';
    this.hexOrient = 'pointy';
    this.gridHidden = false;
  }
}
defineTypes(RoomScale, {
  worldPerUnit: 'number',
  unitLabel: 'string',
  roundStep: 'number',
  cellWorld: 'number',
  cellZ: 'number',
  gridX: 'number',
  gridZ: 'number',
  gridStyle: 'string',
  gridColor: 'string',
  gridLift: 'number',
  snapAnchor: 'string',
  hexOrient: 'string',
  gridHidden: 'boolean',
});

// PUBLIC non-physics measurement/template overlay rendered by the browser.
export class Overlay extends Schema {
  constructor() {
    super();
    this.kind = 'ruler';
    this.color = '#ffffff';
    this.owner = '';
    this.x = 0;
    this.z = 0;
    this.x2 = 0;
    this.z2 = 0;
    this.w = 0;
    this.ang = 0;
  }
}
defineTypes(Overlay, {
  kind: 'string',
  color: 'string',
  owner: 'string',
  x: 'number',
  z: 'number',
  x2: 'number',
  z2: 'number',
  w: 'number',
  ang: 'number',
});

export class State extends Schema {
  constructor() {
    super();
    this.pieces = new MapSchema();
    this.players = new MapSchema();
    this.turn = '';
    this.timer = new Timer();
    this.scores = new MapSchema();
    this.notes = '';
    this.tableX = TABLE.x;
    this.tableZ = TABLE.z;
    this.tableShape = 'rect';
    this.rimWood = 'mahogany';
    this.whiteboard = new Whiteboard();
    this.trays = new MapSchema();
    this.skybox = '';
    this.feltColor = '#2f6b4f';
    this.roomName = '';
    this.turnPending = '';
    this.unclaimed = new MapSchema();
    this.scale = new RoomScale();
    this.overlays = new MapSchema();
  }
}
defineTypes(State, {
  pieces: { map: Piece },
  players: { map: Player },
  turn: 'string',
  timer: Timer,
  scores: { map: ScoreRow },
  notes: 'string',
  tableX: 'number',
  tableZ: 'number',
  tableShape: 'string',
  rimWood: 'string',
  whiteboard: Whiteboard,
  trays: { map: 'boolean' },
  skybox: 'string',
  feltColor: 'string',
  roomName: 'string',
  turnPending: 'string',
  unclaimed: { map: 'string' },
  scale: RoomScale,
  overlays: { map: Overlay },
});
