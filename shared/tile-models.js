// Authored tile families extend the existing card/deck engine. Keep the face allowlist,
// neutral concealed model, material slots and appearance defaults together. Dimensions
// remain in TILES/cardGeom so rendering and physics use the same source of truth.
const dominoRoot = '/models/pieces/dominoes/';
const mahjongRoot = '/models/pieces/mahjong/';
const mahjongFaces = {};
const mahjongLabels = {};
const suitLabels = { char: 'Characters', bam: 'Bamboo', cir: 'Dots' };
for (const [ref, model] of Object.entries({ char: 'Man', bam: 'Sou', cir: 'Pin' }))
  for (let rank = 1; rank <= 9; rank++) {
    mahjongLabels[`/mahjong/faces/${ref}${rank}.png`] = `${suitLabels[ref]} ${rank}`;
    mahjongFaces[`/mahjong/faces/${ref}${rank}.png`] = Object.freeze({
      url: mahjongRoot + model + rank + '.glb',
      turn: false,
    });
  }
const honorLabels = {
  windE: 'East wind',
  windS: 'South wind',
  windW: 'West wind',
  windN: 'North wind',
  dragR: 'Red dragon',
  dragG: 'Green dragon',
  dragW: 'White dragon',
  flowPlum: 'Plum',
  flowOrchid: 'Orchid',
  flowChrys: 'Chrysanthemum',
  flowBamboo: 'Bamboo',
  seasSpring: 'Spring',
  seasSummer: 'Summer',
  seasFall: 'Autumn',
  seasWinter: 'Winter',
};
for (const [ref, model] of Object.entries({
  windE: 'Ton',
  windS: 'Nan',
  windW: 'Shaa',
  windN: 'Pei',
  dragR: 'Chun',
  dragG: 'Hatsu',
  dragW: 'Haku',
  flowPlum: 'Flower1_Plum',
  flowOrchid: 'Flower2_Orchid',
  flowChrys: 'Flower3_Chrysanthemum',
  flowBamboo: 'Flower4_Bamboo',
  seasSpring: 'Season1_Spring',
  seasSummer: 'Season2_Summer',
  seasFall: 'Season3_Autumn',
  seasWinter: 'Season4_Winter',
})) {
  mahjongLabels[`/mahjong/faces/${ref}.png`] = honorLabels[ref];
  mahjongFaces[`/mahjong/faces/${ref}.png`] = Object.freeze({
    url: mahjongRoot + model + '.glb',
    turn: false,
  });
}
Object.freeze(mahjongLabels);

// Saved face IDs retain their historical spelling; active faces no longer require PNG files.
// Only these two old flower identities still use raster art because no supplied GLB matches them.
export const LEGACY_MAHJONG_FACE_URLS = Object.freeze([
  '/mahjong/faces/flowLotus.png',
  '/mahjong/faces/flowPeony.png',
]);

export function mahjongFaceLabel(ref) {
  return typeof ref === 'string' && Object.hasOwn(mahjongLabels, ref) ? mahjongLabels[ref] : null;
}
const dominoFaces = {};
for (let a = 0; a <= 6; a++)
  for (let b = 0; b <= 6; b++)
    dominoFaces[`domino:${a}:${b}`] = Object.freeze({
      url: dominoRoot + `Domino_${Math.min(a, b)}_${Math.max(a, b)}.glb`,
      turn: a > b,
    });

export const TILE_MODELS = Object.freeze({
  mahjong: Object.freeze({
    name: 'Mahjong',
    appearanceKey: 'tileAppearance',
    // sRGB equivalents of the authored linear ivory/green materials. The inset
    // storage slot colors the back; multicolored engraved symbols retain their colors.
    defaults: Object.freeze({ base: 0xefead8, inset: 0x166f55, finish: 'original' }),
    materialSlots: Object.freeze({ base: 'base', inset: 'back' }),
    colorLabels: Object.freeze({ base: 'Base', inset: 'Back' }),
    concealed: mahjongRoot + 'concealed.glb',
    faces: Object.freeze(mahjongFaces),
  }),
  domino: Object.freeze({
    name: 'Domino',
    // Retain this saved property for existing dominoes; new families use tileAppearance.
    appearanceKey: 'dominoAppearance',
    defaults: Object.freeze({ base: 0xe7e2cc, inset: 0x000000, finish: 'original' }),
    materialSlots: Object.freeze({ base: 'base', inset: 'inset' }),
    concealed: dominoRoot + 'Domino_Concealed.glb',
    faces: Object.freeze(dominoFaces),
  }),
});

export function tileModelFamily(props = {}, families = TILE_MODELS) {
  return props && typeof props.tile === 'string' && Object.hasOwn(families, props.tile)
    ? families[props.tile]
    : null;
}

// Only an authorized public front selects an identifying model. This never examines
// a back ref, private entry, model URL from a payload, or other concealed-face hint.
export function tileModel(props = {}, families = TILE_MODELS) {
  const family = tileModelFamily(props, families);
  if (!family || props.geom?.shape === 'hex') return null;
  if (!props.front) return { url: family.concealed, turn: false, down: false };
  if (typeof props.front !== 'string' || !Object.hasOwn(family.faces, props.front)) return null;
  return { ...family.faces[props.front], down: !!(props.open && props.down) };
}
