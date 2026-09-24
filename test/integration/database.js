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
  assert.equal(migrations.rows.length, 20); // Includes durable participation policy.
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
    tableShape: 'hex',
    rimWood: 'walnut',
    skybox: '/sky/night.jpg',
    feltColor: '#123456',
    scene: null, // no saved scene to mask missing room-setting columns
    scale: { worldPerUnit: 2 },
    lighting: {
      preset: 'sunset',
      azimuth: 265,
      elevation: 18,
      keyIntensity: 1.35,
      keyColor: '#ff985f',
      ambientIntensity: 0.5,
      ambientColor: '#866fa8',
      shadowSoftness: 0.72,
    },
  });
  const state = await database.getRoomState(room.id);
  assert.deepEqual(state.scoreboard, [{ id: 's1', label: 'Points', score: 4 }]);
  assert.equal(state.notes, 'integration note');
  assert.equal(state.tableX, 12);
  assert.equal(state.tableZ, 9);
  assert.equal(state.tableShape, 'hex');
  assert.equal(state.rimWood, 'walnut');
  assert.equal(state.scene, null);
  assert.equal(state.scale.worldPerUnit, 2);
  assert.equal(state.lighting.preset, 'sunset');
  assert.equal(state.lighting.keyColor, '#ff985f');
  assert.equal(state.lighting.ambientIntensity, 0.5);
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

test('cleanup references include private mats and snapshots in soft-deleted rooms', async () => {
  const owner = await database.createUser({
    username: 'cleanup-owner',
    email: 'cleanup@example.test',
  });
  const room = await database.createRoom({ ownerId: owner.id, code: 'CLEANUP', name: 'Cleanup' });
  await database.insertMat('Private mat', {
    tex: '/assets/mats/private.jpg',
    geom: { w: 5, h: 3 },
  });
  await pool.query('UPDATE rooms SET scene = $2, skybox = $3, deleted_at = now() WHERE id = $1', [
    room.id,
    JSON.stringify({ hands: [{ cards: [{ front: '/assets/decks/saved-hand.jpg' }] }] }),
    '/assets/sky/saved-sky.jpg',
  ]);
  const references = (await database.allAssetRefBlobs()).join('\n');
  for (const url of [
    '/assets/mats/private.jpg',
    '/assets/decks/saved-hand.jpg',
    '/assets/sky/saved-sky.jpg',
  ]) {
    assert.ok(references.includes(url), `missing reference: ${url}`);
  }
});

test('account purge preserves every asset category and rolls back atomically on failure', async () => {
  const owner = await database.createUser({ username: 'purge-owner', email: 'purge@example.test' });
  const other = await database.createUser({
    username: 'purge-other',
    email: 'purge-other@example.test',
  });
  const ownedRoom = await database.createRoom({
    ownerId: owner.id,
    code: 'PURGEOWN',
    name: 'Owned',
  });
  const otherRoom = await database.createRoom({
    ownerId: other.id,
    code: 'PURGEOTHER',
    name: 'Other',
  });
  await database.joinRoom({ roomId: otherRoom.id, userId: owner.id, requireApproval: false });
  const tables = [
    'custom_decks',
    'custom_boards',
    'custom_objects',
    'custom_scenes',
    'custom_skyboxes',
    'custom_dice',
    'custom_mats',
  ];
  const assets = [];
  for (const table of tables) {
    for (const [userId, isPublic] of [
      [owner.id, false],
      [owner.id, true],
      [other.id, false],
    ]) {
      const fileColumn = [
        'custom_objects',
        'custom_skyboxes',
        'custom_dice',
        'custom_mats',
      ].includes(table);
      const { rows } = await pool.query(
        `INSERT INTO ${table} (owner_id, name, is_public${fileColumn ? ', file_url' : ''})
         VALUES ($1, $2, $3${fileColumn ? ', $4' : ''}) RETURNING *`,
        [userId, 'Retained asset', isPublic, ...(fileColumn ? ['/assets/test/retained.png'] : [])],
      );
      assets.push({ table, row: rows[0] });
    }
  }
  // Fail after the asset releases and owned-room deletion, using a real transaction.
  const failing = createDatabase({
    async connect() {
      const client = await pool.connect();
      return {
        query(sql, params) {
          if (sql.startsWith('DELETE FROM users')) throw new Error('injected purge failure');
          return client.query(sql, params);
        },
        release: () => client.release(),
      };
    },
  });
  await assert.rejects(failing.purgeUser(owner.id), /injected purge failure/);
  for (const { table, row } of assets) {
    const { rows } = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [row.id]);
    assert.deepEqual(rows[0], row);
  }
  assert.ok(await database.findUserById(owner.id));
  assert.ok(await database.findRoomByCode('PURGEOWN'));
  assert.ok(await database.getMembership(otherRoom.id, owner.id));

  await database.purgeUser(owner.id);
  assert.equal(await database.findUserById(owner.id), null);
  assert.equal(await database.findRoomByCode('PURGEOWN'), null);
  assert.equal(await database.getMembership(otherRoom.id, owner.id), null);
  assert.ok(await database.findRoomByCode('PURGEOTHER'));
  assert.ok(await database.findUserById(other.id));
  assert.equal(
    (await pool.query('SELECT * FROM room_members WHERE room_id = $1', [ownedRoom.id])).rowCount,
    0,
  );
  for (const { table, row } of assets) {
    const { rows } = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [row.id]);
    assert.deepEqual(rows[0], {
      ...row,
      owner_id: row.owner_id === owner.id ? null : row.owner_id,
    });
  }
});

test('collider collections persist with owner/admin writes and scoped private reads', async () => {
  const owner = await database.createUser({
    username: 'collider-owner',
    email: 'collider-owner@example.test',
  });
  const other = await database.createUser({
    username: 'collider-other',
    email: 'collider-other@example.test',
  });
  const admin = { ...other, isAdmin: true };
  const layout = {
    version: 1,
    shapes: [
      {
        type: 'outline',
        outline: { type: 'hexagon' },
        position: [0, 0, 0],
        size: [1, 0.1, 1],
        rotation: [0, 0, 0],
      },
    ],
  };
  const value = { name: 'Hexagon', layout, size: 5, isPublic: false };
  const queries = database.colliderPresets;
  const created = await queries.save(owner, null, value);
  assert.equal(created.ownerId, owner.id);
  assert.equal(created.canEdit, true);
  assert.deepEqual((await queries.get(owner, created.id)).layout, layout);
  assert.equal(await queries.get(other, created.id), undefined);
  assert.ok(!(await queries.list(other)).presets.some((r) => r.id === created.id));
  assert.equal((await queries.get(admin, created.id)).canEdit, true);
  assert.equal(await queries.save(other, created.id, { ...value, isPublic: true }), undefined);
  assert.equal(await queries.remove(other, created.id), false);
  await queries.save(owner, created.id, { ...value, isPublic: true });
  const copy = structuredClone((await queries.get(other, created.id)).layout);
  assert.equal((await queries.get(other, created.id)).canEdit, false);
  assert.ok((await queries.list(other)).presets.some((r) => r.id === created.id));
  await queries.save(admin, created.id, { ...value, name: 'Renamed' });
  assert.equal(await queries.get(other, created.id), undefined);
  assert.equal((await queries.get(owner, created.id)).name, 'Renamed');
  assert.equal(await queries.remove(admin, created.id), true);
  assert.equal(await queries.get(owner, created.id), undefined);
  assert.deepEqual(copy, layout);
  const retained = await queries.save(owner, null, { ...value, isPublic: true });
  await database.purgeUser(owner.id);
  assert.equal((await queries.get(admin, retained.id)).ownerId, null);
  assert.deepEqual((await queries.get(other, retained.id)).layout, layout);
});

test('durable time-outs preserve hierarchy, survive a fresh database facade and cascade on membership removal', async () => {
  const owner = await database.createUser({
    username: 'timeout-owner',
    email: 'timeout-owner@example.test',
  });
  const gm = await database.createUser({
    username: 'timeout-gm',
    email: 'timeout-gm@example.test',
  });
  const player = await database.createUser({
    username: 'timeout-player',
    email: 'timeout-player@example.test',
  });
  const room = await database.createRoom({
    ownerId: owner.id,
    code: 'TIMEOUT',
    name: 'Timeout tests',
    requireApproval: false,
  });
  for (const userId of [gm.id, player.id])
    await database.joinRoom({ roomId: room.id, userId, requireApproval: false });
  await database.setMemberRole(room.id, gm.id, 'gm');
  const request = { roomId: room.id, actorId: gm.id, userId: player.id, timedOut: true };
  assert.equal((await database.setPlayerTimeout(request, () => true)).timedOut, true);
  assert.equal((await createDatabase(pool).getMembership(room.id, player.id)).timedOut, true);
  assert.equal(
    (await database.listMembers(room.id)).find((m) => m.userId === player.id).timedOut,
    true,
  );
  assert.equal(await database.setPlayerTimeout({ ...request, userId: owner.id }, () => true), null);
  assert.equal(await database.setPlayerTimeout({ ...request, userId: gm.id }, () => true), null);
  assert.equal(
    (await database.setPlayerTimeout({ ...request, actorId: owner.id, userId: gm.id }, () => true))
      .timedOut,
    true,
  );
  assert.equal(await database.setPlayerTimeout({ ...request, timedOut: false }, () => false), null);
  assert.equal((await database.getMembership(room.id, player.id)).timedOut, true);
  const self = { roomId: room.id, userId: player.id, participation: 'spectator' };
  const spectating = await database.setSelfParticipation(self, () => true);
  assert.equal(spectating.participation, 'spectator');
  assert.equal(spectating.timedOut, true);
  assert.equal(
    (await createDatabase(pool).getMembership(room.id, player.id)).participation,
    'spectator',
  );
  assert.equal(
    (await database.listMembers(room.id)).find((m) => m.userId === player.id).participation,
    'spectator',
  );
  const playing = await database.setSelfParticipation(
    { ...self, participation: 'player' },
    () => true,
  );
  assert.equal(playing.timedOut, true, 'self-service must never lift time-out');
  assert.equal(await database.setSelfParticipation(self, () => false), null);
  assert.equal((await database.getMembership(room.id, player.id)).participation, 'player');
  await database.kickMember(room.id, player.id);
  assert.equal(
    (
      await pool.query('SELECT * FROM room_participation WHERE room_id=$1 AND user_id=$2', [
        room.id,
        player.id,
      ])
    ).rowCount,
    0,
  );
  await database.joinRoom({ roomId: room.id, userId: player.id, requireApproval: false });
  assert.equal((await database.getMembership(room.id, player.id)).timedOut, false);
  assert.equal((await database.getMembership(room.id, player.id)).participation, 'player');
});

test('spectator policy cannot bypass admission; site admins can save their own room preference', async () => {
  const owner = await database.createUser({
    username: 'spectator-owner',
    email: 'spectator-owner@example.test',
  });
  const pending = await database.createUser({
    username: 'spectator-pending',
    email: 'spectator-pending@example.test',
  });
  const admin = await database.createUser({
    username: 'spectator-admin',
    email: 'spectator-admin@example.test',
  });
  await pool.query('UPDATE users SET is_admin=true WHERE id=$1', [admin.id]);
  const room = await database.createRoom({
    ownerId: owner.id,
    code: 'SPECTATE',
    name: 'Spectators',
    requireApproval: true,
  });
  await database.joinRoom({ roomId: room.id, userId: pending.id, requireApproval: true });
  assert.equal(
    await database.setSelfParticipation(
      { roomId: room.id, userId: pending.id, participation: 'spectator' },
      () => true,
    ),
    null,
  );
  const policy = await database.setSelfParticipation(
    { roomId: room.id, userId: admin.id, participation: 'spectator' },
    () => true,
  );
  assert.equal(policy.participation, 'spectator');
  assert.equal((await database.getMembership(room.id, admin.id)).status, 'admitted');
  await assert.rejects(
    database.setSelfParticipation(
      { roomId: room.id, userId: admin.id, participation: 'owner' },
      () => true,
    ),
    (error) => error.code === '23514',
  );
  assert.equal((await database.getMembership(room.id, admin.id)).participation, 'spectator');
});

test('collections persist mixed typed assets, filter private data, and preserve assets on deletion', async () => {
  const q = database.collections;
  const options = { authorize: () => true };
  const targets = [
    [
      'deck',
      await database.insertDeck({
        name: 'Collection Deck',
        back: 'back',
        fronts: ['front'],
        isPublic: true,
      }),
    ],
    ['board', await database.insertBoard('Collection Board', { w: 8, d: 8 }, { isPublic: true })],
    ['mat', await database.insertMat('Collection Mat', { tex: '/mat.jpg' }, { isPublic: true })],
    [
      'prop',
      await database.insertProp('Collection Prop', { model: '/prop.glb' }, { isPublic: true }),
    ],
    [
      'scene',
      await database.insertScene({ name: 'Collection Scene', payload: {}, isPublic: true }),
    ],
    [
      'sky',
      await database.insertSkybox({ name: 'Collection Sky', url: '/sky.jpg', isPublic: true }),
    ],
    [
      'dice',
      await database.insertDice({ name: 'Collection Dice', url: '/dice.jpg', isPublic: true }),
    ],
  ];
  const privateId = await database.insertDeck({
    name: 'Hidden deck',
    fronts: ['secret'],
    back: 'back',
  });
  let group = await q.mutate('create', { name: 'Mixed game', isPublic: true }, options);
  const items = [...targets.map(([kind, id]) => ({ kind, id })), { kind: 'deck', id: privateId }];
  group = await q.mutate('update', { ...group, items }, options);
  const admin = (await q.list({ includePrivate: true })).collections.find(
    (value) => value.id === group.id,
  );
  assert.equal(admin.items.length, 8);
  const player = (await q.list()).collections.find((value) => value.id === group.id);
  assert.equal(player.items.length, 7);
  assert.equal(
    player.items.some((item) => item.kind === 'deck' && item.id === privateId),
    false,
  );
  await assert.rejects(
    q.mutate('update', { ...group, revision: 1, items: [] }, options),
    /changed/,
  );
  assert.equal(
    (await q.list({ includePrivate: true })).collections.find((value) => value.id === group.id)
      .items.length,
    8,
  );
  await database.deleteAsset('deck', targets[0][1]);
  assert.equal(
    (await q.list({ includePrivate: true })).collections.find((value) => value.id === group.id)
      .items.length,
    7,
  );
  await q.mutate('delete', { id: group.id, revision: group.revision }, options);
  assert.ok(await database.getDeck(privateId));
  assert.equal(
    (
      await pool.query(
        'SELECT count(*)::int AS count FROM asset_collection_items WHERE collection_id=$1',
        [group.id],
      )
    ).rows[0].count,
    0,
  );
});

test('collection writes roll back on invalid assets, revoked access, and competing revisions', async () => {
  const q = database.collections,
    options = { authorize: () => true };
  let group = await q.mutate('create', { name: 'Transactional', isPublic: false }, options);
  const deck = await database.insertDeck({ name: 'Keep', back: 'back', fronts: ['front'] });
  group = await q.mutate('update', { ...group, items: [{ kind: 'deck', id: deck }] }, options);
  await assert.rejects(
    q.mutate(
      'update',
      { ...group, name: 'Lost', items: [{ kind: 'board', id: '9223372036854775807' }] },
      options,
    ),
    /removed/,
  );
  assert.equal(
    (await q.list({ includePrivate: true })).collections.find((value) => value.id === group.id)
      .name,
    'Transactional',
  );
  let checks = 0;
  await assert.rejects(
    q.mutate('update', { ...group, name: 'Revoked', items: [] }, { authorize: () => ++checks < 3 }),
    /unavailable/,
  );
  let saved = (await q.list({ includePrivate: true })).collections.find(
    (value) => value.id === group.id,
  );
  assert.equal(saved.name, 'Transactional');
  assert.equal(saved.items.length, 1);
  assert.equal(saved.revision, group.revision);
  const competing = await Promise.allSettled(
    ['First', 'Second'].map((name) => q.mutate('update', { ...group, name, items: [] }, options)),
  );
  assert.equal(competing.filter((value) => value.status === 'fulfilled').length, 1);
  assert.equal(competing.filter((value) => value.status === 'rejected').length, 1);
  saved = (await q.list({ includePrivate: true })).collections.find(
    (value) => value.id === group.id,
  );
  assert.equal(
    (await q.list()).collections.some((value) => value.id === group.id),
    false,
  );
  await q.mutate('delete', { id: saved.id, revision: saved.revision }, options);
});

test('collection foreign keys enforce typed existence, including direct application-role writes', async () => {
  const group = await database.collections.mutate(
    'create',
    { name: 'FK test', isPublic: false },
    { authorize: () => true },
  );
  await assert.rejects(
    pool.query(
      "INSERT INTO asset_collection_items(collection_id,kind,asset_id) VALUES ($1,'deck',9223372036854775807)",
      [group.id],
    ),
    (error) => error.code === '23503',
  );
  await assert.rejects(
    pool.query(
      "INSERT INTO asset_collection_items(collection_id,kind,asset_id) VALUES ($1,'invalid',1)",
      [group.id],
    ),
    (error) => error.code === '23514',
  );
  await database.collections.mutate(
    'delete',
    { id: group.id, revision: group.revision },
    { authorize: () => true },
  );
});

test('collection pagination and capacity limits are bounded without losing existing rows', async () => {
  const q = database.collections,
    options = { authorize: () => true };
  await assert.rejects(q.mutate('create', { name: 'Denied', isPublic: true }), /unavailable/);
  const created = [];
  try {
    for (let i = 0; i < 64; i++)
      created.push(
        await q.mutate('create', { name: `Paged ${i}`, isPublic: i % 2 === 0 }, options),
      );
    await assert.rejects(
      q.mutate('create', { name: 'Too many', isPublic: true }, options),
      /64 collections/,
    );
    await assert.rejects(
      database.importAssetPackage(
        'collection',
        {
          name: 'Over capacity',
          assets: [
            {
              kind: 'dice',
              data: { name: 'Must not survive capacity failure', url: '/assets/dice/capacity.png' },
            },
          ],
        },
        async () => true,
      ),
      /64 collections/,
    );
    assert.equal(
      (
        await pool.query('SELECT id FROM custom_dice WHERE name=$1', [
          'Must not survive capacity failure',
        ])
      ).rowCount,
      0,
    );
    const read = async (includePrivate) => {
      const results = [];
      let after = '0';
      do {
        const page = await q.list({ includePrivate, after });
        assert.ok(page.collections.length <= 16);
        results.push(...page.collections);
        after = page.next;
      } while (after);
      return results;
    };
    assert.equal((await read(true)).length, 64);
    assert.equal((await read(false)).length, 32);
  } finally {
    for (const group of created)
      await q.mutate('delete', { id: group.id, revision: group.revision }, options);
  }
});

test('portable dice imports create private copies and roll back a revoked admin', async () => {
  const owner = await database.createUser({
    username: 'package-admin',
    email: 'package@example.test',
    passwordHash: 'test',
  });
  const value = {
    name: 'Imported texture',
    url: '/assets/dice/package.png',
    ownerId: owner.id,
    isPublic: true,
  };
  const id = await database.importAssetPackage('dice', value, async () => true);
  const copy = await database.getDice(id);
  assert.equal(copy.isPublic, false);
  assert.equal(String(copy.ownerId), String(owner.id));
  let checks = 0;
  await assert.rejects(
    database.importAssetPackage(
      'dice',
      { ...value, name: 'Must roll back' },
      async () => ++checks < 2,
    ),
    /Admin access/,
  );
  const result = await pool.query('SELECT id FROM custom_dice WHERE name=$1', ['Must roll back']);
  assert.equal(result.rowCount, 0);
  await pool.query('DELETE FROM custom_dice WHERE id=$1', [id]);
});

test('portable decks preserve paired faces and appearance in a private transactional copy', async () => {
  const owner = await database.createUser({
    username: 'deck-package-admin',
    email: 'deck-package@example.test',
    passwordHash: 'test',
  });
  const value = {
    name: 'Imported tiles',
    back: '/assets/decks/back.png',
    fronts: [
      'text:First',
      { front: '/assets/decks/front.png', back: 'text:Second back' },
      'text:First',
    ],
    geom: { w: 0.5, h: 0.8, t: 0.1, round: 0.05, shape: 'hex' },
    open: true,
    deckModel: 'bag',
    color: '#112233',
    textColor: '#abcdef',
    ownerId: owner.id,
    isPublic: true,
  };
  const id = await database.importAssetPackage('deck', value, async () => true);
  const saved = await database.getDeck(id);
  assert.equal(saved.isPublic, false);
  assert.equal(String(saved.ownerId), String(owner.id));
  for (const key of ['back', 'fronts', 'geom', 'open', 'deckModel', 'color', 'textColor'])
    assert.deepEqual(saved[key], value[key]);
  let checks = 0;
  await assert.rejects(
    database.importAssetPackage(
      'deck',
      { ...value, name: 'Deck rollback' },
      async () => ++checks < 2,
    ),
    /Admin access/,
  );
  assert.equal(
    (await pool.query('SELECT id FROM custom_decks WHERE name=$1', ['Deck rollback'])).rowCount,
    0,
  );
  await pool.query('DELETE FROM custom_decks WHERE id=$1', [id]);
});

test('collection imports create all private members atomically and export a consistent supported snapshot', async () => {
  const owner = await database.createUser({
    username: 'collection-package-admin',
    email: 'collection-package@example.test',
    passwordHash: 'test',
  });
  const value = {
    name: 'Imported game',
    ownerId: owner.id,
    assets: [
      {
        kind: 'dice',
        data: { name: 'Collection die', url: '/assets/dice/import.png', isPublic: true },
      },
      {
        kind: 'deck',
        data: {
          name: 'Collection deck',
          back: 'back',
          fronts: ['text:A', { front: 'text:B', back: 'text:C' }],
          open: true,
          isPublic: true,
        },
      },
    ],
  };
  const id = await database.importAssetPackage('collection', value, async () => true);
  try {
    const group = (await pool.query('SELECT * FROM asset_collections WHERE id=$1', [id])).rows[0];
    assert.equal(group.is_public, false);
    assert.equal(String(group.owner_id), String(owner.id));
    const items = (
      await pool.query(
        'SELECT kind,asset_id::text AS id FROM asset_collection_items WHERE collection_id=$1 ORDER BY kind',
        [id],
      )
    ).rows;
    assert.equal(items.length, 2);
    for (const item of items) {
      const asset = await (item.kind === 'dice'
        ? database.getDice(item.id)
        : database.getDeck(item.id));
      assert.equal(asset.isPublic, false);
      assert.equal(String(asset.ownerId), String(owner.id));
    }
    assert.ok(!(await database.collections.list()).collections.some((group) => group.id === id));
    const snapshot = await database.getCollectionForPackage(id);
    assert.equal(snapshot.name, 'Imported game');
    assert.equal(snapshot.assets.length, 2);
    assert.deepEqual(
      snapshot.assets.find((item) => item.kind === 'deck').asset.fronts,
      value.assets[1].data.fronts,
    );
    const before = (
      await pool.query(
        'SELECT (SELECT count(*) FROM custom_dice)::int AS dice,(SELECT count(*) FROM custom_decks)::int AS decks',
      )
    ).rows[0];
    let checks = 0;
    await assert.rejects(
      database.importAssetPackage(
        'collection',
        { ...value, name: 'Revoked import' },
        async () => ++checks < 2,
      ),
      /Admin access/,
    );
    assert.deepEqual(
      (
        await pool.query(
          'SELECT (SELECT count(*) FROM custom_dice)::int AS dice,(SELECT count(*) FROM custom_decks)::int AS decks',
        )
      ).rows[0],
      before,
    );
    assert.equal(
      (await pool.query('SELECT id FROM asset_collections WHERE name=$1', ['Revoked import']))
        .rowCount,
      0,
    );
    await assert.rejects(
      database.importAssetPackage(
        'collection',
        { ...value, assets: [...value.assets, { kind: 'board', data: { name: 'unsupported' } }] },
        async () => true,
      ),
      /Unsupported/,
    );
    assert.deepEqual(
      (
        await pool.query(
          'SELECT (SELECT count(*) FROM custom_dice)::int AS dice,(SELECT count(*) FROM custom_decks)::int AS decks',
        )
      ).rows[0],
      before,
    );
    const board = await database.insertBoard('Unsupported board', { w: 4, d: 4 });
    await pool.query(
      "INSERT INTO asset_collection_items(collection_id,kind,asset_id) VALUES ($1,'board',$2)",
      [id, board],
    );
    await assert.rejects(database.getCollectionForPackage(id), /unsupported asset types: board/);
    await database.deleteAsset('board', board);
    for (const item of items) await database.deleteAsset(item.kind, item.id);
  } finally {
    await pool.query('DELETE FROM asset_collections WHERE id=$1', [id]);
  }
});

test('collection export membership and metadata use the same repeatable-read snapshot', async () => {
  const first = await database.insertDeck({
    name: 'Snapshot first',
    back: 'back',
    fronts: ['text:First'],
  });
  const second = await database.insertDeck({
    name: 'Snapshot second',
    back: 'back',
    fronts: ['text:Second'],
  });
  let group = await database.collections.mutate(
    'create',
    { name: 'Snapshot group', isPublic: false },
    { authorize: () => true },
  );
  group = await database.collections.mutate(
    'update',
    {
      ...group,
      items: [
        { kind: 'deck', id: first },
        { kind: 'deck', id: second },
      ],
    },
    { authorize: () => true },
  );
  let edited = false;
  const reads = createDatabase({
    query: pool.query.bind(pool),
    connect: async () => {
      const client = await pool.connect();
      return {
        release: (value) => client.release(value),
        query: async (sql, args) => {
          const result = await client.query(sql, args);
          if (sql.includes('FROM custom_decks WHERE id') && !edited) {
            edited = true;
            await pool.query('UPDATE custom_decks SET name=$1 WHERE id=$2', [
              'Changed after snapshot',
              second,
            ]);
          }
          return result;
        },
      };
    },
  });
  try {
    const snapshot = await reads.getCollectionForPackage(group.id);
    assert.equal(edited, true);
    assert.deepEqual(
      snapshot.assets.map((item) => item.asset.name),
      ['Snapshot first', 'Snapshot second'],
    );
    assert.equal((await database.getDeck(second)).name, 'Changed after snapshot');
  } finally {
    await pool.query('DELETE FROM asset_collections WHERE id=$1', [group.id]);
    await database.deleteAsset('deck', first);
    await database.deleteAsset('deck', second);
  }
});
