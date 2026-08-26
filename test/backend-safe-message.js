import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeMessage, safeRoomTask } from '../server/game/safe-message.js';

function harness(handler, options = {}) {
  let registered;
  const logs = [];
  const sent = [];
  const room = {
    roomId: 'room-1', roomCode: 'CODE',
    onMessage(type, callback) { registered = callback; },
  };
  const client = {
    sessionId: 'session-1', auth: { userId: 'user-1' },
    send(type, payload) { sent.push({ type, payload }); },
  };
  const logger = { error(...parts) { logs.push(parts); } };
  safeMessage(room, 'libraryRead', handler, { logger, ...options });
  return { invoke: (message) => registered(client, message), logs, sent };
}

test('safe message boundary catches rejected handlers and reports sanitized context', async () => {
  const secret = { password: 'must-not-be-logged' };
  const { invoke, logs, sent } = harness(async () => { throw new Error('database offline'); });
  await invoke(secret);
  assert.deepEqual(sent, [{
    type: 'serverError', payload: { operation: 'libraryRead', message: 'Server error. Try again.' },
  }]);
  assert.equal(JSON.stringify(logs).includes(secret.password), false);
  assert.match(JSON.stringify(logs), /room-1/);
  assert.match(JSON.stringify(logs), /session-1/);
  assert.match(JSON.stringify(logs), /database offline/);
});

test('safe message boundary catches synchronous throws', async () => {
  const { invoke, sent } = harness(() => { throw new Error('sync failure'); });
  await invoke({});
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'serverError');
});

test('a failed invocation does not disable later room messages', async () => {
  let attempts = 0;
  const { invoke, sent } = harness(() => {
    attempts++;
    if (attempts === 1) throw new Error('first failed');
    return 'ok';
  }, { errorType: 'assetError', publicMessage: 'Library unavailable. Try again.' });
  await invoke({ request: 1 });
  await invoke({ request: 2 });
  assert.equal(attempts, 2);
  assert.deepEqual(sent, [{
    type: 'assetError', payload: { operation: 'libraryRead', message: 'Library unavailable. Try again.' },
  }]);
});

test('safe room tasks contain detached lifecycle failures without a client notification when requested', async () => {
  const logs = [];
  const room = { roomId: 'room-1' };
  await safeRoomTask(room, 'dispose', null, async () => { throw new Error('save failed'); }, {
    logger: { error(...parts) { logs.push(parts); } }, notify: false,
  });
  assert.match(JSON.stringify(logs), /save failed/);
});
