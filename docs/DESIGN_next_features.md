# Next features: participation, deck browsing, and collections

Status: **participation stage 1 committed; stage 2 time-outs committed and user-approved; stage 3 self-service spectators implemented, functionality and icon UI user-approved; deck browsing implemented locally with user-reported manual tests passing; collections proposed**. Original plans
were prepared against commit `b7390c6`; foundation implementation is dated 2026-09-24.
This document covers [ROADMAP.md](ROADMAP.md) items **5/15, 22, and 18**. Recommendations below
are starting decisions for later work, not additional user-approved requirements. Recheck current
source and resolve the listed product decisions before implementing the affected slice.

The other remaining work has shorter briefs in [DESIGN_future_backlog.md](DESIGN_future_backlog.md).
Current contracts remain in [REFERENCE.md](REFERENCE.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

## Recommended order and effort

| Work | Assessment | Useful first release | Main risk |
| --- | --- | --- | --- |
| Time-out, then spectator mode | Medium-to-large change across gameplay permissions and lifecycle | GM time-out with a common interaction gate | A forgotten message or delayed operation bypasses the restriction |
| Deck browsing | Medium-to-large; substantial existing UI/transfer reuse | One private browser per deck, five card destinations | Leaking faces or losing/duplicating cards during competing operations |
| Collections | Medium; database and library UI work | Shared curated collections with local visibility toggles | Accidentally treating membership as permission to read an asset |

Implement time-out's common permission gate first, then finish spectator behavior. Deck browsing
should consume that gate from its first release. Collections can be developed independently;
design stable collection/asset identities now, but ship portable export/import separately.
These are relative scope assessments, not elapsed-time estimates. Each stage should be usable
and ready for in-app testing before proceeding to the next cohesive stage.

## Current implementation checkpoint — 2026-09-24

Historical stage-1 record at commit `c51423a`; the stage-2 checkpoint below supersedes its pending-feature statements.

**Stage 1: policy foundation is implemented; the user reports manual tests green (2026-09-24).** All 119 current table
requests have explicit capabilities and use a guarded registration layered over `safeMessage`.
Unknown registrations fail closed. Existing role and asset permissions remain in their handlers.
Tests cover the production registration inventory, blocked direct gameplay requests, independent
role/participation state, allowed observation/communication, pending library reads/saves, and
private-response/moderation suppression while policy loading is incomplete.

The server-only integration fields are `client.auth.participation`, `timedOut` and
`participationReady`; they are not yet loaded, persisted or exposed by any user control. Missing
fields preserve existing player/editor behavior. The future durable loader must set ready false
before loading and keep it false on failure. This foundation alone is **not an operational
time-out or spectator feature**. Transition cleanup, duplicate-tab propagation, migrations,
reconnect/restart policy, public status and desktop/touch controls belong to stages 2–3.

The initial capability policy follows the proposed defaults: chat/pings/highlights and hand viewing
are allowed; notebook/profile edits are personal; membership/library administration retains its
own authorization; `showStop`/`wbRelease` are cleanup. Hand reassignment and reveals are gameplay.
Mixed save/spawn requests check gameplay before work and before delayed spawning. If a save
already committed when a restriction arrives, the library record remains but no object spawns.
The pending deck draft survives a denied finish. No UI/input, database schema or query changes.

Reuse decision: retain `safeMessage`/`safeRoomTask` unchanged for errors and lifecycle recovery;
add the capability gate as a focused wrapper, and keep live asynchronous checks next to mutations.

File/function changes in this slice:

| File | Change |
| --- | --- |
| `server/permissions.js` | Add pure `canUseRoomCapability`; retain role helpers. |
| `server/game/interaction-policy.js` | Add `ROOM_MESSAGE_CAPABILITIES`, `allowRoomCapability`, `guardedMessage`. |
| `server.js` | `TableRoom.onCreate` registers its eight inline requests through the gate; `setAvatar` rechecks access/player identity after saving. |
| `server/game/handlers/cards.js` | `registerCardHandlers` uses guarded registration. |
| `server/game/handlers/library.js` | `registerLibraryHandlers` uses the gate; guard mixed save/spawn requests and delayed loads/spawns. |
| `server/game/handlers/members.js` | `registerMemberHandlers` uses the gate; hand reassignment is gameplay; delayed moderation rechecks policy readiness. |
| `server/game/handlers/movement.js` | `registerMovementHandlers` uses guarded registration. |
| `server/game/handlers/overlays.js` | `registerOverlayHandlers` uses the gate, including explicit read/cleanup exceptions. |
| `server/game/handlers/pieces.js` | `registerPieceHandlers` uses guarded registration. |
| `server/game/handlers/placement.js` | `registerPlacementHandlers` uses guarded registration. |
| `server/game/handlers/room-features.js` | `registerRoomFeatureHandlers` uses the gate with communication/read/cleanup exceptions. |
| `server/game/handlers/room-state.js` | `registerRoomStateHandlers` uses the gate; `stateSave` rechecks before acknowledgment. Lifecycle helpers unchanged. |
| `server/game/library.js` | `createLibraryOperations.sendAssetList` checks live observation access before/after reads. |
| `server/game/member-service.js` | `createMemberService.sendMembers`/`broadcastMembers` check readiness and live administration access. |
| `test/backend-library-operations.js` | Extend delayed private-list coverage to pending policy loading. |
| `test/backend-member-service.js` | Extend pending-list and broadcast coverage to pending policy loading. |
| `test/backend-interaction-policy.js` | Add inventory, predicate, direct-request, allowed-action and recovery regressions. |
| `test/backend-library-handlers.js` | Add pending-load/save denial, save-only and draft-retention regressions. |
| `test/backend-room-state-handlers.js` | Add delayed save acknowledgment regression. |
| `CHANGELOG.md` | Record the foundation under Unreleased while preserving prior entries. |
| `docs/REFERENCE.md` | Document the current API, capabilities, mixed operations and internal auth fields. |
| `docs/ARCHITECTURE.md` | Document guard ownership, reuse and the durable-loader/transition boundary. |
| `docs/ROADMAP.md` | Mark foundation progress without marking time-out/spectators complete. |
| `docs/DESIGN_next_features.md` | Record this checkpoint and remaining stages. |
| `docs/DESIGN_future_backlog.md` | Cross-reference the common foundation; keep backlog features pending. |

Verification: focused server regressions and `npm run check` pass (lint, formatting, CSS
validation and all 670 tests). The full run required local socket/subprocess access outside the
restricted sandbox. Documentation relative links and `git diff --check` pass. No client input/DOM/
layout or database-query/schema changes were made, so the additional device/input/component/DB
suites were not run. The user reported manual tests green on 2026-09-24 for this foundation slice.
The suggested smoke-test scope was ordinary drag/group drag, draw/inspect/place, tray roll,
chat/pings, save/load and library Save+Spawn. Specific devices, browsers and multiplayer scenarios
were not itemized, so this sign-off does not establish a full device matrix. Restriction behavior
still has automated server coverage only; no user-facing control exists yet. Applying this slice
requires a server restart and client refresh; no migration is required.

## Stage 2 time-out checkpoint — 2026-09-24

The foundation was committed as **`c51423a`** after user-reported manual tests passed. The next
cohesive slice implements **durable GM time-outs**; the user confirmed functionality and approved
the final compact member-list UI. Specific device and edge-case coverage was not itemized.
Spectator entry, seating and turn exclusion remain stage 3. No changes have been pushed.

Resolved first-release policy: GMs manage players/helpers, owners/site admins can also manage
GMs, and self/owner/site-admin targets are excluded. Time-outs have no expiry or reason field.
They preserve roles, seats, turn positions, hands and trays. Chat, pings/highlights, ordinary public
inspection, own-hand viewing, personal notes and authorized administration remain available.
Deck peeks, reveals, hand rearrangement/play, shared table changes and spawning are gameplay.
Room info → Members has the same apply/lift buttons on desktop and touch. The room sees status
badges, and affected players see a persistent explanation and inert mutation controls.

Migration 018 stores policy separately from scenes/game snapshots and cascades on membership
removal. Role/user rows are locked and live authority is rechecked before commit. Changes are
serialized per room/account and propagated to every tab; joins/reconnects load policy before
accepting gameplay. Read failures fail closed. A committed write remains effective if the actor
is revoked during commit, but that actor receives no success response. Failed writes neither
publish policy nor acknowledge success. Restart the server to apply migration 018 with the existing
migration role, then refresh browsers; manual-migration installations must apply 018 first.

Reuse decision: move the existing capability registry into `shared/` for server and browser use;
retain the established error boundaries and per-handler permissions. Extract only the shared
active-interaction cleanup from departure, reuse pending-inspection recovery, and expose focused
cancellation methods on existing UI controllers. Time-out does not run final departure cleanup.
No new input device path, build step, icon asset, environment variable or infrastructure is added.

File/function inventory for this slice (no unrelated helper removals):

| File(s) | Added/changed behavior |
| --- | --- |
| `postgres/018_room_participation.sql`, `postgres/schema.sql` | New policy table and fresh-install migration baseline. |
| `server/participation-queries.js` | Add `createParticipationQueries` and transactional `setPlayerTimeout`. |
| `server/database.js`, `db.js` | Register and export the production query. |
| `server/room-queries.js` | Extend `memberRow`, `getMembership`, `listMembers` with policy/admin status. |
| `server/room-access.js` | Extend `readAccess`, reconnect/revalidation; add `setParticipation` and pending-read invalidation. |
| `server/game/participation.js` | Add `createParticipationService` with per-target serialization and committed-policy publication. |
| `server/game/interaction-cleanup.js` | Add shared `stopPlayerInteraction`, including recoverable inspection cleanup. |
| `server.js` | Register service; add `setPlayerTimeout`/`onParticipationChanged`; update `onJoin` and reuse cleanup in `onLeave`. |
| `shared/room-capabilities.js`, `server/game/interaction-policy.js` | Move/re-export the registry; classify the new administration request (120 total). |
| `server/message-validation.js`, `server/game/handlers/members.js` | Add strict `playerTimeoutPayload` and register the guarded handler. |
| `server/game/member-service.js` | Send per-recipient stable `isSelf` membership data. |
| `server/game/schema.js` | Append public `Player.timedOut`. |
| `public/table/participation.js` | Add `canInteractWithTable`, `canSendTableRequest`, `createParticipation`; wrap sends and synchronize controls/status. |
| `public/client.js` | Wire policy before room binders; inject capability predicate and coordinate cancellation. |
| `public/table/input-router.js` | Gate gameplay intents while preserving camera, inspect and communication gestures. |
| `public/table/hand.js` | Gate hand dragging/reordering; extend `cancelGesture` to reset modes. |
| `public/table/piece-drag.js`, `public/table/selection.js` | Add cancellation for pointer capture, armed movement, marquee and selection mode. |
| `public/table/inspection.js` | Add cancellation; discard delayed drawn-card previews while restricted. |
| `public/table/overlays.js`, `public/table/whiteboard.js` | Expose cancellation using existing exit/selection/redraw behavior. |
| `public/table/piece-ui.js`, `public/table/piece-labels.js`, `public/table/table-shell.js` | Restrict piece-menu actions; expose existing close behavior. |
| `public/table/membership.js`, `public/ui/rows.js` | Render apply/lift buttons and status; send normalized account targets and show acknowledgment. |
| `public/table/presence.js` | Add live time-out badges and gate turn-order drag controls. |
| `public/editor/editor-panel.js` | Mark dynamic spawn/apply/load/setup buttons as table mutations. |
| `public/table.html`, `public/styles.css` | Add notice, mutation-control markers, help and responsive restriction styling. |
| `test/backend-participation.js` | Add propagation, persistence/reconnect, stale authorization, failure, queue and inventory cleanup regressions. |
| `test/backend-participation-queries.js` | Add hierarchy, protected-target and transaction rollback regressions. |
| `test/participation.js`, `test/input-router.js` | Cover hydration, request policy, lift/restrict transitions and permitted inspection/camera input. |
| `test/backend-member-handlers.js`, `test/backend-room-queries.js` | Update production registration inventory and member result expectations. |
| `test/integration/database.js` | Exercise migration 018, real query permissions, durable reload and membership cascade. |
| `scripts/component-parity.mjs` | Exercise production client transition, apply/lift member buttons, self protection and notice bounds. |
| `CHANGELOG.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md` | Record behavior, contracts and ownership. |
| `docs/GESTURES.md`, `docs/RELEASING.md`, `docs/ROADMAP.md` | Record touch path, upgrade requirements and implementation status. |
| `docs/DESIGN_next_features.md`, `docs/DESIGN_future_backlog.md` | Record this checkpoint without advancing unrelated backlog work. |

Automated verification: `npm run check` passes (lint, formatting, CSS validation and **689 tests**).
`test:input` passes **57/57**, `test:components` passes all configured profiles including production
client apply/lift and member-button coverage, `test:devices` passes all **7** profiles, and
`test:integration` passes all **8** PostgreSQL tests using the runtime role. After the final inert
selector expansion, the focused participation tests pass. Local test servers, browser subprocesses
and database setup required sandbox escalation. The fixture reports only its existing missing
`/favicon.ico`; no feature-related browser errors remain. These checks do not establish a real
server restart, physical touch feel or two-client multiplayer correctness. Source verification used
graph generation `2026-09-24T14:05:18Z`; schema/HTML parser gaps were read directly. Documentation
links and `git diff --check` were also checked.

Manual smoke test after restart/refresh:

1. With two accounts, use Room info → Members to apply/lift time-out. Check badges, notice,
   disabled controls and desktop right-click/touch long-press inspection. Camera/chat/own-hand
   viewing should work; dragging, deck peeking, hand play, timers/scores and library spawning should not.
2. Apply while dragging one piece/a group, rearranging a hand, drawing or inspecting a drawn card.
   Check no throw, stuck pointer mode, orphaned reveal or lost/duplicated card; include a full table.
3. Open a second tab for the target; confirm both restrict/lift. Refresh/reconnect and restart the
   server while restricted; policy should persist. Load a scene and verify it does not lift policy.
4. Check GM/player/helper hierarchy and owner/self protection, then lift and resume normal play
   with the same hand, seat and tray. Include real touch hardware; automated tests cannot establish
   gesture feel, GPU performance or live multiplayer ordering.

### Member-list UI follow-up — 2026-09-24

The user reports that time-outs function correctly, and supplied a screenshot showing member
names squeezed away and moderation buttons clipped in the narrow dock. This is functional
sign-off for the time-out slice, not a claim that every manual/device scenario was tested.
The user approved the final compact UI and requested a commit; no additional migration/restart
is required for these presentation changes.

- `public/ui/rows.js`: extend existing `memberRow` with a separate identity/status block,
  explicit self label, danger styling for Kick/Reject, and no empty action container. Existing
  callbacks/role rules are reused; no new controller or helper is added.
- `public/styles.css`: replace the forced single-line member layout with a two-column action
  grid and wrapped names. Following user visual approval, action heights/spacing were reduced
  by roughly half: 15px desktop and 22px coarse-pointer minimum heights. Compact/full modes
  keep visible labels.
- `scripts/component-parity.mjs`: add a member-dock fixture covering owner/self, ordinary,
  restricted, pending and GM rows; assert readable identities, no horizontal clipping, and
  unclipped labels at 270/240/210px dock widths in both compact/full modes.
- `CHANGELOG.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`, this plan: record the fix,
  current presentation contract and scoped functional sign-off.

Desktop/touch screenshots were inspected. `check` passes all 689 tests and `test:devices`
passes all seven profiles. `test:components` passes desktop and touch, including the new narrow-dock
fixture. Documentation links and `git diff --check` pass. The acceptance check is a browser refresh followed by Room info → Members
on desktop/touch, including long names and End time-out. Input routing and database behavior
are unchanged in this UI follow-up.

## Verified starting points

The following are existing behavior at the baseline, not proposed APIs:

| Area | Existing code and relevant contract |
| --- | --- |
| Permissions | [permissions.js](../server/permissions.js) defines player/helper/GM/owner ranks and target-management rules. Site-admin status is separate from room rank. |
| Message boundary | [safe-message.js](../server/game/safe-message.js) catches failures and rejects revoked clients; it does not itself classify allowed gameplay actions. |
| Membership | [room-access.js](../server/room-access.js) rechecks authorization on reconnect. [server.js](../server.js) assigns seats, claims hands, advances turns, and releases held pieces/whiteboard ownership on departure. |
| Player state | [schema.js](../server/game/schema.js) exposes public player presentation, role, seat, hand count and turn order. New participation fields would be new wire state. |
| Private cards | [cards.js](../server/game/handlers/cards.js) implements `drawInspect`/`inspectPlace`. A peek currently pops the top card into server-only `pendingInspect`; placement offers hand, field-up/down, or return to deck. |
| Transfers/recovery | [card-transfer.js](../server/game/card-transfer.js) centralizes table placement and concealed faces. [inspection-recovery.js](../server/game/inspection-recovery.js) returns a pending card or keeps it recoverable when placement is blocked. |
| Persistence | [hand-state.js](../server/game/hand-state.js) maps live session hands to durable account hands. [scene-persistence.js](../server/game/scene-persistence.js) reconstructs inspected cards in scenes and saves account hands/turn state in game snapshots. |
| Inspection UI | [inspection.js](../public/table/inspection.js) owns card inspection and destination actions. Existing `placeDrawn` closes optimistically; browsing needs acknowledgments before advancing. |
| Asset access | [library.js](../server/game/library.js) supplies type-specific lists and rechecks private-list access after reads. [library-queries.js](../server/library-queries.js) filters public assets unless admin private access is requested. |
| Library UI | [editor-panel.js](../public/editor/editor-panel.js) caches per-kind lists and renders built-in/custom sources. Dispensers are a second view of prop assets, not another asset identity. |

Source inspection and graph coverage checks found no recorded gaps in these evidence files.
This is a task-focused baseline, not an exhaustive audit of every mutation or asset reference.
The implementation stages explicitly include those inventories.

## Stage 3 spectator checkpoint — 2026-09-24

**Implemented; functionality and final icon UI approved by the user for commit (2026-09-24).** The user chose self-service
spectating. Use **More → Spectate / Return to play** on desktop/touch or **Watch** in the lobby.
The preference is durable per room/account, including owners/admins, and applies across tabs.
It does not grant admission, change role or clear a GM time-out. Converted players keep their
seat/hand/tray; new observers use seat −1, bird's-eye camera and no turn slot. Turns and seat-based
dealing skip spectators. Returning seatless tabs reserves a distinct free seat for each before
writing; if any cannot fit, the account stays spectating. Eight playing seats and 24 total
tracked connections (including reconnect reservations) are separate limits.

The implementation extends the existing participation service, room-access lifecycle, request
registry, cleanup and client controller. A focused `player-seats.js` module shares allocation
and turn rules between real join/transition paths. Self-mode writes have a separate database
authorization boundary from GM time-outs; they reuse serialization without granting moderation.
Private hand storage/delivery and scene/game snapshot formats retain their existing boundaries.

### Files and functions changed

| Files | Change |
| --- | --- |
| `postgres/019_spectator_mode.sql`, `postgres/schema.sql` | Add durable mode with a checked player/spectator enum and migration baseline. |
| `server/participation-queries.js`, `db.js` | Add/export `setSelfParticipation`; preserve both policy fields in timeout results. |
| `server/room-queries.js` | Extend `memberRow`, `getMembership`, `listMembers` with durable mode. |
| `server/room-access.js` | Extend reads, publication, reconnect and revalidation; add `clientsFor`, `beginParticipationChange`; bound admission and invalidate overlapping reads. |
| `server/game/participation.js` | Share per-account `queue`; add self `setParticipation`, reservation-aware `seatFor`; preserve timeout independence. |
| `server/game/player-seats.js` | Add `freePlayerSeat`, `turnPlayers`, `advancePlayerTurn`, `createJoinedPlayer`, `applyPlayerParticipation`, private `nextPlayerOrder`, seat/cap constants. |
| `server.js` | Delegate join/transition/turn logic; add self handler delegation and Watch authorization; exclude spectators from turn order and seat dealing. |
| `server/game/schema.js` | Append public `Player.participation`. |
| `server/message-validation.js`, `server/game/handlers/members.js` | Add strict `participationPayload` and self-only guarded registration. |
| `shared/room-capabilities.js` | Classify `setParticipation` as personal; 121 requests. |
| `public/table/participation.js` | Extend `canInteractWithTable` and `createParticipation` with mode hydration, notices, pending requests and self toggle. |
| `public/client.js` | Wire self controls; handle explicit Watch join and remove the temporary URL flag after success. |
| `public/landing.js` | Extend `enterRoom` and `renderRoomList` with admission-aware Watch. |
| `public/table.html` | Add More button and player-facing help. |
| `public/table/presence.js` | Observer camera/seat handling, spectator badges and eligible-only turn controls/payloads. |
| `public/table/table-shell.js` | Separate player and spectator counts in room info. |
| `public/table/trays.js` | Guard `open` for seatless observers. |
| `public/ui/rows.js` | Add spectator status to `memberRow`. |
| `test/backend-spectators.js` | Exercise real access/service/seat helpers: transitions, turn skipping, all-observer rooms, duplicate tabs, reservations, failures, reconnect and cap. |
| `test/backend-member-handlers.js`, `test/backend-room-queries.js`, `test/backend-schema.js` | Cover new handler authorization/validation, member defaults and wire status. |
| `test/participation.js`, `test/presence.js`, `test/trays.js` | Cover self button/ack/error, timeout independence, observer camera and no phantom tray. |
| `test/integration/database.js` | Exercise migration 019, self-mode persistence, timeout preservation, admission/admin checks and invalid-mode rollback. |
| `scripts/component-parity.mjs` | Extend real client/roster fixtures; add lobby Watch layout across desktop/touch profiles. |
| `CHANGELOG.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md` | Record feature, current protocol/seat contracts and persistence boundaries. |
| `docs/GESTURES.md`, `docs/RELEASING.md` | Document desktop/touch paths and migration/restart/refresh. |
| `docs/DESIGN_next_features.md`, `docs/DESIGN_future_backlog.md`, `docs/ROADMAP.md` | Resolve self-service choice and distinguish local implementation from pending manual verification. |

### Spectator icon follow-up — 2026-09-24

The user reports spectator functionality works great and requested Tabler icons. This is
functional sign-off, not confirmation of every scenario below. Lobby Watch and More → Spectate
now use `eye`; Return to play uses `device-gamepad`.

- `public/landing.js`: extend `renderRoomList`'s existing icon mapping for Watch.
- `public/table/participation.js`, `public/client.js`: inject/reuse `setIcon` and `setBtnLabel`
  in `createParticipation`, retaining icon nodes, visible labels and accessible names.
- `scripts/build-icons.mjs`, `public/table.html`, `public/index.html`, `public/admin.html`: add
  device-gamepad, regenerate all sprites, and give the More button standard icon/label markup.
- `test/participation.js`, `scripts/component-parity.mjs`: adapt the controller fixture and
  verify the actual icon/label transitions and lobby icon in existing browser checks.
- `CHANGELOG.md`, `docs/REFERENCE.md`, this checkpoint: record the visual follow-up and functional
  sign-off. Refresh browsers for the icons; this follow-up adds no migration or server change.

### Radial icon follow-up — 2026-09-24

At user request, `public/table/table-shell.js` extends the existing `RADIAL_ICONS` map inside
`bindControls`: Labels uses `label`, and Highlight uses `focus-2`. No functions are added or
removed. `scripts/build-icons.mjs` adds these two Tabler names; `npm run build:icons` regenerates
`public/table.html`, `public/index.html` and `public/admin.html`. `CHANGELOG.md` and this checkpoint
record the change. Refresh browsers to load the new sprites.

### Verification and manual smoke tests

Automated verification passed: `npm run check` (701 tests plus lint/format/CSS checks),
`test:input` (57 cases), `test:components` (desktop/touch), `test:devices` (seven profiles) and
`test:integration` (nine database cases). A separate browser check clicked the
real lobby Watch button on desktop and touch and verified its destination URL. Graph coverage
and direct-source checks supplement the tests; neither establishes live multiplayer or device feel.

**Restart the server** to apply migration 019, then **refresh all browsers**. Installations with
automatic migration disabled must apply 019 with the schema-owner connection first.

1. With two accounts, switch through More while holding a piece or inspecting a drawn card.
   Check cleanup, spectator badge/notice, blocked manipulation and permitted chat/camera/inspection.
   Return and verify the same seat, private hand and tray; no lost or duplicated cards.
2. Use lobby Watch on desktop/touch, including a table with all eight seats reserved. Confirm a
   seatless observer camera and no phantom tray. Return should explain a full table; retry after
   a seat is released. Check an all-spectator room and its first returning player's turn.
3. Spectate during the middle player's turn: the next eligible player gets the turn. Check
   roster reorder and seat-based dealing omit spectators, including those retaining seats.
4. Open duplicate tabs, toggle once, and verify both change. Refresh/reconnect and restart to
   check persistence. Return requires space for every seatless tab; reconnect during a pending
   mode write may require retrying the join.
5. Apply a GM time-out, then self-spectate and return. Time-out must stay active. Check owner/GM
   moderation while voluntarily spectating, unchanged admission rules, and real touch controls.

## 1. Time-out and spectator mode

### Product behavior and recommended policy

Keep participation separate from role. A helper in time-out stays a helper; a spectator does not
become a new rank below player. Two independent states avoid accidental release of restrictions:
`participation = player | spectator` and `timedOut = boolean`. Interaction requires player mode,
no time-out, active membership, and the normal permission for the requested operation.

Recommended first-release behavior:

- GMs can apply/lift time-out through the player/member list, on desktop and touch. Reuse the
  existing target-management hierarchy: only owners manage GMs; nobody times out an owner.
  Do not let a target lift their own time-out. No timed expiry, reasons, or moderation history in v1.
- Show a clear status badge to the room and a persistent explanation to the affected player.
  Camera, zoom, local settings, chat, and ordinary public inspection remain available.
- Allow pings/highlights as communication, with existing throttles. Private hand viewing remains
  available to its owner; taking, playing, reordering, or revealing cards is blocked. A deck peek
  currently changes inventory, so it is not an allowed read-only action.
- Deny manipulation of tabletop objects, dice trays, shared drawings/overlays, scores, timers,
  turn advancement, room setup, and library actions that spawn/apply content. Personal notebook
  edits and local library browsing can remain available. Account/library administration uses its
  own permissions and must not provide an indirect way to change this table.
- Membership moderation remains usable by authorized owners/GMs even while they voluntarily
  spectate, so they can restore participation. This does not exempt their gameplay commands.
- Changing from spectator to player must not clear an independent time-out.

Spectator seat recommendation: new spectators join without a playing seat, turn slot, or tray.
An existing player who switches to spectator keeps their reserved seat, hand, and physical tray
in v1, but is skipped by turn passing and cannot manipulate them. This avoids silently deleting
tray dice or introducing player inventories as a dependency. Releasing occupied spectator seats
can be a later explicit workflow. Returning to player mode allocates a seat if needed; if none
is available, stay spectating with an explanation. Never represent a seatless viewer as seat zero.

**Decided (2026-09-24):** the user chose self-selected spectator entry. Stage 3 implements
self-service only, retaining reserved seats for converted players, communication highlights and
own-hand viewing. GM assignment and explicit release of reserved seats remain outside this slice.

### Server ownership and persistence

Add a focused participation service; extend existing role helpers rather than replacing them.
Store durable room/account policy separately from portable scenes and gameplay snapshots, using
a new numbered migration. Suggested record: `(room_id, user_id, participation, timed_out, version)`
with foreign keys and a unique room/account key. Membership removal should clean up its policy.
Do not use session ID as the durable restriction key. Apply a change to all live connections for
that room/account, and reload it on joins/reconnects before accepting gameplay commands.

A failed policy read must not default to unrestricted access. Serialize changes per target account;
validate the actor/target, write the change durably, recheck live authority around asynchronous
work, then publish the effective policy and acknowledgment. Do not report a successful restriction
if its database write failed. Define handling for a simultaneous revoke/demotion in the service.
A new account is a different identity; this does not replace room admission controls.

Expose only status needed by the UI in public player state. Management messages identify an
account/member through validated identifiers, never through a client-supplied rank. Proposed
messages `setParticipation` and `setPlayerTimeout` are now implemented; see the reference guide
for their exact payload and authorization contracts.

### One enforceable interaction policy

Inventory the production message registrations before coding. Include handlers still registered
in `server.js`, group operations, hand/inspection commands, tray actions, library spawning, and
operations that finish after database reads. Classify each by capability: observation,
communication, gameplay mutation, or administration.

Build a focused gameplay registration wrapper around the existing `safeMessage` boundary, with
an explicit capability policy and deny-by-default handling for unclassified gameplay messages.
Keep error handling generic; do not bury role changes inside unrelated handlers. Add a test that
compares the classifications with actual production registrations, as well as behavior tests.
Recheck permission at mutation/response time after every asynchronous gap. Server-driven physics,
recovery, and persistence must remain runnable even when a client's input is blocked.

On entering a blocked state, synchronously stop further player writes and perform shared cleanup:
release owned pieces without an extra throw, clear movement targets and group drags, release the
whiteboard, stop active reveals, cancel deck browsing, and return/recover any pending inspection.
Reuse the meaningful cleanup currently in `onLeave`; extract it with explicit options so changing
participation does not also disconnect the player, delete their tray, or park their hand as
available for reassignment. Capacity failures retain server-owned recoverable cards.

Client controls mirror the server policy: disable unavailable actions, stop active gestures, close
mutation editors, and display the restriction. Route this through existing input/controller seams;
disabling pointer events alone is not enforcement. Initial state may be incomplete: show a safe
loading state until participation and pieces have arrived.

### Implementation stages and acceptance

1. **Policy foundation — committed as `c51423a`, user-reported manual tests green (2026-09-24):** classify messages, add the pure capability predicate and guarded
   registration, and audit delayed mutations. No feature is complete until direct protocol calls
   are denied consistently; normal player/GM behavior must still pass existing tests.
2. **Time-out — implemented, user-approved functionality and UI:** durable policy, GM controls, public status, transition cleanup, reconnect behavior.
   Test during single/group dragging, drawing, inspection, and an in-flight library spawn. Verify
   duplicate tabs, restart, failed DB writes, demotion/revocation, and a full table.
3. **Spectators — implemented, user-approved functionality and UI:** entry/exit controls, seatless join handling, turn exclusion, reserved-seat
   conversion, preserved hands/trays, and local observer camera controls. Audit seat consumers
   before choosing a sentinel or optional seat field. Verify an all-spectator room and returning
   players when every seat is reserved.
4. **Completion:** two-client desktop/touch tests confirm blocked mutations cannot be sent through
   any visible control or forged request; permitted chat/camera/inspection still works; no cards
   disappear; reconnect cannot bypass restrictions; scene loading cannot lift them.

Expected change areas: permissions, room access, member handlers, schema, room lifecycle,
message registrations, player UI, input routing, and database queries/migration. Run `check`,
`test:input`, `test:components`, `test:devices`, and `test:integration` as applicable. Document a
server restart/client refresh and migration requirements; keep database migration/runtime roles separate.

## 2. Browse through a deck

### Product behavior and access

Add **Browse deck…** to the deck's right-click/long-press menu. Opening it does not deal a card or
alter deck order. Reuse inspection presentation for one card at a time, with Previous/Next,
position/count, Close, and these actions: **Add to hand**, **Place face-up**, **Place face-down**,
**Put on top**, **Put on bottom**. Touch uses visible buttons; keyboard navigation is active only
inside the browser and must not also move table objects.

Recommended access: a GM-set per-deck `browseAccess` with `gm` or `players`, defaulting to `gm`
for concealed decks. Open/double-sided tile decks use the same GM-only default. This is an
explicit permission to see the contents, not automatic game-rule enforcement. Spectators and
timed-out players cannot start a browsing session. Existing top-card Inspect remains a separate
action and policy; this feature should not silently change it.

**Decided (2026-09-24):** the user approved GM-only defaults and a per-deck player toggle.
This implementation defaults every deck, including open tiles, to GM-only. A top-card Inspect
permission never implies permission to enumerate a deck.

### Private session and conflict strategy

Prefer a single exclusive browsing lease per deck for v1. A second browser receives a busy message.
Allow table movement if it does not alter inventory; lock operations that change content/order,
card metadata used by browsing, or remove/replace the deck. Audit draws, peeks, shuffle, split,
combine, card absorption on release, removals, and scene/reset operations—not just the Browse UI.
Normal conflicting actions are rejected with a useful notice. GM delete/reset/access changes
may cancel the lease first; cancellation is completed before their mutation proceeds.

Keep cards in `deckCards` until a destination succeeds. Store the browser session only on the
server: actor session/account, deck ID, opaque session token, revision, cursor, expiry, and an
opaque handle for the displayed entry. Never identify a card solely by its face string: identical
cards and tiles can occur multiple times. No copied full-deck manifest is sent to the browser.
A read-only cursor into a leased array is sufficient initially; every successful mutation advances
the revision and issues a new entry handle.

Use a short renewable idle lease with named limits; a starting proposal is 60 seconds idle,
refreshed by navigation/actions or a modest heartbeat while the UI is active. Expiry, close,
disconnect, lost membership, time-out, spectator conversion, and deck removal all cancel it.
Expose a content-free busy status if useful. Do not publish card indices, faces, or browsing
history in synchronized state, chat, logs, or public broadcasts.

Implemented protocol (the reference also documents heartbeat, access toggles and exact replies):

| Request | Server response/behavior |
| --- | --- |
| `browseDeck {deckId}` | Validate participation/access and acquire lease; privately return token, revision, current card, position and count |
| `browseStep {token, revision, direction}` | Validate owner/expiry/live access and return one selected card privately |
| `browseAction {token, revision, entryToken, action, requestId}` | Apply one of the five destinations; return explicit success or recoverable failure |
| `closeDeckBrowse {token}` | Release own lease; safe to repeat, including after permission loss |
| Expiry/revocation/reset | Send a private closed reason and dispose local card previews |

Bound every field and navigation rate. Reject stale/foreign tokens and out-of-date revisions.
Deduplicate action requests for the session, so retrying after a lost acknowledgment cannot draw
a second card. A repeated acknowledged request returns the previous result. Reconnect starts a
fresh browsing session and receives no obsolete face payloads. Previously seen faces cannot be
made unknown; the guarantee is authorized delivery and no further disclosure after access loss.

### Transfers, ordering, and saves

Reuse card metadata helpers and `spawnTableCard`; keep geometry, per-card back, open/double-sided
status, and concealed front intact. Do not drive `drawInspect` repeatedly: it consumes the top
card and would change order just by browsing.

For each action, validate current permissions/lease and destination capacity first. Stage the
selected entry, attempt the destination through shared transfer behavior, then commit removal,
count/cover/collider updates and the new revision as one synchronous room operation. If creation
can throw after partially mutating, provide rollback/recovery; copying to the hand first and then
returning early must not leave a duplicate. Avoid awaits inside the inventory commit. Empty-deck
removal closes the browser only after the last transfer succeeds.

`deckCards` uses a bottom-first array: top is the final entry. Put on top removes the selected
entry and appends it; put on bottom removes it and prepends it. Preserve every other card's relative
order. Moving an already top/bottom card is a successful no-op, still acknowledged without losing
inventory. Navigation after mutation selects a neighboring remaining card deterministically and
reports its new position; the client waits for that response before replacing its preview.

A blocked field placement leaves the selected card in its original position and keeps the browser
open for another destination. After placement, the existing physics engine handles the object;
no legal-move checks or scoring are added. Low-stock labels continue deriving from authoritative
counts, and container labels/settings remain attached to the deck.

Because browsing alone leaves cards in their deck, existing snapshots can serialize contents
normally. Leases/tokens/cursors are transient and never saved. Existing `pendingInspect` recovery
still applies to the old Inspect path; refuse browsing while that deck has a pending inspection
unless it has been safely resolved. Ensure saving does not duplicate a browse card as an extra
inspection recovery card. Loading any snapshot invalidates old browser sessions.

### Implementation stages and acceptance

1. **Private service and lease coverage:** implement authorization, cursor/revisions, expiry and
   conflict checks with deterministic timer tests. Inventory every content mutation, including
   physics-release absorption. Prove unauthorized clients receive no card faces.
2. **Transfers:** implement all five actions with order/conservation tests. Include duplicates,
   tile-specific backs, open tiles, one-card decks, capacity failure, double-click/retry, and an
   injected destination failure. Integrate participation checks and cancellation.
3. **UI:** extend inspection presentation with explicit browse state or a focused browse controller
   that uses its preview renderer. Keep hand/top-card inspection semantics separate. Add desktop,
   keyboard, touch and loading/error states; bound and dispose preview textures.
4. **Multiplayer/lifecycle verification:** two users race to browse; another tries shuffle/draw/
   combine/absorb/delete; the browser disconnects or becomes timed out; save/reload occurs mid-view.
   Cards/count/order remain correct, no unseen faces leak, and every lease eventually releases.

Likely ownership: new focused server browsing service and handler family; existing card-transfer,
deck-state, piece-lifecycle, persistence and inspection UI seams. A global transaction framework
or permanent card-ID migration is not required by this initial design. Run `check`, `test:input`,
`test:components`, `test:devices`; add integration checks only if the chosen persistence changes need them.

## Deck browsing checkpoint — 2026-09-24

**Implemented locally; user reports manual tests passing (2026-09-24).** The user chose GM-only by default with a
per-deck player toggle. The first usable slice includes private navigation and all five card
destinations, bounded leases/receipts, conflict guards and desktop/touch controls. No database
migration is needed. Restart the server and refresh browsers before testing.

Reuse decision: keep the existing inspection renderer and card-transfer rules. A focused private
lease service owns cursor/entry identity and synchronous inventory commits; a separate small
browser controller owns UI/pending state. `syncOpenCover` moves out of the handler module so both
ordinary draws and browsing share the cover update. Existing cleanup, persistence and piece
lifecycle seams cancel leases and preserve the policy without a new transaction framework.

### Files and functions changed

| Files | Changes |
| --- | --- |
| `server/game/deck-browsing.js` | Add `createDeckBrowsing` with start/step/action/heartbeat, access setting, bounded receipts, expiry and cancellation; internal transfers recover on destination failure. |
| `server/game/handlers/deck-browsing.js` | Add `registerDeckBrowseHandlers`, using guarded registration and strict payloads. |
| `server/message-validation.js` | Add `deckBrowsePayload` for the six request shapes. |
| `shared/room-capabilities.js` | Classify six new requests, 127 total. |
| `server.js` | Construct/register the service and clock sweep; cancel on disposal; guard seat dealing; extend `addToHand` to defer notification until commit. |
| `server/game/handlers/cards.js`, `server/game/deck-sync.js` | Guard draws/shuffle/split/combine, preserve restrictive combined access, and move `syncOpenCover` into a shared server module. |
| `server/game/handlers/pieces.js` | Guard open-state changes and non-GM removal of browsed decks. |
| `server/game/piece-lifecycle.js` | Preserve access on spawn, cancel on removal, and prevent absorption into leased decks. |
| `server/game/scene-persistence.js`, `server/game/interaction-cleanup.js` | Cancel sessions on clear/load and participation/departure cleanup. |
| `server/deck-state.js` | Extend `deckSpawnProps` to preserve browse access through split/snapshot paths. |
| `public/table/deck-browsing.js` | Add `createDeckBrowser`: pending controls, private previews, navigation/actions, heartbeat, close and scoped keyboard input. |
| `public/table/inspection.js` | Add browse-preview entry/close methods and owned-resource disposal; keep drawn/hand semantics separate. |
| `public/rendering/graphics.js` | Add `createCardBrowsePreview`, borrowing resident textures/geometry and disposing owned materials/new private textures. |
| `public/client.js`, `public/table/piece-ui.js` | Wire the actual controller/renderer and Browse/access-toggle menu paths. |
| `public/table.html`, `public/styles.css` | Add responsive action panel with existing icons/tokens and in-app help. |
| `test/backend-deck-browsing.js` | New real service/handler tests for privacy, access, exclusivity, five destinations, stale/duplicate requests, failure recovery and lifecycle. |
| `test/backend-card-handlers.js`, `test/backend-piece-lifecycle.js`, `test/backend-deck-absorption.js` | Verify restrictive combine access, split/snapshot restoration and recoverable drops on leased decks. |
| `test/backend-interaction-policy.js` | Register the real handler family in capability-inventory coverage. |
| `test/inspection.js`, `scripts/component-parity.mjs` | Verify preview ownership/cancellation and browser buttons, key isolation, late replies, textures and responsive bounds. |
| `CHANGELOG.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md` | Record feature, protocol and privacy/resource boundaries. |
| `docs/GESTURES.md`, `docs/RELEASING.md` | Record input paths and restart/refresh requirements. |
| `docs/ROADMAP.md`, `docs/DESIGN_next_features.md`, `docs/DESIGN_future_backlog.md` | Record the decision, local implementation and user-reported manual-test sign-off. |

Automated checks passed: `npm run check` (717 tests plus lint/format/CSS checks),
`test:input` (57 cases), `test:components` (desktop and touch) and `test:devices` (seven profiles).
No database schema/query changes require integration tests. The user reported manual tests green
on 2026-09-24; individual scenarios and devices were not itemized. The checklist below remains
a smoke-test reference, without implying exhaustive multiplayer or real-device coverage.

### Manual smoke tests

1. With a GM and player account, verify Browse is initially GM-only. Enable player browsing on
   one deck; verify the other remains restricted. Spectators/time-outs remain blocked. Toggle
   access off during a player session and confirm closure.
2. Browse duplicate cards, custom tiles/backs and a one-card deck. Try every destination and
   confirm counts/order, private hands and face-down concealment. Close without moving anything;
   the original order should remain. Include a full table, then free space and retry.
3. While another client browses, try draw/peek/shuffle/split/combine, change open mode, and drop a
   loose card on the deck. Inventory must remain recoverable. A GM delete/reset should close the
   session; moving the deck should still work.
4. Disconnect, time out or spectate while browsing, then reconnect. Save while viewing and load
   afterward: cards/access survive; the old browser does not. Test actual touch navigation,
   preview rotation and keyboard focus/Esc on desktop.

## 3. Custom asset collections

### Scope and recommended ownership

Recommend **administrator-curated, installation-wide collections** for v1, matching today's
custom-asset curation permissions. Any viewer may locally show/hide available collections; that
preference does not change the room or another player's library. A collection can contain several
asset kinds and an asset can belong to several collections. Built-ins remain outside collections.

**Decision to revisit:** personal per-account collections versus shared curated collections.
If personal organization is preferred, decide before the migration: scope list/read/write rules
by account rather than inventing a room-GM permission that grants global library administration.
The model below assumes shared collections with private/admin-only and published visibility.

Creating a collection does not publish its assets. Collection membership does not confer asset
read, edit, spawn, or export access. Deleting a collection removes memberships, never the assets.
Removing an asset from one collection leaves it in the library and other collections.

### Data model and authorization

Use the next unused numbered migration, plus query tests and runtime-role grants. Suggested tables:

- `asset_collections`: ID, bounded name, creator account, `is_public`, revision and timestamps.
  Match current site-admin curation authority rather than implying creator-only ownership.
- `asset_collection_items`: collection ID, canonical asset kind, asset ID and optional display
  order; unique `(collection_id, kind, asset_id)`. Cascade collection deletion to these rows only.

Canonical kinds follow existing stored assets: deck, board, mat, prop, scene, sky, dice. A tile
set is a deck; a dispenser is a prop. The same asset shown in multiple tabs must not acquire two
independent memberships. Rulebooks can add a new supported kind later.

Current assets live in separate tables. A polymorphic `(kind, asset_id)` is not a foreign key to
all of them: explicitly allowlist kind-to-query mappings, validate existence/access on writes,
and define asset-deletion cleanup. Never interpolate an arbitrary client kind as a SQL identifier.
Perform membership changes transactionally; use revision checks to prevent two editors silently
replacing one another's changes. Restrict names, page sizes, collection count and batch additions
with named limits chosen from a realistic library fixture.

List only collections visible to the caller and intersect their entries with asset permissions.
Counts and previews must describe the visible intersection, not private totals. A public collection
containing private items must not expose those IDs, names, thumbnails or dependencies. Admin
private access is rechecked after asynchronous reads, matching existing asset-list delivery.
Reject unauthorized mutations server-side even if the management UI is hidden.

Initially use collection lists/membership responses alongside existing per-kind asset responses,
not embedded in synchronized room game state. Keep SQL in focused injected query modules and
retain safe message/HTTP error boundaries. A database error is an error, not an empty collection.
Invalidate or refresh affected views after edits and permission changes; clear inaccessible cached
items on demotion/revocation and recheck access again when an item is spawned/applied.

### Library behavior

Add a collection filter panel using existing component classes/icons, with equivalent full and
compact/touch layouts. Management offers Create/Rename/Delete and Add/Remove assets; list filters
offer All, individual collection visibility toggles, and Uncollected. Persist viewer filter choices
locally, namespaced by account and collection ID; new collections start visible.

Define multi-membership semantics explicitly: an asset is shown if **any enabled** collection
contains it, or it belongs to no collection the viewer is authorized to read and Uncollected is
enabled. An unchecked but authorized collection still counts as membership; its assets must not
reappear through Uncollected. Deduplicate by `(kind,id)`. Thus hiding one collection does not hide
an asset also in another enabled collection.
“All” restores every available collection and Uncollected. Search, source and kind filters then
intersect with this result. Explain an empty filtered view and provide a reset action.

Private collections must not suppress an otherwise public asset for a normal viewer: compute
membership/filter status using only that viewer's visible collections and accessible items.
Existing objects and applied textures remain usable when a collection is locally hidden.

Extend the existing list cache/rendering rather than copying asset records or building a second
library. A focused collection controller may own filter state and management UI; pass predicates
and callbacks into existing card builders. Include the prop/dispenser dual view and the custom-dice
texture chooser in the UI audit so stored kinds are not silently unsupported. Decide whether
secondary pickers use library visibility preferences; default to the main library only and expose
collection management for all supported kinds explicitly.

### Export/import boundary

Stable collection IDs and typed asset references prepare item 19, but v1 does not export files.
A future package needs portable IDs, dependency closure, format versioning, ownership/visibility
mapping, duplicate handling, bounded extraction, and transactional import. See the
[future export/import brief](DESIGN_future_backlog.md#asset-and-collection-exportimport).
Do not encode installation paths, room snapshots, private hands, or account credentials in collection
metadata. Collection publication is not blanket authorization to redistribute every referenced file.

### Implementation stages and acceptance

1. **Schema/queries/access:** implement migration, grants and bounded CRUD/membership operations.
   Verify non-admin denial, private collections/assets, cross-kind IDs, invalid kinds, duplicate
   additions, revisions, failed writes and deletion cleanup. Do not change asset permissions.
2. **Read/filter UI:** combine collections with existing source/search/kind filters, persist local
   choices, handle removed/new collections, and verify shared membership and uncollected semantics.
3. **Management UI:** allow creating/renaming/deleting collections and batch membership edits.
   Preserve selected filters/scroll where practical and surface write conflicts without losing edits.
4. **Completion:** an admin and ordinary viewer see only authorized content; a private item added
   to a published collection does not leak; hiding a collection is local; deleting one loses no
   assets; two kinds with the same numeric ID stay distinct; desktop/touch flows remain usable.

Expected areas: new collection queries/handlers/UI controller, existing library list/render seams,
a migration and runtime grants, database exports/registrations, and integration fixtures. Run
`check`, `test:integration`, `test:components`, `test:devices`, plus `test:input` for keyboard/input
changes. Test upgrades from existing databases and run the actual production registrations, not
only isolated new helpers.

## Starting implementation later

Use the relevant section as a work brief, confirm the baseline still matches, and turn the first
stage into a bounded implementation task. Record decisions as they are resolved; keep unimplemented
stages marked planned. Update the roadmap, changelog, reference and architecture with each shipped
slice. New features need their own automated and manual verification; the easy-wins sign-off does
not cover these plans. No application code, schema, or protocol was changed to write this document.
