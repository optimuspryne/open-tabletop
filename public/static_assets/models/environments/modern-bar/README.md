# Modern Bar furnishing models

Thirteen original project derivatives of the user-approved Blender mockup, under
the repository license. Companion source:
`3d_models/original/modern_bar_v1/modern-bar-approved.blend`, SHA-256
`7e40e89696523607164ef723d24f864ab9a917cd674c6aed0cc23cd05791f314`.
Both approval snapshot and editable mockup/materials are preserved unchanged.
Chair and table-pendant now use the separate `modern-bar-detail-fit.blend`, SHA-256
`2d79e7106b9700ab1be565193275bdd0e8b56983d00c6bdefb98cb9b5ee3eef1`.
Other nine derivatives retain the original approved source above; the export
report records provenance per asset. The chair has a slight rearward lean and
piping fitted/parented to its beveled cushion. The table pendant uses smooth satin
brass (roughness 0.42), without the former coarse normal/roughness maps.

Files are `modern-bar-{chair,stool,booth,bar,shelves,window,bar-pendants,table-pendant,sign,plant,art,door,nook}.glb`.
The booth includes its bistro table/vase; the bar includes taps/counter dressing;
shelves include bottles. Font/curve objects are converted to mesh in derivatives.
No staged light, whole-room shell, review game table, fixed chair roster or city
backdrop is exported. The runtime uses occupied seating and the saved sky/lighting.

Units are metres, glTF Y-up, seven room units/metre. Each asset retains an explicit
source-relative anchor in `runtime/export-report.json`. Chair, stool, bar, booth
and plant floor origins are normalized against their source bounds. Chair/booth
front is -Z; wall-side booth placement uses a half-turn. Bar/shelves/sign/art front
is +Z. The window anchor rotates its authored +X frontage into +Z. Bar-pendant
origin is centered across the three fixtures; fixture heights remain absolute
above their floor origin so runtime can attach cables to the ceiling.

`export_runtime.py` evaluates modifiers, supplies missing converted-curve UVs,
batches by material and exports only the active temporary scene. Procedural
leather/metal/quartz relief is adapted to original periodic 512px PBR maps in the
derivative only. Leather uses fine low-strength normal/roughness grain; no source
material is overwritten. Transmission becomes nearly clear alpha glazing;
runtime window glazing has no depth write, and phones omit it. Phone material
preparation uses the existing lightweight policy. Emissions remain static with
no extra runtime light pass.

The walnut color map reuses Luke.RUSTLTD's already credited CC0 image. All new
geometry/PBR adaptations are project originals; lettering uses Blender's built-in
font. See `docs/ASSET_CREDITS.md`. No external asset was downloaded for this theme.

The canonical publisher validated decoded geometry, material/hierarchy/image
baselines and source/candidate GPU views on desktop and coarse touch under strict
CSP. Thirteen compressed GLBs total 8,911,316 bytes, versus 14,973,556 source-export
bytes. The manifest contains exact per-file hashes and fingerprints. Broader
runtime/device checks and manual acceptance are tracked in `docs/PLAN_ROOM_THEMES.md`.


The approved rear-wall additions use companion
`room_backwalls_v1/modern-backwall-v2.blend`, SHA-256
`1cee4c75214bb7edc6572a0ad47532c617fd9fcd1c0c93886069fd7b65fb422b`.
`modern-bar-door.glb` is the black entry frame, glass/privacy band and brass pull;
`modern-bar-nook.glb` combines the short teal booth and round cafe table/vase.
Their front is +Z and floor origin is zero. Nook bounds are about ±0.88m wide,
-0.345–1.18m deep and 1.275m high; its root is inset from the south wall in the
reverse viewer's left corner. Door root follows the wall, offset to the right in
that view. Opaque plaster/skirting is clipped to its opening/casing; alpha glazing
has no depth write and is omitted on phones. No review context is included.
The narrow `room_backwalls_v1/export_backwalls.py` exporter reuses the existing
`png`/`portable` and evaluated/material-batched recipe, with per-asset source hashes.
The original nine approved derivatives and two chair/pendant corrections retain
their own sources recorded above. No existing GLB is re-exported by this addition.
