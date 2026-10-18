# Room themes

The [room theme expansion plan](PLAN_ROOM_THEMES.md) records fourteen themes,
starting with the approved Poker Night design. Registered choices are Standard,
Cozy, Poker Night, Medieval Tavern and Modern Bar; the remaining concepts are a backlog.

Room themes build viewer-local scenery around the existing playable table. The
cozy room is the first registered theme. Its current art, layout, authored models,
phone fallback, clear windows, sharp rug and full tabletop shadow are retained.

The server owns `State.environment`, a public per-room choice of `standard`,
`cozy`, `poker-night`, `medieval-tavern` or `modern-bar`. In **Room Settings → Table Size & Color**, above Shape, the approved native
**Room style** select offers **Standard (skybox only)**, **Cozy game room**, **Poker Night**, **Medieval Tavern** and **Modern Bar**.
GM/owner changes use `roomEnvironment {environment}`; the guarded handler validates
the exact payload, ignores repeats and schedules the existing durable save. All
clients receive the schema patch and switch together. The selection is stored in
`rooms.room_environment` by additive migration `024_room_environment.sql`; old and
new rooms default to Standard. Restart the server with the migration connection
configured, then refresh clients. No new service, port or environment variable is needed.

Poker Night extends the ID constraint with additive migration `025_poker_night.sql`;
apply it through the configured migration role, restart the server and refresh
clients. Medieval Tavern adds migration `026_medieval_tavern.sql` through the same
workflow. The fresh-install baseline includes all four environment migrations. Existing styles and
the Standard default are preserved. Modern Bar adds migration
`027_modern_bar.sql` with the same preservation/upgrade steps.

`createRoomBackdrop` follows the shared choice, resolves bundled definitions through
`ROOM_THEMES`, and delegates construction to `createRoomEnvironment`. Switching
back to Standard disposes the active hierarchy, palette and shadow bounds; late
model callbacks release stale resources. The old `?environment=cozy` URL no longer
overrides a room's saved selection. Unknown/missing stored IDs normalize to Standard;
requests for unknown IDs are rejected. No user-controlled model URL or executable
upload enters the registry.

Room style is durable room configuration, outside portable scenes and game
snapshots. Loading a scene, manual checkpoints and game resets preserve the
destination room's style. Wood, felt, shape, dimensions, lighting and skybox retain
their independent owners. Desktop full/compact use the labeled row; touch layouts
stack the label/select/hint with a 44px minimum control. Labels remain visible,
`aria-describedby` exposes the shared/saved hint, and native select keyboard/touch
interaction adds no tabletop gesture or icon.

## Six components

| Component | Contract and responsibility | Cozy implementation |
| --- | --- | --- |
| Structure | Required `build(dependencies)` plus `floorY`, `wallHeight`, `clearance`, `minimumHalfSize` and optional `cutawayHysteresis`. Returns optional `walls`, `ceiling` and named `anchors`. | Oak ground/floorboards, plaster walls/trim and vaulted oak ceiling with two skylights; north/south/east/west anchors. |
| Openings and surroundings | Optional `build({...dependencies, structure})`. Creates windows/doors and returns attachment anchors. Existing sky/background belongs to the skybox owner. | Four transparent windows and a sill planter anchor. |
| Play area | Optional `build({...dependencies, structure, openings})`. Builds visual supports and an optional hidden `chairTemplate`; returns its `chairModel` asset key. `chairClearance`/`chairName` configure seating. | Shared-outline table legs and occupied-seat upholstered chairs. |
| Main furnishings | Optional `build({...dependencies, structure, openings, playArea})`. Returns furniture anchors for decoration. | Game shelf and lamp; shelf anchor follows the east cutaway wall. |
| Decoration | Optional `build({...dependencies, structure, openings, playArea, furnishings})`. Adds room-owned dressing. | Rug and six plants attached to ground, sill and shelf anchors. |
| Atmosphere | Required `createMaterials(THREE, onLoad, phoneSafe)` returns the owned material palette. Optional `suggestedLighting` metadata describes intent. | Existing oak/plaster/glass palette and neutral fallback material; warm-light suggestion. |

Build order is atmosphere → structure → openings → play area → furnishings →
decoration. Each component receives explicit build dependencies and the preceding
component outputs it can use. Anchors are named attachment references to Object3D
parents and local placement information. Attaching furnishings/decorations to their
support makes transforms and cutaways follow naturally. They are not server IDs,
physics bodies or mutable globals. The cozy component builders live together in
`rooms/cozy-theme.js`; existing `cozy-room-surfaces.js` supplies its material and
surface geometry implementations.

Every builder receives:

- `THREE`, `root`, `doc`: injected rendering/DOM dependencies and this build's owned hierarchy.
- `layout`: a frozen record containing original `tableX`, `tableZ`, `tableShape`,
  effective `hx`/`hz`, room `rx`/`rz`, `floor` and `top`. Round rooms use `tableX`
  for the effective depth. Dimensions are validated before construction.
- `materials`: this build's owned atmosphere palette. Honor `phoneSafe` in its
  factory; procedural phone materials omit physical/detail-map shader paths.
- `phoneSafe`, `textureAnisotropy`: existing device classification and supported
  filtering limit, independent of the saved graphics tier.
- `assembly`: focused batching, model-slot and contact-shadow operations below.

No table renderer setter, room network connection, save helper, gameplay piece
factory or gameplay texture cache is available to a theme builder. The theme does
not apply lighting or sky suggestions automatically. Saved table appearance,
lighting and synchronized sky references remain with their existing owners.

## Shared runtime and resources

`createRoomEnvironment({theme, THREE, scene, modelLoader, seatLayoutFor,
deviceClass, textureAnisotropy, doc, onChanged, onShadowBoundsChanged})` returns
`sync(tableState)`, `update(cameraPosition)` and idempotent `dispose()`. Existing
callers may still pass a target; cutaways depend only on camera position.

`sync` builds once per size/shape, reconciles occupied chairs for same-size patches,
and rebuilds through the normal resource cleanup path on dimension changes.
Structure may omit walls; a ground-only theme needs no window, chair, furnishing,
decoration or model implementation. A failed build after palette creation releases its hierarchy
and entire palette, including unused materials, then remains retryable. Palette
materials and their maps belong exclusively to that build. Shared image references
are deduplicated during disposal; explicitly borrowed shared maps retain the existing
`ottSharedTexture`/`ottSharedFinish` protections.

`room-assembly.js` owns these build-local operations:

- `group(name, position?, yaw?)`: attach a group to the owned root.
- `box(parent, size, position, color, material = materials.plain, yaw = 0)`:
  queue instanced fallback boxes by parent and material. A theme using the default
  must provide `materials.plain`; authored theme surfaces can be passed explicitly.
- `furnishing(assetKey, parent, fallback, yaw = 0, prepare?)`: register a replacement slot.
  Theme `assets` map keys to `{url, scale, name, resourceName?}` records.
  Optional `prepare(copy)` fits a placement before attachment. Clone any geometry
  it changes; assembly releases source geometry/materials no live copy retains.
  Cozy's ceiling uses this for fixed-section joinery and material batching.
- `contact(parent, footprints, height?)`: attach shared, instanced contact footprints.
  This reuses the existing `cozy-room-shadows.js` resource implementation; its
  historical `cozyContactShadow` marker remains compatible.
- Runtime-only `finish()` and `loadModels(onModelLoaded)`: finalize batching, picking
  exclusions and phone shadow flags, then load each registered asset once per build.
  Missing assets or failed loads retain procedural fallbacks. Late stale successes
  release their model resources instead of attaching to a newer build.

Loaded model preparation centralizes the tested phone conversion: Standard PBR,
retained base art/cutouts/colors and scalar metal tuning, no physical layers or
per-pixel detail maps, anisotropy 1, no scenery shadow casting/reception. Desktop/
tablet preserve authored materials/detail, with supported anisotropy capped at 8.
GLBs and original artwork are unchanged. `room-seating.js` reuses shared `inTable`
and the injected presence `seatLayoutFor`, preserves inward orientation at all
seats/shapes, and excludes spectators/unseated players. Hidden templates own shared
resources when empty; departing chairs release only their own instance buffers.

Cutaway walls return `{group, cutawayPlanes}` with normalized, outward-facing
`THREE.Plane` instances in room/world coordinates (the root remains at the origin).
Negative signed distance is the interior side. `update` runs after camera controls
and before shadow refresh/render. A group stays visible while the camera is inside
all its planes; a missing/empty list leaves it visible. The runtime applies optional
`structure.cutawayHysteresis` in world units: hide at a plane, restore only after
moving that far back inside. Cozy uses a 0.15-unit band and places wall planes 0.3
units inside their center lines, just before the plaster face. Wall furnishings and
gables inherit the same cutaway; aim, pan and overhead angle alone do not hide walls.
Desktop/tablet construction reports the room world bounds to core's existing
shadow-camera fitter; disposal reports null. Phone construction reports null and
uses lightweight contact shading. No new lights, render loop or postprocessing
passes are installed.

An optional `structure.ceiling {group, cutawayPlanes, top, gables}` follows the same
update and disposal path. Cozy supplies two normalized slope planes, preserving
the ceiling above the eaves while the camera is below the pitched roof. Crossing
either slope hides the whole roof; above-ridge/overhead cameras keep the table clear.
Each gable record `{group, end}` receives its matching wall's plane list in the
structure builder. The ceiling peak still expands desktop shadow bounds. Cozy's
ceiling itself does not cast shadows that could darken the tabletop. The loaded mesh retains
real skylight apertures; desktop/tablet use the palette's clear alpha glass while
phones omit glazing and physical/detail shader paths. No additional input or
responsive UI control is needed; mouse/touch camera intents remain unchanged.

`cozy-room.js` remains a compatibility wrapper exporting `COZY_ROOM`,
`COZY_ROOM_THEME` and `createCozyRoom(dependencies)`. It invokes the same runtime;
production client code uses the shared-state backdrop owner.

## Bundled compressed models

Rooms, gameplay and model previews reuse `createModelLoader()`. Exact canonical
URLs in `BUILTIN_MODEL_URLS` select the self-hosted JavaScript `MeshoptDecoder`;
other URLs (including uploads/blob/data/external refs) use an ordinary GLTFLoader.
Each asset ships once at its existing name. Cozy uses compressed
`cozy-game-shelf.glb`; duplicate original and temporary derivative paths were removed.
Use the [offline model publisher](../public/static_assets/models/README.md) for new
assets or replacements, retaining named material/node slots and verifying scale
and room placements. It updates the manifest and bundled URL allowlist after
source/candidate verification; room placement/catalog integration remains separate.
The decoder preserves the no-eval/no-WASM CSP and runs on the main thread, so test
cold loading on actual phones. Existing procedural failure fallback, stale callback
disposal and room-owned resources remain with the assembly. Gameplay resources
remain independent of scenery cleanup. No worker/transcoder lifecycle is added.

## Independent table style

A theme can provide frozen `matchingTable: {rimWood, feltColor, description}`
metadata. Selecting/building a theme never applies it. Existing saved wood, felt,
shape, dimensions and lighting stay independent.

The owner-approved **Room Settings → Table Size & Color → Room match** row shows
the active theme name, a **Use matching table** text button and its explanation.
It is hidden without matching metadata. The label remains visible in compact mode;
touch layouts stack the row and provide a 44px minimum button. Mouse click, touch
tap and native keyboard activation use the same semantic button.

The settings controller receives `getEnvironmentTheme` and `getRank`. It checks
the current connection and live GM/owner rank on activation, then sends the existing
`table` message containing only `rimWood` and `tableColor` containing only `color`.
The server's existing handlers authorize and persist those independent fields.
Shape, size, pieces and lighting are never sent by this action. Cozy recommends
Oak plus `#2f6b4f` green felt. Later table models/styles can extend the table owner
separately; this first framework does not introduce a new table-model registry.

## Poker Night

`rooms/poker-night-theme.js` supplies the same six component records: walnut
wainscoting, olive plaster, staggered wood floor, a curtained opening, beveled
leather seating, sideboard/carafe/glasses, green-shaded pendant, charcoal rug,
framed procedural landscapes and existing rubber-plant GLBs. Its constants live
in `POKER_NIGHT`. Seven units represent a metre; the tabletop remains at Y=0.
Floor/plaster/trim geometry reuses the existing surface helpers; assembly, occupied
seating, phone model preparation, cutaways and disposal use the shared runtime.
No gameplay geometry, input handlers, lights or private state are added.

The north aperture shows the existing sky. Wall-attached art, curtains and plants
follow their support cutaway. A flat ceiling and its pendant cut away above the
ceiling; roof/fixture meshes do not cast shadows that would darken the game.
Phones omit plaster detail maps, use opaque simplified drinking-glass materials
and 256px procedural fallback rug/landscape maps; authored base maps remain
at most 512px and desktop retains detail maps. Plant load failure retains
a procedural fallback. Room-owned canvases and maps release during cleanup.

Optional **Use matching table** applies Walnut and `#1e5c3f` green felt through
existing authorized settings messages. Room selection never applies it implicitly
or changes table shape, size, saved lighting or sky. There is no padded rail or
poker-specific game automation. The generated approval image is a design reference;
the first procedural runtime has now been extended with eight Blender-authored
GLBs, including the owner's edited curtains/tiebacks. Desktop keeps authored
detail maps; the shared phone policy removes those maps and physical material
layers. Clear glazing remains nearly transparent and is hidden on phones.

## Medieval Tavern

`rooms/medieval-tavern-theme.js` adds `MEDIEVAL_TAVERN` and a focused theme
definition using the same lifecycle, model slots and occupied-chair owner.
Broad oak floorboards, a limestone foundation, lime plaster, exposed timber
posts/ceiling beams and a west aperture resize around every supported table
shape. Stone rows and timber posts have explicit count caps. Its eight models
come from the approved companion `medieval_tavern_v1/` Blender source: cross-back
chair, three-legged stool, bench, coopered barrel, arched hearth, leaded window,
bar/shelves/vessels/banner assembly and candle wheel. They are batched per
material and published through the verified lossless pipeline.

The north hearth/bar/barrels follow the north wall cutaway; east stools and west bench
and window follow the west wall; the candle wheel follows the ceiling. Occupied
chairs face inward and omit spectators; authored feet are grounded with placement
offsets. GLB failures keep procedural furnishings and stale callbacks release
their resources. Phone materials use the shared lightweight policy and hide
clear glazing, preserving the selected sky without transmission/refraction.

The current window revision mirrors the left shutter for the right leaf and keeps
both leaves 0.20m toward the interior in a separate Blender source. Earlier
snapshots preserve the owner's moved-right-shutter state. The west
plaster retains its interior face but has a recessed exterior face, leaving
physical casing clearance on both sides. Its rough opening is 11.76 units wide,
from 7.35 to 17.85 above the floor, placing every plaster reveal inside the solid
jamb/lintel section rather than coplanar with the inner timber face.
`windowSurroundHalfWidth` keeps timber
posts clear of the full shutter assembly. An adaptive oak trestle base now runs
from `floorY` to the real tabletop underside, using shared `tableOutline`/`inTable`
and `TABLE_FINISH.rimBase`; it remains scenery, with phone/picking/disposal policy
owned by the existing assembly. No table collider or playable geometry changes.

Fire/candle emissions are decorative and static. No lights, fire simulation,
game pieces, heavy review table or rule logic are imported. Saved lighting, sky,
table dimensions and shape remain independent. **Use matching table** explicitly
applies Oak and muted moss felt `#354c36` through existing authorized messages.
The Blender trestle table remains a study rather than changing the physics-owned
game table. Apply migration 026 through the migration role, restart and refresh.

## Modern Bar

`modern-bar` / **Modern Bar** uses the approved Blender source in companion
`modern_bar_v1/` and approved `room_backwalls_v1/`, with thirteen individually optimized GLBs. The shell reuses
`createOakFloor` with the existing walnut texture and `createPlasterPanel` with
the existing original plaster normal. North-wall brick boxes are bounded and
instanced by material. No new runtime texture or lighting pass is introduced.

Assets cover saddle leather chairs, bar stools, the teal booth/bistro table,
slatted bar/draught dressing, back-bar shelves/bottles, window, three bar pendants,
linear table pendant, sign, plant and wall artwork. Coordinates are glTF Y-up at
seven room units per metre. The booth and window follow the west cutaway;
bar/shelves/sign/stools follow north; art/plant follow east; pendants follow the
ceiling. Shared occupancy replaces the review's fixed chair roster.

The west rough opening is 22.4 units wide and spans 9.1–20.3 above the floor,
ending within the black frame on all four sides. Desktop glazing is nearly clear
alpha without depth writes; phones omit it. The chosen sky stays visible; the
review's 3D city is not imported. Browser ray tests check reveal separation.
Adaptive steel pedestal supports run from `floorY` to `TABLE_FINISH.rimBase`
inside the shared table outline, with no server collider or table replacement.
Room-environment layout now also derives hex depth from shared `tableOutline`;
round and other shape sizing retain their existing rules.

Procedural leather relief becomes fine periodic normal/roughness maps in the
derivative exports. Phone preparation drops detail maps through the shared owner;
fallbacks and stale-load disposal retain existing behavior. LED/neon emissions
are static materials, with no runtime lights. **Use matching table** explicitly
applies Walnut / deep teal `#294b4c`. The chair and table-pendant use a separate
Blender detail revision: rearward back lean with piping fitted to the bevel, and
smooth satin brass without coarse relief maps. The original approval is preserved;
this two-model correction needs a client hard refresh only. Apply migration `027_modern_bar.sql` through
the migration role, restart the server and refresh clients. Existing room choices
and the Standard default are retained. Manual device/gameplay acceptance remains.

## Approved rear-wall additions

The south walls now carry the accepted Blender additions. Modern Bar has a
black-framed glass entry at `rx * doorOffsetRatio` in wall-local X and a compact
teal booth/cafe table in the reverse viewer's left corner. The nook position uses
the wall extent, authored half-width, corner margin and inset, preserving seating
clearance as table size/shape changes. Poker Night has an offset walnut door with
a small upper glazed lite; its wainscot, beads, battens and trim stop at the casing.
Tavern uses the existing corrected window GLB on both west and south, through one
model load and shared room-owned resources. Both reserve shutter clearance.

`wallOpeningPanels(width, bottom, top, opening)` in `rooms/wall-openings.js`
returns nonoverlapping opaque rectangles around one wall-local aperture. All three
themes reuse it for plaster and applicable lower bands. Openings are `{x, width,
bottom, top}` in room units; door dressing can use the wider casing bound while
plaster uses the rough opening inside the solid frame. Whole-room ownership,
cutaways, failed/stale loading and cleanup remain with the existing assembly.

Door glazing uses alpha without depth writes or shadows; phones omit it. The
selected sky remains visible through openings; review sky/city/corridor panels
are excluded. The two doors and nook add three canonical GLBs, while Tavern
reuses its existing window. A client refresh is sufficient for these additions;
no new migration/server restart is needed. Manual device/gameplay acceptance
remains separate from model and bootstrap checks.

## Verification and extension

`test/cozy-room.js` retains the full cozy behavior/resource/device suite, selecting
model fixtures by asset URL rather than load order. `test/room-environment.js`
constructs a second, minimal courtyard fixture without cozy components/assets,
checks missing components, invalid dimensions, repeat sync, cleanup, failed-build
retry and device policy. It is a test fixture, not a second shipped room theme.
Resource and settings tests cover unused palette cleanup, preserved shared maps,
explicit matching messages and live permission rechecks. Component tests exercise
the registered cozy production bootstrap, windows/sky and full/compact touch UI.
Cutaway regressions cover interior pans, all outside wall directions, shared gables,
room resizing, both pitched slopes and re-entry jitter. Browser probes verify that
retained side walls still occlude the sky and ceiling apertures remain clear on
desktop and touch. Physical-device orbit feel and GPU performance need manual testing.

To add a bundled theme, define its six component records (optional components may
be omitted), own its palette/assets, add it to `ROOM_THEMES`, record asset sources
and licenses, add the ID to `shared/room-environments.js` and a new numbered migration
that extends the database constraint, and run the same lifecycle/device tests. Use theme-specific geometry
or extend an existing surface implementation when its rules fit; avoid copying
phone preparation, occupancy, cutaway or disposal logic into the theme.
