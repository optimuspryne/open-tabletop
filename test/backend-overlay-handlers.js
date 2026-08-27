import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerOverlayHandlers } from '../server/game/handlers/overlays.js';

const MESSAGE_NAMES = [
  'overlayAdd', 'overlayMove', 'overlayRemove', 'overlayClear', 'overlayDrag',
  'wbEnable', 'wbSet', 'wbClaim', 'wbRelease', 'wbStroke', 'wbClear', 'wbStrokes',
];

function harness({ rank = 0, maxOverlays = 200, maxPerPlayer = 40, maxStrokes = 2 } = {}) {
  const handlers = new Map();
  const events = [];
  const room = {
    nextOverlayId: 1,
    strokes: [],
    state: {
      overlays: new Map(),
      players: new Map([
        ['client-1', { color: '#123456' }],
        ['client-2', { color: '#abcdef' }],
      ]),
      whiteboard: { enabled: false, owner: '', angle: 0, dark: false },
    },
    onMessage(name, handler) { handlers.set(name, handler); },
    rank() { return rank; },
    broadcast(name, payload, options) { events.push({ name, payload, options }); },
  };
  registerOverlayHandlers(room, {
    createOverlay: () => ({}),
    kinds: new Set(['ruler', 'line']),
    maxLength: 100,
    maxOverlays,
    maxPerPlayer,
    maxStrokes,
    logger: { error() {} },
  });
  return { room, handlers, events };
}

const client = (sessionId = 'client-1') => ({
  sessionId,
  sent: [],
  send(type, payload) { this.sent.push({ type, payload }); },
});

const ruler = { kind: 'ruler', x: 1, z: 2, x2: 3, z2: 4, w: 1 };

test('overlay module registers the complete overlay and whiteboard family', () => {
  assert.deepEqual([...harness().handlers.keys()], MESSAGE_NAMES);
});

test('players create, move, and remove only their own overlays', async () => {
  const { room, handlers } = harness();
  const owner = client();
  const other = client('client-2');
  await handlers.get('overlayAdd')(owner, ruler);
  assert.deepEqual(room.state.overlays.get('o1'), {
    ...ruler,
    owner: 'client-1',
    color: '#123456',
    ang: 0,
  });

  await handlers.get('overlayMove')(other, { id: 'o1', x: 9 });
  assert.equal(room.state.overlays.get('o1').x, 1);
  await handlers.get('overlayMove')(owner, { id: 'o1', x: 9 });
  assert.equal(room.state.overlays.get('o1').x, 9);
  await handlers.get('overlayRemove')(other, { id: 'o1' });
  assert.equal(room.state.overlays.has('o1'), true);
  await handlers.get('overlayRemove')(owner, { id: 'o1' });
  assert.equal(room.state.overlays.has('o1'), false);
});

test('overlay limits reject additions after the per-player cap', async () => {
  const { room, handlers } = harness({ maxPerPlayer: 1 });
  await handlers.get('overlayAdd')(client(), ruler);
  await handlers.get('overlayAdd')(client(), { ...ruler, x: 5 });
  assert.equal(room.state.overlays.size, 1);
});

test('GM clear-all removes overlays belonging to every player', async () => {
  const { room, handlers } = harness({ rank: 2 });
  room.state.overlays.set('o1', { owner: 'client-1' });
  room.state.overlays.set('o2', { owner: 'client-2' });
  await handlers.get('overlayClear')(client(), { scope: 'all' });
  assert.equal(room.state.overlays.size, 0);
});

test('live overlay drags are relayed without echoing to the sender', async () => {
  const { handlers, events } = harness();
  const owner = client();
  await handlers.get('overlayDrag')(owner, ruler);
  assert.deepEqual(events, [{
    name: 'overlayDrag',
    payload: { from: 'client-1', color: '#123456', ...ruler, ang: 0 },
    options: { except: owner },
  }]);
});

test('whiteboard ownership gates drawing and retains only bounded history', async () => {
  const { room, handlers, events } = harness({ rank: 2, maxStrokes: 2 });
  const owner = client();
  await handlers.get('wbEnable')(owner, { on: true });
  await handlers.get('wbClaim')(owner);
  const stroke = { pts: [0, 0, 1, 1], color: '#ffffff', width: 0.02, erase: false };
  await handlers.get('wbStroke')(owner, stroke);
  await handlers.get('wbStroke')(owner, { ...stroke, color: '#eeeeee' });
  await handlers.get('wbStroke')(owner, { ...stroke, color: '#dddddd' });

  assert.equal(room.state.whiteboard.owner, 'client-1');
  assert.equal(room.strokes.length, 2);
  assert.equal(room.strokes[0].color, '#eeeeee');
  assert.equal(events.filter(({ name }) => name === 'wbStroke').length, 3);
});

test('non-owners cannot clear the whiteboard but GMs can', async () => {
  const setup = harness({ rank: 0 });
  setup.room.state.whiteboard.owner = 'client-1';
  setup.room.strokes = [{ pts: [] }];
  await setup.handlers.get('wbClear')(client('client-2'));
  assert.equal(setup.room.strokes.length, 1);

  const gm = harness({ rank: 2 });
  gm.room.state.whiteboard.owner = 'client-1';
  gm.room.strokes = [{ pts: [] }];
  await gm.handlers.get('wbClear')(client('client-2'));
  assert.deepEqual(gm.room.strokes, []);
});
