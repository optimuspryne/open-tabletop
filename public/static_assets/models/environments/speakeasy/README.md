# 1920s Speakeasy furnishings

Current local source package: [final 1920s Speakeasy assets](../../../../../../Open-Tabletop_Asset_Builders/3d_models/rooms/1920s-speakeasy/README.md). Earlier revision names below describe integration history.

Eight original project derivatives of the owner-approved October 18 v4 source:
`3d_models/original/rooms/1920s-speakeasy/source/speakeasy-piping-v4.blend` in the companion
asset workspace, SHA-256
`258e96c3c6cac4f341b0f8224f34b935494b92522138675f6d53e9e3dea0fe5d`.
The approved source and its packed original images are unchanged.

Files: `speakeasy-{chair,booth,bar,console-wall,door,north-fans,pendant,rug}.glb`.
The console-wall model retains the accepted two rear fans, framed abstract art,
desk/drawers and generic chart. The north fans remain a separate wall attachment.
The chair retains smooth shading and the fitted v4 seat piping; the booth retains
its smooth scalloped channels. One pendant is reused twice, including the stem
and conical canopy. The game table, review cameras/lights and fixed six-chair
roster are excluded. Runtime occupancy and gameplay table owners stay authoritative.

Units: metres, glTF Y-up; runtime scale is seven units/metre. Chair origins are
normalized to the evaluated feet, with the authored back toward -Z and the
open seat facing +Z. Runtime applies a half-turn in the chair furnishing slot
to match occupied seating (back outward, open seat toward the table). Booth/bar origins are
floor-relative; their frontage is +Z. South console-wall/door anchors rotate the
source so frontage is +Z in their wall-local space. Console-wall anchor is
Blender `(-1.8,-3.6,0)` with a half-turn; north-fan anchor is `(0,3.6,0)`.
Pendant anchor is its ceiling contact at `(-1.05,0,3.47)`; its glTF Y bounds are
-0.920–0.001m. The runtime ceiling underside follows that contact and hides both
fixtures in overhead views. Rug footprint can resize while height stays fixed.
Exact per-object transforms and evaluated bounds are in the export report.

Companion `rooms/1920s-speakeasy/tools/export_runtime.py` reuses the existing Modern Bar
portable-map helpers, evaluates modifiers/curves and batches by material. It
adapts source procedural relief to portable normal/roughness maps, weakens the
velvet normal detail, and bakes the existing oak/tint multiplication into a base
map because glTF does not represent the original MixRGB tree. Original materials
are never saved over. Satin metal retains its authored scalar finish. The phone
policy removes detail maps in the shared runtime; emissions are static and no
lights are imported. The original CC0 oak texture by Luke.RUSTLTD is already
credited in-app and in `docs/ASSET_CREDITS.md`; all new geometry/maps are project
originals under the repository license.

The canonical publisher compares source/candidate geometry, material/hierarchy,
image pixels and GPU rendering under strict CSP on desktop and coarse touch.
Eight final models total **3,571,016 bytes** from **6,985,820 raw export bytes**
(48.9% smaller), with zero validator errors/warnings. Exact hashes/baselines are
in `../../manifest.json`. Reproduce with the companion exporter in background
Blender, then the existing `tools/model-authoring/publish.mjs`; see the parent
model README. Manual device performance/gameplay acceptance remains separate.
