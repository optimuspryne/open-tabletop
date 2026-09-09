# DRY cleanup and module extraction

Status: synchronized schema extraction completed and documented; starter layout extraction is next.
This checklist records the remaining cleanup discussed after the backend fixes.
Suggested module names are proposals, not implemented architecture. Recheck current
source and the MCP memory graph before starting each step.

## Completed

- [x] Share table-card placement through `spawnTableCard` in
  `server/game/card-transfer.js` (hands, deck draws, inspections, and recovery).
- [x] Share Combine/drop-on-deck compatibility through `cardCompatibilityKey` in
  `server/deck-state.js`; incompatible drops retain the card.
- [x] Extract `buildSimpleDeck`, `buildDominoSet`, `buildScrabbleBag`, and
  `buildMahjongWall` into `server/game/deck-builders.js`, using the existing injected shuffle.

## Working rules

- Make one cohesive extraction at a time, preserving behavior and public contracts.
- Use graph discovery, relevant callers/callees, and coverage checks; verify source
  where graph results are incomplete or stale.
- Keep authoritative state changes on the server. Browser graphics modules own
  textures, meshes, and materials. Put definitions/calculations in `shared/` only
  when both sides need them.
- Keep room lifecycle methods recognizable: `onCreate`, `onAuth`, `onJoin`,
  `onLeave`, and `onDispose` coordinate work through focused modules.
- Small forwarding methods may remain on `TableRoom` when they keep callers clear.
- Extract organization separately from behavioral fixes or broad deduplication.
  Similar-looking code should share a helper only when its rules actually match.
- Preserve authorization rechecks after awaits, capacity-before-consumption checks,
  private card data, recovery queues, and durable save ordering.
- Run relevant regression tests and `npm run check`. Add tests for meaningful gaps;
  avoid assertions that merely require code to live in a particular file.
- Summarize every changed file and function/helper. Update `CHANGELOG.md` under
  `[Unreleased]`. Update relevant reference/architecture docs when the user approves
  pushing or confirms a push, or explicitly asks for those updates.
- Local commits are allowed. Never push without explicit approval; allow user testing.

## Remaining server work, in recommended order

### 1. Extract synchronized schema definitions

- [x] Move `Piece`, `Player`, `Timer`, `ScoreRow`, `Whiteboard`, `RoomScale`,
  `Overlay`, and `State`, with their associated `defineTypes` declarations, into
  `server/game/schema.js`.
- Preserve field names, types, registration order, defaults, and collection construction.
- Keep process-wide encoder configuration deliberate; moving classes should not
  introduce unrelated startup side effects.
- Validate serialization and room initialization; manually check joining a table,
  a second client's state, and reconnect behavior.

### 2. Extract starter layout setup

- [ ] Move `setupStarter` into a proposed `server/game/starters.js`.
- Continue using shared `STARTERS` definitions and the extracted deck builders.
- Keep reset cleanup, board/piece creation, initial dealing, and capacity behavior intact.
- Validate representative standard-card and tile starters, including replacing a
  populated table and clearing old private hands/inspections.

### 3. Extract table boundaries

- [ ] Move `buildBounds` into a proposed `server/game/table-bounds.js`.
- Keep collision geometry separate from browser table rendering while retaining
  the shared outline definitions.
- Validate all supported table shapes, resizing, collision containment, and body cleanup.

### 4. Extract dice tray operations

- [ ] Group `buildTrays`, `trayCenterFor`, `trayDropPos`, `repositionTrayDice`,
  `clearTraySeat`, and `applyTrays` in a proposed `server/game/trays.js`.
- Decide whether `seatOf` stays as a small room helper after checking its other callers.
- Preserve ownership, positioning, rebuild behavior, and disconnect cleanup.
- Validate tray creation/removal, rolling and clearing dice, table resizing, and
  player departure/reconnection without duplicate bodies or stranded dice.

### 5. Extract scale and grid settings

- [ ] Group `scaleSnapshot`, `applyScale`, and `calibrateGrid` in a proposed
  `server/game/table-scale.js`.
- Preserve validation, measurement calibration, snapping settings, and saved formats.
- Validate square/hex grids, board calibration, scene restoration, and durable settings.

### 6. Extract remaining piece/dispenser operations

- [ ] Review `recolorPiece`, `standOf`, and `naturalStand` as a focused piece-operations group.
- [ ] Review `dispenserItem` and `afterDispense` as a dispenser-operations group.
- Choose module boundaries from their dependencies; avoid a general-purpose utility dump.
- Keep color changes authoritative and synchronized; retain shared `colorProps` rules.
- Validate single/group recoloring, standing/flat behavior, finite versus infinite
  dispensers, inventory counts, and rejected actions at capacity.

### 7. Extract library and member service operations

- [ ] Review `saveDeckById` and `sendAssetList` for a proposed `server/game/library.js`.
- [ ] Review `sendMembers`, `broadcastMembers`, and `notifyLobby` for a proposed
  `server/game/member-service.js`.
- Preserve private/public filtering, error handling, and authorization checks after reads.
- Keep message validation and operation-specific permissions visible in handlers.
- Validate successful and failed reads/writes, kicks/demotions during pending reads,
  multiple tabs, and lobby notifications.

### 8. Split physics and piece lifecycle carefully

This is several small changes, not one large move.

- [ ] Review `spawn`, `removePiece`, and `releasePiece` for piece lifecycle boundaries.
- [ ] Review `updateDeckCollider` and `updateStackCollider` for collider maintenance.
- [ ] Review `writeTransform`, `pinPiece`, `unpinPiece`, and `wantsSnap` for placement helpers.
- [ ] Split cohesive parts of `update` only after tracing their shared state and ordering.
- Reuse `server/physics.js` and existing safety helpers where appropriate; do not
  duplicate physics configuration or turn the new module into another monolith.
- Validate dragging, throws, group release, snapping, absorption compatibility,
  collider resizing, recovery retries, and body/map cleanup. Preserve simulation order.

## Later client cleanup

### 9. Consolidate mesh replacement

- [ ] Share repeated scene/mesh bookkeeping in `rebuildCard`, `rebuildPiece`, and
  `rebuildDeck` in `public/client.js`.
- Preserve last transforms, piece IDs, shadows, deck height, modeled deck behavior,
  and inspection visibility. Decide placement in a rendering module from actual dependencies.
- Validate flips, recolors, deck count/cover changes, and active inspection views.

### 10. Extract the hand UI

- [ ] Group hand rendering, sorting, reordering, scrolling, and drag state into a
  focused browser module, including `renderHand`, `sortHand`, `commitHandOrder`,
  `startHandReorder`, `endHandReorder`, `stopHandAutoScroll`, `setHandCollapsed`,
  and `inspectHandCard` where dependencies support it.
- Keep the server authoritative for inventory and retain private hand synchronization.
- Validate desktop/touch interactions, rejected placements at capacity, reconnects,
  inspection, and multiple tabs. This step needs substantial interactive testing.

## Lower-priority follow-up

- [ ] Reassess repeated library database queries after the extractions above.
  Preserve asset-specific fields, defaults, visibility, and ownership semantics.
  Introduce shared query machinery only where it reduces maintenance without hiding rules.

## Completion checklist for each step

- [ ] Scope and current dependencies checked.
- [ ] Extraction implemented with behavior preserved.
- [ ] Relevant tests and full checks passed.
- [ ] File/function summary and Unreleased changelog entry provided.
- [ ] User testing completed.
- [ ] Relevant reference/architecture documentation updated when authorized.
- [ ] Push explicitly authorized or performed by the user.
- [ ] This checklist updated to reflect completion.
