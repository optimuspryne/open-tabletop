// node publish.mjs /path/to/export.glb pieces/misc/new-token.glb
import { readFile, writeFile, mkdir, mkdtemp, rm, rename } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { compressAsset } from './compress.mjs';
const [sourceArg, targetArg, ...extra] = process.argv.slice(2);
if (!sourceArg || !targetArg || extra.length)
  throw Error('Usage: node publish.mjs SOURCE.glb pieces/misc/name.glb');
const source = resolve(sourceArg);
const app = resolve(process.env.TABLETOP_ROOT || resolve(import.meta.dirname, '../..'));
const modelRoot = resolve(app, 'public/static_assets/models');
if (!/^[a-z0-9_/-]+\.glb$/i.test(targetArg) || targetArg.split('/').includes('..'))
  throw Error('Use a relative models path with letters, digits, underscores or hyphens');
const target = resolve(modelRoot, targetArg);
if (!target.startsWith(modelRoot + sep) || source.startsWith(modelRoot + sep))
  throw Error('Keep the source export outside the app models folder');
const { modelIntegrity, modelHash } = await import(
  pathToFileURL(resolve(app, 'scripts/lib/model-integrity.mjs'))
);
const { input, output, validation } = await compressAsset(source);
const temporary = await mkdtemp(resolve(tmpdir(), 'tabletop-model-'));
try {
  const candidate = resolve(temporary, 'candidate.glb'),
    baseline = resolve(temporary, 'browser.json');
  await writeFile(candidate, output);
  // Validate raw source/candidate materials, pixels, hierarchy, animations and GPU rendering
  // in both strict-CSP browser profiles before publishing any app file.
  execFileSync(
    process.execPath,
    [resolve(app, 'scripts/model-assets-test.mjs'), '--prepare', source, candidate, baseline],
    { cwd: app, stdio: 'inherit' },
  );
  const browser = JSON.parse(await readFile(baseline));
  const integrity = await modelIntegrity(output);
  const manifestFile = resolve(modelRoot, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestFile));
  const url = '/models/' + targetArg;
  const row = {
    source: url,
    url,
    originalBytes: input.length,
    bytes: output.length,
    originalSha256: modelHash(input),
    sha256: modelHash(output),
    images: integrity.images.length,
    meshes: integrity.meshes,
    animations: integrity.animations,
    validation,
    integrity,
    browserSha256: browser.browserSha256,
  };
  const index = manifest.findIndex((r) => r.url === url);
  if (index < 0) manifest.push(row);
  else manifest[index] = row;
  manifest.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  // Ready-to-review artifact and registrations; no source or Blender file is changed.
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target + '.tmp', output);
  await rename(target + '.tmp', target);
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  const registry =
    '// Generated from models/manifest.json by the offline asset publisher.\nexport const BUILTIN_MODEL_URLS = Object.freeze([\n' +
    manifest.map((r) => "  '" + r.url + "',").join('\n') +
    '\n]);\n';
  await writeFile(resolve(app, 'public/rendering/builtin-model-assets.js'), registry);
  console.log('Published', url, input.length, '->', output.length, 'bytes; source unchanged.');
  console.log(
    'Next: register intended catalog/room usage, credits, run npm run check and npm run test:models, then inspect on desktop and Android.',
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
