# Public demo mode — staged implementation

Branch: `codex/public-demo-mode`. Intended public origin: `https://play.open-tabletop.com`.
The demo is an opt-in deployment of the same application, not a permanent fork.
User selected a fresh table per visitor/group and approved the entry mock-up and recommended
icons (`player-play`, `users-plus`, `copy`, `logout`) on 2026-09-29. The exact in-table shell
placement/removals still require a concrete example; entry approval does not cover that revision.

## Status

1. **Implemented, awaiting manual testing:** optional process-local admission and message-count
   budgets. Existing authenticated users can exercise them through the current UI. Automated
   verification is recorded below after execution. This first slice does not create or delete guests.
2. **Implemented storage foundation, awaiting runtime wiring:** temporary identity/table
   transactions, resume, invite exchange/rotation, expiry and guarded purge APIs; migration 024.
   No public guest route, background sweeper or occupancy hooks are registered yet.
3. **Proposed:** demo HTTP boundary, invites, resume and curated starter allocation.
4. **Entry approved, implementation pending:** entry UI and recommended icons. In-table shell
   changes require their exact placement/removal example before implementation.
5. **Proposed:** further abuse controls, load tests and public-instance rollout.

No changes have been deployed or pushed. Network setup was tested separately by the user:
Caddy on OPNsense forwards over WireGuard to `172.19.20.5:2567`; the attached Hetzner Cloud
Firewall blocks direct public access. Keep `PersistentKeepalive = 25` on Debian's OPNsense peer.

## Implemented foundation

Reuse `createRoomAccess` for admitted connection ownership, pending authorization and live-room
reservations. Reuse Colyseus `maxMessagesPerSecond` for a pre-decode message-count guard. There
is no parallel identity store or custom replacement for the existing message decoder.

| Variable | Suggested initial trial | Meaning |
| --- | ---: | --- |
| `ROOM_MAX_LIVE` | 5 | All live tables, editors and waiting lobbies, including initializing/disposal slots |
| `ROOM_MAX_CONNECTIONS` | 20 | Registered connections across those rooms, including reconnect reservations |
| `ROOM_MAX_CONNECTIONS_PER_USER` | 2 | Connections for one account across devices, rooms and tokens |
| `ROOM_MAX_PENDING_AUTH` | 16 | Concurrent preflight, join and reconnect authorization reads |
| `ROOM_MAX_MESSAGES_PER_SECOND` | 240 | Colyseus per-client message-count window; overflow disconnects |

Every variable defaults to disabled (`0`/unset). Values above are starting hypotheses, not
load-tested guarantees. Existing per-table participant/piece caps still apply. Administrators
count toward the budgets. A lobby consumes a live-room slot, so five slots do not guarantee
five playable tables if editors/lobbies also exist. Do not deploy multiple app processes and
assume these limits are global; clustering is outside this slice.

Native install: set variables in `/etc/open-tabletop/open-tabletop.env`, then restart the app
service. Local checkout: `.env`. Compose: the five variables are explicitly forwarded by the
bundled file; recreate the app container to apply changes. Admission budgets alone need no schema
migration; the current branch also contains the storage slice below, which requires migration 024.

These limits do not yet cover per-IP sockets, pre-admission transport connections/matchmaking
reservations, signup growth, HTTP writes, bytes, costly operations or disk use. The 4 MiB
transport payload ceiling is unchanged. Reconnection cannot double-charge a retained slot,
but reconnecting attackers can still require additional rate controls. Waiting-room/application
limits cannot replace reverse-proxy and OS limits.

## Temporary identity and persistence

The storage API is implemented in `server/demo-queries.js` and exported as `db.demo` through
the existing production facade. All mutation transactions take one database advisory lock;
capacity includes expired-but-unpurged rows so cleanup failures cannot allow unbounded growth.
Defaults are five stored demo tables, forty identities, eight identities per table, a two-hour
absolute lifetime and fifteen-minute idle expiry. These internal limits are not deployment flags
yet. Runtime connection limits are independent.

Migration 024 adds `users.is_demo`, allows email-less demo identities with a constraint forbidding
their password/admin/host elevation, and adds `demo_rooms`/`demo_guests`. Existing accounts and
tables remain ordinary. The fresh schema includes the migration; older installations must apply
024 before running this branch because session lookup now joins these tables.

`createTable` allocates host identity/session, room, owner membership, invite hash and deadlines
atomically. `joinInvite` allocates a distinct player. `resume` does not extend expiry. `rotateInvite`
locks the host session and membership and rechecks live table ownership. Only hashes reach SQL;
raw credentials must be generated by the future HTTP layer. Built-in starter selection is stored
but not applied to physics yet.

`setOccupied` is a runtime-only hook: repeated empty reports cannot extend idle expiry and an
expired table cannot be revived. `closeExpired` closes access, deletes affected guest sessions,
and returns unpurged closed rooms repeatedly for retry. `purgeClosed` defaults to denial and
requires a trusted runtime callback confirming no live writer, before deletion and before commit.
`purgeOrphans` removes marked guests whose room was administratively deleted. Cleanup detaches
library ownership but preserves shared assets; ordinary users/rooms are not collected.

Normal bearer lookup rejects expired/closed/detached demo identities even before a sweep.
Room admission additionally binds a demo user to their own table even if a cross-room membership
was created. Active sockets still need the future runtime expiry/disposal wiring; these storage
operations alone do not immediately stop an existing socket at its deadline.

Design contracts to preserve while wiring runtime/HTTP:

- Reuse existing bearer-session hashing, user IDs, membership/role checks, revocation and private
  hand ownership. Extend the database through focused demo queries and a new numbered migration.
- Mark demo users explicitly. They have no password, email-recovery enrollment, site-admin flag
  or permanent host access. Do not fabricate routable email addresses or repurpose host approval.
  Adapt the schema/shape only where needed for explicitly typed temporary users.
- Store demo table ownership and absolute expiry durably. Create the temporary host, session,
  room and owner membership in a single transaction. A serialized quota check must bound both
  active tables and temporary identities before insertion, including concurrent requests.
- One unexpired owned table per guest. Reuse the existing session to resume it. Clearing browser
  storage loses identity, so account limits alone cannot stop abuse: also bound creation per IP,
  global creation rate and total stored demo identities. Normalize IPv4/IPv6 identities through
  the trusted proxy boundary; never trust client-supplied IP fields.
- Invite tokens use cryptographic randomness, hash-only server storage and a table-bound expiry.
  They grant guest membership only. Host credentials are separate and never appear in the invite.
  Use a URL fragment for the invite secret, exchange it via POST and remove it from the address
  bar. Rate-limit exchanges. The current short room code alone must not admit demo strangers.
- Guests can use curated public assets and existing game mechanics. Enforce denial of persistent
  library writes, uploads/imports, account security/host requests and cross-table access on the
  server; UI hiding is not authorization. Audit both HTTP and socket paths before enabling guests.
- Proposed lifetime: two hours maximum, or fifteen minutes continuously empty. Connection state,
  not arbitrary heartbeat messages, determines occupancy. Reconnect grace precedes empty expiry.
- Cleanup first closes admissions and revokes live credentials; finish/cancel in-flight writes
  safely before purging only marked temporary data. Preserve shared library assets and real users.
  Expiry checks apply on every privileged access even if the sweeper is delayed or fails.
- On restart, sweep expired data before public admissions. Persist enough timestamps to preserve
  expiry; reconnecting must not reset the absolute deadline. Use the established error boundaries,
  retry cleanup failures and record safe context. Never convert DB failures into successful cleanup.

## HTTP and abuse-control proposal

An explicit demo-mode flag will select the guest entry flow and activate the server-side demo
policy. Do not add that flag before the policy is complete. Proposed operations are create/resume
session, create table from an allowlisted starter, exchange invite, rotate invite and leave/end
table. Exact endpoint names and response contracts remain unimplemented.

Separate Redis token buckets should cover creation and invite exchange; reusing the current
auth bucket for all demo actions would let one action starve another. Add bounded concurrency
for expensive work, socket byte budgets and per-operation throttles with room/account scope.
Measure actual pointer, drawing and multi-select traffic before choosing thresholds. Keep all
game intent semantics intact; no automatic scoring or legal-move enforcement.

Proposed initial guest offer: empty table, dice, cards and chess using existing built-in starters.
Verify the canonical starter identifiers and curated asset availability in the implementation.
Return stable capacity/expiry codes so the approved UI can show actionable states without
disclosing other users or tables. No public table directory.

## Concrete UI example — entry and icons approved

This is a design example only; no application markup, CSS, icons or client behavior is changed.
The standalone HTML mock-up supplied with this slice shows the same layouts visually.

### Desktop, full and compact

The entry screen retains text labels in both modes. Two columns become one on narrow screens.

```text
Open Tabletop                                      Public demo

Your own table, ready to play
Try it solo or invite friends. No account needed.

Your name [Guest________________]

Choose a starting table                Have an invite?
(●) Empty table   ( ) Dice             Open the link your host shared.
( ) Cards        ( ) Chess             You'll join their table as a player.

[Start my table]

Demo tables last up to 2 hours and are removed after
15 minutes empty. Demo progress is temporary.
```

If the browser has an unexpired table, replace the primary action with **Resume my table**;
show its remaining time and do not create another table implicitly. While starting, disable
duplicate submission and expose the pending state. On capacity failure, preserve the name and
starter choice and show **The demo is full. Please try again shortly.** with **Try again**.

An invite opens a focused variant: **Join Alex's table**, the name input, an explicit **Join table**
button and the same temporary-progress notice. Invalid/expired invites show **This invite has
expired** and **Start my own table**. No pasted credential or room code field is necessary.

### Touch/narrow screen, full and compact

```text
Open Tabletop         Public demo

Your own table,
ready to play
Try it solo or invite friends.
No account needed.

Your name
[Guest______________________]

Choose a starting table
(●) Empty table   ( ) Dice
( ) Cards         ( ) Chess

[       Start my table       ]

Up to 2 hours. Removed after
15 minutes empty. Progress is
temporary.

Have an invite?
Open the link your host shared.
```

Both modes retain the full labels on this entry form. Controls have 44px minimum targets,
visible keyboard focus, semantic radio groups and labels. Errors use an accessible live region;
focus moves to the table heading after navigation, or to the error summary when appropriate.

### In-table addition and existing controls

Full desktop: `Public demo · 1h 42m left   [Invite friends]   [Leave table]`.
Compact desktop: retain the expiry text and use approved icon buttons with accessible names
and focus/touch hints. Touch: wrap the same strip into a status row and a row of labeled actions.
Guests see no account-security/host-request/library-creation entry points. Existing gameplay
controls remain. A later mock-up must show the exact affected table-shell locations/removals
against current source before implementation; this strip alone does not approve those changes.

Invite opens an accessible dialog with a readonly invite link, **Copy link**, **Done** and,
for the host only, **Replace invite link**. Replacing a link requires explaining that the old
link will stop working. Copy success has visible and screen-reader confirmation. Five minutes
before absolute expiry show a nonblocking notice; expiry disconnects and offers **Start again**.
Leaving disconnects this guest; it does not destroy a group table that still has players.

### Approved icon choices

Approved Tabler choices: `player-play` for Start/Resume, `users-plus` for Invite friends,
`copy` for Copy link, `logout` for Leave.
Entry actions stay labeled in compact mode; table icon-only variants retain accessible names.
Use existing sprite helpers and regenerate the sprite when implementing the approved icons.

## Verification and manual smoke tests

Automated checks: final `npm run check` passed (lint, formatting, CSS parity and all 926 tests).
New cases cover configuration validation, concurrent admission, account limits, reconnect
reservations, DB-read saturation/failure recovery and independent background revalidation.
The production-class Colyseus fixture covers failed allocation, table/editor/lobby capacity,
connection denial, and raw protocol message flooding. Loopback-server tests required execution
outside the network-restricted sandbox; the unrestricted full check passed.
`git diff --check` passed. The storage slice passed the final `npm run test:integration`
(24 existing tests plus 10 demo tests), including migration upgrade checks against populated
pre-demo data. No production DOM, layout or input changed.
Manual gameplay, real-device behavior and production load capacity: **not yet verified**.

After setting trial limits and restarting the app (refresh clients to reconnect):

1. Existing login, table join, editor access and waiting-room admission still work under capacity.
2. Fill live-room slots, then attempt another table/editor/lobby: receive a bounded error;
   existing tables continue working. Close a room and retry after its final save.
3. Reach the per-user limit with multiple tabs/tokens; another account still joins if global
   capacity remains. Reach global capacity and verify additional joins fail.
4. Disconnect briefly and reconnect: retained access/hand restores without charging another slot.
5. Exercise dragging, drawing, multi-select, spawning and asset browsing below the trial message
   limit. Tune only from observed legitimate traffic; deliberately excessive traffic disconnects.
6. Restart and verify configured budgets remain active. Removing the variables restores the
   previous capacity behavior. Existing data must remain unchanged.

Before a public demo rollout, also verify concurrent guest allocation, forged/replayed invites,
cross-table access, every blocked write path, idle and absolute expiry, cleanup failure/retry,
restart recovery, orphan handling and traffic/storage ceilings. These future cases are not
covered by the first admission-budget slice.

## File and function inventory for this slice

| File | Change |
| --- | --- |
| `server/room-resource-limits.js` | Added `readRoomResourceLimits` to validate the five optional environment budgets. |
| `server/room-access.js` | Extended `createRoomAccess`, `checkedAccess`, `preflight`, `authorize` and `reconnect`; added `reserveRoom` and `releaseRoom`. Existing connection cleanup owns capacity release. |
| `server.js` | Injected parsed budgets; changed table/lobby `onCreate` and `onDispose` to reserve/release slots and configure the native message limiter. Editors inherit table behavior. |
| `test/backend-room-resource-limits.js` | Added valid/default/invalid configuration tests. |
| `test/backend-room-access.js` | Extended `harness` to inject limits; added race, lifecycle, account and pending-auth regression tests. |
| `test/backend-security-boundaries.js` | Extended `isolatedServer` to inject configuration; added a production-class allocation/admission/message-flood test. |
| `.env.example` | Documented optional trial values and linked this plan. |
| `docker-compose.yml` | Forwarded all five optional settings with disabled defaults. |
| `docs/REFERENCE.md` | Documented functions, environment/API contracts and deployment requirements. |
| `docs/ARCHITECTURE.md` | Documented ownership, concurrency, lifecycle and the scope of protection. |
| `CHANGELOG.md` | Recorded the implemented foundation under Unreleased, distinct from proposed guest/UI work. |
| `docs/DEMO_MODE_PLAN.md` | Added design, remaining phases, UI examples, validation, smoke tests and this inventory. |

The standalone `demo-entry-mockup.html` is a review artifact outside the application tree;
it adds no production controls, scripts, styles or icons. No functions were removed.

## Storage-slice file and function inventory

| File | Change |
| --- | --- |
| `postgres/024_demo_sessions.sql` | New migration for the temporary identity constraint and demo room/guest metadata. |
| `postgres/schema.sql` | Fresh baseline includes 024 and records it as applied; historical migration files unchanged. |
| `server/demo-queries.js` | Added `createDemoQueries`, `DemoError`, `DEMO_STORAGE_LIMITS` and the eight storage operations documented above. Local helpers: `tableShape`, `hash`, `id`, `name`, `transaction`, `checkCapacity`, `insertGuest`, `findSession`, `deleteGuests`. |
| `server/database.js` | `createDatabase` composes the demo query module with the injected pool. |
| `db.js` | Exports production `demo` API. |
| `server/user-queries.js` | `publicUserRow` adds demo identity/binding when applicable; `findUserByToken` checks live demo metadata and supplies the guest display name. |
| `server/room-access.js` | `readAccess` rejects guest admission to a different table even with a forged membership. |
| `test/backend-demo-queries.js` | New malformed-input, configuration and rollback/error-propagation tests. |
| `test/backend-database-factory.js` | Verifies production demo facade exports. |
| `test/integration/demo-sessions.js` | Ten real-PostgreSQL tests for allocation races, quotas, credentials/invites, idle/absolute expiry, restart, purge rollback/preservation, orphans and table binding. |
| `test/integration/database.js` | Expects the new numbered migration in the fresh schema. |
| `scripts/test-database.mjs` | Tests the actual 024 upgrade against populated prior schema, then runs the demo suite using the least-privilege app role. |
| `CHANGELOG.md` | Records storage implementation separately from pending runtime/UI work. |
| `docs/ARCHITECTURE.md` | Documents persistence, authority, cleanup ordering and remaining runtime boundaries. |
| `docs/REFERENCE.md` | Documents production exports, storage operations, error codes and schema dependency. |
| `docs/RELEASING.md` | Adds migration 024 upgrade requirements before server restart. |
| `docs/DEMO_MODE_PLAN.md` | Records entry/icon approval, storage implementation, test status and remaining runtime work. |

No production UI, environment variables or runtime scheduling changed in the storage slice.
The admission-slice changes remain in the same unpushed working tree.

Storage-slice manual staging check (not yet performed): back up and migrate a staging database
through 024, restart the application, then verify ordinary login, saved-room restoration and
shared library access. No client refresh is required for a UI change in this slice, but connected
clients must reconnect after restart. Guest end-to-end testing waits for the HTTP/runtime policy;
do not expose these internal allocation functions directly to visitors.
