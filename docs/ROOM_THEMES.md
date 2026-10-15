# Room themes

Room themes build viewer-local scenery around the existing playable table. The
cozy room is the first registered theme. Its current art, layout, authored models,
phone fallback, clear windows, sharp rug and full tabletop shadow are retained.

The server owns `State.environment`, a public per-room choice of `standard` or
`cozy`. In **Room Settings → Table Size & Color**, above Shape, the approved native
**Room style** select offers **Standard (skybox only)** and **Cozy game room**.
GM/owner changes use `roomEnvironment {environment}`; the guarded handler validates
the exact payload, ignores repeats and schedules the existing durable save. All
clients receive the schema patch and switch together. The selection is stored in
`rooms.room_environment` by additive migration `024_room_environment.sql`; old and
new rooms default to Standard. Restart the server with the migration connection
configured, then refresh clients. No new service, port or environment variable is needed.

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
| Structure | Required `build(dependencies)` plus `floorY`, `wallHeight`, `clearance`, `minimumHalfSize`, `cutawayThreshold`, `overheadSlope`. Returns optional `walls` and named `anchors`. | Oak ground/floorboards, plaster walls and trim; north/south/east/west anchors. |
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
`sync(tableState)`, `update(cameraPosition, target)` and idempotent `dispose()`.

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
- `furnishing(assetKey, parent, fallback, yaw = 0)`: register a replacement slot.
  Theme `assets` map keys to `{url, scale, name, resourceName?}` records.
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

Cutaway walls return `{group, normal: [x,z]}` using normalized outward horizontal
normals. `update` runs after camera controls and before shadow refresh/render.
Desktop/tablet construction reports the room world bounds to core's existing
shadow-camera fitter; disposal reports null. Phone construction reports null and
uses lightweight contact shading. No new lights, render loop or postprocessing
passes are installed.

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

## Verification and extension

`test/cozy-room.js` retains the full cozy behavior/resource/device suite, selecting
model fixtures by asset URL rather than load order. `test/room-environment.js`
constructs a second, minimal courtyard fixture without cozy components/assets,
checks missing components, invalid dimensions, repeat sync, cleanup, failed-build
retry and device policy. It is a test fixture, not a second shipped room theme.
Resource and settings tests cover unused palette cleanup, preserved shared maps,
explicit matching messages and live permission rechecks. Component tests exercise
the registered cozy production bootstrap, windows/sky and full/compact touch UI.

To add a bundled theme, define its six component records (optional components may
be omitted), own its palette/assets, add it to `ROOM_THEMES`, record asset sources
and licenses, add the ID to `shared/room-environments.js` and a new numbered migration
that extends the database constraint, and run the same lifecycle/device tests. Use theme-specific geometry
or extend an existing surface implementation when its rules fit; avoid copying
phone preparation, occupancy, cutaway or disposal logic into the theme.
