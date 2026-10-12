# Independent stacking

The approved placement example is implemented as a single testable slice. Cards and tiles
use the existing mouse/finger drag and keyboard height/rotation intents. Pause before releasing
over a flat support: tiles align to its center/facing, while ordinary cards keep the chosen
sideways, lengthwise or diagonal offset. Raise the held piece to clear a taller pile. On an
active grid, turn off the existing snap flag when freely offsetting cards.

A centered drop onto a compatible deck still returns to its inventory. An assisted offset drop
stays a separate card. Each piece retains its own physics body and face privacy. The server
rejects assistance for fast throws, moving/held/flipping supports, obstructed placement, hidden
pieces, unsupported colliders and multi-piece group drags. Physics controls subsequent settling,
sliding and falling; large overhangs can topple a physical pile. No Mahjong wall layout or rules
automation is included in this slice.

`stackable: false` disables assistance. Generic box/cylinder props opt in through authored
spawn, saved-asset or scene properties with `stackable: true`. `stackMode: 'aligned' | 'offset'`
overrides the default. These data properties do not add a new menu control or icon.
For a built-in shape, set `stackable: true` in its `PROPS` entry in `shared/pieces.js`;
optionally set `stackMode: 'offset'`. Explicit instance settings override registry defaults.
The sideways capture area now accepts aligned tile offsets up to 62.5% of support width/length,
and offset card centers up to 47.5%, preserving their chosen horizontal position.
Gentle movers tilted up to 60 degrees are leveled onto a support, preserving facing and the
up/down face; supports retain the stricter five-degree flatness requirement. Held pieces are
leveled over an eligible support before their tilted corners can disturb it. Single-card plays
from a private hand use the same helper after initializing face privacy; inventory placement
resolves the chosen XZ independently of the ordinary three-unit spawn altitude. Bulk hand
scatter keeps its existing arrangement.
Card/tile collider padding is now zero by default, so standard cards use their authored 0.015
half-thickness (0.03 full thickness), and custom/thicker/hex cards retain their own dimensions.
The shared diagnostic specification uses the same default. Mat surfaces keep an independent
0.04 minimum half-thickness. Stack surface comparisons distinguish thin layers with a 0.001
tolerance, independent of the broader contact/wake tolerance.

## Reuse and boundary

The existing lifecycle release, movement intents, shared collider definitions, deck absorption,
public card metadata and snapshot formats are extended. The new `server/game/stacking.js` is a
focused Cannon adapter because support contact queries, sleeping-body wake-up and placement
belong to server physics. It uses actual collider shapes/offsets rather than duplicating card
or tile dimensions. No attachment graph, protocol message, database migration or runtime
dependency is added.

## File and function summary

| File | Added or changed behavior |
|---|---|
| `server/game/stacking.js` | Adds named `STACKING` tuning, internal `stackMode`, `flatGeometry`, `proximity`, `findSupport`, `levelBody`, and exported `assistStackPlacement`, `prepareStackDrag`, `hasStackSupport`, `wakeStackAbove`. |
| `server.js` | Sets `SIM.cards.colliderThick` to zero so card/tile colliders follow authored thickness. |
| `shared/collider-spec.js` | `colliderSpec` defaults card padding to zero and preserves an independent mat padding default. |
| `server/game/piece-lifecycle.js` | `spawn` retains deck stacking settings; `releasePiece` assists gentle single drops and preserves offset cards from absorption; `removePiece` wakes supported layers. |
| `server/game/physics-update.js` | `driveHeldPieces` wakes layers while a support moves and levels eligible held pieces over stacks; `maintainSnapPins` keeps supported pieces dynamic. Existing simulation ordering remains. |
| `server/game/collider-maintenance.js` | `updateDeckCollider` wakes supported cards before the deck changes height. |
| `server/game/handlers/movement.js` | `registerMovementHandlers` wakes supported layers before individual/group grabs. |
| `server/game/handlers/cards.js` | `registerCardHandlers` wakes supported layers before individual card flips. |
| `server/game/handlers/pieces.js` | `registerPieceHandlers` wakes supported layers before stand, group-flip and group-rotation changes; `applySnap` wakes layers before horizontal relocation. |
| `server/game/handlers/placement.js` | `registerPlacementHandlers` sends single-card private-hand plays through inventory stacking assistance after initializing the card's face privacy. |
| `server/message-validation.js` | `propRecordPayload` and `spawnPayload` strictly validate optional `stackable` and `stackMode` settings for authored props and decks. |
| `server/deck-state.js` | `deckSpawnProps` retains stacking settings; `cardCompatibilityKey` prevents merging different effective settings. |
| `shared/pieces.js` | `cardPublicProps` carries validated public stacking settings through existing deck/hand/table transfers. |
| `public/table/piece-drag.js` | `createPieceDrag.release` flushes the last target and clears stale throws after a pause; `raiseAxis` updates the held target's height. |
| `public/table.html` | Existing pickup help describes gentle stacking, offset cards and touch placement. |
| `test/backend-stacking.js` | Adds real movement/lifecycle/Cannon regression cases for alignment, offsets, deck returns, independent bodies, opt-in shapes, exclusions, obstruction rollback, grid support wake-up, group preservation, validation and scene restoration/privacy. |
| `test/backend-physics.js` | Tests default thin/thick/tile/hex dimensions and independent mat padding; retains the explicit card-padding override case. |
| `test/collider-spec.js` | Tests matching default diagnostic thickness for all card geometries and retained mat padding. |
| `test/input-router.js` | Adds mouse/touch final-target and paused-release cases, preserves immediate throws, and checks group release retains raised height. |
| `docs/ARCHITECTURE.md` | Documents server ownership, independent bodies and privacy boundaries. |
| `docs/REFERENCE.md` | Documents helpers, authored properties, persistence and pinning contracts. |
| `docs/GESTURES.md` | Records mouse, keyboard and touch paths and pending manual QA. |
| `CHANGELOG.md` | Records the capability and release fixes under Unreleased. |
| `docs/STACKING.md` | Records scope, reuse decision, file/function summary and manual test steps. |

The sideways-placement follow-up changes `stackMode` and the named capture tolerances in
`server/game/stacking.js`, adds four regression cases in `test/backend-stacking.js`, and updates
this document, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md` and the Unreleased changelog. No
additional functions, controls or icons were added. It extends the approved placement behavior.

The tilt/private-hand follow-up extends `flatGeometry`, `findSupport` and `assistStackPlacement`,
adds shared `levelBody`/`prepareStackDrag` orientation correction in `server/game/stacking.js`,
updates the existing held servo in `server/game/physics-update.js` and the single-card hand play
in `server/game/handlers/placement.js`. Six new cases in `test/backend-stacking.js` exercise
tilted placements, the real held servo, private hand privacy/flags and spawn altitude differences;
obstruction rollback also verifies unchanged spin/pose. This document, architecture/reference
contracts and the Unreleased changelog record those changes. No new controls/icons or input
messages were introduced.

The collider-thickness follow-up changes the existing `SIM` configuration in `server.js` and
`colliderSpec` defaults in `shared/collider-spec.js`, and extends `findSupport` with a separate
surface-height tolerance in `server/game/stacking.js`. It updates the stacking fixture to actual
card geometry and adds minimum-thickness rectangle/hex settling coverage in `test/backend-stacking.js`;
`test/backend-physics.js` and `test/collider-spec.js` cover physics/diagnostic dimensions and mat
padding. This document, architecture/reference contracts and the Unreleased changelog record
the changes. No functions, controls, models or dimensions in `shared/pieces.js` were added/changed.

## Manual smoke test

Restart the server and refresh clients to load the server helper and revised drag release.

1. Draw two Mahjong tiles and gently place one over the other. Confirm center/facing alignment;
   take or move the lower tile and confirm the upper tile falls.
2. Make a small overlapping pile of ordinary cards, offset sideways and lengthwise. Pick up an
   exposed card independently. Compare a centered deck return with an offset card above a deck.
3. Hold a visibly tilted tile over the pile, then gently release it. Repeat by playing one card
   from a private hand face-up and face-down, including an explicit `stackable: false` card.
   Pause before dropping, then repeat with a quick throw. Raise/lower and rotate while holding;
   on touch use a finger drag, two-finger pinch/twist and the existing hold controls.
4. Repeat with grid snapping on/off, a multi-selection, face-down cards and a rotated tile.
5. Save/reload the scene or game, then remove a lower support. Verify concealed faces remain
   concealed and a second client sees the same final transforms and separate objects.
6. For the thinner-collider experiment, restart and refresh, then use freshly spawned ordinary
   cards. Compare the collider outline with the visible card, gently stack by dragging and from
   a private hand, then separately test free-fall/throws. Repeat with thick tiles and custom/hex
   cards. Do not infer that all tunneling is fixed from assisted placement alone.

Automated verification completed:

- `npm run check`: lint, formatting and CSS checks passed; all 986 tests passed after the
  collider-thickness follow-up.
- `npm run test:input`: all 58 browser input cases passed.
- `npm run test:components`: component scenarios and notecard editor checks passed on desktop
  and touch fixtures. The fixture reported eight missing asset-texture derivative paths; this
  suite does not establish complete asset rendering.
- The 24 focused stacking regressions passed, including actual Cannon stepping and restoration
  through `serializeScene`/`applyScene`. The input-router suite passed all 21 cases.
- Final whitespace/diff checks passed. Initial sandbox localhost restrictions were resolved by
  rerunning fixture-server checks with the approved execution permission.

No database queries, migrations or responsive layout rules changed, so integration/device-matrix
suites were not required. No functions were removed. Real-device gesture feel, multiplayer
latency and GPU performance remain manually unverified.
The user reported the initial feature mostly working, with sideways drops disrupting stacks.
The widened capture/default-inheritance follow-up passed automated checks and was followed by
further tilt/private-hand feedback.
Subsequent user feedback identified tilted movers and single-card hand plays as further failures.
The user subsequently reported the tilt/private-hand corrections appear to be working; device
and multiplayer details were not itemized. The thinner-collider experiment passes automated
checks, including minimum-thickness rectangular/hex layer ordering after Cannon settling.
The user subsequently confirmed "Works perfectly now" and approved committing the changes.
Specific devices, multiplayer scenarios and free-fall/throw stress tests were not itemized;
those broader verification claims remain unestablished.
