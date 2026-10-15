import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { BUILTIN_MODEL_URLS } from '../public/rendering/builtin-model-assets.js';
import { modelHash, modelIntegrity } from '../scripts/lib/model-integrity.mjs';

const root = new URL('../public/static_assets/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('models/manifest.json', root)));
async function modelURLs(dir = new URL('models/', root), prefix = '/models/') {
  const urls = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory())
      urls.push(...(await modelURLs(new URL(entry.name + '/', dir), prefix + entry.name + '/')));
    else if (entry.name.endsWith('.glb')) urls.push(prefix + entry.name);
  }
  return urls.sort();
}

test('the bundle contains exactly the registered canonical GLBs, without duplicate originals', async () => {
  assert.deepEqual([...BUILTIN_MODEL_URLS].sort(), await modelURLs());
  assert.deepEqual(manifest.map((row) => row.url).sort(), await modelURLs());
  assert.equal(new Set(BUILTIN_MODEL_URLS).size, manifest.length);
});
for (const row of manifest) {
  test(`canonical model integrity: ${row.url}`, async () => {
    const bytes = await readFile(new URL(row.url.slice(1), root));
    assert.equal(modelHash(bytes), row.sha256);
    assert.equal(bytes.length, row.bytes);
    assert.deepEqual(await modelIntegrity(bytes), row.integrity);
    assert.equal(modelHash(bytes), row.sha256, 'Verification must not mutate the encoded payload');
    assert.deepEqual(
      await modelIntegrity(bytes),
      row.integrity,
      'Repeated decoding must be stable',
    );
    assert.match(row.browserSha256, /^[a-f0-9]{64}$/);
  });
}

test('all bundled geometry decodes without WebAssembly', async () => {
  const previousWasm = globalThis.WebAssembly;
  try {
    globalThis.WebAssembly = undefined;
    const { MeshoptDecoder } =
      await import('../public/vendor/meshoptimizer/meshopt_decoder_reference.js?no-wasm');
    await MeshoptDecoder.ready;
    for (const row of manifest) {
      const bytes = await readFile(new URL(row.url.slice(1), root));
      assert.deepEqual(await modelIntegrity(bytes, MeshoptDecoder), row.integrity, row.url);
    }
  } finally {
    globalThis.WebAssembly = previousWasm;
  }
});
