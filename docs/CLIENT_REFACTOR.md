# Client decomposition plan

Status: complete; all 14 steps are implemented and manually verified.

Phase 1 is complete. Phase 2's whiteboard, measurement
overlay, and dice-tray controllers were extracted on 2026-09-22 and manually verified. The private
hand and inspection have also been extracted and manually verified. Phase 3 selection was
completed and manually verified on 2026-09-23. Player presence was also completed and manually
verified on 2026-09-23. Room settings and skybox were completed and manually verified on
2026-09-23. Phase 3 is complete. Phase 4 feature-specific bootstrap binders were completed and
manually verified on 2026-09-23. Step 13 input-router and piece-drag extraction is complete and
manually verified on 2026-09-23. Step 14 composition cleanup was completed and manually verified
on 2026-09-23. Manual smoke tests reported no regressions.

This document records the focused architectural sweep of `public/client.js` performed on
2026-09-21. The goal is to give the browser client the same kind of clear composition-root and
feature-module structure that the server gained during its breakup, while preserving current
behavior and avoiding a large rewrite.

## Original sweep and current boundaries

At the 2026-09-21 sweep, `public/client.js` was 7,650 lines with approximately 311 function
symbols and 150 variable symbols. Its size was only the visible symptom; it then performed
several different jobs:

- joins and reconnects to the Colyseus room;
- registers nearly every state listener and server-message handler;
- owns the client-side piece and interpolation stores;
- creates, replaces, and animates Three.js objects;
- owns feature state for inspection, hands, selection, overlays, whiteboard, trays, seats, and
  settings;
- interprets pointer and keyboard input for all those features; and
- implements generic dialog, sheet, cluster, drawer, and radial-menu behavior.

The existing smaller modules already demonstrate useful boundaries:

- `public/core.js` owns the core Three.js scene, camera, renderer, table, and visual settings.
- `public/graphics.js` owns mesh and texture construction.
- `public/controls.js` translates raw input-device events into device-independent intents.
- `public/rows.js` builds reusable DOM rows from data and callbacks.
- `public/icons.js` owns shared icon and overflow-menu behavior.
- `public/table/piece-view.js` owns safe piece props, piece state listeners, shared mesh replacement,
  patch snapshots, interpolation, and current-mesh deck-height updates.
- `public/table/collider-debug.js` now owns the local diagnostic overlay and its preference.
- `public/table/ui-surfaces.js` owns reusable dialogs, sheets, clusters, drawer, and radial controls.
- `public/table/whiteboard.js` owns whiteboard placement, drawing, and room synchronization.
- `public/table/overlays.js` owns measurement shapes, previews, selection, and room synchronization.
- `public/table/trays.js` owns personal tray visuals, placement, camera travel, and controls.
- `public/table/hand.js` owns the private hand, its replay/messages, Show controls, sorting, and card gestures.
- Chat, notebook, scoreboard/room notes, timer, membership, and library responses each have focused
  feature modules and binders under `public/table/`.
- `public/table/presence.js` owns seats and camera framing, public fans, player markers, held-piece
  labels, roster/turn presentation, avatar controls, and player room bindings.
- `public/table/room-settings.js` owns table/grid presentation, scale and lighting controls,
  local lighting drafts, graphics-quality UI, and settings room bindings.
- `public/table/skybox.js` owns background texture loading, replacement/disposal, and local resolution.
- `public/table/selection.js` owns local selection, marquee gestures, highlight rings, batch actions,
  recoloring, and compose/gather planning.
- `public/table/inspection.js` owns enlarged previews, their appearance controls, drawn-card
  placement, deferred double-clicks, and pointer rotation.

Step 14 completes the ownership split with table-shell composition, personal preferences, dice
defaults, piece feedback, and visual effects. `client.js` now coordinates these controllers.

## Target architecture

Create a `public/table/` directory for table-client feature modules. This mirrors the server's
`server/game/` organization and avoids adding another dozen unrelated files to the root of
`public/`.

Implemented shape:

```text
public/
  client.js                 browser composition root
  core.js                   Three.js scene and renderer
  graphics.js               mesh and texture builders
  controls.js               device events -> input intents
  table/
    piece-view.js           live meshes, replacement, snapshots, interpolation
    collider-debug.js       local diagnostic collider visualization
    hand.js                 private hand controller
    inspection.js           enlarged object inspection
    overlays.js             measurement overlays
    whiteboard.js           whiteboard placement and drawing
    trays.js                dice-tray rendering and camera transport
    selection.js            local multi-selection and batch actions
    presence.js             seats, public hands, markers, roster, and turn display
    room-settings.js        table/grid/lighting settings and graphics-quality UI
    skybox.js               background textures and local sky resolution
    chat.js                 public message replay, unread state, and send controls
    notebook.js             private notes replay and debounced edits
    scoreboard.js           scores, shared room notes, and edit affordances
    timer.js                shared-anchor display and timer controls
    membership.js           member lists, pending indicators, unclaimed-hand assignment
    library-bindings.js     asset lists/errors and Save Table feedback
    ui-surfaces.js          dialogs, sheets, clusters, drawer, and radial primitives
    input-router.js         semantic pointer and keyboard routing
    piece-drag.js           piece gestures, transforms, throws, and dealt-response adoption
    piece-ui.js             contextual guide, hover counts, piece menus, and hold controls
    effects.js              pings, shuffle animation, landing marker, and board-surface cache
    dice-preferences.js     local dice defaults and shared finish-picker data
    preferences.js          audio/theme controls, settings/help tabs, tracks, and credits
    table-shell.js          table-specific dialogs, clusters, drawer, roster/hand surfaces
```

These should use explicit factory dependencies, following the server's `create...` and
`register...Handlers` pattern. A feature should not import a mutable singleton room or a general
"client context" service locator.

For example:

```js
const hand = createHandController({
  room,
  scene,
  camera,
  inspectCard: inspection.inspectHandCard,
  syncControlGuide,
});

hand.bindRoom();
```

The exact API should be allowed to emerge during each extraction. The important constraints are
clear state ownership, explicit dependencies, and narrow callbacks between features.

## Recommended modules and boundaries

### 1. Piece view and mesh lifecycle

Start around the mesh-replacement functions near `public/client.js:3934`.

Move or consolidate:

- `meshPropsOf`;
- `rebuildCard`;
- `rebuildPiece`;
- `rebuildDeck`;
- their common remove/build/configure/restore/add/replace sequence;
- `snapshot`, `applyTransform`, and `sample`; and
- eventually ownership of `meshes`, `buffers`, and cached board-drop surfaces.

The three rebuild functions currently repeat scene removal, mesh construction, shadow and ID
configuration, buffered-transform restoration, scene insertion, entry replacement, and collider
debug refresh. Their real differences must remain explicit:

- an inspected piece's table mesh stays hidden;
- a procedural deck reapplies its count-based height;
- type-specific mesh builders and physics shadow policy differ.

Begin with a shared replacement helper that accepts those differences as hooks or options. Do not
immediately hide every mesh map behind a new abstraction; map ownership can move after callers are
stable.

This boundary is compatible with the custom collider builder. Mesh replacement should call an
injected collider-debug refresh hook, while collider construction remains authoritative in the
existing shared collider-spec path.

Also consolidate the repeated piece-property parsing in `pieceSnap`, `pieceCells`, and
`pieceIsTile` behind one safe property accessor owned by this feature. These small helpers do not
need separate modules.

### 2. Collider diagnostics

The collider-debug block near `public/client.js:424` is a self-contained, local-only feature.

Move:

- debug-group ownership;
- `disposeColliderDebug`;
- `colliderDebugGroup`;
- `refreshColliderDebug`;
- `syncColliderDebug`;
- `setColliderDebugWanted`; and
- its local-storage preference.

Inject the scene, piece lookup, mesh lookup, rank lookup, and `colliderSpec`. The resulting API can
be small: `refresh(id, piece)`, `remove(id)`, `sync()`, `setEnabled(on)`, and `dispose()`.

### 3. Private hand

The private-hand subsystem begins near `public/client.js:4002`; `renderHand` alone spans roughly
167 lines and has many call sites.

It now lives in `public/table/hand.js`; `client.js` forwards private-hand messages and supplies
room, inspection, scene, pointer, and control-guide dependencies. The inventory below records the
original extraction scope.

Move the state and behavior together:

- `myHand`, selection, reveal, reorder, drag, hover, and collapse state;
- rendering and collapse persistence;
- drag-out and drop-preview behavior;
- hand-card inspection entry;
- Show selection and rearrangement mode;
- reorder commits and sorting; and
- hand-specific pointer hooks.

Expose operations such as `setCards(cards)`, `setRevealed(...)`, `cancelGesture()`, `render()`, and
the small pointer methods needed by the input router. Inject room sends, inspection, scene access,
and control-guide updates.

### 4. Inspection

The inspection subsystem originally began near `public/client.js:3127`. It now lives in
`public/table/inspection.js`; `client.js` forwards room messages and semantic input to it.

Move:

- `inspect` and pending-click state;
- `inspectMesh`;
- inspect swapping, tinting, entering, releasing, and cancellation;
- color, team, and finish-control setup; and
- inspection-specific pointer rotation.

Inspection interacts with the hand and piece view, but neither should reach into the other's
internal variables. The hand should request inspection through a callback; the piece view should
only be asked to hide or reveal the original table mesh. The hand now calls the injected inspection
callback, and inspection asks piece view to change original-mesh visibility.

### 5. Measurement overlays

The overlay subsystem begins near `public/client.js:4952`.

Move:

- overlay object and selection maps;
- measure mode and drag state;
- overlay construction, picking, selection rings, and previews;
- add, move, remove, and permission checks; and
- overlay state/message bindings.

The module should receive the shared overlay registry and room send function. It should expose
semantic input methods rather than raw DOM event handlers.

### 6. Whiteboard

The whiteboard subsystem spans the placement block near `public/client.js:5264` and drawing block
near `public/client.js:5480`.

Move all `wb*` state and functions together, including:

- mesh creation and track placement;
- enable/style/slide/owner synchronization;
- claim and release;
- stroke rendering and drawing gestures;
- tool-button/status synchronization; and
- remote holder labels.

This is one of the cleanest controller boundaries because its state is already consistently
prefixed and its server protocol is distinct.

### 7. Dice trays

The tray subsystem begins near `public/client.js:5353`.

Move:

- tray-group ownership and synchronization;
- track placement;
- personal tray lookup;
- camera travel to and from the tray; and
- tray-specific actions.

Keep this separate from the whiteboard even though both occupy the circular track. Sharing a
placement calculation is reasonable; sharing feature state is not.

### 8. Local selection

The selection subsystem now lives in `public/table/selection.js`. The client forwards semantic
selection input, removes stale IDs on piece removal/remote grabs, and updates highlights in the
render loop. Compatibility and planning helpers operate on plain piece data for direct testing.
Pointer capture, camera-control arbitration, and input priority now belong to the input router.

The extraction moved:

- selection, mode, marquee, and highlight-ring state;
- selection signatures and compatibility checks;
- compose and gather planning;
- batch recoloring and team switching;
- selection-toolbar synchronization; and
- marquee gesture handling.

The eligibility and planning functions now have direct unit coverage on plain piece data.
Controller tests cover selection gestures, batch commands, and ring cleanup; component parity
checks the real selection toolbar in desktop and touch layouts.

### 9. Player presence

The presence subsystem now lives in `public/table/presence.js`. `createPresence` owns local seat
and visual state, player/turn listeners, and the Show-fan message binding. The client supplies
callbacks for private-hand reveal data, local role changes, hydration, unclaimed hands, and
overlay cleanup. Table resizing still coordinates presence, whiteboard, and trays in the client;
member administration, general role gates, and Lean In remain there as well.

The extraction moved:

- seats and seat-camera framing;
- public hand fans;
- avatars and name markers;
- held-piece labels;
- turn presentation;
- player roster rendering; and
- the small pieces of role-driven presentation that belong to players.

Do not let this become a dumping ground for all authorization-aware UI. Table settings and member
administration can remain distinct even if they both read `myRank`.

### 10. Room settings and skybox

The table customization boundary now lives in `public/table/room-settings.js` and
`public/table/skybox.js`. `createRoomSettings` owns:

- table shape and rim UI;
- grid visualization and calibration;
- scale-panel synchronization;
- lighting controls;
- graphics-quality synchronization.

Its `bindRoom`, `hydrate`, and `bindControls` methods reuse core rendering, shared lighting/board
policy, and existing server messages. Cross-feature effects stay explicit callbacks: seat/tray/
whiteboard placement after table resizing, overlay relabeling, and whiteboard settings hydration.

`createSkybox` independently owns loading, resolution selection, replacement, and cleanup through
`sync` and `bindControls`. The client publishes its `BUILTIN_SKIES` catalog for the existing library
picker. A request version rejects late callbacks after switching Off, changing resolution, or
returning to the same sky, fixing a race reproduced by regression tests. No server schema or
message changes are involved. Unit and desktop/touch component coverage exercise both controllers;
manual verification reported no regressions.

### 11. Reusable UI surfaces

The generic responsive UI block begins around `public/client.js:6658`.

Move generic mechanisms such as:

- dialog focus restoration, Escape handling, and modal focus trapping;
- sheet stops, dragging, opening, and cleanup;
- shared-region clusters;
- radial-menu behavior;
- drawer behavior; and
- possibly hold-repeat button behavior.

Application-specific wiring should remain in a thin table-shell setup function or in the client
composition root. Avoid expanding `icons.js` into a general UI framework simply because it already
contains action-sheet and popover code.

These utilities should be added to the component-parity harness as they move.

### 12. Input router

Extract the semantic input router last.

The highest-complexity functions at the original sweep were:

| Function | Approximate range | Cyclomatic | Cognitive |
| --- | ---: | ---: | ---: |
| `onPointerMove` | 3523-3717 | 34 | 77 |
| `renderHand` | 4265-4431 | 33 | 75 |
| `endGesture` | 3718-3808 | 29 | 63 |
| `onKeyDown` | 3819-3932 | 31 | 57 |
| `inspectMesh` | 3138-3260 | 19 | 50 |

Step 13 extracts `createInputRouter` into `public/table/input-router.js`. It returns the existing
intent vocabulary consumed by `attachControls` and the on-screen hold buttons. Device translation
and repeat timing stay in `public/controls.js`; the router owns mode priority, Escape/typing guards,
long-press routing, axis targeting, and camera-pan gating through explicit controller dependencies.

Move routing preserves the original order: selection marquee, measurement, whiteboard drawing,
inspection, overlay movement, then piece drag. Press and release retain their own existing order.
Escape checks tray, selection, measure, whiteboard, inspection, then overlay selection before the
typing guard; drawn-card placement and ordinary commands remain below that guard.

To make the router a dispatcher, `createPieceDrag` in `public/table/piece-drag.js` owns the related
piece state and behavior together: press classification, armed menu Move, grab/deal/dispense,
`dealt` adoption or late release, group movement, grid targets, rotation, touch re-anchoring, and
throw estimation. It reuses `clickRoute`, `reanchorOffset`, shared snapping, and piece-property
readers. `current()` exposes a small copied gesture summary for the guide and landing marker;
mutable gesture internals stay private. Step 14 moves menus to `piece-ui.js`. The root retains
raycast helpers, camera pan math, the shared hand/drag projection scratch, and frame ordering,
and constructs the drag controller before the first render.

Regression tests exercise routing priority and actual piece gestures; browser component checks
also import the production composition root, first holding join pending to check startup and then
completing a simulated join to exercise controls in desktop and touch layouts. This does not replace
live-room/manual gesture verification. No gesture mappings, protocol messages, or server authority change.

## Room bootstrap and message bindings

At the original sweep, the async bootstrap block around `public/client.js:751` was roughly 1,800
lines and mixed joining with feature state, messages, and controls. Step 12 now delegates piece
state to `pieceView.bindRoom`/`recordState`; private hand and drawn-card messages to `hand.bindRoom`
and `inspection.bindRoom`; and chat, private notes, scores/room notes, timer, membership, and asset
responses to focused feature modules. Existing presence, overlays, whiteboard, and settings binders
remain in their original high-level order.

Handlers precede `handSync`, `chatLog`, `notebookSync`, and `listDice` replay requests; library
response routing is installed before the editor-panel handoff. The root still registers session
errors, notices, admin identity, and exits, and coordinates patch delivery in the same order:
piece snapshots, whiteboard, trays, then skybox. Cross-feature piece-removal effects remain
explicit injected callbacks. Step 13 moves `dealt` registration into `pieceDrag.bindRoom`. Step 14
moves `bindPings` and `bindTableEffects` into the effects controller with their visual state, and
moves shell controls and personal preferences into focused modules. The root still calls every
binder in the explicit high-level order.

This is an ownership refactor: no message, saved-state, privacy, or server authorization changes.
Regression coverage exercises replay ordering, piece lifecycle/cleanup, library responses, notes
debouncing, and the actual desktop/touch panels. Manual testing reported no regressions.

Do not replace this with one large `network.js`; that would only move the monolith.

Each feature controller should register its own narrow state and message bindings, or export a
feature-specific registration function:

```js
const hand = createHandController(deps);
const whiteboard = createWhiteboardController(deps);

registerPieceBindings(room, pieceView);
hand.bindRoom(room);
whiteboard.bindRoom(room);
```

`client.js` should retain:

- room join and reconnect;
- controller construction;
- the high-level binding order;
- top-level loading, error, and exit handling; and
- render-loop orchestration.

## What should remain in `client.js`

The goal is a composition root, not an empty file. The following responsibilities belong at the
top level:

1. Import shared infrastructure and controller factories.
2. Join or reconnect to the room.
3. Construct controllers with explicit dependencies.
4. Connect feature controllers to room state and one another.
5. Start the render loop.
6. Handle fatal bootstrap failures and room exit.

The animation loop should remain visible here because it sequences interpolation, cosmetic
animation, drag previews, selection highlights, camera controls, rendering, and performance
instrumentation. The interpolation mechanics can move into `piece-view.js`, but the frame order is
important architecture, just as `world.step` deliberately remains visible in the server update
loop.

Step 14 leaves an approximately 900-line `client.js`, down from 7,650 at the original sweep.
The endpoint is ownership, not a line quota: the root retains shared mesh/buffer maps, room/session
identity, role orchestration, raycast/camera adapters, the loading gate, errors/exits, controller
construction, binding order, and the visible render sequence.

The final boundaries are:

- `createTableShell` owns local panel layout and toast state and composes existing `ui-surfaces`
  primitives into dialogs, clusters, drawer proxies, seat/room-info surfaces, and the hand tab.
  The roster and room-info content remain live nodes, borrowed and returned on close.
- `bindPreferences` wires local audio, theme, settings/help tabs, credits, and track controls;
  `audio.js` still owns playback. `createDicePreferences` owns persisted defaults and uploaded
  finish-picker data, supplying the same callbacks to inspection and tray controllers.
- `createPieceUi` owns menus, hover counts, the contextual guide, and hold-button visibility;
  `pieceDrag` still owns gestures. Move transfers capture before the menu closes.
- `createTableEffects` owns pings, shuffle animations, the landing marker, and cached board collider
  surfaces. The root calls each update at its prior frame position and invokes surface cleanup
  on piece removal. Shared collider builders and server physics remain unchanged.

Regression coverage completes a simulated production join, exercises shell/live-node controls,
personal preferences and finish replay, and verifies piece menus, ping disposal, shuffle expiry,
and landing heights after board-prop changes/removal. The final manual smoke tests were reported
green on 2026-09-23.

## Avoid these failure modes

- Do not create a generic `utils.js` dumping ground.
- Do not move functions while leaving all their mutable state in `client.js`.
- Do not let feature modules import a global mutable `room` singleton.
- Do not create circular imports between hand, inspection, selection, and input.
- Do not combine whiteboard and trays merely because they share the same placement track.
- Do not combine every room listener into a new networking monolith.
- Do not extract tiny one-use helpers solely to reduce line count.
- Do not mix behavioral changes into extraction commits unless a verified bug requires it.

No convincing dead functions were found during the sweep. A few graph-orphaned local callbacks
are attached through DOM APIs and are genuinely used.

## Recommended implementation sequence

### Phase 1: low-risk foundations

1. Consolidate mesh replacement and interpolation helpers in `piece-view.js`. **Completed
   2026-09-22.**
2. Extract collider diagnostics. **Completed 2026-09-22.**
3. Extract generic dialog and responsive-surface primitives. **Completed 2026-09-22.**

### Phase 2: cohesive feature controllers

4. Extract whiteboard. **Completed 2026-09-22.**
5. Extract overlays. **Completed 2026-09-22; manually verified on a 3D board with a tall custom
   collider.**
6. Extract trays. **Completed 2026-09-22; manually verified.** Follow-up tray collision-height
   tuning and non-overlapping Scoop placement were also manually verified.
7. Extract hand. **Completed 2026-09-22; manually verified.**
8. Extract inspection. **Completed 2026-09-23; manually verified.**

### Phase 3: broad state owners

9. Extract selection. **Completed 2026-09-23; manually verified.** `npm run check`,
   `npm run test:input`, and `npm run test:components` pass. The user reported no regressions
   during manual smoke testing.
10. Extract player presence. **Completed 2026-09-23; manually verified.** `npm run check`,
    `npm run test:input`, and `npm run test:components` pass. Manual tests reported no regressions.
11. Extract room settings and skybox. **Completed 2026-09-23; manually verified.**
    `npm run check` passes (598 tests); `npm run test:input` passes (57 checks), and
    `npm run test:components` passes in desktop and touch layouts.
    Manual smoke tests reported no regressions.

### Phase 4: composition cleanup

12. Split the bootstrap block into feature-specific room binders. **Completed 2026-09-23;
    manually verified.** `npm run check` passes (604 tests), `test:input` passes
    (57 checks), and `test:components` passes in desktop and touch layouts.
    Manual smoke tests reported no regressions.
13. Simplify and extract the input router. **Completed 2026-09-23; manually verified.**
    `createInputRouter` dispatches semantic intents; `createPieceDrag` owns piece gestures and
    `dealt` adoption. `npm run check` passes (622 tests), `test:input` passes (57 checks),
    and `test:components` passes in desktop and touch layouts, including production bootstrap.
    Manual smoke tests reported no regressions.
14. Reduce `client.js` to joining, composing, binding, and rendering. **Completed 2026-09-23;
    manually verified.** Shell, personal/dice preferences, piece feedback, and effects
    now own their state. `npm run check` passes (626 tests), `test:input` passes (57 checks),
    and `test:components` passes in desktop and touch layouts, including the production join,
    shell controls, piece feedback, and effect lifecycles.
    Manual smoke tests reported no regressions.

Make each numbered item its own cohesive change where practical. A feature can be split into two
commits when moving state and behavior together would otherwise produce an unreviewable diff.

## Verification strategy

For each extraction:

- run `npm run check`;
- run `npm run test:components` when DOM builders or UI surfaces move;
- run `npm run test:input` when input intent or routing code moves;
- add unit tests for newly isolated pure selection, planning, or property-parsing functions;
- verify the affected desktop and touch gestures manually;
- verify reconnect/state hydration when room bindings move; and
- verify collider diagnostics with default and custom colliders whenever mesh lifecycle or debug
  code changes.

High-risk smoke scenarios for the overall refactor are:

- grab, move, rotate, raise, flip, snap, and release individual pieces;
- multi-select, marquee, compose, gather, recolor, rotate, and delete;
- deal, draw, inspect, show, reorder, sort, and drop hand cards;
- create, move, and remove measurement overlays;
- claim, draw on, release, and remotely observe the whiteboard;
- enable, visit, roll in, clear, and leave a personal tray;
- join, reconnect, change seat, change role, and observe other players' public hands;
- change table shape, grid, scale, lighting, quality, and skybox; and
- use modal, sheet, drawer, cluster, and radial controls on desktop and touch layouts.

## Original starting recommendation (completed)

The sequence began with piece mesh replacement and collider diagnostics. They are already identified sources of
duplication, have explicit inputs and outputs, and can be extracted without first redesigning
input or room-state ownership. This creates the first stable controller interface that later hand,
inspection, selection, and render-loop work can depend upon.
