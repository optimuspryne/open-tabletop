# Object hiding and map fog

Status: object Hide/Reveal implemented, 2026-09-27. The user approved the concrete UI and
icon pair A (Tabler `eye-off` / `eye`). Automated verification is recorded below; the user reports
manual tests passing. Slice 2, manual map fog, is implemented with the subsequently approved
mock-up and original eye-off entry; the user reports it works well. The subsequently approved
cloud-fog entry and volume/thickness extension are implemented. The user reports the result
looks good and approves committing it; specific devices/scenarios were not itemized. Slice 3,
piece reveal auras, is implemented after approval of its mock-up and recommended circle icon
on 2026-09-28. After the radius-stepper fix, the user reports it works great and approves
committing it; specific devices and individual scenarios were not itemized.

## Agreed direction

- Hidden objects must not push or block visible pieces.
- Fog represents shared party exploration: the GM freely uncovers/covers the map during
  play, and explored regions persist. Normal visual covering over downloaded map artwork is
  sufficient; this does not weaken server delivery protection for hidden objects.
- GM-configured piece auras reveal simple circles along movement, with radii expressed
  in map units (for example 1in or 3in). No wall detection or character-rule calculations.
- Manual reveal remains available alongside auras. Revealing terrain will not implicitly reveal
  an object the GM explicitly hid.
- Delivery order: object Hide/Reveal; manual map fog; circular reveal auras. Slices 1 and 2 are
  implemented and user-tested; slice 3 is implemented with a subsequent user-reported test pass.

## Slice 1: object Hide/Reveal

Owners and GMs get **Hide from players** / **Reveal to players** in the existing object menu,
and explicit **Hide selected** / **Reveal selected** selection actions. Compact controls retain
accessible names and hints. Touch long-press uses the existing radial menu for short action
lists and the scrollable flat menu otherwise. Explicit icons now survive radial conversion.
Desktop cards keep right-click flipping. ContextMenu / Shift+F10 cycles selected pieces, or all
pieces with no selection; keyboard invocation uses the focusable flat menu even on touch devices.
Menus close when their piece disappears or visibility/role changes.

Hidden objects remain ghosted to GMs with a readable **GM only** annotation. Player projections
contain no hidden piece, props, label, stock count, owner, collider or artwork reference. Existing
removal cleanup removes selections, held labels, highlights, inspection and meshes. Shared
original materials remain intact; per-instance ghost materials are restored/disposed on reveal,
rebuild and removal, including late model children.

The GM-only Library **Spawn hidden** checkbox starts off and resets on room handover. Each
placement carries its own captured boolean; asynchronous loads recheck live permission before
spawning. Table outputs of hidden decks, dispensers and notecard stacks inherit concealment.
Mixed visible/hidden combines and gathers are rejected before consuming inventory.

### Server and persistence boundaries

- One authoritative collection and inventory remains on the server. Colyseus `StateView` filters
  the `pieces` field for each client. Initial views seed an empty collection and synchronously
  prune unauthorized children before serialization, so reflected browser schemas always have
  a usable empty map even on a completely concealed table. Newly spawned hidden objects never
  enter player views. A missing view fails closed.
- Live room owner/GM rank authorizes sight; spectators retain their role's sight but existing
  participation rules still block gameplay. Join/reconnect, role changes and each patch reconcile
  views. Source-ID validation rejects guessed hidden targets before handler or reservation
  feedback. Deck browser tokens resolve to their server-owned source.
- A room-owned `AsyncLocalStorage` request scope carries visibility provenance through existing
  spawn/deal/dispense/split/combine paths and library awaits. The lifecycle rechecks live access
  at spawn. No mutable room-global "current spawn visibility" is used.
- Object events use a focused filtered broadcast helper. Collision callbacks pass the piece ID
  explicitly because they run outside requests. Sounds, shuffles and highlights stay GM-only
  when their sources are hidden.
- A `hidden` boolean is appended to `Piece` and stored per snapshot entry. Scenes and full game
  saves preserve it; older entries default to visible. Private card fronts, deck order and
  notecard content retain their existing storage boundaries. Orphaned inspection recovery
  retains its source visibility through save/restart and capacity retries.
- Visibility/access loss closes incompatible peeks, drawing/browsing leases and grabs. Pending
  cards return to their deck or remain recoverable at capacity; no card is discarded.
- Private hands retain their separate ownership/privacy contract. Taking a table piece into a
  hand ends that tabletop object's visibility identity; explicit hand play/sharing continues
  to use the established hand actions. Scene packages remain a separate deferred feature.

### Physics boundaries

Hidden bodies use kinematic motion and a zero collision mask. Unheld hidden pieces stay parked;
GMs can reposition movable hidden pieces using the existing drag controls. On release, after X/Z
snapping, movable hidden bodies settle onto board/mat collider surfaces below their centers, or
the tabletop outside those surfaces. The query uses collider parts and transforms, including
hidden boards, without restoring collisions. Visible drops retain normal gravity. Reveal restores the
appropriate dynamic/static body behavior without changing identity or inventory.

Hide/Reveal validates the whole batch before mutation. Finish grabs, scripted flips and edits
first. Hiding a supporting object requires moving or including the visible pieces resting on it.
Reveal rejects intersecting piece AABBs and placement below the tabletop with a useful error.
The overlap test is intentionally conservative for irregular models; reposition before retrying.
Hidden dice must be revealed to roll. Personal dice-tray pieces remain public; use tabletop dice
for concealed staging. No game-rule enforcement or automatic fog discovery was added.

## Reuse and changed files

Existing menu composition, selection intents, lifecycle spawning, request error/permission gates,
private inventory, scene serialization and client removal cleanup were extended. The new server
module owns visibility policy/provenance; the new browser module owns temporary ghost materials.
These are separate boundaries because authorization/physics and rendering have different owners.

| File | Functions/contracts changed or added |
| --- | --- |
| `server/game/piece-visibility.js` | New `createPieceVisibility`: source-ID registry, `runRequest`, `spawnHidden`, `canSee`/`isGM`, view reconciliation, `setVisibility`, physics parking and filtered event delivery; new `broadcastPieceEvent` adapter |
| `server/game/schema.js` | Append `Piece.hidden`; mark `State.pieces` view-filtered |
| `shared/room-capabilities.js` | Classify `setPieceVisibility` as gameplay |
| `server/game/interaction-policy.js` | `guardedMessage` routes through visibility before reservation/handler feedback |
| `server.js` | Construct service; register mutation; synchronize join/reconnect/patch views; prepare hidden physics after existing motion ordering; extend `spawn`, `spawnCardFlat`, `swapBoard`; filter hand-undo sound |
| `server/room-access.js` | `setRole` immediately refreshes affected views |
| `server/game/piece-lifecycle.js` | `spawn` accepts/inherits hidden state and parks bodies; `releasePiece` prohibits cross-visibility absorption; collision/absorption sounds use filtered delivery |
| `server/game/card-transfer.js` | `spawnTableCard` carries trusted recovery visibility into `spawnCardFlat` |
| `server/game/deck-browsing.js` | `allowed` checks object sight; `sourceFor` supplies internal provenance |
| `server/game/handlers/cards.js` | Filter flip/deal/shuffle/combine events; `drawInspect` captures source visibility |
| `server/game/handlers/pieces.js` | Filter group/roll/spawn/gather/absorb events |
| `server/game/handlers/placement.js` | Filter dispense/play/hand-drop events |
| `server/game/handlers/room-features.js` | Filter object highlights and tray sound events through the common adapter |
| `server/game/notecards.js` | Filter stack shuffle events; existing operations inherit request provenance |
| `server/game/scene-persistence.js` | `serializeScene`/`applyScene` retain piece and orphaned-inspection visibility |
| `public/table/hidden-piece-materials.js` | New `createHiddenPieceMaterials`, `update` and `restore` own/dispose ghost copies without modifying shared originals |
| `public/table/piece-view.js` | `bindRoom`, `replaceMesh` and removal restore ghost resources; new `updateVisibility` catches late model children |
| `public/table/piece-labels.js` | `update` adds the GM-only annotation to hidden pieces |
| `public/table/piece-ui.js` | Add Hide/Reveal menu actions, preserve explicit radial icons, handle keyboard invocation and stale-menu cleanup |
| `public/table/input-router.js` | ContextMenu/Shift+F10 cycles all/selected pieces through the existing intent path |
| `public/table/selection.js` | `refreshSelTools` and `bindActions` expose explicit GM batch targets and correct disabled states |
| `public/table/inspection.js` | `bindRoom` handles `inspectionClosed` |
| `public/editor/editor-panel.js` | New `sendPlacement` captures hidden choice for built-in/custom/batch/saved placements; room handover resets it |
| `public/client.js` | Wire role gates, selection rank, material refresh and radial cleanup dependencies |
| `public/table.html` | Approved Hide/Reveal buttons, Library placement checkbox and in-app help |
| `public/ui/icons.js` | Extend shared `initTip` with keyboard focus/blur hints alongside hover and touch |
| `public/styles.css` | Usable placement-checkbox target using shared control tokens |
| `test/piece-visibility.js` | Real schema serializer/reflection packets, role transitions, authorization, inventory, inherited spawns, physics, scene restoration, drop-over-hidden-deck feedback and async-access regression tests |
| `test/hidden-piece-materials.js` | Shared-material, opacity/shadow restoration, disposal and lazy-child replacement tests |
| `test/backend-schema.js` | Reflection test uses an authorized view |
| `test/backend-table-message-boundaries.js` | Account for the new guarded inline message |
| `test/input-router.js` | Keyboard menu expectation covers ordinary pieces |
| `scripts/component-parity.mjs` | Browser tests for hidden Library batch requests/reset, selected-state actions/layouts and approved menu/radial icons |
| `CHANGELOG.md` | Record implementation and restart/refresh requirements under Unreleased |
| `docs/ARCHITECTURE.md`, `docs/REFERENCE.md` | Document filtered state, request provenance, physics and current API contracts |
| `docs/GESTURES.md` | Document desktop/touch/keyboard paths and interaction limits |
| `docs/ROADMAP.md`, `docs/DESIGN_future_backlog.md` | Mark object concealment implemented while keeping fog/auras and manual testing distinct |
| `docs/DESIGN_concealment.md` | This approved implementation record and acceptance checklist |

## Slice 1 verification

- `npm run check`: lint, formatting and CSS checks passed; 856 runtime tests passed.
- `npm run test:input`: 57/57 passed.
- `npm run test:devices`: all 7 profiles passed.
- `npm run test:components`: desktop and coarse-390 component runs passed, including final
  selection/menu and keyboard/touch hint checks. Notecard editor at 1280px mouse / 390px and
  360px touch passed.
- No query or migration changed; database integration suite is not required for this slice.
- Headless component fixtures report existing missing bundled thumbnail derivatives/fallbacks;
  these are not live-room multiplayer or real-device performance verification.

**Restart the server and refresh every client.** No migration or new dependency is required.
The user reported manual tests green and approved committing this slice on 2026-09-27.
Specific devices and individual scenarios were not separately itemized.

Regression smoke checklist:

1. Join as GM and ordinary player. Hide/reveal a labeled prop and a deck; confirm ghost/GM-only
   status, no player mesh/label/highlight/sound, and no visible-piece collision while concealed.
2. Spawn hidden from the Library (single and batch), deal/split/dispense/draw from hidden sources,
   and reveal after positioning. Check both successful placement and overlap/support rejection.
3. Save/reload or restart, reconnect both clients, then promote/demote a GM with a hidden piece
   grabbed or a private peek/edit/browser open. Confirm contents survive and revoked UI closes.
4. Try right-click, card right-click flipping, long-press, keyboard menu/escape, and selection
   Hide/Reveal in full/compact layouts on desktop and a real touch device.

Automated results do not certify multiplayer timing, GPU performance, irregular-model placement
feel, or real-device gestures. The manual pass above records the user's report for this slice.

## Slice 2: manual map fog

The user approved the interactive desktop/full, compact and touch mock-up and chose the Tabler
**eye-off** entry. Reveal/Cover reuse eye/eye-off, Undo uses arrow-back-up, and Done uses check;
these actions retain their existing icons. The approved follow-up replaces the main entry with
**cloud-fog** and regenerates the shared sprites.

Active GMs open Fog beside Measure or through the drawer's Table group. The existing single-board
lifecycle is retained: the current image, procedural or 3D board is the target. Enable initially
covers the map. Reveal/Cover paints circular brush strokes using the room's displayed units;
Done/Escape ends painting without removing fog. Turning fog off preserves exploration. Cover all,
Reveal all, and toggles join the shared 20-edit session undo history. GM view is translucent;
Player fog preview is a local opaque view of the artwork mask only. It resets on panel close.
Other pieces remain visible/interactive according to their independent Hide/Reveal setting.

The brush uses the normal canvas input intent path. Painting suppresses object and camera
interactions, long-press menus and double-tap inspection. Touch supports single-finger drag/tap;
use Done before navigating the camera. A second finger, lost pointer capture, window blur or
pointer cancellation discards the unfinished stroke. Arrows move the brush in board-local
coordinates when the canvas has focus; Enter/Space stamps a circle. Choosing a brush focuses
that canvas, and Done/Escape returns focus to its Reveal control. Native fields retain their keys.
A stroke reaching 256 points is committed with a notice to lift and continue. Peers see completed
strokes; a local preview appears while the GM paints.

### Storage and reuse

`shared/map-fog.js` rasterizes circular capsules into a fixed 256×256 bit mask. Storage is bounded
at 8 KiB of bits (10,924 base64 characters) per mask; continued painting does not append history
to snapshots. The shared calculation preserves circular radii on non-square boards. Rendering
reuses `boardGeometry`/`boardHalfExtents` for the authored outline and copies the live transform,
without changing original board materials. Fog has no physics representation.

A versioned `Piece.fog` string follows the existing per-client piece view. The GM-only gameplay
request runs through existing permission, visibility and error boundaries. IDs, revisions,
coordinates, modes and brush limits are checked before mutation; stale edits are rejected rather
than overwriting another GM's work. A 75 ms per-client interval bounds repeated requests. Pending
browser requests wait for their state update, including when acknowledgment arrives first.

Scene/game snapshots preserve fog on the replacement board; invalid fog is rejected before table
clearing. Older snapshots start without enabled fog. Undo history is server-owned, weakly held
per live board, bounded to 20 states, and intentionally not persisted. Reconnect keeps shared
coverage; server restart restores coverage from the saved snapshot but starts fresh undo history.

The new shared/server/browser modules separate deterministic mask calculations, authoritative
mutation/history, and visual/input resources. Existing scene serialization, capability registry,
piece visibility, UI surfaces and input routing were extended rather than duplicating them.
Player mats, automatic auras and wall detection remain outside this slice.

### Changed files and functions

| File | Functions/contracts added or changed |
| --- | --- |
| `shared/map-fog.js` | New mask constants, eligibility/normalization/codecs and `paintFog` capsule rasterization |
| `server/game/map-fog.js` | New `registerMapFog`: guarded edit dispatch, revision/access/rate validation, bounded undo and save scheduling |
| `server/game/schema.js` | Append `Piece.fog` to reflected schema |
| `server.js` | Register the production fog capability during room initialization |
| `shared/room-capabilities.js` | Classify `fogEdit` as gameplay |
| `server/game/piece-visibility.js` | Include `fogEdit` in source-ID access checking |
| `server/game/scene-persistence.js` | `serializeScene`/`applyScene` retain and preflight fog beside board props |
| `public/table/map-fog.js` | New `createMapFog`: mask mesh/texture ownership, live transforms, control binding, pending edits, brush/cursor input, role/lifecycle cleanup |
| `public/client.js` | Compose/bind/synchronize fog and cancel on participation loss; preserve startup hydration ordering |
| `public/table/table-shell.js` | `bindControls` adds the fog pane and drawer proxy using existing UI surfaces |
| `public/table/input-router.js` | Route painting and tool keys; suppress conflicting object/camera actions |
| `public/table/controls.js` | Expose pointer cancellation and give tool commands first chance at keyboard axis keys |
| `public/table.html` | Approved fog entry/pane, accessible control names/states and in-app gesture help |
| `public/styles.css` | Shared-token field layout, usable enable target, compact entry and brush cursor |
| `test/map-fog.js` | Mask geometry, malformed input, permissions, stale edits, bounded/rate-limited undo and save/load regression tests |
| `test/piece-visibility.js` | Real reflected schema delivery for public/hidden board fog and state changes |
| `test/backend-interaction-policy.js` | Include the production fog registration in capability/gating tests |
| `test/input-router.js` | Verify fog consumes pointers/keys and suppresses conflicting gestures |
| `scripts/component-parity.mjs` | Real browser control/texture, keyboard focus, cancellation, acknowledgment ordering, scale, role, transform/disposal and compact layout checks |
| `scripts/input-test.mjs` | Verify tool arrow commands reach the brush before axis timers |
| `CHANGELOG.md`, `docs/ARCHITECTURE.md`, `docs/REFERENCE.md`, `docs/GESTURES.md` | Record behavior, protocol, storage, input and upgrade contracts |
| `docs/ROADMAP.md`, `docs/DESIGN_future_backlog.md`, `docs/DESIGN_concealment.md` | Track manual fog separately from completed object hiding and deferred auras |

### Slice 2 verification and gameplay handoff

- `npm run check`: lint, formatting and CSS checks passed; 864 runtime tests passed.
- `npm run test:input`: 58/58 passed, including tool-key precedence over object/camera axes.
- `npm run test:devices`: all 7 profiles passed.
- `npm run test:components`: desktop and coarse-390 passed, including real client bootstrap,
  fog texture/controls and unobstructed sheet buttons. Notecard checks passed at 1280px mouse,
  390px touch and 360px touch. Existing fixture thumbnail derivative 404s exercised fallbacks.
- Separately rendered and visually inspected the final fog mask and controls at 1280px and
  390px. Corrected sheet stacking over floating controls, checkbox sizing and pane typography.
- `git diff --check`, changed-file path references and final script formatting/lint passed.

No database query or migration changed, so the database integration suite is not required.
The user reports the original manual fog slice works well; specific devices/scenarios were not
itemized. The user subsequently approved the volume/thickness correction for commit. Automated tests do not establish gesture
feel or GPU performance.

**Restart the server and refresh all clients.** No migration, new dependency or infrastructure.

1. Join as GM and player, load a flat image board, enable fog, and paint reveal/cover paths at
   several radii. Confirm opaque player coverage and translucent GM coverage, with pieces intact.
2. Try Undo, Cover all, Reveal all, disable/re-enable and local Player fog preview. Open/close the
   panel; test Done/Escape and return to camera movement. Check two GMs making overlapping edits.
3. Save/reload the scene, reconnect, and restart the server. Confirm exploration/enable state
   survives; replacing the board does not inherit the previous board's fog.
4. Try mouse, real touch drag/tap, second-finger cancellation, keyboard arrows/Enter/Space and
   compact controls. Demote/time out the GM mid-stroke and confirm painting stops without a commit.
5. Hide/reveal the map itself. Confirm the existing server visibility boundary still applies and
   that showing a map does not reveal independently hidden monsters or props.

### Historical height and 3D-board follow-up (superseded)

The user approved the labeled height slider (Surface → Higher) and `cloud-fog` entry. Desktop,
compact and touch layouts share the same labeled native range control and room-unit readout.
Height is an added offset above the board’s shared top bound, 0–64 world units in 0.05-unit
steps. Flat boards preserve their outline; model/procedural boards use the shared bounding
footprint. This is a raised sheet: terrain above it remains visible and low camera angles can
see underneath. Physics and independently hidden pieces are unchanged.

The existing fog modules, geometry definitions, revision handling, undo history and persistence
are extended. No parallel height service or new schema field is needed. Moving the slider
previews locally; releasing/changing it commits one undoable edit. Brush picking follows the
raised sheet. Older fog saves default to zero added height, preserving their original appearance.

| File | Functions/contracts changed in this follow-up |
| --- | --- |
| `shared/map-fog.js` | Extend `MAP_FOG`, `fogBoardSize`, `emptyFog`, `normalizeFog` for shared board bounds, bounded height and legacy defaults |
| `server/game/map-fog.js` | Extend `registerMapFog` with validated height edits and existing undo/save handling |
| `public/table/map-fog.js` | Extend `build`, `sync`, `hitPoint`, `refreshControls`, `bindControls`, `exit` and error cleanup for raised geometry, brush alignment, slider preview and cancellation |
| `public/table.html` | Approved height slider/readout/hint, cloud-fog entry and in-app help |
| `public/styles.css` | Add shared-token `.fogHeightLabels` layout |
| `scripts/build-icons.mjs`, `public/index.html`, `public/admin.html`, `public/table.html` | Register cloud-fog and regenerate all shared sprites |
| `docs/ASSET_CREDITS.md` | Update the Tabler usage count and record cloud-fog under the existing MIT attribution |
| `test/map-fog.js` | Add height validation, permissions/stale rejection, undo/mask preservation, legacy default and 3D save/load checks |
| `scripts/component-parity.mjs` | Add real slider/unit/ack/error/cancellation checks, raised brush intersection and model bounds tests |
| `CHANGELOG.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/GESTURES.md` | Document storage/API, rendering, input and upgrade contracts |
| `docs/ROADMAP.md`, `docs/DESIGN_future_backlog.md`, `docs/DESIGN_concealment.md` | Record prior user manual pass and separate follow-up verification |

Follow-up verification:

- `npm run check`: lint, formatting and CSS checks passed; 865 runtime tests passed. The first
  sandboxed attempt could not run socket-dependent tests; the permitted rerun passed.
- `npm run test:input`: 58/58 passed. `npm run test:devices`: all 7 profiles passed.
- Desktop and 390px touch fog controls passed, including raised brush targeting and scrolling to
  every control in the taller panel and retaining slider focus while waiting for a save. The initial test assumed every button was visible at once;
  it now verifies reachability through the existing scrollable sheet.
- `npm run test:components`: final desktop/coarse-390 suite passed, including slider focus
  retention during saves. Notecard checks passed at 1280px mouse, 390px touch and 360px touch.
  Existing fixture thumbnail derivative 404s exercised fallbacks.
- Regenerated all three sprites; only cloud-fog was added, with existing glyphs unchanged.
- Inspected desktop/390px screenshots. Changed-script lint/format and `git diff --check` passed.
- No database query/migration changed; integration tests are not applicable. Manual testing of
  this follow-up remains pending.

After restarting the server and refreshing clients, try raising/lowering fog over a 3D board,
painting at an angled camera view, Undo, save/reload, and a second client. Check the slider with
mouse, keyboard and real touch, including compact mode. Exploration should remain unchanged
when adjusting height; undo should restore height independently of a prior brush stroke.

### Approved closed-volume correction

The user clarified that fog must have adjustable thickness and prevent low-angle views underneath.
They approved **Fog thickness** with **Thin → Thick** endpoints; the cloud-fog entry remains.
The raised-sheet implementation above is superseded. The user separately reports this correction looks good and approves committing it. Specific
devices and multiplayer scenarios were not separately itemized.

Covered areas now have masked top and bottom caps, exterior walls and walls around every revealed
opening. The base stays just below the board’s shared bottom bound. The top extends 0–64 world
units above its shared top bound in 0.05-unit slider steps. Thus zero extra thickness still encloses
the board itself; increasing thickness covers taller terrain. Reveals cut through the full volume.
Player fog and player preview are opaque and write depth. GM fog remains translucent. Physics,
object Hide/Reveal and the stored exploration mask keep their existing ownership and behavior.

The controller reuses shared board geometry and the existing mask for both caps. A focused browser
geometry helper emits only boundary-wall quads, merges collinear runs and clips them to authored
convex outlines. Wall geometry is rebuilt when mask bytes change, and scaled for thickness changes.
Caps share geometry/material/texture and are disposed once; walls have separate owned resources.
Native slider input, keyboard focus during saves, permissions, revisions, undo and persistence
reuse the previous implementation. Canonical saves use `thickness`; old `height` values migrate
without losing masks. Records with neither dimension default to zero extra thickness.

| File | Functions/contracts changed in this correction |
| --- | --- |
| `public/table/map-fog-volume.js` | New `fogWallPositions`: merged cell boundaries, convex clipping and masked perimeter walls |
| `public/table/map-fog.js` | Extend `build`, `updateTexture`, `sync`, `remove` for caps/walls, mask caching, opacity/depth and disposal; rename slider/preview/cancellation bindings to thickness |
| `shared/map-fog.js` | Rename thickness constants/state; `normalizeFog` migrates legacy height records and validates bounds |
| `server/game/map-fog.js` | `registerMapFog` accepts validated thickness edits using existing shared undo/save path |
| `public/table.html`, `public/styles.css` | Approved thickness label, Thin/Thick endpoints, volume hint/help, and matching control IDs/classes |
| `test/map-fog.js` | Adapt edit/undo/save tests and verify legacy height migration |
| `test/map-fog-volume.js` | Low-angle exterior/reveal-hole rays, fully revealed removal, thickness scaling, fitted-outline clipping and winding regressions |
| `scripts/component-parity.mjs` | Production volume ownership/depth/scaling checks and real WebGL pixels for outside, reveal-hole and underside occlusion, plus unobstructed reveal openings |
| `CHANGELOG.md`, `docs/ARCHITECTURE.md`, `docs/REFERENCE.md`, `docs/GESTURES.md` | Current storage, rendering, input and upgrade contracts |
| `docs/ROADMAP.md`, `docs/DESIGN_future_backlog.md`, `docs/DESIGN_concealment.md` | Separate original manual pass from the user-approved correction and its verification record |

Verification:

- `npm run check`: lint, formatting and CSS checks passed; 867 runtime tests passed.
- `npm run test:input`: 58/58 passed. `npm run test:devices`: all 7 profiles passed.
- `npm run test:components`: desktop/coarse-390 passed, including low-angle exterior, reveal-hole
  and underside WebGL pixel occlusion, visible revealed openings, depth/material ownership,
  thickness scaling, disposal, focus and scroll access. Notecard checks passed at 1280px mouse,
  390px touch and 360px touch. Existing fixture thumbnail 404s exercised expected fallbacks.
- Focused desktop/390px renders had no browser errors; inspected both screenshots. Ray tests
  cover convex outline clipping, winding and removal of walls after full reveal.
- `git diff --check` and documentation link checks passed. No database queries/migrations changed.
- The user reports the result looks good and approves committing this correction. Specific
  multiplayer/real-device scenarios were not itemized; automated checks do not certify GPU
  performance or touch feel on physical devices.

Restart the server and refresh all clients. In opaque player preview and on a second player client,
look across a covered board at a low angle, then reveal a hole and look toward its covered edge.
Adjust thickness, undo, save/reload, and verify that exploration remains intact and the bottom
never rises. Check mouse, keyboard and real touch; GM translucency should remain available.

## Slice 3: piece reveal auras

The user approved the full/compact/touch mock-up and recommended Tabler **circle** entry on
2026-09-28. The existing sprite already contains that icon; no new bundled asset was needed.

Active GMs choose **Fog aura…** from piece actions, enable revealing and set a radius in room
units. Apply saves; Cancel/Escape discards drafts. A local ring follows the piece on the fog top
while editing. Access loss, removal, room handover and scale changes close the editor. The
shared dialog owns focus return/trapping, while native fields retain keys without table actions.
Ordinary piece/group movement, including physics movement, reveals continuous circular paths.
No additional input gesture, wall detection, scoring or character rules were added.

Auras reuse the fixed map mask and circle/capsule rasterizer. The server samples final published
physics positions every tick, preserving turns between normal 100 ms mask publications. Pending
paths are bounded to 256 points and flush early at the cap. Stationary sources do not rewrite
masks. Hidden/disabled sources, hidden/disabled boards and replacements break path continuity.
Resuming reveals the current circle without connecting across paused movement. Fog thickness
continues to affect rendering only; reveals cut through the whole mask depth.

The versioned aura setting is attached to the original tabletop piece, saved beside its transform,
and delivered through its visibility view. Old saves start without auras; invalid settings fail
before scene clearing. Boards, mats and personal tray dice cannot emit auras. Taking a piece into
a hand, consuming it into inventory or spawning a derivative does not transfer its aura identity.
Explicitly hidden objects remain hidden even when the surrounding terrain is explored.

Automatic reveals advance the shared fog revision but do not occupy manual undo slots. Manual
Cover/Undo discards queued paths and is retained until the next source movement. Undo restores
an older manual snapshot, including its earlier coverage; it does not disable aura settings.
Movement during a manual brush stroke may cancel that stroke through existing revision handling;
pause the relevant aura to make a stable manual edit. Saved/reloaded active auras resume by
revealing their current circles, with no old movement replay.

### Changed files and functions

| File | Functions/contracts added or changed |
| --- | --- |
| `shared/fog-auras.js` | New `FOG_AURA`, eligibility, normalization/parser and inverse-board projection |
| `server/game/map-fog.js` | Extend `registerMapFog` with guarded `setFogAura` and returned `updateAuras`; bounded paths, source resets and shared-mask publication |
| `server/game/schema.js` | Append `Piece.fogAura` |
| `server.js` | Store fog service during initialization and update auras after `publishTransforms` |
| `server/game/scene-persistence.js` | `serializeScene`/`applyScene` persist, preflight and restore aura settings |
| `server/game/piece-visibility.js` | Include aura configuration in source-ID access checking |
| `shared/room-capabilities.js` | Classify `setFogAura` as gameplay |
| `public/table/fog-auras.js` | New editor controller: `edit`, `update`, `close`, `bindRoom`, `isActive`; local ring ownership, acknowledgment/state coordination and lifecycle cleanup |
| `public/table/piece-ui.js` | `pieceMenuItems` adds approved GM aura entry through injected `editFogAura` |
| `public/table/table-shell.js` | `bindControls` registers aura dialog; `enhanceNumberInputs` supports bounded arbitrary-decimal +/− stepping and guards disabled/read-only fields |
| `public/client.js` | Compose/bind/update aura controller, close on participation loss and include in modal input gate |
| `public/table.html` | Approved editor controls, accessible status and in-app help |
| `public/styles.css` | Keep aura controls readable and touch-usable with shared tokens; retain a visible checkbox check mark |
| `test/map-fog.js` | Configuration/access, geometry, sampled motion, publication rate, undo, pause/replacement and persistence regressions |
| `test/piece-visibility.js` | Real reflected schema initial/patch delivery of hidden/visible aura sources |
| `scripts/component-parity.mjs` | Real browser editor, radius preview, scale, state/error ordering, focus, lifecycle, compact/touch layouts and menu routing/icon checks |
| `CHANGELOG.md` | Record aura behavior and restart/refresh requirement under Unreleased |
| `docs/ARCHITECTURE.md`, `docs/REFERENCE.md` | Document ownership, public schema, protocol, persistence and update ordering |
| `docs/GESTURES.md` | Desktop/touch/keyboard entry and manual/automatic fog interaction |
| `docs/ROADMAP.md`, `docs/DESIGN_future_backlog.md` | Mark auras implemented and record the subsequent user-reported test pass |
| `docs/DESIGN_concealment.md` | Approved design, implementation record and verification handoff |

### Slice 3 verification and handoff

- `npm run check`: lint, formatting and CSS validation passed; 874 runtime tests passed.
  The sandboxed attempt encountered local environment restrictions in six existing asset-related
  test files; the full run outside that sandbox passed.
- `npm run test:input`: 58/58 passed.
- `npm run test:devices`: all seven profiles passed.
- `npm run test:components`: desktop and coarse-390 passed, plus notecard checks at 1280px mouse,
  390px touch and 360px touch. Existing fixture thumbnail derivative 404s exercised fallbacks.
- Final targeted browser assertions covered the refined aura dialog at 1280, 390 and 360px,
  plus updated desktop/touch menu routing, long-menu fallback and circle icon. Rendered desktop
  and phone screenshots were inspected; typography and checked-state visibility were corrected.
- Final lint, formatting, CSS validation and `git diff --check` passed after those refinements.

The user reported "Works great" and approved committing the aura slice and stepper fix on
2026-09-28. Specific devices and individual scenarios were not itemized; this does not certify
every multiplayer, real-device gesture or GPU-performance scenario below. No database query
or migration changed; integration tests are not required.

**Restart the server and refresh all clients.** No migration, dependency or infrastructure change.

1. As GM, configure a miniature/token aura, preview different radii and Apply. Move it as an
   ordinary player with mouse/touch and group movement; confirm both clients see persistent trails.
2. Use a non-square and a 3D board; change fog thickness, board scale display and aura radius.
   Check bends in a dragged path and preserved coverage when the piece leaves the board.
3. Hide the source, move it, reveal it; disable/re-enable the aura and fog. Check no connecting
   reveal through paused movement, and no exposure of independently hidden monsters/props.
4. Cover/Undo while sources are stationary, then move them again. Try concurrent GM edits;
   confirm stale drafts fail clearly and previous exploration behaves as documented above.
5. Save/load, reconnect and restart. Verify radius/enable state and exploration, including disabled
   auras. Try Cancel/Escape, compact mode, keyboard focus, touch long-press and demotion mid-edit.

### Slice 3 follow-up: radius stepper

The user reported `InvalidStateError` from `HTMLInputElement.stepUp`. The radius uses `step="any"`
to preserve arbitrary decimal radii after room-unit conversion, while shell-generated +/− buttons
unconditionally used native stepping, which rejects `any`. Extend that existing stepper with
bounded arithmetic for this mode and retain native behavior for fixed-step fields. The aura input
declares a 0.25 display-unit button increment; disabled/read-only fields do not change.

The browser fixture now calls the production shell `prepare()` before opening the aura editor,
and clicks its actual generated buttons. It covers both directions, arbitrary decimals, current
min/max, empty values, disabled/read-only guards and the existing fixed-step brush field. This
also corrects the earlier test gap: the original fixture edited the bare input directly.

Changed for this fix: `public/table/table-shell.js` (`enhanceNumberInputs`), `public/table.html`
(radius increment), `scripts/component-parity.mjs` (production stepper regression), `CHANGELOG.md`,
`docs/REFERENCE.md` and this record. Client refresh is sufficient; no server restart is needed.
Follow-up verification: `npm run check` passed (874 runtime tests plus lint/format/CSS checks),
`npm run test:input` passed 58/58, and `npm run test:components` passed desktop/coarse-390 and
all three notecard profiles. The updated regression failed before the fix and passed after it.
Separate final browser assertions passed at 1280, 390 and 360px; the rendered phone stepper was
visually inspected. `git diff --check` passed. No responsive-layout rule or server code changed.

### Concealment follow-up: suspended hidden drops

The user reported that a hidden object remained at drag height after a grid-snapped drop.
`releasePiece` snapped X/Z, but hidden bodies deliberately receive no gravity and were parked
at that height. Extend the existing visibility service with `settleReleasedPiece`, called from
the common release path after snapping. It queries existing board/mat collider parts directly;
no parallel geometry definition or collision-enabled simulation is introduced. Single/group
release and square/hex/free placement share this correction. Arbitrary object stacking remains
subject to the existing conservative reveal-placement checks.

Files changed:
- `server/game/piece-visibility.js`: adds `settleReleasedPiece`, reusing `prepareBody` to stop
  release velocity and preserve hidden-body physics; publishes the corrected transform.
- `server/game/piece-lifecycle.js`: calls the service from `releasePiece` before absorption.
- `test/piece-visibility.js`: adds regressions through real single/group message handlers for
  square/hex/free drops, rotated compound boards and gaps, tabletop fallback, persistent parking,
  reveal, player-state exclusion and unchanged visible drops.
- `CHANGELOG.md`, `docs/ARCHITECTURE.md`, `docs/REFERENCE.md`, and this plan: document the fix,
  placement boundary, service contract and verification status.

Verification: `npm run check` passed (878 runtime tests plus lint, format and CSS checks).
The targeted visibility tests also passed, and `git diff --check` passed. Browser/component,
device and database suites were not rerun for this server-only physics correction.

The user reported "Works great" and approved committing this fix on 2026-09-28. Individual
devices and scenarios were not itemized. For future smoke testing, restart the server, then hide
and drop a snapping piece on a board; repeat with a group and off the board. Confirm pieces sit
on the surface, stay hidden from a player client, and can be revealed in clear positions. No
client module or input binding changed; no migration is required.
