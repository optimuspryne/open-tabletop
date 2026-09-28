# Security audit — 2026-09-28

Status: review completed; SEC-01–SEC-03 are **fixed**.
Automated remediation checks and user-reported manual acceptance are listed under [Remediation](#remediation).
The findings below preserve the original evidence against the source snapshot.
Source snapshot: `ac30aeee4a0b635e289923e7c3313f5137a4b4fa` (Open Tabletop 0.20.0).
Runtime used for verification: Node 26.10.0, Express 4.22.3, Colyseus core 0.17.51.

Three issues were reproduced: one high-priority room lifecycle flaw, one medium-priority
stored-script upload flaw requiring site-admin privileges, and one conditional medium-priority
metadata disclosure. No SQL injection or independent cross-user session-token bypass was
demonstrated in the reviewed paths. This is a source audit with isolated runtime tests, not a
certification that every deployment or dependency is vulnerability-free.

## Scope and method

- Reviewed HTTP authentication, room/admin/profile routes, WebSocket admission and reconnects,
  capability/role checks, private-hand and hidden-piece boundaries, persistence, runtime SQL
  construction, DOM HTML sinks, asset uploads, package archives, static file serving, CSP,
  rate limits, and supplied deployment configuration.
- Used the codebase graph at Auditor/Tier 3 scope, then traced material call paths and checked
  exact source. Coverage was checked for 84 evidence paths and the `server`, `shared`, and
  `public` scopes. The final checked generation was `2026-09-28T16:50:10Z`.
  No gaps were recorded for the checked first-party files. `node_modules` and `public/vendor`
  are excluded from the graph: relevant installed Colyseus lifecycle code was read directly;
  vendor version markers and application use were inspected, not every third-party source line.
  Binary assets were outside the source audit.
- Reproductions used temporary asset directories, a fake database, a fake browser token, and
  localhost servers. Production room classes, filesystem helpers, CSP, and the asset mount
  were extracted unchanged from `server.js`, with startup removed and database access replaced.
  No deployed host, real account, production database, or real token was attacked.
- Findings are distinguished from hardening suggestions. Passing existing tests does not
  negate a reproduced defect outside their coverage.

## Findings

### SEC-01 — High: unauthenticated duplicate rooms replace live instances and can overwrite saves

**Evidence:** `server.js:371` (`TableRoom.onCreate`), `server.js:382` (assignment to
`this.roomId`), `server.js:920` (`onDispose`), `server.js:990` (instance `onAuth`), and
`server.js:1444` (room registration; consult the current source if lines move).
Installed Colyseus `MatchMaker.mjs` exposes `create`, calls `onCreate` before instance
authentication, and assigns `rooms[room.roomId] = room` in `createRoomReferences`.

**Trigger and impact:** An unauthenticated caller who knows an existing room code can POST
to `/matchmake/create/table` with that code. The endpoint creates the room and reserves a seat
before the application's instance `onAuth` runs. It is unnecessary to connect a WebSocket.
`filterBy(['code'])` coordinates `joinOrCreate`; it does not prohibit explicit `create`.

`onCreate` replaces Colyseus's generated room ID with the persistent database room ID. A
duplicate therefore receives the same ID as the existing live table and replaces the registry
entry. It also loads a separate copy of the saved game and starts physics/timers. Its disposal
unconditionally saves that copy, so it can overwrite a newer checkpoint from the legitimate
instance. Disruption and persistence integrity are demonstrated; this probe did not demonstrate
unauthorized reading of synchronized game state or a successful authenticated WebSocket join.

**Reproduction results:** Two actual HTTP POSTs, without an Authorization header or body token,
returned HTTP 200 and created different production `TableRoom` instances with the same room ID.
The fake database recorded two state reads and **zero authentication reads**. The registry
pointed at the second instance. After the first saved `newer legitimate checkpoint`, invoking
the duplicate's production disposal hook saved `initial checkpoint` over it. Disposal was
invoked directly to keep the test bounded; its production hook and persistence helper were
unchanged. No load/stress attack was performed.

**Recommended fix:** Authenticate and validate room access at the matchmaking boundary before
allocating a room or loading game state; retain live access checks at connection/reconnect time.
Disable public explicit `create` where the application only needs `joinOrCreate`. Use a separate
field for the persistent database ID, leaving Colyseus's transport ID unique. Enforce one live
writer per persistent room and prevent disposal of an unadmitted/duplicate instance from
overwriting its state. Cover the actual HTTP matchmaking entry point in regression tests.

Do not blindly add a successful static `onAuth`: installed Colyseus can skip instance `onAuth`
when static authentication returns data. Preserve the existing membership/revocation tracking
and participation initialization when moving that boundary. The framework's
[authentication documentation](https://docs.colyseus.io/auth/room) also distinguishes static
authentication before room allocation from instance authentication after allocation; this audit
verified behavior against the installed 0.17.51 source, rather than assuming current 0.18 docs
match every detail.

### SEC-02 — Medium: legacy inline-image saving permits stored JavaScript and HTML

**Evidence:** `server.js:237` (`deckRefOk`), `server.js:240` (`saveAsset`),
`server.js:250` (`saveImageRef`), `server/game/library.js:19` (`saveDeckById`), and
`server/game/handlers/library.js:55` (admin deck creation) / `:127` (`saveDeck`).
The `/assets` mount serves resulting files on the application's origin.

**Prerequisites:** A site-admin session must submit/save the malicious deck content, and another
user must open the resulting crafted HTML URL. The tested creation path is admin-only. No
ordinary player-to-admin creation path was demonstrated. This is not the same as the previously
fixed overflow-menu `innerHTML` issue.

**Trigger and impact:** `saveImageRef` accepts any `image/\w+` subtype and derives the stored
extension from it without verifying the bytes. For example, `data:image/js;base64,...` creates
a `.js` file and `data:image/html;base64,...` creates a `.html` file. The later static response
uses those extensions to select executable MIME types. An HTML file can reference the uploaded
JavaScript with `<script src="/assets/decks/…js"></script>`, which the current `script-src 'self'`
allows. A compromised/malicious admin can thereby persist code that runs in other users'
origins, including after the attacker's admin permission is revoked.

**Reproduction results:** Actual `deckBegin`, `deckAppend`, `deckFinish`, and `saveDeck` handlers,
the production library save operation, and extracted production file writers created both files.
The production static mount returned `application/javascript` and `text/html`. Chromium loaded
the HTML under the production CSP and the script read `AUDIT-FAKE-TOKEN` from
`localStorage['tabletop.token']`. The probe only copied this dummy value into a browser variable;
it did not send credentials anywhere. Thus script execution and session-token readability are
confirmed; abuse of a real session was deliberately not attempted.

**Usage verification:** No current browser sender of `saveDeck` was found. The editor uploads
images separately and uses `deckBegin` → `deckAppend` → `deckFinish` to save decks and tile sets
(`public/editor/editor-panel.js:1322`). The registered server handler remains reachable through
crafted admin messages, so the missing UI caller does not resolve this finding.

**Agreed remediation plan (now implemented; original scope):** Remove the obsolete `saveDeck` handler,
the `TableRoom.saveDeckById` facade, the library service's `saveDeckById` operation, and
`saveImageRef` with its dependency injection. Remove the corresponding capability/visibility
entries and obsolete tests; retain `createLibraryOperations` and `sendAssetList` for current
library listing. Preserve the shared `saveAsset` writer, normal upload validation, and the
editor's `deckBegin`/`deckAppend`/`deckFinish` flow. No replacement inline-image saver is planned.

Add regression coverage showing that legacy `saveDeck` messages cannot write files or library
records, and that current deck/tile save and edit flows still work with uploaded references.
Run `npm run check` and applicable database integration checks, then manually smoke-test image
deck creation, editing, cloning, and tile-set saving. Update the implementation documentation
when removal lands; existing behavior descriptions remain accurate until then.

Alongside SEC-03, restrict asset serving to expected categories and file extensions with safe
MIME types. Removing the writer alone does not prevent serving any executable files already
present in asset storage. This follows the independent content/type checks described by the
[OWASP file-upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).

### SEC-03 — Medium, conditional: URL encoding bypasses the JSON metadata guard

**Evidence:** `server.js:1302` checks `/\.json$/i` against `req.path` before
`express.static(ASSETS_DIR)` serves the file.

**Prerequisites:** Sensitive JSON must actually exist inside the served asset directory, and
the attacker must know or guess its relative path. The current application primarily keeps
metadata in PostgreSQL, so a clean install without such JSON files has no demonstrated secret
disclosure from this issue. Legacy deployments/backups under the asset root are the concern;
their presence was not checked on the user's host.

**Trigger and impact:** Express's `req.path` retains percent encoding, while static file
resolution decodes it. A request ending in `legacy%2ejson` passes the guard but resolves to
`legacy.json`. This bypasses the intended confidentiality control without logging in.

**Reproduction results:** With a synthetic `decks/legacy.json` containing a fixture secret,
the exact production mount returned 404 for `/assets/decks/legacy.json` and 200 with the JSON
body for `/assets/decks/legacy%2ejson`.

**Recommended fix:** Prefer an allowlist of category plus generated filename/approved media
extension instead of an extension denylist. If retaining the guard, validate the same decoded
path used for serving and handle malformed encodings safely. Keep metadata and backups outside
the publicly served tree. Add encoded-extension, encoded-separator, and malformed-URL tests.

## Reviewed protections and areas without a demonstrated exploit

| Area | Evidence and result |
| --- | --- |
| SQL injection | Runtime user, room, library, collection, participation, preset, and template queries use PostgreSQL parameters for values. Dynamic table identifiers use the frozen, null-prototype `ASSET_TABLES` registry; SQL fragments are internally selected constants. A capture probe exercised eight query paths with SQL-shaped values and confirmed they remained parameters. Injected, `__proto__`, and `constructor` asset kinds never reached the executor. No injection path was found in this review. |
| Passwords and device tokens | `auth.js` uses salted scrypt and `timingSafeEqual`. Device tokens contain 32 random bytes; only SHA-256 digests are stored in expiring session rows. Missing/incorrect login responses share the same message, though the missing-user path skips scrypt (see hardening). |
| Session hijacking/reconnect | Shared room-access code checks account/session validity and room membership, binds supplied codes to the live room, rechecks reconnects, and cancels revoked reservations. Existing tests cover expiry, logout/logout-all, revocation races, and cross-room `joinById`. No independent token-forgery/reconnect bypass was found. SEC-02 nevertheless demonstrates a route to reading an existing browser token. |
| Authorization/private game data | Roles/capabilities are server-owned; hidden pieces use per-client views; deck order, concealed card fronts, hands and inspections stay in server-owned maps. Account-based hand persistence and restricted message paths have automated coverage. No new confidentiality bypass was reproduced in these reviewed flows. SEC-01 is a separate pre-admission lifecycle/persistence defect. |
| DOM XSS | Remaining first-party `innerHTML` assignments examined were static markup, numeric counts, or escaped bundled credits/tracks. The previously fixed overflow/action-sheet fields use text nodes. Chat/name/label rendering uses text APIs or canvas. No new user-text-to-HTML sink was demonstrated; SEC-02 reaches script execution through file serving instead. |
| Uploads and archives | `/upload` selects a raster extension from bytes; model validation rejects external buffer/image references. Package import validates manifests and bounded ZIP entries and does not extract supplied ZIP paths to disk. The earlier flagged package filesystem paths remain constrained. SEC-02 bypasses the normal uploader through the legacy saver. |
| CSRF / SSRF / command execution | Application HTTP authorization uses explicitly supplied bearer tokens rather than ambient authentication cookies; JSON mutation routes do not establish a demonstrated conventional cookie-CSRF path. No request-controlled server HTTP-fetch or shell-execution sink was found in the reviewed application routes. Cross-origin matchmaking access does not repair SEC-01. |
| Dependencies | Approved `npm audit --omit=dev --json` reported zero known vulnerabilities across its production dependency assessment (metadata: 138 production dependencies). This excludes vendored browser bundles, native libraries, OS/container packages, and unpublished vulnerabilities. |

## Hardening suggestions, not additional confirmed exploits

1. **Bound work before and after admission.** Besides SEC-01, the installed room message-rate
   default is `Infinity`; the application does not set a finite room message rate. Review
   per-user limits and bounded concurrency for large avatar updates, expensive gameplay work,
   `/host/request`, template creation, and uncached texture conversions. Existing auth/upload
   IP buckets do not cover all these paths. No resource-exhaustion load test was run.
2. **Protect browser credentials.** Local storage makes any same-origin script execution a
   token-read opportunity. Fix SEC-02 first. An HttpOnly/Secure/SameSite cookie design may
   reduce token theft, but requires deliberate HTTP/WebSocket and CSRF design and does not
   prevent malicious same-origin actions. Consider shorter session lifetimes and reauthentication
   for especially sensitive account/admin actions. See
   [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).
3. **Verify deployment transport.** The supplied application serves HTTP, and Docker publishes
   port 2567. TLS is delegated to the operator. Use HTTPS/WSS on untrusted networks, restrict
   direct backend access when proxying, and configure the exact trusted proxy depth. This audit
   did not inspect the user's firewall, TLS termination, proxy logs, or live deployment.
4. **Reduce secondary leakage and tighten consistency.** Add `Cache-Control: no-store` to
   sensitive auth/admin/preset responses consistently. Consider a dummy scrypt verification
   for missing/passwordless users and account-based throttling alongside IP throttling; login
   bodies are uniform, but computational paths differ. Review admin/preset/room mutations for
   consistent live authorization/transaction boundaries after asynchronous work. These are
   hardening opportunities, not demonstrated account takeover findings.
5. **Maintain a vendor inventory.** `npm audit` does not audit `public/vendor`; the inspected
   bundles identify Three revision 161 and Colyseus SDK 0.17. Track exact revisions/checksums and
   upstream advisories separately. Their version markers alone do not prove vulnerability.

## Verification and limits

- `npm run check`: passed lint, formatting, CSS checks, and **907 tests**.
- `env -u TEST_DATABASE_URL -u TEST_DATABASE_OWNER_URL npm run test:integration`:
  **22 tests passed**, using a disposable PostgreSQL container, then removed.
- `npm run test:components`: passed the component matrix (including overflow text safety)
  and notecard browser tests at 1280px mouse, 390px touch, and 360px touch. The fixture reported
  eight missing thumbnail asset paths while still exiting successfully; this is not a claim
  that every production asset URL or visual was manually verified.
- Focused SQL parameter/identifier probe: passed eight value paths plus three rejected kinds.
- Isolated room lifecycle probe: reproduced SEC-01 through real HTTP matchmaking; state
  persistence used a fake database and explicit disposal.
- Isolated asset/Chromium probe: reproduced SEC-02 and SEC-03 with fake content and credentials.
- `npm audit --omit=dev --json`: zero reported vulnerabilities; no dependency changes made.

The temporary reproduction scripts are `/tmp/ott-audit-rooms.mjs` and
`/tmp/ott-audit-assets.mjs`; their extracted fixtures are `/tmp/ott-audit-isolated-server.mjs`
and `/tmp/ott-audit-http-fixture.mjs`. They are local audit artifacts, not regression tests or
production code, and are not committed. Audit logs use `/tmp/ott-security-*.log` and
`/tmp/ott-security-npm-audit.json`. These files may disappear when temporary storage is cleaned.

This review did not perform sustained fuzzing/load testing, a complete manual audit of every
dependency or graphics/physics algorithm, production network penetration testing, OS/container
scanning, or Git-history secret scanning. Original audit validation is recorded above. Remediation validation and user-reported manual acceptance follow.


## Remediation

Implemented on 2026-09-28; no push or deployment performed by the agent.

- **SEC-01:** static matchmaking authentication for table/editor/lobby precedes allocation;
  public explicit `create` is disabled. Table creation rechecks access, preserves unique Colyseus
  transport IDs, and claims a process-local writer for `persistentRoomId` before loading state.
  Membership, participation and saves use that durable ID. `onJoin` performs fresh authorization,
  registers revocation tracking and retains spectator initialization; reconnect checks are retained.
  Writer ownership survives the final queued save. Failed/duplicate creations and instances with
  no successful admission cannot save. The writer guard assumes the supported single-server
  deployment; multiple application servers would need coordinated writer ownership.
- **SEC-02:** removed the legacy handler, room facade, library saver, inline writer/injection,
  capability and visibility entries. Current chunked deck/tile saves continue using uploaded refs.
- **SEC-02/SEC-03 asset boundary:** decoded-path allowlisting restricts category, generated filename
  and raster/GLB extension. Encoded separators and malformed URLs fail closed. Explicit media MIME,
  `nosniff` and sandbox CSP prevent old script/HTML files from remaining executable public assets.
  Stored originals are preserved; non-generated legacy media names need supported re-uploading.

### Validation

- Regression tests exercise real localhost HTTP matchmaking using extracted production classes
  and registration, replacing database/storage and omitting application boot. They cover rejected
  unauthenticated/unauthorized allocation, disabled explicit creation, concurrent joins, duplicate
  writer rejection, distinct transport/durable IDs, cross-room admission, revoked reservations,
  spectator setup, revocation tracking and unadmitted disposal.
- Asset HTTP regressions cover supported media, safe response headers, plain/encoded executable
  and metadata filenames, encoded separators, malformed encodings and valid encoded image suffixes.
- Legacy admin messages and current deck/tile create/edit/clone regressions are included.
- `npm run check`: lint, formatting, CSS checks and **908 tests passed**.
- Startup-failure cleanup and writer retention through a delayed final save are regression-tested;
  reopening restores the completed checkpoint. `git diff --check` passed.
- Disposable PostgreSQL integration suite: **22 passed**; container removed.

### Manual acceptance and remaining scope

Restart the server and refresh clients. Verify owner/player/spectator joins, pending lobby admission,
reconnect and logout/revocation; save a table, empty/reopen it and confirm the latest state. In the
editor, upload images, create/edit/clone a deck and save a double-sided tile set; confirm images/models
and their thumbnails load.

The user reported manual tests green on 2026-09-28 and authorized committing the fixes.
This records user-reported acceptance of the smoke-test handoff; no separate per-device
or per-scenario results were provided.

The audit's five **hardening suggestions** remain follow-up work, separate from the three confirmed
vulnerabilities: workload limits, credential/session redesign, deployment TLS verification,
response-cache/login-timing consistency and a vendor advisory inventory. No live deployment,
firewall, historical asset storage or real user credentials were inspected or modified.


### Changed-file inventory

The implementation extends the existing access service and persistence/member helpers. A dedicated
asset-serving router is the only new production module; it owns URL/type validation at the HTTP
boundary. No replacement inline saver or new deployment infrastructure was introduced.

| File | Change |
| --- | --- |
| `server.js` | Adds static table/editor/lobby authentication, `authorizeJoin`, persistent IDs and writer ownership; updates creation/join/disposal/save wiring and asset mount; removes `saveImageRef` and `saveDeckById`; disables public explicit matchmaking creation. |
| `server/room-access.js` | Adds `preflight`; `readAccess` returns durable identity/name and checks identity against the live room. Existing revocation and reconnect machinery is reused. |
| `server/game/handlers/members.js` | Member mutation handlers use `persistentRoomId`. |
| `server/game/member-service.js` | `sendMembers`/`broadcastMembers` use the durable ID; lobby transport IDs remain unchanged. |
| `server/game/participation.js` | `setPlayerTimeout`/`setParticipation` use the durable ID. |
| `server/game/handlers/room-state.js` | State-save handler, `scheduleRoomSave` and `saveRoomStateNow` use the durable ID; write queue remains intact. |
| `server/game/handlers/library.js` | Removes the obsolete `saveDeck` registration and unused validator import. |
| `server/game/library.js` | Removes `saveDeckById`, `isDataURL` and writer injection; retains `createLibraryOperations`/`sendAssetList`. |
| `server/game/piece-visibility.js` | Removes the obsolete saver from deck-message visibility classification. |
| `shared/room-capabilities.js` | Removes the obsolete saver capability entry. |
| `server/http/routes/asset-files.js` | Adds `createAssetFilesRouter` with decoded-path allowlisting and explicit safe response types/headers. |
| `test/backend-security-boundaries.js` | Adds production-class matchmaking and asset HTTP regressions, isolated storage/database harness and transport helper. |
| `test/backend-library-handlers.js` | Removes obsolete facade fixture; adds uploaded deck/tile edit/clone regressions. |
| `test/backend-library-operations.js` | Removes obsolete saver tests/injection and retains list-delivery/error coverage. |
| `test/backend-member-handlers.js` | Updates durable room identity fixture. |
| `test/backend-member-service.js` | Updates durable room identity and editor fixture. |
| `test/backend-participation.js` | Updates durable room identity fixture. |
| `test/backend-room-state-handlers.js` | Updates identity fixtures and assertions for persistence tests. |
| `test/backend-scene-persistence.js` | Updates final-save identity fixture. |
| `test/backend-spectators.js` | Updates durable room identity fixture. |
| `test/backend-interaction-policy.js` | Updates member-handler identity fixture. |
| `test/backend-deck-browsing.js` | Updates table identity fixture for consistency. |
| `CHANGELOG.md` | Records fixes under Unreleased and links the audit status. |
| `docs/REFERENCE.md` | Updates authentication, identity, persistence, asset and library contracts. |
| `docs/ARCHITECTURE.md` | Records authorization/allocation and single-writer boundaries plus legacy removal. |
| `docs/SECURITY_AUDIT_2026-09-28.md` | Preserves original findings and adds remediation, validation, manual acceptance and this inventory. |
