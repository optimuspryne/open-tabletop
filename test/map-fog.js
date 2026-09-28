import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAP_FOG,
  emptyFog,
  parseFog,
  normalizeFog,
  decodeFogMask,
  encodeFogMask,
  paintFog,
  normalizeFogStroke,
  fogBoardSize,
} from '../shared/map-fog.js';
import { registerMapFog } from '../server/game/map-fog.js';
import { State, Piece } from '../server/game/schema.js';
import { serializeScene, applyScene } from '../server/game/scene-persistence.js';
import { RANK } from '../server/permissions.js';
import {
  FOG_AURA,
  canHaveFogAura,
  normalizeFogAura,
  parseFogAura,
  fogAuraPoint,
} from '../shared/fog-auras.js';

const size = { w: 12, d: 6 };
function covered(mask, x, z) {
  const n = MAP_FOG.resolution,
    bit = Math.floor((z / size.d + 0.5) * n) * n + Math.floor((x / size.w + 0.5) * n);
  return !!(mask[bit >> 3] & (1 << (bit & 7)));
}
function fixture() {
  const handlers = new Map(),
    sent = [];
  let time = 0,
    saves = 0;
  const room = {
    state: new State(),
    rank: (client) => RANK[client.auth.role],
    onMessage: (type, handler) => handlers.set(type, handler),
    scheduleSave: () => saves++,
    pendingInspect: new Map(),
    scaleSnapshot: () => ({}),
    buildBounds() {},
    applyScale() {},
    applyTrays() {},
    clearTable() {
      this.state.pieces.clear();
    },
    swapBoard(props, hidden) {
      const piece = new Piece();
      piece.type = 'board';
      piece.props = JSON.stringify(props);
      piece.hidden = hidden;
      this.state.pieces.set('2', piece);
      return '2';
    },
    spawn(type, position, props, q, hidden) {
      const id = String(this.state.pieces.size + 10),
        piece = new Piece();
      Object.assign(piece, {
        type,
        props: JSON.stringify(props),
        x: position[0],
        y: position[1],
        z: position[2],
        qx: q?.[0] || 0,
        qy: q?.[1] || 0,
        qz: q?.[2] || 0,
        qw: q?.[3] ?? 1,
        hidden,
      });
      this.state.pieces.set(id, piece);
      return id;
    },
  };
  const piece = new Piece();
  Object.assign(piece, {
    type: 'board',
    props: JSON.stringify({ ...size, tex: '/map.png' }),
    x: 0,
    y: 0.05,
    z: 0,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
  });
  room.state.pieces.set('1', piece);
  const client = { sessionId: 'gm', auth: { role: 'gm' }, send: (...args) => sent.push(args) };
  const service = registerMapFog(room, { now: () => time });
  const edit = async (data) => {
    time += 100;
    await handlers.get('fogEdit')(client, {
      id: '1',
      revision: parseFog(piece.fog)?.revision ?? 0,
      ...data,
    });
  };
  return {
    room,
    piece,
    client,
    sent,
    edit,
    get saves() {
      return saves;
    },
    handlers,
    tick(ms = FOG_AURA.interval) {
      time += ms;
      service.updateAuras();
    },
  };
}
test('fog mask round trips and paints circular capsules on a non-square board', () => {
  const fog = emptyFog(),
    mask = decodeFogMask(fog.mask);
  assert.equal(encodeFogMask(mask), fog.mask);
  assert.equal(
    paintFog(
      mask,
      {
        mode: 'reveal',
        radius: 1,
        points: [
          [-3, 0],
          [3, 0],
        ],
      },
      size,
    ),
    true,
  );
  assert.equal(covered(mask, 0, 0), false);
  assert.equal(covered(mask, -3, 0.9), false);
  assert.equal(covered(mask, 0, 1.2), true);
  paintFog(mask, { mode: 'cover', radius: 0.3, points: [[0, 0]] }, size);
  assert.equal(covered(mask, 0, 0), true);
  assert.equal(covered(mask, 0.7, 0), false);
  assert.equal(mask.length, MAP_FOG.resolution ** 2 / 8);
  assert.deepEqual(parseFog(JSON.stringify(fog)), fog);
});
test('fog rejects corrupt masks, unbounded coordinates, invalid radii and unsupported surfaces', () => {
  const fog = emptyFog();
  for (const value of [
    { ...fog, v: 2 },
    { ...fog, enabled: 1 },
    { ...fog, revision: -1 },
    { ...fog, mask: 'invalid' },
    null,
  ])
    assert.equal(normalizeFog(value), null);
  assert.equal(parseFog('{'), null);
  const valid = { mode: 'reveal', radius: 1, points: [[0, 0]] };
  assert.ok(normalizeFogStroke(valid, size));
  for (const value of [
    { ...valid, points: [[NaN, 0]] },
    { ...valid, points: [[7, 0]] },
    { ...valid, radius: Infinity },
    { ...valid, radius: 0 },
    { ...valid, points: Array(257).fill([0, 0]) },
  ])
    assert.equal(normalizeFogStroke(value, size), null);
  assert.deepEqual(fogBoardSize('board', { ...size, tex: 'x' }), size);
  assert.deepEqual(fogBoardSize('board', { model: '/terrain.glb', box: [6, 2, 3] }), size);
  assert.equal(fogBoardSize('board', { model: 'x', box: [1] }), null);
  assert.equal(fogBoardSize('board', { w: Infinity }), null);
  assert.equal(fogBoardSize('mat', { tex: 'x' }), null);
});
test('real fog request path enforces active GM access before mutation', async () => {
  const f = fixture();
  for (const auth of [
    { role: 'player' },
    { role: 'helper' },
    { role: 'gm', timedOut: true },
    { role: 'gm', participation: 'spectator' },
    { role: 'gm', revoked: true },
  ]) {
    f.client.auth = auth;
    await f.edit({ action: 'enable', enabled: true });
    assert.equal(f.piece.fog, undefined);
  }
  f.client.auth = { role: 'owner' };
  await f.edit({ action: 'enable', enabled: true });
  assert.equal(parseFog(f.piece.fog).enabled, true);
  assert.equal(f.saves, 1);
});
test('fog edits persist, undo whole strokes and reject concurrent stale revisions', async () => {
  const f = fixture();
  await f.edit({ action: 'enable', enabled: true });
  await f.edit({
    action: 'stroke',
    mode: 'reveal',
    radius: 1,
    points: [
      [-3, 0],
      [3, 0],
    ],
  });
  const explored = parseFog(f.piece.fog);
  await f.edit({ action: 'all', mode: 'cover', revision: 0 });
  assert.deepEqual(parseFog(f.piece.fog), explored);
  await f.edit({ action: 'enable', enabled: false });
  assert.equal(parseFog(f.piece.fog).mask, explored.mask);
  await f.edit({ action: 'undo' });
  assert.equal(parseFog(f.piece.fog).enabled, true);
  await f.edit({ action: 'undo' });
  assert.equal(parseFog(f.piece.fog).mask, emptyFog().mask);
  assert.equal(parseFog(f.piece.fog).revision, 5);
  await f.edit({ action: 'undo' });
  assert.equal(parseFog(f.piece.fog).enabled, false);
  const saved = f.piece.fog;
  await f.edit({ action: 'undo' });
  assert.equal(f.piece.fog, saved);
});
test('fog undo is bounded and rate limiting prevents repeated work', async () => {
  const f = fixture();
  await f.edit({ action: 'enable', enabled: true });
  const before = f.piece.fog;
  await f.handlers.get('fogEdit')(f.client, {
    id: '1',
    revision: 1,
    action: 'all',
    mode: 'reveal',
  });
  assert.equal(f.piece.fog, before);
  for (let i = 0; i < 30; i++) await f.edit({ action: 'all', mode: i % 2 ? 'cover' : 'reveal' });
  for (let i = 0; i < MAP_FOG.undoDepth; i++) await f.edit({ action: 'undo' });
  const oldest = f.piece.fog;
  await f.edit({ action: 'undo' });
  assert.equal(f.piece.fog, oldest);
});
test('scene save/load retains fog on the replacement board; malformed fog leaves the old table intact', async () => {
  const f = fixture();
  await f.edit({ action: 'enable', enabled: true });
  await f.edit({ action: 'stroke', mode: 'reveal', radius: 1, points: [[0, 0]] });
  f.piece.hidden = true;
  const saved = serializeScene(f.room),
    opts = {
      maxPieces: 100,
      tableLimits: { minX: 1, maxX: 100, minZ: 1, maxZ: 100 },
      overlayKinds: new Set(),
      overlayMax: 100,
    };
  assert.equal(saved.pieces[0].fog.mask, parseFog(f.piece.fog).mask);
  assert.throws(
    () => applyScene(f.room, { ...saved, pieces: [{ ...saved.pieces[0], fog: { v: 999 } }] }, opts),
    /invalid map fog/,
  );
  assert.equal(f.room.state.pieces.get('1'), f.piece);
  applyScene(f.room, saved, opts);
  const restored = f.room.state.pieces.get('2');
  assert.deepEqual(parseFog(restored.fog), saved.pieces[0].fog);
  assert.equal(restored.hidden, true);
  delete saved.pieces[0].fog;
  applyScene(f.room, saved, opts);
  assert.equal(f.room.state.pieces.get('2').fog, undefined);
});

test('fog thickness is bounded, backward compatible, undoable and preserves exploration on 3D boards', async () => {
  const legacy = emptyFog();
  delete legacy.thickness;
  assert.equal(normalizeFog(legacy).thickness, 0);
  const raisedSheet = normalizeFog({ ...legacy, height: 3 });
  assert.equal(raisedSheet.thickness, 3);
  assert.equal(raisedSheet.mask, legacy.mask);
  assert.equal('height' in raisedSheet, false);
  assert.equal(normalizeFog({ ...legacy, height: -1 }), null);
  for (const thickness of [-1, NaN, Infinity, null, '2', MAP_FOG.maxThickness + 1])
    assert.equal(normalizeFog({ ...legacy, thickness }), null);
  const f = fixture();
  f.piece.props = JSON.stringify({ model: '/terrain.glb', box: [6, 2, 3] });
  await f.edit({ action: 'enable', enabled: true });
  await f.edit({ action: 'stroke', mode: 'reveal', radius: 1, points: [[0, 0]] });
  const explored = parseFog(f.piece.fog);
  await f.edit({ action: 'thickness', thickness: 4 });
  assert.equal(parseFog(f.piece.fog).thickness, 4);
  assert.equal(parseFog(f.piece.fog).mask, explored.mask);
  const raised = f.piece.fog,
    saves = f.saves;
  for (const thickness of [-1, Infinity, '2', MAP_FOG.maxThickness + 1])
    await f.edit({ action: 'thickness', thickness });
  await f.edit({ action: 'thickness', thickness: 1, revision: 0 });
  f.client.auth = { role: 'player' };
  await f.edit({ action: 'thickness', thickness: 1 });
  assert.equal(f.piece.fog, raised);
  assert.equal(f.saves, saves);
  f.client.auth = { role: 'gm' };
  await f.edit({ action: 'undo' });
  assert.equal(parseFog(f.piece.fog).thickness, 0);
  assert.equal(parseFog(f.piece.fog).mask, explored.mask);
  await f.edit({ action: 'thickness', thickness: MAP_FOG.maxThickness });
  const saved = serializeScene(f.room);
  applyScene(f.room, saved, {
    maxPieces: 100,
    tableLimits: { minX: 1, maxX: 100, minZ: 1, maxZ: 100 },
    overlayKinds: new Set(),
    overlayMax: 100,
  });
  assert.deepEqual(parseFog(f.room.state.pieces.get('2').fog), saved.pieces[0].fog);
  assert.equal(saved.pieces[0].fog.thickness, MAP_FOG.maxThickness);
});

function auraPiece(f, position = [-3, 1, 0]) {
  const id = f.room.spawn('prop', position, { shape: 'cube' }, null, false);
  return { id, piece: f.room.state.pieces.get(id) };
}
async function setAura(f, source, enabled = true, radius = 0.3) {
  await f.handlers.get('setFogAura')(f.client, {
    id: source.id,
    previous: source.piece.fogAura || '',
    aura: { v: 1, enabled, radius },
  });
}

test('aura validation bounds radii and projects translated, rotated board coordinates', () => {
  assert.deepEqual(parseFogAura(''), { v: 1, enabled: false, radius: 1 });
  assert.equal(parseFogAura('{'), null);
  for (const value of [
    null,
    {},
    { v: 2, enabled: true, radius: 1 },
    { v: 1, enabled: 'true', radius: 1 },
    ...[-1, 0, Infinity, NaN, 257, '1'].map((radius) => ({ v: 1, enabled: true, radius })),
  ])
    assert.equal(normalizeFogAura(value), null);
  for (const type of ['board', 'mat', '__proto__', 'unknown'])
    assert.equal(canHaveFogAura(type), false);
  assert.equal(canHaveFogAura('die', { traySeat: 0 }), false);
  assert.equal(canHaveFogAura('prop'), true);
  const board = { x: 5, y: 2, z: 4, qx: 0, qy: Math.SQRT1_2, qz: 0, qw: Math.SQRT1_2 };
  const point = fogAuraPoint({ x: 5, y: 10, z: 2 }, board);
  assert.ok(Math.abs(point[0] - 2) < 1e-10 && Math.abs(point[1]) < 1e-10);
  assert.equal(fogAuraPoint({ x: NaN, y: 0, z: 0 }, board), null);
});

test('aura configuration uses the production permission gate, validates targets and rejects stale drafts', async () => {
  const f = fixture(),
    source = auraPiece(f);
  for (const auth of [
    { role: 'player' },
    { role: 'helper' },
    { role: 'gm', revoked: true },
    { role: 'gm', timedOut: true },
    { role: 'gm', participation: 'spectator' },
  ]) {
    f.client.auth = auth;
    await setAura(f, source);
    assert.equal(source.piece.fogAura, undefined);
  }
  f.client.auth = { role: 'gm' };
  await setAura(f, { id: '1', piece: f.piece });
  assert.equal(f.piece.fogAura, undefined);
  await setAura(f, source, true, Infinity);
  assert.equal(source.piece.fogAura, undefined);
  await setAura(f, source);
  const saved = source.piece.fogAura;
  await f.handlers.get('setFogAura')(f.client, {
    id: source.id,
    previous: '',
    aura: { v: 1, enabled: false, radius: 1 },
  });
  assert.equal(source.piece.fogAura, saved);
  await setAura(f, source, false);
  assert.equal(source.piece.fogAura, saved, 'rapid edit was rate limited');
  f.tick();
  await setAura(f, source, false);
  assert.equal(parseFogAura(source.piece.fogAura).enabled, false);
});

test('auras reveal sampled curved movement at a bounded publication rate without filling manual undo', async () => {
  const f = fixture(),
    source = auraPiece(f, [-2, 1, -1]);
  await f.edit({ action: 'enable', enabled: true });
  await setAura(f, source);
  f.tick();
  const initial = f.piece.fog;
  source.piece.z = 1;
  f.tick(16);
  source.piece.x = 2;
  f.tick(16);
  assert.equal(f.piece.fog, initial, 'each physics frame must not publish');
  f.tick(100);
  const mask = decodeFogMask(parseFog(f.piece.fog).mask);
  assert.equal(covered(mask, -2, 0), false);
  assert.equal(covered(mask, 0, 1), false);
  assert.equal(covered(mask, 0, 0), true, 'sampled turn must not become a diagonal shortcut');
  const saves = f.saves;
  f.tick();
  f.tick();
  assert.equal(f.saves, saves, 'stationary source must not write');
  await f.edit({ action: 'undo' });
  assert.equal(
    parseFog(f.piece.fog).enabled,
    false,
    'automatic movement did not consume manual undo entries',
  );
});

test('manual cover discards pending paths, and hidden, disabled or removed sources leave no reveal bridge', async () => {
  const f = fixture(),
    source = auraPiece(f);
  await f.edit({ action: 'enable', enabled: true });
  await setAura(f, source);
  f.tick();
  source.piece.x = -2;
  f.tick(16);
  await f.edit({ action: 'all', mode: 'cover' });
  f.tick();
  assert.equal(parseFog(f.piece.fog).mask, emptyFog().mask);
  source.piece.hidden = true;
  f.tick();
  source.piece.x = 3;
  f.tick();
  assert.equal(parseFog(f.piece.fog).mask, emptyFog().mask);
  source.piece.hidden = false;
  f.tick();
  let mask = decodeFogMask(parseFog(f.piece.fog).mask);
  assert.equal(covered(mask, 3, 0), false);
  assert.equal(covered(mask, 0, 0), true);
  await setAura(f, source, false);
  f.tick();
  source.piece.x = -3;
  f.tick();
  mask = decodeFogMask(parseFog(f.piece.fog).mask);
  assert.equal(covered(mask, -3, 0), true);
  await setAura(f, source);
  f.tick();
  f.room.state.pieces.delete(source.id);
  f.tick();
  const before = f.piece.fog;
  source.piece.x = 0;
  f.tick();
  assert.equal(f.piece.fog, before);
});

test('hidden boards and disabled fog pause paths; replacement boards do not inherit exploration', async () => {
  const f = fixture(),
    source = auraPiece(f);
  await f.edit({ action: 'enable', enabled: true });
  await setAura(f, source);
  f.tick();
  await f.edit({ action: 'enable', enabled: false });
  f.tick();
  source.piece.x = 3;
  f.tick();
  await f.edit({ action: 'enable', enabled: true });
  f.tick();
  assert.equal(covered(decodeFogMask(parseFog(f.piece.fog).mask), 0, 0), true);
  f.piece.hidden = true;
  f.tick();
  source.piece.x = 0;
  f.tick();
  assert.equal(covered(decodeFogMask(parseFog(f.piece.fog).mask), 0, 0), true);
  const replacement = new Piece();
  Object.assign(replacement, f.piece.toJSON());
  replacement.hidden = false;
  replacement.fog = JSON.stringify({ ...emptyFog(), enabled: true });
  f.room.state.pieces.set('1', replacement);
  f.tick();
  const mask = decodeFogMask(parseFog(replacement.fog).mask);
  assert.equal(covered(mask, 0, 0), false);
  assert.equal(covered(mask, -3, 0), true);
});

test('scene restoration preserves aura settings, rejects malformed settings before clearing and accepts legacy scenes', async () => {
  const f = fixture(),
    source = auraPiece(f);
  await setAura(f, source);
  source.piece.hidden = true;
  const saved = serializeScene(f.room),
    opts = {
      maxPieces: 100,
      tableLimits: { minX: 1, maxX: 100, minZ: 1, maxZ: 100 },
      overlayKinds: new Set(),
      overlayMax: 100,
    };
  assert.equal(saved.pieces[1].fogAura.radius, 0.3);
  assert.throws(
    () =>
      applyScene(f.room, { ...saved, pieces: [{ ...saved.pieces[1], fogAura: { v: 99 } }] }, opts),
    /invalid fog aura/,
  );
  assert.equal(f.room.state.pieces.get(source.id), source.piece);
  applyScene(f.room, saved, opts);
  const restored = [...f.room.state.pieces.values()].find((p) => p.type === 'prop');
  assert.deepEqual(parseFogAura(restored.fogAura), saved.pieces[1].fogAura);
  assert.equal(restored.hidden, true);
  delete saved.pieces[1].fogAura;
  applyScene(f.room, saved, opts);
  assert.equal([...f.room.state.pieces.values()].find((p) => p.type === 'prop').fogAura, undefined);
});
