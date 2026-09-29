import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRoomResourceLimits } from '../server/room-resource-limits.js';

test('resource limits are disabled by default and parse explicit operator budgets', () => {
  assert.ok(Object.values(readRoomResourceLimits({})).every((value) => value === Infinity));
  assert.deepEqual(
    readRoomResourceLimits({
      ROOM_MAX_LIVE: '5',
      ROOM_MAX_CONNECTIONS: '20',
      ROOM_MAX_CONNECTIONS_PER_USER: ' 2 ',
      ROOM_MAX_PENDING_AUTH: '16',
      ROOM_MAX_MESSAGES_PER_SECOND: '120',
    }),
    {
      maxLiveRooms: 5,
      maxConnections: 20,
      maxConnectionsPerUser: 2,
      maxPendingAuth: 16,
      maxMessagesPerSecond: 120,
    },
  );
  assert.equal(readRoomResourceLimits({ ROOM_MAX_LIVE: '0' }).maxLiveRooms, Infinity);
});

test('invalid resource configuration fails startup rather than silently removing protection', () => {
  for (const name of [
    'ROOM_MAX_LIVE',
    'ROOM_MAX_CONNECTIONS',
    'ROOM_MAX_CONNECTIONS_PER_USER',
    'ROOM_MAX_PENDING_AUTH',
    'ROOM_MAX_MESSAGES_PER_SECOND',
  ]) {
    for (const value of ['', ' ', '-1', '1.5', 'Infinity', 'NaN', '5rooms', '9007199254740992']) {
      assert.throws(() => readRoomResourceLimits({ [name]: value }), new RegExp(name));
    }
  }
});
