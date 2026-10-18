# Medieval Tavern furnishing models

Eight original project models from the user-approved Blender mockup, under the
repository license. Source: companion
`3d_models/original/medieval_tavern_v1/medieval-tavern-approved.blend`, SHA-256
`97fdbeb50f042d17547e71883771258ee6471ededb5c3ab5421191e13e82bb91`.
The snapshot and editable mockup are preserved. Its `export_runtime.py` evaluates
modifiers, normalizes each authored origin, batches by material and exports only
the active temporary scene; the source file hash is checked unchanged afterward.

Files: `tavern-chair.glb`, `tavern-stool.glb`, `tavern-bench.glb`,
`tavern-barrel.glb`, `tavern-hearth.glb`, `tavern-window.glb`, `tavern-bar.glb`,
`tavern-chandelier.glb`. The bar includes shelves, vessels, linen and cup pennant.
No lights, camera, review game pieces/table or whole-room mesh is included.

Units are metres, glTF Y-up, front +Z. The theme applies seven room units/metre;
occupied seating uses the shared front -Z convention via a half-turn. Floor
offsets ground authored chair/stool/bench/barrel feet. Chandelier coordinates
retain the authored hanging height and follow the ceiling cutaway.

Oak color reuses Luke.RUSTLTD's existing credited CC0 map and original Cozy normal
derivative. New geometry and periodic 512px PBR relief adaptations of original
procedural stone/plaster/cloth/metal/ceramic shaders are project originals.
Alpha glazing replaces review transmission, avoiding a refraction pass; phones
hide glazing and use the shared base-material policy. Original materials are
unchanged in the approved source. Static emissive flames/candles add no runtime
light or simulation. See `docs/ASSET_CREDITS.md` for attribution.

Published serially through `tools/model-authoring/publish.mjs`; each derivative
passed exact source/candidate material, image-pixel, hierarchy and GPU comparison
on desktop and coarse touch under strict CSP. The manifest records hashes and
integrity baselines. Eight compressed GLBs total 10,103,652 bytes. Real-device
performance and manual multiplayer gameplay remain separate QA requirements.

## Window fit correction

The first fit revision came from companion
`medieval-tavern-window-fit.blend`, SHA-256
`3535a95fb390fc491cde23204efff09b8eb7013d03ea69e10f0a8de9762288c3`.
Its input is a separate snapshot of the owner's unsaved scene, retaining the
moved right shutter. `fit_window.py` shifts only the two shutter leaves 0.20m
into the room; horizontal placement, rotation, scale and materials are retained.
The active file and original approval snapshot are preserved. The other seven
assets still use the original approved source above. See `window-fit-report.json`
and `runtime/window-fit-export-report.json` for exact source transforms/hashes.
The exporter refuses to regenerate this window from the earlier approval file;
use its explicit source override and window-only selection for future exports.

The current `tavern-window.glb` uses `medieval-tavern-window-reveal.blend`, SHA-256
`3bd3b5181a3a44e0b5fffc2a215c6a1ccd85ab1839b4f33ed3bb451cc42e1c0a`.
`refine_window.py` mirrors the good left shutter's X position for the right leaf,
retaining stand-off, rotations, scales and materials. Both previous fit snapshots
and the approval file remain unchanged. `window-reveal-report.json` and
`runtime/window-reveal-export-report.json` record this source and its window-only
export. Runtime plaster opening edges lie within solid timber on all four sides;
browser ray tests check clearance behind the visible inner jamb/lintel faces.
