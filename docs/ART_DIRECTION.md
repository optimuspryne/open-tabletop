# Room asset material study

Status: the owner's fixed assets are exported and integrated into the Cozy game room,
now selected through Room Settings → Table Size & Color → Room style (October 15, 2026).
Earlier preview-link instructions below describe the prior prototype stages.
The authoritative source is the companion workspace's
`3d_models/original/BLEND/cozy_room_assets_fixed.blend`. Preserve the owner's edits:
do not regenerate this file from the original study builder.

`3d_models/original/cozy_room_v1/export_fixed_assets.py` opens the saved fixed file in
background Blender, evaluates its modifiers, batches by material, removes only the
original review-stage translations and writes `fixed/*.glb`. It never saves the source.
The export report records the source and GLB SHA-256 hashes. Chair/lamp bundles remain
byte-identical under `public/static_assets/models/environments/cozy/`; the shelf now
has separate approved UV and built-in collection derivatives described below.

The project owner's Go bowl, chess board and pouch are the chosen style references.
The goal is a consistent family of tangible wooden, ceramic and fabric objects:

- Use believable proportions, small bevels and material thickness before adding fine detail.
- Keep wood grain aligned to construction: long grain along legs and panels, with a
  consistent physical texture scale. Reuse the existing credited oak color texture.
- Use warm ivory, muted sage, rust and blue accents, with satin wood and restrained brass.
  Leave high-contrast detail to game pieces and other things people need to read.
- Use UV-based color, tangent-space normal and roughness maps that survive standard GLB
  export. Keep metallic values low for wood/fabric and reserve metalness for actual metal.
- Check exported models under the app's lighting as well as in Blender. A studio render
  alone does not establish their in-app appearance or device performance.
- Keep source materials editable, preserve originals, batch export geometry by material,
  and measure geometry, image sizes and draw calls before room integration.

The fixed set includes an upholstered oak chair, a game shelf and a linen floor lamp.
The initial furniture exports contained 19,648 triangles and 17 material batches, with
embedded 512px maps and UVs/tangents on every textured mesh. Blender source, build script,
desktop/narrow-view captures and the measured browser report are saved beside the exports.
The lamp is a visual model; it does not introduce another runtime light.

## Approved shell finish

The owner approved the plaster/oak/window mock-up with the explicit correction that
windows must be transparent and show the selected skybox. The implementation uses
fine warm plaster, staggered satin oak boards, moulded trim and inset oak casements
with hardware and projecting sills. There is no painted outdoor image. Clear alpha
glazing follows the existing native/rotated sky presentation, including Sky Off.

Editable shell source: companion `3d_models/original/room_shell_v1/cozy-room-shell.blend`.
`build_room_shell.py` creates the window GLB, six 512px maps and material swatches in
background Blender without opening/saving the owner's furniture source. The window
has 3,760 triangles and two material batches. `bundled-assets.json` records file hashes.
Runtime room dimensions remain adjustable: `cozy-room-surfaces.js` uses physical UVs
for plaster, one instanced bevelled board geometry with staggered/cropped seams, and
an extruded trim profile. Original materials/textures remain intact.

The owner reviewed and corrected the source before approving integration. Real-device
performance remains pending. Integration preserves the room's camera cutaways, table
clearance and rendering-only boundary, with a uniform seven room-units per metre;
see [Architecture](ARCHITECTURE.md) and [Reference](REFERENCE.md).

Asset provenance is recorded in [Asset Credits](ASSET_CREDITS.md).

## Approved plants and corrections

The owner approved the plant mock-up: two rubber plants in opposite floor corners,
two snake plants beside opposing walls, one trailing pothos on a window sill and one
on the bookcase. Variants share assets but have distinct rotation/scale. Leaves are
curved opaque double-sided meshes with UV-based vein/variegation, color, normal and
roughness maps. Pots have rounded rims and visible soil. Trailing vines face into the
room so they clear the wall/glass; wall-supported plants inherit cutaways. No objects
are added to the playable table and no new lights, input or gameplay state are added.

Editable botanical source: companion `3d_models/original/cozy_plants_v1/cozy-plants.blend`.
`build_plants.py` creates the three project-original models and embedded 512px maps
in background Blender. Rubber/snake/pothos exports contain 4,536 / 3,960 / 9,456
triangles and 4 / 3 / 4 material batches. The three downloads total about 7.6 MB;
each variant loads once per room build and its two copies share GPU resources.

The green wall patch was the original placeholder picture, whose face was coplanar
with the thicker plaster while its frame was buried. Both placeholder boxes are removed.
The shelf used the default cube `UVMap` despite also containing authored grain-aligned
`UVMap.001`; only a fraction of its 512px wood image covered each large board.
`cozy_plants_v1/export_shelf_uv.py` activates those existing oak UVs in a separate
`cozy-room-shelf-uv.blend` derivative and exports only the shelf. It preserves the
owner's saved source, surface geometry, materials, embedded images and alignments.
The client injects the existing renderer's anisotropy capability, capped at eight on
loaded model maps. Wood detail improves through correct UV density without upscaling
or replacing the source image.

## Approved built-in shelf collection

The owner approved the native Three.js layout with the dominoes box reduced by 50%
in each dimension. Top: blue/red decks, display ace, gold/silver coins and three chip
stacks. Middle: two Go bowls and loose stones in the retained tray. Lower: open
0.26-metre dominoes box, three upright dominoes and pouch. Bottom: retained baskets.
All 27 decorative groups are compiled into the existing shelf asset rather than
creating gameplay objects at runtime. The existing loader, placement, wall cutaways,
anisotropy and room-owned cleanup are reused without production JavaScript changes.

Editable source: companion `cozy_shelf_v2/cozy-game-shelf-collection.blend`. Its builder
opens the saved UV derivative in background Blender and never saves either that input
or the owner's fixed file. Coin/chip/Go-stone copies receive shelf-only detail reduction;
bowl shells and authored frame remain intact. Exact-material batching produces 29
meshes / 141,346 triangles, with 15 embedded images, 15,942,228 bytes. Required
`KHR_texture_transform` is supported by the existing loader; no external decoder is
needed. Export batching normalizes each mesh's active render UV into a common channel,
preserving card faces/backs, wood grain and basket weave across joined meshes.

Slice files/helpers:

- `public/static_assets/models/environments/cozy/cozy-game-shelf.glb` replaces only
  the compiled shelf; its README records current provenance, dimensions and hash.
- `scripts/component-parity.mjs` extends the existing production cozy bootstrap
  with an actual `ShelfDominoesBox` geometry check: longest extent 1.82 room units.
  No production helper, API, runtime registration or input path is added/removed.
- `CHANGELOG.md`, this file, `REFERENCE.md`, `ARCHITECTURE.md`, `ASSET_CREDITS.md`
  and `DEVICE_QA.md` document contents, ownership, reused sources and manual checks.
- Companion `cozy_shelf_v2/export_contents.mjs` uses the existing KIND builders
  and `item` placement helper to export the approved arrangement offline;
  `deduplicate_materials.py` consolidates equivalent glTF definitions;
  `build_shelf.py` adds `display_root`, shelf-only LOD and active-UV export batching;
  `validate_exports.py` verifies actual box geometry, UVs, source hashes, oak
  triangle corners and basket positions/counts (planar end caps retriangulate).
  `layout-manifest.json`, build/dedup/export reports, source and review captures
  preserve the reproduction evidence. Pinned Three r161 exporter utilities and
  their MIT license stay in the authoring workspace, outside the app.

Verification: `npm run check` passes all 1,050 tests and lint/format/CSS checks.
The focused production cozy bootstrap passes desktop and coarse-pointer 390px
profiles with the bundled shelf and half-size box. Browser captures cover seated,
wide, shelf close-up and phone views, with no page errors or missing assets. A
three-player seated view measures 89 draws / 202,490 triangles. These are software
browser measurements, not real-device performance approval. Real-device GPU/memory
and multiplayer smoke checks remain pending. Refresh the preview; no restart is needed.

## Android crash follow-up and coin detail

Reported symptom: cozy room loads, freezes, shows a black canvas, then a white crash
screen in both Android Chrome and Brave. No device logs or phone model are available.
GPU/context loss or memory pressure is plausible; the exact crash cause is unconfirmed.
The first stocked-shelf export carried large gameplay bag/box/bowl maps, including a
2048×2820 image. Its 15 unique decoded RGBA images plus estimated mipmaps totalled
about 80.0 MB. The smaller compressed file size concealed this cost.

The shelf builder now caps only derivative images at 512px before packing/exporting,
reducing that estimate to 17.7 MB (about 78% lower). Existing 512px oak/linen maps stay
at their authored size. This is an image-memory estimate, not measured total GPU or
process memory; geometry, duplicate GPU uploads and loading peaks are additional.
Original model/map files and owner/UV-source blends remain untouched.

The coins already used gameplay's coin-specific metal tuning: metalness 1,
roughness 0.3, but their gold/silver tints differed from the built-in palette. The
export now imports shared `METALS` for the canonical Gold/Silver colors. The earlier
eight-percent geometry LOD discarded relief and changed normals.
Each stack's top coin is now detached from the shared simplified mesh before welding
and retains its full authored geometry/normals; lower coins stay reduced. The shelf
now has 141,346 triangles, 29 batches and 15,942,228 bytes. The half-size box remains.

Changed files/helpers in this follow-up:

- `public/static_assets/models/environments/cozy/cozy-game-shelf.glb`: bounded maps
  and full-detail top coins; asset README updates hashes and export/memory statistics.
- `scripts/component-parity.mjs`: existing production fixture checks every loaded
  shelf texture's dimensions and both coin materials against gameplay tuning/colors.
- Companion `cozy_shelf_v2/export_contents.mjs`: imports shared `METALS` for
  Gold/Silver rather than using custom tint constants; optional `EXPORT_ONLY=1`
  skips the authoring screenshot while exporting the same native model layout.
- Companion `cozy_shelf_v2/build_shelf.py`: extends the existing build/LOD/image path
  with top-coin mesh detachment and packed derivative image caps; no runtime helper.
  `validate_exports.py` adds decoded-image budget and coin PBR assertions; source,
  build/export reports, README and review captures are updated.
- `CHANGELOG.md`, `REFERENCE.md`, `ARCHITECTURE.md`, `ASSET_CREDITS.md`,
  `DEVICE_QA.md` and this file record the mitigation, provenance and unconfirmed
  on-device status. No production JavaScript, server, input or UI control changes.

Verification: `npm run check` passes lint/format/CSS and all 1,050 tests. The
production cozy bootstrap passes on desktop/coarse-390, including actual image
sizes, both canonical coin colors/materials, half-size box and room/chair lifecycle.
`image-memory-comparison.json` records the independently decoded before/after images.

Actual bundled-asset captures retain card backs/ace, wood, linen and half-size box,
with no page errors or missing assets. The three-player seated render measures
89 draws / 202,490 triangles. Automated checks do not reproduce the reported Android
crash or prove it resolved; Chrome/Brave cold-load, orbit and repeated room rebuild
checks on the affected device remain required. Refresh the preview; no restart needed.

## Pixel 10 Pro phone shader fallback

The owner retried the texture-capped shelf and still saw a brief room, then a white
area/frowny icon in Chrome and Brave. UI buttons continued to respond. Device:
Pixel 10 Pro; whether an earlier cozy version worked is unknown. This narrows the
symptom to rendering but does not establish a driver/context-loss cause without logs.

Existing dice rendering already avoids physical/transparent/roughness-map finishes
on phones after Android black-screen reports. The cozy room had not applied a
comparable compatibility path: loaded shelf pieces used clearcoat/sheen, room
surfaces used per-pixel detail maps and windows used a physical material.

The client now injects the existing core device classifier into `createCozyRoom`.
Phones keep base artwork/alpha cutouts, colors, geometry, coin metalness 1/roughness 0.3,
positions and cutaways while using standard PBR without physical layers or detail
maps, anisotropy 1 and no scenery shadow reception. Procedural surfaces avoid their
unused detail-map downloads entirely. Clear sky openings remain, with almost-clear
panes hidden on phones; all glazing uses standard material because it needs no
physical-only feature. Desktop/tablet retain authored model layers/maps. This policy
is independent of saved graphics quality, like the dice fallback.

Reuse/ownership decision: extend the existing room factory and surface builder rather
than importing gameplay graphics/cache state. A focused `prepareModelMaterials`
helper handles remapping once per loaded model before cloning. It shares replacements
by source material and releases only replaced materials/discarded texture objects;
maps retained in another slot/material survive until room disposal. Late stale
callbacks still use existing hierarchy cleanup before any conversion.

Slice files/helpers:

- `public/client.js`: injects core's `deviceClass` into the existing room factory.
- `public/rendering/cozy-room.js`: extends factory options, `sync`, `windowPane`
  and the model callback; adds `prepareModelMaterials` for phone rendering and owned
  material/texture cleanup. Occupancy, geometry, state and asset loading APIs remain.
- `public/rendering/cozy-room-surfaces.js`: extends `createRoomMaterials` with a
  phone-safe option; skips detail-map loads and uses standard clear glazing.
- `test/cozy-room.js`: fixture accepts a device class; three regressions cover
  phone surface behavior, physical-to-standard conversion/shared resource disposal,
  retained base maps/alpha/coin tuning, and desktop/tablet detail preservation.
- `scripts/component-parity.mjs`: existing real cozy bootstrap now verifies phone
  material/shadow/pane policy and adapted base-map expectations, alongside existing
  canonical coin colors, asset dimensions, chairs and wall cutaways.
- `CHANGELOG.md`, `REFERENCE.md`, `ARCHITECTURE.md`, `DEVICE_QA.md` and this file
  document the reported failure, rendering policy, ownership and manual retry scope.

Verification: `npm run check` passes lint/format/CSS and all 1,053 tests, including
14 cozy-room tests. The focused production cozy bootstrap passes desktop/coarse-390,
including actual phone material/shadow/pane policy, retained canonical coin colors,
loading, chair lifecycle and cutaways. `cozy-window-sky` also passes both profiles:
actual sky pixels remain visible through standard glazing with panorama/cube
orientation and Sky Off. These are targeted WebGL checks; no DOM/input/layout changed.

Actual phone-touch emulation also renders seated, wide, shelf and close-up views
with no page errors/missing assets. The room reports zero physical materials,
detail-map materials, shadow receivers and visible glazing panes. Visual inspection
confirms retained wood/card art and clear sky openings. Captures/logs are saved as
`cozy-phone-safe-*` / `cozy-phone-shaders-*` in this chat's visualization workspace.

On October 15, 2026, the owner confirmed that this fallback fixed the reported
Pixel 10 Pro crash. This is an on-device user confirmation; browser-specific runs,
long-session GPU performance and the extended multiplayer/rebuild checklist were
not specified. The exact driver/shader failure remains unconfirmed without logs.
Desktop software WebGL fixtures verify branch selection and material/resource
behavior, independently of that device result. Confirmation-only documentation
updates touch `CHANGELOG.md`, `DEVICE_QA.md` and this file; no code changed. No asset/source
file, gameplay shader, graphics preference, server, input or UI control is changed.
Refresh the existing preview; no server restart or migration is required.

## Approved table finish and furniture shadows

The owner approved the actual Three.js before/after mock-up on October 15, 2026:
satin wood with grain following the rail, smoother bevelled corners, fine felt
surface detail, desktop furniture shadows and lightweight phone contact shading.
The example used oak through the existing selector; implementation retains all
five wood choices, saved room appearance and felt colors rather than forcing oak.

Reuse/boundary decision: keep core's existing table lifecycle, material caches,
quality and lighting owners. Move its pure surface geometry into a focused,
injected-Three module for meaningful geometry tests. Use the shared outline for
rendering, grid and physics rather than adding a mismatched visual-only curve.
Rounded arcs now use 20 segments per quarter, bounded at 84 perimeter vertices.
The seven-point rail profile preserves lip/base/width/overlap, smooths sampled
curves and keeps genuinely sharp rect/hex normals. Felt stays at playable y=0.

Desktop/tablet furnishing meshes now cast real shadows. Core fits the existing
camera to table plus room in light-view space on dimension/lighting changes;
quality, map sizes, bias settings and saved lighting remain under their existing
owners. A null bound restores the original table-only camera. Phone scenery still
has no shadow-map casting/reception or physical/detail-map shaders. All devices
receive small soft contact footprints: one instanced batch per owner using a
shared room-owned 128px Basic map/material/plane. Parent hierarchy handles local
placement, seat cloning and wall cutaways. Model swaps preserve contact batches;
empty chairs retain their resource template, and disposal releases everything once.

Files/helpers in this approved slice:

- `shared/pieces.js`: adds `TABLE_CORNER_SEGMENTS`, extends `tableOutline` sampling.
  Existing server wall builder and browser grid automatically use that definition.
- `public/rendering/table-geometry.js`: adds `TABLE_FINISH`, `createTableGeometry`
  and `createRimGeometry` for closed bevelled geometry, cap UVs and perimeter grain.
- `public/rendering/core.js`: delegates its existing geometry functions, tunes felt
  density/bump and satin rim response, removes obsolete map rotation, extends
  `fitShadow` and `lightingFrame`, adds/exports `setSceneryShadowBounds`.
- `public/rendering/cozy-room-shadows.js`: adds `COZY_SHADOWS` and
  `createContactShadows`/`add` with shared, disposable instanced contact resources.
- `public/rendering/cozy-room.js`: extends factory options, `sync`, `clear`,
  `prepareModelMaterials`, `plant` and furnishing setup/swap paths for cast flags,
  contact ownership and bounds reporting. Existing occupancy/cutaway APIs are reused.
- `public/client.js`: injects core's shadow-bound setter into the opt-in room.
- `test/table-geometry.js`: cap/boundary/UV tests and finite, closed, correctly
  wound rail tests across every shape and multiple sizes. `test/table-shape.js`
  adds a chord-error bound; existing backend containment tests exercise new walls.
- `test/cozy-room.js`: extends fixture gradients/bounds and caster expectations;
  adds loaded/fallback/seat contact, shared disposal and phone/desktop behavior checks.
- `scripts/component-parity.mjs`: real bootstrap verifies felt/wood maps, contact
  materials, desktop cast flags and full room shadow coverage through lighting
  changes without quality overrides, while retaining phone shadow-map exclusion.
- `CHANGELOG.md`, `REFERENCE.md`, `ARCHITECTURE.md`, `ASSET_CREDITS.md`,
  `DEVICE_QA.md` and this file document implementation, sources and manual checks.

Automated baseline: `npm run check` passes lint/format/CSS and all 1,057 tests.
Focused `client-bootstrap-cozy`, `client-bootstrap` and `cozy-window-sky` browser
scenes pass on desktop and coarse-pointer 390px layouts. The real cozy bootstrap
checks lighting-dependent shadow coverage, quality preservation, loaded furniture
and phone shader exclusions. Production-code room, corner and felt captures were
visually inspected on desktop, plus the phone room capture; no browser errors or
missing resources were reported. These captures use oak through the existing
selector. Browser emulation/software rendering does not establish real-device GPU
performance. No new downloaded assets, UI controls, input protocol, saves or game
rules are added. Original models/maps are unchanged; the existing credited felt
is reused for desktop bump detail.

Restart the server and refresh clients before testing: the shared rounded outline
must update on both runtimes. The previous Pixel shader fix is preserved in code;
contact shading and the new table still require an affected-device smoke retry.
Real-device GPU performance and multiplayer gesture feel remain manual QA.

## Rug resolution and opaque tabletop follow-up

The owner requested sharper carpet and a full tabletop shadow on October 15, 2026.
The rug previously stretched a 256px canvas over the whole surface; the felt slab
received shadows but did not cast, leaving a hollow rail shadow and separate piece
silhouettes on the floor below. This extends the existing `roomTexture` and core
mesh setup without adding helpers, assets, controls or new rendering passes.

Files changed in this follow-up:

- `public/rendering/cozy-room.js`: `COZY_ROOM` adds `phoneTextureSize` (512px) and
  raises `textureSize` to 1024px. `roomTexture` draws a denser weave, retains scaled
  border proportions and caps anisotropy at 8 (phones 1). Mipmaps and the existing
  canvas disposal path remain. No normal/bump/physical material is added to the rug.
- `public/rendering/core.js`: the solid `tableMesh` now casts shadows. Its closed
  material casts back faces to avoid coplanar self-shadow striping on the felt;
  geometry, gameplay boundary, lighting and graphics preferences are unchanged.
- `test/cozy-room.js`: adds desktop/tablet/phone rug resolution, filtering, simple
  material and canvas cleanup regression coverage.
- `scripts/component-parity.mjs`: production bootstrap verifies the tabletop's
  casting/reception and the loaded cozy rug's device-specific resolution/filtering.
- `CHANGELOG.md`, `REFERENCE.md`, `ARCHITECTURE.md`, `ASSET_CREDITS.md` and this file
  document the fix, original procedural source and device limits.

`npm run check` passes lint/format/CSS and all 1,058 tests, including 16 cozy-room
tests. The focused real `client-bootstrap-cozy` browser checks pass on desktop and
coarse-pointer 390px layouts. Production desktop room/rug and phone room captures
were visually inspected with no browser errors or missing resources. A controlled
WebGL probe using the actual table mesh confirms that the floor beneath the
tabletop is shadowed uniformly, masking the piece silhouette: the sampled empty
floor pixel changes from 255 without the slab caster to 12 with it, matching the
piece-shadow pixel at 12. Casting back faces removes felt self-shadow striping.
Captures, the probe renderer and logs are saved as `rug-table-fix-*` /
`cozy-rug-table-fix-*` in this chat's visualization workspace.

These follow-up changes only require a client refresh; they do not add another
server restart requirement after the shared-outline update. Affected-device
stability/performance still needs manual confirmation. Smoke test by orbiting low
to inspect rug edges and by placing/moving a tall piece over the table: its shadow
should stay on the felt, with a solid table silhouette on the floor below.

## Occupied player chairs

The owner approved replacing the fixed six-chair arrangement with one chair per seated
player, with an explicit correction that the chair nearest the shelf must face inward.
The actual implementation uses presence's injected `seatLayoutFor` and projects each
hand-position direction to shared `inTable` boundaries. All eight seats use one facing
convention: fallback front -Z and authored GLB front +Z with a local half-turn. The
chair model/source files are unchanged; orientation is a rendering transform.

The room retains one hidden resource template, then creates live copies only for
unique occupied seats. Spectators/unseated/invalid seats create no chair. Player state
patches reconcile only chair copies; table size/shape changes still rebuild the room.
The template keeps resources alive through empty rooms and later arrivals. Removing
copies releases their instance buffers, preserving shared resources until room cleanup.
Late model completion refreshes current seats, never an old player snapshot.

Slice files/helpers:

- `public/rendering/cozy-room.js`: extends `sync`, `clear`, `COZY_ROOM` and the chair
  model-completion path; adds `syncChairs` and `refreshChairs`, replacing the fixed
  `chair` helper/loop with a shared hidden template. Reuses `furnishing`, resource
  cleanup and shared table geometry; no public controller methods or caches added.
- `public/client.js`: injects the existing `seatLayoutFor` alongside `GLTFLoader`.
  Existing hydration/state-patch calls provide the live player map; no protocol/input changes.
- `test/cozy-room.js`: adds `playersAt`; updates existing chair/fallback/resource tests
  and adds occupancy, unchanged-patch, late-load, spectator/invalid-seat, all-shape
  placement and shared-resource preservation behavior checks.
- `scripts/component-parity.mjs`: production bootstrap checks one player/one chair,
  joins/leaves/seat changes, spectator exclusion and all eight real model backrests
  pointing outward (therefore seats facing inward).
- `CHANGELOG.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/DEVICE_QA.md`
  and this file record behavior, ownership, verification and manual smoke checks.

Verification: `npm run check` passes lint/format/CSS and all 1,050 tests. The focused
production bootstrap passes join/leave/seat/spectator behavior and backrest geometry
checks for all eight seats on desktop and coarse-pointer 390px profiles.
Actual three-player seated/wide/opposite/phone captures have no browser errors/missing
assets. All three exported backrests point outward by about 1.718 room units, including
the shelf-side seat. Seated render with sky: 69 draws / 71,332 triangles. Real-device
multiplayer timing and gesture/performance checks remain manual QA. Refresh the preview;
no server restart or migration is required.

## Integration file summary

- `public/rendering/cozy-room.js`: extended `createCozyRoom`/`sync` with injected model
  loading and the focused `furnishing` slot helper. Kept the existing placements,
  cutaways, fallback geometry and `disposeHierarchy` cleanup; added model URLs, physical
  scale and shelf inset tunables. The tabletop prop loader's center/fit policy is not
  used because scenery needs its authored ground origin and uniform scale.
- `public/rendering/cozy-room-surfaces.js`: focused surface construction with explicit
  Three.js dependencies: `createRoomMaterials`, `createPlasterPanel`, `createOakFloor`
  and `createOakTrim`, with `ROOM_SURFACES` tunables. All returned resources belong to
  the caller's room hierarchy; no persistent cache or mutable renderer context is added.
  `windowPane` in the room controller registers a frame slot and a separate clear pane;
  `roomTexture` now generates only the rug. Window models reuse `furnishing` loading,
  late-result handling and `disposeHierarchy` cleanup.
- `public/client.js`: injects the existing Three.js `GLTFLoader` when the preview is enabled.
  It also supplies the renderer's supported texture anisotropy.
- `public/static_assets/models/environments/cozy/`: three fixed GLBs, the separate window
  frame GLB and source/hash README; six `public/static_assets/textures/cozy-*.png` maps
  supply original plaster and derivatives of the existing CC0 oak.
- `test/cozy-room.js`: extended the fixture and added `authoredModel` test data for
  shared resources, orientation/height, maps, disposal, late completions and failure fallback.
- `scripts/component-parity.mjs`: checks real client loading and preserved maps on both
  desktop/touch bootstrap fixtures before testing rebuilds/cutaways.
  The `cozy-window-sky` fixture adds actual pixel tests through loaded window framing
  and clear glazing for panorama/cube orientation and Sky Off.
- `CHANGELOG.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/ASSET_CREDITS.md`
  and `docs/DEVICE_QA.md`: integration contracts, provenance and pending device smoke tests.
- Companion `export_fixed_assets.py`: export-only derivative of the study batching workflow;
  `preview_cozy_assets.mjs --fixed` and the companion README distinguish corrected exports
  from the historical builder. No script regenerates the owner's corrected blend.

Plant slice file/helper summary:

- `public/rendering/cozy-room.js`: extends `sync`/`COZY_ROOM` and adds the focused
  `plant` helper, reusing `furnishing` and its load/fallback/cleanup boundary; removes
  the two original root plant batches and west picture boxes. Loaded model callbacks
  apply bounded anisotropy; no new public methods are added.
- `public/client.js`: adds only the renderer capability injection for this slice.
- `test/cozy-room.js`: fixture injects anisotropy; authored-load tests cover map filtering;
  a new behavior test checks six variants, asset/resource sharing, table clearance,
  shelf support height and cutaway ownership across four table shapes.
- `scripts/component-parity.mjs`: real cozy bootstrap verifies all six models/maps and
  grain-aligned shelf UVs; the window fixture compares west plaster pixels to catch
  the green overlap regression.
- `public/static_assets/models/environments/cozy/`: adds the three botanical GLBs,
  replaces only the shelf GLB with the UV derivative and updates the source/hash README.
- `CHANGELOG.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/ASSET_CREDITS.md`,
  `docs/DEVICE_QA.md` and this plan record behavior, provenance and validation.
- Companion `cozy_plants_v1/`: `build_plants.py` adds `png`, `srgb`, `material`,
  `mapped_material`, `own`, `mesh`, `lathe`, `pot`, `tube` and `leaf` as asset-authoring
  helpers; `export_shelf_uv.py` reuses the prior evaluated-mesh batching approach for
  the shelf derivative. `validate_exports.py` adds `read`, `array`, `geometry` and
  `image_hashes` for independent binary preservation checks. `preview_plants.mjs`
  captures actual seated, wide, opposite-corner and phone views and checks bounds.
  Sources, maps, reports and README are retained with the editable blends.

## Verification

- Plant slice `npm run check` (before occupied chairs): lint, formatting, CSS checks and all 1,048 tests passed after
  adding the plant behavior test. Final placement/pixel checks are recorded below.
- Component parity's existing cases passed in the broad run, including real client
  `environment=cozy` startup, embedded maps, rebuilds and cutaways. The new window
  scene passed a focused rerun on desktop and coarse-pointer 390px layouts after its
  missing assertion helper was corrected. `COMPONENT_SCENE=cozy-window-sky` selects
  that case while retaining both device profiles in the canonical harness.
- The full `test:components` chain subsequently stops at the pre-existing notecard wheel
  zoom assertion in `scripts/notecard-test.mjs:216`; that failure was also reproduced
  on the unchanged baseline earlier in this work. The chained tile-preview step is skipped;
  its separate run passed at 1280px, 390px and 320px.
- Actual Three.js room captures inspected at seated, wide, opposite-corner and narrow
  views. Earlier six-chair capture with plants and sky: 78 draws / 84,856 triangles, no browser errors or missing
  assets. The fixed shelf clears its wall; chair backs rise above the tabletop.
- Saved source hash is unchanged; chair/lamp match fixed export hashes, shelf matches
  its UV derivative and botanicals match their build report. Embedded maps,
  UVs/tangents and physical dimensions pass the independent GLB preview checks.
- Window pixel checks pass on 1280px and 390px previews: native/rotated panoramas and
  cubemaps differ from the unobstructed sky by at most one RGB level; Sky Off differs
  by seven because of the clear pane's faint tint. Surrounding plaster remains opaque.
  Unit tests cover unoccluded apertures, board staggering/bounds/caps and all surface maps'
  shared-resource cleanup. Actual devices remain manual QA.
- Final plant slice: production cozy bootstrap passes on desktop/coarse-390 with six
  authored plant models/maps and grain-aligned shelf UVs. The window fixture also
  passes on both profiles with the added west-wall pixel comparison. Independent
  binary checks confirm unchanged shelf surface positions/images and owner source;
  actual browser bounds confirm all six plant models stay inside the plaster walls.
  Final seated/wide/opposite/phone captures have no missing assets or browser errors.

Refresh the existing `environment=cozy` URL; no server restart or migration is required.
Manual smoke test: change seats/orbit through wall cutaways, resize a table and visit a
tray, then compare without the preview parameter. Real-device GPU performance remains
pending in `docs/DEVICE_QA.md`.

## Reusable room-theme framework

On October 15, 2026, the owner approved six components (structure, openings and
surroundings, play area, main furnishings, decoration, atmosphere), with table
style independent and an explicit option to use a matching finish. The owner also
approved the concrete Room Settings row: theme name, **Use matching table** text
button and wood/felt explanation below the existing felt controls, with a stacked
touch layout and labels retained in compact mode. No new icons were proposed.

Reuse/boundary decision: extend the existing cozy renderer into a reusable,
function-based runtime. Shared state ownership determines the module boundaries:
whole-build lifecycle/cutaways, batching/model replacement/phone preparation,
occupied seating, and theme-specific art/geometry. The six cozy builders pass named
wall/sill/shelf anchors to later components; future themes can omit optional parts.
The scene remains viewer-local and asset rendering reuses its existing surfaces,
GLBs, contact shading, core shadow bounds and shared playable outline. No theme
persistence, gameplay protocol, new lighting pass or generalized room editor is added.

Files/functions in this slice:

- `public/rendering/rooms/room-environment.js`: adds `createRoomEnvironment` and its
  `sync`, `update`, `clear`, `dispose` lifecycle, component order, retry cleanup and
  shadow-bound reporting. Entire palettes remain owned even with unused components.
- `public/rendering/rooms/room-assembly.js`: moves shared `prepareModelMaterials`,
  `box`, `group`, `furnishing` and model completion behavior into `createRoomAssembly`;
  `contact`, `finish`, `loadModels` expose focused build operations. Phone policy,
  fallback hiding, late callback cleanup and batching retain their prior behavior.
- `public/rendering/rooms/room-seating.js`: adds `createRoomSeating`, moving existing
  `refreshChairs` and `syncChairs` into the owner of live copies/occupied seats.
- `public/rendering/rooms/cozy-theme.js`: moves `COZY_ROOM` and the existing art into
  `roomTexture`, `buildStructure`, `buildOpenings`, `buildPlayArea`, `buildFurnishings`,
  `buildDecoration` and the atmosphere material factory; exports `COZY_ROOM_THEME`,
  static asset metadata and matching Oak/green finish. Coordinates and tuned values
  are retained. Suggested lighting is metadata only.
- `public/rendering/rooms/room-themes.js`: adds static `ROOM_THEMES` and safe
  `getRoomTheme`; unknown/inherited names resolve to no environment.
- `public/rendering/cozy-room.js`: reduces `createCozyRoom` to a compatible wrapper;
  re-exports original configuration and the theme definition.
- `public/rendering/resources.js`: extends `disposeHierarchy` with optional owned
  palette materials, deduplicating textures/materials against visible meshes and
  retaining shared-resource exclusions and idempotency for existing callers.
- `public/client.js`: resolves the preview parameter through the registry, injects
  the theme into the runtime and settings controller, renames its local adapter to
  `roomEnvironment`, and preserves sync/frame/disposal ordering.
- `public/table/room-settings.js`: adds `syncThemeMatch`, optional theme/rank getters
  and the explicit click handler. It rechecks the live role/connection and uses the
  existing `table`/`tableColor` server-owned appearance paths. Theme hydration is inert.
- `public/table.html`, `public/styles.css`: add only the approved match row, scoped
  responsive layout and in-app help; use a native text button, shared tokens,
  descriptive hint, existing focus styling and a 44px touch target.
- `test/room-environment.js`: adds a second minimal test theme to verify optional
  components, no cozy loads/table mutation, rebuild/disposal, failed-build retry,
  invalid dimensions, registry IDs and phone shadow policy.
- `test/cozy-room.js`: retains all 16 cozy tests; two model-material tests select
  the chair fixture by URL instead of assuming first-load order.
- `test/room-settings.js`: fixture accepts theme/rank injection; adds explicit-match,
  independent state, missing-theme and live-role regression tests.
- `test/rendering-resources.js`: adds unused-palette/shared-map disposal coverage.
- `test/render-loop.js`: updates the injected adapter name while retaining frame/
  cutaway/shadow ordering tests.
- `scripts/component-parity.mjs`: production bootstrap checks registered theme and
  appearance-only sends; adds `room-theme-match` full/compact desktop/touch checks.
- `docs/ROOM_THEMES.md`: new authoring/API guide. `REFERENCE.md`, `ARCHITECTURE.md`,
  `GESTURES.md`, `DEVICE_QA.md`, `CHANGELOG.md` and this file record boundaries,
  approval, native input paths, verification and remaining manual QA.

Verification: `npm run check` passes all 1,064 tests and lint/format/CSS;
`test:input` passes 58 checks; `test:devices` passes all seven profiles. All scenes
in `component-parity.mjs` pass desktop/coarse-390 on a clean rerun, including the
registered production cozy bootstrap, clear windows, phone fallback and full/
compact matching action. An initial selection-toolbar browser evaluation reported
“Promise was collected”; both its isolated retry and the complete scene rerun pass
without a source change to that feature. Tile previews pass 1280/390/320px.

The full `npm run test:components` command remains non-green because its next
stage, `scripts/notecard-test.mjs:216`, independently fails the desktop wheel-zoom
assertion (100% instead of >100%). It also fails with this task's new HTML/CSS
removed and the original resource helper restored in a temporary baseline server.
Overlay removal and an input-delivery wait did not resolve it; both experimental
fixture edits were reverted, leaving the notecard test/product unchanged. This is
a separately reproduced baseline limitation, not a passed check.

Production room/rug captures retain the appearance: phone pixels are identical to
the preceding fix; desktop mean absolute channel differences are below 0.00006
on a 0–255 scale. Full/compact desktop/phone settings captures were visually
inspected, and native Enter/Space activation passes. No browser errors or missing
resources were reported in those captures. Logs, renderers, baselines and final
images are saved as `room-framework-*` in this chat's visualization workspace.

Real-device GPU performance and the extended Pixel/rejoin/multiplayer smoke list
remain manual; no result is inferred from browser emulation. Refresh clients to
load these modules and the approved control. No additional server restart,
migration, asset export or push is required.


## Shared and saved room selection — approved October 15, 2026

The owner explicitly approved the native **Room style** selector above Shape in
Room Settings → Table Size & Color: Standard (skybox only) / Cozy game room, with
“Shared with everyone. Saved for this room.” Desktop full/compact keep a labeled
row; touch full/compact stack the label, 44px select and hint. No new icon is used.

The implementation extends the existing schema, guarded settings handler and
ordered room save path. A small browser backdrop owner reuses the room-theme
runtime for switching and disposal. This avoids a second persistence mechanism or
parallel room renderer. The shared whitelist contains only public IDs/labels;
browser theme definitions and assets remain browser-owned. Style is per-room
configuration outside portable scenes and game snapshots, so loads/reset cannot
replace it. Wood/felt, lighting and sky references remain independent. The explicit
matching-finish action follows the active theme and retains its existing messages.
Old preview URLs now follow saved room state.

Files and functions touched in this slice:

- `shared/room-environments.js`: adds `DEFAULT_ROOM_ENVIRONMENT`, frozen
  `ROOM_ENVIRONMENTS`, strict `isRoomEnvironment` and stored-value
  `normalizeRoomEnvironment`. No model dependencies.
- `shared/room-capabilities.js`: classifies `roomEnvironment` alongside table
  settings under the existing gameplay gate.
- `server/game/schema.js`: appends `State.environment` and its reflected string
  declaration, preserving existing schema field order/defaults.
- `server/game/handlers/room-state.js`: extends `registerRoomStateHandlers` with
  the exact-payload GM/owner `roomEnvironment` message; extends `saveRoomStateNow`
  with the normalized style in its captured/ordered checkpoint. No new save queue.
- `server/room-queries.js`: extends `DEFAULT_ROOM_STATE` and `getRoomState` within
  `createRoomQueries` to read/normalize the durable environment.
- `server/database.js`: extends `saveRoomState` with parameterized environment
  storage in the existing update.
- `server.js`: extends `TableRoom.onCreate` to restore the durable environment.
- `postgres/024_room_environment.sql`: new additive, idempotent checked column,
  defaulting legacy rooms to Standard. `postgres/schema.sql` adds the same column
  and records migration 024 in the flattened fresh-install baseline.
- `public/rendering/rooms/room-backdrop.js`: adds `createRoomBackdrop` with
  shared-state `sync`, frame `update` and idempotent `dispose`; switching releases
  the prior runtime, failed constructors can retry, and theme-owned stale model
  guards continue releasing late loads.
- `public/client.js`: replaces URL-based creation with the backdrop owner, injects
  a live shared-theme getter into settings, and retains hydration/patch/frame/
  pagehide disposal ordering. No local override remains.
- `public/table/room-settings.js`: extends `syncThemeMatch`, `bindRoom` and
  `bindControls` with authoritative selector hydration, remote-state listening,
  canonical options and live role-checked changes. It waits for the server patch.
- `public/table.html`: adds the approved labeled native select/hint above Shape
  and explains selection/persistence in the in-app help.
- `public/styles.css`: adds scoped selector sizing/hint and desktop/touch layout
  rules using existing tokens, focus styles and semantic control classes.
- `test/room-backdrop.js`: new lifecycle, two-viewer consistency, unknown-value,
  independent appearance, teardown and construction-retry regressions.
- `test/room-settings.js`: adds authoritative style/remote-patch/live-role coverage
  and uses the live theme in its fixture.
- `test/backend-schema.js`: extends the synchronized field/default inventory;
  verifies reflection, both viewers' patches and late-join hydration.
- `test/backend-room-state-handlers.js`: extends message/payload inventories;
  verifies GM/owner guards, malformed/unknown/no-op rejection, untouched table/
  scene state and ordered environment capture across save failures.
- `test/backend-room-queries.js`: verifies stored Cozy and legacy/invalid fallbacks.
- `test/backend-security-boundaries.js`: exercises the production registered
  message with active-owner, spectator/time-out guards and room reopen restoration.
- `test/backend-scene-persistence.js`: checks style exclusion from portable/game
  snapshots and preservation during loads/reset.
- `test/integration/database.js`: expects 24 migrations, checks Cozy persistence,
  a separate Standard room, fresh connection reads and the database whitelist.
- `scripts/test-database.mjs`: extends `prepareDatabase` with independent migration
  024 upgrade/idempotency/constraint checks, preserving legacy table/notes data.
- `scripts/component-parity.mjs`: fixtures use server style instead of preview
  parameters; production bootstrap checks live switches, old-root disposal,
  matching-action changes and ignored legacy URLs. Approved UI checks cover native
  options, label/hint, full/compact layout and touch dimensions.
- `docs/ROOM_THEMES.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`: update shared
  state, protocol, lifecycle, persistence and future-theme contracts.
- `docs/GESTURES.md`, `docs/DEVICE_QA.md`, `public/table.html`: describe native
  keyboard/touch operation and manual shared-room/Pixel/restart smoke checks.
- `docs/RELEASING.md`, `CHANGELOG.md` and this file: record migration 024, upgrade
  requirements and implementation/verification status.

Verification for this slice:

- `npm run check`: all 1,073 tests plus lint, format and CSS checks pass on the
  final code/test source.
- `npm run test:integration`: all 25 PostgreSQL tests pass in a disposable test
  container, plus the migration-024 legacy-row/idempotency/constraint upgrade checks.
- `npm run test:components`: the complete command passes: all 100 component scene/
  profile runs, notecard editor at 1280/390/360px, and tile previews at 1280/390/320px.
  The earlier framework-stage notecard wheel failure did not reproduce in this run;
  no notecard source or test change was made for this feature. The static component
  harness still reports 10 unserved Mahjong derivative routes while its fallback
  scenarios pass; the room selector captures report no browser errors or missing assets.
- `npm run test:input`: 58/58 pass. `npm run test:devices`: all seven profiles pass.
- Production bootstrap checks both saved Cozy with an opposite legacy URL and
  saved Standard with an old cozy URL, live switching/root disposal, seating,
  authored materials, phone fallback and matching-table state. The production
  registered message test accepts an active owner, rejects spectator/time-out
  writes and restores Cozy after room disposal/reopen. It explicitly activates
  the account's durable player participation before testing owner writes.
- Real schema reflection/patch tests synchronize two decoders and a late join;
  settings/backdrop tests preserve independent appearance and await server patches.
- Full/compact desktop and phone UI captures were visually inspected. Native
  keyboard selection and Enter/Space matching-table activation pass, with no
  capture-page errors or missing resources. Diff whitespace and relative Markdown
  link targets pass. No icon additions or sprite rebuild are needed.

Final logs, captures and the capture script are saved as `room-environment-option-*`
in this chat's visualization workspace. The file-by-file list above describes this
slice; the existing authored assets and the unrelated Go board replacement were
not edited here.
Real Pixel GPU performance, live human multiplayer use and deployment remain manual.
Restart with migration 024 available through the existing migration-role connection,
then refresh clients. Existing rooms default to Standard; choose Cozy in Room Settings.
No changes were pushed and the owner's Go board replacement was preserved.

## Shelf compression comparison — October 15, 2026

The owner requested compressed game-shelf copies with the original retained for
comparison. This is an export study; the production theme, loader, assets and
Blender sources remain unchanged. Trial files live in companion
`3d_models/original/cozy_shelf_compression_v1/`, with an exact original copy,
pinned tooling manifests, reproducible scripts and detailed JSON reports/README.

Reuse decision: inject a test-only shelf-URL adapter and compatible decoder into
`createCozyRoom`'s existing loader dependency. All comparison renders use the real
room assembly/material/device path. No second material implementation, app build
step, decoder dependency, setting, UI or network protocol was introduced.

Measured decimal file sizes (unencoded, on disk):

| Variant | Bytes | Reduction | Result |
| --- | ---: | ---: | --- |
| Original | 15,942,228 | — | Preserved byte-for-byte |
| Meshopt, original images/precision | 9,397,264 | 41.1% | Exact decoded vertex attributes and oriented triangles |
| Meshopt + lossless WebP | 7,485,328 | 53.0% | Recommended conservative candidate; all 15 decoded RGBA images identical |
| 16-bit precision + Meshopt + lossless WebP | 5,552,064 | 65.2% | Very small render differences; retained alternative |
| Meshopt + high-quality UASTC/KTX2 | 6,973,836 | 56.3% | Small texture differences and lower GPU texture payload estimate |

Lossless means identical attribute/image values; Meshopt may cyclically rotate
triangle indices without changing winding or geometry. Candidate node/material
names, 141,346 triangles, loaded material scalars and phone policy remain. The
inactive empty review scene is omitted in derivatives so the writer does not emit
an invalid empty `nodes` array; the active authored scene is unchanged.

The recommended 7.49 MB candidate saves 8.46 MB. In seven desktop/phone views,
six captures match pixel-for-pixel. The desktop shelf view differs in three color
channels total (mean absolute error 0.0000078125 on a 0–255 scale; peak 13), with
no visible change found in inspected shelf/wood details. Geometry-only lossless
captures match exactly. The precision alternative's full-frame mean errors range
0.00096–0.05886; KTX2 errors range 0.0084–0.4039. These metrics include unchanged
surroundings, so the close-up images are retained for visual review.

Storage and network/memory savings are distinct. Offline gzip reduces the original
to 7.91 MB and the recommended candidate to 6.24 MB (about 21% additional saving);
Brotli reduces them to 6.57/5.44 MB (about 17%). These are not live server transfer
measurements. Lossless Meshopt alone barely changes the gzip result. The WebP
candidate retains the existing decoded texture/geometry memory and draw workload.
KTX2's software-GL ASTC4x4 mip payload estimate is 4.43 MB versus 17.69 MB for the
unique desktop shelf images, or 2.08 versus 8.29 MB after phone detail-map removal.
These exclude geometry, driver copies and upload peaks; real Pixel GPU memory,
load speed and stability remain manual. KTX2 may align source image dimensions to
multiples of four; the conservative WebP candidate preserves exact source pixels.

Validation: all five encoded candidates have zero glTF-validator errors; the four
PNG/WebP variants also have zero warnings. The KTX2 alternative has 30 warnings
because this validator does not recognize its 15 KTX2 image formats/MIME types.
Unsupported compression extensions are also informational, and their binary
payloads are not validated by that tool. All 15 KTX2 images separately pass the
official `ktx validate --gltf-basisu --warnings-as-errors` checks; their reports are
retained in `ktx-validation.json`. Actual NodeIO/Meshopt round-trips check
attributes/triangles, Sharp checks all 15 image RGBA buffers, and the bundled
Three.js r161 loader with matching test-only decoders successfully renders the
four reviewed candidates through both device profiles. Material scalar/name
comparisons pass. Capture servers report no page errors or missing resources.
The intermediate precision/PNG export is encoded/validated but not separately
rendered. No production app code changed; full app suites were not rerun for this
export/documentation-only slice. Relative documentation links and diff checks pass.

Files/helpers added or changed in this slice:

- Companion `compress.mjs`: source-hash guard, original copy, metadata/size/hash
  report, lossless and 16-bit variants, validator and geometry round-trip checks;
  focused `hash`/`describe` functions support the measured report.
- Companion `check-images.mjs`: compares decoded RGBA pixels and writes the
  per-image report. `finalize-ktx.mjs`: restores lossless Meshopt after the texture
  encoder's decoded-geometry intermediate, removes only the unused empty scene,
  and appends KTX2 size/validation results. Companion `validate-ktx.mjs` extracts
  temporary embedded images, runs strict native glTF-compatible KTX2 validation,
  writes `ktx-validation.json` and removes the temporary files.
- Companion `render-comparison.mjs`: uses existing `serveDir`, actual room/core,
  injected loader adapter, temporary matching Three.js decoders and Playwright;
  renders seven views per variant/profile set, records pixel/material comparisons,
  and estimates retained texture mip payload. Cleans each room/renderer/transcoder.
- Companion `package.json`/`package-lock.json`: isolated pinned study tools, not app
  dependencies. glTF Transform 4.2.1, meshoptimizer 0.24.0, Three.js 0.161.0,
  glTF Validator 2.0.0-dev.3.10 and official KTX-Software 4.4.2 were used.
- Companion `shelf-original.glb`, `shelf-meshopt-*.glb`, `compression-report.json`,
  `decoded-image-comparison.json` and `README.md`: preserved baseline, comparison
  exports, exact measurements/hashes and reproduction/limitations. The temporary
  texture-only intermediate was discarded; original authored sources were not.
- `CHANGELOG.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md` and this file: record
  the comparison, current unchanged production boundary and future decoder needs.
- Review artifacts: `shelf-compression/` and `shelf-compression-ktx/` in this chat's
  visualization workspace contain full-resolution views, JSON metrics and labeled
  original/compressed shelf and wood comparison sheets.

All study derivatives retain the original model/art licensing. No extra runtime
asset is bundled and no in-app credit or icon changes are needed. The original
shelf and the two relevant Blender sources were SHA-256 verified unchanged.
Nothing from this study has been committed, pushed or selected as the live shelf.
To adopt the recommended copy, the room loader needs a locally hosted compatible
Meshopt decoder. KTX2 adoption would additionally need its loader/transcoder and
worker/WASM CSP review. These integrations and real-device smoke tests are outside
this comparison slice; the current app continues to load the original GLB.

## Adopted lossless shelf and CSP-safe decoder — October 15, 2026

The owner approved adopting the **7.49 MB lossless shelf** and retaining the original.
Cozy now selects `cozy-game-shelf-lossless.glb` (7,485,328 bytes, SHA-256
`e48b8f11593dee02d616de338e85e226aafc092c442bf6c004376b8f92d0c454`).
The original `cozy-game-shelf.glb` remains untouched at 15,942,228 bytes and its
recorded SHA-256, available at its old URL for comparison or a configuration rollback.
Normal room loading requests only the compressed asset. Keeping the backup means
this change adds 7.49 MB to bundled disk storage while reducing the active shelf's
unencoded download by 53%; HTTP gzip/Brotli savings remain as measured above.

Reuse/boundary decision: configure the existing room-only GLTFLoader with
`setMeshoptDecoder`, and change the existing theme asset URL. No new loader owner,
worker, cache, fallback mechanism or pipeline helper is introduced. Gameplay/
uploaded-model loaders remain independent. Existing assembly material preparation,
procedural failed-load fallback, picking exclusion, hierarchy ownership and stale
success disposal handle the new model exactly as before.

The enforced production CSP excludes WebAssembly compilation. Instead of broadening
it, the room loader uses the unchanged upstream `meshoptimizer@0.24.0`
`meshopt_decoder_reference.js`, locally hosted with the full MIT license. It is
9,379 bytes (SHA-256 `2fad1a37ec276ddd0e1eaa1b389f2fcb1d57d684cbcb38de4116a95ba8925ef3`),
uses normal JavaScript, and needs no eval, external service, worker lifecycle or
WebAssembly permission. The module implements the GLTFLoader's existing Meshopt
interface. Upstream labels it a reference implementation, not performance optimized;
its scope is only trusted bundled scenery. All 117 compressed views decode to
10,768,776 bytes; an isolated Node run measured about 52 ms. Strict-CSP browser
captures measured about 68 ms desktop / 133 ms in the emulated phone profile on
this host. These single runs are not loading-speed or Pixel performance guarantees;
real-device cold loading and responsiveness remain manual. No KTX2 is shipped.

The owner explicitly approved the existing **Settings → Credits → Libraries** list
with `meshoptimizer — MIT` after Three.js, linking to the project page. The same
list renderer and native anchor cover desktop/touch, full/compact, keyboard focus
and wrapping. No icon, layout rule, tabletop input or in-app gesture was added.

Files/functions changed or added for adoption:

- `public/client.js`: imports the local decoder and configures the existing room
  `GLTFLoader` through `setMeshoptDecoder`; all existing room dependencies/order stay.
- `public/rendering/rooms/cozy-theme.js`: changes only `COZY_ROOM.furnitureURLs.shelf`
  to the approved derivative. Original source/materials/tuned coordinates stay.
- `public/vendor/meshoptimizer/meshopt_decoder_reference.js`: unchanged upstream
  implementation, including its `supported`/`ready` and buffer decoding methods.
  `LICENSE.md` retains the full MIT notice; `README.md` records version, provenance,
  hashes, CSP rationale, trusted-input scope, performance and update requirements.
- `public/static_assets/models/environments/cozy/cozy-game-shelf-lossless.glb`: adds
  the exact approved study export. The existing original is not renamed/modified.
  Its adjacent `README.md` records the active/backup files, decoder and rollback.
- `public/credits.js`: extends `LIB_CREDITS` with the approved meshoptimizer link/MIT
  entry. The existing `renderCredits` remains unchanged.
- `test/room-model-assets.js`: adds actual-asset regressions using focused test-only
  `parseGLB`, `bufferViews`, `accessorBytes` and `hash` readers. It verifies the
  original/derivative hashes, chosen URL, 141,346 oriented triangles, identical
  decoded vertex attributes, node/material names and all 15 decoded RGBA images.
  It imports and uses the real shipped decoder with WebAssembly unavailable.
- `scripts/component-parity.mjs`: the real client bootstrap applies the production
  CSP restrictions before import, verifies compressed loading without a backup
  request or policy violation, then checks authored materials, phone policy,
  resize, seat updates, theme switches/disposal and the approved credit's native
  focus/full/compact bounds. The window fixture configures its existing GLTFLoader
  with the same decoder so it keeps testing the production asset set.
- `CHANGELOG.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/ROOM_THEMES.md`,
  `docs/RELEASING.md`: update the active file, existing loader integration, boundaries,
  packaging/backup storage and refresh needs.
- `docs/ASSET_CREDITS.md`: records derivative provenance and decoder MIT attribution.
  `docs/DEVICE_QA.md`: records actual Pixel/desktop cold-load, backup-request,
  resize/rejoin and native credit-link checks. This file records the implementation.
- Companion `cozy_shelf_compression_v1/render-comparison.mjs`: its existing URL
  adapter recognizes the new active basename as well as the original, preserving
  the separate study's reproducibility. Its `README.md` now records production
  adoption and the retained backup. No source GLB/Blender file was overwritten.

Final verification:

- `npm run check` passes 1,075 tests plus lint/format/CSS, including both actual-asset
  regressions. Final changed-source lint/format and diff checks also pass.
- All 100 `component-parity.mjs` scene/profile runs pass, including the actual
  production client, strict-CSP compressed loading, original-request exclusion,
  desktop/phone materials, room lifecycle and full/compact keyboard-focusable credit.
- The complete `npm run test:components` command is not green: its following
  `scripts/notecard-test.mjs:216` desktop wheel-zoom assertion fails (>100% expected).
  One isolated retry fails at the same assertion. This is the previously reproduced
  baseline failure recorded above, which also predates this adoption. That fixture
  stubs `client.js`; its test/product code and gameplay loader were not modified.
  No notecard work was attempted in this asset slice.
- The separately run tile-preview stage passes 1280/390/320px. All seven
  `test:devices` layout profiles pass.
- The isolated production Cozy bootstrap also passes both desktop/coarse-390;
  strict-CSP visual comparisons and original/source SHA-256 checks pass.
- No database/input protocol/responsive-style changes were made, so integration
  and input suites were not rerun for this slice. Real Pixel responsiveness,
  GPU behavior and human multiplayer smoke checks remain manual.

Separate renders use the production room/core, active asset, shipped JavaScript
decoder and unchanged CSP restrictions, with an original-backup override only for
the baseline. Six of seven desktop/phone views match exactly; desktop shelf
mean absolute channel error remains 0.0000078125 (peak 13), as in the approved
study. No page errors, missing resources or material scalar/name differences were
reported. Logs, render helper and images are saved under `shelf-adopted/` and as
`cozy-shelf-adoption-*` in this chat's visualization workspace. Strict policy
imports use the real table import-map hash and an external self-hosted module.

Refresh clients to adopt the new module and asset. This slice needs no database
migration, dependency install, server restart or CSP change. No edits were pushed;
real-device responsiveness/Pixel smoke testing remains pending.

## All bundled GLBs: lossless derivatives — October 15, 2026

The owner approved applying the shelf's lossless approach across the built-in
catalog. This extends the earlier shelf-only loader decision above. All **101
original GLBs** now have smaller active browser derivatives, including boards,
chess/checkers, dice, coins/chips/tokens/bowls, deck containers, Dominoes, Mahjong
and all Cozy furniture/plants/windows. Existing family activation is unchanged.

| Group | Models | Original bytes | Derivative bytes |
| --- | ---: | ---: | ---: |
| Boards | 3 | 16,994,124 | 14,680,548 |
| Deck containers | 2 | 6,193,280 | 5,328,388 |
| Cozy furniture/windows/plants | 7 | 27,853,588 | 14,310,272 |
| Pieces, dice and tiles | 89 | 49,081,372 | 30,492,240 |
| Total | 101 | 100,122,364 | 64,811,448 |

The total saving is **35,310,916 bytes / 35.3%**, before HTTP encoding. This is
catalog size, not one room's request size. All originals remain byte-identical at
their prior public paths, including the committed corrected Go board. The approved
7,485,328-byte shelf derivative is reused exactly. The other 100 derivatives add
57,326,120 bytes beyond that shelf slice. With backups retained, disk use increases;
decoded GPU geometry/image dimensions and memory do not shrink.

Offline authoring uses glTF Transform 4.2.1, meshoptimizer 0.24.0 and Sharp 0.34.5.
Meshopt is applied without quantization, simplification, welding or vertex
reordering. WebP is retained only when smaller **and every decoded RGBA byte
matches**, including transparent RGB; otherwise the source encoding remains.
Every typed mesh attribute and oriented triangle round-trips; triangle indices
may cycle their three corners. All animation data, node/material names, material
and texture settings and active hierarchy survive. Empty inactive review scenes
are removed. No source model, Blender file or authored material was edited.

All derivative files have zero glTF validator errors. Seven source models have
unchanged runtime-generated tangent-space warnings (16 warnings in total), verified
against the original files; no tangent generation is introduced. The validator's
Meshopt support limitations are supplemented by round-trip tests through the
actual vendored JavaScript decoder and real GLTFLoader/GPU loads.

Reuse/boundary decision: keep the existing `GLTFLoader` loading and its callback,
progress/error, async and resource-ownership behavior. A focused browser adapter
selects an exact source/derivative allowlist rather than changing catalog/saved
URLs or server geometry readers. Gameplay, previews, collider editing and scenery
use this adapter. Other refs use an ordinary GLTFLoader with no decoder; a blob of
a compressed bundled model is explicitly tested to reject instead of entering the
trusted decoder path. No new global mutable context, asset cache, worker, service,
CSP permission, build dependency or UI control is added. Existing tile preparation,
tinting, room phone fallback, stale-callback handling and disposal stay with their
current owners. The previously approved library credit/license remains applicable.

Files/functions in this slice:

- `public/rendering/model-loader.js`: adds `createModelLoader`, private `select`,
  and `load`/`loadAsync` adapter methods; two ordinary loader instances isolate
  allowlisted bundled decoding from other URLs.
- `public/rendering/builtin-model-assets.js`: generated immutable
  `BUILTIN_MODEL_ASSETS` map for all 101 sources. No runtime fetching of the report.
- `public/rendering/graphics.js`: replaces only the shared `gltfLoader` creation;
  existing gameplay, bounds, material names, tile renderer and preview functions
  reuse it without changing their APIs or normalization/tint behavior.
- `public/client.js`: injects the same adapter into the existing room backdrop.
- `public/editor/compound-collider-editor.js`: `openColliderEditor` creates the
  adapter; custom file/blob loading stays on its uncompressed path.
- `public/static_assets/models/lossless/`: 100 new mirrored GLBs, `report.json`
  (enumerates **every** new asset path/hash/size and retained original), and
  `README.md` (totals, regeneration, source-license preservation and rollback).
  The original files and existing shelf derivative are not rewritten.
- `test/helpers/glb.js`: shares existing `parseGLB`, `bufferViews` and
  `accessorBytes` test readers, adding signed/MAT4 formats; no runtime helper.
- `test/room-model-assets.js`: reuses those readers, retaining the shelf-specific
  exact-hash, without-WebAssembly and 15-image checks.
- `test/builtin-model-assets.js`: adds `originalURLs` inventory verification and
  all 101 actual-file round-trip/hash/size tests, including animation accessors.
- `scripts/model-assets-test.mjs`: strict production-CSP browser harness with
  material/texture/hierarchy/animation snapshots and exact browser image pixels,
  rendering every derivative,
  callback/async/direct-derivative coverage and custom-loader boundary checks.
- `package.json`: adds `test:models`; no dependencies or lockfile change.
- `scripts/component-parity.mjs`: the existing Cozy window fixture now injects
  the shared adapter. Prior shelf/bootstrap/credit checks remain.
- `public/vendor/meshoptimizer/README.md`: updates scope from room-only to
  exact built-ins; third-party source/license remains unchanged.
- `public/static_assets/models/environments/cozy/README.md`: links the all-model
  report and updates shared-loader and rollback instructions.
- `CHANGELOG.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`,
  `docs/ROOM_THEMES.md`, `docs/RELEASING.md`, `docs/ASSET_CREDITS.md`,
  `docs/DEVICE_QA.md`, and this plan: update current contracts, provenance,
  packaging/disk impact, testing and manual phone checks.
- Companion `3d_models/original/builtin_lossless_v1/`: adds offline
  `compress.mjs` (`files`/`hash` and the export/verify loop), pinned
  `package.json`/`package-lock.json`, per-file `report.json` and reproduction
  `README.md`. No companion Blender sources or previous studies are altered.

Implemented and automated checks are distinct from owner testing. Actual Pixel 10
Pro cold loading, phone responsiveness and multiplayer behavior remain manual.
Refresh clients; no server restart or migration is needed for this asset slice.

Verification for this slice:

- `npm run check`: **1,177 tests passed**, plus ESLint, Prettier and CSS checks.
  The sandboxed first attempt was stopped when local-server tests stalled; the
  permitted local-server run completed successfully.
- `npm run test:models`: all **101 original/derivative pairs** passed on 1280px
  desktop and 390px coarse-touch profiles, including exact browser-decoded image
  pixels, actual GPU renders, animation/material/texture/hierarchy parity, strict
  CSP, callback/async/direct URLs and the custom blob boundary.
- `npm run test:components`: 99/100 scene/profile cases passed in the full
  component stage; the coarse-touch selection-toolbar case hit Chrome's
  `Promise was collected` error. Its isolated retry passed both profiles. Cozy
  production bootstrap, authored windows and tile appearance passed in the full
  run. The combined command therefore did not reach its later stages.
- Ran the later stages separately: tile previews passed at 1280/390/320px;
  `notecard-test.mjs` still fails the previously reproduced unrelated desktop
  wheel-zoom assertion at line 216. The full component command is **not green**;
  no notecard/input behavior was changed for asset compression.
- `npm run test:devices`: all seven profiles passed. Final targeted formatting,
  ESLint and `git diff --check` passed.
- glTF validator: zero errors for all 101 derivatives; the 16 source tangent
  warnings are unchanged. Full original/derivative hashes, geometry, image data
  and the corrected Go source are protected by the actual-file tests.

No commit or push was made for this slice. Owner testing on actual Android remains
pending; see `DEVICE_QA.md` for the short cold-load/spawn/recolor/preview smoke list.

## Single-copy canonical models and future publishing — October 15, 2026

The owner compared the lossless models, found them visually identical, and asked
that the extra originals be removed. This supersedes the earlier retained-backup
and derivative-path instructions above. The app now ships **101 GLBs totalling
64,811,448 bytes**, each at its existing canonical filename. The extra 100,122,364
bytes of original comparison payloads and temporary `models/lossless/` and
`cozy-game-shelf-lossless.glb` paths are gone. All final hashes match the previously
approved compressed payloads, including the corrected Go board. Authoring masters,
Blender files and historical studies in the companion workspace are retained;
no Git history rewrite or push is involved.

Reuse/boundary decision: preserve saved catalog URLs and the current GLTFLoader
adapter rather than add HTTP redirects or a new server decoding layer. The adapter
now selects its bundled decoder by canonical URL membership; it no longer maps to
another file. Uploaded/blob/data/external refs remain on the ordinary loader.
Collider measurements already read accessor min/max and node transforms from the
GLB JSON; they do not need an uncompressed vertex payload, and existing collider
specification tests and measured values still pass. Runtime physics and original
material/UV data are unchanged.

Future asset preparation is now a concrete one-asset workflow:
`node publish.mjs SOURCE.glb relative/model.glb` in companion
`3d_models/original/builtin_lossless_v1/`. The source must stay outside the app
models tree. After pinned authoring-tool setup (`npm ci`, Node 24 and Chrome),
the publisher compresses/compares the candidate, runs source/candidate comparisons
in the real strict-CSP browser renderer, and only then writes one final model,
the manifest and bundled URL registry. Geometry/UV/morph data, oriented triangles,
material settings, image pixels, animation samples and skin matrices are verified.
WebP/the complete candidate is selected only when smaller; unknown extensions
and unsupported geometry fail explicitly. No source export is changed. Publishing
registers decoder access, not gameplay semantics or room placement; normal catalog/
theme/scale/collider/credit integration and owner visual review remain required.
The [step-by-step model guide](../public/static_assets/models/README.md) documents
commands, flags, limitations, checks and the separate ordinary-upload path.

Files/functions in this cleanup:

- All 101 `public/static_assets/models/**/*.glb` canonical paths: replace their
  uncompressed payload with the corresponding approved lossless bytes. Every path,
  byte count, source/final hash and validation result is listed in the manifest.
  Remove the 100 temporary duplicate GLBs under `models/lossless/` and its old
  README/report, and the separate `cozy-game-shelf-lossless.glb` duplicate.
- `public/static_assets/models/manifest.json`: new durable source/final provenance,
  exact decoded-buffer and RGBA fingerprints, metadata and browser snapshot hashes.
  Full browser snapshots are hashed to avoid adding several megabytes of JSON.
- `public/static_assets/models/README.md`: new current future-asset publishing guide.
- `public/rendering/builtin-model-assets.js`: replaces the URL-remapping constant
  with generated immutable `BUILTIN_MODEL_URLS`.
- `public/rendering/model-loader.js`: `createModelLoader`, `load` and `loadAsync`
  now select by exact canonical URL membership; removes private `select` mapping.
- `public/rendering/rooms/cozy-theme.js`: restores the canonical shelf URL; this
  returns to the pre-compression URL while the payload stays compressed.
- `scripts/lib/glb.mjs`: relocates `parseGLB`, `bufferViews` and `accessorBytes`
  from the earlier test helper so offline authoring can reuse them. `bufferViews`
  passes a real Uint8Array copy to the reference decoder: Node Buffer.slice aliases
  its source, whereas the decoder expects Uint8Array.slice copy semantics.
- `scripts/lib/model-integrity.mjs`: adds `modelHash` and `modelIntegrity` for
  frozen decoded-buffer/image fingerprints, dimensions and named metadata.
- `test/builtin-model-assets.js`: `modelURLs` inventories all final GLBs and
  verifies the exact canonical allowlist/manifest. Per-file cases check encoded
  hashes/sizes, decoded fingerprints, repeat stability and nonmutation; all files
  are also verified with WebAssembly disabled. Removes reliance on originals.
- Removes the earlier `test/helpers/glb.js` location and shelf-only
  `test/room-model-assets.js`; their without-WASM/actual-decoder/image protection
  is covered for all models by the consolidated cases and recorded baselines.
- `scripts/model-assets-test.mjs`: normal mode loads each canonical file, verifies
  frozen browser material/hierarchy/animation hashes and GPU rendering under strict
  CSP on desktop/touch; `--prepare source.glb candidate.glb baseline.json` compares
  source/candidate metadata and exact browser pixels before authoring publication.
  Local `snapshot`, `comparePixels`, `equal` and `browserHash` support these paths.
- `scripts/component-parity.mjs`: production bootstrap assertions expect the one
  canonical shelf request and reject obsolete derivative URLs.
- `public/static_assets/models/environments/cozy/README.md`,
  `public/vendor/meshoptimizer/README.md`, `CHANGELOG.md`, `docs/ARCHITECTURE.md`,
  `docs/REFERENCE.md`, `docs/ROOM_THEMES.md`, `docs/RELEASING.md`,
  `docs/ASSET_CREDITS.md`, `docs/DEVICE_QA.md` and this plan: update the current
  source/deployment/verification/credit contracts. Historical plan/changelog
  entries are retained as history; this section and the model guide supersede them.
- Companion `builtin_lossless_v1/compress.mjs`: replaces the earlier app-directory
  batch entry point with reusable `compressAsset`, preserving its lossless rules
  and adding material/morph/animation/skin/extension verification.
- Companion `builtin_lossless_v1/publish.mjs`: new single-asset command, browser
  comparison orchestration, safe target validation, temporary cleanup and final
  canonical model/manifest/allowlist publication. Companion `README.md` documents
  the updated command; pinned manifests and historical report remain unchanged.

During the publisher test, integrity checks caught the Buffer.slice aliasing
issue described above before completion. Corrected the adapter and added
nonmutation/repeat-decoding regression checks, republished the two trial models
and confirmed **all 101 final hashes equal the prior approved compressed hashes**.
The command is tested end to end with coin and animated Go bowl source exports,
including both browser profiles, real registrations, material/pixel comparisons,
source preservation and temporary cleanup. No broken intermediate trial asset is
left in the final model tree.

Verification: `npm run check` passes **1,176 tests**, ESLint/Prettier/CSS checks;
`npm run test:models` passes all 101 canonical GLBs on desktop and coarse touch;
`npm run assets:colliders` successfully measures every registered physical model
from the compressed files. Focused production bootstrap/window/tile-appearance
checks pass on both desktop/touch (six cases); tile previews pass at 1280/390/320px. The full component suite
and device-layout suite were not repeated for this asset-only cleanup; the prior
unrelated notecard wheel assertion remains documented above. Actual Pixel cold
loading after refresh remains manual. The owner requested committing this verified
app slice; the companion authoring workspace is outside this Git repository.
No push is authorized. Refresh clients;
no server restart, migration, app dependency or CSP change is required.

## Versioned lossless authoring scripts — October 15, 2026

The owner requested backing up the lossless export process in this repository.
`tools/model-authoring/` is now the canonical publisher location; it supersedes
references above to scripts existing only in the companion workspace. Blender
masters, source exports and historical studies remain external. Existing models,
GLB bytes, runtime loading, CSP and gameplay behavior are unchanged.

Reuse/boundary decision: migrate the verified `compressAsset` and CLI publication
code rather than add a new compression implementation. The only functional path
change is the default `TABLETOP_ROOT`: the publisher resolves its containing repo
(`../..`) instead of a machine-specific companion-folder relationship. Existing
`TABLETOP_ROOT`, `GLTF_TOOLS` and `CHROME_BIN` overrides remain. The tools reuse
`scripts/lib/model-integrity.mjs` and the actual browser `--prepare` comparator;
no validator/browser/registry logic is duplicated in the migration.

Files and functions in this slice:

- `tools/model-authoring/compress.mjs`: repository copy of the verified
  `compressAsset` API, formatted to project style. Lossless geometry, material,
  image, animation/morph/skin and extension checks are preserved.
- `tools/model-authoring/publish.mjs`: repository CLI copy with the portable
  containing-repo default; preserves source/candidate browser comparison,
  final GLB/manifest/URL registration and temporary cleanup behavior.
- `tools/model-authoring/package.json` and `package-lock.json`: private isolated
  Node 24 authoring package and complete pinned dependency tree copied from the
  validated environment. Makes the already-used Sharp 0.34.5 pin explicit.
  Root app dependencies/package files are unchanged.
- `tools/model-authoring/.gitignore`: excludes installed `node_modules/`.
- `tools/model-authoring/README.md`: setup, publication, provenance, isolated
  dependencies, path overrides, source preservation and links to integration QA.
- `.dockerignore`: excludes the offline tools folder from the production image.
- `public/static_assets/models/README.md`: replaces external-only commands with
  `npm ci --prefix tools/model-authoring` and
  `node tools/model-authoring/publish.mjs SOURCE.glb relative/model.glb`.
- `README.md`: adds the tools folder to the source overview and links the guide.
- `docs/ARCHITECTURE.md`, `docs/REFERENCE.md`, `docs/RELEASING.md`: update the
  canonical tool path, dependency/deployment boundary and default root behavior.
- `CHANGELOG.md` and this plan: record the backed-up workflow and verification.

Verification: a fresh `npm ci --prefix tools/model-authoring` installs from the
versioned lockfile; the publisher runs end to end with those local packages and
without `GLTF_TOOLS`/`TABLETOP_ROOT` overrides, launched from `/tmp`. Coin and
animated Go bowl source exports each pass source/candidate metadata, exact image
pixels and GPU comparisons in desktop/touch strict-CSP profiles. Source exports,
both final GLBs, the manifest and generated bundled URL registry remain
byte-identical after republication. An invalid traversal target fails before
changing any published file. Git confirms installed packages are ignored.
The full `npm run check` passes: **1,176 tests**, plus ESLint, Prettier and CSS checks. No runtime,
input, responsive UI or database behavior changes, so those broader suites are not
repeated. No browser refresh or server restart is required for this tooling change.
The scripts are committed locally; pushing remains a separate explicitly authorized
step. The prior external copies are retained as historical authoring files.

## Approved vaulted ceiling integration — October 15, 2026

The owner approved the exposed-oak/plaster ceiling render and requested integration.
Cozy now includes two large skylights flanking the peak. The approved companion
`cozy_ceiling_v1/cozy-vaulted-ceiling.blend` remains byte-identical, SHA-256
`efcff14e445196f9a2f174bd8027f4aa7a003f7d8d7e208f67d169931d6bb01e`.
The separate runtime derivative adds fitting metadata and simple alpha glazing;
existing furnishing masters, materials and uploaded assets are preserved.

Reuse decision: extend structure/assembly/camera/resource owners, with a focused
roof module for per-piece fitting. Whole-model stretching would distort timber
sections, bevels and grain. Individual pieces retain sections and joinery offsets;
UVs/tangents retain physical density. The 26.6° pitch follows room width and
skylights follow width/length independently. Five roof draws and two wall-following
gable cutaways replace 65 part meshes. Elevated/overhead views hide the roof;
views below the eaves retain it. The roof casts no shadow over gameplay. Desktop/
tablet use existing clear alpha glazing; phones omit panes/detail/physical shaders.
No new light, refraction pass, UI, input gesture or synchronized state is added.

Changed-file/function summary:

- `public/rendering/rooms/cozy-ceiling.js`: adds `COZY_CEILING`, `createCozyCeiling`
  (owned groups/fallback, with nested `addBox`/`part` construction helpers),
  `fitCozyCeiling` (piece sizing/UVs/glazing/gables), and
  internal `batch` (material/cutaway batches and temporary geometry disposal).
- `public/rendering/rooms/cozy-theme.js`: extends `COZY_ROOM.furnitureURLs` and
  `buildStructure` to register the new asset through assembly.
- `public/rendering/rooms/room-assembly.js`: extends `furnishing`/`loadModels` with
  optional per-placement preparation and releases source geometry/materials no
  placement retains. Ordinary model sharing remains compatible.
- `public/rendering/rooms/room-environment.js`: extends `sync`, `update`, `clear`
  for optional ceiling ownership, gable/eaves cutaways and peak/padded shadow bounds.
- `public/static_assets/models/environments/cozy/cozy-ceiling.glb`,
  `public/static_assets/models/manifest.json`, `public/rendering/builtin-model-assets.js`:
  add the 1,123,540-byte lossless model (from 1,641,664 bytes), canonical URL and
  verified decoded/browser baselines. It has 10,452 triangles and six embedded maps.
  Final GLB SHA-256: `06c232b73b21c7c5870724caf9dcd1fe70fd6186b01aba4f822151f3db0edd10`.
- `test/cozy-room.js`: adds size/shape, camera/gable cutaway, failed-load fallback,
  section/UV density, phone and fitted/source ownership regressions.
- `scripts/component-parity.mjs`: extends production bootstrap assertions and adds
  `cozy-ceiling-sky` pixel/device/size/cutaway checks for both apertures.
- `CHANGELOG.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/ASSET_CREDITS.md`,
  `docs/ROOM_THEMES.md`, model-root and Cozy READMEs document the current contracts,
  provenance, updated totals and refresh needs.
- Companion `cozy_ceiling_v1/export_runtime.py` adds fit metadata without saving the
  master; `review_runtime.mjs` captures production modules; its README records the
  integrated derivative. No app helpers were removed.

Verification: `npm run check` passes ESLint, Prettier, CSS lint and **1,168 tests**.
All **102** registered models pass `npm run test:models` on desktop/coarse-touch
under strict CSP. `client-bootstrap-cozy` passes both profiles; `cozy-ceiling-sky`
checks both apertures against three background colors at small, large and round
room sizes, device materials and gable/elevated/overhead cutaways. The selected
`COMPONENT_SCENE=client-bootstrap-cozy npm run test:components` command passes its
bootstrap plus notecard/tile-preview companions. Desktop/390px production-module
renders were inspected in the companion review folder. The earlier sandbox-limited
Node failures did not recur with local test-server access. Nothing was pushed.

Manual smoke test after refreshing: choose Cozy, lower the camera and look up at
both skylights; orbit to check gable cutaways; return to elevated/overhead play;
resize and switch Standard/Cozy; repeat with a real phone and chosen skybox,
including cold load/rejoin. Real-phone GPU stability, lighting taste and camera
feel remain unverified. No server restart, migration or new service is required.

## Approved seated view and lower table — October 15, 2026

After the ceiling integration the owner supplied a lower-view reference, clarified
that the table should be physically lower, and explicitly approved the rendered
desktop/phone examples plus a roughly 5cm height reduction before implementation.
Review renders and the production captures are in this chat's visualization folder
as `proposed-*.png` and `approved-runtime-*.png`.

Reuse decision: tune the existing `VIEW`/`seatLayoutFor` boundary and Cozy's floor/
support/opening builders. No new camera helper, preference, shared protocol, model
or control is needed. The baseline seat camera is `[0,4.75,12.01]` looking at
`[0,1.5,2]`, approximately 18° down. Horizontal fit still follows table dimensions;
vertical scaling caps eye height at eight units so normal large-table seats stay
below the eaves. Joining, changing seats and My Seat reuse the same helper.
Birds Eye retains its independent aspect-aware overhead fit.

The tabletop remains the server/physics Y=0 reference. Cozy's floor moves from
-5.5 to -5.15, reducing physical table height from approximately 0.786m to 0.736m.
Table legs shorten while still ending at Y=-1. Furnishings remain grounded, and
wall/ceiling tops, window apertures/frames and sill plants follow the room floor.
Existing models/materials, pieces, board heights, hands and saves retain their
owners and coordinates. This changes physical table-to-room proportions, rather
than merely moving the image of the tabletop.

Files/functions changed for this follow-up:

- `public/table/presence.js`: tunes `VIEW` and the vertical scale in `seatLayoutFor`;
  no changes to hand/outward vectors, `applySeat`, `applyBirdsEye` or input routes.
- `public/rendering/rooms/cozy-theme.js`: tunes `COZY_ROOM.floorY`, adds named
  `windowCenterAboveFloor`/`windowHeight`, and extends `buildStructure`/`buildOpenings`
  to derive matching aperture/frame/sill heights. Existing `buildPlayArea` naturally
  shortens the supports through its floor dependency.
- `test/presence.js`: adds all-seat shallow-angle and large-table eye-height coverage.
- `test/cozy-room.js`: adds physical height, leg endpoints, floor-relative window
  and all-seat ceiling-visibility regressions at several table sizes.
- `scripts/component-parity.mjs`: verifies visible ceiling and capped eye height
  through production hydration; updates shadow bounds/skylight probes to current
  configured room height, including peak coverage.
- `CHANGELOG.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/GESTURES.md`,
  `docs/DEVICE_MATRIX.md`, and this section record current behavior and validation.
  Review-only `preview-seat-camera.mjs`/`capture-approved-seat.mjs` render the
  proposed and actual defaults without modifying game state. No helpers removed.

Verification: `npm run check` passes ESLint/Prettier/CSS and **1,170 tests**;
`npm run test:input` passes **58/58** and `npm run test:devices` passes all **seven**
profiles. Production Cozy bootstrap and window/skylight skybox pixel tests pass
desktop/coarse-390 profiles. Actual desktop, phone and large-table captures use
the production defaults and show the ceiling. Component companion results are
recorded with the run logs in `/tmp/seat-view-components.log`.

Refresh the browser and choose My Seat to reframe an existing session. Smoke-test
seat changes, all table shapes, My Seat/Birds Eye, orbit/pan/zoom, and physical
chair/table proportions on a real phone. Automated runs do not establish real-device
camera feel or visual comfort. No server restart/migration is needed; nothing pushed.

Commit validation — October 16, 2026: an isolated copy of the staged snapshot passes
`npm run check` with **1,181 tests**, plus production `client-bootstrap-cozy` and
`cozy-ceiling-sky` desktop/touch browser checks. The earlier 1,170 count describes
the combined working tree; unrelated pending test cleanup was deliberately excluded
from this commit. The ceiling model's staged bytes/hash match its manifest.
