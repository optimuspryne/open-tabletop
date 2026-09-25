# Drawable notecards

Status: freehand drawing, zoom/pan, private-hand support and the selected Tabler icons are
implemented and user-approved for commit. Automated verification is recorded below; the user
did not specify a per-device or multiplayer test matrix.

## Player flow

- Library → Card Decks/Tiles → Drawable notecard uses the existing spawn permissions.
- Double-click/double-tap, or right-click/long-press → Inspect, opens a private drawing editor.
- Any active player may claim an available notecard. Only one editor can hold it at a time.
  The table shows its opaque back and the editor's name; movement, flipping and ordinary removal
  are blocked while it is reserved. GMs can still reset/load the table, ending edits.
- Mouse, touch and pen use a flat canvas with eight ink colors, three widths, eraser,
  undo/redo, and undoable Clear. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or Ctrl/Cmd+Y) control history.
- Wheel or pinch zooms 1–8×; Pan, middle-drag, focused-canvas Space-drag or two-finger drag pans.
  +/− zoom and 0/Fit card resets the view. Pinching cancels the unfinished stroke and waits for
  all fingers to lift before drawing again. View transforms never change saved coordinates.
- Keep in hand saves privately in the existing hand bar. Open the eye button or double-click
  to edit; click/drag or Drop places it on the table. Take to hand retrieves it without editing.
  Pass privately commits directly into the selected active player's hand. A departed/restricted
  recipient leaves the draft open; a full table leaves hand inventory intact.
- Place face-up publishes the committed drawing. Place face-down keeps it private.
  Cancel/Escape restores the previous drawing and face orientation.
- A spectator or timed-out player can inspect only the currently public face. They cannot claim,
  change or reveal a notecard; their own hand drawings remain viewable read-only. Active players may privately inspect a face-down card by claiming it;
  deciding whose turn it is to look remains a player-enforced game rule.
- Notecards move, rotate and flip as individual physical pieces. They have one landscape face,
  an opaque back, a 4.5 × 3 world-unit footprint, 0.1 thickness and 0.18 mass (cards: 0.02).
  They do not enter ordinary playing-card decks or carry typed text. See the stack extension below.

## State and recovery

`room.notecards` owns table artwork and editing reservations. Hand artwork lives in the existing
private hand entries (`kind: "notecard"`), inheriting account ownership, reconnect, reorder,
park/claim, unclaimed-hand reassignment and game snapshots. Portable scenes omit hands.
Explicit Show includes committed drawings only for the chosen audience; beginning an edit
retracts an existing Show. Private transfers do not publish drawing data to shared piece props.
Hand edit leases reserve that entry against play/drop/Show; tokens remain session-bound. Public piece props carry only
the visible drawing, face-down state and current editor label. Concealed artwork goes only to
the current editor through an actor-specific message. Draft strokes stay in that browser until
commit; a rejected save leaves the draft open for retry. Closing/disconnecting discards the
uncommitted draft and preserves the last committed drawing.

Reservations use session-bound random tokens, renewed every 20 seconds and expired after
120 seconds without renewal. Stale commits, another session's token, spectator/time-out requests
and malformed drawings cannot mutate the committed document. Disconnect/revocation/time-out,
lease expiry, removal and table reset release reservations. The reserved body's physics is
temporarily static; ordinary simulation resumes when released.

Scene/game saves contain committed artwork and its committed orientation, even during an edit.
Restore installs concealed drawings into server-only storage before publishing piece props.
Invalid notecard scenes are rejected before the current table is cleared. The schema and database
migrations are unchanged; restart the server and refresh browsers to load the new piece kind.

Limits are shared: 16 notecards across table (including every card inside stacks), active hands and parked hands, 256 strokes per drawing, 1,024 coordinates per stroke,
8,192 coordinates per drawing. Coordinates are normalized and rounded to four decimals.
No uploaded drawing images, public asset URLs, additional services or build step are involved.

## Reuse and implementation map

The piece type keeps mutable artwork separate from immutable deck face references. Hand entries
use an explicit kind instead of generating permanent face-image assets.
Existing piece lifecycle, colliders, permissions, inspection entry points and scene persistence
are extended. Whiteboard stroke replay is extracted into a focused renderer shared with notecards;
the whiteboard retains its existing ownership and message protocol.

| Files | Functions or responsibilities added/changed |
| --- | --- |
| `shared/notecards.js` | `NOTECARD`, palettes and `normalizeNotecardDrawing`; bounded drawing contract. |
| `shared/pieces.js` | `KINDS.notecard`; shared mass and box dimensions. |
| `shared/room-capabilities.js` | Explicit gameplay and cleanup classifications for notecard requests. |
| `server/game/notecards.js` | `createNotecards`, `registerNotecardHandlers`; private documents, table/hand claims, commit destinations, `take`, `placeHandCard`, total capacity, cleanup and expiry. |
| `server.js` | Construct/register the service and expiry sweep; `spawnHandCard` routes notecards, drop undo retrieves them, release editors before final save. |
| `server/message-validation.js` | `spawnPayload` accepts only blank notecard spawn props. |
| `server/game/piece-lifecycle.js` | `spawn` validates/initializes documents and flat bodies; `removePiece` cleans them up. |
| `server/game/piece-operations.js` | `standOf`/`naturalStand` give notecards default flat behavior. |
| `server/game/physics-update.js` | `selfRightPieces`/`maintainSnapPins` preserve drawing reservations. |
| `server/game/interaction-policy.js` | `guardedMessage` rejects mutations targeting reserved notecards. |
| `server/game/interaction-cleanup.js` | `stopPlayerInteraction` releases private editing. |
| `server/game/handlers/pieces.js` | Spawn capacity feedback; group flip handles notecards without deck conversion. |
| `server/game/scene-persistence.js` | `clearGameTable`, `serializeScene`, `applyScene` preserve private drawings and validate before replacement. |
| `public/rendering/strokes.js` | `drawCanvasStroke`; normalized replay, erasing and single-point dots. |
| `public/rendering/notecards.js` | `paintNotecard`, `notecardMesh`; private/public surface rendering with disposable textures. |
| `public/rendering/graphics.js` | `KIND.notecard`, `notecardPreviewURL`; render/dispose registration and Library thumbnail. |
| `public/table/drawing-view.js` | `createDrawingView`; inverse point mapping, anchored zoom, bounded pan and reset. |
| `public/table/hand.js` | `inspectHandCard`, `renderHand`, `cardSortKey`, drag previews/cleanup; drawing thumbnails and editor routing in mixed hands. |
| `public/table/presence.js` | `refreshFan`/`removeFan`; authorized Show drawings with owned-texture cleanup. |
| `server/game/card-transfer.js` | `takeTableCard` routes notecards through their private service. |
| `server/game/handlers/placement.js` | `playCard`/`handToTable` consume each successfully placed entry, preserving total-count invariants and retracting Show. |
| `server/game/handlers/room-features.js` | `showStart` adds explicit notecard payloads only for the selected audience. |
| `scripts/build-icons.mjs`, `public/{table,index,admin}.html` | Add `arrow-forward-up` and `zoom-out`; regenerate canonical Tabler sprites. |
| `AGENTS.md` | Persist the UI icon-choice rule: ask for concrete choices, then apply the approved set. |
| `test/hand.js` | Mixed-hand rendering, editor opening and drag-artwork disposal regression. |
| `public/table/whiteboard.js` | `drawStroke` delegates common replay to `drawCanvasStroke`. |
| `public/table/notecards.js` | `createNotecardEditor`; private draft, tools/history, acknowledged save, native focus containment and public-view updates. |
| `public/table/controls.js` | `attachDrawingControls`; drawing/pan/wheel/pinch intents, pointer cancellation/reset and temporary Space-pan. |
| `public/table/input-router.js` | `isModalActive` blocks camera-axis movement during editing. |
| `public/table/inspection.js` | `INSPECTABLE`/`enterInspect` route notecards to their drawing panel. |
| `public/table/piece-ui.js` | Notecard name, Flip and Take to hand context actions. |
| `public/table/piece-view.js` | Rebuild/dispose notecard meshes on visibility/artwork changes. |
| `public/client.js` | Compose editor, room messages, participation cleanup and inspection/input callbacks. |
| `public/editor/editor-panel.js` | `renderBuiltin` adds the notecard spawn tile. |
| `public/table.html`, `public/styles.css` | Drawing dialog, help text, responsive tools and touch targets. |
| `test/notecards.js` | Validation, physical lifecycle, private delivery, reservations, authorization, expiry and scene round trips. |
| `test/backend-interaction-policy.js` | Include the real notecard handler registrations in capability inventory/denial checks. |
| `scripts/notecard-test.mjs`, `package.json` | Browser regression runs with `test:components`: real mouse/touch strokes, history, save failure/acknowledgement and concealed viewing. |
| `CHANGELOG.md`, `docs/{ROADMAP,REFERENCE,ARCHITECTURE,GESTURES,DEVICE_QA}.md` | User-facing behavior, current contracts and manual QA scope. |

## Verification

Initial freehand implementation passed locally on 2026-09-25: `npm run check` (786 unit tests, lint, formatting and CSS checks),
`npm run test:input` (57 checks), `npm run test:components` (including the new notecard browser
regression), and `npm run test:devices` (all seven profiles). Desktop, 390 px and 360 px notecard
screenshots were inspected. The component fixture's expected missing sample-asset URLs remain
non-failing fixture output. No database/query/schema changes require an integration migration run.

Automated tests exercise bounded payloads, blank spawn validation, real Cannon body creation,
private editor delivery, competing sessions, movement/removal blocking, forged/stale commits,
participation restrictions, cancellation, expiry, concealed save/restore, and capacity failures.
Browser tests use real mouse/touch input and the production editor on desktop and 390/360 px phones.
The extension adds zoom-anchor/clamp and transformed-coordinate tests, no-stray-ink pinch/pan,
private hand ownership and recipient rejection, full-table preservation, cap checks across hands,
account park/claim and game snapshots, selective Show/retraction, mixed-hand thumbnails/preview
cleanup, editor Keep/Pass controls and compact/full icon/layout checks.

Zoom/pan/private-hand extension verification on 2026-09-25: `npm run check` passed (795 tests,
lint, formatting and CSS checks), `test:input` passed 57/57, `test:components` passed including
production-client bootstrap and the extended notecard browser checks, and `test:devices` passed
all seven profiles. `build:icons` regenerated all three sprites; only the two approved additions
changed. CSS checks and the editor/device suites were repeated after fitting the canvas height
to keep desktop placement buttons visible. Desktop and phone screenshots were inspected;
`git diff --check` passed. The user approved the result for commit. Detailed real-device stylus
and multiplayer coverage was not specified; the checklist below remains available for future QA.

Manual smoke test after a server restart and browser refresh:

1. Spawn two notecards; draw with mouse, finger and a real stylus. Try every tool and undo Clear.
2. Place one face-down. With a second account, verify no picture appears until it is claimed or flipped.
3. While drawing, have another player try to inspect, move, flip and remove it; each should be blocked.
4. Zoom and pan with wheel, two fingers and Pan; draw at high zoom and reset Fit. Check real stylus accuracy.
5. Keep, reopen and edit; drag/drop a mixed hand, retrieve it, pass privately and use selective Show.
6. Save/reload and reconnect with notecards on the table and in hands; reassign an unclaimed hand.
7. Cancel, disconnect, enter spectator mode or apply a time-out during an edit; verify committed artwork remains.


## Notecard stacks — implemented, user-tested and approved for commit

Library → Card Decks/Tiles → **Notecard stack** creates 2–16 blank cards (default eight).
Each stack is one physical piece with an opaque back, visible count and layered edges. All
contained drawings stay concealed. Right-click/long-press opens the existing piece menu:
Draw to hand (`cards`), Draw & edit (`writing`), Play top face-down (`arrow-bar-down`),
Shuffle (`arrows-shuffle`), Split (`arrows-maximize`), and Move stack (`hand-move`).
Double-click/double-tap opens the top card's private editor; ordinary left-drag moves the stack.
Selection Combine (`arrows-minimize`) merges only loose notecards and notecard stacks;
ordinary playing cards are incompatible. Existing piece actions remain available.

The private editor adds **Return to top** (`arrow-bar-up`), alongside Keep in hand, private
passing and the existing placement controls. Claiming reserves the whole stack and leaves the
committed top entry in place. Return saves that entry; Cancel, disconnect or expiry keeps its
previous artwork and position. Hand/pass/table commits consume the top only after a successful
transfer. Failed placement or invalid recipients keep the draft and lease available for retry.
Drawing the final card removes the empty stack. A single remaining card may stay in a stack.

Stack entries are server-only `{drawing,noteProps}` records in bottom-first order. Metadata
includes each card's label, snap and stand settings. Splitting moves the top half to a new
stack after capacity checks and successful allocation. Combining preserves each source's
internal order and places higher source pieces nearer the top. It converts the lowest source
piece in place, so the physical-piece cap cannot prevent consolidation. Shuffle changes only
order. The 16-card total includes all entries, loose pieces, live hands and parked hands.
Scene/game snapshots retain committed entries, order and metadata; restore validates artwork
and the combined total before clearing the live table. No schema migration or public image
assets are introduced.

Keyboard users can press Shift+F10 or the Context Menu key outside inputs/dialogs to cycle
stack action menus without pointing at a piece. Menus focus their first button, support arrows,
Home/End, Tab and Enter/Space, and return focus to the table with Escape. Actions have accessible
names and hover/focus hints. Moving physical objects and freehand stroke entry retain their
existing pointer/touch interaction; this shortcut provides keyboard access to stack inventory
and editor controls. The UI mock-up and icon choices were explicitly approved before implementation.

This extends the existing private notecard service, hand transfers, editor, Library spawn-card
builder and selection toolbar. Stack geometry and inventory normalization live in shared code;
collider reconstruction stays in the physics adapter. No generic card-face reference or deck
storage is used for mutable drawings.

### Stack extension file map

| Files | Functions or responsibilities added/changed |
| --- | --- |
| `shared/notecards.js` | `notecardStackHeight`, `normalizeNotecardStack`: shared height and bounded private inventory. |
| `shared/pieces.js`, `shared/collider-spec.js` | Register `KINDS.notecardStack`; `colliderSpec` uses counted height. |
| `shared/room-capabilities.js` | Classify draw, shuffle, split and combine requests as gameplay. |
| `server/message-validation.js` | `spawnPayload` permits only a bounded blank stack quantity. |
| `server/game/notecards.js` | Extend count, publish, claim, commit, snapshot and cleanup; add `restoreStack`, `syncStack`, `availableStack`, `placeStackCard`, `draw`, `shuffle`, `split`, `combine`; register their handlers. |
| `server/game/collider-maintenance.js` | `updateNotecardStackCollider` updates counted geometry and mass. |
| `server/game/piece-lifecycle.js` | `spawn` validates full inventory before allocating and initializes flat stack bodies without public artwork. |
| `server/game/piece-operations.js` | `standOf`/`naturalStand` keep stacks flat by default. |
| `server/game/handlers/pieces.js` | Spawn feedback counts every contained card. |
| `server/game/scene-persistence.js` | `serializeScene` stores private entries; `applyScene` validates stacks and total inventory before reset. |
| `public/rendering/notecards.js`, `public/rendering/graphics.js` | Counted back painting, `notecardStackMesh` layered edges, and `KIND` registration/disposal. |
| `public/table/piece-view.js` | `meshPropsOf`, `replaceMesh`, `bindRoom`: count-aware meshes and live notecard-to-stack conversion. |
| `public/table/inspection.js` | `INSPECTABLE` and `enterInspect` route stacks into the private editor. |
| `public/table/notecards.js`, `public/table.html`, `public/styles.css` | `open`, `show`, `sync`, Return-to-top action, stack help and visible menu labels in compact/touch layouts. |
| `public/table/piece-ui.js` | Stack count/name/control guide/menu actions; approved icons, focus and menu navigation. |
| `public/table/controls.js`, `public/table/input-router.js` | `logicalKey` retains Shift; `onKeyDown` routes keyboard stack-menu cycling. |
| `public/table/selection.js` | `cardFamilySig`, `refreshSelTools`, `bindActions` distinguish stack combination and mixed selections. |
| `public/editor/editor-panel.js` | `countStepper` supports minimum/accessible labels; `renderBuiltin` adds the stack Library tile. |
| `test/notecards.js`, `test/input-router.js`, `test/selection.js` | Privacy, inventory, failure recovery, saved order, geometry and keyboard/composition regression tests. |
| `scripts/notecard-test.mjs` | Production Return control, mesh conversion/count rebuilding, menu protocol/icons, keyboard navigation, desktop/phone screenshots. |
| `CHANGELOG.md`, `docs/{REFERENCE,ARCHITECTURE,ROADMAP,GESTURES,DEVICE_QA,DESIGN_notecards}.md` | Behavior, contracts, implementation map and QA status. |

Stack manual smoke test after **server restart and browser refresh**:

1. Spawn eight cards; confirm count, left-drag and long-press/right-click actions on desktop/touch.
2. Draw & edit, Return to top, reopen, then Cancel; check that only Return saved the drawing.
3. With a second account, try to draw, move or shuffle the reserved stack. Confirm no artwork leaks.
4. Draw to hand, pass privately and play face-down; flip only the loose card to reveal it.
5. Split, shuffle and combine stacks with loose notes; save/reload and verify all artwork/metadata.
6. Draw every card, including the last. Test Shift+F10, menu arrows/Enter/Escape and compact hints.
7. Fill the room's 16-card allowance and the physical table capacity; failed draws/splits must
   retain the source, while combining and drawing to hand remain available.

Stack automated verification on 2026-09-25: `npm run check` passed (806 tests, lint,
formatting and CSS checks); `test:input` passed 57/57; `test:components` passed, including
production-client bootstrap and the extended notecard editor/menu/mesh checks at 1280, 390
and 360 px; `test:devices` passed all seven profiles. Desktop and phone editor/menu screenshots
were inspected. The component fixture's seven expected sample-asset 404s remain non-failing
fixture output. Documentation links and `git diff --check` passed. No database changes require
an integration migration run. The user subsequently reported that the notecard work functions correctly and approved it
for commit. No per-device or multiplayer test matrix was specified, so individual checklist
items remain available for future verification.
