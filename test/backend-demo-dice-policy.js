import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoDicePolicy, DemoDiceLimitError } from '../server/game/demo-dice-policy.js';
import { rollDie } from '../server/game/dice-roll.js';
import { safeRoomTask } from '../server/game/safe-message.js';

test('demo deadlines use the injected clock and clear with room disposal/reset', () => {
  let time = 0;
  const policy = createDemoDicePolicy({ now: () => time });
  assert.equal(policy.acceptRoll('1'), true);
  time = 999;
  assert.equal(policy.acceptRoll('1'), false);
  time = 1000;
  assert.equal(policy.acceptRoll('1'), true);
  assert.equal(policy.acceptRoll('2'), true);
  policy.clear();
  assert.equal(policy.acceptRoll('1'), true);
  assert.ok(Object.isFrozen(policy));
  assert.ok(Object.isFrozen(policy.limits));
});

test('invalid or missing dice cannot consume roll cooldown', () => {
  const room = {
    state: {
      pieces: new Map([
        ['1', { type: 'die' }],
        ['2', { type: 'prop' }],
      ]),
    },
    bodies: new Map(),
    dicePolicy: createDemoDicePolicy(),
  };
  assert.equal(rollDie(room, '1', {}), false);
  assert.equal(rollDie(room, '2', {}), false);
  assert.equal(rollDie(room, '3', {}), false);
  assert.equal(room.dicePolicy.acceptRoll('1'), true);
});

test('expected demo errors use coalesced approved notices through the real error boundary', async () => {
  let time = 0;
  const sent = [];
  const errors = [];
  const room = { dicePolicy: createDemoDicePolicy({ now: () => time }) };
  const client = { send: (...args) => sent.push(args) };
  const options = { logger: { error: (...args) => errors.push(args) } };
  for (let i = 0; i < 20; i++) {
    await safeRoomTask(
      room,
      'spawn',
      client,
      () => {
        throw new DemoDiceLimitError();
      },
      options,
    );
    room.dicePolicy.notify(client, 'cooldown');
  }
  assert.equal(sent.length, 2);
  assert.equal(sent[0][0], 'notice');
  assert.match(sent[0][1].text, /15 dice/);
  assert.equal(errors.length, 0);
  time = 2000;
  room.dicePolicy.notify(client, 'capacity');
  assert.equal(sent.length, 3);
  const disconnected = {
    send() {
      throw new Error('closed');
    },
  };
  await safeRoomTask(
    room,
    'sceneLoad',
    disconnected,
    () => {
      throw new DemoDiceLimitError('restore');
    },
    options,
  );
  assert.equal(errors.length, 1);
});
