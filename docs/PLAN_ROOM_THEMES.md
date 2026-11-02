# Room theme expansion

Current status (October 19, 2026): all eleven reviewed themes are integrated
locally, for **16** total room choices. [Current runtime review](ROOM_THEME_RUNTIME_REVIEW.md)
lists views, matching finishes and migration/restart steps. Final owner in-app
acceptance remains pending; older dated phases below are historical.

Written 2026-10-16 (America/Phoenix).

Status: the fourteen-theme lineup is accepted. Poker Night is implemented locally
and the user reported the refreshed room looks really good. The user approved the
Medieval Tavern Blender mockup on 2026-10-16 ("Yep looks great"). Eight Tavern GLBs
are published and the theme is registered locally. Automated integration checks
pass, and the user accepted the window/support corrections, confirming the flicker
is gone. The user approved Modern Bar with "Looks good"; it is now integrated
locally, with verification recorded below. The user accepted its chair/pendant
corrections on 2026-10-17. Rear-wall additions for these three themes are now
approved with "Looks great" and integrated locally; verification is recorded
below. Other themes
remain a backlog.
Historical check results remain
labeled by slice; they do not establish later model/device or multiplayer QA.

[Approved Poker Night concept](mockups/poker-night-concept.png) ·
[Image-generation prompt](mockups/poker-night-concept.prompt.txt).
The concept was generated with the built-in imagegen tool and is a design
reference, not runtime artwork.

## Theme lineup

Each room should feel like a place where people gathered to play. Keep the table
as the centerpiece, the playing surface calm, decorative clutter around the room
edges and the strongest useful illumination on the table.

| Theme | Table and surroundings | Lighting and mood |
| --- | --- | --- |
| Poker Night | Green felt, dark wood, leather chairs and drinks on side tables. A padded rail is a possible later table-style extension. | Low pendant fixtures; intimate private card room. |
| Medieval Tavern | Heavy oak table, mismatched stools, timber beams, stone walls, barrels and a hearth. | Firelight and candles; rainy windows. |
| Modern Pub / Tavern | Worn wood table, upholstered booths, brick walls, bar counter and bottle shelves. | Amber lamps, subtle neon and an evening city outside; social and comfortable. |
| Starship Lounge | Rounded metal table with an inset playing surface, built-in seating, wall panels and a viewport. | Soft strip lighting, stars and a planet beyond the glass; serene spaceship interior. |
| Victorian Study | Polished walnut table, bookshelves, fireplace, globe and tall curtains. | Warm, quiet and slightly mysterious. |
| Mountain Cabin | Sturdy pine table, exposed rafters, wool rugs and snowy windows. | Relaxed board-game weekend. |
| 1920s Speakeasy | Intimate card table, burgundy velvet, brass details and patterned wallpaper. | Glamorous and secluded. |
| Pirate Captain's Cabin | Weathered table, stern windows, hanging lanterns, maps and sea chests. | Warm lanterns against the sea outside. |
| Wizard's Workshop | Carved table, potion shelves, curious instruments and a few gently floating objects. | Magical study; animation is optional later polish. |
| Cyberpunk Back Room | Battered table in an apartment or arcade back room, rain-streaked windows. | Colored city light and an after-hours mood. |
| Japanese Game Café | Light wood, comfortable seating, shelves of games, plants and broad windows. | Bright and welcoming. |
| Garden Conservatory | Simple table under a glass roof, surrounded by greenery. | Soft daylight and rain outside. |
| Ancient Temple | Stone playing table, monumental columns, braziers and an open landscape view. | Dramatic scale with a readable playing surface. |
| Orbital Observation Deck | Circular table, minimal furnishings and an enormous planetary view. | Quiet, expansive and more open than the Starship Lounge. |

Delivery starts with Poker Night. The other three initial requests—Medieval Tavern,
Modern Pub / Tavern and Starship Lounge—are the proposed next sequence. Remaining
themes are the accepted backlog, with order and concrete designs still open.
Room descriptions express art direction; proposed different table models,
special lighting, weather, sound and animation are not existing capabilities or
automatic additions to the first slice.

## Existing implementation and reuse decision

The starting choices before this slice were Standard and Cozy. Poker Night now
uses the existing
[room-theme component contract](ROOM_THEMES.md), rather than a separate room
renderer or a fork of Cozy's lifecycle:

- `public/rendering/rooms/room-themes.js` resolves bundled definitions;
  `room-backdrop.js` follows the shared room selection.
- `room-environment.js` orchestrates structure, openings, play area, furnishings,
  decoration and atmosphere. It owns rebuilds, cutaways and cleanup.
- `room-assembly.js` and `room-seating.js` already own model replacement, batching,
  device policy and occupied seating. Reuse those responsibilities.
- `shared/room-environments.js` owns the public IDs/options. The server persists
  the selection in `rooms.room_environment`, introduced by migration 024 and
  extended by migration 025 for this slice.
- The existing **Room style** select and **Use matching table** action provide
  the entry points. Matching metadata currently supports wood and felt only;
  shape, dimensions, lighting and sky remain independent.

Add a focused Poker Night theme definition and art-specific builders/materials.
Extend an existing surface helper only where geometry/material rules actually
match. Do not copy phone preparation, seating, cutaway, disposal or save logic.
Padded rails, built-in seats and alternative tabletop materials would require
separate table-owner work; they must not be disguised as nonphysical scenery on
the playing surface.

Evidence: Tier 2 graph discovery, exact runtime/settings snippets and direct source
checks against graph generation `2026-10-16T16:13:36Z`. Coverage reported no recorded
gaps in the registry/runtime/settings files. The HTML/schema reported partial
coverage; the relevant settings markup and database definition were read directly.
Rediscover current callers and check freshness before implementation.

## Poker Night: approved first visual proposal

Registered ID: `poker-night`. Display name: **Poker Night**.

### Room and table

- An intimate private card room with dark walnut wainscoting, muted olive upper
  walls, warm wood floor and a restrained charcoal rug.
- Dark brown leather chairs at occupied seats, aligned through the existing
  seating owner. The concept's chairs illustrate appearance, not a fixed roster.
- Brass and green-shaded pendant above the table, with sufficient seated camera
  clearance. Use material appearance first; theme selection must not override
  room lighting or introduce extra shadow-light passes.
- A small wall-side sideboard with a few glasses and a carafe, plus a curtained
  window. Window views continue to use the existing chosen sky; the night scene
  in the concept is illustrative, not an automatic skybox change.
- Wall/ceiling-attached fixtures follow their support's cutaway. Overhead views
  reveal the full table without pendant or ceiling obstruction. Preserve a clear
  seated view and usable chair/camera clearance across supported sizes/shapes.
- **Use matching table** proposes existing Walnut wood and green felt `#1e5c3f`.
  Selecting the room alone retains the current table finish. No fixed oval shape,
  padded rail, cup holders, poker betting marks or decorative gameplay pieces in
  the first slice. Existing table shape and dimensions remain authoritative.
- No theme-specific poker rules, betting automation, scoring or deck changes.

The generated concept is a visual target for review, not an in-app screenshot or
proof of final lighting/performance. Implementation must work with independent
saved lighting, table choices and sky, including brighter presets.

### Approved settings examples

Use the current native select and text button. Add the Poker Night option; retain
the existing visible labels in full and compact modes. No new/replaced icon is
proposed. Tabler icon selection is therefore not needed for this slice.

Desktop, both full and compact:

```text
Room style   [ Poker Night                         v ]
             Shared with everyone. Saved for this room.

Room match   Poker Night   [ Use matching table ]
             Applies Walnut wood and dark green felt. Keeps shape and size.
```

Touch / narrow layout, both full and compact:

```text
Room style
[ Poker Night                                  v ]
Shared with everyone. Saved for this room.

Room match
Poker Night
[ Use matching table ]
Applies Walnut wood and dark green felt.
Keeps shape and size.
```

Preserve semantic controls, accessible descriptions, native keyboard operation,
visible focus, GM/owner permission states and 44px touch targets. Mouse, keyboard
and touch keep the current room selection/matching actions and camera intents;
no new tabletop gesture is proposed.

## Implementation slices

1. **Scenery and lifecycle.** Build Poker Night through the existing component
   contract, with procedural failure fallbacks and room-owned materials. Use the
   current cutaway and occupied-seating owners. Review seated and overhead views,
   dimension/shape adaptation and desktop/phone rendering. Preserve original
   authored files in the companion asset workspace; record provenance/licenses
   for bundled assets and use the established GLB publishing workflow.
2. **Selection and persistence.** Register `poker-night` in the browser registry
   and shared options. Add the next unused numbered migration extending the
   environment constraint; update the fresh-install baseline/migration ledger.
   Keep Standard as the default and reuse the guarded roomEnvironment/save path.
   Refresh in-app help to describe the available choice. Keep table matching
   explicit through the existing wood/felt messages.
3. **Verification and documentation.** Add meaningful theme/lifecycle/persistence
   regressions; verify the production bootstrap and registered path. Update
   [REFERENCE.md](REFERENCE.md), [ARCHITECTURE.md](ARCHITECTURE.md),
   [ROOM_THEMES.md](ROOM_THEMES.md), asset credits and [CHANGELOG.md](../CHANGELOG.md)
   with actual implementation and upgrade requirements. Leave a cohesive version
   ready for user testing before starting another theme.

## Verification and acceptance

For the current documentation/design slice: check local links, consistency and
`git diff --check`. Runtime suites are not evidence for an unimplemented theme.

After implementation, run `npm run check`, `npm run test:components`,
`npm run test:devices` and `npm run test:integration` for the settings and migration
work. Run `test:models` for new bundled GLBs; run `test:input` if input handling
changes. Verify stale/failed asset loads, repeated switches, palette disposal,
occupied-seat changes, small/large tables and all supported shapes. Use phone
compatibility materials and bounded textures; retain readable felt and pieces.

Manual smoke test after the implementation's migration/server restart and client
refresh:

- A GM/owner selects Poker Night; another client sees it, while unauthorized
  users cannot change it. Refresh, reconnect and restart preserve the selection.
- Switching Standard → Poker Night → Cozy → Standard leaves no stale scenery.
- Room selection preserves the current table. Explicit matching changes only wood
  and felt. Scene load, game reset and saved-game load preserve the room choice.
- Seated, panned, outside-wall and overhead views show appropriate cutaways;
  pendants, chairs and wall dressing do not obstruct gameplay or picking.
- Full/compact desktop and touch settings remain readable, focusable and usable.
  Test an actual phone for cold load, GPU performance and orbit feel.

## Progress

- [x] Record all fourteen theme concepts and the shared art principles.
- [x] Inspect the existing registry, runtime, settings and persistence boundary.
- [x] Prepare Poker Night art direction and desktop/touch settings examples.
- [x] Obtain explicit approval of the concrete Poker Night proposal, as required
  by [AGENTS.md](../AGENTS.md).
- [x] Implement Poker Night scenery, registration and durable selection.
- [x] Complete applicable automated verification and document results.
- [ ] Complete user/manual testing; do not infer it from automated checks.

No push or deployment is authorized by this plan.

## First implementation and file summary

The first pass uses original procedural scenery and existing credited textures
and rubber-plant GLB. The approved concept is the visual direction; it does not
claim photorealistic asset parity. No authored source or existing GLB was replaced.
The room uses saved lighting/sky and supports every existing table shape.

Inspected runtime previews, using the real table renderer and saved neutral
lighting: [seated](mockups/poker-night-runtime-seated.png) and
[overhead](mockups/poker-night-runtime-overhead.png). These are separate from the
generated concept. The local browser render reported no errors or missing assets;
it is not a substitute for manual multiplayer/device testing.

| File | Changes and functions |
| --- | --- |
| `public/rendering/rooms/poker-night-theme.js` | Adds `POKER_NIGHT`/`POKER_NIGHT_THEME`, `createMaterials`, `buildStructure`, `buildOpenings`, `buildPlayArea`, `buildFurnishings` and `buildDecoration`. Reuses existing surface geometry, assembly, seating and lifecycle. |
| `public/rendering/rooms/room-themes.js` | Registers Poker Night; existing `getRoomTheme` resolves it without a separate path. |
| `shared/room-environments.js` | Adds the whitelisted ID/name; existing validation and normalization now accept it. |
| `postgres/025_poker_night.sql`, `postgres/schema.sql` | Extend the constraint through a new migration and the fresh-install baseline/ledger; retain existing selections and Standard default. |
| `public/table.html` | Updates existing in-app room-style help; existing select/button layout and icons remain. |
| `test/poker-night.js` | Adds production-backdrop fixtures and regressions for settings independence, occupied seats, switching/disposal, cutaways, shape/size budgets and phone policy. |
| `test/room-backdrop.js`, `test/room-settings.js` | Extend option coverage and verify explicit Walnut/green matching through existing messages. |
| `test/backend-room-state-handlers.js`, `test/backend-schema.js` | Extend permission/repeat-save and synchronized patch/late-join coverage to Poker Night. |
| `scripts/test-database.mjs`, `test/integration/database.js` | Extend migration preservation/idempotence/constraint checks and actual saved-state/fresh-connection integration coverage. |
| `scripts/component-parity.mjs` | Adds a Poker Night production bootstrap scenario and exercises approved full/compact desktop/touch settings; updates three-option expectations. |
| `docs/ROOM_THEMES.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md` | Document the registered theme, unchanged ownership boundaries and upgrade requirements. |
| `docs/ASSET_CREDITS.md`, `CHANGELOG.md` | Record original/reused art provenance and the implemented slice. |
| `docs/PLAN_ROOM_THEMES.md`, `docs/mockups/poker-night-concept.png`, `docs/mockups/poker-night-concept.prompt.txt`, `docs/mockups/poker-night-runtime-{seated,overhead}.png` | Preserve the theme backlog, approved concept/prompt, inspected runtime previews, implementation decisions and test status. |

No existing production function is removed. The existing settings/server save
handlers need no new helper or behavior branch. Apply migration 025 through the
configured migration role, restart the server, then refresh clients to try the
new room style. A deployment or production database migration has not been run.

## Verification results — 2026-10-16

| Check | Actual result |
| --- | --- |
| `npm run check` | Passed: lint, formatting, CSS checks and 1,182 tests. |
| `npm run test:components` | Passed: full component scenarios on desktop and coarse-touch 390px, including the real Poker Night bootstrap and full/compact settings; notecard and tile-preview checks also passed. The harness logged only an unrelated favicon 404. |
| `npm run test:devices` | Passed all seven documented desktop/laptop/narrow/tablet/phone profiles. |
| `npm run test:integration` | Passed all 25 PostgreSQL integration tests; migration 025 was also exercised against existing Standard/Cozy rows, repeated application and unknown-ID rejection. |
| Render inspection | Inspected seated and overhead views with the real table renderer, current neutral lighting and plant GLB; browser reported no exceptions or missing assets. |
| Documentation | Local Markdown link/consistency checks and `git diff --check` passed. |

Browser/database suites required localhost/Docker access and passed after running
outside the restricted sandbox. No remaining automated blocker is recorded.
No new input path or bundled model payload was added, so `test:input` and
`test:models` were not required/run for this slice. Existing GLBs were loaded
through the production loader during browser checks and render inspection.

Manual multiplayer gameplay, actual-phone cold load/GPU performance, gesture feel,
and user acceptance remain pending. Use the smoke-test list above after migration
025, a server restart and client refresh. No push or deployment was performed.

## Blender asset redesign review

On 2026-10-16 the user reported wooden supports clipping through the chair back,
flat upholstery and a floor that was too light. After a separate Three.js preview,
the user explicitly requested redesigning the assets in Blender and showing a
mock-up. The new work was authored through the live BlenderMCP connection and
saved as companion `poker_night_v1/poker-night-assets.blend`, preserving the
previously open startup scene and all existing authored sources.

New masters: shaped leather chair with welts/seams and grounded tapered legs;
inset-door walnut sideboard; hollow green pendant; crystal carafe and tumbler;
curtained casement; framed original landscape; woven rug; dark walnut floor sample.
UV-based leather color, normal and roughness maps are original 512px images.
Existing credited walnut color and original rubber-plant GLB are reused. The
table is a scale stand-in and room lights are review lighting, not proposed
runtime overrides. This slice adds no app code, bundled GLB, icon or input path.

The companion [source notes](../../Open-Tabletop_Asset_Builders/3d_models/rooms/poker-night/README.md)
record every source/helper, image, scene, report and verification boundary.
Review renders:
[chairs](../../Open-Tabletop_Asset_Builders/3d_models/rooms/poker-night/previews/furnishings/poker-night-chair-review.png),
[room](../../Open-Tabletop_Asset_Builders/3d_models/rooms/poker-night/previews/furnishings/poker-night-room-review.png),
[furnishings](../../Open-Tabletop_Asset_Builders/3d_models/rooms/poker-night/previews/furnishings/poker-night-furnishings-review.png).
All are actual 64-sample Cycles renders from the saved/reopened source.

Geometry checks pass for nine masters: textured UVs, packed images, own maps at
most 512px and exposed chair wood ending at 0.4245m, below the back cushion.
The chair has 15,712 review triangles including modifiers; export optimization
and material batching remain open. The missing-file inspector reports none.
Front/rear chair, room/darker floor and cabinet/pendant renders were visually
inspected. No full app suite was rerun for this source/mock-up/documentation slice.

- [x] Author editable Blender models/materials and preserve original sources.
- [x] Render/inspect the actual Blender mock-ups and record source checks.
- [x] Obtain approval of this Blender redesign before replacing runtime visuals.
- [x] Publish optimized GLBs/maps through the existing verified asset pipeline.
- [ ] Integrate with shared seating, cutaways, device policy and resource ownership.
- [ ] Run the applicable app/model/component/device checks and manual gameplay QA.

The earlier automated passes above apply to the first procedural runtime only.
The user approved their edited curtains/tiebacks on 2026-10-16. The approved
snapshot is `poker-night-assets-approved.blend` (SHA-256
`62d76ab2db5e4dbc07eb58d63293bc7b1716ec44e7734ea3f723e70a0c62e585`).
The window export uses the edited room instances, preserving those edits; the
other seven exports use the authored masters. The publisher validated each
optimized GLB on desktop and touch. Runtime integration is not yet fully verified
or deployed.

At 11:02 AM local time, systemd-oomd killed a 388-process scope containing Codex
after RAM and swap exceeded 90% usage. Blender saved the source at 11:03 AM;
the approved snapshot hash remains unchanged. An outdated curtain-parent test
was then found to stall while formatting a scene-graph equality failure.
Checking identity as a boolean and correcting the expected fallback ancestry
restored all three focused tests (78 ms, with a 192 MiB JavaScript heap limit).
The constrained `npm run check` then passed lint, formatting, CSS checks and all
1,190 tests in 94 seconds for the test stage. RAM remained stable afterward
(20 GiB available). This validates the current code, not the remaining model
integration browser/render checks. The kill record does not isolate the
individual process responsible. Remaining checks must run with bounded
memory/concurrency; no new render work was started during this investigation.

Recovery file summary: `test/poker-night.js` updates curtain ancestry and uses
boolean scene-identity assertions; no functions/helpers are added or removed.
`CHANGELOG.md` and this plan record the fix, preserved sources and verification
limits. `git diff --check` passes. No push or deployment was performed.

File summary for this review slice: the companion `poker_night_v1/` directory adds
`build_poker_night.py`, `validate_poker_night.py`, `README.md`, the packed `.blend`
and its automatic backup, nine texture images, three early draft images, three
final review images and build/geometry/render JSON reports. New builder helpers
are enumerated in its README; the validator adds inspection assertions only.
App-side edits are documentation only: this plan, `ART_DIRECTION.md`,
`REFERENCE.md`, `ARCHITECTURE.md`, `ASSET_CREDITS.md` and `CHANGELOG.md` record
the review/source/provenance boundary. No production function or shipped asset
is changed by this Blender redesign slice.

## Medieval Tavern Blender mockup

Requested 2026-10-16: "Lets start on the medieval tavern next. Use Blender again
and show me a mockup." The requested review is now authored in BlenderMCP and
saved in companion `3d_models/original/medieval_tavern_v1/`. The review source
preserves the previously open `Scene` and its two objects; Poker/Cozy files and
the app runtime are untouched by this slice.

Design: a warm inn with oak framing and wide boards, limewash over rough limestone,
a true arched hearth recess, diamond-leaded casement, heavy pegged trestle table,
cross-back chairs, three-legged stools and bench, coopered barrels, paneled bar,
stoneware and tankards, faded cup pennant and forged candle wheel. A muted moss
playing cloth keeps the center calm. The game props, table and warm/cool review
lights illustrate the composition; they are not proposed automatic gameplay,
physics or saved-lighting changes.

Actual Cycles renders from the saved/reopened source:

- [Room mockup](../../Open-Tabletop_Asset_Builders/3d_models/rooms/medieval-tavern/previews/furnishings/medieval-tavern-room-review.png)
- [Seated camera](../../Open-Tabletop_Asset_Builders/3d_models/rooms/medieval-tavern/previews/furnishings/medieval-tavern-seated-review.png)
- [Final editable source](../../Open-Tabletop_Asset_Builders/3d_models/rooms/medieval-tavern/source/medieval-tavern-window-reveal.blend)
- [Source notes and verification](../../Open-Tabletop_Asset_Builders/3d_models/rooms/medieval-tavern/README.md)

The source uses the existing builders' focused primitive/UV/packed-material
patterns in a separate authoring script, preserving approved sources rather than
importing scripts that build scenes at module scope. New geometry and procedural
stone/plaster/cloth are original project work; the existing credited CC0 oak
color and original Cozy normal derivative are reused and packed. No downloaded
model, photo, font or generated-image insert is used.

First-render corrections fixed bar-vessel parenting, rear-chair orientation,
hearth recess/flames, ceiling infill and camera framing. Both final images use
48-sample denoised CPU Cycles, four threads, rendered sequentially at 1440×1000
and 1440×900. Source checks cover preserved original scene, evaluated geometry,
UV layers, packed file images and absence of linked review object/data. Full-room
triangle counts include all construction/dressing and are not a runtime budget.
Actual reports and intermediate drafts are retained beside the source. Images
are visually reviewed; manual user acceptance is still pending.

- [x] Create editable Blender mockup and actual room/seated renders.
- [x] Validate saved source and inspect the render composition.
- [x] Review the design with the user before runtime integration.
- [x] Bake/adapt procedural shaders, optimize per-asset GLBs and publish through
  the verified asset pipeline.
- [x] Reuse registered room lifecycle, size adaptation, cutaways and occupied
  seating; preserve shared-state, table and lighting ownership.
- [ ] Run the applicable model/app/device checks and manual gameplay review.

No new runtime ID, database migration, app control/icon, input handler, physics or
light is introduced. App runtime suites are not rerun for this review-only asset
and documentation slice. Documentation paths, Python syntax and diff whitespace
are checked. No push or deployment is performed.

Files added in companion `medieval_tavern_v1/`: packed `.blend` and automatic
backup, `build_medieval_tavern.py`, `refine_medieval_tavern.py`,
`finish_medieval_tavern.py`, `render_validate_medieval_tavern.py`, `README.md`,
build/review reports, two final images and intermediate drafts. Builder helpers
are enumerated in the README; refinements and validator add no callable helpers.
App-side documentation touched: this plan, `ART_DIRECTION.md`, `ASSET_CREDITS.md`,
`REFERENCE.md`, `ARCHITECTURE.md` and `CHANGELOG.md`. No production function is
added, changed or removed.

### Medieval Tavern integration — 2026-10-16

Approved snapshot SHA-256:
`97fdbeb50f042d17547e71883771258ee6471ededb5c3ab5421191e13e82bb91`.
Eight material-batched GLBs total 10,103,652 bytes; every derivative passed source/
candidate material, hierarchy, image-pixel and GPU checks on desktop and coarse
touch through the canonical publisher. Original periodic 512px PBR maps adapt the
review's procedural relief; the approved source is unchanged. Source emission
remains static, glass becomes nearly clear alpha, and no lights/table are imported.

`medieval-tavern-theme.js` adds `MEDIEVAL_TAVERN`, `MEDIEVAL_TAVERN_THEME`,
`createMaterials`, `buildStructure`, `addFurnishing`, `buildOpenings`, `buildPlayArea`
and `buildFurnishings`. Existing assembly, surfaces, occupied seating and lifecycle
owners are reused without new branches in those owners. Oak/moss matching stays
explicit; per-wall furnishing groups follow their support cutaways. Shape/size,
occupancy, model failure, mobile policy, disposal and stale-load regressions live
in `test/medieval-tavern.js`. No existing production helper is removed.

Additive migration 026 extends the environment whitelist, preserving existing
room selections/defaults. Shared options, registry, help text, native select
fixtures, permission/schema tests and disposable-database checks extend the existing
contracts. Production bootstrap gets a Medieval Tavern scenario with real GLBs,
matching messages, glazing, overhead cutaway, switching and lighting independence.

Real renderer captures (neutral saved lighting):
[seated](mockups/medieval-tavern-runtime-seated.png),
[overhead](mockups/medieval-tavern-runtime-overview.png). Both were visually inspected;
this capture reported no browser errors or missing assets. The first four focused
Tavern tests pass under a 192 MiB heap; the full `npm run check` passes lint,
formatting, CSS checks and 1,203 tests with one worker / 512 MiB per process.
Full model checks pass all 118 GLBs on desktop/coarse touch; the new bootstrap
scenario passes both profiles. Migration 026 preservation/reapplication checks
and all 25 disposable PostgreSQL integration tests pass. Full desktop/coarse-touch component checks (including notecard and tile-preview
companions) and all seven device profiles pass. The final real-model clearance
regression passes both profiles after the layout change. Actual-phone
performance, multiplayer gameplay and user in-app acceptance remain pending.

Integration file summary: the new theme/test/migration and eight GLBs plus their
README; four `textures/tavern-*` shell maps; updated `room-themes.js`,
`shared/room-environments.js`, schema baseline, generated model allowlist/manifest
and table help; settings/backdrop/permission/schema/database tests and component
fixtures; two runtime preview images. Documentation updates cover this plan,
room-theme contracts, art direction, asset credits, reference, architecture,
model-root README and changelog. Companion additions are the approved snapshot,
`export_runtime.py`, raw runtime GLBs/PBR maps and export report. No migration of
an existing user database, server restart, push or deployment was performed.

| File/group | Final change |
| --- | --- |
| `public/rendering/rooms/medieval-tavern-theme.js` | Adds the theme/configuration and six art/material/slot builders named above; no separate lifecycle or mutable global renderer. |
| `public/rendering/rooms/room-themes.js` | Adds its import/registry entry; existing `getRoomTheme` resolves it. |
| `shared/room-environments.js` | Adds the option; existing validator/normalizer recognize it. |
| `postgres/026_medieval_tavern.sql`, `postgres/schema.sql` | New additive whitelist migration and fresh baseline/ledger. |
| `public/table.html` | Extends existing room-style help; no new controls/icons or gesture path. |
| `public/static_assets/models/environments/medieval-tavern/*` | Eight approved, validated model derivatives and provenance/placement README. |
| `public/static_assets/models/manifest.json`, `public/rendering/builtin-model-assets.js` | Publisher-generated integrity records and URL registrations. |
| `public/static_assets/textures/tavern-{stone,plaster}-{color,normal}.png` | Four original shell map adaptations. |
| `test/medieval-tavern.js` | Adds `state`/`fixture` and four lifecycle, occupancy/size, cutaway, mobile, fallback and late-load regressions. |
| `test/room-backdrop.js`, `test/room-settings.js` | Extends public choices and explicit Oak/moss matching assertions using existing fixtures. |
| `test/backend-room-state-handlers.js`, `test/backend-schema.js` | Extends guarded saves and patch/late-join cases; no server behavior helper is added. |
| `scripts/test-database.mjs`, `test/integration/database.js` | Checks migration preservation/reapplication, schema ledger and durable fresh-connection room choice. |
| `scripts/component-parity.mjs` | Adds the production bootstrap scenario and real-model clearance regression; updates native select expectations. |
| `docs/mockups/medieval-tavern-runtime-{seated,overview}.png` | Captures the integrated room through production modules. |
| `CHANGELOG.md`, `docs/ROOM_THEMES.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/ART_DIRECTION.md`, `docs/ASSET_CREDITS.md`, `public/static_assets/models/README.md`, this plan | Records behavior, boundaries, provenance, totals, operating steps and verification limits. |
| Companion `medieval_tavern_v1/README.md`, `medieval-tavern-approved.blend`, `export_runtime.py`, `runtime/*` | Approval/provenance, preserved snapshot, `png`/`portable` export helpers, raw GLBs/maps and source/matrix/hash report. |

A final layout review moved decorative stools to the east wall and increased
room clearance to sixteen units, avoiding occupied-chair crowding near the bar
on small or large tables. Production browser regression now measures the actual
loaded hearth/bar/barrel/bench/stool bounds against the protected player-seating
area at small rectangular, normal rounded and large round table sizes. Earlier
full component results are supplemented by the final focused resize regression.

### Final automated verification

- `npm run check`: lint, formatting, CSS checks and 1,203 tests pass after the
  layout correction, with one test worker and 512 MiB per Node process.
- `npm run test:models`: all 118 canonical GLBs pass integrity/material/GPU checks
  on desktop and coarse touch under strict CSP.
- `npm run test:components`: full desktop/touch suite, notecard editor and tile
  preview companions pass. The harness logs only the existing favicon 404.
- Final `COMPONENT_SCENE=client-bootstrap-medieval-tavern node scripts/component-parity.mjs`:
  desktop/touch pass, including actual model bounds at three table size/shape cases.
- `npm run test:integration`: all 25 disposable PostgreSQL tests and migration
  026 preservation/reapplication/unknown-ID checks pass.
- `npm run test:devices`: all seven documented profiles pass.
- Approved/editable Blender hashes remain unchanged; Python sources parse and
  new plan links resolve. `git diff --check` passes.

To try locally, apply migration 026 via the configured migration role during the
normal server upgrade/restart, refresh clients, then select **Medieval Tavern**.
Smoke-test style switching, small/large/round tables, joining/leaving seats,
seated/exterior/overhead camera views and explicit Oak/moss matching. The
existing table and saved lighting/sky must stay independent. Actual-device GPU
performance, gesture feel and multiplayer acceptance are not established by these
automated checks. No real user database was migrated and no server was restarted
by this implementation; no push or deployment was performed.

### Medieval Tavern window and table fit correction — 2026-10-16

The in-app review found embedded shutters, flickering exterior window casing and
a floating tabletop. The window-wall rear face was almost coplanar with the
authored casing, and the Tavern play-area builder omitted its table supports.
The corrected window stands the two shutter leaves 0.20 m farther into the room;
the thinner west plaster wall keeps its interior face fixed and clears the
exterior casing. Timber-post spacing now protects the full shutter surround,
including the owner's wider right-shutter position.

The open Blender scene contained unsaved owner edits. Those were captured as
`medieval-tavern-window-fit-input.blend`, and the correction was made in a separate
`medieval-tavern-window-fit.blend`. The live scene remains open and unsaved, and the
approved snapshot is unchanged. The corrected source SHA-256 is
`3535a95fb390fc491cde23204efff09b8eb7013d03ea69e10f0a8de9762288c3`.
Only the window GLB was republished; the other seven models and authored materials
were preserved. The eight Tavern derivatives now total 10,103,664 bytes.

The existing play-area builder now creates two oak trestles with diagonal braces,
feet, top bearers and a cross stretcher. It reuses the shared table outline and
`TABLE_FINISH.rimBase` so supports fit each shape and meet the actual underside.
The width-sized hex outline also remains correct when saved width/depth differ.
Existing assembly ownership handles shadows, cutaways and disposal. No new
production function or helper was added or removed; these corrections add no
physics collider, input path, control, icon or server state.

Current renderer captures: [window clearance](mockups/medieval-tavern-window-fit.png),
[trestle base](mockups/medieval-tavern-table-base.png),
[seated](mockups/medieval-tavern-runtime-seated.png) and
[overview](mockups/medieval-tavern-runtime-overview.png). The base close-up clears
occupied chairs for inspection. Browser captures reported no errors or missing
assets. Images were visually inspected; user acceptance and an interactive
exterior camera orbit remain pending.

| Files changed in this correction | Changes/functions |
| --- | --- |
| `public/rendering/rooms/medieval-tavern-theme.js` | Extends `MEDIEVAL_TAVERN`, `buildStructure` and `buildPlayArea` for physical wall clearance and adaptive decorative supports. |
| `test/medieval-tavern.js` | Adds a support bounds/disposal regression across five outlines, five aspect/size cases and desktop/phone policies; existing `state`/`fixture` are reused. |
| `scripts/component-parity.mjs` | Extends the existing Tavern scenario with exact transformed shutter/casing vertex checks, wall/post intersection checks and real-table underside alignment. No new helper. |
| `public/static_assets/models/environments/medieval-tavern/tavern-window.glb`, `public/static_assets/models/manifest.json` | Corrected window and publisher integrity record; existing model URLs are unchanged. |
| `docs/mockups/medieval-tavern-{window-fit,table-base,runtime-seated,runtime-overview}.png` | Two new inspection views and refreshed room views. |
| `CHANGELOG.md`, `docs/ROOM_THEMES.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/ART_DIRECTION.md`, `docs/ASSET_CREDITS.md`, both model READMEs, this plan | Records fit/reuse decisions, provenance, current byte totals and verification. |
| Companion `medieval_tavern_v1/fit_window.py`, two `medieval-tavern-window-fit*.blend` snapshots, `window-fit-report.json`, `window-fit-export-report.json`, `runtime/tavern-window.glb` | A one-time guarded source correction, preserved input, corrected source, source/export reports and raw window derivative. |
| Companion `medieval_tavern_v1/export_runtime.py`, `README.md` | Adds explicit source/subset/report overrides and a guard against overwriting the corrected window from the old approval source; documents reproduction. Existing `png`/`portable` helpers are unchanged. |

Verification after the correction:

- `npm run check`: lint, formatting, CSS and all 1,204 tests pass with bounded
  concurrency/heap. The five focused Tavern tests also pass independently.
- `COMPONENT_SCENE=client-bootstrap-medieval-tavern npm run test:components`:
  the Tavern desktop/coarse-touch scenario and notecard/tile companions pass,
  including loaded-window clearance and table-base alignment.
- `npm run test:models`: all 118 canonical models pass desktop/coarse-touch
  integrity, material and GPU checks under strict CSP. The window publisher also
  passes its source/candidate comparison on both profiles.
- No database, gesture or responsive layout behavior changed in this correction;
  integration/device suites above describe the preceding integration run.

For an already installed Medieval Tavern, hard-refresh the client. These asset
and rendering corrections require no additional migration or server restart.
Smoke-test the window from both sides while orbiting and inspect the base at
small/large and round/hex table sizes. Real-device performance and multiplayer
acceptance remain manual checks. No push or deployment was performed.

### Second window fit review — 2026-10-16

The owner accepted the table legs and left shutter, requested the right shutter
beside the frame, and reported continuing flicker. The previous depth-only test
missed coplanar side reveals: the plaster hole's half-width was 5.32, exactly
matching the wooden jamb's inner face. The top/bottom plaster also ended just
inside the glazed opening. The wall cutout now measures 11.76 by 10.5 units,
starting 7.35 above the floor. Its edges terminate within the solid timber on all
four sides, leaving about 0.56 units behind the inner jamb faces and 0.455 behind
the inner lintel faces. The existing fallback builder uses the same opening
dimensions. Existing wall/surface/assembly functions are reused; no production
function or helper is added or removed.

Background Blender creates `medieval-tavern-window-reveal.blend` from the previous
fit source. `refine_window.py` moves only the right shutter's X from 1.6m to
1.05m, mirroring the reviewed left leaf; stand-off/rotations/scales/materials
remain unchanged. The approval file, both earlier fit snapshots and live open
file are preserved. Current source SHA-256:
`3bd3b5181a3a44e0b5fffc2a215c6a1ccd85ab1839b4f33ed3bb451cc42e1c0a`.
Existing source/subset/report overrides export only the window, with audit reports
`window-reveal-report.json` and `runtime/window-reveal-export-report.json`.
The canonical window is 800,924 bytes, and the eight Tavern models total
10,103,652 bytes. The remaining seven models are unchanged.

This correction touches `MEDIEVAL_TAVERN` opening dimensions and a framing comment
in `public/rendering/rooms/medieval-tavern-theme.js`; the existing Tavern browser
scenario in `scripts/component-parity.mjs`; the window GLB and generated manifest;
the four refreshed runtime/fit preview PNGs and two additional front/reverse
window PNGs; this plan, changelog, room-theme/art/asset/reference/architecture
documentation and both model READMEs. Companion additions are `refine_window.py`,
the new source snapshot and its two audit reports, with an updated raw window
GLB and companion README. No new UI control/icon, input path, state, migration,
physics collider or gameplay behavior is introduced.

The new real-model regression casts rays toward each inner reveal at three
depths, requiring plaster to sit at least 0.25 units behind timber. It invokes the
Three.js mesh implementation directly because scenery deliberately disables
normal picking. A separate vertex-bounds assertion checks that the right and
left shutter centers mirror each other. The reveal regression reproduced the
old error on both desktop and coarse-touch profiles before the correction.
Existing casing, shutter/wall, table-base and room-layout checks remain active.

Updated captures: [window](mockups/medieval-tavern-window-fit.png),
[front](mockups/medieval-tavern-window-front.png),
[opposite angle](mockups/medieval-tavern-window-reverse.png).
The reveal/shutter scenario passes desktop and coarse touch, with notecard/tile
companions passing at their supported widths. All 118 models pass desktop/touch
integrity/material/GPU checks; the window publisher also passes source/candidate
comparison. Front, oblique and opposite-angle captures were visually inspected,
with no browser errors or missing assets. The owner has accepted the table legs; the revised window still needs in-app acceptance after
a hard refresh. No server restart or additional migration is required.

Final `npm run check` passes lint, formatting, CSS checks and all 1,204 tests with
one CPU and a 512 MiB Node heap. The restricted-sandbox attempt hit Node worker/
local-server failures and was stopped; the normal-host rerun passed. No code
changed after that successful check. Python syntax, preserved source hashes,
current manifest byte totals, local plan links and `git diff --check` also pass.
No push, deployment, migration or server restart was performed.

## Modern Bar Blender mockup

The user confirmed the Tavern window now looks good and flickering is gone, then
requested Modern Bar using Blender and a mockup. That accepts the window/support
corrections; it does not establish broader device/multiplayer QA.

The Modern Pub / Tavern lineup entry is developed here as **Modern Bar**: walnut
slats and smoked wood boards, dark quartz counter, brushed brass details,
backlit bottle shelves, exposed umber brick, tan leather chairs and a channel-tufted
teal booth. A large black-framed window shows a small original 3D evening-city
study. Warm pendants, restrained mint signage, lowball glasses and a compact
draught font give the room a contemporary neighbourhood-bar feel. The calm teal
table center remains the focal point; the review table has explicit steel bases.

Actual Blender Cycles renders:

- [Room review](mockups/modern-bar-room-review.png)
- [Seated review](mockups/modern-bar-seated-review.png)
- [Final editable source](../../Open-Tabletop_Asset_Builders/3d_models/rooms/modern-bar/source/modern-bar-detail-fit.blend)
- [Source notes and verification](../../Open-Tabletop_Asset_Builders/3d_models/rooms/modern-bar/README.md)

The source is created via background BlenderMCP, preserving the live unsaved
Tavern file. The separate builder follows the inspected Tavern primitive/UV/
packed-material patterns instead of importing a module that builds a scene at
module scope. The companion authoring directory has no graph project; its existing
builders were read directly after graph-project discovery. No runtime production
function is added, changed or removed. Game table, fixed six-chair composition,
stage lights and city backdrop illustrate the design; their occupancy/physics,
lighting/sky behavior must be mapped to existing owners only after approval.

First-render polish makes the attached artwork follow its review wall cutaway,
keeps the distant city visible through glazing without leaking outside the room,
removes direct/reflected review-softbox cards from the window, tunes warm/cool
lighting and replaces coffee study props with bar dressing. The final two renders
are serial, denoised, 48-sample CPU Cycles with four threads at 1440×1000 and
1440×900. Reopened-source checks cover UVs on all 999 mesh objects, finite/nonempty
geometry, packed images, unique prototype asset keys, intended chair/stool copies,
absence of linked libraries and source-hash preservation during rendering. The
203,196 evaluated triangles include the entire review architecture/dressing;
that is not a runtime model budget. Both final images were visually inspected;
at mockup delivery user approval/export/integration were pending. The following
integration entry records approval and current status. Final source SHA-256:
`7e40e89696523607164ef723d24f864ab9a917cd674c6aed0cc23cd05791f314`.
Python syntax, current source/report hash, unchanged Tavern approval hash, local
plan links and `git diff --check` pass. The live Tavern filepath/dirty state is
unchanged after all background work.

Files added in companion `modern_bar_v1/`: editable `.blend`/backup,
`build_modern_bar.py`, `refine_modern_bar.py`, `finish_modern_bar.py`,
`render_validate_modern_bar.py`, `README.md`, build/refinement/finish/review JSON
reports, two final PNGs and two intermediate room drafts. Builder helpers are
`linear`, `material`, `own`, `asset`, `uv`, `finish`, `box`, `mesh`, `cylinder`,
`rod`, `lathe`, `curve`, `piping`, `duplicate`, `text`, `area` and `camera`.
The refiner reuses those focused geometry functions without executing builder
top-level mutations; refinements/validator add no callable helpers.
App-side files touched are this plan, `CHANGELOG.md`, `ART_DIRECTION.md`,
`ASSET_CREDITS.md`, `REFERENCE.md`, `ARCHITECTURE.md` and two review PNG copies.

- [x] Author a separate editable Blender mockup and render room/seated views.
- [x] Validate the reopened source and visually inspect both final renders.
- [x] Obtain user approval before runtime visual integration.
- [x] Adapt/optimize/export individual approved assets with the verified pipeline.
- [x] Extend the existing theme registry and shared room contract; retain occupied
  seating, cutaways, fallback cleanup and independent table/lighting/sky ownership.
- [x] Run applicable model/runtime/device checks.
- [ ] Complete manual gameplay and actual-device acceptance of the integrated room.

No room ID, migration, app control/icon, input path, physics, runtime light or
published asset is introduced by this mockup slice. App runtime suites are not
rerun for companion authoring/documents alone; earlier Tavern results do not
validate a future Modern Bar integration. Python syntax, documentation links,
source/render checks and diff whitespace are checked. No push/deployment occurs.

## Modern Bar integration

The user approved the rendered Modern Bar design with "Looks good". The exact
approved source is preserved as `modern-bar-approved.blend`, SHA-256
`7e40e89696523607164ef723d24f864ab9a917cd674c6aed0cc23cd05791f314`.
Background Blender exports eleven individual models; the editable source and its
authored materials are unchanged. Runtime models total 8,269,568 compressed bytes
from 14,306,812 source-export bytes. The entire app now has 129 canonical models,
87,647,372 bytes versus 138,524,780 before compression (36.7% smaller).

Export reuses the existing Tavern/Poker evaluated-mesh/material-batching recipe
with focused Modern Bar anchors and converted text/curve geometry. Portable
periodic normal/roughness maps adapt procedural relief, with finer, weaker leather
grain verified in the real renderer. No source shader is saved over. The source
game table, city, staged lights and fixed chair roster are excluded. Alpha window
glazing follows the saved sky and phone policy; emissive strips remain static.
Each derivative passed the canonical publisher's desktop/coarse-touch decoded
geometry/material/image/hierarchy and source/candidate GPU comparisons.

`modern-bar-theme.js` extends the existing six-component contract through shared
assembly, occupied seating, surfaces, model preparation and lifecycle owners.
New art builders/configuration cover the adaptive walnut floor, bounded instanced
brick and plaster shell, window, furnishings, pendants, fallback chairs and steel
table bases. Window rough-opening edges terminate within the solid frame on all
four sides, with real-model ray regressions at three depths. Steel bases meet the
floor and actual tabletop underside across supported outlines/aspect ratios.
Decorative fixtures remain outside the player seating envelope, including small,
large, round, oval and wide-hex tables.

One small shared-owner extension is required: `createRoomEnvironment.sync` now
derives a width-sized hex's enclosure depth from shared `tableOutline`, preventing
floor/walls from clipping a wide hex when its saved depth is small. Round/other
shape rules, seat layout inputs, server physics and saved dimensions are retained.
This reuses the canonical physical outline rather than adding a theme-only size
calculation or separate room renderer. No production helper is removed.

Additive migration `027_modern_bar.sql` extends the environment constraint. The
fresh baseline/ledger includes it. Disposable upgrade tests preserve all prior
styles, notes, wood and Standard defaults; reapplication retains Modern Bar and
unknown IDs fail. Shared options/registry, permission/schema tests and real
PostgreSQL saves/late readers follow existing contracts. The approved native
Room style select receives Modern Bar; no new control, icon or input path is added.
**Use matching table** explicitly applies Walnut / deep teal `#294b4c`; selecting
the style alone leaves table/lighting/sky state untouched.

Actual runtime captures, inspected after leather-map refinement:
[seated](mockups/modern-bar-runtime-seated.png) and
[overview](mockups/modern-bar-runtime-overview.png). They use neutral saved lighting
and the real production core/backdrop/model-loader modules. Capture logs contain
no browser errors or missing assets. The city in the Blender concept remains
illustrative, while runtime retains the user's chosen sky.

| File/group touched | Implementation summary |
| --- | --- |
| `public/rendering/rooms/modern-bar-theme.js` | Adds `MODERN_BAR`, `MODERN_BAR_THEME`, `createMaterials`, `buildStructure`, `placeModel`, `buildOpenings`, `buildPlayArea`, `buildFurnishings`. Reuses shared assembly/surfaces; adds no lifecycle or state owner. |
| `public/rendering/rooms/room-environment.js` | Extends `sync`'s hex depth calculation using shared `tableOutline`; no new helper. |
| `public/rendering/rooms/room-themes.js`, `shared/room-environments.js` | Registry import/entry and public option; existing resolver/validators recognize it. |
| `postgres/027_modern_bar.sql`, `postgres/schema.sql` | Additive whitelist migration and flattened baseline/ledger. |
| `public/table.html` | Updates existing room-style help; controls/icons/gestures unchanged. |
| `public/static_assets/models/environments/modern-bar/*` | Eleven material-batched GLBs and source/anchor/provenance README. |
| `public/static_assets/models/manifest.json`, `public/rendering/builtin-model-assets.js` | Canonical publisher integrity/baseline records and URL registrations. |
| `test/modern-bar.js` | Adds `state`/`fixture` and six shape/occupancy, cutaway, mobile/resource/stale-load, fallback, support and enclosure regressions. |
| `test/room-settings.js`, `test/room-backdrop.js` | Adds explicit matching/independence coverage and accepted option; uses existing fixtures. |
| `test/backend-room-state-handlers.js`, `test/backend-schema.js` | Extends guarded role acceptance and shared patch/late-join tests. |
| `scripts/test-database.mjs`, `test/integration/database.js` | Extends `prepareDatabase` migration upgrade/default/reapply checks, ledger count and durable Modern Bar state through existing database APIs. |
| `scripts/component-parity.mjs` | Adds Modern Bar production-bootstrap scenario, loaded-model clearance/reveal/base checks, resize/cutaway/matching/switch coverage and five-option accessible select expectation. |
| `docs/mockups/modern-bar-runtime-{seated,overview}.png` | Two actual integrated-renderer captures. |
| `CHANGELOG.md`, this plan, `docs/ROOM_THEMES.md`, `docs/ART_DIRECTION.md`, `docs/ASSET_CREDITS.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`, model-root README | Records approved/local behavior, owner boundaries, provenance, bytes, operating steps and verification limits. |
| Companion `modern_bar_v1/modern-bar-approved.blend`, `export_runtime.py`, `runtime/*`, `README.md` | Preserves approval, adds `png`/`portable` derivative-export helpers, raw GLBs/PBR maps and source/transform/hash report, plus integration notes. |

Final verification: `npm run check` passes lint/formatting/CSS and all 1,222 tests
with one CPU and a 512 MiB Node heap. The six Modern Bar tests and matching/backdrop
tests also pass independently (22 focused tests). The focused real-model bootstrap
passes desktop/coarse touch, along with notecard/tile companions. All 25 disposable
PostgreSQL integration tests and migration 027 upgrade checks pass. The final full
129-model suite passes desktop/coarse touch under strict CSP. Full
`npm run test:components` passes both desktop/coarse-touch profiles, including
all four themed production bootstraps, window/ceiling/cutaway checks, accessible
five-option select and full/compact matching action, notecard editor and tile
companions. The harness logs only the existing favicon 404. `npm run test:devices`
passes all seven documented profiles. Final capture logs report no missing assets
or browser errors. Both saved runtime images were visually inspected after the
leather refinement; source/export/canonical hashes, Python syntax, plan links and
`git diff --check` pass. Automated checks do not establish actual-phone GPU
performance, gesture feel or multiplayer acceptance.

To try locally: apply migration 027 using the configured migration role during
the normal server upgrade/restart, refresh clients, then select **Modern Bar** in
Room Settings. Smoke-test switching away/back, explicit Walnut/teal matching,
occupied/spectator seats, small/large/round/hex tables and inside/outside/overhead
camera views. The selected sky/lighting and table dimensions must remain independent.
No existing user database was migrated, no server restarted, and nothing was
pushed or deployed by this implementation.


## Modern Bar chair and pendant correction

The user reported distorted relief on the brass table light and back piping
floating away from a forward-leaning chair cushion. This is a correction within
the approved design. No new control, icon, input path or runtime behavior is added.

Background BlenderMCP opens the preserved approval snapshot, fits the piping to
the evaluated cushion bevel, parents it to the cushion and gives all six staged
backs a 0.08-radian rearward lean. The curve centers sit 0.9 mm above the surface;
the 1.5 mm piping tube is within 2.401 mm of the cushion across all six copies.
The back bevel receives six segments and smooth shading. The table pendant gets
a separate smooth satin-brass material (roughness 0.42, metalness 0.8), replacing
its coarse relief. The runtime close-up also caught flat shading on its edge bevel;
`smooth_pendant.py` smooths those edges and doubles bevel segments to six, reusing
the existing weighted normals. `pendant-smoothing-report.json` retains the previous
revision hash. Other original materials remain unchanged.

The editable correction is companion
`modern_bar_v1/modern-bar-detail-fit.blend`, SHA-256
`2d79e7106b9700ab1be565193275bdd0e8b56983d00c6bdefb98cb9b5ee3eef1`.
`fit_details.py` and `validate_details.py` are top-level authoring/validation scripts
with no new callable helpers. Both audit reports are retained beside the source.
The approved and editable original retain SHA-256
`7e40e89696523607164ef723d24f864ab9a917cd674c6aed0cc23cd05791f314`.
The live unsaved Medieval Tavern remains untouched.

Reuse decision: retain the existing Blender modifier/material-batching exporter,
canonical publisher and runtime assembly. Extend only the exporter's existing
source/subset configuration with source override/hash and a guard against old
chair/pendant exports. Each export-report asset now carries its actual source
and hash: chair/table-pendant use the correction; the other nine retain approval
provenance. No production JS functions/helpers are added, changed or removed.

Current eleven Modern Bar models total 7,953,072 compressed bytes from 13,587,536
raw export bytes; all 129 canonical models total 87,330,876 bytes from 137,805,504
(36.6% smaller). The previous integration totals above are historical.

| Files touched in this correction | Change |
| --- | --- |
| `scripts/component-parity.mjs` | Extends the existing Modern Bar scenario with decoded piping-to-upholstery triangle distances and satin-brass material checks; no new helper. |
| `public/static_assets/models/environments/modern-bar/modern-bar-{chair,table-pendant}.glb` | Replaces only these two derivatives through the existing canonical publisher. |
| `public/static_assets/models/manifest.json` | Updates those two integrity/material/geometry baselines. |
| `public/static_assets/models/environments/modern-bar/README.md`, model-root README | Records corrected source/provenance and current byte totals. |
| `docs/mockups/modern-bar-{chair,pendant}-detail.png` | Actual production-renderer close-ups of the corrected canonical models. |
| This plan, `CHANGELOG.md`, `docs/{ART_DIRECTION,ASSET_CREDITS,ARCHITECTURE,REFERENCE,ROOM_THEMES}.md` | Records scope, sources, runtime boundaries, checks and client refresh requirement. |
| Companion `modern_bar_v1/fit_details.py`, `validate_details.py`, `modern-bar-detail-fit.blend`, `detail-{fit,validation}-report.json`, `smooth_pendant.py`, `pendant-smoothing-report.json` | Adds the separate corrected source and reproducible fit/material validation. |
| Companion `modern_bar_v1/export_runtime.py`, `runtime/{modern-bar-chair,modern-bar-table-pendant}.glb`, `runtime/export-report.json`, `README.md` | Extends existing exporter configuration/provenance; reuses `png`/`portable` unchanged; updates only two raw models and source records. |

The negative-control browser run reproduces the old chair defect on both desktop
and coarse touch (maximum sampled gap 32.7 mm). After replacement, the focused
`COMPONENT_SCENE=client-bootstrap-modern-bar npm run test:components` passes both
profiles plus notecard/tile companions, including the surface-fit and satin
material checks. `npm run check` passes lint/formatting/CSS and all 1,222 tests
with one CPU and a 512 MiB Node heap. The publisher's decoded geometry/material/
image and GPU comparisons pass for both replacements on desktop/coarse touch.
The reopened Blender source passes all six piping fits and the material audit.

The final close-up review caught flat bevel shading on the pendant and corrected
it before delivery. Both current runtime images were visually inspected; the
capture reports no browser errors or missing assets. The final smoothed pendant
also passes the publisher's desktop/coarse-touch comparisons. Final `npm run test:models` after that refinement passes all 129 canonical models
on desktop/coarse touch under strict CSP. Python syntax, all eleven source/raw/
canonical hashes, 121 existing documentation links plus the two new images, and
`git diff --check` pass.

![Corrected chair piping](mockups/modern-bar-chair-detail.png)

![Smooth satin-brass pendant](mockups/modern-bar-pendant-detail.png)

A client hard refresh loads both replacements at their existing URLs. No additional
migration or server restart is required for this correction; first installation
of Modern Bar still uses migration 027. Inspect the chair from behind and oblique
angles and orbit the pendant to check the satin highlights. Actual-device GPU
performance and final user visual acceptance remain manual. Nothing is pushed
or deployed by this correction.


## Rear-wall additions — Blender review

Requested on 2026-10-17 after the user accepted the Modern Bar detail corrections.
The supplied reverse-seat screenshots show the empty south wall in all three
current themes. New design approval is required before runtime/UI integration
under the repository's existing mockup rule.

Proposed additions, shown from the opposite seated angle:

- Modern Bar: slim black-framed glazed entry with satin-brass pull/threshold and
  an etched privacy band; compact two-person teal channel booth with a small
  round walnut pedestal table in the viewer's left corner.
- Poker Night: walnut frame-and-panel door with grain aligned to its joinery,
  a small three-light glazed opening at the top and a brass lever.
- Medieval Tavern: second copy of the current corrected oak/diamond-leaded window
  with the same matched shutters and projecting sill, set into a real aperture.

Editable standalone studies are in companion
`3d_models/original/room_backwalls_v1/{modern,poker,tavern}-backwall-v2.blend`.
The current corrected source files are opened only by background BlenderMCP;
originals, approved snapshots, owner curtain edits and the live Blender scene are
preserved. Each build refuses to overwrite a saved review. Existing room geometry,
tables and seating provide scale/context; exterior review panels and fill lights
are illustrations and are not proposed runtime scenery or saved sky/lighting.

Reuse decision: inspect all three theme structure/opening/furnishing builders via
Tier 2 graph evidence and exact source. Reuse the Modern Bar builder's focused
primitive/UV/material/camera definitions through AST extraction without running
its scene-building top level; parameterize only their object prefix. The Tavern
window copies the corrected source's existing geometry/materials directly. No new
production function/helper, model registration, server state, physics or input is
implemented. The shared render/authoring recipes remain unchanged.

Graph project `home-optimus-open-tabletop` is ready, generation
`2026-10-17T01:23:34Z`; relevant theme/documentation paths show metadata-matching
coverage with no recorded gap. The `buildFurnishings` callback has no graph-resolved
caller, so callback registration/actual production ownership relies on the prior
integration source checks rather than an exhaustive caller claim. Companion
asset scripts are not indexed and were read directly.

Current review files and responsibilities:

| Files | Scope |
| --- | --- |
| Companion `room_backwalls_v1/build_backwalls.py` | New top-level review composition/configuration; reuses `linear`, `material`, `own`, `asset`, `uv`, `finish`, `box`, `mesh`, `cylinder`, `rod`, `lathe`, `curve`, `piping`, `text`, `area`, `camera` definitions with a theme prefix. No new callable helper. |
| Companion `room_backwalls_v1/render_backwalls.py` | Top-level saved-source validation and serial CPU Cycles rendering; no new helper. |
| Companion `room_backwalls_v1/{modern,poker,tavern}-backwall-v2.blend`, `*-build-report.json`, `*-review-report.json`, `*-backwall-review.png`, `README.md` | Editable studies, input/output/helper hashes, source checks, actual review renders and reproduction notes. |
| `docs/mockups/{modern,poker,tavern}-backwall-review.png` | Copies of the actual Blender review images for approval. |
| This plan, `CHANGELOG.md`, `docs/ART_DIRECTION.md`, `docs/ASSET_CREDITS.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md` | Records the proposed scope, source/provenance, checks and pending approval/integration. |

All three final v2 sources were reopened and rendered with CPU Cycles, four threads,
40 samples/denoising, 1440×900. Final images were visually inspected. Finite/nonempty
mesh geometry, UVs, packed file images and absence of linked libraries pass. Input,
output and reused helper-recipe hashes match before/after rendering. Python syntax,
local documentation/image links and `git diff --check` pass. The first drafts are
retained; final reviews remove coplanar casing overlaps, offset the poker door
clear of its pendant, add exterior depth behind the modern glass and restore
ceiling context. Source hash/render records:

| Theme | Final source SHA-256 | Render time |
| --- | --- | --- |
| modern | `1cee4c75214bb7edc6572a0ad47532c617fd9fcd1c0c93886069fd7b65fb422b` | 51.4 s |
| poker | `60aab360dad4af0960f269d674045200b7c8db71ee9d1cf77144a4bf5e7a7d44` | 38.35 s |
| tavern | `578bdfd778601e47a63ae0816dbdebc0cd061376a0da9fa024cf9cc5f7ce5b4a` | 52.51 s |

![Modern Bar rear wall](mockups/modern-backwall-review.png)

![Poker Night rear wall](mockups/poker-backwall-review.png)

![Medieval Tavern rear wall](mockups/tavern-backwall-review.png)

No runtime export or model replacement is performed in this review slice. Full code/model/device suites from
previous work do not establish acceptance of these additions. After approval,
reuse current openings, wall cutaway owners, room-size adaptation, portable glass,
model loading and resource cleanup, with the aperture boundaries inside solid
frames to prevent the earlier window flicker.


## Rear-wall integration

The user approved all three final Blender layouts with "Looks great" on 2026-10-17.
They are integrated locally in the existing themes. Modern Bar adds the approved
black-framed glass entry with etched band/brass pull and compact teal booth/cafe
table in the reverse viewer's left corner. Poker Night adds the offset paneled
walnut door with small upper window/brass lever. Tavern adds another placement of
the already corrected leaded window and mirrored shutters on its south wall.

The three accepted `room_backwalls_v1/*-backwall-v2.blend` sources retain the hashes
in the review table above; `approval-record.json` records acceptance without saving
over the review files. Existing curtain/tiebacks, original furniture and corrected
chair, pendant and Tavern window models/materials are preserved. The second Tavern
window uses the existing canonical GLB through one room-owned load, with two
resource-sharing placements, rather than a duplicate export. Three new assets are
exported from the accepted door/nook roots only; no stage walls, fixed chairs,
review table, lights or illustrative exterior is included.

Reuse/extension decision: extend the three current structure/opening builders and
Modern `buildFurnishings`, using the same assembly/loading/material/device/cutaway
owners. Their nearly identical aperture panel rules now use one focused browser-only
`wallOpeningPanels(width,bottom,top,opening)` helper. It returns nonoverlapping wall
rectangles, clipping the aperture against each requested band. Plaster uses rough
opening bounds inside solid frames; Poker wainscot/beads/battens/trim and Modern
skirting stop at the outer door casing. Tavern south framing reserves the same
shutter surround as west. This introduces no shared physics/server rule.

The two Modern models are placed with named door offset/width/height and nook
half-width/margin/inset values. The nook follows room extent rather than fixed
world coordinates, preserving seating clearance across narrow, large, round,
oval and width-sized hex tables. Door/window models remain wall children so the
existing cutaway also removes their dressing. Alpha glazing has no depth write
or shadow and is omitted on phones. Selected sky shows through the real openings;
review dusk/corridor/city geometry and staged lights are excluded.

Canonical publication validates material/image/hierarchy/geometry fingerprints
and compares raw/candidate renders on desktop/coarse touch. New bytes:

| Canonical file | Raw export bytes | Compressed bytes |
| --- | ---: | ---: |
| `models/environments/modern-bar/modern-bar-door.glb` | 224,492 | 172,952 |
| `models/environments/modern-bar/modern-bar-nook.glb` | 1,161,528 | 785,292 |
| `models/environments/poker-night/poker-door.glb` | 1,127,772 | 796,944 |

All 132 canonical GLBs total 89,086,064 bytes versus 140,319,296 raw export bytes
(36.5% smaller before HTTP encoding). Modern Bar has 13 models totaling 8,911,316
bytes from 14,973,556; Poker Night has 9 totaling 4,136,108 from 6,164,592. Tavern
keeps its 8 existing models. Exact per-asset sources/bounds/hashes live in companion
`room_backwalls_v1/runtime/export-report.json`; existing manifests retain their
prior source records.

| Files touched in this integration | Functions/helpers and scope |
| --- | --- |
| `public/rendering/rooms/wall-openings.js` | Adds focused `wallOpeningPanels`; no global state, imports or runtime-engine adapter. |
| `public/rendering/rooms/modern-bar-theme.js` | Extends constants, `createMaterials`, `buildStructure`, `buildOpenings`, `buildFurnishings`, asset map; reuses `placeModel` unchanged. |
| `public/rendering/rooms/poker-night-theme.js` | Extends constants, `buildStructure`, `buildOpenings`, asset map; other furniture/curtain/decoration behavior unchanged. |
| `public/rendering/rooms/medieval-tavern-theme.js` | Extends `buildStructure` and loops existing `buildOpenings` over west/south; no new source model or placement helper. |
| `public/rendering/builtin-model-assets.js`, `public/static_assets/models/manifest.json` | Publisher adds three canonical URL/integrity records. |
| Three canonical GLBs listed above | Only new approved door/nook derivatives; existing model bytes are retained. |
| `public/static_assets/models/README.md`, `environments/modern-bar/README.md`, `environments/poker-night/README.md` | Current totals, model axes/bounds, source/license and runtime placement/glazing notes. |
| `test/room-wall-openings.js` | Adds area/coverage/band clipping behavior cases for centered, offset, edge, absent and floor-level apertures. |
| `test/modern-bar.js` | Extends load/disposal/device counts and actual cutaway/aperture rays; adds reverse-corner placement checks across shapes. |
| `test/poker-night.js` | Adds plaster/wainscot/trim clearance rays and south ownership; raises the bounded fallback draw cap from 75 to 85 for the split trim bands and door. |
| `test/medieval-tavern.js` | Verifies second-window parent and shared loaded geometry; retains one-load/stale/disposal checks. |
| `scripts/component-parity.mjs` | Extends existing three real-model bootstrap scenarios: door/lite clear rays, glazing/device policy, nook clearance through resizes, and full reveal/shutter tests on both Tavern windows. No new helper. |
| `docs/mockups/{modern-bar,poker-night,medieval-tavern}-rear-runtime.png` | Actual integrated-renderer rear-seat views. |
| This plan, `CHANGELOG.md`, `docs/{ROOM_THEMES,ART_DIRECTION,ASSET_CREDITS,REFERENCE,ARCHITECTURE}.md` | Approved behavior/ownership, sources, operating steps and current verification record. |
| Companion `room_backwalls_v1/export_backwalls.py`, `runtime/*`, `approval-record.json`, `README.md` | Focused export recipe with reused `png`/`portable` implementations and explicit alpha adaptation; evaluated mesh/material batching, per-asset source/transforms/hash report and acceptance record. Original build/render scripts and accepted `.blend` files remain unchanged. |

Final verification: `npm run check` passes lint, formatting, CSS and all 1,229
code tests; 18 focused theme/aperture tests also pass. The canonical publisher
passes all three raw/candidate comparisons on desktop/coarse touch. Each of the
three focused `COMPONENT_SCENE=client-bootstrap-* npm run test:components` runs
passes desktop/coarse touch plus notecard/tile companions. Tests cast through
both actual door lites, check alpha/device policy and nook/table clearance, and
run the full shutter/reveal checks against both Tavern window placements. The
complete `npm run test:models` passes all 132 canonical models on desktop/coarse
touch under strict CSP. Final production-renderer rear-seat captures for all three
themes were visually inspected and report zero browser errors/missing assets.
Python syntax, all 132 canonical hashes, approved source/raw hashes, current
local documentation/image links and `git diff --check` pass. Current graph evidence
resolves all three structure builders as direct callers of the shared aperture
helper, with metadata-matching coverage. The existing static category mounts serve
the new canonical files without restarting the process.

![Installed Modern Bar rear wall](mockups/modern-bar-rear-runtime.png)

![Installed Poker Night rear wall](mockups/poker-night-rear-runtime.png)

![Installed Medieval Tavern rear wall](mockups/medieval-tavern-rear-runtime.png)

No DOM/control, input, responsive-layout, database/query or migration is changed,
so their broader suites are not repeated for this scenery-only addition.

Refresh clients to load the three added assets and new wall openings; no additional
migration/server restart is required. Manual smoke test: face each rear wall,
inspect the door lites and both shutter surrounds, orbit outside and overhead,
switch themes away/back and try narrow/large/round/hex tables. Confirm current sky,
lighting, table dimensions and occupied seats remain independent. Actual-phone GPU
performance and final user visual acceptance remain manual. Nothing is pushed,
deployed, or migrated by this integration.

User acceptance on 2026-10-17: "Much better looks great now." The user then
authorized committing the changes and preparing the next release. This accepts
the final room appearance; device/network conditions and unrelated multiplayer
checks were not separately reported. Release preparation is local; pushing and
publication require separate authorization.

The approved room-theme work is committed as `1ee4de1`. Version 0.23.0 release
metadata, upgrade notes and final preparation checks are tracked in
[the release preparation record](RELEASING.md#0230-preparation-and-verification).
The companion Blender source workspace has no Git repository; its preserved
editable sources remain there, with hashes/provenance in the committed app records.
No tag, push or publication is authorized by this preparation.

Release preparation validation is complete: Node 26 host quality gate (1,229
tests), disposable PostgreSQL (25), zero production advisories, version/image/note
extraction and documentation checks pass. A fresh actual Node-24 Alpine image
passes 61 selected tests as UID 100 on linux/amd64. Runtime/asset bytes from the
feature commit are unchanged. Multi-arch publication and deployed upgrade/rollback
remain separate operator steps; nothing is tagged, pushed or deployed.

## Resting gray room companion

Approved on 2026-10-17: the owner accepted the all-gray reclining dog and the
four-room corner mockups, explicitly limiting integration to furnished rooms.
The approved v2 Blender source and ordinary GLB remain unchanged in companion
`3d_models/original/pup_in_bed_v2/`. Review/derivative source and captures live in
`pup_room_integration_v1/`; Standard remains skybox-only.

Implemented locally: one shared dog/bed in the southwest/front-left corner,
facing inward at `[-rx + 3.6, floor, rz - 3.7]`, yaw `3π/4`. The model stays at the
normal room scale of seven units/metre. It follows floor height and adaptive room
half-extents. The existing room assembly owns the model slot, procedural bed
fallback, contact shadow, async guard, picking exclusion, phone material/shadow
policy and deduplicated disposal. The dog is scenery, with no physics, input,
permission or synchronized/private-state change. The user-approved placements
are clear of furniture and eight occupied chairs in the reviewed default rooms;
rotated footprints are checked using separating axes, rather than treating the
world-axis bounding boxes of two rotated objects as their occupied footprints.

The runtime derivative keeps every fur strand as a tapered surface ribbon,
retains ear shells and original gray/blue materials, simplifies continuous skin
and batches by material. It has 227,104 triangles / 14 draws instead of the
master's 1,469,956 triangles / 63 primitives. `prepare_runtime.py` works in a
separate export collection and verifies that the master hash is unchanged.
The canonical publisher validates the ordinary 7,450,420-byte export against its
4,765,964-byte lossless Meshopt derivative under desktop/touch strict CSP before
publishing the single `/models/environments/shared/gray-pup-in-bed.glb`.

Implementation/file summary:

- `rooms/room-companion.js`: new `ROOM_COMPANION` placement/bed constants,
  `ROOM_COMPANION_ASSETS` registration and `buildRoomCompanion` shared decoration.
- `rooms/room-environment.js`: calls that optional builder after theme decoration
  when the static theme registers `assets.pup`; assembly and generic lifecycle
  helpers are reused unchanged.
- `cozy-theme.js`, `poker-night-theme.js`, `medieval-tavern-theme.js`,
  `modern-bar-theme.js`: register the one shared asset; Cozy also exposes its URL
  in the existing compatible `furnitureURLs` map. Existing theme builders stay unchanged.
- `builtin-model-assets.js`, `models/manifest.json`, shared GLB/README: publisher
  registration, exact hashes, decoded fingerprints, GPU baseline and provenance.
- `test/room-companion.js`: new `fixture`/`dogModel` test helpers exercise actual
  production room builders across 160 theme/device/size/shape combinations, eight
  seats, original state preservation, hidden fallback, load reuse, phone policy,
  floor/table/wall separation, Standard switching, failures and stale disposal.
- `test/medieval-tavern.js`, `test/modern-bar.js`: account for the additional owned
  model in existing unique-load and once-only-disposal regressions; no helper change.
- `scripts/component-parity.mjs`: real-client furnished-room bootstraps assert the
  canonical dog load, scale/corner, 14-batch scenery budget, picking exclusion and
  phone shadows. Modern's existing readiness check uses registered asset names so
  the shared companion does not need a theme-specific name.
- `CHANGELOG.md`, `ARCHITECTURE.md`, `REFERENCE.md`, `ASSET_CREDITS.md`,
  `ART_DIRECTION.md`, this plan and model READMEs record the current contracts,
  credits, counts and approval. No existing authored asset is replaced.
- Companion `prepare_runtime.py` creates only an export derivative;
  `verify_integration.mjs` adds review-only `footprint` and `overlaps` helpers for
  oriented real-mesh bounds, plus desktop/touch renders and accepted-master image
  comparison. The original approval harness suppresses the live companion while
  adding the reference so its historical previews remain reproducible.

Verification status: `npm run check` passes 1,233 tests plus lint/format/CSS;
`npm run test:models` passes all 133 canonical GLBs on desktop and coarse touch.
`npm run test:components` passes the full desktop/coarse-touch matrix, including
all four furnished-room real-client bootstraps with dog assertions, the notecard
editor at 1280/390/360px and tile previews at 1280/390/320px. The only missing
request in the full component harness is its harmless `/favicon.ico`.
The separate final production-room captures pass on desktop and 390px touch
for all four themes, with no browser exceptions or missing assets; eight-seat
oriented clearance, floor/wall placement, phone policy and Standard switching pass.
All corner views and the source comparison were visually inspected. The dense
accepted-master comparison has a full-image mean absolute channel difference of
0.755 on the 0–255 scale; this is an approximation for scenery, not identical
geometry/detail. Original master/export and final canonical hashes match the
approval record. `git diff --check` and added documentation links pass.
No database, input, or responsive control/layout change is introduced.

Refresh clients to load the new model. No restart or migration is needed. Manual
smoke test: visit all four furnished styles, orbit toward the corner, switch to
Standard and back, resize/reshape the table and add/remove the corner seat.
Real-phone GPU performance, cold-network loading and final in-app owner review
remain manual. Nothing is pushed or deployed.


## All remaining themes — approval review, October 17, 2026

The user authorized designing all remaining assets/mockups in one batch for later
review. Eleven themes now have a dedicated
[review package](ROOM_THEME_REVIEW.md), with editable Blender sources, room/seated/
reverse views, close-up asset boards, palettes and asset inventories. The
[offline gallery](mockups/remaining-room-themes-v1/index.html) provides a single
entry point; the [contact sheet](mockups/remaining-room-themes-v1/contact-sheet.jpg)
compares the complete lineup.

This supersedes the opening status only for backlog design readiness: all eleven
remaining themes have concrete proposals, and **every proposal awaits explicit
owner approval**. Poker Night, Medieval Tavern, Modern Bar and existing Cozy work
retain their recorded implementation/approval status. No new theme is registered,
no GLB is published and no runtime/UI change is made by this review slice.

Reuse decision: retain the existing theme/assembly/seating/cutaway owners for
future integration. Companion authoring shares the inspected Modern Bar geometry/
material/UV primitives through a side-effect-free helper, while explicit theme
builders own their distinct furnishing and material choices. Special table
materials, exterior dioramas and review lights are proposals, not added runtime
capabilities. See the review index and companion README for file/helper inventory,
verification boundaries and the unchanged full/compact desktop/touch settings
examples. Approval and implementation checks remain pending.


## Speakeasy rear-wall correction — October 18, 2026

The owner identified brass fans intersecting the rear door and continuing behind
the artwork. A preserved copy of the live unsaved scene is the input to companion
`speakeasy_review_v2/`; the live scene and v1 master remain intact. The revised
mockup replaces five rear motifs with two narrower motifs flanking the artwork.
World-space checks establish at least 0.211 m frame clearance and 1.401 m door
clearance. Unrelated object transforms are unchanged.

[Revised rear view](mockups/speakeasy-review-v2/speakeasy-rear-wall-v2-reverse.jpg) ·
[Wall detail](mockups/speakeasy-review-v2/speakeasy-rear-wall-v2-detail.jpg) ·
[Source and file/helper summary](../../Open-Tabletop_Asset_Builders/3d_models/rooms/1920s-speakeasy/README.md).

The desk sheet is identified as a generic chart/map placeholder from the shared
desk study; it is retained in this fan-layout revision. Actual source/render
hash, clearance, transform, Python syntax and image checks pass, and both images
were visually inspected. The owner subsequently accepted this rear-wall layout. This is an art
review correction, with no runtime/UI/model-catalog/database change.


## Speakeasy seating and pendant revision — October 18, 2026

The owner accepted the rear-wall appearance and requested smooth shading for
all chair/bench parts plus ceiling-connected pendant stems with conical covers.
Companion `speakeasy_review_v3/` extends the preserved v2 source. It reuses the
existing materials, bevel/normal modifiers and authoring lathe helper. All six
chairs and the scalloped bench use smooth mesh shading; both stems extend to the
ceiling underside, with flared metal canopies at the connection. Shade heights,
original object placements, rear fans and desk placeholder remain unchanged.

[Current seated view](mockups/speakeasy-review-v3/speakeasy-v3-seated.jpg) ·
[Seating detail](mockups/speakeasy-review-v3/speakeasy-v3-seating-detail.jpg) ·
[Pendant detail](mockups/speakeasy-review-v3/speakeasy-v3-pendant-detail.jpg) ·
[Source, file/helper inventory and verification](../../Open-Tabletop_Asset_Builders/3d_models/rooms/1920s-speakeasy/README.md).

The owner accepted the v3 seating and canopy appearance before requesting the
v4 piping correction below. This asset-only revision changes no runtime
code, model catalog, app UI, input or database contract. No restart is required.

Verification: all 141 seating mesh parts are smooth; both stems and canopies
reach the ceiling with 1 mm overlap. Original transforms/stem bottoms and source
hashes are preserved. All three renders were visually inspected. Image decode,
Python syntax, local documentation links and diff whitespace checks pass. App
runtime tests were not run for this unintegrated art-only revision.


## Speakeasy chair piping correction — October 18, 2026

The owner identified piping disappearing into cushion corners. Companion
`speakeasy_review_v4/` derives each piping loop from the evaluated horizontal
section of its cushion, including the existing bevels, and offsets the loop
slightly outwards so the cord sits consistently at the seam. All six chairs
retain the seam height, cord thickness, material, smooth shading and placement.

The existing piping curve objects are reused. A focused `fitted_section` helper
is necessary because the shared generic rounded-rectangle helper does not follow
actual beveled cushion geometry. That shared helper and other themes are intact.

[Corner/top detail](mockups/speakeasy-review-v4/speakeasy-v4-piping-top-detail.jpg) ·
[Side detail](mockups/speakeasy-review-v4/speakeasy-v4-piping-side-detail.jpg) ·
[Editable source, file/helper inventory and checks](../../Open-Tabletop_Asset_Builders/3d_models/rooms/1920s-speakeasy/README.md).

V4 is ready for owner visual review. This changes the review asset only; runtime
integration, app/device smoke tests and optimized exports remain pending.

Verification: all six loops are closed; 864 samples confirm the centerline stays
outside each evaluated cushion, with the cord underside seated against it.
Original transforms and smooth mesh shading are preserved. Top/side renders were
visually inspected; image decoding, source/output hashes, Python syntax, local
links and diff whitespace checks pass. Runtime tests were not run for this
unintegrated asset revision. No restart is needed to review the files.


## Speakeasy approval and Temple/Cyberpunk revisions — October 18, 2026

The owner approved Speakeasy v4 after the chair piping correction. Companion
`speakeasy_review_v4/approval.json` pins the approved source SHA-256 and records
the explicit statement. Approval applies to the room design; runtime integration
and optimized exports remain pending. Ten other batch designs remain in review.

Companion `temple_cyberpunk_review_v2/` extends the original Temple and Cyberpunk
sources without overwriting them. Temple smooths every mesh and raises existing
rounded bevels to six segments. Its blue backdrop represents an outside landscape
opening behind the columns. Cyberpunk replaces both center pendants with one
suspended industrial fixture: two cool-white fluorescent tubes, metal reflector,
sockets, cables and ceiling plates. Existing authoring primitives/materials and
ceiling collection ownership are reused. A review-only soft strip represents the
fixture output. The city window remains a staged exterior placeholder; pipe
risers retain their short upper stubs, with a full-room route unresolved.

[Temple seated view](mockups/temple-cyberpunk-review-v2/ancient-temple-v2-seated.jpg) ·
[Temple components](mockups/temple-cyberpunk-review-v2/ancient-temple-v2-detail.jpg) ·
[Cyberpunk seated view](mockups/temple-cyberpunk-review-v2/cyberpunk-back-room-v2-seated.jpg) ·
[Fluorescent fixture](mockups/temple-cyberpunk-review-v2/cyberpunk-back-room-v2-detail.jpg) ·
[Sources, helper/file inventory and checks](../../Open-Tabletop_Asset_Builders/3d_models/rooms/cyberpunk-back-room/README.md).

Both revised designs are ready for owner visual review. These revisions change
no app controls, room IDs, runtime helpers or shared state. Physical window/sky
integration and real-device/in-app checks remain future work.

Verification passes: all 183 Temple mesh parts use smooth shading; 162 bevels
have six segments. Authored base geometry/materials/placements are preserved.
Cyberpunk cables and ceiling plates meet the roof underside; other scene assets
are preserved. Four renders were visually inspected. Image decoding, source/output
hashes, approved Speakeasy hash, Python syntax, local links and diff whitespace
checks pass. Runtime tests were not run for these unintegrated art revisions.


## Ancient Temple approval and final Cyberpunk pipe returns — October 18, 2026

The owner approved Ancient Temple v2 and approved Cyberpunk conditional on both
pipe stubs turning another 90 degrees upward into the ceiling. Companion
`cyberpunk_review_v3/` adds smooth 150 mm radius return bends to the original
stubs, then vertical segments extending 25 mm into the ceiling, with union sleeves
and ceiling collars. Existing curve/cylinder/camera primitives and pipe material
are reused; no new helper functions are added. All original object placements,
mesh geometry/materials and the fluorescent fixture are retained. The original
West wall/utility ownership is preserved.

The pipe condition is fulfilled. Source hashes and the explicit owner statement
are recorded in the Temple v2 and Cyberpunk v3 approval sidecars. Three of the
eleven batch designs are now approved: Speakeasy v4, Ancient Temple v2 and
Cyberpunk v3. Eight remain under review. Design approval does not complete
runtime integration, optimized exports or real-device/in-app verification.

[Completed corner](mockups/cyberpunk-review-v3/cyberpunk-v3-pipes-corner.jpg) ·
[Room context](mockups/cyberpunk-review-v3/cyberpunk-v3-pipes-reverse.jpg) ·
[Source, file/helper inventory and verification](../../Open-Tabletop_Asset_Builders/3d_models/rooms/cyberpunk-back-room/README.md).

Verification passes: both return bends have a 90-degree tangent turn and
continuous joints, and both pipes extend 25 mm above the ceiling underside.
Original mesh geometry/materials and object matrices are preserved. Corner and
room renders were visually inspected; source/output/approval hashes, Python
syntax, image decoding, local links and diff whitespace checks pass. Runtime
suites were not run for this unintegrated art revision. No restart is required.


## Conservatory and Japanese room planting/chair revisions — October 18, 2026

The owner requested more natural and varied plants, clearance from the
Conservatory desk, attached Japanese chair V supports and smooth component
shading. Companion `garden_japanese_review_v2/` extends both original sources in
separate editable files. Original masters and unrelated user changes remain.

Shared botanical leaf/stem generation is appropriate because both rooms need
curved blades, connected petioles, varied growth and thin leaf tissue. Explicit
species builders produce areca palm, rubber plant, fern, snake plant and peace
lily for the Conservatory, plus climbing vine foliage. Japanese uses rubber plant
and fern. Existing material, primitive, UV and asset ownership helpers are reused;
no original shared authoring function is modified. The complete fern foliage
bounds clear the desk by 0.658 m. Its new location is forward of the old corner.
The northern Japanese planter now follows the physical North wall ownership.

All six Japanese chairs gain a seat crossrail and central post, with branch tips
meeting the actual back-rail curve. Both rooms have smooth shading on every mesh,
six-segment bevels, 48-sided round chair parts and finer curved back rails.

[Conservatory seated](mockups/garden-japanese-review-v2/garden-conservatory-v2-seated.jpg) ·
[Other planting](mockups/garden-japanese-review-v2/garden-conservatory-v2-reverse.jpg) ·
[Desk clearance](mockups/garden-japanese-review-v2/garden-conservatory-v2-detail.jpg) ·
[Japanese seated](mockups/garden-japanese-review-v2/japanese-game-cafe-v2-seated.jpg) ·
[Japanese reverse](mockups/garden-japanese-review-v2/japanese-game-cafe-v2-reverse.jpg) ·
[Chair detail](mockups/garden-japanese-review-v2/japanese-game-cafe-v2-detail.jpg) ·
[Sources, file/helper inventory and checks](../../Open-Tabletop_Asset_Builders/3d_models/rooms/README.md).

These revised designs await owner review. The three prior approvals remain
intact. No runtime theme/UI/input/database change, optimized export or device
performance claim is introduced.

Verification passes after reloading both saved sources: 244 Conservatory and 256
Japanese room meshes have smooth shading, finite geometry and UVs. All thirty
evaluated support/frame intersections across six chairs pass. The complete fern
foliage clears the desk by 0.658 m. All six final renders were visually inspected.
Original/output hashes, Python syntax, image decoding, local links and diff
whitespace checks pass. Runtime tests were not run for this unintegrated art
revision. No restart or client refresh is needed to review the files.


## Remaining room smoothing and supported lighting — October 19, 2026

The owner approved Conservatory/Japanese v2. Source hashes and the explicit
statement are recorded in companion `garden_japanese_review_v2/` approval files.
Five designs are approved; the six others have requested polish ready for review.
The new companion `remaining_room_polish_v2/` contains seven separate sources:
six remaining themes plus the Japanese v3 global pendant refinement. The approved
Japanese plants/chairs are retained. A preserved copy of the owner's live unsaved
Wizard scene is the Wizard input; its live path, dirty state, mode, active object
and object count remained unchanged after the copy.

All remaining-theme mesh parts are smooth shaded, with finer bevels and round
components. Eight pendant stems/cords now connect to actual ceiling geometry with
conical covers adapted from Speakeasy. Covers fit the Cabin cross beam and Pirate
curved rib; the upper rims follow the actual support surface after smoothing.
Shade placement is retained. Both Pirate stern lanterns receive wall brackets.

Wizard/Victorian center pendants are removed. Wizard uses two side-wall lanterns
and a rear-wall bracket supporting the formerly floating study lantern. Victorian
uses two brass wall sconces with frosted tulip shades. Existing lamp/primitive,
material, UV and asset helpers are reused, with focused canopy/wall-mount helpers.
Wall-mounted fixtures belong to their walls; overhead fixtures remain Ceiling-owned.

[Current sources, thirteen views, file/helper inventory and checks](../../Open-Tabletop_Asset_Builders/3d_models/rooms/README.md).
[Wizard lantern](mockups/remaining-room-polish-v2/wizards-workshop-detail.jpg) ·
[Victorian sconce](mockups/remaining-room-polish-v2/victorian-study-detail.jpg) ·
[Beam-mounted canopy](mockups/remaining-room-polish-v2/mountain-cabin-detail.jpg) ·
[Japanese canopy](mockups/remaining-room-polish-v2/japanese-game-cafe-detail.jpg).

These are native asset/mockup changes. Runtime themes, controls, input, shared
state, model registration and optimized exports are unchanged. Device performance,
multiplayer behavior and in-app smoke testing remain future integration work.

Verification passes across seven saved files: 2,238 smooth mesh parts, finite
geometry and UVs; eight evaluated ceiling connections, five lantern hook/wall
mounts and two sconce wall mounts. No pendants remain in either study. The
approved Japanese plant/chair assembly signature is unchanged in v3. Thirteen
final renders were visually inspected. Source/output and all five approval hashes,
Python syntax, image decoding, local links and diff whitespace checks pass.
Runtime suites were not run for these unintegrated art revisions. No restart is
needed to review the files.

## Speakeasy runtime integration — October 19, 2026

The owner requested one-at-a-time integration, starting with the approved
Speakeasy. This slice registers **1920s Speakeasy** (`1920s-speakeasy`) in the
existing Room style select, using the final v4 source, SHA-256
`258e96c3c6cac4f341b0f8224f34b935494b92522138675f6d53e9e3dea0fe5d`.
Other batch themes remain outside runtime. The already approved settings example
and existing controls are retained; no icon or gesture is added.

Eight individual GLBs retain the smooth velvet seating/scalloped bench, fitted
chair piping, clear rear-wall brass fan placement, console/chart/art, paneled
door, fluted bar/decanters, north fans, satin pendants/conical canopies and bordered
rug. They total **3,571,016 bytes** from 6,985,820 raw bytes (48.9% smaller).
The full 141-model install is 97,423,044 bytes from 154,755,536 before compression.
The canonical publisher verifies source/candidate decoded geometry/materials,
hierarchy, image pixels and GPU render comparisons on desktop/coarse touch under
strict CSP; these eight exports have zero validator errors/warnings.

Reuse decision: add one focused theme definition using the existing component
boundary, surfaces/opening helpers, shared `tableOutline`, assembly, occupied
seating, model/device preparation, shared companion, cutaways and disposal.
No shared lifecycle/helper is replaced. The adaptive wood base meets the real
`TABLE_FINISH.rimBase` within every supported table outline. Floor, walls and rug
follow the effective table extents. Authored furnishings retain metre proportions
at seven units/metre. Chair feet use the evaluated mesh minimum. North furnishings
follow north; rear art/fans/console and door follow south; both complete pendants
follow the ceiling underside and omit shadows over the game. All optional model
loads retain fallbacks, and stale loads release their resources normally.

The review table, staged lighting/cameras and fixed six-chair roster are excluded.
The existing playable table/physics stay authoritative. Saved table/sky/lighting
remain independent; **Use matching table** explicitly applies Walnut / quiet
burgundy felt `#493745` through the existing authorized messages. The approved
shared pup is reused in its floor-relative southwest corner. Source materials
are preserved: portable derivative maps adapt procedural relief and the original
oak/tint multiplication. The Luke.RUSTLTD CC0 oak image retains its existing credit.
The live Blender GUI is untouched; background export preserves the approved hash.

Actual production renderer captures, with the real playable table and explicit
matching finish (isolated preview state):

![Integrated Speakeasy overview](mockups/speakeasy-runtime-overview.jpg)

[Seated view](mockups/speakeasy-runtime-seated.jpg) ·
[Rear wall](mockups/speakeasy-runtime-reverse.jpg) ·
[Companion exporter, PNG masters and provenance](../../Open-Tabletop_Asset_Builders/3d_models/rooms/1920s-speakeasy/README.md).
All three final views were visually inspected; capture logs have no browser
errors or missing assets. These are runtime captures, separate from Blender
approval renders.

| Files touched in this integration | Functions/behavior added or extended |
| --- | --- |
| `public/rendering/rooms/speakeasy-theme.js` | Adds `SPEAKEASY`, `SPEAKEASY_THEME`, `createMaterials`, `buildStructure`, `placeModel`, `buildOpenings`, `buildPlayArea`, `buildFurnishings`, `buildDecoration`. Builders use existing owners; no production helper is removed. |
| `public/rendering/rooms/room-themes.js`, `shared/room-environments.js` | Adds the static theme and public option; existing resolver/validator/settings wiring is reused. |
| `postgres/028_speakeasy.sql`, `postgres/schema.sql` | Additive ID constraint extension and fresh baseline/ledger; existing migrations and defaults are preserved. |
| `public/table.html` | Adds the available theme name to existing Room style help; controls, icons and input routes are unchanged. |
| `public/static_assets/models/environments/speakeasy/*` | Eight final GLBs and source/anchor/material/license README. |
| `public/static_assets/models/manifest.json`, `public/rendering/builtin-model-assets.js` | Publisher integrity records/baselines and canonical decoder registrations; prior shared-pup entry retained. |
| `test/speakeasy.js` | Adds `state`/`fixture` and shape/occupancy, wall/roof ownership, one-load-per-kind, phone/resource/stale-load, missing-model, support and enclosure checks using the real backdrop. |
| `test/room-settings.js`, `test/room-backdrop.js` | Explicit matching messages/independence and public option coverage using existing fixtures. |
| `test/backend-room-state-handlers.js`, `test/backend-schema.js` | Guarded-role acceptance, shared patches and late-join hydration extended for Speakeasy. |
| `scripts/test-database.mjs`, `test/integration/database.js` | Existing `prepareDatabase` upgrade/reapply/default preservation assertions and durable Speakeasy saves/fresh reads; no new helper. |
| `scripts/component-parity.mjs` | Extends existing bootstrap fixture whitelist; adds Speakeasy production scenario with actual models, fitted-piping distances, inward/grounded chairs, occupancy, phone policy, canopy contact, rear-door clearance, shape/size seating clearances, settings and frame-loop cutaways/switch cleanup. Six-option select expectations updated; existing prior-task companion assertions retained. |
| `docs/mockups/speakeasy-runtime-{overview,seated,reverse}.jpg` | Actual renderer review derivatives; PNG masters retained in companion workspace. |
| `CHANGELOG.md`, `docs/ROOM_THEMES.md`, `docs/ROOM_THEME_REVIEW.md`, this plan, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/ART_DIRECTION.md`, `docs/ASSET_CREDITS.md`, model-root README | Current registration/ownership, source/license/byte counts, operating steps, file summary and verification limits. |
| Companion `speakeasy_runtime_v1/export_runtime.py`, `runtime/*`, `capture_runtime.mjs`, `captures/*`, `README.md` | Reuses pure Modern Bar `png`/`portable` helpers; adds focused repeated-root selection and derivative-only oak/velvet conversion. Evaluated material batches, anchors, smooth-face/transform/bounds/hash report and runtime capture recipe/masters. Approved source and live session remain unchanged. |

Verification: `npm run check` passed lint, formatting, CSS and all **1,248 tests**
with one CPU and a 512 MiB Node heap. The restricted attempt stalled in
network-dependent tests; the full run passed with localhost access. All **25**
disposable PostgreSQL integration tests and migration 028 upgrade/reapply checks
passed. All **141** model GPU/baseline checks passed on desktop and coarse touch.
The focused Speakeasy production bootstrap passed both profiles, and all seven
device-layout profiles passed. Full `npm run test:components` passed desktop and
coarse-touch scenarios, including the six-option select, all furnished-room
bootstraps, notecard editor and tile companions. Its only missing path was the
existing `/favicon.ico`. Python/JavaScript syntax, source/export/canonical hashes,
38 Speakeasy local links, image decoding and diff whitespace checks passed.
The piping probe ignores zero-area bevel triangles before measuring surface
distance; native piping itself was not altered. Automated checks do not establish
physical-device GPU performance, gesture feel or real multiplayer acceptance.

To try locally: apply **migration 028** through the configured migration role
using the normal server upgrade/restart, then refresh clients. In **Room Settings
→ Table Size & Color → Room style**, choose **1920s Speakeasy**. Smoke-test
switching away/back, joining/leaving seats and spectators, front/rear and overhead
cutaways, small/large/round/oval/hex tables, and optional matching. Confirm that
selection alone retains the current table, lighting and sky. Phone cold load,
close-up materials and real multiplayer/reload acceptance remain manual. No user
database was migrated, live server restarted, commit pushed or deployment made.
Pre-existing working-tree edits were preserved.

### Speakeasy chair orientation correction — October 19, 2026

The owner found the chairs facing away from the table. The chair export's actual
backrest is on glTF -Z (open seat faces +Z), while shared occupied seating expects
the backrest on +Z. The initial orientation probe incorrectly tested an assumed
+Z point instead of the authored backrest vertices and therefore missed the error.

Reuse the existing `assembly.furnishing` yaw argument: `buildPlayArea` now rotates
only the imported Speakeasy chair by a half-turn. Procedural fallback chairs
already follow the seating convention. No shared seating transform, model, native
source, piping, seat position or other theme is changed. The regression now
measures actual high upholstery/backrest vertices in world space and checks that
they sit outward from the chair center at every one of eight occupied seats,
across the existing table shape/resize cases and desktop/coarse touch. The revised
regression fails on the original placement in both profiles before the correction.
The three linked runtime views above are refreshed to show the corrected chairs.

Files/functions touched: `public/rendering/rooms/speakeasy-theme.js` changes
`buildPlayArea`'s existing chair-slot yaw; `scripts/component-parity.mjs` extends
the existing Speakeasy bootstrap's `inspect` probe and eight-seat roster (no new
helper); `CHANGELOG.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`, this plan and
`public/static_assets/models/environments/speakeasy/README.md` record the correct
axis contract; the three `docs/mockups/speakeasy-runtime-*.jpg` views are refreshed.
Companion `speakeasy_runtime_v1/README.md` and the exporter's axis comment are
corrected, with updated `captures/*` and `delivery-checks.json`. No function is
removed or new runtime helper added. The GLBs and approved Blender source remain
unchanged. Existing user/other-task edits remain preserved.

Correction verification: `npm run check` passed lint, formatting, CSS and all
1,248 tests. The focused Speakeasy production bootstrap passed desktop and
coarse-touch profiles, checking actual backrest vertices at all eight seats
across table shapes/resizes as well as the existing piping/grounding/cutaway
checks. All three refreshed runtime images were visually inspected; captures
had no browser errors or missing assets. Image decoding, unchanged model
baselines, Python syntax and diff whitespace checks passed. The full component,
model, database and device suites listed above belong to the initial integration;
this correction reran the code check and focused production bootstrap. Refresh clients to load the updated theme module; this correction
needs no new migration or server restart. For manual acceptance, occupy different
seats and confirm that the chair backs face outward and their open seats face the
table. First installing Speakeasy still requires migration 028 as documented above.

## Ancient Temple runtime integration — October 19, 2026

The owner accepted the corrected Speakeasy chairs with "Looks good" and requested
Ancient Temple next. This slice registers **Ancient Temple** (`ancient-temple`)
from the approved smooth v2 source, SHA-256
`f9d44c0b6ebab77ae916a7584c0c182a4b422b97b1aecd267c1d5eb2831714fc`.
The existing approved Room style / Use matching table layout gains only the theme
name and matching metadata; no new control, icon or gesture is added. Other batch
themes remain outside runtime.

Eight individually optimized models provide the stone seat, one column reused
four times, one brazier reused twice, sandstone relief, console/chart, recessed
door, loggia frame and smooth paving stone. They total **2,629,816 bytes** from
4,998,200 raw bytes (47.4% smaller). The 149-model install totals 100,052,860 bytes
versus 159,753,736 before compression (37.4% smaller). All eight exports have zero
validator errors/warnings and passed the existing lossless publisher's exact
source/candidate geometry, material/hierarchy, image-pixel and strict-CSP
GPU comparisons on desktop/coarse touch.

Reuse decision: add a focused component definition through existing surfaces,
aperture helpers, table outline, assembly, occupied seating, shared companion,
cutaways, model preparation and cleanup. Existing plank geometry does not fit
square stone paving; theme-local `buildPaving` therefore repeats the native
smooth beveled paver as a bounded 32×32 instance batch, with retained source
geometry/materials and explicit picking/phone/shadow flags. It does not create a
new lifecycle owner or alter the shared assembly. Floor/walls resize around the
effective outline. The actual native backrest is checked: the chair slot applies
a half-turn, with grounded stone feet and occupied seats only.

Columns stay aligned with their fixed authored loggia frame as the room grows;
braziers retain their corresponding positions outside the seating envelope.
The north opening is a real view onto the selected sky: review blue panel and
foliage are excluded, with opaque walls terminating within the solid frame.
Native frame geometry is inset clear of the wall face. North columns/braziers/
frame, west relief and south console/door inherit their support cutaways; the
ceiling follows the usual overhead cutaway. Coals remain static emission and no
review light/camera/table or fixed roster is imported. The shared pup is reused.
Stone trestles fit the shared table outline and reach the real tabletop underside.
The existing playable table/physics remain authoritative; explicit matching
uses existing Oak / olive felt `#655f4d`. Selecting Temple preserves the saved
wood, felt, sky and lighting. The review's bespoke stone tabletop remains a study
rather than adding a second surface over the game.

Original materials, source geometry and packed images stay intact. Procedural
relief is adapted only in portable derivatives through the existing export
recipe. All new geometry/maps are project originals; existing runtime stone
maps, pup and preview sky retain their credits. The native source hash is unchanged
and all authoring runs in background Blender, leaving the live GUI untouched.

Actual production renderer views, with the real playable table, explicit matching
finish and existing **Cloudy - Clear Afternoon** sky in isolated preview state:

![Integrated Ancient Temple overview](mockups/temple-runtime-overview.jpg)

[Seated view](mockups/temple-runtime-seated.jpg) ·
[Rear wall](mockups/temple-runtime-reverse.jpg) ·
[Companion exporter, PNG masters and provenance](../../Open-Tabletop_Asset_Builders/3d_models/rooms/ancient-temple/README.md).
All three final views were visually inspected; capture logs contain no browser
errors or missing assets. Theme selection itself never selects this preview sky.

| Files touched in this integration | Functions/behavior added or extended |
| --- | --- |
| `public/rendering/rooms/ancient-temple-theme.js` | Adds `ANCIENT_TEMPLE`, `ANCIENT_TEMPLE_THEME`, `createMaterials`, `buildPaving`, `buildStructure`, `placeModel`, `buildOpenings`, `buildPlayArea`, `buildFurnishings`. New theme-local paving adapter shares native geometry/materials; shared lifecycle remains unchanged. No production helper removed. |
| `public/rendering/rooms/room-themes.js`, `shared/room-environments.js` | Static registration and public option; existing resolution, validation and settings wiring reused. |
| `postgres/029_ancient_temple.sql`, `postgres/schema.sql` | Additive environment constraint and fresh baseline/ledger; prior migrations/defaults preserved. |
| `public/table.html` | Adds the available name to existing room-style help. |
| `public/static_assets/models/environments/ancient-temple/*` | Eight canonical GLBs and source/anchor/license/material README. |
| `public/static_assets/models/manifest.json`, `public/rendering/builtin-model-assets.js` | Publisher source/final integrity records, browser baselines and decoder registrations, retaining prior assets. |
| `test/ancient-temple.js` | Adds `state`/`fixture` and six real-backdrop occupancy/shape, cutaway, one-load/resource/phone/stale, missing-model, support and enclosure regressions. |
| `test/room-settings.js`, `test/room-backdrop.js` | Explicit Oak/olive matching/independence and public option coverage through existing fixtures. |
| `test/backend-room-state-handlers.js`, `test/backend-schema.js` | Extends live-role acceptance, shared patches and late-join hydration. |
| `scripts/test-database.mjs`, `test/integration/database.js` | Existing `prepareDatabase` upgrade/reapply/default/old-style preservation checks and durable Temple saves/fresh reads; no new helper. |
| `scripts/component-parity.mjs` | Adds Temple production scenario via the existing bootstrap. Actual backrest vertices at eight seats, paver batching/bounds/height, frame alignment, clear rays/background pixels, wall/roof ownership/cutaways, phone/picking policy, matching, resizes and seating clearances. Updates existing fixture whitelist and seven-option expectations; retains the Speakeasy correction and prior shared-pup checks. |
| `docs/mockups/temple-runtime-{overview,seated,reverse}.jpg` | Real renderer review derivatives; PNG masters retained in companion workspace. |
| `CHANGELOG.md`, this plan, `docs/ROOM_THEMES.md`, `docs/ROOM_THEME_REVIEW.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/ART_DIRECTION.md`, `docs/ASSET_CREDITS.md`, model-root README | Registration/ownership, source/license/bytes, file summary, operating steps and verification limits. |
| Companion `ancient_temple_runtime_v1/export_runtime.py`, `runtime/*`, `capture_runtime.mjs`, `captures/*`, `README.md`, `delivery-checks.json` | Explicit selected-part/anchor export recipe reusing existing pure helpers; evaluated mesh/material batches, portable maps, source/part/smooth-face/transform/bounds/hash reports, production capture recipe/masters and delivery audit. Original approved source unchanged. |

Verification: `npm run check` passed lint, formatting, CSS and all **1,263 tests**
with one CPU and a 512 MiB heap. All **25** disposable PostgreSQL tests and migration
029 upgrade/reapply/default preservation checks passed. The full **149**-model
GPU/baseline suite passed desktop and coarse touch. Focused Temple production
bootstrap passed both profiles; all seven device-layout profiles passed. Full
component suite passed all desktop/coarse-touch scenarios, including the seven-option
select and all six furnished-room bootstraps, plus notecard/tile companions. Its
only missing path was the existing `/favicon.ico`. Python/JavaScript syntax,
28 Temple local links, image decoding, all source/final hashes and diff whitespace
checks passed. Existing committed model records are unchanged. Automated checks
do not establish actual-phone
GPU performance, gesture feel or real multiplayer/gameplay acceptance.

To test locally, apply **migration 029** through the configured migration role
using the normal upgrade/server restart, then refresh clients. In **Room Settings
→ Table Size & Color → Room style**, choose **Ancient Temple**. Smoke-test
switching away/back, occupied/spectator seating at different positions, the view
through the columns with a chosen sky, interior/exterior/overhead cutaways and
small/large/round/oval/hex tables. Explicit matching should apply only Oak/olive;
selection alone should preserve table/sky/lighting. Real-device cold load,
materials/performance and multiplayer/reload acceptance remain manual. No user
database was migrated, live server restarted, commit pushed or deployment made.
Pre-existing working-tree changes, including Speakeasy and the shared pup, were
preserved.

## Ancient Temple column texture correction — October 19, 2026

Owner feedback identified stretched stone on the cylindrical shaft. Background
inspection found the primitive's side UVs used one repeat around the 1.570796m
circumference but only half a repeat over the 2.9m height: 3.69× directional
stretch. Extend the existing exporter with `unwrap_column_shaft` on that evaluated
part only. Its cylindrical wrap repeats once around the shaft, with the same
1.570796m vertical period and rear-facing seam. The measured side-edge density
ratio is 1.00412 (the 20-sided chord/arc difference); no side triangle crosses the
UV seam. Capitals/plinth keep their existing UVs.

Reuse Modern Bar's `ASSET_KEYS` subset-export contract to regenerate only the
column. Keep its single material batch, existing 512px stone maps and original
geometry. The correction audit compares all **3,068 oriented triangles**, normals,
material definitions, embedded image bytes and transforms exactly against the
previous raw export. All match; the other seven derivative reports/hashes and
approved `.blend` hash are unchanged. Only UVs and their derived tangents change.
The canonical column is now **434,012 bytes** from 875,088 raw bytes, with zero
validator errors/warnings. Current package/global totals above include this fix.

![Corrected column stone wrap](mockups/temple-runtime-column.jpg)

| Files touched by this correction | Functions/behavior |
| --- | --- |
| Companion `ancient_temple_runtime_v1/export_runtime.py` | Adds `unwrap_column_shaft` and extends the existing export loop with the shared `ASSET_KEYS` convention and UV audit metadata. No production helper added or removed. |
| Companion `runtime/temple-column.glb`, `runtime/export-report.json` | Corrected shaft UVs and reproducible per-part density/provenance report. Other seven model files unchanged; portable texture files regenerate to identical image content. |
| Companion `column-uv-correction/{before-temple-column.glb,before-export-report.json,before-column.png,verify_column.py,verification.json}` | Retained baseline and `inspect` verification of geometry/normals/material/image/transform equivalence, source hash and unchanged other assets. |
| `public/static_assets/models/environments/ancient-temple/temple-column.glb`, `public/static_assets/models/manifest.json` | Canonical publisher replaces this model and its integrity/browser baseline only. Generated URL registrations are unchanged. |
| `scripts/component-parity.mjs` | Extends the existing Temple `inspect` scenario with physical UV density and seam checks on actual decoded shaft triangles through table resizes. |
| Companion `capture_runtime.mjs`, `captures/temple-runtime-{seated,reverse,overview,column}.png`; app `docs/mockups/temple-runtime-{seated,reverse,overview,column}.jpg` | Adds column close-up and refreshes actual production-renderer views. All four visually inspected; no capture browser errors/missing assets. |
| `CHANGELOG.md`, this plan, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/ASSET_CREDITS.md`, model-root/Temple READMEs, companion `README.md` and `delivery-checks.json` | Root cause, derivative/material ownership, current sizes, reproducibility, checks and refresh instructions. |

`npm run check` passes lint, formatting, CSS and all **1,263 tests**.
Focused production bootstrap passes desktop/coarse touch, including decoded UV
scale/seam checks, eight occupied chairs, resizing, cutaways, paving and clear
opening pixels. All 149 model integrity/material/GPU checks pass both strict-CSP
profiles. The standalone correction audit, Python syntax, JPEG decoding and diff
whitespace checks pass. The initial integration's database, device-layout and
full component runs above remain historical checks; this asset correction does
not change those interfaces. Physical phone performance and multiplayer/manual
acceptance remain pending. Hard-refresh the room and inspect the columns from
seated and close-up angles; no additional migration or server restart is needed.

## Remaining nine room integrations — October 19, 2026

The owner requested integrating all remaining rooms together before their next
in-app review. This slice adds Starship Lounge, Victorian Study, Mountain Cabin,
Pirate Captain's Cabin, Wizard's Workshop, Cyberpunk Back Room, Japanese Game Café,
Garden Conservatory and Orbital Observation Deck. All eleven reviewed concepts
are now integrated locally; this records implementation authorization without
marking final owner design/gameplay acceptance complete.

[All runtime views, IDs, table matches and review steps](ROOM_THEME_RUNTIME_REVIEW.md).

![Nine integrated rooms](mockups/remaining-rooms-runtime-v1/contact-seated.jpg)

The latest six polished v2 sources, Japanese pendant-refined v3, Conservatory
botanical v2 and Cyberpunk pipe-return v3 supply **66** optimized GLBs. They total
**61,445,704 bytes** from 105,958,496 raw bytes (42.0% smaller), with zero validator
errors/warnings. The app now has **215** canonical models totaling 161,498,564 bytes
from 265,712,232 raw bytes (39.2% smaller). All previous **149** manifest records,
including the corrected Temple shaft, are byte-for-byte unchanged. All nine
native source hashes are unchanged and every exported face is smooth. Older
Cyberpunk mesh faces receive smooth flags in an unsaved background copy before
their existing bevel/weighted-normal stack is evaluated. Native pipe returns,
fluorescent fixture, canopy/stem connections, wall brackets, botanical species
and Japanese wishbone joints remain authored geometry.

Reuse decision: the nine studies were authored with the same collection/anchor,
metre scale and staged-table boundaries. A focused `createAuthoredRoomTheme`
adapter therefore owns their genuinely shared construction rules; static configs
retain explicit palettes, apertures, fixture anchors and asset variants. Existing
`createRoomEnvironment`, assembly/model loader, seat layout, cutaways, phone
materials, shared pup, shadow/resource cleanup and independent table/sky/lighting
owners remain authoritative. No new global context, simulation owner, input intent
or runtime light is added. The unchanged Temple paving recipe is extracted to
`buildRoomPaving` and reused by Conservatory, retaining bounded 32×32 instances.

Native wall dressing remains rigid as the enclosing shell follows table bounds;
structural roof geometry and Conservatory side iron frames follow room extents. Individual ceiling fixtures
keep round conical covers and receive matching roof anchor positions. Ceiling
fixtures follow the roof cutaway; wall fixtures/dressing follow their support wall.
Wizard and Victorian have wall lights and no center pendants. Actual native chair
backs are checked at all eight seats, with the occupied-seat half-turn and feet
grounded from evaluated vertices. Quiet table supports fit the shared outline
and meet the existing tabletop underside. Window apertures expose the selected
sky; exterior study panels, city/planet/foliage dioramas and staged lights/tables/
fixed seat rosters are excluded. Rain streaks and native frames remain. Only
explicit **Use matching table** sends the existing Oak/Walnut and quiet felt pair;
room selection preserves the saved table finish, dimensions, sky and lighting.

Visual/production checks caught and corrected three integration details:
Conservatory uses 28 units of clearance around the full foliage bounds instead of
24; floors have continuous opaque backing under tile/plank joints; the Victorian
derivative clock is lowered 0.06m to meet its mantel, and the rigid east desk has a
1.19-unit inset to clear the wall. These changes preserve the original source
files, material pixels and mature plant/desk relationships. The final 27 seated,
rear and overhead captures use the real playable table and existing Cloudy - Clear
Afternoon sky in isolated review state, with no browser errors or missing assets.
Final source/canonical audits and the three contact sheets are retained alongside
PNG masters in the companion package.

| Files touched in this batch | Functions/helpers/behavior added or changed |
| --- | --- |
| `public/rendering/rooms/authored-room-theme.js` | Adds `AUTHORED_ROOM`, `createMaterials`, `placeModel`, `buildStructure`, `buildPlayArea`, `buildFurnishings`, `createAuthoredRoomTheme`. Common collection ownership, adaptive shell/roof, rigid dressing, separate fixtures, grounded chair resources, shared-outline bases and opaque floor backing. Explicit Garden clearance/structural-frame span and Victorian wall-offset variants. |
| `public/rendering/rooms/remaining-room-themes.js` | Adds static `REMAINING_ROOM_THEMES` definitions with nine reviewed palettes/apertures/model lists/fixture anchors and existing wood/felt pairings. |
| `public/rendering/rooms/room-paving.js`, `public/rendering/rooms/ancient-temple-theme.js` | Extracts existing `buildPaving` implementation to `buildRoomPaving(dependencies,config)`; Temple retains a wrapper and identical instance policy/config/behavior. Shared with Conservatory. No other Temple behavior or asset changes. |
| `public/rendering/rooms/room-themes.js`, `shared/room-environments.js` | Registers nine bundled render definitions and public IDs/names; existing resolution, validation and native settings wiring reused. |
| `postgres/030_remaining_room_themes.sql`, `postgres/schema.sql` | New additive 16-ID constraint migration and fresh baseline/ledger entry; previous migrations/defaults/rows preserved. |
| `public/static_assets/models/environments/{starship-lounge,victorian-study,mountain-cabin,pirate-captains-cabin,wizards-workshop,cyberpunk-back-room,japanese-game-cafe,garden-conservatory,orbital-observation-deck}/*` | 66 canonical GLBs and nine per-theme source/hash/anchor/material/license READMEs. Complete filenames appear in each README and the manifest. |
| `public/static_assets/models/manifest.json`, `public/rendering/builtin-model-assets.js`, model-root README | Canonical publisher's integrity/material/image/GPU records, exact URL registrations and current library totals. Old 149 records retained unchanged. |
| `test/remaining-room-themes.js` | Adds reused `state`/`fixture` and 36 lifecycle/occupancy, table-shape/base, cutaway ownership, missing-load, phone, sibling-disposal/stale-callback regressions; continuous ground at Garden tile joints is checked with real ray/geometry intersections. |
| `test/room-settings.js`, `test/room-backdrop.js`, `test/backend-room-state-handlers.js`, `test/backend-schema.js` | Nine explicit matching/independence cases, all public styles, permission/shared-patch/late-join coverage through existing harnesses. |
| `scripts/test-database.mjs`, `test/integration/database.js` | Extends `prepareDatabase` with migration 030 old-row preservation/reapply/default/invalid-ID checks; durable save/read round-trips for all 16 IDs and migration ledger count 30. |
| `scripts/component-parity.mjs` | Extends production fixture whitelist and native choice expectations to 16; adds the nine-room `inspect` helper, combined bootstrap and focused Conservatory scenario. Loaded chair orientation/grounding at eight seats, native wall/roof ownership, phone/picking policy, shape/resizing/clearance, matching, disposal/saved sky-lighting, side-frame span and tile-joint backing are checked in real browser profiles. |
| `public/table.html` | Updates existing room-style help for 15 furnished themes plus Standard; no new icon, control, gesture or input path. |
| `docs/ROOM_THEME_RUNTIME_REVIEW.md`, `docs/mockups/remaining-rooms-runtime-v1/*` | Review/operating page, 27 actual runtime JPEG views and three labeled contact sheets. |
| `CHANGELOG.md`, this plan, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/ROOM_THEMES.md`, `docs/ART_DIRECTION.md`, `docs/ROOM_THEME_REVIEW.md`, `docs/ASSET_CREDITS.md` | Current registration/component/ownership/source/license/status, matching, migration/review steps, file inventory and verification limits. Older dated review records remain historical. |
| Companion `remaining_rooms_runtime_v1/inventory.py`, `inventory.json`, `export_runtime.py`, `export-report.json`, `pre-placement-export-report.json`, `runtime/*` | Guarded source/collection inventory and evaluated multi-material export, new `members` selector, reused `png`/`portable` PBR/oak helpers, subset exports, smooth-shading/clock adaptations, source parts/materials/bounds/face/hash provenance and raw GLBs/maps. Native files never saved. |
| Companion `publish.mjs`, `capture_runtime.mjs`, `package_captures.mjs`, `captures/*`, `capture-report.json`, `source-model-audit.json`, `delivery-checks.json`, `README.md` | Sequential canonical publishing; production renderer `selectReviewRoom`/`captureReviewRoom` helpers; JPEG/contact-sheet packaging; masters, source/model/image audits, reproducibility and delivery record. |

Verification: `npm run check` passes lint, formatting, CSS and all **1,374 tests**.
All **25** disposable PostgreSQL tests pass, including migration 030 preservation/
reapply, default/invalid-ID and all 16 durable-style round trips. All **215** model
integrity/material/image/GPU comparisons pass strict-CSP desktop and coarse touch;
all **seven** device-layout profiles pass. The full component suite passes both
profiles, including every new room and all six prior furnished-room bootstraps,
plus notecard/tile companions. Its only missing path is the existing `/favicon.ico`.
The final focused Conservatory desktop/touch run additionally verifies opaque
floor joints and resized iron-frame span with loaded native geometry. All **36**
new lifecycle/floor cases pass independently. Python/JavaScript syntax, new local
links, 30 JPEG decodes, source/model/capture hashes and diff whitespace checks pass.
Native sources/live Blender and old 149 manifest records are unchanged. No push,
deployment or owner database migration is performed; unrelated working-tree
changes remain intact.

Apply all pending migrations through the configured migration role, including
**030**, restart the server, then hard-refresh clients. There is no new service,
port, environment variable or runtime build step. The native settings select
shows all **16** styles. For manual acceptance, use the runtime review page's
seated/rear/overhead links and check occupied seats, wall/roof cutaways, lights,
plants, large round/hex tables, a reload and a second viewer. Physical phone GPU
performance, gesture feel and real multiplayer/gameplay approval remain pending.

## Local authoring cleanup — October 19, 2026

Completed the owner-requested cleanup of the eleven reviewed theme packages. Final native sources, two unique owner snapshots, 82 original raw publisher inputs, 82 exact installed runtime copies, textures, selected previews and small historical records are now in [the companion final-room index](../../Open-Tabletop_Asset_Builders/3d_models/rooms/README.md). Removed eleven superseded revision/runtime directories (558 old files), with roughly 189 MiB net reclaimed after retaining the organized pack. Older unrelated asset libraries and historical in-app review galleries remain.

Relocated the Speakeasy/Temple exporters and captures and the nine-theme export/capture/package/publish tools. Existing portable material functions were extracted unchanged into local export helpers; existing geometry helpers were retained. New top-level tools `audit_native.py` and `verify_files.py` inspect packed native dependencies and file hashes; no runtime functions or UI changed. Removed obsolete revision-build scripts with the superseded drafts. Per-file paths, original hashes and deliberate tool rewrites are recorded in the cleanup plan.

Checks: all eleven native sources open independently with packed images and no linked libraries; all 82 exports executed from relocated recipes. Indexed triangle positions/normals, materials, images and transforms compare exactly, while generated UV/tangent seam values can differ, so original saved final binaries were retained unchanged. Python/Node syntax and actionable local links checked; all 215 installed models, the app manifest and builtin registry match the pre-cleanup baseline. Background Blender completion markers were verified before stopping audio-shutdown hangs. Capture/publish tools were not used to replace installed assets. Full runtime tests were not repeated for offline file organization and documentation; existing owner gameplay testing remains outstanding. No app refresh or server restart is required for this cleanup.

App documentation files touched by this cleanup: `CHANGELOG.md`, `docs/ARCHITECTURE.md`, `docs/ART_DIRECTION.md`, `docs/ASSET_CREDITS.md`, `docs/PLAN_ROOM_THEMES.md`, `docs/REFERENCE.md`, `docs/ROOM_THEME_REVIEW.md`, `docs/ROOM_THEME_RUNTIME_REVIEW.md`, `public/static_assets/models/README.md`, `public/static_assets/models/environments/ancient-temple/README.md`, `public/static_assets/models/environments/cyberpunk-back-room/README.md`, `public/static_assets/models/environments/garden-conservatory/README.md`, `public/static_assets/models/environments/japanese-game-cafe/README.md`, `public/static_assets/models/environments/mountain-cabin/README.md`, `public/static_assets/models/environments/orbital-observation-deck/README.md`, `public/static_assets/models/environments/pirate-captains-cabin/README.md`, `public/static_assets/models/environments/speakeasy/README.md`, `public/static_assets/models/environments/starship-lounge/README.md`, `public/static_assets/models/environments/victorian-study/README.md`, `public/static_assets/models/environments/wizards-workshop/README.md`. The final pack contains its own root/theme indexes and complete file-integrity manifest.

## Earlier room packages consolidated — October 19, 2026

Completed the requested follow-up cleanup for Cozy, Poker Night, Medieval Tavern and Modern Bar. Final native furnishings, filled shelf, botanicals, shell/window, ceiling, corrected detail/window and rear-wall files are grouped in the same [final-room package](../../Open-Tabletop_Asset_Builders/3d_models/rooms/README.md) as the eleven newer themes. The accepted dense gray pup master and its scenery derivative are stored once under `_shared/gray-pup-in-bed`. Exact owner-fixed inputs, unique owner snapshots and applicable approval dependencies remain; generated drafts, `.blend1` backups, duplicate delivery archives, scratch logs and abandoned compression candidates were removed. All six delivery ZIPs were inventoried; archive-only owner input and records/previews were extracted before removing the duplicate bundles. Unrelated game-piece/model libraries remain in place.

Removed thirteen old directories plus seven loose source/archive files (402 files in total), approximately 261 MiB net reclaimed before small final audit metadata. The combined folder has fifteen furnished room themes, one shared companion package, thirty retained native files and 121 raw/runtime model pairs. One existing Modern Bar chair raw export already differed from the published manifest original hash before this task; both that raw file and the exact installed optimized model were preserved, with the discrepancy recorded in the companion manifest. No replacement model was published.

Offline tool changes reuse existing algorithms: relocated `cozy/tools/export_furnishings.py` (skip the superseded generic shelf), `cozy/tools/export_ceiling.py` (canonical output name), Poker/Modern/Tavern `tools/export_runtime.py`, shared pup `tools/export_runtime.py`, and `_shared/tools/export_legacy_backwalls.py`. Poker reads the already-packed final source without resaving it; corrected-source guards remain on Modern/Tavern exporters. Output paths support scratch directories. Existing `png`, `portable` and material/batching helpers retain their behavior; no new named helper or runtime function was added. Initial construction/revision scripts remain immutable historical recipe text rather than obsolete executable entry points. The shared native audit and file verifier now cover multi-source rooms and shared assets.

Verification: all thirty retained Blender files opened with packed images and no linked libraries, including a post-deletion run; thirty-four relocated export outputs were generated in scratch space with source hashes unchanged. Five Cozy raw exports (plants, shelf and window) were preserved without rerunning their retired construction recipes. All retained file hashes, actionable pack/source links, Python AST, Node syntax, and the installed model baseline were checked. All 215 app models, their manifest and builtin registry remain byte-identical. Full runtime tests were not repeated for offline organization/documentation; no runtime code changed. No refresh, migration or server restart is required. Historical manual device/gameplay limits remain as recorded above.

App documentation touched: `CHANGELOG.md`, `docs/ARCHITECTURE.md`, `docs/ART_DIRECTION.md`, `docs/ASSET_CREDITS.md`, `docs/PLAN_ROOM_THEMES.md`, `docs/REFERENCE.md`, `public/static_assets/models/README.md`. The root/five new package indexes, manifest, native audit, file verifier and detailed inventories live inside the companion pack. `_shared/provenance/legacy-cleanup-plan.json` lists every old file and preserved mapping; `legacy-cleanup-report.json` records the checks, removals and limits.
