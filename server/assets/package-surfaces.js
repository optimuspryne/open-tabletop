import { isDeepStrictEqual } from 'node:util';
import { AssetPackageError } from '../../shared/asset-package.js';
import { BOARDS, sanitizeMatGeom } from '../../shared/pieces.js';
import { boardRecordPayload } from '../message-validation.js';

const invalid = () => {
  throw new AssetPackageError('Unsupported board, mat or skybox metadata.');
};
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

// Saved skyboxes use a URL or an encoded cubemap; packages give the variant explicit fields.
export function surfaceSourceData(kind, source) {
  if (kind === 'board') return source.rec;
  if (kind === 'mat') return { tex: source.tex, geom: source.geom };
  if (typeof source.url !== 'string') return invalid();
  if (!source.url.startsWith('{')) return { type: 'equirect', url: source.url };
  let cube;
  try {
    cube = JSON.parse(source.url);
  } catch {
    return invalid();
  }
  if (!exact(cube, ['t', 'f']) || cube.t !== 'cube') return invalid();
  return { type: 'cube', faces: cube.f };
}

// Shared traversal for export, inspection and import. Reuse gameplay validators, refusing
// lossy normalization so authored geometry/collider details cannot silently disappear.
export async function mapSurfaceReferences(kind, data, resolve) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return invalid();
  if (kind === 'board') {
    const check = { ...data };
    if (Object.hasOwn(data, 'model')) check.model = '/assets/boards/000000000000000000.glb';
    if (Object.hasOwn(data, 'tex')) check.tex = '/assets/boards/000000000000000000.png';
    const clean = boardRecordPayload(check, { boardKeys: Object.keys(BOARDS) });
    if (!clean || !isDeepStrictEqual(check, clean)) return invalid();
    const result = { ...data };
    if (Object.hasOwn(data, 'model')) result.model = await resolve(data.model, true);
    if (Object.hasOwn(data, 'tex')) result.tex = await resolve(data.tex, false);
    return result;
  }
  if (kind === 'mat') {
    const clean = sanitizeMatGeom(data.geom);
    if (
      !exact(data, ['tex', 'geom']) ||
      !data.geom ||
      !clean ||
      Object.keys(data.geom).some((key) => !isDeepStrictEqual(data.geom[key], clean[key]))
    )
      return invalid();
    return { geom: data.geom, tex: await resolve(data.tex, false) };
  }
  if (kind !== 'sky') return invalid();
  if (data.type === 'equirect' && exact(data, ['type', 'url']))
    return { type: data.type, url: await resolve(data.url, false) };
  if (
    data.type !== 'cube' ||
    !exact(data, ['type', 'faces']) ||
    !Array.isArray(data.faces) ||
    data.faces.length !== 6
  )
    return invalid();
  const faces = [];
  for (const face of data.faces) faces.push(await resolve(face, false));
  return { type: 'cube', faces };
}

export function surfaceStorageData(kind, data) {
  if (kind === 'board') return { rec: data };
  if (kind === 'mat') return data;
  return { url: data.type === 'cube' ? JSON.stringify({ t: 'cube', f: data.faces }) : data.url };
}
