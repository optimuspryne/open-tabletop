// Authored tile families extend the existing card/deck engine. Keep the face allowlist,
// neutral concealed model, material slots and appearance defaults together. Dimensions
// remain in TILES/cardGeom so rendering and physics use the same source of truth.
const dominoRoot = '/models/pieces/dominoes/';
const dominoFaces = {};
for (let a = 0; a <= 6; a++)
  for (let b = 0; b <= 6; b++)
    dominoFaces[`domino:${a}:${b}`] = Object.freeze({
      url: dominoRoot + `Domino_${Math.min(a, b)}_${Math.max(a, b)}.glb`,
      turn: a > b,
    });

export const TILE_MODELS = Object.freeze({
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
