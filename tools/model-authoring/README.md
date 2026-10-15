# Lossless GLB authoring

This is the repository's canonical copy of the verified offline publisher, migrated
from `Open-Tabletop_Asset_Builders/3d_models/original/builtin_lossless_v1/`.
The scripts, dependency manifest and complete lockfile are versioned here. Blender
masters, source exports and historical comparison renders remain in the separate
asset workspace. Installed `node_modules/` is ignored; Docker excludes this folder.
The app needs no authoring dependency or build step at runtime.

From the repository root, using Node 24 and a local Chrome/Chromium:

```sh
npm ci --prefix tools/model-authoring
node tools/model-authoring/publish.mjs "/path/to/export.glb" "pieces/misc/new-model.glb"
```

The target is relative to `public/static_assets/models/`. The app checkout defaults
to the repository containing this script, independently of the current working
directory. Set `TABLETOP_ROOT` for another checkout, `GLTF_TOOLS` for another
installed authoring-tool directory, or `CHROME_BIN` for Chrome discovery.

`compress.mjs` exports the existing `compressAsset` implementation. It preserves
full-precision geometry/UVs, oriented triangles, morphs, material settings, image
pixels, animation data and skin matrices. It accepts lossless WebP only if smaller
and pixel-identical, otherwise retaining the original encoding. It retains the
complete original GLB if that is smaller. Unsupported extensions/geometry fail
before publication. The explicit Sharp 0.34.5 pin matches the original validated
compression environment; the root app's separate Sharp dependency is unchanged.

`publish.mjs` reuses the app's integrity helpers and strict-CSP browser comparator.
It compares source/candidate materials, hierarchy, animation, exact browser pixels
and GPU rendering in desktop/touch profiles. Only after success does it write the
one canonical GLB, update `models/manifest.json`, and regenerate the bundled URL
allowlist. Source exports must be outside the app models tree and remain unchanged;
temporary candidates are cleaned up. No automatic gameplay type or room placement
is added. Original Blender files are never modified.

Follow the [complete model workflow](../../public/static_assets/models/README.md)
for catalog/theme registration, credits, scale/colliders and desktop/Android QA.
After publishing, run `npm run check` and `npm run test:models` from the app root,
and relevant room/gameplay component checks. In-app custom uploads still use
ordinary GLBs; this tool prepares bundled assets.

The scripts are Open Tabletop authoring code under the repository license.
Third-party tool packages retain their own licenses; their pinned dependency tree
is recorded in `package-lock.json`. No compression package or browser executable is
copied into the repository or production image.
