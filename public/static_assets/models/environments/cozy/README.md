# Cozy room models

Original models created for Open Tabletop with Codex, corrected by the project owner.
Distributed under the repository license. Wood color/derived maps reuse Luke.RUSTLTD's
CC0 oak texture; linen maps are project originals. See `docs/ASSET_CREDITS.md`.

Authoritative companion source: `3d_models/original/BLEND/cozy_room_assets_fixed.blend`.
Initial furniture-export source SHA-256: `6547aafe70e802e2a26f3dea69efc56e0a3bf56281a542913ac0d161acf7fcbb`.
Exporter: `3d_models/original/cozy_room_v1/export_fixed_assets.py`.
The source is opened in background Blender without saving it. Geometry,
modifiers, materials and corrected relative transforms are retained. Only each asset's
review-stage translation is removed, then evaluated meshes are batched by material.
The shelf first used `cozy_plants_v1/export_shelf_uv.py` and a separate
`cozy-room-shelf-uv.blend` derivative to activate its grain-aligned oak UVs. The current
`cozy_shelf_v2/cozy-game-shelf-collection.blend` derivative keeps that corrected
frame/tray and storage baskets, replacing generic props with 27 display groups of
built-in decks, coins/chips, Go bowls/stones, dominoes and pouch. The dominoes box
is half the approved mock-up size: 0.26 metres / 1.82 room units on its longest axis.
Its exported group is `ShelfDominoesBox`. These are scenery, with no inventory/picking.

Current shelf source hashes, verified unchanged during the collection export:

- Owner fixed source: `b466be402b99a99a563412655bb77f194344b05904f205e4cd536460fcb2e746`.
- UV derivative: `89e7eee7023f34566af2f2f8e109ddb25463059569fcc181cab4e334be0f4241`.

The companion `cozy_shelf_v2/README.md` records authoring, shelf-only LOD, active-UV
batching, verification and sources. Gameplay originals and chair/lamp GLBs are unchanged.

| File | Triangles | Material batches | SHA-256 |
| --- | ---: | ---: | --- |
| cozy-chair.glb | 4,508 | 3 | 0e819fdb8aaabcded25ed0ffb91e56091e85e349f4a5447c656e7387bdc40075 |
| cozy-game-shelf.glb | 141,346 | 29 | 9533beeff99fe32317a3a411df6434094ddeb9662ce7803aabdc47e0ac3e71ba |
| cozy-floor-lamp.glb | 4,940 | 4 | b746d58f63ec400e459ede6b3fafdc51959972467e54740137613c267a77b96c |

Each GLB embeds its images and uses standard glTF PBR materials, without an
external decoder. The shelf requires `KHR_texture_transform`, supported by the bundled
loader; it embeds 15 images and is 15,942,228 bytes. Metres, Y-up, front +Z.
The room places them at seven room-units per metre; the source review-stage offsets are not room placements. No physics, lights,
cameras or game rules are included in the models.

## Android memory mitigation

Shelf-only image derivatives have a maximum dimension of 512px. Fifteen unique RGBA
images plus estimated mipmaps cost about 17.7 MB, down from 80.0 MB. Geometry,
additional GPU copies and decode/upload peaks are not included. Gameplay originals
remain intact. Top coins retain full authored relief/normals; only lower stack coins
use the .08 detail ratio. Metalness1 and roughness 0.3 match gameplay coin tuning.
The Android freeze/black-canvas/crash report still requires an on-device retry;
desktop/touch-sized fixtures cannot establish the actual crash cause or resolution.

## Window frame

`cozy-window.glb` is a separate original asset from companion
`3d_models/original/room_shell_v1/cozy-room-shell.blend`, built with
`build_room_shell.py`. It contains 3,760 triangles in two material batches, embedded
oak maps, casing/jambs, a projecting sill, glazing bars and bronze handles.
SHA-256: `991536e6558ff67c4f0fc3c86e75b9ce981aeed13552184ea7cb20edb53d4ffd`.
Its origin is the aperture center, with +Z facing inside the room; it uses the same
seven-unit scale. The client adds clear alpha glazing. No painted sky, glass geometry,
camera or light is embedded. It does not alter the fixed furniture source above.

## Plants

Original UV-textured botanicals from companion
`3d_models/original/cozy_plants_v1/cozy-plants.blend`, built by `build_plants.py`.
All geometry and deterministic leaf/soil/pot maps are project originals under the
repository license. Curved opaque double-sided leaves avoid alpha-sorting artifacts.
Each GLB embeds its 512px color, normal and roughness maps; base origin, metres, Y-up.

| File | Triangles | Material batches | SHA-256 |
| --- | ---: | ---: | --- |
| cozy-rubber-plant.glb | 4,536 | 4 | 1e1931377839feca16d976101b29bb60aff4dab989b8f1c84599369d6efd5f70 |
| cozy-snake-plant.glb | 3,960 | 3 | 473ffebcd80d0fb457e3c9045652d88623e999612689c5c67bd7ab1d01adf1f3 |
| cozy-pothos.glb | 9,456 | 4 | ffcf689a7ce8381bbb89e641dcc88f017c00028aa38a3a56da2c0591826925a3 |

The room loads each variant once per build and places two copies with varied rotations
and sizes. Model resources are shared only within that owned room root. The shelf/sill
plants inherit wall cutaways. Neither the concept image nor Blender lighting is exported.
