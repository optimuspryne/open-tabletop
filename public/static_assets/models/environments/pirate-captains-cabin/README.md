# Pirate Captain's Cabin furnishings

Current local source package: [final Pirate Captain's Cabin assets](../../../../../../Open-Tabletop_Asset_Builders/3d_models/rooms/pirate-captains-cabin/README.md). Earlier revision names below describe integration history.

Original project derivatives of companion `rooms/pirate-captains-cabin/source/pirate-captains-cabin-v2.blend`,
SHA-256 `10dceb7119545d1ac31ed60f8b549c7d28113adaa7a363163e8926c752a22b77`. The native source remains unchanged.

Files: `north.glb`, `south.glb`, `west.glb`, `roof.glb`, `fixture-1.glb`, `fixture-2.glb`, `chair.glb`, `floor-decor.glb`.
8 models total 4,009,056 bytes from 6,902,952 raw bytes.
All have zero validator errors/warnings. Exact source/final, decoded geometry,
image and desktop/touch baselines are in `../../manifest.json`.

Units: metres, glTF Y-up, seven runtime units/metre. Wall collections use native
anchors North `(0,3.73,0)`, South `(0,-3.73,0)` with a half-turn,
West `(-4.53,0,0)` with a quarter-turn, East `(4.53,0,0)` with the opposite turn.
Chairs are grounded from evaluated vertices; local backs are glTF -Z and runtime
applies the occupied-seat half-turn. Roof structure and fixtures are separate:
structural members follow room extents while fixtures retain their round covers.

Wall dressing remains rigid and follows its support cutaway. Native review
tables, fixed seat rosters, cameras, lights and exterior placeholder/dioramas
are excluded. The selected room sky remains visible through real apertures.
Smooth source geometry/materials and packed original oak art are preserved;
procedural relief becomes portable periodic 512px PBR maps only in derivatives.
Cyberpunk’s older flat mesh faces are smoothed in an unsaved export copy.
Victorian’s clock is lowered 0.06m in its derivative to rest on the mantel; the
rigid east desk receives a 1.19-unit runtime inset. Other source placements
remain native. Shared phone policy strips detail maps/physical layers.

All geometry/maps are original project work under the repository license. Packed
CC0 oak art and the existing shell maps/shared companion/preview sky retain
their existing credits in `docs/ASSET_CREDITS.md`. Reproduce via companion
`rooms/_shared/tools/export_remaining.py` and the canonical publisher; see
the parent models README and `docs/ROOM_THEME_RUNTIME_REVIEW.md`.
