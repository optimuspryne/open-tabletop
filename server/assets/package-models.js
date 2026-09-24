import { isDeepStrictEqual } from 'node:util';
import { AssetPackageError } from '../../shared/asset-package.js';
import { COLLIDER_TYPES } from '../../shared/collider-spec.js';
import { propRecordPayload } from '../message-validation.js';

// Saved object definitions only: never export live dispenser inventory or room state.
// Validate with placeholder URLs before visiting typed package refs, as boards do.
export async function mapPropReferences(data, resolve) {
  const invalid = () => {
    throw new AssetPackageError('Unsupported model object metadata.');
  };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return invalid();
  const check = { ...data, model: '/assets/props/000000000000000000.glb' };
  if (data.dispenser?.appearance === 'custom')
    check.dispenser = { ...data.dispenser, model: check.model };
  const clean = propRecordPayload(check, { colliders: COLLIDER_TYPES });
  if (!clean || !isDeepStrictEqual(check, clean)) return invalid();
  const result = { ...data, model: await resolve(data.model, true) };
  if (data.dispenser?.appearance === 'custom')
    result.dispenser = { ...data.dispenser, model: await resolve(data.dispenser.model, true) };
  return result;
}
