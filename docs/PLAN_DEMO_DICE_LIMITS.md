# Public demo dice and roll limits

Status: planned, not implemented. Written 2026-09-29 (America/Phoenix).
The user requested documentation only for this session. All implementation and acceptance
items below remain open. No deployment or push is authorized by this plan.

## Scope and decisions

Implement on `codex/public-demo-mode`, in its existing worktree. Do not merge the demo
branch into main. This document lives with the project documentation for discoverability;
it does not add demo behavior to the full app.

- Limit each demo table to **15 dice total**, counting table dice and every personal tray.
  Count ordinary and custom dice, including any concealed dice. This is not 15 per player.
- Apply a **1,000 ms cooldown per die**, shared across all players and roll entry points.
  This is the proposed starting tuning value from the discussion; validate its feel.
- Keep the existing 250-piece limit for all objects. Dice consume both budgets.
- Leave ordinary full-app rooms unchanged in this change. Configurable full-app limits are
  separate future work, not a prerequisite for worker isolation.
- Enforce limits on the server; client button state is never the authority.

## Evidence and starting points

The September 29 public test on a 2-vCPU host put 245 d20s into one tray alongside five
starter dice. Approximately 50 pieces stayed near 60 simulation callbacks/second; at 250
repeatedly rolling dice, logs fell to roughly 5–9 callbacks/second. An empty room also
slowed. This is a concentrated collision workload, not a benchmark for every piece type.
Remaining connected and returning HTTP 200 did not establish acceptable gameplay performance.

Reuse the capacity boundary in `server/game/piece-capacity.js`, the final creation boundary
in `server/game/piece-lifecycle.js`, and existing guarded message/error feedback mechanisms.
The known roll entry points are `rollOne` and `rollGroup` in
`server/game/handlers/pieces.js`, and tray `roll` in
`server/game/handlers/room-features.js`. Inspect `trayScoop`, tray spawn and other ways to
repeatedly wake or recreate dice as part of the bypass audit. Re-discover all callers on the
current demo branch before editing; this is a starting list, not an exhaustive audit.

## Implementation slices

### 1. Room policy and creation invariants

- Attach an immutable, server-selected demo policy to each room. Use named constants for
  the cap and cooldown; never accept limits or timestamps from clients. Prefer a simple
  bounded scan of room pieces over a second mutable counter unless profiling justifies one.
- Extend existing capacity checks to evaluate both total pieces and dice. Keep a final
  assertion at creation so internal callers cannot bypass the cap.
- Check before consuming inventory or changing state. For asynchronous placement, recheck
  after reads and immediately before mutation. Batch/scene operations must preflight their
  final dice count, then complete atomically or reject without a partly replaced table.
- Cover starter setup, ordinary/custom placement, collections, scene loading, snapshots,
  duplication if supported, and any dispenser-derived dice discovered in the caller audit.
  Moves between trays and the table neither consume nor release capacity.
- Release capacity on actual removal. No client, host, reconnect or additional seat may
  obtain another dice allowance.

### 2. One room-owned roll policy

- Reuse/extend the existing roll operation through a focused room-owned policy, rather
  than adding independent timestamps to three handlers. Preserve the existing tray/table
  impulse parameters and sound behavior.
- Use an injectable monotonic clock and a map keyed by die ID. Only an accepted roll
  advances that die's deadline. A rejected attempt must not keep extending the cooldown.
- Validate payload, access, piece type and body first; deduplicate and bound group IDs.
  For a mixed group, roll eligible dice and skip cooling dice. Emit sound only when at
  least one die actually rolled. Do not queue delayed rolls.
- Seed the cooldown for newly spawned dice that already receive a roll impulse. Share
  the policy with any scoop/re-rack action that applies a comparable repeated impulse;
  document that decision after inspecting its actual behavior. Preserve normal dragging.
- Keep timestamps through reconnects; remove them on piece removal/reset/disposal. On
  restore, initialize dice consistently without persisting a process-local clock value.
- Retain existing connection/message rate limits. Test delete/recreate and tray-toggle
  loops; if those bypass practical load limits, add a small demo-only creation/action
  budget based on measurements, rather than claiming roll cooldown alone prevents abuse.

### 3. Feedback and UI approval

Before changing any visible feedback or controls, present a concrete example and obtain
the UI approval required by AGENTS.md. Proposed messages:

- Capacity: “Demo tables can have up to 15 dice. Remove a die to add another.”
- Roll rejection: “These dice can roll again in a moment.”

Use existing accessible notification components; coalesce repeated rejection messages.
Do not reveal concealed piece IDs/counts in feedback. Show desktop/full, compact and touch
examples. No new icon is required; any new icon choice requires approval. Optional button
cooldown visuals need their own approved example and must still work for keyboard/touch.

### 4. Verification

- Unit/regression cases: 14→15 succeeds, 15→16 fails, all trays share the cap, custom dice
  count, non-dice still fit, removal frees capacity, and demo-disabled behavior is unchanged.
- Fake-clock cases: rolls at 0/999/1000 ms; different players and alternate message types;
  duplicate/mixed/invalid IDs; all-rejected groups produce no sound; rejected spam does not
  extend a deadline; reconnect does not reset it; removal leaves no map leak.
- Exercise the real room handlers and creation/restore paths, not only isolated helpers.
  Verify failed batch placement preserves inventory and the previous scene/checkpoint.
- Run `npm run check`; run `test:components` for notification/DOM changes, `test:input` for
  input changes, `test:devices` for layout changes, and `test:integration` for DB/query changes.
- Repeat the controlled 15-dice test with seven clients, then all configured demo tables
  under normal load. Record step/tick percentiles, event-loop delay, CPU and HTTP/join latency.
  Confirm rejected direct-protocol rolls remain bounded without changing other users' rooms.
- Proposed acceptance: sustained p95 simulation callback interval ≤20 ms and p99 ≤33 ms
  on the target VM at the agreed workload, with no state loss or unexpected disconnects.
  These are goals to validate, not results already achieved. Tune using measured physics cost.

## Deployment, migration and rollback

Update demo branch CHANGELOG, REFERENCE, ARCHITECTURE and operator instructions with the
actual policy and tested limits. Prefer no schema change for these transient constraints.
If environment tuning is added, forward it explicitly in Compose and test invalid values.

Existing demo checkpoints can contain more than 15 dice. Do not silently truncate them or
leave over-cap rooms as a permanent bypass. For initial rollout, schedule expiry/closure of
the temporary demo tables through the established admin lifecycle, then deploy after they
are gone. Document the interruption. Also reject an over-cap restored snapshot safely,
with explicit recovery feedback and no checkpoint overwrite, as defense against stale data.

Rebuild/recreate the app and refresh clients; keep the database and asset volumes. Test
starter creation, invite/join, roll, removal/re-add, expiry and admin access. Roll back to the
previous image if needed, documenting that the protective limits are then absent. Never
wipe the database or merge demo-only restrictions into main as a rollback shortcut.

## Completion checklist

- [ ] Current demo caller audit and UI feedback approval completed.
- [ ] Shared capacity/roll policy implemented and regression-tested.
- [ ] Automated checks and real desktop/touch smoke tests recorded separately.
- [ ] Target-host performance comparison and existing-table rollout verified.
- [ ] Demo documentation updated; user reviews/tests before any push.

Follow-on: [worker process isolation](PLAN_ROOM_WORKERS.md).
