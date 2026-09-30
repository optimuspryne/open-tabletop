# Room worker process isolation

Status: planned, not implemented. Written 2026-09-29 (America/Phoenix).
This session authorizes plans only. The architecture spike and every implementation,
migration, deployment and acceptance item remain future work.

## Objective and branch strategy

Move independent tables off the shared JavaScript event loop so a costly table does not
block unrelated tables or the HTTP/control plane. Use multiple CPU cores when available.
Keep each table's physics, authoritative state, permissions and private data together.
Do not distribute individual physics bodies across processes or introduce game rules.

Develop as a full-app capability on a new `codex/` branch from current main. After testing
and the user's release decision, port the relevant commits to `codex/public-demo-mode`.
Never merge that long-lived demo branch back into main. Land the independent
[demo dice safeguards](PLAN_DEMO_DICE_LIMITS.md) first; workers do not replace those limits.

## Evidence and current constraints

The 2026-09-29 public test reached roughly 6–8 simulation callbacks/second in both a
250-dice table and an unrelated empty table. The empty room's physics cost was only
0.03–0.04 ms. This is evidence of shared event-loop interference. It is not evidence that
two workers can support twice the load, or that 250 colliding dice will run at 60 Hz.

Current sources to re-verify: `server.js` room registration, simulation, lifecycle and
process-local `ROOM_WRITERS`; room access/admission and persistence modules;
`server/game/handlers/room-features.js`; client matchmaking/reconnect bootstrap; Compose
and native service startup. ARCHITECTURE documents local writer ownership through final
save, local live-access invalidation and asset reference tracking. Existing Redis-backed
HTTP limits do not themselves provide Colyseus room discovery, presence or socket routing.

## Proposed architecture and decisions to prove

Prefer **OS child processes owning whole Colyseus rooms**, with a lightweight supervisor
and one public HTTP/WebSocket ingress. This gives independent event loops and process
failure boundaries while minimizing changes inside the simulation. Physics-only threads
would require a new synchronization boundary for almost every gameplay operation; they
are not the first implementation target.

For strong per-table isolation, prototype one active table per child, with an explicit
maximum number of children. Idle tables may checkpoint and unload using the normal safe
lifecycle. Never spawn an unbounded process for each request. At capacity, reject new room
activation promptly with the existing capacity response; do not silently multiply workers.
This trades memory and simultaneous-table capacity for isolation. A pool hosting several
tables per worker is an alternative only if that tradeoff is unacceptable: tables sharing
a worker will still interfere, and documentation must state that limitation.

The first milestone must settle this placement choice, resource budgets and the precise
Colyseus 0.17 integration before production code is reorganized. Verify supported routing,
presence and driver APIs against the installed package and official documentation then;
do not assume `cluster`, sticky sessions, or Docker replicas solve room ownership.

### 1. Baseline and compatibility spike

- Capture one normal table, one pathological table, and two concurrent tables on a 2-vCPU
  host. Measure per-room tick/step percentiles, process event-loop delay, memory, join and
  HTTP latency. Record active versus sleeping bodies and table placement.
- Demonstrate two room processes behind one origin, authenticated allocation, room-ID
  routing, WebSocket upgrades and same-worker reconnect. Bind child listeners only to
  private/local interfaces; no new publicly reachable worker ports.
- Keep rendering, camera and preferences in the browser. Keep authoritative/private state
  in the room owner. Do not mirror private hands, deck order or inspection contents into
  routing metadata, shared presence, logs or a general broadcast channel.
- Produce a short decision record with measured process overhead, selected routing
  mechanism, Redis/dependency changes if any, and the bounded room-placement policy.

### 2. Separate bootstrap without changing game behavior

- Extract current HTTP/control-plane startup, room registration and process lifecycle into
  focused modules with explicit dependencies. Reuse existing room and simulation modules.
  Separate this organizational slice from behavior changes and test single-process parity.
- Keep migrations/bootstrap provisioning in one coordinator, not every child. Size total
  PostgreSQL connections across children; do not multiply the current pool unchecked.
- Define startup readiness, worker registration, heartbeat, draining and bounded restart
  backoff. Budget IPC queues/payloads and process memory. Supervisor failure must not leave
  unmanaged children accepting traffic; children fail closed when their owner is lost.
- Preserve the existing single-process mode as the default compatibility/rollback path
  until worker mode has passed acceptance. Proposed configuration names and values must
  be finalized in the decision record, not treated as existing environment variables.

### 3. Ownership and routing before concurrent writers

- Atomically map persistent room identity to a live owner plus generation. Parallel create,
  join and reconnect requests must resolve to exactly one writer. Preserve the distinction
  between public room code, persistent database identity and transport room ID.
- A process-local map alone is insufficient. Design a database-enforced ownership/fencing
  contract: every checkpoint and other room-owned durable write verifies the current owner
  generation in the same transaction. A lease timer alone cannot stop an old delayed writer.
  Use a new numbered migration if ownership schema is required; preserve role separation.
- Hold ownership through final queued save/disposal. Reassignment cannot proceed until
  the old writer is fenced. Test pause/resume, expired ownership, delayed writes and
  concurrent allocation explicitly, including coordinator restarts.
- Route matchmaking reservations and WebSocket upgrades to the selected owner. Reject
  stale registrations; validate authentication and live permission at the owning worker.
  Preserve payload limits, proxy trust and origin/CSP protections through the ingress.
- Reconnect to a living owner using the existing flow. A dead worker cannot resume an
  in-memory reconnect token: reauthenticate and rejoin a recovered checkpoint explicitly.
  Document possible loss since the last durable save; do not promise seamless crash recovery.

### 4. Cross-process control and full-app parity

- Inventory every local room registry/cache and assign its new owner. Cover admin room
  listing/close, revocations, bans, roles, profiles, admissions, editor/lobby rooms, asset
  deletion/reference checks, library invalidation, scheduled cleanup and shutdown.
- Use a narrow authenticated control protocol with acknowledgments and bounded timeouts.
  Security-sensitive changes must not report success while an unreachable worker keeps
  serving revoked access. Use fencing/termination and durable revalidation where needed;
  lossy pub/sub alone is not a revocation guarantee.
- Enforce deployment-wide admission/connection limits atomically, with crash-safe release
  or expiry. Keep per-connection message limits local. Port demo room/guest quotas and
  expiry carefully so they do not multiply with worker count or purge an active writer.
- Keep upload/storage maintenance coordinated with all live room references. Avoid one
  worker deleting assets still used by another. Preserve private-hand and concealed-state
  boundaries through saves, transfers, reconnects and worker failure.

### 5. Failure handling, operations and rollout

- Drain: stop allocations, notify/disconnect as appropriate, finish bounded saves, release
  ownership, then stop children. Never start a replacement writer before fencing the old one.
- Add worker ID, room ID and owner generation to safe logs. Measure normalized callback
  rate over actual elapsed time; current `ticks/s` counts a roughly one-second window.
  Keep awake count and total-body count from the same sample to avoid confusing `248/5` logs.
- Expose readiness separately from liveness if implemented. Readiness includes allocation
  and persistence dependencies; fast HTTP alone does not establish healthy simulation.
- Update Docker PID-1/signal handling, stop grace periods, health checks, secret handling,
  internal routing and native Debian/Proxmox services. Document CPU/memory/process/DB-pool
  budgets. Do not default to unlimited workers or assume two vCPUs leave a full spare core.
- Ship worker mode opt-in, test locally, then on an isolated server, then full-app canary,
  then port to demo. Preserve backups and rollback image/configuration. Drain before rollback;
  verify ownership migrations are backward-compatible or provide an explicit migration plan.

## Verification and release gates

- Run `npm run check` and `test:integration` for routing/persistence/ownership changes.
  Add real multi-process tests: concurrent room creation, DB/Redis outages, worker kill,
  supervisor restart, stale writer, rolling drain, reconnect and cleanup races.
- Verify roles/revocation, private hands/deck order, spectators, lobby/editor, admin controls,
  snapshots, custom assets and demo expiry across processes. Test actual exported entry points
  and production Docker/native commands, not just fake IPC adapters.
- Run input/components/devices suites if those surfaces change. Any new connection/recovery
  UI needs a concrete desktop/compact/touch mock-up and explicit approval under AGENTS.md.
- Compare single-process baseline with two separate workers: one stressed table and one
  normal table. Proposed acceptance for the normal table: p95 callback interval ≤20 ms,
  p99 ≤33 ms, no unexpected disconnects, and p95 join ≤2× its unloaded baseline. Validate
  these goals on the target host; CPU contention can still affect separate processes.
- Demonstrate bounded memory/process/DB connections at maximum admitted rooms, rejection
  beyond capacity, and recovery without duplicate writers or unauthorized state delivery.
- Document that an overloaded table may remain slow. Worker isolation is not a faster
  collision engine and does not guarantee 60 Hz under arbitrary load.

## Completion checklist

- [ ] Spike and placement/routing decision record accepted.
- [ ] Single-process parity preserved after bootstrap extraction.
- [ ] Fenced ownership, routing and failure tests pass.
- [ ] Cross-process admin/security/storage behavior verified.
- [ ] Performance and failure results recorded for the target host.
- [ ] CHANGELOG, REFERENCE, ARCHITECTURE, deployment/release guides updated.
- [ ] User reviews/tests release; demo receives selected full-app commits separately.
