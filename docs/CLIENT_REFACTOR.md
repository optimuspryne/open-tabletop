# Client decomposition plan

Status: implementation in progress. Phase 1 is complete. Phase 2's whiteboard, measurement
overlay, and dice-tray controllers were extracted on 2026-09-22 and manually verified; the private
hand is next.

This document records the focused architectural sweep of `public/client.js` performed on
2026-09-21. The goal is to give the browser client the same kind of clear composition-root and
feature-module structure that the server gained during its breakup, while preserving current
behavior and avoiding a large rewrite.

## Current state

`public/client.js` is currently 7,650 lines and contains approximately 311 function symbols and
150 variable symbols. Its size is only the visible symptom. The deeper issue is that it currently
performs several different jobs:

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
- `public/table/piece-view.js` now owns safe piece props, shared mesh replacement, interpolation,
  and current-mesh deck-height updates.
- `public/table/collider-debug.js` now owns the local diagnostic overlay and its preference.
- `public/table/ui-surfaces.js` owns reusable dialogs, sheets, clusters, drawer, and radial controls.
- `public/table/whiteboard.js` owns whiteboard placement, drawing, and room synchronization.
- `public/table/overlays.js` owns measurement shapes, previews, selection, and room synchronization.
- `public/table/trays.js` owns personal tray visuals, placement, camera travel, and controls.

The remaining work continues this pattern: make `client.js` coordinate modules like these rather
than continuing to own their internal state and implementation.

## Target architecture

Create a `public/table/` directory for table-client feature modules. This mirrors the server's
`server/game/` organization and avoids adding another dozen unrelated files to the root of
`public/`.

Proposed shape:

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
    room-settings.js        table/grid/lighting/skybox settings
    ui-surfaces.js          dialogs, sheets, clusters, drawer, and radial primitives
    input-router.js         semantic pointer and keyboard routing
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

The inspection subsystem begins near `public/client.js:3127`.

Move:

- `inspect` and pending-click state;
- `inspectMesh`;
- inspect swapping, tinting, entering, releasing, and cancellation;
- color, team, and finish-control setup; and
- inspection-specific pointer rotation.

Inspection interacts with the hand and piece view, but neither should reach into the other's
internal variables. The hand should request inspection through a callback; the piece view should
only be asked to hide or reveal the original table mesh.

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

The selection subsystem begins near `public/client.js:5900`.

Move:

- selection, mode, marquee, and highlight-ring state;
- selection signatures and compatibility checks;
- compose and gather planning;
- batch recoloring and team switching;
- selection-toolbar synchronization; and
- marquee gesture handling.

The eligibility and planning functions are good candidates for direct unit tests because much of
their logic can operate on plain piece data without DOM or Three.js state.

### 9. Player presence

The broad presence subsystem starts around `public/client.js:4433` and continues through player
markers and roster rendering.

Move:

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

Group the related table customization controllers rather than leaving them mixed into room
bootstrap:

- table shape and rim UI;
- grid visualization and calibration;
- scale-panel synchronization;
- lighting controls;
- graphics-quality synchronization; and
- skybox loading, resolution selection, replacement, and cleanup.

`syncScalePanel` is already a substantial controller-sized function. Skybox texture lifecycle is
also internally cohesive and can be extracted independently if that produces a safer first step.

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

The highest-complexity functions in the current file are:

| Function | Approximate range | Cyclomatic | Cognitive |
| --- | ---: | ---: | ---: |
| `onPointerMove` | 3523-3717 | 34 | 77 |
| `renderHand` | 4265-4431 | 33 | 75 |
| `endGesture` | 3718-3808 | 29 | 63 |
| `onKeyDown` | 3819-3932 | 31 | 57 |
| `inspectMesh` | 3138-3260 | 19 | 50 |

`onPointerMove` currently routes marquee selection, measurement, whiteboard drawing, inspection
rotation, overlay movement, piece dragging, dealing, dispensing, and touch transforms. Moving it
before the feature modules would only transplant all of its dependencies.

After the feature controllers exist, it should become a readable dispatcher:

```js
if (selection.handleMove(pointer)) return;
if (overlays.handleMove(pointer)) return;
if (whiteboard.handleMove(pointer)) return;
if (inspection.handleMove(pointer)) return;
pieceDrag.handleMove(pointer);
```

`public/controls.js` should continue translating devices into intents. `input-router.js` should
decide what those intents mean in the application's current mode.

## Room bootstrap and message bindings

The async bootstrap block beginning around `public/client.js:751` is roughly 1,800 lines. It joins
the room but also wires pieces, overlays, players, settings, chat, timer, audio, notes, scores,
cards, assets, and responsive UI.

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

A reasonable endpoint is a roughly 1,000-1,500-line `client.js`, comparable in purpose to the
decomposed `server.js`. The number is a consequence of clearer ownership, not a quota.

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
7. Extract hand.
8. Extract inspection.

### Phase 3: broad state owners

9. Extract selection.
10. Extract player presence.
11. Extract room settings and skybox.

### Phase 4: composition cleanup

12. Split the bootstrap block into feature-specific room binders.
13. Simplify and extract the input router.
14. Reduce `client.js` to joining, composing, binding, and rendering.

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

## First recommended change

Begin with piece mesh replacement and collider diagnostics. They are already identified sources of
duplication, have explicit inputs and outputs, and can be extracted without first redesigning
input or room-state ownership. This creates the first stable controller interface that later hand,
inspection, selection, and render-loop work can depend upon.
