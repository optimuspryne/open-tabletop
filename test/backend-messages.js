import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assetMutationPayload,
  boardRecordPayload,
  boundedString,
  boundedUniqueIds,
  cardPlacementPayload,
  deckAppendPayload,
  deckBeginPayload,
  deckFinishPayload,
  dispenserDragPayload,
  finiteNumber,
  finitePosition,
  groupIds,
  gridCalibrationPayload,
  groupRecolor,
  groupRotation,
  isPlainObject,
  namedIdPayload,
  deckDragPayload,
  deckIdPayload,
  handReassignmentPayload,
  inspectPlacementPayload,
  memberRolePayload,
  memberUserPayload,
  overlayGeometry,
  overlayMovePayload,
  propRecordPayload,
  recolorPayload,
  reorderHandPayload,
  saveBoardPayload,
  savePropPayload,
  saveSkyboxPayload,
  saveDicePayload,
  scalePayload,
  scorePayload,
  showPayload,
  spawnPayload,
  tablePayload,
  timerPayload,
  whiteboardStroke,
} from '../server/message-validation.js';
import { takeTopCard } from '../server/deck-state.js';

test('movement accepts finite numeric coordinates without coercion', () => {
  assert.deepEqual(finitePosition({ x: 1, y: -2.5, z: 0 }), { x: 1, y: -2.5, z: 0 });
  assert.equal(finitePosition({ x: '1', y: 2, z: 3 }), null);
});

test('movement rejects malformed and non-finite payloads', () => {
  for (const value of [
    null,
    undefined,
    {},
    { x: NaN, y: 0, z: 0 },
    { x: Infinity, y: 0, z: 0 },
    { x: 0, y: 0, z: -Infinity },
  ]) {
    assert.equal(finitePosition(value), null);
  }
});

test('shared payload primitives reject coercion, exotic objects, and out-of-range values', () => {
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject(Object.create(null)), true);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject(new Date()), false);
  assert.equal(boundedString('piece', { min: 1, max: 5 }), 'piece');
  assert.equal(boundedString('too-long', { max: 5 }), null);
  assert.equal(finiteNumber(3, { min: 0, max: 4 }), 3);
  assert.equal(finiteNumber('3', { min: 0, max: 4 }), null);
});

test('group id payloads are bounded, unique server piece ids', () => {
  assert.deepEqual(boundedUniqueIds(['1', '20']), ['1', '20']);
  assert.deepEqual(groupIds({ ids: ['1', '20'] }), ['1', '20']);
  for (const message of [
    null,
    {},
    { ids: [] },
    { ids: ['1', '1'] },
    { ids: [1] },
    { ids: ['piece'] },
    { ids: ['1'], unexpected: true },
    { ids: Array.from({ length: 81 }, (_, i) => String(i)) },
  ])
    assert.equal(groupIds(message), null);
});

test('group rotation accepts one bounded angle or an explicit direction', () => {
  assert.deepEqual(groupRotation({ ids: ['1'], dir: -1 }), { ids: ['1'], dir: -1 });
  assert.deepEqual(groupRotation({ ids: ['1'], angle: 0.5 }), { ids: ['1'], angle: 0.5 });
  for (const message of [
    { ids: ['1'] },
    { ids: ['1'], dir: 0 },
    { ids: ['1'], angle: NaN },
    { ids: ['1'], angle: Math.PI + 0.1 },
    { ids: ['1'], dir: 1, angle: 0.5 },
  ])
    assert.equal(groupRotation(message), null);
});

test('group recolor accepts integer colors or a team, never mixed inputs', () => {
  assert.deepEqual(groupRecolor({ ids: ['1'], color: 0x123456, textColor: 0xffffff }), {
    ids: ['1'],
    color: 0x123456,
    textColor: 0xffffff,
  });
  assert.deepEqual(groupRecolor({ ids: ['1'], team: 0 }), { ids: ['1'], team: 0 });
  for (const message of [
    { ids: ['1'] },
    { ids: ['1'], color: '#123456' },
    { ids: ['1'], color: 1.5 },
    { ids: ['1'], color: 0x1000000 },
    { ids: ['1'], team: true },
    { ids: ['1'], team: 1, color: 0 },
  ])
    assert.equal(groupRecolor(message), null);
});

test('timer and scoreboard actions require exact bounded payloads', () => {
  assert.deepEqual(timerPayload({ action: 'pause' }), { action: 'pause' });
  assert.deepEqual(timerPayload({ action: 'set', mode: 'down', duration: 60000 }), {
    action: 'set',
    mode: 'down',
    duration: 60000,
  });
  assert.equal(timerPayload({ action: 'set', mode: 'down', duration: '60000' }), null);
  assert.equal(timerPayload({ action: 'start', duration: 1 }), null);
  assert.deepEqual(scorePayload({ action: 'adjust', id: 's12', delta: -2.8 }), {
    action: 'adjust',
    id: 's12',
    delta: -2,
  });
  assert.equal(scorePayload({ action: 'remove', id: 12 }), null);
  assert.equal(scorePayload({ action: 'add', label: 'x'.repeat(41) }), null);
});

test('table and scale settings reject coercion and invalid partial updates', () => {
  const limits = { minX: 4, maxX: 20, minZ: 3, maxZ: 20 };
  assert.deepEqual(tablePayload({ x: 10, z: 7 }, limits), { x: 10, z: 7 });
  assert.equal(tablePayload({ x: '10', z: 7 }, limits), null);
  assert.equal(tablePayload({ x: 30, z: 7 }, limits), null);
  assert.deepEqual(scalePayload({ gridStyle: 'square', cellWorld: 2, gridHidden: false }), {
    gridStyle: 'square',
    cellWorld: 2,
    gridHidden: false,
  });
  assert.equal(scalePayload({ gridStyle: 'triangle' }), null);
  assert.equal(scalePayload({ gridX: Infinity }), null);
  assert.equal(scalePayload({ unknown: 1 }), null);
});

test('overlay geometry is finite, bounded, and structurally complete', () => {
  const options = { kinds: new Set(['line', 'ruler']), maxLen: 100, requireKind: true };
  assert.deepEqual(overlayGeometry({ kind: 'line', x: 0, z: 1, x2: 2, z2: 3, w: 1 }, options), {
    kind: 'line',
    x: 0,
    z: 1,
    x2: 2,
    z2: 3,
    w: 1,
  });
  assert.equal(overlayGeometry({ kind: 'line', x: 0, z: 1, x2: Infinity, z2: 3 }, options), null);
  assert.equal(overlayGeometry({ kind: 'unknown', x: 0, z: 1, x2: 2, z2: 3 }, options), null);
  assert.deepEqual(overlayMovePayload({ id: 'o2', x: 4 }, { maxLen: 100 }), { id: 'o2', x: 4 });
  assert.equal(overlayMovePayload({ id: 'o2', x: '4' }, { maxLen: 100 }), null);
});

test('whiteboard strokes are copied and reject malformed or oversized paths', () => {
  const raw = { pts: [0, 0.5, 1, 1], color: '#ffffff', width: 0.02 };
  const parsed = whiteboardStroke(raw);
  assert.deepEqual(parsed, raw);
  assert.notEqual(parsed.pts, raw.pts);
  assert.equal(whiteboardStroke({ ...raw, pts: [0, 0.5, 1] }), null);
  assert.equal(whiteboardStroke({ ...raw, pts: [0, Infinity] }), null);
  assert.equal(whiteboardStroke({ ...raw, pts: Array(2002).fill(0) }), null);
  assert.equal(whiteboardStroke({ ...raw, sid: 'forged' }), null);
  assert.deepEqual(whiteboardStroke({ ...raw, erase: false }), { ...raw, erase: false });
  assert.deepEqual(whiteboardStroke({ ...raw, erase: true }), { ...raw, erase: true });
  assert.equal(whiteboardStroke({ ...raw, erase: 'yes' }), null);
});

test('grid calibration and hand sharing use bounded enums and unique identifiers', () => {
  assert.deepEqual(gridCalibrationPayload({}), {});
  assert.deepEqual(gridCalibrationPayload({ cells: 19, anchor: 'cross' }), {
    cells: 19,
    anchor: 'cross',
  });
  assert.equal(gridCalibrationPayload({ cells: '19', anchor: 'cross' }), null);
  assert.equal(gridCalibrationPayload({ cells: 19, anchor: 'edge' }), null);
  assert.deepEqual(showPayload({ to: ['session-2'], hids: ['h1', 'h2'] }), {
    to: ['session-2'],
    hids: ['h1', 'h2'],
  });
  assert.equal(showPayload({ to: ['session-2', 'session-2'], hids: ['h1'] }), null);
  assert.equal(showPayload({ to: 'all', hids: [1] }), null);
});

test('asset mutations require allowlisted kinds, database ids, and exact fields', () => {
  const kinds = ['deck', 'board'];
  assert.deepEqual(
    assetMutationPayload({ kind: 'deck', id: '42', isPublic: false }, { kinds, mode: 'public' }),
    { kind: 'deck', id: '42', isPublic: false },
  );
  assert.deepEqual(
    assetMutationPayload({ kind: 'board', id: '7', name: ' New name ' }, { kinds, mode: 'rename' }),
    { kind: 'board', id: '7', name: 'New name' },
  );
  assert.equal(
    assetMutationPayload({ kind: 'users', id: '42', isPublic: true }, { kinds, mode: 'public' }),
    null,
  );
  assert.equal(
    assetMutationPayload({ kind: 'deck', id: 42, isPublic: true }, { kinds, mode: 'public' }),
    null,
  );
  assert.equal(
    assetMutationPayload({ kind: 'deck', id: '42', isPublic: 1 }, { kinds, mode: 'public' }),
    null,
  );
  assert.deepEqual(namedIdPayload({ deckId: '8', name: 'Cards' }, { idKey: 'deckId' }), {
    deckId: '8',
    name: 'Cards',
  });
});

test('single-piece actions, drags, and card placements reject coercion', () => {
  assert.deepEqual(recolorPayload({ id: '2', color: 0x123456 }), { id: '2', color: 0x123456 });
  assert.equal(recolorPayload({ id: 2, color: 0x123456 }), null);
  assert.deepEqual(dispenserDragPayload({ id: '2', x: 1, y: 2, z: 3 }), {
    id: '2',
    x: 1,
    y: 2,
    z: 3,
  });
  assert.equal(dispenserDragPayload({ id: '2', x: '1', y: 2, z: 3 }), null);
  assert.deepEqual(cardPlacementPayload({ hid: 'h3', faceDown: true, x: 1, z: 2 }), {
    hid: 'h3',
    faceDown: true,
    x: 1,
    z: 2,
  });
  assert.equal(cardPlacementPayload({ hid: 'h3', faceDown: 1 }), null);
  assert.equal(cardPlacementPayload({ hid: 'h3', faceDown: true, x: 1 }), null);
});

test('deck append batches are bounded and copied after validating every reference', () => {
  const refOk = (value) => typeof value === 'string' && value.startsWith('/');
  const raw = { fronts: ['/one', '/two'] };
  const parsed = deckAppendPayload(raw, { max: 2, refOk });
  assert.deepEqual(parsed, raw);
  assert.notEqual(parsed.fronts, raw.fronts);
  assert.equal(deckAppendPayload({ fronts: ['/one', 'bad'] }, { max: 2, refOk }), null);
  assert.equal(deckAppendPayload({ fronts: ['/one', '/two', '/three'] }, { max: 2, refOk }), null);
  assert.equal(deckAppendPayload({ fronts: ['/one', '/two'] }, { maxBytes: 5, refOk }), null);
  // per-tile back pairs: a { front, back } entry rides alongside bare fronts
  assert.deepEqual(
    deckAppendPayload({ fronts: ['/a', { front: '/b', back: '/bb' }] }, { max: 2, refOk }),
    { fronts: ['/a', { front: '/b', back: '/bb' }] },
  );
  assert.equal(
    deckAppendPayload({ fronts: [{ front: '/b', back: 'bad' }] }, { max: 2, refOk }),
    null,
  );
  assert.equal(deckAppendPayload({ fronts: [{ front: '/b', extra: 1 }] }, { max: 2, refOk }), null);
});

test('board records accept only known built-ins or bounded local asset geometry', () => {
  assert.deepEqual(boardRecordPayload({ board: 'chess' }, { boardKeys: ['chess'] }), {
    board: 'chess',
  });
  assert.deepEqual(
    boardRecordPayload({ model: '/assets/props/a.glb', modelScale: 2, box: [1, 0.2, 1] }),
    { model: '/assets/props/a.glb', modelScale: 2, box: [1, 0.2, 1] },
  );
  assert.deepEqual(boardRecordPayload({ w: 10, d: 8, tex: '/assets/boards/map.png' }), {
    w: 10,
    d: 8,
    tex: '/assets/boards/map.png',
  });
  assert.equal(boardRecordPayload({ board: 'unknown' }, { boardKeys: ['chess'] }), null);
  assert.equal(
    boardRecordPayload({ model: 'https://evil.test/a.glb', modelScale: 2, box: [1, 1, 1] }),
    null,
  );
  assert.equal(boardRecordPayload({ w: '10', d: 8 }), null);
});

test('custom prop records validate model, collider, transforms, and colors', () => {
  const value = {
    model: '/assets/props/a.glb',
    box: [1, 2, 1],
    stand: true,
    scale: 1,
    modelRot: [0, 1, 0],
    collider: 'cylinder',
    color: 123,
  };
  assert.deepEqual(propRecordPayload(value, { colliders: ['cylinder'] }), value);
  assert.equal(
    propRecordPayload({ ...value, box: [1, NaN, 1] }, { colliders: ['cylinder'] }),
    null,
  );
  assert.equal(
    propRecordPayload({ ...value, collider: 'mesh' }, { colliders: ['cylinder'] }),
    null,
  );
  assert.equal(propRecordPayload({ ...value, extra: true }, { colliders: ['cylinder'] }), null);
});

test('deck draft boundaries validate geometry, finish flags, names, and edit ids', () => {
  const refOk = (value) => typeof value === 'string' && value.length < 100;
  const sanitizeGeom = (value) => (value && value.w === 2 ? { w: 2, h: 3 } : null);
  const deckModels = ['bentwood', 'bag'];
  assert.deepEqual(
    deckBeginPayload({ back: '/back', geom: { w: 2 } }, { refOk, sanitizeGeom, deckModels }),
    {
      back: '/back',
      geom: { w: 2, h: 3 },
      open: false,
      deckModel: null,
      color: null,
      textColor: null,
    },
  );
  assert.deepEqual(
    deckBeginPayload({ back: '/back', open: true }, { refOk, sanitizeGeom, deckModels }),
    {
      back: '/back',
      geom: null,
      open: true,
      deckModel: null,
      color: null,
      textColor: null,
    },
  );
  // A pouch skin with two slot tints rides along on the draft.
  assert.deepEqual(
    deckBeginPayload(
      { back: '/back', open: true, deckModel: 'bag', color: '#7a5a3a', textColor: '#c8b06a' },
      { refOk, sanitizeGeom, deckModels },
    ),
    {
      back: '/back',
      geom: null,
      open: true,
      deckModel: 'bag',
      color: '#7a5a3a',
      textColor: '#c8b06a',
    },
  );
  // An unknown skin id or a malformed hex color rejects the whole payload.
  assert.equal(
    deckBeginPayload({ back: '/back', deckModel: 'nope' }, { refOk, sanitizeGeom, deckModels }),
    null,
  );
  assert.equal(
    deckBeginPayload({ back: '/back', color: 'red' }, { refOk, sanitizeGeom, deckModels }),
    null,
  );
  assert.equal(
    deckBeginPayload({ back: '/back', open: 'yes' }, { refOk, sanitizeGeom, deckModels }),
    null,
  );
  assert.equal(deckBeginPayload({ back: 2 }, { refOk, sanitizeGeom, deckModels }), null);
  assert.deepEqual(deckFinishPayload({ name: ' Deck ', spawn: false, editId: '4' }), {
    name: 'Deck',
    spawn: false,
    editId: '4',
  });
  assert.equal(deckFinishPayload({ name: 'Deck', spawn: 'no' }), null);
  assert.equal(deckFinishPayload({ spawn: false, editId: '4' }), null);
});

test('save and spawn payloads reject unknown nested fields and unsupported types', () => {
  assert.deepEqual(saveBoardPayload({ name: 'Map', board: { w: 10, d: 8 } }), {
    name: 'Map',
    board: { w: 10, d: 8 },
    editId: null,
  });
  const prop = { model: '/assets/props/a.glb', box: [1, 1, 1], stand: false, scale: 1 };
  assert.deepEqual(savePropPayload({ name: 'Pawn', props: prop }, { colliders: [] }), {
    name: 'Pawn',
    props: prop,
    editId: null,
  });
  const options = {
    boardKeys: ['chess'],
    propKeys: ['pawn'],
    dispenserKeys: ['chips'],
    colliders: ['flat'],
  };
  assert.deepEqual(spawnPayload({ type: 'die', props: { sides: 20, color: 0xffffff } }, options), {
    type: 'die',
    props: { sides: 20, color: 0xffffff },
  });
  assert.deepEqual(
    spawnPayload({ type: 'prop', props: { shape: 'pawn', team: 1, snap: true } }, options),
    { type: 'prop', props: { shape: 'pawn', team: 1, snap: true } },
  );
  assert.equal(spawnPayload({ type: 'prop', props: { shape: 'unknown' } }, options), null);
  assert.equal(spawnPayload({ type: 'die', props: { sides: 20, injected: true } }, options), null);
  assert.equal(spawnPayload({ type: 'admin', props: {} }, options), null);
});

test('member and extracted card messages validate ids, roles, coordinates, and placement enums', () => {
  assert.deepEqual(memberUserPayload({ userId: '12' }), { userId: '12' });
  assert.deepEqual(memberRolePayload({ userId: '12', role: 'helper' }), {
    userId: '12',
    role: 'helper',
  });
  assert.deepEqual(handReassignmentPayload({ userId: '12', toSessionId: 'session-x' }), {
    userId: '12',
    toSessionId: 'session-x',
  });
  assert.equal(memberUserPayload({ userId: 12 }), null);
  assert.equal(memberRolePayload({ userId: '12', role: 'owner' }), null);
  assert.deepEqual(deckIdPayload({ deckId: '4' }), { deckId: '4' });
  assert.deepEqual(deckDragPayload({ deckId: '4', x: 1, y: 2, z: 3 }), {
    deckId: '4',
    x: 1,
    y: 2,
    z: 3,
  });
  assert.equal(deckDragPayload({ deckId: '4', x: NaN, y: 2, z: 3 }), null);
  assert.deepEqual(inspectPlacementPayload({ where: 'field-down' }), { where: 'field-down' });
  assert.equal(inspectPlacementPayload({ where: 'discard' }), null);
});

test('skybox saves accept only exact local panorama or six-face cube payloads', () => {
  const urlOk = (url) => typeof url === 'string' && !url.includes('..') && url.length < 300;
  assert.deepEqual(
    saveSkyboxPayload(
      { name: ' Night ', url: '/assets/sky/night.jpg', isPublic: false },
      { urlOk },
    ),
    { name: 'Night', type: 'equirect', url: '/assets/sky/night.jpg', isPublic: false },
  );
  const faces = Array.from({ length: 6 }, (_, i) => `/assets/sky/${i}.jpg`);
  assert.deepEqual(
    saveSkyboxPayload({ name: 'Cube', type: 'cube', faces, isPublic: true }, { urlOk }),
    { name: 'Cube', type: 'cube', faces, isPublic: true },
  );
  assert.equal(
    saveSkyboxPayload(
      { name: 'Remote', url: 'https://evil.test/x.jpg', isPublic: false },
      { urlOk },
    ),
    null,
  );
  assert.equal(
    saveSkyboxPayload(
      { name: 'Cube', type: 'cube', faces: faces.slice(1), isPublic: true },
      { urlOk },
    ),
    null,
  );
});

test('drawing mutates deck count and returns cards in stack order', () => {
  const deck = { type: 'deck', count: 2 };
  const cards = ['bottom', 'top'];
  assert.deepEqual(takeTopCard(deck, cards), { front: 'top', back: undefined, empty: false });
  assert.equal(deck.count, 1);
  assert.deepEqual(takeTopCard(deck, cards), { front: 'bottom', back: undefined, empty: true });
  assert.equal(deck.count, 0);
});

test('drawing an object entry returns its per-tile back', () => {
  const deck = { type: 'deck', count: 2 };
  const cards = ['plainFront', { front: 'treeFront', back: 'treeBack' }];
  assert.deepEqual(takeTopCard(deck, cards), {
    front: 'treeFront',
    back: 'treeBack',
    empty: false,
  });
  assert.deepEqual(takeTopCard(deck, cards), { front: 'plainFront', back: undefined, empty: true });
});

test('drawing rejects missing, empty, and non-deck state without mutation', () => {
  const piece = { type: 'card', count: 1 };
  const cards = ['front'];
  assert.equal(takeTopCard(piece, cards), null);
  assert.deepEqual(cards, ['front']);
  assert.equal(takeTopCard({ type: 'deck', count: 0 }, []), null);
  assert.equal(takeTopCard(null, cards), null);
});

test('reorderHandPayload: a valid hid permutation passes; malformed input is rejected', () => {
  assert.deepEqual(reorderHandPayload({ order: ['h0', 'h2', 'h1'] }), {
    order: ['h0', 'h2', 'h1'],
  });
  assert.equal(reorderHandPayload({ order: [] }), null); // empty
  assert.equal(reorderHandPayload({ order: ['h0', 'h0'] }), null); // duplicate hid
  assert.equal(reorderHandPayload({ order: ['0'] }), null); // wrong hid format
  assert.equal(reorderHandPayload({ order: 'h0' }), null); // not an array
  assert.equal(reorderHandPayload({ order: ['h0'], extra: 1 }), null); // extra key
  assert.equal(reorderHandPayload({ order: ['h1', 3] }), null); // non-string element
});

test('spawnPayload accepts a die finish (regression: non-matte finish blocked spawns)', () => {
  const ok = spawnPayload({ type: 'die', props: { sides: 20, finish: 'metallic' } });
  assert.equal(ok && ok.props && ok.props.finish, 'metallic');
  const plain = spawnPayload({ type: 'die', props: { sides: 6 } });
  assert.equal(plain && plain.props && plain.props.finish, undefined); // matte omits it
  assert.equal(spawnPayload({ type: 'die', props: { sides: 6, bogus: 1 } }), null); // still strict
});

test('dice-texture saves accept only a local /assets/dice image', () => {
  const urlOk = (u) =>
    typeof u === 'string' && !u.includes('..') && u.length < 300 && u.startsWith('/assets/dice/');
  assert.deepEqual(
    saveDicePayload({ name: ' Galaxy ', url: '/assets/dice/g.jpg', isPublic: false }, { urlOk }),
    { name: 'Galaxy', url: '/assets/dice/g.jpg', isPublic: false },
  );
  assert.equal(
    saveDicePayload({ name: 'Remote', url: 'https://evil.test/x.jpg', isPublic: false }, { urlOk }),
    null,
  );
  assert.equal(
    saveDicePayload(
      { name: 'Trav', url: '/assets/dice/../secret.jpg', isPublic: false },
      { urlOk },
    ),
    null,
  );
  assert.equal(
    saveDicePayload({ name: 'WrongDir', url: '/assets/sky/x.jpg', isPublic: false }, { urlOk }),
    null,
  );
  assert.equal(
    saveDicePayload({ name: '', url: '/assets/dice/g.jpg', isPublic: false }, { urlOk }),
    null,
  );
});

test('spawn + recolor carry a custom finish texture (local /assets/dice only)', () => {
  const spawned = spawnPayload({
    type: 'die',
    props: { sides: 20, finish: 'custom', finishImg: '/assets/dice/a.jpg' },
  });
  assert.equal(spawned.props.finish, 'custom');
  assert.equal(spawned.props.finishImg, '/assets/dice/a.jpg');
  assert.equal(
    spawnPayload({
      type: 'die',
      props: { sides: 6, finish: 'custom', finishImg: 'https://evil/x.jpg' },
    }),
    null,
  ); // off-origin texture rejected at the transport gate
  assert.deepEqual(
    groupRecolor({ ids: ['1'], finish: 'custom', finishImg: '/assets/dice/a.jpg' }),
    {
      ids: ['1'],
      finish: 'custom',
      finishImg: '/assets/dice/a.jpg',
    },
  );
  assert.equal(
    groupRecolor({ ids: ['1'], finish: 'custom', finishImg: '/assets/uploads/x.jpg' }),
    null,
  ); // texture must live under /assets/dice/
});

test('spawnPayload accepts a pipped die model, rejects a malformed one', () => {
  const ok = spawnPayload({ type: 'die', props: { sides: 6, model: 'pip-round' } });
  assert.equal(ok && ok.props.model, 'pip-round');
  assert.equal(spawnPayload({ type: 'die', props: { sides: 6, model: 'Bad Model!' } }), null);
});
