import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { TILE_MODELS, MAHJONG, tileModel, cardPublicProps, colorProps } from '../shared/pieces.js';
import { createDeckBuilders } from '../server/game/deck-builders.js';
import { validateGlb } from '../server/assets/upload-validation.js';
import { absorbedEntry, takeTopCard, inspectedEntry } from '../server/deck-state.js';
import { recolorPiece } from '../server/game/piece-operations.js';

const directory = new URL('../public/static_assets/models/pieces/mahjong/', import.meta.url);
const family = TILE_MODELS.mahjong;

test('all Mahjong faces in the default inventory map to valid standalone GLBs', () => {
  const { cards } = createDeckBuilders({ shuffle: (cards) => cards }).buildMahjongWall();
  const fronts = new Set(cards);
  assert.equal(fronts.size, 34);
  assert.deepEqual(
    new Set(Object.keys(family.faces)),
    new Set([...fronts, ...MAHJONG.bonus.map((id) => MAHJONG.base + id + '.png')]),
  );
  assert.equal(readdirSync(directory).length, 46); // standard set, reserved red fives, eight bonus models
  for (const file of readdirSync(directory))
    assert.equal(validateGlb(readFileSync(new URL(file, directory))).ok, true, file);
  for (const url of [family.concealed, ...Object.values(family.faces).map((face) => face.url)]) {
    const file = url.split('/').at(-1);
    assert.equal(validateGlb(readFileSync(new URL(file, directory))).ok, true, file);
  }
  for (const suit of ['Man', 'Pin', 'Sou'])
    assert.equal(validateGlb(readFileSync(new URL(`${suit}5-Dora.glb`, directory))).ok, true);
  assert.equal(Object.isFrozen(family.faces), true);
  assert.equal(
    Object.values(family.faces).some((face) => /Dora/.test(face.url)),
    false,
  );
});

test('Mahjong model selection conceals faces, maps bonuses and preserves old flower identities', () => {
  assert.equal(
    tileModel({ tile: 'mahjong', back: MAHJONG.base + 'bam1.png' }).url,
    family.concealed,
  );
  assert.equal(tileModel({ tile: 'mahjong', front: '/secret.glb' }), null);
  assert.equal(tileModel({ tile: 'mahjong', front: '__proto__' }), null);
  assert.equal(tileModel({ tile: 'mahjong', geom: { shape: 'hex' } }), null);
  for (const bonus of MAHJONG.bonus)
    assert.ok(tileModel({ tile: 'mahjong', front: MAHJONG.base + bonus + '.png' }));
  for (const legacy of ['flowLotus', 'flowPeony'])
    assert.equal(tileModel({ tile: 'mahjong', front: MAHJONG.base + legacy + '.png' }), null);
  assert.match(
    tileModel({ tile: 'mahjong', front: MAHJONG.base + 'flowPlum.png' }).url,
    /Flower1_Plum/,
  );
  assert.match(
    tileModel({ tile: 'mahjong', front: MAHJONG.base + 'flowBamboo.png' }).url,
    /Flower4_Bamboo/,
  );
  const white = tileModel({ tile: 'mahjong', front: MAHJONG.base + 'dragW.png' });
  assert.match(white.url, /Haku\.glb$/);
  assert.equal(
    tileModel({ tile: 'mahjong', front: MAHJONG.base + 'windE.png', open: true, down: true }).down,
    true,
  );
  const bytes = readFileSync(new URL('concealed.glb', directory));
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  assert.deepEqual(gltf.materials.map((material) => material.name).sort(), ['back', 'base']);
  assert.equal(gltf.meshes.length, 1);
  assert.equal(
    gltf.nodes.every((node) => node.name.startsWith('concealed')),
    true,
  );
});

test('Mahjong colors survive hands and returns; recoloring only changes remaining inventory', () => {
  const front = MAHJONG.base + 'bam1.png';
  const tileAppearance = { base: 0x123456, inset: 0xabcdef, finish: 'satin' };
  const entry = absorbedEntry(front, 'mjback', 'mjback', { tileAppearance });
  const draw = takeTopCard({ type: 'deck', count: 1 }, [entry]);
  const geo = cardPublicProps({ tile: 'mahjong' }, draw);
  assert.deepEqual(geo, { tile: 'mahjong', tileAppearance });
  assert.deepEqual(inspectedEntry({ front: draw.front, geo }), entry);
  assert.deepEqual(JSON.parse(JSON.stringify(entry)), entry);
  assert.deepEqual(colorProps('card', geo, { tileAppearance: { inset: 1 } }).tileAppearance, {
    ...tileAppearance,
    inset: 1,
  });
  const cards = [{ ...entry, tileAppearance: { ...tileAppearance } }, front];
  const piece = { type: 'deck', props: JSON.stringify({ tile: 'mahjong', color: '#456789' }) };
  const room = { state: { pieces: new Map([['1', piece]]) }, deckCards: new Map([['1', cards]]) };
  assert.equal(recolorPiece(room, '1', { tileAppearance: { inset: 5 } }), true);
  assert.equal(cards[0].tileAppearance.inset, 5);
  assert.equal(cards[1], front);
  assert.equal(JSON.parse(piece.props).color, '#456789');
  assert.equal(draw.tileAppearance.inset, tileAppearance.inset);
});
