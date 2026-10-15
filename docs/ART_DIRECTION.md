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
