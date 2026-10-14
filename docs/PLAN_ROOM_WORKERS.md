# Future room scaling with multiple app instances

Status: deferred, not implemented. Written 2026-09-29; revised 2026-10-01 (America/Phoenix).
Tracked in the [roadmap](ROADMAP.md#future-scaling--deferred-until-usage-warrants-it).
This revision records the decision to explore standard Colyseus clustering first when
usage warrants it. It supersedes the original preference for a custom child-process
supervisor and one active table per child. The filename is retained for existing links.
The prototype, implementation, migrations, deployment and acceptance remain future work.

## When to revisit

Keep the simpler single-instance setup and existing demo safeguards for now. Revisit when
measured ordinary concurrent play approaches the host's capacity, or busy tables repeatedly
delay unrelated games. Record sustained simulation intervals, event-loop delay, CPU, memory,
and join/HTTP latency before choosing an instance count or buying more capacity. A pathological
dice stress test motivates investigation but does not establish ordinary capacity needs.

## Objective and branch strategy

Distribute tables across independent JavaScript event loops to reduce interference and use
multiple CPU cores when available. Tables on the same instance still share an event loop,
including any HTTP/control-plane work hosted there; clustering alone does not isolate every table.
Keep each table's physics, authoritative state, permissions and private data together.
Do not distribute individual physics bodies across processes or introduce game rules.

Develop as a full-app capability on a new `codex/` branch from current main. After testing
and the user's release decision, port the relevant commits to `codex/public-demo-mode`.
Never merge that long-lived demo branch back into main. Retain the independent
[demo dice safeguards](PLAN_DEMO_DICE_LIMITS.md); clustering does not replace those limits.
Check their implementation and remaining rollout/acceptance status on the demo branch;
the full-app copy of that plan is not authoritative for subsequent demo-branch progress.

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

Start with **two fixed app instances behind one reverse proxy**, using Colyseus's standard
`RedisPresence` for inter-instance communication and `RedisDriver` for shared matchmaking
room discovery. Both instances use the same PostgreSQL database and, for the first single-host
experiment, the same uploaded-asset volume. Docker or the native service manager owns startup,
restart and shutdown. Reuse the existing room/gameplay modules and avoid a custom process
supervisor in the first experiment.

Load-balance initial matchmaking requests; route the resulting WebSocket connection to the
instance owning that room using its advertised address through the proxy. Per-user sticky
sessions alone cannot ensure every player reaches the same room owner. Keep one public origin
and private instance listeners, with bounded instance, room and connection counts. Reject new
activation promptly at capacity rather than starting an unbounded process for each request.

This follows the [Colyseus scaling model](https://docs.colyseus.io/scalability), with
[Presence](https://docs.colyseus.io/server/presence) and
[Driver](https://docs.colyseus.io/server/driver) serving different responsibilities. Redis
matchmaking does not fence our PostgreSQL writes, coordinate our asset cleanup, or implement
our cross-instance revocation guarantees. These remain production release requirements below.

Benchmark busy and normal tables on different instances and on the same instance. Consider
strict one-table-per-process placement only if those results justify its extra memory and
lifecycle complexity. Physics-only threads and automatic scaling are outside the first milestone.
More instances on the same 2-vCPU host do not add CPU capacity; additional hosts also require
a separate shared-asset storage design.

Before reorganizing production code, record resource budgets and the precise integration.
Verify compatible Colyseus adapter versions, routing and reconnect behavior against the
installed package and official documentation at implementation time; these are proposed
dependencies/configuration, not currently supported deployment settings.

### 1. Baseline and compatibility spike

- Capture one normal table, one pathological table, and two concurrent tables on a 2-vCPU
  host. Measure per-room tick/step percentiles, process event-loop delay, memory, join and
  HTTP latency. Record active versus sleeping bodies and table placement.
- Demonstrate two fixed app instances behind one origin, shared Redis matchmaking,
  authenticated allocation, room-ID routing, WebSocket upgrades and same-instance reconnect.
  Bind instance listeners only to private/local interfaces; no new public backend ports.
- Compare the busy/normal pair on separate instances and on the same instance. Record
  HTTP interference as well as simulation behavior. Use disposable test data until the
  ownership and cross-instance safety gates pass; the spike is not a production deployment.
- Keep rendering, camera and preferences in the browser. Keep authoritative/private state
  in the room owner. Do not mirror private hands, deck order or inspection contents into
  routing metadata, shared presence, logs or a general broadcast channel.
- Produce a short decision record with measured process overhead, selected routing
  mechanism, Redis adapter dependencies, and the bounded room-placement policy. Decide
  whether fixed instances are sufficient before considering custom per-table processes.

### 2. Coordinate startup without changing game behavior

- Make only the startup/registration extractions needed for selectable single-instance and
  clustered operation, with explicit dependencies. Reuse existing room and simulation modules.
  Separate organizational changes from behavior changes and test single-process parity.
- Run migrations/bootstrap provisioning once through a coordinated startup step. Size total
  PostgreSQL connections across instances; do not multiply the current pool unchecked.
- Use service-manager lifecycle support and Colyseus registration where suitable. Define
  readiness, stale-instance detection, draining and bounded restart backoff; budget control
  message queues/payloads and memory. Define fail-closed behavior when ownership or access
  cannot be validated during a database/Redis outage or network partition.
- Preserve the existing single-process mode as the default compatibility/rollback path
  until clustered mode has passed acceptance. Proposed configuration names and values must
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
  concurrent allocation explicitly, including service restarts and network partitions.
- Route matchmaking reservations and WebSocket upgrades to the selected owner. Reject
  stale registrations; validate authentication and live permission at the owning instance.
  Preserve payload limits, proxy trust and origin/CSP protections through the ingress.
- Reconnect to a living owner using the existing flow. A dead instance cannot resume an
  in-memory reconnect token: reauthenticate and rejoin a recovered checkpoint explicitly.
  Document possible loss since the last durable save; do not promise seamless crash recovery.

### 4. Cross-process control and full-app parity

- Inventory every local room registry/cache and assign its new owner. Cover admin room
  listing/close, revocations, bans, roles, profiles, admissions, editor/lobby rooms, asset
  deletion/reference checks, library invalidation, scheduled cleanup and shutdown.
- Use a narrow authenticated control protocol with acknowledgments and bounded timeouts.
  Security-sensitive changes must not report success while an unreachable instance keeps
  serving revoked access. Use fencing/termination and durable revalidation where needed;
  lossy pub/sub alone is not a revocation guarantee.
- Enforce deployment-wide admission/connection limits atomically, with crash-safe release
  or expiry. Keep per-connection message limits local. Port demo room/guest quotas and
  expiry carefully so they do not multiply with instance count or purge an active writer.
- Keep upload/storage maintenance coordinated with all live room references. Avoid one
  instance deleting assets still used by another. Preserve private-hand and concealed-state
  boundaries through saves, transfers, reconnects and instance failure. Assign scheduled
  maintenance to a coordinated owner so full-app replicas do not duplicate destructive jobs.

### 5. Failure handling, operations and rollout

- Drain: stop allocations, notify/disconnect as appropriate, finish bounded saves, release
  ownership, then stop instances. Never start a replacement writer before fencing the old one.
- Add instance ID, room ID and owner generation to safe logs. Measure normalized callback
  rate over actual elapsed time; current `ticks/s` counts a roughly one-second window.
  Keep awake count and total-body count from the same sample to avoid confusing `248/5` logs.
- Expose readiness separately from liveness if implemented. Readiness includes allocation
  and persistence dependencies; fast HTTP alone does not establish healthy simulation.
- Update Docker PID-1/signal handling, stop grace periods, health checks, secret handling,
  internal routing and native Debian/Proxmox services. Document CPU/memory/process/DB-pool
  budgets. Do not default to unlimited instances or assume two vCPUs leave a full spare core.
- Ship clustered mode opt-in, test locally, then on an isolated server, then full-app canary,
  then port to demo. Preserve backups and rollback image/configuration. Drain before rollback;
  verify ownership migrations are backward-compatible or provide an explicit migration plan.

## Verification and release gates

- Run `npm run check` and `test:integration` for routing/persistence/ownership changes.
  Add real multi-process tests: concurrent room creation, DB/Redis outages, instance kill,
  service restart, network partition, stale writer, rolling drain, reconnect and cleanup races.
- Verify roles/revocation, private hands/deck order, spectators, lobby/editor, admin controls,
  snapshots, custom assets and demo expiry across processes. Test actual exported entry points
  and production Docker/native commands, not just fake IPC adapters.
- Run input/components/devices suites if those surfaces change. Any new connection/recovery
  UI needs a concrete desktop/compact/touch mock-up and explicit approval under AGENTS.md.
- Compare single-process baseline with two separate instances: one stressed table and one
  normal table. Proposed acceptance for the normal table: p95 callback interval ≤20 ms,
  p99 ≤33 ms, no unexpected disconnects, and p95 join ≤2× its unloaded baseline. Validate
  these goals on the target host; CPU contention can still affect separate processes.
  Also record the same-instance pair to expose the remaining shared-event-loop limitation.
- Demonstrate bounded memory/process/DB connections at maximum admitted rooms, rejection
  beyond capacity, and recovery without duplicate writers or unauthorized state delivery.
- Document that an overloaded table may remain slow. Process isolation is not a faster
  collision engine and does not guarantee 60 Hz under arbitrary load.

## Completion checklist

- [ ] Measured demand warrants revisiting the deferred work.
- [ ] Spike and placement/routing decision record accepted.
- [ ] Single-process parity preserved after startup coordination changes.
- [ ] Fenced ownership, routing and failure tests pass.
- [ ] Cross-process admin/security/storage behavior verified.
- [ ] Performance and failure results recorded for the target host.
- [ ] CHANGELOG, REFERENCE, ARCHITECTURE, deployment/release guides updated.
- [ ] User reviews/tests release; demo receives selected full-app commits separately.
