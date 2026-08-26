import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assetMutationPayload, boundedString, boundedUniqueIds, cardPlacementPayload,
  deckAppendPayload, dispenserDragPayload, finiteNumber, finitePosition, groupIds,
  gridCalibrationPayload, groupRecolor, groupRotation, isPlainObject, namedIdPayload,
  overlayGeometry, overlayMovePayload, recolorPayload, scalePayload, scorePayload,
  showPayload, tablePayload, timerPayload, whiteboardStroke,
} from '../server/message-validation.js';
import { takeTopCard } from '../server/deck-state.js';

test('movement accepts finite numeric coordinates without coercion', () => {
  assert.deepEqual(finitePosition({ x: 1, y: -2.5, z: 0 }), { x: 1, y: -2.5, z: 0 });
  assert.equal(finitePosition({ x: '1', y: 2, z: 3 }), null);
});

test('movement rejects malformed and non-finite payloads', () => {
  for (const value of [null, undefined, {}, { x: NaN, y: 0, z: 0 }, { x: Infinity, y: 0, z: 0 }, { x: 0, y: 0, z: -Infinity }]) {
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
    null, {}, { ids: [] }, { ids: ['1', '1'] }, { ids: [1] }, { ids: ['piece'] },
    { ids: ['1'], unexpected: true }, { ids: Array.from({ length: 81 }, (_, i) => String(i)) },
  ]) assert.equal(groupIds(message), null);
});

test('group rotation accepts one bounded angle or an explicit direction', () => {
  assert.deepEqual(groupRotation({ ids: ['1'], dir: -1 }), { ids: ['1'], dir: -1 });
  assert.deepEqual(groupRotation({ ids: ['1'], angle: 0.5 }), { ids: ['1'], angle: 0.5 });
  for (const message of [
    { ids: ['1'] }, { ids: ['1'], dir: 0 }, { ids: ['1'], angle: NaN },
    { ids: ['1'], angle: Math.PI + 0.1 }, { ids: ['1'], dir: 1, angle: 0.5 },
  ]) assert.equal(groupRotation(message), null);
});

test('group recolor accepts integer colors or a team, never mixed inputs', () => {
  assert.deepEqual(groupRecolor({ ids: ['1'], color: 0x123456, textColor: 0xffffff }),
    { ids: ['1'], color: 0x123456, textColor: 0xffffff });
  assert.deepEqual(groupRecolor({ ids: ['1'], team: 0 }), { ids: ['1'], team: 0 });
  for (const message of [
    { ids: ['1'] }, { ids: ['1'], color: '#123456' }, { ids: ['1'], color: 1.5 },
    { ids: ['1'], color: 0x1000000 }, { ids: ['1'], team: true },
    { ids: ['1'], team: 1, color: 0 },
  ]) assert.equal(groupRecolor(message), null);
});

test('timer and scoreboard actions require exact bounded payloads', () => {
  assert.deepEqual(timerPayload({ action: 'pause' }), { action: 'pause' });
  assert.deepEqual(timerPayload({ action: 'set', mode: 'down', duration: 60000 }),
    { action: 'set', mode: 'down', duration: 60000 });
  assert.equal(timerPayload({ action: 'set', mode: 'down', duration: '60000' }), null);
  assert.equal(timerPayload({ action: 'start', duration: 1 }), null);
  assert.deepEqual(scorePayload({ action: 'adjust', id: 's12', delta: -2.8 }),
    { action: 'adjust', id: 's12', delta: -2 });
  assert.equal(scorePayload({ action: 'remove', id: 12 }), null);
  assert.equal(scorePayload({ action: 'add', label: 'x'.repeat(41) }), null);
});

test('table and scale settings reject coercion and invalid partial updates', () => {
  const limits = { minX: 4, maxX: 20, minZ: 3, maxZ: 20 };
  assert.deepEqual(tablePayload({ x: 10, z: 7 }, limits), { x: 10, z: 7 });
  assert.equal(tablePayload({ x: '10', z: 7 }, limits), null);
  assert.equal(tablePayload({ x: 30, z: 7 }, limits), null);
  assert.deepEqual(scalePayload({ gridStyle: 'square', cellWorld: 2, gridHidden: false }),
    { gridStyle: 'square', cellWorld: 2, gridHidden: false });
  assert.equal(scalePayload({ gridStyle: 'triangle' }), null);
  assert.equal(scalePayload({ gridX: Infinity }), null);
  assert.equal(scalePayload({ unknown: 1 }), null);
});

test('overlay geometry is finite, bounded, and structurally complete', () => {
  const options = { kinds: new Set(['line', 'ruler']), maxLen: 100, requireKind: true };
  assert.deepEqual(overlayGeometry({ kind: 'line', x: 0, z: 1, x2: 2, z2: 3, w: 1 }, options),
    { kind: 'line', x: 0, z: 1, x2: 2, z2: 3, w: 1 });
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
});

test('grid calibration and hand sharing use bounded enums and unique identifiers', () => {
  assert.deepEqual(gridCalibrationPayload({}), {});
  assert.deepEqual(gridCalibrationPayload({ cells: 19, anchor: 'cross' }), { cells: 19, anchor: 'cross' });
  assert.equal(gridCalibrationPayload({ cells: '19', anchor: 'cross' }), null);
  assert.equal(gridCalibrationPayload({ cells: 19, anchor: 'edge' }), null);
  assert.deepEqual(showPayload({ to: ['session-2'], hids: ['h1', 'h2'] }),
    { to: ['session-2'], hids: ['h1', 'h2'] });
  assert.equal(showPayload({ to: ['session-2', 'session-2'], hids: ['h1'] }), null);
  assert.equal(showPayload({ to: 'all', hids: [1] }), null);
});

test('asset mutations require allowlisted kinds, database ids, and exact fields', () => {
  const kinds = ['deck', 'board'];
  assert.deepEqual(assetMutationPayload({ kind: 'deck', id: '42', isPublic: false }, { kinds, mode: 'public' }),
    { kind: 'deck', id: '42', isPublic: false });
  assert.deepEqual(assetMutationPayload({ kind: 'board', id: '7', name: ' New name ' }, { kinds, mode: 'rename' }),
    { kind: 'board', id: '7', name: 'New name' });
  assert.equal(assetMutationPayload({ kind: 'users', id: '42', isPublic: true }, { kinds, mode: 'public' }), null);
  assert.equal(assetMutationPayload({ kind: 'deck', id: 42, isPublic: true }, { kinds, mode: 'public' }), null);
  assert.equal(assetMutationPayload({ kind: 'deck', id: '42', isPublic: 1 }, { kinds, mode: 'public' }), null);
  assert.deepEqual(namedIdPayload({ deckId: '8', name: 'Cards' }, { idKey: 'deckId' }), { deckId: '8', name: 'Cards' });
});

test('single-piece actions, drags, and card placements reject coercion', () => {
  assert.deepEqual(recolorPayload({ id: '2', color: 0x123456 }), { id: '2', color: 0x123456 });
  assert.equal(recolorPayload({ id: 2, color: 0x123456 }), null);
  assert.deepEqual(dispenserDragPayload({ id: '2', x: 1, y: 2, z: 3 }), { id: '2', x: 1, y: 2, z: 3 });
  assert.equal(dispenserDragPayload({ id: '2', x: '1', y: 2, z: 3 }), null);
  assert.deepEqual(cardPlacementPayload({ hid: 'h3', faceDown: true, x: 1, z: 2 }),
    { hid: 'h3', faceDown: true, x: 1, z: 2 });
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
});

test('drawing mutates deck count and returns cards in stack order', () => {
  const deck = { type: 'deck', count: 2 };
  const cards = ['bottom', 'top'];
  assert.deepEqual(takeTopCard(deck, cards), { front: 'top', empty: false });
  assert.equal(deck.count, 1);
  assert.deepEqual(takeTopCard(deck, cards), { front: 'bottom', empty: true });
  assert.equal(deck.count, 0);
});

test('drawing rejects missing, empty, and non-deck state without mutation', () => {
  const piece = { type: 'card', count: 1 };
  const cards = ['front'];
  assert.equal(takeTopCard(piece, cards), null);
  assert.deepEqual(cards, ['front']);
  assert.equal(takeTopCard({ type: 'deck', count: 0 }, []), null);
  assert.equal(takeTopCard(null, cards), null);
});
