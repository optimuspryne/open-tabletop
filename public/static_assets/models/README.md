# Bundled lossless GLBs

The app ships one GLB per model, at the existing canonical `/models/...` URL.
All 215 bundled GLBs use the approved lossless encoding: **161,498,564 bytes**,
versus 265,712,232 bytes before compression (39.2% smaller before HTTP encoding).
The extra uncompressed app copies and temporary `lossless/` / `-lossless.glb`
paths have been removed at the owner's request. Blender sources and authoring
exports remain in the separate asset workspace; they are not deployed.

`manifest.json` records canonical URLs, source/export hashes, final hashes/sizes,
validator results, decoded buffer/image fingerprints and browser material,
hierarchy and animation baselines. `public/rendering/builtin-model-assets.js`
registers exact bundled URLs for `createModelLoader()` and its CSP-safe Meshopt
JavaScript decoder. Other URLs use the ordinary GLTFLoader. No WASM/eval
permission, worker, new service or app build step is required.

## Adding or replacing a bundled asset

1. Export a normal `.glb` from Blender with authored UVs, embedded textures and
   meaningful material/node names. Keep the `.blend` and source export in
   `Open-Tabletop_Asset_Builders`, outside the app's static asset directory.
2. From the repository root, set up the versioned **offline authoring** tools
   once (Node 24 and a local Chrome/Chromium are needed). This does not install
   app runtime dependencies:

   ```sh
   npm ci --prefix tools/model-authoring
   ```

3. Publish one export using a path relative to `public/static_assets/models/`:

   ```sh
   node tools/model-authoring/publish.mjs "/path/to/new-model.glb" "pieces/misc/new-model.glb"
   ```

   Use letters, digits, underscores or hyphens in the target path. For a room
   model, use e.g. `environments/cozy/new-plant.glb`. Reuse an existing path to
   replace an existing model. The input file must stay outside the app models
   tree. The app defaults to the repository containing the publisher, independently
   of the current working directory. Set `TABLETOP_ROOT` for another checkout,
   `GLTF_TOOLS` for a separate installed authoring-tools directory, or `CHROME_BIN`
   if Chrome is not discovered automatically.

   The publisher checks supported extensions, uses Meshopt without quantization,
   simplification, welding or vertex reordering, and accepts lossless WebP only
   when smaller and decoded RGBA bytes are identical. It retains original image
   encoding otherwise, or the complete source GLB if compression would increase
   its size. It verifies mesh/morph data, oriented triangles, material settings,
   images, animation accessors and skin matrices; then compares source/candidate
   materials, hierarchy, animation and actual image pixels in two strict-CSP
   browser/GPU profiles. Failed verification publishes no app files.

   On success it writes exactly one final GLB and updates `manifest.json` and the
   bundled decoder allowlist. The source export is unchanged. Temporary candidates
   are cleaned up. Unknown extensions or unsupported geometry fail explicitly.

4. Register how the app uses a **new** asset: a gameplay model belongs in its
   existing shared catalog; scenery belongs in the appropriate room theme's
   assets/placement. Compression alone does not add a library card, gameplay type
   or room placement. Keep existing named tint slots; check normalization/scale,
   colliders and snapping when applicable. Add its provenance/license to
   `docs/ASSET_CREDITS.md` and required in-app attribution. UI additions follow
   the project's mock-up approval rules. A replacement at the same URL normally
   keeps its current registration.
5. From the app checkout run:

   ```sh
   npm run check
   npm run test:models
   ```

   Run relevant component checks for gameplay previews/room integration, and
   `npm run assets:colliders` for measured physical models. The collider tool
   reads preserved JSON bounds/transforms and works with compressed GLBs.
   Inspect the result on desktop and a real Android device, including cold load,
   close-up materials, tinting, shadows, previews and room switching. Compression
   reduces file bytes, not decoded GPU memory. Refresh clients; no restart or
   migration is needed for an asset-only replacement.

The process above is for **bundled** models. In-app custom GLB uploads still use
an ordinary loader without Meshopt support; keep ordinary exports for that path.

## Verification and provenance

Normal tests use frozen hash/decoded fingerprints and the recorded browser
baseline, so uncompressed comparison copies are not needed in the app. Publishing
performs the full source/candidate comparison before replacing these baselines.
Source licenses/attributions still apply to all encoded files; see
`docs/ASSET_CREDITS.md`. Seven existing models retain 16 pre-existing tangent-space
warnings; current exports have zero validator errors. Source/export size and
hash fields describe the validated input, not a second deployed file.

The canonical publisher and pinned dependency lockfile are versioned under
[`tools/model-authoring/`](../../../tools/model-authoring/README.md). Historical
compression reports/studies remain in the separate authoring workspace.
Do not rerun the earlier all-model batch workflow against already compressed app
files. Use `publish.mjs` with the original authoring export for each replacement.

## Local room asset organization (October 19, 2026)

The eleven reviewed room packages are consolidated in companion `3d_models/rooms/`, with `source/`, `exports/{raw,runtime,textures}/`, `previews/`, `provenance/` and theme-specific or shared tools. Preserved raw files are the exact canonical publisher inputs; re-export float/tangent rounding can vary. See the package manifest and verifier for file integrity. [Open the final-room index](../../../../Open-Tabletop_Asset_Builders/3d_models/rooms/README.md).

### Earlier room sources relocated (October 19, 2026)

Cozy, Poker Night, Medieval Tavern and Modern Bar now share the same companion `3d_models/rooms/<theme-id>/` organization as the eleven newer themes. Their final furnishings, corrected windows/lighting, ceiling and rear-wall sources are together, with original publisher inputs, runtime copies, maps and review/provenance records. The accepted gray pup master and scenery derivative live once under `rooms/_shared/gray-pup-in-bed/`. Original owner sources and approval inputs are retained; superseded drafts, backups, redundant ZIP bundles and unused compression candidates were removed. Old package names elsewhere in dated records describe history. [Current source index](../../../../Open-Tabletop_Asset_Builders/3d_models/rooms/README.md). The app model files/manifest/registry are unchanged.
