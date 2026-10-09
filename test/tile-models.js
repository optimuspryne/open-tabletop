import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three/three.module.js';
import {
  TILE_MODELS,
  tileModel,
  tileModelFamily,
  tileAppearanceOf,
  tileAppearanceProps,
  colorProps,
  cardGeom,
} from '../shared/pieces.js';
import { createTileRenderer } from '../public/rendering/tiles.js';
import {
  absorbedEntry,
  takeTopCard,
  inspectedEntry,
  deckSpawnProps,
} from '../server/deck-state.js';
import { groupRecolor, recolorPayload } from '../server/message-validation.js';
import { recolorPiece } from '../server/game/piece-operations.js';

// A second family exercises the extension contract without shipping unfinished Mahjong assets.
const families = {
  ...TILE_MODELS,
  mahjong: {
    name: 'Mahjong',
    appearanceKey: 'tileAppearance',
    defaults: { base: 0xffffff, inset: 0x123456, finish: 'original' },
    materialSlots: { base: 'body', inset: 'engraving' },
    concealed: '/fixture/Mahjong_Concealed.glb',
    faces: { 'mahjong:bam1': { url: '/fixture/Mahjong_Bam1.glb', turn: false } },
  },
};

test('tile registry selects a second family using only an authorized, allowlisted front', () => {
  const props = { tile: 'mahjong', model: '/secret.glb', back: 'mahjong:bam1' };
  assert.equal(tileModel(props), null); // not enabled in production yet
  assert.equal(tileModelFamily(props, families).name, 'Mahjong');
  assert.equal(tileModel(props, families).url, families.mahjong.concealed);
  assert.equal(
    tileModel({ ...props, front: 'mahjong:bam1' }, families).url,
    families.mahjong.faces['mahjong:bam1'].url,
  );
  assert.equal(tileModel({ ...props, front: '/secret.glb' }, families), null);
  assert.equal(tileModel({ ...props, front: '__proto__' }, families), null);
  assert.equal(tileModel({ tile: '__proto__' }, families), null);
  assert.equal(tileModel({ tile: { toString: null, valueOf: null } }, families), null);
  assert.equal(tileModel({ ...props, geom: { shape: 'hex' } }, families), null);
  assert.equal(Object.isFrozen(TILE_MODELS.domino.faces), true);
});

test('generic appearance respects family defaults, private overrides and neutral default capture', () => {
  const props = { tile: 'mahjong', tileAppearance: { base: 7, finish: 'glossy' } };
  assert.deepEqual(tileAppearanceOf(props, families), {
    base: 7,
    inset: 0x123456,
    finish: 'glossy',
  });
  const appearance = tileAppearanceProps(props, { tileAppearance: { inset: 9 } }, { families });
  assert.deepEqual(appearance, {
    tileAppearance: { base: 0xffffff, inset: 9, finish: 'original' },
  });
  assert.deepEqual(tileAppearanceProps({ tile: 'mahjong' }, undefined, { families }), {});
  assert.deepEqual(
    tileAppearanceProps({ tile: 'mahjong' }, undefined, { families, includeDefaults: true }),
    { tileAppearance: families.mahjong.defaults },
  );
  assert.deepEqual(
    tileAppearanceProps({ ...props, tileAppearance: { url: '/secret.glb' } }, undefined, {
      families,
    }),
    {},
  );
});

test('generic recolor messages preserve legacy domino storage and reject ambiguous patches', () => {
  const props = { tile: 'domino', dominoAppearance: { inset: 3, finish: 'glossy' } };
  const patch = { tileAppearance: { base: 2 } };
  assert.deepEqual(colorProps('card', props, patch).dominoAppearance, {
    base: 2,
    inset: 3,
    finish: 'glossy',
  });
  assert.deepEqual(recolorPayload({ id: '1', ...patch }), { id: '1', ...patch });
  assert.deepEqual(groupRecolor({ ids: ['1'], ...patch }), { ids: ['1'], ...patch });
  for (const bad of [
    { ...patch, dominoAppearance: { inset: 1 } },
    { tileAppearance: { finish: 'custom' } },
    { tileAppearance: { model: '/secret.glb' } },
    { tileAppearance: {} },
    { ...patch, color: 1 },
  ]) {
    assert.equal(colorProps('card', props, bad), null);
    assert.equal(groupRecolor({ ids: ['1'], ...bad }), null);
  }
  assert.equal(colorProps('card', { tile: 'mahjong' }, patch), null); // wait for real registration
});

test('generic private entry metadata survives draw, inspection return and snapshots', () => {
  const tileAppearance = { base: 4, inset: 8, finish: 'satin' };
  const entry = absorbedEntry('mahjong:bam1', 'mahjong:back', 'mahjong:back', { tileAppearance });
  const draw = takeTopCard({ type: 'deck' }, [entry]);
  assert.deepEqual(draw.tileAppearance, tileAppearance);
  const geo = { tile: 'mahjong', tileAppearance };
  assert.deepEqual(inspectedEntry({ front: draw.front, geo }), entry);
  assert.deepEqual(deckSpawnProps(geo, [entry]).tileAppearance, tileAppearance);
  assert.deepEqual(JSON.parse(JSON.stringify(entry)), entry);
  assert.equal(absorbedEntry('A', 'back', 'back'), 'A');
  assert.equal(absorbedEntry('A', 'back', 'back', null), 'A');
  assert.equal(inspectedEntry({ front: 'A', geo: null }), 'A');
});

test('generic bag patches retain differently colored legacy entries and bag colors', () => {
  const piece = { type: 'deck', props: JSON.stringify({ tile: 'domino', color: '#456789' }) };
  const cards = [
    { front: 'domino:1:2', dominoAppearance: { base: 9, inset: 8, finish: 'satin' } },
    'domino:0:0',
  ];
  const room = { state: { pieces: new Map([['1', piece]]) }, deckCards: new Map([['1', cards]]) };
  assert.equal(recolorPiece(room, '1', { tileAppearance: { inset: 5 } }), true);
  assert.deepEqual(cards[0].dominoAppearance, { base: 9, inset: 5, finish: 'satin' });
  assert.equal(cards[1], 'domino:0:0');
  assert.equal(JSON.parse(piece.props).color, '#456789');
  assert.equal(JSON.parse(piece.props).dominoAppearance.inset, 5);
});

test('the shared renderer loads and fits a second family, deduplicates and owns material clones', async () => {
  const requests = [],
    fits = [];
  const template = new THREE.Group();
  template.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ name: 'body' }),
    ),
  );
  const renderer = createTileRenderer({
    THREE,
    modelOf: (props) => tileModel(props, families),
    loader: {
      async loadAsync(url) {
        requests.push(url);
        return { scene: template };
      },
    },
    fitModel(obj, opts) {
      fits.push(opts.size);
      obj.scale.set(...opts.size);
    },
    paintMesh(node, props) {
      node.material = node.material.clone();
      node.material.color.setHex(tileAppearanceOf(props, families).base);
    },
    dispose(root) {
      root.userData.ottDisposed = true;
    },
  });
  const fallback = () => new THREE.Group();
  const props = { tile: 'mahjong', front: 'mahjong:bam1' };
  const a = renderer.mesh({ ...props, tileAppearance: { base: 2 } }, fallback);
  const b = renderer.mesh({ ...props, tileAppearance: { base: 3 } }, fallback);
  a.castShadow = true;
  let loaded = false;
  a.addEventListener('tileModelLoaded', () => {
    loaded = true;
  });
  assert.deepEqual(await Promise.all([a.userData.tileModelReady, b.userData.tileModelReady]), [
    true,
    true,
  ]);
  assert.equal(requests.length, 1);
  assert.equal(loaded, true);
  const { hw, hh, th } = cardGeom(props);
  assert.deepEqual(fits, [
    [hw * 2, th * 2, hh * 2],
    [hw * 2, th * 2, hh * 2],
  ]);
  const ma = a.children[0].children[0],
    mb = b.children[0].children[0];
  assert.equal(ma.geometry, mb.geometry);
  assert.equal(ma.castShadow, true);
  assert.notEqual(ma.material, mb.material);
  assert.equal(ma.material.color.getHex(), 2);
  assert.equal(mb.material.color.getHex(), 3);
  const plain = fallback();
  assert.equal(
    renderer.mesh({ tile: 'letter' }, () => plain),
    plain,
  );
});
