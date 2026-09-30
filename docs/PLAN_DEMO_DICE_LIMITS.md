# Demo dice safeguards

Implemented on `codex/public-demo-mode`, 2026-09-30. Public deployment and target-host
performance/manual acceptance remain pending. The user approved the three feedback messages
and authorized a local commit; no push or deployment is part of this change.

## Policy and reuse

Each server-admitted demo room receives an immutable `dicePolicy`. Ordinary rooms receive
no policy. `DEMO_DICE_LIMITS` fixes the room-wide cap at **15 dice** and the per-die roll
cooldown at **1,000 ms**. Every ordinary/custom die counts, including concealed dice and
all personal trays. Dice also consume the unchanged 250-piece budget. Client payloads,
extra players, reconnects and saved configuration cannot select or reset these limits.

The existing capacity helpers and final piece lifecycle enforce creation. Typed preflight
checks run before ordinary/tray placement and dispenser inventory consumption. Custom dice
use the same spawn protocol; collections resolve to the existing asset/spawn operations.
Starter dice also pass through the final lifecycle. Existing chess/cards starters create no
dice. Scene and checkpoint replacement count all candidate dice before clearing live state;
an over-cap snapshot is rejected without truncation, consumption or checkpoint replacement.
Startup returns the approved recovery error; its failed, never-admitted room cannot save.

`rollDie` consolidates the two duplicate impulse implementations. Single, grouped and tray
rolls share one room-owned monotonic deadline map. Mixed groups roll eligible dice; invalid,
non-die and missing-body entries do not consume deadlines. Existing bounded group validation
rejects duplicate IDs. Rejected attempts never extend deadlines, schedule rolls or emit roll
sounds. Creation/restoration seeds a one-second deadline; removal, reset and disposal clean up
state. Deadlines are not persisted. Ordinary rooms preserve their previous impulse parameters.

Scoop places dice at rest, zeros velocity and sleeps bodies: it keeps existing cooldowns but
does not consume a roll. Normal dragging remains unchanged. Delete/recreate starts a fresh
one-second cooldown, and tray toggling cannot make retained dice ready sooner. These two
safeguards do not constitute a general creation, drag or tray-rebuild rate limiter; concentrated
creation/removal and other costly requests still need target-host load testing. Existing
connection and message limits remain active.

## Approved feedback and input

Use existing `notice` toasts, existing `x` icon and status semantics, with no new controls,
icons, layout or input bindings. Desktop/full, compact and touch use the same wrapping text:

- “Demo tables can have up to 15 dice. Remove a die to add another.”
- “These dice can roll again in a moment.”
- “This demo table exceeds the 15-dice limit. Ask the administrator to close it and start a new table.”

Identical notices are coalesced per connection and message kind for two seconds. Feedback
contains no piece IDs, concealed inventory counts or private content. Keyboard, pointer and
touch continue through their current intents and receive the same server enforcement.

## Verification and rollout

Automated verification completed on 2026-09-30:

- `npm run check`: passed lint, formatting, CSS checks and all 944 tests (11 new regressions).
- `npm run test:input`: 58/58 passed.
- `npm run test:components`: passed, including desktop and touch notecard fixtures; the
  existing eight bundled texture-fixture 404 warnings remain.
- `git diff --check` and the new documentation links/file inventory: passed.

No real-device feel, multiplayer performance, or production deployment is claimed. No schema,
query or responsive-layout change required the database/device suites. The first sandboxed
full run was interrupted; the completed full run used local test socket permissions.

Before updating the demo, close/expire the existing temporary tables using the admin lifecycle
and allow their final writers/cleanup to finish. Do not wipe database or asset volumes. Rebuild
and recreate/restart the app, then refresh clients. No migration or environment change is needed.
Old over-cap saves are refused with recovery feedback and preserved until admin cleanup.
Rollback uses the previous app image; the dice safeguards will then be absent.

Manual smoke tests after deployment:

1. Open the dice starter (five d6s). Add dice across table and multiple trays through 15;
   the 16th must be refused. Include a custom die; non-dice must still fit. Remove one and retry.
2. Alternate single, selected-group and tray rolls from two players. Each die may roll once
   per second; mixed groups roll only ready dice and fully rejected groups make no roll sound.
3. Reconnect, scoop, toggle trays, and remove/recreate dice. No retained die becomes ready
   early; recreated dice start on cooldown. Check approved feedback on desktop/compact/touch.
4. Try an over-cap saved scene: current table/private inventory must survive. Exercise an old
   over-cap checkpoint in an isolated fixture and confirm failed joins do not overwrite it.
5. Measure one through five tables within the 20-connection budget, each with 15 rolling dice.
   Record tick/step percentiles, event-loop delay, CPU, HTTP/join latency, and creation/removal
   churn. Proposed targets remain p95 callback interval ≤20 ms and p99 ≤33 ms, not achieved results.

## File and function inventory

| File | Changes |
| --- | --- |
| `server/game/demo-dice-policy.js` | Adds frozen limits, `DemoDiceLimitError`, `createDemoDicePolicy` and capacity/scene assertions, roll admission, seed/remove/clear and coalesced notifications. |
| `server/game/dice-roll.js` | Adds shared `rollDie` validation, policy check and unchanged physical impulse. |
| `server.js` | `TableRoom.onCreate` attaches server-selected policy and maps rejected restores to join errors; `onDispose` clears policy state. |
| `server/game/piece-capacity.js` | `ensurePieceCapacity` and `assertPieceCapacity` accept optional piece type and enforce the demo policy. |
| `server/game/piece-lifecycle.js` | `spawn` checks typed capacity and seeds dice; `removePiece` frees deadlines. |
| `server/game/handlers/pieces.js` | `registerPieceHandlers` preflights dice spawn and shares roll admission; removes duplicate `rollBody`. |
| `server/game/handlers/room-features.js` | `registerRoomFeatureHandlers` uses shared tray rolling; removes duplicate `rollBody`. |
| `server/game/handlers/placement.js` | `registerPlacementHandlers` checks dispenser item type before consuming stock or adopting a drag. |
| `server/game/scene-persistence.js` | `applyScene` preflights the full dice count; `clearGameTable` clears transient policy state. |
| `server/game/safe-message.js` | `report` handles known demo policy errors as approved notices while retaining safe transport/error boundaries. |
| `test/backend-demo-dice-policy.js` | Adds fake-clock, invalid-body, cleanup, error-boundary and notification-coalescing regressions. |
| `test/backend-piece-lifecycle.js` | Adds final creation cap, custom/hidden/tray counting, spawn cooldown, removal and ordinary-room regressions. |
| `test/backend-piece-handlers.js` | Adds cross-player/cross-handler/mixed-group/reconnect cooldown and spawn-cap regressions. |
| `test/backend-placement-handlers.js` | Adds dispenser stock/drag preservation at the dice cap. |
| `test/backend-room-feature-handlers.js` | Adds scoop/tray-toggle cooldown regressions. |
| `test/backend-scene-persistence.js` | Adds over-cap preflight atomicity, retained checkpoint/private inventory and ordinary-scene regression tests. |
| `CHANGELOG.md` | Records the demo safeguards under Unreleased. |
| `docs/REFERENCE.md` | Documents policy exports, helper signatures and runtime contracts. |
| `docs/ARCHITECTURE.md` | Documents policy ownership, preflight and save boundaries. |
| `docs/DEMO_MODE_PLAN.md` | Links current implementation and rollout status. |
| `docs/PLAN_DEMO_DICE_LIMITS.md` | This implementation, validation, rollout and file inventory. |
