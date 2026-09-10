import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deckHeight } from '../shared/pieces.js';
import { syncDeckMeshHeight } from '../public/mesh-state.js';

const deckMesh = () => ({ scale: { y: 1 } });

test('deck count updates resize the current mesh after a props-driven replacement', () => {
  const original = deckMesh();
  const replacement = deckMesh();
  const meshes = new Map([['deck', { mesh: original, type: 'deck' }]]);

  assert.equal(syncDeckMeshHeight(meshes, 'deck', 40), true);
  assert.equal(original.scale.y, deckHeight(40));

  meshes.get('deck').mesh = replacement;
  assert.equal(syncDeckMeshHeight(meshes, 'deck', 12), true);
  assert.equal(replacement.scale.y, deckHeight(12));
  assert.equal(original.scale.y, deckHeight(40));
});

test('a late count update is harmless after the deck mesh is removed', () => {
  assert.equal(syncDeckMeshHeight(new Map(), 'missing', 12), false);
});
