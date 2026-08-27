import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoomQueries, DEFAULT_ROOM_STATE } from '../server/room-queries.js';

test('successful absent room and membership reads retain their domain results', async () => {
  const rooms = createRoomQueries(async () => ({ rows: [] }));
  assert.equal(await rooms.findRoomByCode('NONE'), null);
  assert.equal(await rooms.getRoom('1'), null);
  assert.deepEqual(await rooms.listRoomsForUser('1'), []);
  assert.deepEqual(await rooms.listRoomsForAdmin('1'), []);
  assert.deepEqual(await rooms.listRooms(), []);
  assert.deepEqual(await rooms.getRoomState('1'), DEFAULT_ROOM_STATE);
  assert.equal(await rooms.getMembership('1', '2'), null);
  assert.deepEqual(await rooms.listMembers('1'), []);
});

test('room, state, join, and membership outages reject instead of returning fallback data', async () => {
  const outage = new Error('database unavailable');
  const rooms = createRoomQueries(async () => {
    throw outage;
  });
  for (const read of [
    () => rooms.findRoomByCode('CODE'),
    () => rooms.getRoom('1'),
    () => rooms.listRoomsForUser('1'),
    () => rooms.listRoomsForAdmin('1'),
    () => rooms.listRooms(),
    () => rooms.getRoomState('1'),
    () => rooms.joinRoom({ roomId: '1', userId: '2', requireApproval: true }),
    () => rooms.getMembership('1', '2'),
    () => rooms.listMembers('1'),
  ])
    await assert.rejects(read, (error) => error === outage);
});

test('an idempotent join performs membership lookup only after a successful empty insert', async () => {
  const calls = [];
  const rooms = createRoomQueries(async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith('INSERT')) return { rows: [] };
    return { rows: [{ room_id: 1, user_id: 2, role: 'player', status: 'admitted' }] };
  });
  assert.deepEqual(await rooms.joinRoom({ roomId: '1', userId: '2', requireApproval: true }), {
    roomId: '1',
    userId: '2',
    role: 'player',
    status: 'admitted',
  });
  assert.equal(calls.length, 2);
});

test('stored room state is shaped only after a successful query', async () => {
  const rooms = createRoomQueries(async () => ({
    rows: [
      {
        scoreboard: [{ id: 's1', label: 'A', score: 2 }],
        notes: 'note',
        table_x: '12',
        table_z: '8',
        skybox: '/sky.jpg',
        felt_color: '#123456',
        scene: { pieces: [] },
        scale: { worldPerUnit: 2 },
      },
    ],
  }));
  const state = await rooms.getRoomState('1');
  assert.equal(state.tableX, 12);
  assert.equal(state.tableZ, 8);
  assert.equal(state.notes, 'note');
  assert.deepEqual(state.scoreboard, [{ id: 's1', label: 'A', score: 2 }]);
});
