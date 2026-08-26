import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readProps, writeProps } from '../server/game/props-codec.js';

test('props codec reads and writes ordinary object records', () => {
  const piece = { props: '{"front":"ace","snap":true}' };
  assert.deepEqual(readProps(piece), { front: 'ace', snap: true });
  writeProps(piece, { back: 'blue', count: 2 });
  assert.equal(piece.props, '{"back":"blue","count":2}');
});

test('props codec fails closed for malformed and non-object JSON', () => {
  for (const props of ['', '{broken', 'null', '[]', '"text"', '42']) {
    assert.deepEqual(readProps({ props }), {}, `expected empty props for ${props}`);
  }
  assert.deepEqual(readProps(null), {});
  assert.deepEqual(readProps({}), {});
});

test('props codec normalizes invalid writes to an empty object', () => {
  for (const value of [null, undefined, [], 'text', 42]) {
    const piece = {};
    writeProps(piece, value);
    assert.equal(piece.props, '{}');
  }
  assert.doesNotThrow(() => writeProps(null, { front: 'ace' }));
});
