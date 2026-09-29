import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoRuntime } from '../server/demo-runtime.js';
import { canUseRoomCapability } from '../server/permissions.js';
import { allowRoomCapability } from '../server/game/interaction-policy.js';

test('demo cleanup revokes before disconnect, waits for writer release and retries retained writers', async () => {
  const events = [];
  const writers = new Map();
  const room = {
    state: { players: new Map([['a', {}]]) },
    broadcast: () => events.push('notice'),
    async disconnect() {
      events.push('disconnect');
    },
  };
  writers.set('1', room);
  const demo = {
    async activeRooms() {
      return ['1'];
    },
    async setOccupied(id, occupied) {
      events.push(['occupied', id, occupied]);
    },
    async closeExpired() {
      events.push('close');
      return [{ roomId: '1' }];
    },
    async purgeClosed(id, { canPurge }) {
      assert.equal(canPurge(id), true);
      events.push('purge');
    },
    async purgeOrphans() {
      events.push('orphans');
    },
  };
  const runtime = createDemoRuntime({
    demo,
    writers,
    roomAccess: {
      dispose() {
        events.push('revoke');
      },
    },
  });
  await runtime.sweep();
  assert.deepEqual(events, [
    ['occupied', '1', true],
    'close',
    'revoke',
    'notice',
    'disconnect',
    'orphans',
  ]);
  writers.delete('1');
  events.length = 0;
  await runtime.sweep();
  assert.deepEqual(events, [['occupied', '1', false], 'close', 'purge', 'orphans']);
});

test('demo cleanup is single-flight and storage errors remain failures', async () => {
  let release;
  let attempts = 0;
  const runtime = createDemoRuntime({
    demo: {
      activeRooms() {
        attempts++;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
      async closeExpired() {
        throw new Error('db offline');
      },
    },
    writers: new Map(),
    roomAccess: {},
  });
  const first = runtime.sweep();
  assert.equal(runtime.sweep(), first);
  assert.equal(attempts, 1);
  release([]);
  await assert.rejects(first, /db offline/);
  const next = runtime.sweep();
  assert.equal(attempts, 2);
  release([]);
  await assert.rejects(next, /db offline/);
});

test('demo authority expires at every capability boundary and library writes are denied', () => {
  const auth = { isDemo: true, demoExpiresAt: Date.now() - 1 };
  for (const capability of [
    'observation',
    'communication',
    'administration',
    'personal',
    'gameplay',
    'cleanup',
  ])
    assert.equal(canUseRoomCapability(auth, capability), false);
  const client = { auth: { ...auth, demoExpiresAt: Date.now() + 60000 }, send() {} };
  assert.equal(allowRoomCapability(client, 'gameplay', 'spawn'), true);
  for (const type of [
    'sceneSave',
    'deckFinish',
    'setAvatar',
    'saveBoard',
    'createCollection',
    'admit',
    'setRole',
  ])
    assert.equal(allowRoomCapability(client, 'administration', type), false);
});
