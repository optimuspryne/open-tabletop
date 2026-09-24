import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canInteractWithTable,
  canSendTableRequest,
  createParticipation,
} from '../public/table/participation.js';

test('client policy fails closed before hydration and filters mixed save/spawn requests', () => {
  const room = { sessionId: 'me', state: {} };
  assert.equal(canInteractWithTable(room), false);
  room.state.players = new Map([['me', { timedOut: false }]]);
  assert.equal(canInteractWithTable(room), false);
  room.state.pieces = new Map();
  assert.equal(canInteractWithTable(room), true);
  assert.equal(canSendTableRequest(room, 'toString'), false);
  room.state.players.get('me').timedOut = true;
  for (const type of ['grab', 'showStart', 'drawInspect', 'nextTurn', 'reorderHand'])
    assert.equal(canSendTableRequest(room, type), false, type);
  for (const type of [
    'chat',
    'handSync',
    'wbStrokes',
    'ping',
    'highlightPiece',
    'members',
    'setPlayerTimeout',
  ])
    assert.equal(canSendTableRequest(room, type), true, type);
  for (const type of ['deckFinish', 'saveMat', 'saveProp']) {
    assert.equal(canSendTableRequest(room, type, { spawn: true }), false);
    assert.equal(canSendTableRequest(room, type, { spawn: false }), true);
  }
  assert.equal(canSendTableRequest(room, 'saveMat', {}), false);
  assert.equal(canSendTableRequest(room, 'deckFinish', {}), false);
});

test('the live room adapter cancels once on transition, filters direct callers and restores controls', () => {
  const element = { classList: { toggle() {} }, setAttribute() {}, removeAttribute() {} };
  const notice = {};
  let patch,
    leave,
    disconnected = false,
    cancelled = 0;
  const sent = [];
  const me = { timedOut: false };
  const room = {
    sessionId: 'me',
    state: { pieces: new Map(), players: new Map([['me', me]]) },
    send: (...args) => sent.push(args),
    onStateChange: (fn) => {
      patch = fn;
    },
    onLeave: (fn) => {
      leave = fn;
    },
  };
  const controller = createParticipation({
    getRoom: () => room,
    onBlocked: () => cancelled++,
    doc: { body: {}, getElementById: () => notice, querySelectorAll: () => [element] },
    observe: () => ({
      observe() {},
      disconnect() {
        disconnected = true;
      },
    }),
  });
  controller.bindRoom(room, (obj) =>
    obj === room.state
      ? {
          players: {
            onAdd(fn) {
              fn(me);
            },
            onRemove() {},
          },
        }
      : { listen() {} },
  );
  room.send('grab', { id: 'piece' });
  me.timedOut = true;
  patch();
  patch();
  room.send('grab', { id: 'piece' });
  room.send('handSync');
  assert.equal(cancelled, 1);
  assert.deepEqual(
    sent.map(([type]) => type),
    ['grab', 'handSync'],
  );
  assert.equal(element.inert, true);
  assert.match(notice.textContent, /time-out/);
  me.timedOut = false;
  patch();
  assert.equal(element.inert, false);
  assert.equal(notice.hidden, true);
  leave();
  assert.equal(disconnected, true);
});
