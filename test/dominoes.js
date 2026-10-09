import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as THREE from '../public/vendor/three/three.module.js';
import {
  cardPublicProps,
  dominoModel,
  dominoAppearanceOf,
  normalizeDominoAppearance,
  colorProps,
} from '../shared/pieces.js';
import { createTileRenderer } from '../public/rendering/tiles.js';
import {
  absorbedEntry,
  takeTopCard,
  deckSpawnProps,
  inspectedEntry,
} from '../server/deck-state.js';
import { groupRecolor } from '../server/message-validation.js';
import { recolorPiece } from '../server/game/piece-operations.js';
import { validateGlb } from '../server/assets/upload-validation.js';

test('all double-six models and the concealed model are complete, valid, unchanged assets', () => {
  const directory = new URL('../public/static_assets/models/pieces/dominoes/', import.meta.url);
  const files = readdirSync(directory);
  assert.equal(files.length, 29);
  for (let a = 0; a <= 6; a++)
    for (let b = a; b <= 6; b++) {
      const file = `Domino_${a}_${b}.glb`;
      assert.ok(files.includes(file));
      assert.equal(validateGlb(readFileSync(new URL(file, directory))).ok, true);
    }
  assert.equal(validateGlb(readFileSync(new URL('Domino_Concealed.glb', directory))).ok, true);
});

test('public model selection never loads an identifying face for a concealed domino', () => {
  assert.match(dominoModel({ tile: 'domino' }).url, /Concealed/);
  assert.equal(dominoModel({ tile: 'letter' }), null);
  assert.equal(dominoModel({ tile: 'domino', front: 'domino:7:1' }), null);
  const reverse = dominoModel({ tile: 'domino', front: 'domino:6:3' });
  assert.match(reverse.url, /Domino_3_6/);
  assert.equal(reverse.turn, true);
  assert.equal(
    dominoModel({ tile: 'domino', front: 'domino:3:6', open: true, down: true }).down,
    true,
  );
});

test('appearance patches reject invalid values and preserve the independently chosen inset', () => {
  const props = { tile: 'domino', dominoAppearance: { inset: 0x123456, finish: 'glossy' } };
  const next = colorProps('card', props, { dominoAppearance: { base: 0 } });
  assert.deepEqual(next.dominoAppearance, { base: 0, inset: 0x123456, finish: 'glossy' });
  assert.deepEqual(props.dominoAppearance, { inset: 0x123456, finish: 'glossy' });
  for (const patch of [
    { base: -1 },
    { inset: 1.2 },
    { finish: 'custom' },
    { url: '/secret.glb' },
    [],
    null,
  ])
    assert.equal(normalizeDominoAppearance(patch), null);
  assert.equal(colorProps('card', {}, { dominoAppearance: { base: 0 } }), null);
  assert.equal(colorProps('card', props, { color: 0, dominoAppearance: { base: 0 } }), null);
  assert.equal(groupRecolor({ ids: ['1'], dominoAppearance: { finish: 'custom' } }), null);
  assert.deepEqual(groupRecolor({ ids: ['1'], dominoAppearance: { inset: 0 } }), {
    ids: ['1'],
    dominoAppearance: { inset: 0 },
  });
});

test('private entries retain individual appearance when returned, drawn, inspected and saved', () => {
  const appearance = { base: 1, inset: 2, finish: 'metallic' };
  const entry = absorbedEntry('domino:3:6', 'domback', 'domback', { dominoAppearance: appearance });
  const props = { tile: 'domino', back: 'domback', dominoAppearance: { base: 7 } };
  const cards = [entry];
  const deck = { type: 'deck', count: 1 };
  const draw = takeTopCard(deck, cards);
  const geo = cardPublicProps(props, draw);
  assert.deepEqual(geo, { tile: 'domino', dominoAppearance: appearance });
  assert.equal('front' in geo, false);
  assert.deepEqual(inspectedEntry({ front: draw.front, geo }), entry);
  assert.deepEqual(deckSpawnProps(props, [entry]).dominoAppearance, props.dominoAppearance);
  assert.deepEqual(JSON.parse(JSON.stringify(entry)).dominoAppearance, appearance);
  assert.equal(deck.count, 0);
});

test('recoloring a bag changes remaining stock without coupling its container colors', () => {
  const piece = { type: 'deck', props: JSON.stringify({ tile: 'domino', color: '#123456' }) };
  const cards = [
    absorbedEntry('domino:1:2', undefined, 'domback', { dominoAppearance: { base: 3 } }),
  ];
  const room = { state: { pieces: new Map([['1', piece]]) }, deckCards: new Map([['1', cards]]) };
  assert.equal(recolorPiece(room, '1', { dominoAppearance: { inset: 0xabc123 } }), true);
  assert.equal(JSON.parse(piece.props).color, '#123456');
  assert.equal(cards[0].dominoAppearance.base, 3);
  assert.equal(cardPublicProps(JSON.parse(piece.props), cards[0]).dominoAppearance.inset, 0xabc123);
  assert.equal(recolorPiece(room, '1', { dominoAppearance: { finish: 'glossy' } }), true);
  assert.deepEqual(cards[0].dominoAppearance, { base: 3, inset: 0xabc123, finish: 'glossy' });
});

function rendererFixture() {
  const requests = [];
  const pending = new Map();
  const template = new THREE.Group();
  template.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.18, 2),
      new THREE.MeshStandardMaterial({ name: 'base' }),
    ),
  );
  const renderer = createTileRenderer({
    THREE,
    loader: {
      loadAsync(url) {
        requests.push(url);
        return new Promise((resolve, reject) => pending.set(url, { resolve, reject }));
      },
    },
    fitModel: () => {},
    paintMesh(node, props) {
      node.material = node.material.clone();
      node.material.color.setHex(dominoAppearanceOf(props).base);
    },
    dispose(root) {
      root.userData.ottDisposed = true;
    },
  });
  const mesh = (props) =>
    renderer.mesh(props, () => new THREE.Mesh(new THREE.BoxGeometry(1, 0.18, 2)));
  return { mesh, requests, pending, template };
}

test('model instances share one load and immutable geometry, with separate materials', async () => {
  const f = rendererFixture();
  const a = f.mesh({ tile: 'domino', front: 'domino:1:2', dominoAppearance: { base: 1 } });
  const b = f.mesh({ tile: 'domino', front: 'domino:1:2', dominoAppearance: { base: 2 } });
  assert.equal(f.requests.length, 1);
  f.pending.get(f.requests[0]).resolve({ scene: f.template });
  await Promise.all([a.userData.tileModelReady, b.userData.tileModelReady]);
  const ma = a.children[0].children[0],
    mb = b.children[0].children[0];
  assert.equal(ma.geometry, mb.geometry);
  assert.notEqual(ma.material, mb.material);
  assert.equal(ma.material.color.getHex(), 1);
  assert.equal(mb.material.color.getHex(), 2);
});

test('late model loads cannot resurrect disposed tiles and failures retain the fallback', async () => {
  const f = rendererFixture();
  const mesh = f.mesh({ tile: 'domino' });
  const placeholder = mesh.children[0];
  mesh.userData.ottDisposed = true;
  f.pending.get(f.requests[0]).resolve({ scene: f.template });
  assert.equal(await mesh.userData.tileModelReady, false);
  assert.equal(mesh.children[0], placeholder);
  const failed = f.mesh({ tile: 'domino', front: 'domino:6:6' });
  const fallback = failed.children[0];
  f.pending.get(f.requests[1]).reject(new Error('offline'));
  assert.equal(await failed.userData.tileModelReady, false);
  assert.equal(failed.children[0], fallback);
});
