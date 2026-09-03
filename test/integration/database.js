import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createDatabase } from '../../server/database.js';

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('TEST_DATABASE_URL is required');
const parsed = new URL(connectionString);
if (!parsed.pathname.slice(1).endsWith('_test')) {
  throw new Error('Integration tests refuse databases whose name does not end in _test');
}

const pool = new pg.Pool({ connectionString });
const database = createDatabase(pool);

before(async () => {
  await pool.query('SELECT 1');
});

after(async () => {
  await database.close();
});

test('application role can use the real schema but cannot create tables', async () => {
  const migrations = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
  assert.equal(migrations.rows.length, 13); // 001–013 (013 = player mats)
  await assert.rejects(
    pool.query('CREATE TABLE integration_forbidden (id integer)'),
    (error) => error.code === '42501',
  );
});

test('users, rooms, membership, and durable state round-trip through PostgreSQL', async () => {
  const owner = await database.createUser({
    username: 'integration-owner',
    email: 'owner@example.test',
    passwordHash: 'test-hash',
  });
  const player = await database.createUser({
    username: 'integration-player',
    email: 'player@example.test',
  });
  const room = await database.createRoom({
    ownerId: owner.id,
    code: 'TESTROOM',
    name: 'Integration Room',
    requireApproval: true,
  });

  assert.equal((await database.findRoomByCode('TESTROOM')).id, room.id);
  assert.equal((await database.getMembership(room.id, owner.id)).role, 'owner');
  assert.equal(
    (await database.joinRoom({ roomId: room.id, userId: player.id, requireApproval: true })).status,
    'pending',
  );
  await database.admitMember(room.id, player.id);
  assert.equal((await database.getMembership(room.id, player.id)).status, 'admitted');

  await database.saveRoomState(room.id, {
    scoreboard: [{ id: 's1', label: 'Points', score: 4 }],
    notes: 'integration note',
    tableX: 12,
    tableZ: 9,
    skybox: '/sky/night.jpg',
    feltColor: '#123456',
    scene: { pieces: [] },
    scale: { worldPerUnit: 2 },
  });
  const state = await database.getRoomState(room.id);
  assert.deepEqual(state.scoreboard, [{ id: 's1', label: 'Points', score: 4 }]);
  assert.equal(state.notes, 'integration note');
  assert.equal(state.tableX, 12);
  assert.equal(state.scale.worldPerUnit, 2);
});

test('library writes, reads, updates, and deletes use real constraints and JSON', async () => {
  const id = await database.insertDeck({
    name: 'Integration Deck',
    back: '/back.jpg',
    fronts: ['/one.jpg', '/two.jpg'],
    isPublic: true,
  });
  const deck = await database.getDeck(id);
  assert.equal(deck.name, 'Integration Deck');
  assert.deepEqual(deck.fronts, ['/one.jpg', '/two.jpg']);
  assert.equal(deck.isPublic, true);

  assert.equal(
    await database.updateDeck(id, 'Updated Deck', '/new-back.jpg', ['/three.jpg']),
    true,
  );
  assert.equal((await database.getDeck(id)).name, 'Updated Deck');
  await database.deleteAsset('deck', id);
  assert.equal(await database.getDeck(id), null);

  // Player mats: image + geom round-trip through custom_mats.
  const matGeom = { w: 5, h: 3, t: 0.06, round: 0.04, shape: 'rect' };
  const matId = await database.insertMat(
    'Integration Mat',
    { tex: '/assets/mats/m.jpg', geom: matGeom },
    { isPublic: true },
  );
  const mat = await database.getMat(matId);
  assert.equal(mat.name, 'Integration Mat');
  assert.equal(mat.tex, '/assets/mats/m.jpg');
  assert.deepEqual(mat.geom, matGeom);
  assert.equal(mat.isPublic, true);
  assert.equal(
    await database.updateMat(matId, 'Updated Mat', {
      tex: '/assets/mats/m2.jpg',
      geom: { ...matGeom, w: 6 },
    }),
    true,
  );
  const updatedMat = await database.getMat(matId);
  assert.equal(updatedMat.name, 'Updated Mat');
  assert.equal(updatedMat.geom.w, 6);
  assert.ok((await database.listMats({ includePrivate: true })).some((m) => m.id === matId));
  await database.deleteAsset('mat', matId);
  assert.equal(await database.getMat(matId), null);
});

test('case-insensitive user uniqueness is enforced by PostgreSQL', async () => {
  await assert.rejects(
    database.createUser({ username: 'INTEGRATION-OWNER', email: 'different@example.test' }),
    (error) => error.conflict === 'username',
  );
});
