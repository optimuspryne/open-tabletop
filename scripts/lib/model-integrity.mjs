// Offline verification fingerprints; no authoring dependencies enter the browser runtime.
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { MeshoptDecoder } from '../../public/vendor/meshoptimizer/meshopt_decoder_reference.js';
import { parseGLB, bufferViews } from './glb.mjs';

export const modelHash = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function modelIntegrity(bytes, decoder = MeshoptDecoder) {
  const glb = parseGLB(bytes);
  const views = bufferViews(glb, decoder);
  const images = [];
  for (const image of glb.json.images || []) {
    const { data, info } = await sharp(views[image.bufferView])
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    images.push({
      name: image.name ?? null,
      width: info.width,
      height: info.height,
      rgba: modelHash(data),
    });
  }
  return {
    views: views.map(modelHash),
    images,
    nodes: (glb.json.nodes || []).map(({ name }) => name ?? null),
    materials: (glb.json.materials || []).map(({ name }) => name ?? null),
    meshes: (glb.json.meshes || []).length,
    animations: (glb.json.animations || []).length,
  };
}
