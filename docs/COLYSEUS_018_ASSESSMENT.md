# Colyseus 0.18 upgrade record

Updated **2026-10-16**, app **0.22.0**. The coordinated upgrade is implemented
locally. No push, release, deployment, database migration or UI design change is
part of this work. Node 24 remains the production/CI target and minimum runtime.
See [verification and rollout](RELEASING.md#0230-colyseus-018-upgrade) for
completed checks and remaining manual acceptance.

## Exact published selection

Registry metadata was read on 2026-10-16. All four selected versions were the
package's **latest** dist-tag, not a prerelease/next selection. Downloaded tarballs
were checked against their published SHA-512 integrity before inspection/use.

| Package/artifact | Previous | Selected | Published requirements relevant here |
| --- | --- | --- | --- |
| `@colyseus/core` | `0.17.52` | **0.18.18**, exact root pin | Node `>=22.x`; schema `^5.0.8`; transport `^0.18.4`; Express 4 or 5 |
| `@colyseus/ws-transport` | `0.17.13` | **0.18.4**, exact root pin | Node `>=22.x`; core `^0.18.5`; Express 4 or 5 |
| `@colyseus/schema` | `4.0.31` | **5.0.40**, exact root pin | Optional TypeScript peer; no TypeScript installation needed for our JS app |
| Vendored `@colyseus/sdk` | `0.17.0`, embedded schema `4.0.1` | **0.18.5**, embedded schema **5.0.8** | Schema dependency `^5.0.8`; optional core peer `0.18.x` |

Exact registry manifests:
[core](https://registry.npmjs.org/@colyseus/core/0.18.18),
[transport](https://registry.npmjs.org/@colyseus/ws-transport/0.18.4),
[schema](https://registry.npmjs.org/@colyseus/schema/5.0.40),
[SDK](https://registry.npmjs.org/@colyseus/sdk/0.18.5).
`npm ls` confirms one compatible core/transport/schema tree with no invalid peer
resolution. The unchanged UMD SDK is copied from its npm tarball, not rebuilt.
Its header's schema version is the bundled decoder version, distinct from the
server's locked schema version; real-browser tests exercise that pair.

Artifact source, SHA-256 and tarball integrity are recorded in the
[vendored SDK provenance](../public/vendor/colyseus-README.md). Its complete MIT
license ships beside the bundle, including in Docker. The dependency inventory
records the remaining packages and intentional pins separately.

## Compatibility decisions

The [official migration guide](https://docs.colyseus.io/migrating/0.18) calls for
coordinated server/schema/SDK updates. Source review and tests support these
bounded decisions for this app:

- Keep Express 4, the current WebSocket transport, single-instance room ownership,
  application authentication, PostgreSQL facade and private state stores.
- Keep plain-JS `defineTypes`/reflection and `view()` filtering. Schema 5.0.40 emits
  a deprecation warning for `defineTypes`, but supports it. A future schema API
  migration is separate work; no build step or field reordering was introduced.
- The largest schema has 21 fields; all nine remain below the 63-field limit.
  No schema split is needed. Reviewed callers use `sessionId`, schema serialization,
  and no `setMetadata`/`setMatchmaking` merge assumptions.
- Optional Colyseus auth/database/admin/playground packages remain absent. Our
  Node-crypto password hashes need no Colyseus-auth password reset.
- Preserve the existing simulation interval, dt units and Cannon step ordering.
  `setSimulationInterval` remains supported as an alias; prediction, new fixed-step
  APIs and request/response messaging are outside this migration.
- Preserve self-hosted browser delivery and enforced CSP. No `unsafe-eval`, WASM
  permission, CDN, new service, port, environment variable or save conversion is added.

The lockfile changes only the Colyseus-related dependency set: core, schema,
transport, shared-types and greeting-banner; replaces `@colyseus/msgpackr` with
`msgpackr` 2.1.0. `msgpackr-extract` stays 3.0.4 and its script configuration is
unchanged. Unrelated direct packages, `qs` override, @types/node and offline
model-authoring locks are preserved. The root lock still has 253 non-root entries.

## Real-caller adaptations

### Static authentication

The published core 0.18.18 matcher extracts and calls static `onAuth` as a plain
function. The previous inherited `TableRoom.onAuth` accessed `this.accessKind`,
which fails before a real table can join. `TableRoom.onAuth` now passes `table`
explicitly, and `EditorRoom` has its own static `onAuth` passing `editor`. Both
reuse `roomAccess.preflight`. Instance creation and admission still recheck access;
this does not weaken pending-member or editor-admin policy. `LobbyRoom` already
passed its explicit kind and needed no change.

### Reconnect and leave lifecycle

The exact SDK emits `onReconnect` before assigning its rotated reconnection token.
`public/client.js` now persists the new token in a microtask after that event. The
live regression first reproduced stale session storage, then verified automatic
reconnect followed by browser refresh using the rotated token.

Server `TableRoom.onReconnect` now calls the existing `sendHand` after live access
and view synchronization. A refreshed browser receives its private hand without
relying on `onJoin`, which reconnect skips. Delivery remains restricted to that
client; hand counts/appearance retain the existing public schema representation.

The live logout test also exposed feature leave handlers touching the table DOM
after the page-level handler replaced it. The disconnect screen is now deferred
to a microtask so those cleanup handlers finish first. Its visible design is unchanged.
This is a bounded ordering fix, not a general render/resource teardown refactor.

These reconnect details extend existing behavior; automatic retry already existed
in the prior SDK. Account switching, pending inspection recovery and other
[hardening-plan findings](HARDENING_PLAN.md) are not claimed resolved by this work.

## Regression path and reuse

`npm run test:multiplayer` extends the existing disposable PostgreSQL harness with
`--multiplayer`; it first runs the database suite, then the new browser driver.
It uses the real `server.js`, production HTTP/auth/room handlers, actual table
client and vendored SDK. The new driver reuses existing Chrome/CDP helpers rather
than adding a browser dependency or duplicating database provisioning.

The driver requires test database URLs ending in `_test`, creates fixture users
and rooms in that disposable database, uses temporary upload storage, captures
bounded nonempty WebSocket frames, and cleans up browser/server/database processes.
It checks:

- Enforced CSP without `unsafe-eval`, legacy snapshot loading, reflected initial
  state, concealed faces/deck order and private-hand packet boundaries.
- Table/editor admin gating, pending lobby admission, and live role promotion/
  demotion updating hidden-object views.
- Private draw, restricted Show, and hide/reveal patches through an empty collection.
- Actual application's automatic reconnect, token rotation/storage and refresh
  hand hydration, followed by session revocation and rejected reconnection.
- Acknowledged saving, complete server restart and account-owned private-hand
  restoration under a fresh login.

The existing PostgreSQL CI job now runs this command on Node 24. The production
Alpine image job retains its schema/access/privacy/Sharp regressions. The browser
component fixture implements the new reconnect registration contract and waits
for its library binding in the scene that previously raced module initialization.

## Validation boundary

Exact artifact verification, compatible peer resolution, isolated clean install,
unit/browser/database/production-image results are recorded in the
[release guide](RELEASING.md#0230-colyseus-018-upgrade). Hosted CI has not run
for these unpushed changes. On 2026-10-16, the user reported that everything still
functions as expected after the local multiplayer smoke-test handoff and approved
a local commit; individual scenarios and device/network conditions were not
separately reported. Real devices, WAN loss/latency, sustained load, arm64
and operator deployment/rollback acceptance remain manual. The live driver uses
explicit memory rate limiting and a controlled reconnect-close signal; it is not
an end-to-end Redis, real Wi-Fi or load test.

Graph discovery used Tier 2 evidence plus current source. Vendor artifacts and
lockfiles were inspected directly because graph coverage excludes vendor code
and does not track lockfile freshness. Dynamic/object-member caller edges were
verified in production source instead of treating empty graph traces as absence.
The original assessment and Node prerequisite are historical context; the contracts
above describe the implemented local upgrade.
