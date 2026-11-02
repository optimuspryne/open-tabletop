# Ancient Temple furnishings

Current local source package: [final Ancient Temple assets](../../../../../../Open-Tabletop_Asset_Builders/3d_models/rooms/ancient-temple/README.md). Earlier revision names below describe integration history.

Eight original project derivatives of the approved smooth v2 source in companion
`rooms/ancient-temple/source/ancient-temple-v2.blend`, SHA-256
`f9d44c0b6ebab77ae916a7584c0c182a4b422b97b1aecd267c1d5eb2831714fc`.
The approved source and its authored materials are preserved unchanged.

Files: `temple-{chair,column,brazier,relief,console,door,opening-frame,paver}.glb`.
The column is reused four times and the brazier twice. Only the window jambs/sills
are exported for the loggia; the blue exterior study and foliage are excluded.
One authored paving stone becomes a bounded 32×32 instance batch through the
room's usual resource owner. The review game table, fixed chair roster, cameras
and staging lights are excluded. The playable table and saved sky/lighting keep
their existing owners; coals remain static emissive materials.

Units: metres, glTF Y-up at seven runtime units/metre. Chair feet are grounded;
the actual back is -Z, so runtime applies a half-turn for occupied seating.
Column and brazier origins are on the floor. The column anchor is Blender
`(-3.65,3.25,0)`, the frame anchor `(0,3.62,0)`, and the single paver anchor
`(-4,-3,0)`. Paver bounds are ±0.4925m in plan and -0.0275–0.0075m in height.
The west relief anchor is `(-4.33,0.2,0)` with a quarter-turn; console/door frontage
is +Z in wall-local space. Exact evaluated bounds and per-object transforms are
recorded in companion `rooms/ancient-temple/provenance/original-export-report.json`.

The background-only exporter extends the existing Speakeasy evaluated-mesh,
material-batched recipe and pure Modern Bar `png`/`portable` helpers. It selects
only one source column/paver, grounds the seat using evaluated vertices, retains
smooth normals and adapts procedural mineral relief to portable 512px maps.
The shaft alone receives an even cylindrical UV wrap: one seamless repeat around
the circumference, the same metre scale vertically, with its seam toward the
wall. Other UVs, geometry, normals and stone maps are unchanged.
No original material is saved over. The shared phone policy removes detail maps;
new paver instances explicitly retain picking/shadow/disposal policy. All new
geometry and maps are project originals under the repository license. No external
asset is added; runtime shell maps, sky previews and pup keep their existing
credits in `docs/ASSET_CREDITS.md`.

The canonical publisher verifies exact decoded geometry/materials/hierarchy,
image pixels and strict-CSP desktop/coarse-touch GPU comparisons. These eight
models have zero validator errors/warnings and total **2,629,816 bytes** from
**4,998,200 raw export bytes** (47.4% smaller). Exact hashes/baselines are in
`../../manifest.json`. Reproduce through the companion exporter and the existing
`tools/model-authoring/publish.mjs`; see the parent models README. Broader checks
and manual device/gameplay limits are recorded in `docs/PLAN_ROOM_THEMES.md`.
