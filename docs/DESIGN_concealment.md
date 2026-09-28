# Object hiding and map fog

Status: object Hide/Reveal implemented, 2026-09-27. The user approved the concrete UI and
icon pair A (Tabler `eye-off` / `eye`). Automated verification is recorded below; the user reports
manual tests passing. Map fog and auras are future slices.

## Agreed direction

- Hidden objects must not push or block visible pieces.
- Later fog represents shared party exploration: the GM freely uncovers/covers the map during
  play, and explored regions persist. Normal visual covering over downloaded map artwork is
  sufficient; this does not weaken server delivery protection for hidden objects.
- Later GM-configured piece auras reveal simple circles along movement, with radii expressed
  in map units (for example 1in or 3in). No wall detection or character-rule calculations.
- Manual reveal remains available alongside auras. Revealing terrain will not implicitly reveal
  an object the GM explicitly hid.
- Delivery order: object Hide/Reveal; manual map fog; circular reveal auras. Only slice 1 is
  implemented here.

## Implemented slice

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
GMs can reposition movable hidden pieces using the existing drag controls. Reveal restores the
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

## Verification

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
