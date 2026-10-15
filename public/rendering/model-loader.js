import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '../vendor/meshoptimizer/meshopt_decoder_reference.js';
import { BUILTIN_MODEL_URLS } from './builtin-model-assets.js';

const bundledURLs = new Set(BUILTIN_MODEL_URLS);

// Bundled GLBs keep their canonical public filenames. Other refs retain the
// ordinary loader; untrusted uploads never select the bundled decoder.
export function createModelLoader() {
  const original = new GLTFLoader();
  const bundled = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return {
    load(url, onLoad, onProgress, onError) {
      return (bundledURLs.has(url) ? bundled : original).load(url, onLoad, onProgress, onError);
    },
    loadAsync(url, onProgress) {
      return (bundledURLs.has(url) ? bundled : original).loadAsync(url, onProgress);
    },
  };
}
