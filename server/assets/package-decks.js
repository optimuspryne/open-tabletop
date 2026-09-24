import { ASSET_PACKAGE, AssetPackageError } from '../../shared/asset-package.js';
import { DECK_MODELS, sanitizeGeom } from '../../shared/pieces.js';
import { deckBeginPayload } from '../message-validation.js';

const invalid = (message) => {
  throw new AssetPackageError(message);
};
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys) =>
  object(value) && Object.keys(value).every((key) => keys.includes(key));

// These tags are rendered locally by parseCardFront. Preserve their authored text verbatim;
// they are never interpreted as network/file references by the package resolver.
export function generatedDeckReference(ref) {
  return (
    typeof ref === 'string' &&
    ref.length < ASSET_PACKAGE.maxReferenceChars &&
    (['back', 'domback', 'lback', 'mjback'].includes(ref) ||
      /^(text:|tback:|rank:|joker:|domino:|letter:)/.test(ref))
  );
}
export function packageDeckMetadata(asset) {
  const geom = asset.geom;
  if (geom !== null) {
    const clean = sanitizeGeom(geom);
    if (
      !only(geom, ['w', 'h', 't', 'round', 'shape']) ||
      !clean ||
      Object.keys(geom).some((key) => geom[key] !== clean[key])
    )
      invalid('Unsupported deck geometry.');
  }
  const metadata = deckBeginPayload(
    {
      back: 'back',
      geom,
      open: asset.open,
      deckModel: asset.deckModel,
      color: asset.color,
      textColor: asset.textColor,
    },
    {
      refOk: generatedDeckReference,
      sanitizeGeom,
      deckModels: Object.keys(DECK_MODELS),
    },
  );
  if (!metadata) invalid('Unsupported deck shape, skin or colors.');
  delete metadata.back;
  return metadata;
}

// One traversal serves export dependency discovery, preview validation and import remapping.
// A bare reference shares the deck back; a paired entry keeps its own back and its position.
export async function mapDeckReferences(asset, resolve) {
  if (
    !Array.isArray(asset.fronts) ||
    !asset.fronts.length ||
    asset.fronts.length > ASSET_PACKAGE.maxCards
  )
    invalid(`A deck must contain 1–${ASSET_PACKAGE.maxCards} cards or tiles.`);
  let characters = 0;
  const boundedResolve = (ref) => {
    characters +=
      typeof ref === 'string'
        ? ref.length
        : typeof ref?.generated === 'string'
          ? ref.generated.length
          : 0;
    if (characters > ASSET_PACKAGE.maxGeneratedChars)
      invalid('The deck exceeds 2 MiB of face-reference text.');
    return resolve(ref);
  };
  const back = await boundedResolve(asset.back),
    fronts = [];
  for (const entry of asset.fronts) {
    if (object(entry) && (Object.hasOwn(entry, 'front') || Object.hasOwn(entry, 'back'))) {
      if (
        !only(entry, ['front', 'back']) ||
        !Object.hasOwn(entry, 'front') ||
        !Object.hasOwn(entry, 'back')
      )
        invalid('Unsupported card metadata. Each paired card must contain only front and back.');
      fronts.push({
        front: await boundedResolve(entry.front),
        back: await boundedResolve(entry.back),
      });
    } else fronts.push(await boundedResolve(entry));
  }
  return { back, fronts };
}
