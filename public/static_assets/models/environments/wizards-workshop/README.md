# Wizard's Workshop furnishings

Current local source package: [final Wizard's Workshop assets](../../../../../../Open-Tabletop_Asset_Builders/3d_models/rooms/wizards-workshop/README.md). Earlier revision names below describe integration history.

Original project derivatives of companion `rooms/wizards-workshop/source/wizards-workshop-v2.blend`,
SHA-256 `f91dd448e6b775abb8607d236ac2d1ba4e982d5689d0168051cf92e09c1f8abe`. The native source remains unchanged.

Files: `north.glb`, `south.glb`, `west.glb`, `east.glb`, `roof.glb`, `chair.glb`, `floor-decor.glb`.
7 models total 8,931,684 bytes from 14,513,048 raw bytes.
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
