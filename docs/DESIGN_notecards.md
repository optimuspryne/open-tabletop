# Drawable notecards

Status: account templates are implemented with approved UI/icons; implementation acceptance is pending. Editable text boxes are implemented, user-tested and approved for commit. Paper styles and drawing helpers are implemented, user-tested and approved for commit. Previously shipped freehand drawing, zoom/pan, private-hand support and their selected Tabler icons are
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

Stack entries are server-only `{drawing,paper,noteProps}` records in bottom-first order. Metadata
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

## Paper styles and drawing helpers — implemented, user-tested and approved for commit

The user approved the editor mock-up and Tabler choices before implementation. Paper choices
are Blank/Ruled/Grid/Dots, in Ivory/White/Pale yellow. Paper is saved per card, not as an account
preference, and travels with ink through table pieces, hands, passing, selective Show, stacks,
scene/game saves and reconnect. Face-down backs reveal neither pattern nor tone. Old snapshots
without paper load as blank ivory; explicit invalid styles fail before mutation/reset. Older
clients omitting paper on commit preserve the existing style.

Line (`line`), Rectangle (`square`) and Ellipse (`circle`) use the existing stroke protocol.
Constrain (`ruler-measure`) or Shift makes 45° lines, squares and circles in physical canvas
coordinates. An ellipse uses 64 segments; every helper previews and commits one bounded,
undoable stroke. The approved icons already existed in all sprites, so regeneration was unnecessary.
No schema migration, new asset or service is required. Ink is replayed into a separate scratch
canvas so erasing reveals the selected pattern/tone. Clear and history affect ink; Cancel also
restores the previous paper. The whiteboard renderer's behavior is unchanged.

Keyboard arrows move a visible cursor through the current view. Enter starts/finishes a stroke;
Escape cancels the unfinished keyboard stroke first. Tab/blur discards unfinished keyboard ink.
These commands go through `attachDrawingControls`, which ignores them during pointer gestures.
Mouse/finger/stylus and existing pan/pinch cancellation share the same stroke construction and
capacity checks. Help, accessible labels, pressed states, focus and status feedback accompany the
compact controls. The desktop canvas height leaves room for the expanded controls and footer;
phone dialogs retain vertical scrolling with wrapped controls.

### Paper/helper extension file map

| File | Functions/helpers or responsibilities added/changed |
| --- | --- |
| `shared/notecards.js` | Add `NOTECARD_PATTERNS`, `NOTECARD_TONES`, `normalizeNotecardPaper`; extend `normalizeNotecardStack` to validate/copy paper. |
| `server/game/notecards.js` | Extend `give`, `take`, `placeHandCard`, `publish`, `restore`, `claim`, `commit`, `placeStackCard`, `draw`, `combine` to preserve paper privately and restore both fields after failed placement. |
| `server/game/piece-lifecycle.js` | `spawn` validates paper before allocating physical pieces. |
| `server/game/scene-persistence.js` | `serializeScene` stores private paper; `applyScene` validates before reset and normalizes restored hand entries. |
| `server/game/handlers/room-features.js` | `showStart` sends paper only alongside artwork to the selected audience. |
| `public/rendering/notecards.js` | Extend `paintNotecard` with patterned paper and weakly held per-context ink layers; `notecardMesh` supplies paper. |
| `public/rendering/graphics.js` | Extend `notecardPreviewURL(drawing,paper)` for styled thumbnails. |
| `public/table/hand.js` | `renderHand` and drag preview creation retain paper in thumbnails and temporary meshes. |
| `public/table/presence.js` | `refreshFan` passes authorized paper to revealed notecard meshes. |
| `public/table/notecard-shapes.js` | Add `notecardShapePoints` to create bounded line/rectangle/ellipse polylines with optional constraints. |
| `public/table/notecards.js` | Extend `createNotecardEditor`, `paint`, `sync`, `show`, `open`, `openHand`, `syncHand`, room updates and commit/cleanup; add shared `beginStroke`/`extendStroke`, helper/paper controls and keyboard cursor intents. |
| `public/table/controls.js` | `attachDrawingControls` forwards idle focused-canvas keyboard commands and blur through the intent interface. |
| `public/table.html` | Add paper/helper controls using approved existing icons, accessible canvas instructions and in-app help. |
| `public/styles.css` | Wrap paper controls and reserve desktop space for the expanded editor/footer. |
| `test/notecard-shapes.js` | Bounded ordinary strokes, reverse drags, degenerate endpoints, physical aspect constraints and line clipping. |
| `test/notecards.js` | Default/invalid paper, concealment, forged/omitted-paper commits, transfer/Show, stack and save round trips, legacy snapshots and allocation failure recovery. |
| `scripts/notecard-test.mjs` | Real mouse/touch helper creation, keyboard cancellation/history, paper payloads/reopening, Clear semantics, pixel-level erasing, concealed backs and thumbnails. |
| `CHANGELOG.md` | Unreleased feature entry. |
| `docs/REFERENCE.md` | Paper protocol/normalization, renderer, shape helper and input contracts. |
| `docs/ARCHITECTURE.md` | Private paper ownership and ink/paper rendering boundaries. |
| `docs/GESTURES.md` | Touch/desktop helper and keyboard drawing paths. |
| `docs/ROADMAP.md` | Implementation and user acceptance status. |
| `docs/DEVICE_QA.md` | Real-device, accessibility and multiplayer smoke-test checklist. |
| `docs/DESIGN_notecards.md` | Approved scope, reuse decision, implementation map and verification record. |

Automated verification is recorded below. No per-device user acceptance
is inferred from the approved mock-up or automated passes. Restart the server and refresh all
browsers before manual testing; use the new checklist in [DEVICE_QA.md](DEVICE_QA.md).

Paper/helper verification on 2026-09-25: `npm run check` passed with **815 unit tests**, lint,
formatting and CSS checks; `test:input` passed **57/57**; `test:components` passed (including
production bootstrap and the expanded mouse/touch notecard fixture); `test:devices` passed all
**seven profiles**. The focused browser checks were repeated after focus-hint/layout refinements,
including whole-shape capacity rejection, at 1280, 390 and 360 px. Full/compact desktop and phone
screenshots were inspected. Final paper-type validation passed the full check suite. Documentation
links and `git diff --check` passed. The component fixture still reports its seven expected sample
asset 404s without failing. No database/query/migration change requires the integration suite.
The user reported that the extension works great and approved it for commit. No per-device,
assistive-technology or multiplayer test matrix was specified; the detailed QA checklist remains
available for future verification.


## Editable text boxes — implemented, user-tested and approved for commit

The user approved the interactive desktop/full and phone/compact example and Tabler choices:
Text (`cursor-text`), Add (`plus`), Delete (`trash`), width resize (`arrow-autofit-width`). These
already exist in the sprite. The Text tool opens a native textarea, box picker, size/alignment/ink
controls and accessible selection overlays. Up to eight multiline boxes (500 UTF-16 code units
each) stay editable through table placement, hands, private pass, selective Show, stacks and saves.
Mouse/touch dragging moves boxes and resizes wrapping width. Keyboard arrows move; Shift+left/right
or arrows on the width handle resize; Enter edits; Delete removes. Native fields retain standard
text editing. Two fingers cancel tentative movement before navigating. Compact/full controls use
names, focus indicators and equivalent written hints. Overlay buttons do not blur underlying text.

Text paints above ink. Eraser/Clear ink preserve it; shared Undo/Redo covers drawing and text,
grouping each typing session and pointer drag into one action. Paper choices remain outside
history. Overflow warns and blocks commit while retaining the draft. Layout uses system sans-serif
font metrics; cross-platform fallback may differ. No rich text, custom fonts or templates are added.
Older saves default to no boxes, and older commits omitting text retain committed boxes. Invalid
payloads fail before mutation or destructive restore. Concealed text uses the existing server-only
artwork boundary, including saved/parked hands and stack order; failed transfers retain content.

Reuse decision: extend the existing private document service, transfers, serializer, renderer and
input intents. `normalizeNotecardContent` consolidates validation of the three content fields.
Text layout has its own renderer module, reused for painting and editor bounds; text selection and
gestures have a focused controller with explicit dependencies. The parent editor retains draft and
history ownership. Existing drawing/whiteboard protocols and geometry stay compatible.

### Text extension file map

| File | Functions/helpers or responsibilities added/changed |
| --- | --- |
| `shared/notecards.js` | Add `NOTECARD_TEXT`, `normalizeNotecardTextBoxes`, `normalizeNotecardContent`; extend `normalizeNotecardStack` for complete documents. |
| `server/game/notecards.js` | Extend `give`, `take`, `placeHandCard`, `publish`, `restore`, `claim`, `commit`, `placeStackCard`, `draw`, `combine` and snapshots to preserve private text and roll back complete content on failures. |
| `server/game/piece-lifecycle.js` | `spawn` validates the combined document before allocating pieces. |
| `server/game/scene-persistence.js` | `serializeScene` retains private text; `applyScene` preflights combined documents and restores hand content. |
| `server/game/handlers/room-features.js` | `showStart` sends text only to the selected audience. |
| `public/rendering/notecard-text.js` | Add `layoutNotecardText` and `paintNotecardText`: canonical wrapping, newlines, plain-text drawing, clipping and overflow metrics. |
| `public/rendering/notecards.js` | Extend `paintNotecard`/`notecardMesh` to paint text above ink only on authorized fronts. |
| `public/rendering/graphics.js` | Extend `notecardPreviewURL` with text. |
| `public/table/hand.js` | `renderHand`/drag state and preview meshes carry text. |
| `public/table/presence.js` | `refreshFan` passes authorized text to Show meshes. |
| `public/table/notecard-text.js` | Add `createNotecardTextEditor`: `sync`, `updateOverlay`, `add`, `remove`, `select`, `replace`, `endEdit`, `error`, `press`/`move`/`release`/`cancel`, `command` and `reset`; manage selection, typing, gestures, accessible overlays and draft cleanup. |
| `public/table/notecards.js` | Extend draft/open/show/hand/state/cleanup and commit flows for text; add combined `snapshot`, update `remember`/`history`, wire controller intents and content rendering, overflow checks and accessible descriptions. |
| `public/table/controls.js` | Extend `attachDrawingControls` with separate stage/focus target and owned keyboard targets; preserve pointer/pinch and focus-loss intents. |
| `public/table.html` | Approved Text tool, fields, box controls, overlay stage and accessible help. |
| `public/styles.css` | Responsive text panel/stage, transparent selectable overlays, focus and coarse-pointer width handles. |
| `test/notecards.js` | Text payload/permission validation, legacy defaults, private transfer/Show, hands, stack/scene round trips and allocation rollback. |
| `test/notecard-text.js` | Measured wrap/newlines/Unicode, size/width/position overflow and empty-box layout. |
| `scripts/lib/notecard-text-test.mjs` | Add `verifyNotecardText`: production mouse/touch/keyboard editing, zoomed width resize, shared history, overflow, privacy, rendering and compact/full screenshots. |
| `scripts/notecard-test.mjs` | Run the focused text fixture; support modifier keys in browser input helper. |
| `CHANGELOG.md` | Unreleased feature entry. |
| `docs/REFERENCE.md` | Text contract, normalization, renderer/controller and input boundaries. |
| `docs/ARCHITECTURE.md` | Private structured text, content validation and state/rendering ownership. |
| `docs/GESTURES.md` | Mouse/touch and keyboard text editing instructions. |
| `docs/ROADMAP.md` | Text implementation, user acceptance and remaining templates status. |
| `docs/DEVICE_QA.md` | Text, accessibility, real-device and multiplayer smoke checks. |
| `docs/DESIGN_notecards.md` | Approved scope, reuse decision, file map and verification status. |

Restart the server and refresh all browsers before testing. No database migration is required.
Text verification on 2026-09-25: `npm run check` passed **823 unit tests**, lint, formatting and
CSS checks, including the final right-edge rounding regression. `test:input` passed **57/57**;
`test:devices` passed all **seven profiles**. The focused text browser fixture passed mouse at
1280 px and touch at 390/360 px, including zoomed width-handle dragging, combined history,
overflow recovery, concealment and thumbnails. `test:components` passed its full desktop/touch
production fixtures and the final notecard regression. An initial component process was interrupted
(exit 143); a separate rerun completed successfully. The fixture's seven expected sample-asset
404s remain non-failing. Full/compact desktop and phone screenshots were inspected, including a
fix preventing selection overlays from blurring text. Local documentation links and
`git diff --check` passed. No database/query/migration change required `test:integration`.
The user reported that the text box extension works great and approved it for commit. No detailed
real-device, assistive-technology or multiplayer matrix was specified; the checklist remains
available for future verification in [DEVICE_QA.md](DEVICE_QA.md).


## Saveable templates — approved UI, implemented; acceptance pending

The user approved private account templates with explicit server sharing and the editor/Library
mock-up. Approved icons: `device-floppy` Save, `plus` Create card, `cards` Create stack, `settings`
Manage, `writing` Edit design and `trash` Delete. Existing cancel/placement icons are reused.
No new sprite entries are needed. Saving from an editable card stores its current draft separately
and leaves the card open. The Library opens fresh local drafts or creates independent face-down
stacks. Owners/site admins manage originals; other users can copy explicitly shared designs.
Sharing controls have visible explanatory text; compact buttons keep names/hints and native focus.

Reuse decision: extend the existing normalized document, editor, hand/stack creation and renderer.
A focused query factory and HTTP router follow the existing saved-preset persistence pattern while
keeping template authorization/revision rules explicit. A focused template UI controller receives
the editor and room dependencies. The editor retains all content/history; local template copies use
its existing tools, then a guarded creation request allocates room inventory only when committed.
No physics geometry, hand ownership, leased editing protocol or whiteboard protocol is replaced.

Privacy and persistence: templates are private by default; explicit sharing exposes the complete
design to authenticated users on this server. SQL owner/live-admin checks gate changes. Reads
recheck account access after asynchronous work. Revision checks protect concurrent writes; metadata
updates cannot overwrite content. Failed operations retain recoverable drafts/inventory. A copied
card carries its document, not a live link: changing, unsharing or deleting a template never changes
existing copies. Owner deletion retains private templates for site-admin management. Migration 022
and the flattened fresh-install schema preserve this account data in the database, independently of
scene/game snapshots. Collection organization and package export are separate future extensions.

### Template extension file map

| File | Functions/helpers or responsibilities added/changed |
| --- | --- |
| `postgres/022_notecard_templates.sql` | Add account-owned JSONB template table, revisions, private default and owner index. |
| `postgres/schema.sql` | Include migration 022 in fresh schema and bookkeeping. |
| `server/notecard-template-queries.js` | Add `createNotecardTemplateQueries`: paginated `list`, authorized `get`, `create`, revision-checked `update`/`remove`. |
| `server/http/routes/notecard-templates.js` | Add `normalizeNotecardTemplate` and `createNotecardTemplatesRouter`: authenticated bounded requests, current-access checks and conflict responses. |
| `server/database.js`, `db.js` | Compose/export `notecardTemplates` through the production database facade. |
| `server.js` | Mount `/notecard-templates` with the established authentication boundary. |
| `server/game/notecards.js` | Add `create`, bounded per-client successful request tracking and `notecardCreate` registration; reuse `give`, capacity checks and spawn paths. |
| `shared/room-capabilities.js` | Classify `notecardCreate` as gameplay. |
| `public/table/notecards.js` | Add `hasDraft`, local-draft creation/ack/error handling, generation cleanup and template capture/context/busy/saved/attachment/open seams; preserve leased paths. |
| `public/table/notecard-templates.js` | Add `createNotecardTemplates`, authenticated `request`, paginated `load`/`render`, `openSave`, `open`, `createStack`, `manageTemplate`, field/icon helpers, async guards and room binding. |
| `public/client.js` | Construct template controller and bind it alongside the notecard editor. |
| `public/table.html` | Approved save form/header action and Library template section; accessible names, sharing descriptions and in-app help. |
| `public/styles.css` | Wrapping template lists/cards/forms using shared tokens and canonical controls. |
| `test/notecard-templates.js` | Normalization/default privacy, trusted identity, authentication, revision conflicts, post-await access and database-error boundaries. |
| `test/notecards.js` | New card/stack content independence, retry deduplication, capacity, malformed requests and restricted actors. |
| `test/backend-database-factory.js` | Verify production template database exports. |
| `test/integration/database.js` | Migration inventory and real PostgreSQL ownership, sharing, role changes, revisions and independent content. |
| `scripts/test-database.mjs` | Exercise numbered migration 022 on an existing populated schema and maintain older upgrade fixture isolation. |
| `scripts/lib/notecard-template-test.mjs` | Add `verifyNotecardTemplates`: real UI save/share/replace/copy/stack flows, failure recovery, stale-response cleanup and full/compact screenshots. |
| `scripts/notecard-test.mjs` | Run template fixture and compose room callbacks as production does. |
| `CHANGELOG.md` | Unreleased feature and migration note. |
| `docs/REFERENCE.md` | Persistence/API/editor/creation contracts and upgrade instructions. |
| `docs/ARCHITECTURE.md` | Account-template boundaries, access, ownership and copy semantics. |
| `docs/GESTURES.md` | Save/manage/copy paths and keyboard/touch instructions. |
| `docs/ROADMAP.md` | Template implementation/acceptance status. |
| `docs/DEVICE_QA.md` | Manual multiplayer, accessibility, device, migration and failure-recovery checklist. |
| `docs/DESIGN_notecards.md` | Approved scope, reuse decision, file map and verification record. |

Apply migration 022 via the normal owner-role migrator, restart the server and refresh clients.
No new configuration, ports, asset files or build tooling are introduced.

Template verification on 2026-09-25: `npm run check` passed **829 unit tests**, lint, formatting
and CSS checks; `test:input` passed **57/57**; `test:devices` passed all **seven profiles**.
`test:integration` passed **21/21** against PostgreSQL, including template permissions/revisions;
its migration fixtures also verified numbered migration 022 against an existing populated schema.
`test:components` passed desktop/touch production fixtures and the notecard/template flows at
1280 px mouse and 390/360 px touch. The fixture's seven expected sample-asset 404s remain
non-failing. Full/compact desktop and phone screenshots were inspected, including long template
names, save conflicts and responsive wrapping. Local documentation links and `git diff --check`
passed. Manual acceptance, real-device gesture feel, assistive-technology use and multiplayer
verification remain pending in [DEVICE_QA.md](DEVICE_QA.md).

### Dedicated Library tab and compact previews — earlier revision, superseded below

The user approved a **Notecard Templates** tab immediately after **Card Decks/Tiles**, with smaller
220px-wide previews and independent native disclosure controls. Previews start open; names,
privacy and actions stay visible when collapsed. Collapse choices are local to the page and survive
list refreshes. The tab retains its My templates/Shared with me filter; asset-specific source,
search/select, collection and import controls are hidden while this tab is selected. Existing
Tabler action icons are retained; the native disclosure marker needs no new sprite entry.

Reuse: `wireTabs` still selects the pane, with pressed states exposed for its native buttons.
The existing template `render` creates the native `details`/`summary` preview and retains collapse
choices; no new helper or server boundary is introduced.

| File | Revision |
| --- | --- |
| `public/table.html` | Dedicated tab/pane, moved template section, updated in-app help. |
| `public/editor/editor-panel.js` | `wireTabs` exposes selected state for non-ARIA-tab buttons. |
| `public/table/notecard-templates.js` | `render` adds independent accessible disclosures and session-local collapse state. |
| `public/styles.css` | Small previews, independently sized grid rows, focus/touch styles and template-only Library chrome. |
| `scripts/component-parity.mjs` | Real tab switching, selected-state, asset controls and search-reset regression. |
| `scripts/lib/notecard-template-test.mjs` | Keyboard disclosure, visible actions, collapse retention and thumbnail-size checks. |
| `CHANGELOG.md`, `docs/GESTURES.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/DEVICE_QA.md`, `docs/DESIGN_notecards.md` | Updated navigation, interaction contract, manual checks and this implementation record. |

Verification on 2026-09-26: `npm run check` passed 829 tests plus lint/format/CSS checks;
`test:input` passed 57/57 and `test:devices` passed all seven profiles. The component fixture
passed desktop and coarse-pointer scenarios, including real tab switching and search reset.
The following notecard fixture initially failed because its simulated Enter omitted the native
keypress text; after correcting that test event, `node scripts/notecard-test.mjs` passed all
1280px mouse and 390/360px touch cases, including keyboard disclosure/focus, independent collapse
retention and preview sizing. Focused ESLint passed after that test-only correction. Desktop/full,
phone/full and phone/compact screenshots were inspected; documentation links and `git diff --check`
passed. The fixture's seven expected sample-asset 404s remain non-failing. Manual acceptance and
assistive-technology/real-device checks remain pending. No database code changed in this revision.
Refresh browsers after updating; this UI revision requires no additional migration or server
restart beyond the original template feature setup.

### Shared Library card styling — current approved revision

The user approved two desktop columns with always-visible small thumbnails, removing the preview
dropdown. Narrow phones use one column. Each card places the thumbnail left, name/privacy right,
Copies above grouped Create card/Create stack/Manage actions. Existing approved Tabler icons remain.

Reuse decision: use the existing `libList`, `libCard`, `libPreview`, `libThumb`, `libMeta`, `libName`,
`cardCtrls`, `button-row--compact` and native `control` styles. Template-specific CSS only sets the
two/one-column layout, metadata wrapping, Copies width and full-width Manage form. No new helpers
or server behavior are needed; obsolete disclosure state and bespoke card surface styles are removed.

| File | Functions/helpers or responsibilities changed |
| --- | --- |
| `public/table/notecard-templates.js` | `render` uses shared Library markup, always-visible thumbnails, grouped controls; removes native disclosure creation and `collapsedPreviews`. |
| `public/table.html` | Template list becomes a shared `libList` with semantic list items; help reflects visible thumbnails. |
| `public/styles.css` | Remove duplicate card surface/thumbnail/disclosure styles; retain only template layout/form adjustments. |
| `public/editor/editor-panel.js` | `wireControls` asset-search loop excludes the separately paginated account-template pane. |
| `scripts/lib/notecard-template-test.mjs` | Replace disclosure tests with visible-thumbnail, overflow and desktop/phone column checks; retain save/share/manage/create/error flows. |
| `scripts/component-parity.mjs` | Confirm loaded template names are excluded from asset searches and tab navigation still works. |
| `CHANGELOG.md`, `docs/GESTURES.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/DEVICE_QA.md`, `docs/DESIGN_notecards.md` | Current layout, reuse contracts, manual QA and revision record. |

Verification on 2026-09-26: `npm run check` passed 829 tests and lint/format/CSS checks;
`test:input` passed 57/57; `test:devices` passed all seven profiles. `test:components` passed
desktop/touch Library fixtures and the 1280px mouse plus 390/360px touch notecard flows. The final
focused notecard rerun also passed the new Manage-form containment check at all three widths;
focused ESLint passed after that test addition. Screenshot review confirmed shared card styling,
two desktop columns, one phone column, visible thumbnails and full/compact actions. Documentation
links and `git diff --check` passed. Expected sample-asset 404s remain non-failing. Manual acceptance
and real-device/assistive-technology QA remain pending. Refresh clients to test; this styling
revision requires no additional migration or server restart.

User review on 2026-09-27: the user said the result looks great and approved the template changes
for commit. This records acceptance of the delivered work; it does not establish completion of
every real-device, assistive-technology or multiplayer check in `DEVICE_QA.md`.
