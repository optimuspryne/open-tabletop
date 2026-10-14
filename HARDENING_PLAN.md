# Hardening plan

Created: 2026-10-01. Last updated: 2026-10-07.

## Purpose and scope

Living record of security concerns and related usability findings from the user-journey
walkthrough. Update this file as the walkthrough continues, preserving finding IDs, evidence,
decisions, and verification history.

The initial scope is the two discussions covering landing-page access, signup, login,
host requests and administrator approval, followed by alternatives to session-token storage
in `localStorage`. The earlier database/startup discussion is outside this initial scope.
This supplements the [earlier security audit](docs/SECURITY_AUDIT_2026-09-28.md); it does not
replace that audit or reopen its remediated findings without new evidence.

The next walkthrough extends coverage to all landing-page controls: Quick Join, room listing,
creation, joining/waiting, Enter/Watch, owner actions, avatar/preferences, account-security and
recovery screens, navigation and logout. The separate administrator console and in-table
gameplay remain outside this chunk except where needed to verify access boundaries.

The table-entry follow-up covers Enter/Watch, matchmaking and admission, live-room creation,
saved-state restoration, initial public/private delivery, browser hydration and refresh/reconnect.
It stops at readiness to interact; individual gameplay operations and media-serving privacy
need their own walkthroughs.

The first-interaction follow-up covers local picking/selection, single and group grabs,
validated movement targets, server physics, release/throw, synchronized rendering and
interruption cleanup. Card/deck actions reached through clicks or release are identified as
boundaries; their complete inventory and reveal workflows remain for a later chunk.

The card-lifecycle follow-up covers ordinary draw/deal, private hands and reordering,
inspection placement/recovery, face-up/down transfers, selective reveals, deck browsing,
split/shuffle/combine and return-to-deck boundaries. Asset-file access and a complete review
of notecard editing remain outside this chunk. Runtime fixes are still separate work.

The library-loading follow-up covers opening/filtering the catalog, published/private list
delivery, existing-asset loads, built-in spawning, hidden placement, scene/board replacement
and starter setup. It also checks the original-media URL boundary used by these assets.
Uploading, authoring, package import/export and comprehensive media-processing limits remain
outside that chunk.

The asset-authoring follow-up covers image/model uploads, deck/tile drafting, saved-asset
editing and publication, collection mutation boundaries, and ZIP/legacy JSON package
preview/import/export. It records upload middleware ordering, media-validation differences,
and deck-save recovery. Full media complexity/load testing, browser recovery, deployment
quotas and exhaustive editor-control coverage remain pending.

The persistence follow-up covers background settings writes, manual table snapshots, reset,
departing-player inventory, final room disposal and cold restoration. Installed framework
shutdown code was read to distinguish graceful shutdown from forced termination. Findings
cover snapshot freshness, failure/oversize recovery and conflicting saved configuration;
actual process-kill/database-outage and deployment backup testing remain pending.

The communication/writing follow-up covers chat attribution/rendering/history, shared room
notes, private notebooks, whiteboard ownership/stroke replay, notecard edit leases and content
delivery, plus reusable notecard-template authorization. It distinguishes security/availability
concerns from note recovery and canvas consistency. Real browser load, disconnect recovery,
collaborative editing conflicts and exhaustive template lifecycle testing remain pending.

The in-room administration follow-up covers member lists/admission, role changes, kicking,
durable time-outs, self-service spectators, turn/timer/score controls and forced exits. It
records a stale-target authorization race in kick/role changes separately from the stronger
transactional participation path. Real PostgreSQL concurrency and multi-browser testing remain
pending; the reproduction uses production message handlers with deferred database doubles.

The table/spatial follow-up covers table geometry/materials, lighting preview and shared/default
settings, measurement scale/grid calibration, ruler/shape overlays, manual fog and reveal auras,
and explicit hidden-object delivery. It extends cancellation and broadcast-budget findings and
records map fog's existing visual-only privacy boundary. Browser/GPU/load and real-device
interruption verification remain pending.

The local-browser follow-up covers camera/input routing, graphics quality selection, audio
and appearance preferences, render-resource ownership and exit handling. It records unsafe
pixel-ratio overrides, uncontained preference-storage failures and modal keyboard routing.
GPU allocation, real browser storage policies, modal focus behavior and exit resource profiles
remain separate manual/browser verification work.

The account-security/site-administration follow-up traces password changes, verification and
recovery, session revocation, admin account controls and permanent account removal. It records
in-flight login and administrator-authorization races with synthetic production-route checks;
live database concurrency, SMTP delivery and destructive browser workflows remain unverified
in this review. Asset cleanup and texture maintenance need their own operational walkthrough.

The administrator-maintenance follow-up covers orphan preview/rescan, database/live reference
collection, trash moves, texture-cache variants, background prebuild and public on-demand
derivatives. It records incomplete derivative cleanup/result accounting and missing shared
conversion admission limits. Fixtures use temporary files and a paused encoder double; no
production assets were moved and no load/exhaustion test was performed.

The failure-handling/server-safeguards follow-up covers HTTP parsing and error propagation,
representative database reads and room-message/lifecycle boundaries, browser error handling,
configured Helmet/CSP headers, proxy-IP selection and token-bucket failure behavior. It adds
logging and HTTP error-classification findings and extends the auth-budget finding to CSP
telemetry. This is bounded source/fixture coverage, not an exhaustive endpoint or deployed
proxy/logging audit.

The deployment/recovery follow-up covers Docker and native installer configuration, runtime
versus migration credentials, bootstrap, startup migrations, update backups and recovery
contracts. It records retained privileged credentials, incomplete build-context exclusions and
the limits of upgrade database dumps. This extends the initial account-focused scope to
deployment/startup; no real secrets, containers, services or databases were inspected or changed.

This is a plan, not an implementation record or a claim that the application is secure.
No runtime fixes below have been implemented as part of this review. Recording a possible
fix does not select its final design. UI changes still require concrete examples and explicit
approval under the repository's UI workflow.

## Evidence and status conventions

- **Observed:** behavior verified in current source; not necessarily an exploitable vulnerability.
- **Conditional risk:** impact depends on another weakness or deployment condition.
- **Proposed safeguard:** required when adopting a proposed change; not a claim that today's
  bearer-token implementation already has that vulnerability.
- **Verification pending:** testing or deployment inspection needed before a stronger claim.

Track implementation, automated verification, and manual/user verification separately.
The batch assignments below are suggested work order, not CVSS scores or confirmed exploit severities.

## Consolidated implementation sequence

Consolidated on 2026-10-07 from all 46 findings. This section supersedes the earlier
account-only work order; the individual evidence, proposed fixes and verification history
remain authoritative for each finding. No finding is resolved by being assigned a batch.
All batches below are **planned, not implemented**. This consolidation authorizes no runtime,
deployment or UI changes; implementation remains the next task.

Priorities weigh impact, demonstrated behavior, required attacker access, breadth of exposure
and dependencies. An ordinary action disclosing private cards merits an early fix; a
configuration-dependent image leak is conditional but also inexpensive to prevent. Resource
exhaustion has not been measured, and policy choices are not automatically vulnerabilities.
The letters describe a recommended default sequence, not severity scores or effort estimates.
Independent ready fixes can move forward without waiting for every earlier design decision.

### Decision track — start now, resolve before dependent changes

| Decision | What must be settled | Dependent work |
| --- | --- | --- |
| Email/host identity | Does host approval require verified email, or does the operator knowingly approve an unverified identity? Preserve a workable no-SMTP/passwordless path. | Policy batch P1: HARD-06; recovery proof design in B3 |
| Meaning of private assets and fog | Choose whether private assets promise only catalog filtering or protected media delivery; distinguish visual fog from withheld map data. Existing recipients cannot forget data. | Policy batch P1: HARD-22/34; any later confidential-media/map implementation |
| Session contract | Choose supported HTTPS/local-development behavior, remembered-login lifetime, origin/CSRF rules, multiplayer cookie or short-lived ticket support, reconnect binding and old-token migration. | C1: HARD-01/02/03/08/09/14; retain B4's account-binding invariant |
| Recovery-code enrollment | Define fresh proof for password accounts and first setup for passwordless accounts without requiring a nonexistent password or SMTP. | B3: HARD-10 |
| Durability contract | Define the acceptable crash-loss window, manual-checkpoint semantics, oversize handling, failed-save recovery storage and shutdown bounds. | B7 and B10: HARD-26/27/28/46 |
| Deployment privilege boundary | Choose operator migration execution for Docker and native installs, credential delivery/removal, upgrade compatibility and rollback responsibilities. | B5: HARD-44 |

Approve concrete examples before adding/changing/removing UI elements, including new security
forms, save/recovery status, warnings or controls; obtain icon choices when needed. This does
not block unrelated server-only work or automatically require approval for every logic fix.
No policy choice above is accepted by this plan. Record the selected policy and rationale in
the corresponding finding; keep policy acceptance separate from implementation/testing.

### Delivery batches — one primary assignment for every finding

Track labels distinguish security/privacy, data preservation and reliability/UX. A finding can
affect more than one track. Each row is a cohesive workstream; multi-finding rows should still
be split into independently reviewable/testable changes when their implementations differ.

| Batch | Track | Findings | Concrete outcome and dependency |
| --- | --- | --- | --- |
| P1 — privacy/identity decisions | Policy | HARD-06, HARD-22, HARD-34 | Resolve the first two decisions above; document an accepted boundary or scope a separate privacy feature. Do not silently change game rules or treat fog as confidential delivery. |
| A1 — reveal scope | Security/privacy | HARD-19 | Empty Picked reveals nothing, stops a prior reveal, and updates recipients when selection changes. First recommended implementation. |
| A2 — login issuance | Security | HARD-38 | Issue a password-login session only after a locked expected-hash check; serialize with reset/change. Independent of cookie migration. |
| A3 — upload admission | Security/availability | HARD-23 | Authenticate and apply the intended limiter before buffering direct-upload bodies; preserve package-upload protections. |
| A4 — error/log boundary | Security and operations | HARD-42, HARD-43 | Redact/bound logs and CSP telemetry, preserve useful diagnostics, and classify known parser failures without exposing internal messages. Coordinate CSP budget isolation with C2. |
| A5 — build contents | Security | HARD-45 | Exclude local secrets/session material from Docker context/image; verify using synthetic canaries in a disposable context. |
| A6 — browser setup bounds | Reliability/availability | HARD-35, HARD-36 | Bound the pixel-ratio override and contain optional preference-storage exceptions. Separate small fixes; do not change tuned normal presets incidentally. |
| A7 — modal ownership | Data preservation/UX | HARD-37 | Prevent background destructive shortcuts while a modal owns input. Verify focus and keyboard behavior; approve UI changes if needed. |
| B1 — member authorization | Security | HARD-11, HARD-33 | Make admission-policy checks and membership mutations atomic with current actor/target authority. Use separate patches for admission and role/kick paths. |
| B2 — site administration | Security | HARD-39 | Revalidate actor authority transactionally, serialize final-admin protection across HTTP/CLI/deletion, and coordinate destructive lifecycle side effects. |
| B3 — recovery proof | Security | HARD-10 | Require the selected fresh-proof policy before replacing recovery codes, with live session/credential rechecks. Needs enrollment decision and any form approval. |
| B4 — reconnect identity | Security | HARD-15 | Prevent account A's stored reconnect credential from resuming under a browser now using account B. Implement a current-protocol guard; reverify it during C1. |
| B5 — deployment secrets | Security | HARD-44 | Remove owner credentials from the steady-state app identity while retaining an explicit, tested deployment migration path. Needs deployment decision. |
| B6 — preserve inventory/drafts | Data preservation | HARD-20, HARD-25 | Stage/preflight transfers and replacements before consuming source state; retain authoring drafts until acknowledged success. Test rollback and ambiguous failure cases separately. |
| B7 — durable snapshots | Data preservation | HARD-26, HARD-27, HARD-28 | Establish snapshot freshness and setting precedence, then bounded final-save recovery without losing the last good save or writer ordering. Needs durability decision. |
| B8 — private/written recovery | Data preservation/UX | HARD-21, HARD-29 | Restore pending inspection UI safely and make note acceptance/limits/drafts recoverable. Preserve private audiences; obtain examples for changed recovery feedback. |
| B9 — interaction cleanup | Integrity/availability | HARD-17, HARD-18 | Release replaced group claims and cancel gestures without committing movement/measurement actions. Keep server permissions and touch behavior intact. |
| B10 — restore checkpoint | Data preservation/operations | HARD-46 | Coordinate confirmed saves, DB/original-asset capture, version/config recovery and credential invalidation; perform an isolated restore drill. Complete after B7 defines the durable state. |
| C1 — coherent session rollout | Security | HARD-01, HARD-02, HARD-03, HARD-08, HARD-09, HARD-14 | Roll out HttpOnly sessions, CSRF/origin checks, multiplayer admission/reconnect, confirmed logout and account-lifecycle cleanup together. Needs session contract and B4 regression coverage. |
| C2 — authentication/room abuse | Security/availability | HARD-04, HARD-05, HARD-12 | Separate telemetry allowance, add bounded account/IP/global controls and room budgets, and address enumeration deliberately. Telemetry isolation can accompany A4; do not wait for the rest of this batch. |
| C3 — media ingestion | Security/availability | HARD-13, HARD-24 | Reuse validated image rules for avatars/direct uploads; bound model/embedded-media complexity without destroying originals. Build on A3 admission ordering. |
| C4 — shared work/history limits | Availability | HARD-31, HARD-41 | Bound chat/preview traffic and client history, and share a bounded derivative scheduler across public requests/prebuild. Measure budgets; no new scaling infrastructure by default. |
| C5 — chat identity | Security/integrity | HARD-30 | Attribute messages by stable identity rather than a non-unique display name; present approved identity cues where UI changes are required. |
| D1 — lobby/loading recovery | Reliability/UX | HARD-07, HARD-16 | Refresh approval state and provide bounded, cancellable loading with a usable recovery path. Approve affected desktop/touch layouts. |
| D2 — maintenance consistency | Reliability/operations | HARD-32, HARD-40 | Reconcile whiteboard history with displayed pixels; clean all cache variants and report partial trash outcomes accurately. These are separate implementation slices. |

**Ordering adjustments.** Start the C1 session design immediately, even while A/B patches ship;
its later rollout position reflects coupling, not low security importance. For an imminent
public deployment, bring C2–C4 forward before expanding exposure. For an imminent upgrade or
release build, verify A5 and plan B5/B10 first. For active games, prioritize A1/A7 and B6–B9 to
reduce disclosure and lost work. Do not delay a ready high-impact fix for cosmetic polish, and
do not claim public-deployment readiness from completion of A alone.

### First implementation handoffs

1. **A1 / HARD-19:** reuse the hand controller's selection and existing showStart/showStop
   protocol. Distinguish All from empty Picked; switching to empty Picked must stop a previous
   reveal, not merely suppress a new request. Reconcile selection and hand changes while
   revealing. Regression tests must inspect actual recipient payloads for empty selection,
   deselect-last, selection changes and playing a shown card. Finish with a two-browser check.
2. **A2 / HARD-38:** extend the existing credential transaction/locking pattern to login
   issuance. Keep expensive password verification outside the lock, then compare the current
   hash and insert under the same account lock used by reset/change. Test both transaction
   orders using real isolated PostgreSQL; an unlocked extra read is insufficient.
3. **A3 / HARD-23:** reuse existing auth/limiter middleware before direct body parsers. Verify
   unauthorized and throttled requests cannot invoke buffering/storage, legitimate uploads
   still work, and parser errors retain the A4 classification/redaction contract.

These are suggested next tasks, not changes already made. Before implementation, refresh
source/graph evidence and inspect callers; the review's recorded generation is not a permanent
freshness guarantee. Reuse current helpers and preserve unrelated edits/tuned constants.

### Dependencies and completion gates

- **Session safety:** B3/B4/A2 improve the existing protocol independently; C1 must preserve
  them. Cookie, CSRF, HTTP, multiplayer and migration changes may be developed in slices but
  must not ship as an inconsistent authentication transition. Test legacy-token retirement,
  logout failure, account switching and replay/reconnect across tabs and browsers.
- **Data recovery:** B6 keeps failure recoverable in memory; B7 makes the intended state durable;
  B10 verifies that state survives backup and restoration with original assets. These are
  different guarantees. An existing DB dump can be restore-tested early, but that does not
  complete the coordinated checkpoint requirement or promise zero loss.
- **Availability:** A3 gates upload work; C3 bounds media cost; C4 bounds queued/shared work.
  Per-IP throttling alone is not any of these guarantees. C2 telemetry isolation removes a
  known interaction but does not by itself solve distributed guessing or room allocation.
- **Secret containment:** A4 protects diagnostics, A5 protects artifacts and B5 isolates
  deployment credentials. None substitutes for the other or proves the host is uncompromised.

Each implementation slice must record **implementation**, **automated verification** and
**manual/deployment verification** separately. Existing passing tests in this document describe
the reviewed code; they are not evidence that the new findings have been fixed. Do not combine
historical test totals into a claimed unique full-suite pass.

For code changes, run `npm run check` and meaningful regressions through real production
registrations/callers. Add `test:integration` for database/query/migration changes, `test:input`
for input, `test:components` for DOM/components and `test:devices` for responsive layout changes.
Use isolated PostgreSQL races for authorization/session fixes, browser recipient inspection
for confidentiality, and disposable crash/restore or load fixtures for durability/resource
claims. Deployment batches need effective-permission and synthetic-image checks in addition
to unit tests. State failures/blockers and remaining manual testing explicitly.

Close a finding only when its acceptance checks are satisfied for the chosen scope; otherwise
record the remaining limitation. For a retained policy, record an explicit accepted-risk/design
decision without labeling the underlying behavior fixed. No new UI is implemented before its
required example approval; no deployment, live-data test or push is implied by this plan.

## Findings register

| ID | Finding | Evidence classification | Primary batch | Status |
| --- | --- | --- | --- | --- |
| HARD-01 | Long-lived account token is readable by page JavaScript | Observed storage; conditional theft risk | C1 | Open |
| HARD-02 | Cookie adoption requires CSRF defenses | Proposed safeguard | C1 | Design pending |
| HARD-03 | Multiplayer joins and reconnects must preserve session boundaries | Observed token use; proposed migration safeguards | C1 | Design pending |
| HARD-04 | Login timing and signup responses can reveal account existence | Observed branches/messages; timing exploit unmeasured | C2 | Open |
| HARD-05 user creds  | Authentication throttling is based only on IP address | Observed limiter; distributed abuse untested | C2 | Open |
| HARD-06 | Signup email ownership is not required for host approval | Observed policy; identity-misrepresentation risk | P1 | Open |
| HARD-07 | Host approval leaves an open landing page stale | Observed UI flow; usability issue | D1 | Open |
| HARD-08 | Secure-cookie rollout needs an explicit hosting/development policy | Proposed safeguard; live deployment uninspected | C1 | Design pending |
| HARD-09 | Logout silently tolerates failed server revocation | Source and isolated client reproduction | C1 | Open |
| HARD-10 | Recovery-code generation requires no fresh proof beyond a session | Source and isolated handler reproduction; conditional takeover chain | B3 | Open |
| HARD-11 | New room membership uses a previously read admission policy | Source and deterministic mocked interleaving | B1 | Live concurrency verification pending |
| HARD-12 | Room creation/join paths lack application-level abuse limits | Observed router/composition boundary; abuse unmeasured | C2 | Open |
| HARD-13 | Avatar validation checks a prefix and length, not image contents | Source and direct validator reproduction | C3 | Open |
| HARD-14 | Resolved room-admission state survives retries and account changes | Observed client lifecycle; browser reproduction pending | C1 | Open |
| HARD-15 | Saved reconnect credential can resume a different account from the current login | Source and isolated client/access-service reproduction; browser chain pending | B4 | Open |
| HARD-16 | Initial table loading has no bounded recovery path | Observed client loops; reliability/availability concern | D1 | Open |
| HARD-17 | Replacing a grabbed group can strand earlier piece ownership | Source and isolated production-handler reproduction | B9 | Open |
| HARD-18 | Cancelled piece/measurement gestures still commit actions | Source and isolated production-router/controller reproductions | B9 | Open |
| HARD-19 | Empty “Picked” reveal scope falls back to the entire hand | Source and isolated production-hand-UI reproduction | A1 | Open |
| HARD-20 | Transfers and table replacement can discard prior state before a failing destination | Source and injected-failure production-function reproductions | B6 | Open |
| HARD-21 | A pending card inspection is not restored after a successful refresh/reconnect | Observed lifecycle; browser reproduction pending | B8 | Open |
| HARD-22 | Private catalog status does not protect direct media URLs | Observed serving policy and anonymous synthetic-media test; conditional confidentiality risk | P1 | Open |
| HARD-23 | Direct uploads buffer request bodies before authenticating | Source and isolated production-middleware reproduction; availability impact unmeasured | A3 | Open |
| HARD-24 | Direct image uploads and GLB contents lack complete media validation | Source and tiny malformed-media reproductions; resource-exhaustion risk unmeasured | C3 | Open |
| HARD-25 | Deck authoring clears recoverable state before a confirmed save | Source and isolated client/server failure reproductions | B6 | Open |
| HARD-26 | Background room saves retain the last captured game snapshot | Observed durability policy and isolated stale-snapshot reproduction | B7 | Open |
| HARD-27 | Failed or oversized final saves lack a durable recovery path | Source and isolated failure/oversize reproductions | B7 | Open |
| HARD-28 | Older scene settings override newer saved room settings on reopen | Source and isolated save/restore reproduction | B7 | Open |
| HARD-29 | Notes can appear accepted while their updates are silently rejected or unsent | Source and isolated over-limit/debounce checks | B8 | Open |
| HARD-30 | Chat attribution trusts non-unique display names | Source and isolated same-name rendering reproduction | C5 | Open |
| HARD-31 | Chat broadcast rate and client history lack application bounds | Source and bounded 100-message reproduction; load impact unmeasured | C4 | Open |
| HARD-32 | Whiteboard history eviction leaves old ink visible until repaint | Source and instrumented-canvas reproduction | D2 | Open |
| HARD-33 | Kick and role changes can use a stale target role | Source and deterministic production-handler interleavings | B1 | Open |
| HARD-34 | Map fog covers content already delivered to players | Documented design, source and synthetic schema serialization | P1 | Policy decision |
| HARD-35 | URL pixel-ratio overrides lack positive and upper bounds | Source and isolated resolver checks; no GPU stress | A6 | Open |
| HARD-36 | Optional preference-storage failures can interrupt table initialization | Source and production preference-controller reproduction | A6 | Open |
| HARD-37 | Gameplay keyboard shortcuts can act behind an active modal | Source and production-router reproduction | A7 | Open |
| HARD-38 | An in-flight old-password login can issue a session after password reset | Source and deferred-verification route reproduction | A2 | Open |
| HARD-39 | Site-admin mutations retain stale authority and lack atomic final-admin protection | Source and deferred-read/cross-demotion route reproductions | B2 | Open |
| HARD-40 | Trash cleanup leaves cache variants and can misreport completed moves | Source and temporary-file failure reproduction | D2 | Open |
| HARD-41 | Public texture cache misses lack a shared bounded work queue | Source and six-job admission fixture; resource impact unmeasured | C4 | Open |
| HARD-42 | Error and CSP-report logs retain unsanitized request/exception data | Source and synthetic-secret logging checks | A4 | Open |
| HARD-43 | HTTP parser rejections become generic 500 errors | Production-parser/error-handler fixture | A4 | Open |
| HARD-44 | Running deployments retain access to migration-owner credentials | Source/configuration; compromise amplification is conditional | B5 | Open |
| HARD-45 | Docker context excludes `.env` but not other local secret/config files | Source; presence of sensitive files is conditional | A5 | Open |
| HARD-46 | Upgrade database dumps are not complete recovery checkpoints | Source and mocked installer sequencing tests | B10 | Open |

## HARD-01 — Account token accessible to JavaScript

**Current behavior and evidence.** [public/auth.js](public/auth.js) implements `getAuthToken`,
`setAuthToken`, and `clearAuthToken` using the `tabletop.token` localStorage key.
[public/landing.js](public/landing.js) stores tokens received from signup/login and resolves
them on page load. [public/http.js](public/http.js) adds them to authenticated requests as
Bearer credentials. [server/session-config.js](server/session-config.js) defaults sessions
to 30 days; [server/user-queries.js](server/user-queries.js) checks expiration and reads
current permissions during token lookup.

**Risk.** JavaScript executing on the application's origin could read and export the token,
allowing reuse outside the victim's browser until expiration or revocation. This would also
affect administrator sessions. No script-injection exploit was demonstrated in the reviewed
landing/account path. Host/browser compromise is a separate threat that HttpOnly cannot solve.

**Potential fix.** Retain opaque random tokens and server-side hashed session records, but
deliver the long-lived token only in a server-set cookie. A proposed HTTPS configuration is:

```http
Set-Cookie: __Host-ott-session=<random-token>; Path=/; HttpOnly; Secure; SameSite=Lax
```

Do not set a `Domain` attribute. Align any cookie Max-Age with server-enforced expiration;
the header above intentionally leaves persistence undecided. Stop returning the account token
in JSON and stop expecting browser JavaScript to read it. Replace `/auth/token`'s body-token
exchange with a cookie-authenticated current-session lookup, reusing existing user shaping,
expiry, revocation, and authorization behavior.

Cover signup, login, automatic session restoration, logout, logout-all, password changes,
recovery, administrator access, and multiplayer consumers together. Logout must revoke the
server session as well as expire the cookie with matching scope. Preserve access invalidation
on password/recovery changes. Decide whether existing bearer sessions are invalidated on
upgrade or exchanged once through a bounded migration path; remove legacy stored tokens and
avoid an indefinite dual-auth fallback. If two credential mechanisms briefly coexist, define
unambiguous precedence and reject conflicting identities.

**Limitations.** HttpOnly prevents direct page-script access to the cookie; injected scripts
can still perform actions through the victim's authenticated browser. Continue preventing
script injection and checking permissions on every privileged action. `sessionStorage` alone
does not solve JavaScript readability. Remembered login need not be removed to adopt cookies.

**Acceptance.** Verify cookie flags and scope, absence of account tokens from browser storage
and JSON responses, server expiry, logout/revocation, account switching across tabs, recovery,
and a documented upgrade path. Use a controlled browser check that page JavaScript cannot
read the account cookie; do not treat that as proof that XSS is harmless.

## HARD-02 — CSRF protection for cookie authentication

**Current boundary.** [public/http.js](public/http.js) explicitly attaches a Bearer token and
[server/http/auth-context.js](server/http/auth-context.js) reads it. A change to automatically
attached cookies changes this boundary. This finding does not establish a current CSRF bypass.

**Potential fix.** Design server-side protection for state-changing requests as part of
HARD-01: explicit trusted-origin validation, an appropriate session-bound CSRF token mechanism,
and `SameSite=Lax` or a deliberately selected stricter setting. Do not rely on SameSite alone.
Keep GET operations free of state-changing actions. Cover login/signup, logout, account
security, uploads, host requests, administrator actions, and room mutations, not only the
initial login route. A JavaScript-readable CSRF token must not be the authentication token.

**Acceptance.** Exercise requests from an unrelated origin and an untrusted sibling subdomain;
test missing/invalid origins and CSRF tokens, form submissions, JSON requests, and legitimate
same-origin flows. Establish policy for non-browser clients and reverse proxies. Ensure failures
cannot mutate data and do not disclose credentials.

## HARD-03 — Multiplayer authentication and reconnection

**Current behavior and evidence.** [public/client.js](public/client.js) reads the account token
and passes it to Colyseus `joinOrCreate` for table/editor rooms. [public/landing.js](public/landing.js)
does the same for lobby rooms. The table client separately keeps Colyseus reconnection tokens
in per-tab `sessionStorage`; these are distinct from the durable account token.

The 2026-10-04 trace verified that `roomAccess.reconnect` rechecks the original token hash
against current database access, while logout/kick/revocation can cancel pending reconnects.
These credentials are still readable by same-origin JavaScript; moving only the account token
to HttpOnly does not remove that separate exposure. HARD-15 records an additional current-login
consistency gap in how the browser selects a reconnect credential.

**Potential fixes to evaluate.** Authenticate matchmaking/connection setup using the HttpOnly
cookie where the installed Colyseus APIs support it, or exchange a valid cookie session for a
short-lived, narrowly scoped join ticket. Verify installed framework behavior before selecting
an approach. If tickets are used, bind them to the user/session and intended room type/code,
bound their lifetime, prevent replay, and recheck live authorization before room allocation
and admission. Do not expose the durable account token to JavaScript to make the migration easier.

Explicitly validate allowed origins for cookie-authenticated WebSocket handshakes and relevant
matchmaking requests. Reuse [server/room-access.js](server/room-access.js)'s authorization,
revalidation, and revocation behavior rather than introducing a second permissions system.
Keep pending lobby access distinct from admitted table access and administrator-only editor
access. Check how reconnection credentials remain bound to a live, authorized account session.

**Acceptance.** Cover fresh joins, pending admissions, editor access, refresh/reconnect,
expired/replayed tickets if applicable, session expiration during an open connection, logout,
password reset, changed membership/roles, and rejected cross-origin connections. Preserve
authorization before allocation and after asynchronous work. Any future multi-instance ticket
or session coordination must be explicit; do not introduce scaling infrastructure incidentally.

## HARD-04 — Account discovery through responses and timing

**Current behavior and evidence.** In [server/http/routes/auth.js](server/http/routes/auth.js),
`createAuthRouter` returns the same login failure message for missing accounts, passwordless
accounts, and incorrect passwords. However, missing/passwordless accounts skip `verifyPassword`,
while an account with a password performs scrypt. Signup also returns a specific conflict
message identifying whether the username or email is already taken.

**Risk.** Signup responses reveal registration information. Login processing differences may
also allow account discovery through repeated timing observations. Remote timing reliability
and practical impact have not been measured. Neither observation establishes password bypass.

**Potential fixes.** Consider a generic signup conflict response, balancing privacy against
usable correction of signup errors. Consider performing equivalent password-verification work
against a fixed valid dummy hash for missing/passwordless accounts. Avoid merely adding a fixed
delay; preserve bounded resource consumption and coordinate with HARD-05. Any changed UI/error
copy needs an approved example before implementation.

**Acceptance.** Test response/status consistency across missing, passwordless, and bad-password
cases; measure distributions rather than asserting exact timing equality. Check signup conflicts
and logs for unwanted identity disclosure. Confirm correct credentials still work and that
failure paths do not create sessions.

## HARD-05 — Authentication throttling keyed only by IP

**Current behavior and evidence.** [server/rate-limit.js](server/rate-limit.js)'s `makeRateLimiter`
keys consumption by namespace and request IP. [server.js](server.js) configures the authentication
bucket with capacity 20 and replenishment at 20 per minute. Auth routes use that shared limiter.

**Risk.** Distributed guessing can spread requests across addresses; shared networks can cause
legitimate users to compete for one bucket. Actual abuse capacity and denial-of-service impact
have not been load-tested. Correct proxy trust configuration is part of the IP boundary.

**Potential fix.** Layer bounded per-account/login-identifier controls over existing per-IP
limits, with appropriate global concurrency/resource limits for expensive hashing. Normalize
identifiers consistently and avoid putting raw email addresses or secrets into limiter keys
and logs. Avoid permanent account lockouts that attackers could trigger against other users.
Reuse the existing memory/Redis store boundary, and consider existing `username or email`
login aliases when defining an account bucket.

**Acceptance.** Test one account attacked from multiple addresses, alias handling, many accounts
from one address, shared-network legitimate use, spoofed forwarding headers, Redis failures,
bounded storage/expiry, and recovery after throttling. Retain safe failure behavior when the
limiter backend is unavailable.

**2026-10-07 telemetry extension.** `/csp-report` in [server.js](server.js) uses the same
`rateLimitAuth` middleware and `auth:<IP>` bucket as login/signup/recovery. It consumes budget
before parsing or ignoring a benign report. A fixed-clock memory-store fixture using the
production CSP registration block accepted 20 report requests, then rejected the next login
from that IP with 429 before any database read. This is same-IP/shared-network interference,
not a demonstrated ability to exhaust an arbitrary remote victim's bucket. Give telemetry a
separate namespace and bounded ingestion/logging budget; verify report bursts do not block
authentication while each endpoint still throttles correctly. Reverse-proxy behavior remains
deployment-dependent and was not tested against a real proxy.

## HARD-06 — Unverified email in signup and host approval

**Current behavior and evidence.** [server/auth-validation.js](server/auth-validation.js) checks
email syntax. [server/http/routes/auth.js](server/http/routes/auth.js) allows signup without
email-ownership verification. Host request/approval in [rooms.js](server/http/routes/rooms.js)
and [admin.js](server/http/routes/admin.js) does not require verified email. The administrator's
user list in [public/admin.js](public/admin.js) displays the supplied email.

**Risk.** An administrator could mistake a claimed email address for a verified identity when
approving hosting. Signup can also reserve someone else's email. This is distinct from email
recovery: the existing recovery path checks verified email; this review did not establish a
recovery bypass or takeover of an existing account.

**Potential fixes.** Decide whether to require verified email before hosting, visibly distinguish
verified/unverified addresses during approval, or explicitly use another operator-approved
identity check. Reuse the existing account-security verification mechanism if verification is
selected. Preserve self-hosted installations without SMTP through a deliberate policy rather
than accidentally blocking all host requests. Do not treat existing addresses as verified on
upgrade. Review handling of email reservations without creating an account-takeover shortcut.

**Acceptance.** Cover claimed/unverified email, successful verification, pending host requests,
administrator overrides if approved, existing accounts, and SMTP-disabled deployments. Any UI
badges, explanatory copy, or workflow changes require mock-up approval.

## HARD-07 — Host approval does not refresh an open landing page

**Current behavior and evidence.** [public/landing.js](public/landing.js)'s `showHome` uses a cached
user to show pending status or room-creation controls. `refreshRooms` polls room membership
admission, not account-level hosting permission. Administrator `setHost` updates the database
and reloads the administrator's list. The waiting user's page remains stale until it obtains a
fresh user object, such as through a page refresh and `/auth/token` resolution.

**Impact.** This is a usability defect, not an authorization bypass. The server's `POST /rooms`
handler still checks current `canOwnRooms`; revealing hidden controls cannot grant host access.

**Potential fix.** Reuse a current-session refresh operation on focus/visibility return and/or
bounded polling while host approval is pending. A push mechanism is another option if an
existing suitable channel can be reused without coupling host approval to room admission.
Refresh pending counts appropriately. Preserve the server-side check regardless of display state.

**Acceptance.** In two browser sessions, request, approve, reject, and revoke hosting. Confirm
the user's screen updates without manually reloading, background work stops when unnecessary,
and revoked access is denied server-side even with stale UI. Do not mistake a transient refresh
error for approved access. Present the resulting pending/approved layouts for approval first.

## HARD-08 — HTTPS, cookies, and self-hosted development

**Current review limit.** The walkthrough inspected source and checked-in configuration, not
live TLS termination, browser cookie behavior, or each operator's network. Proposed Secure
cookies and the `__Host-` prefix require a compatible secure deployment. An arbitrary LAN HTTP
address must not be assumed to behave like localhost.

**Potential fix.** Specify supported public HTTPS, reverse-proxy, localhost-development, and
LAN-hosting configurations before rollout. Keep production cookies Secure and origin-scoped;
do not silently drop protections based on untrusted forwarding headers. If a development-only
exception is necessary, make it explicit, narrowly bounded, and documented. Verify incoming
room/recovery links with the selected SameSite policy. Maintain the build-free self-hosted setup.

**Acceptance.** Exercise direct and proxied HTTPS, approved localhost development, plain HTTP
failure behavior, incorrect proxy configuration, external links, cookie persistence/expiry,
and logout. Document configuration changes, upgrades, rollback implications, and required
server restart/browser refresh when an implementation is ready.

## HARD-09 — Logout can leave the server session usable

**Evidence.** [public/landing.js](public/landing.js)'s `onLogout` removes the local token and
shows Quick Join before awaiting `/auth/logout`; its catch block ignores revocation failure.
The server route in [auth.js](server/http/routes/auth.js) correctly waits for database revocation
before revoking live room access, but the browser cannot claim that work succeeded if the
request never arrives or the database fails. An isolated execution of the production client
function confirmed local clearing and swallowed rejection with a simulated offline request.

**Risk.** A copied token or an already-connected session may remain usable until server
expiration or another successful revocation, despite the visible signed-out screen. This
requires a failed revocation and existing access to the credential/session; it is not a new
unauthenticated login path.

**Potential fix.** Distinguish local sign-out from confirmed server revocation. Keep local
sign-out possible when offline, but report that remote revocation was not confirmed and provide
a deliberate retry/revoke-other-sessions path. Do not restore the secret to durable JavaScript
storage just to retry. Design cookie logout consistently with HARD-01; clear stale account data,
pending redirects, and asynchronous callbacks without implying that local cleanup revokes the
database credential. Review all-device sign-out UI separately: the backend endpoint exists,
but this landing page exposes only its ordinary Log out control.

**Acceptance.** Cover successful logout, dropped requests, server/DB errors, already-expired
tokens, multiple tabs, active tables, and remembered credentials. Assert both visible status
and actual server rejection of the old credential. Approve any new error/retry UI first.

## HARD-10 — A session can mint independent recovery credentials

**Evidence.** `/auth/recovery/codes` in
[account-security.js](server/http/routes/account-security.js) calls `requireUser` and
`db.accountSecurity.replaceCodes` without checking the current password or recent independent
authentication. [account-security-queries.js](server/account-security-queries.js)'s `replaceCodes`
revalidates the session and replaces the stored code hashes. `exchange` accepts a valid code to
issue a recovery grant; `recover` uses a valid grant to replace a password without the old one.
Ordinary logout deletes sessions, not saved recovery codes. An isolated production-route
invocation with stubbed authentication/database issued ten codes with no password verification.

**Risk.** An attacker who already controls a session (for example through token theft or
same-origin script execution) can mint recovery codes, invalidate the victim's old set, and
use a code to reset the password and revoke the victim's sessions. Minted codes can outlive
ordinary logout. This amplifies session compromise; it does not demonstrate initial session
theft or an unauthenticated recovery bypass. HttpOnly alone does not stop injected scripts
from requesting codes through the victim's browser.

**Potential fix.** Require fresh proof for generating/replacing recovery credentials on
password-protected accounts, reusing current-password verification or a narrowly scoped recent
reauthentication grant. Recheck the session and expected credential after verification and before
mutation. Define an explicit first-setup/passwordless policy: requiring a nonexistent password
would break intended recovery setup. Consider verified-email proof, operator policy, and
security notifications without silently locking out installations without SMTP. Never return
new recovery codes based only on an untrusted browser assertion that reauthentication occurred.

**Acceptance.** A valid old/stolen session alone must not mint codes for a password-protected
account. Cover wrong/current passwords, stale reauthentication, concurrent credential changes,
expired/revoked sessions, passwordless first setup, code replacement, single-use consumption,
and the code-to-password-reset chain. Full PostgreSQL/browser takeover-chain testing remains
pending; the isolated handler test establishes only the missing fresh-authentication gate.

## HARD-11 — Admission policy read and membership insertion are separate

**Evidence.** `/rooms/join` in [rooms.js](server/http/routes/rooms.js) reads a room, then passes
its `requireApproval` value to [room-queries.js](server/room-queries.js)'s `joinRoom`. The latter
chooses `pending`/`admitted` from that argument and inserts it without rereading or locking the
room policy. A deterministic harness using the production handler and query factory changed
the simulated room policy from open to approval-required between those operations; the
insert still used `admitted`.

**Risk and limits.** A join overlapping an owner's policy change can create a new admitted
membership using the earlier open policy. Table access later trusts an admitted membership;
it correctly does not reapply the current policy to all existing members. Define exactly when
an in-flight join becomes admitted before calling this a violated product guarantee. The harness
used mocked storage, not live PostgreSQL concurrency or a deployed exploit. Closed-room access
is separately rejected by `roomAccess`; this finding does not establish entry into closed rooms.

**Potential fix.** Serialize admission with policy/closure changes through a database transaction
and an appropriate room-row lock, reading live policy while holding that lock. Define consistent
lock order and linearization semantics. A plain earlier read or an unchecked supplied boolean
is insufficient for a guarantee about policy at insertion. Preserve idempotent membership and
do not demote already-admitted users merely because approval is later enabled.

**Acceptance.** Add real database concurrency tests for open-to-gated, gated-to-open, closure,
and duplicate joins. Assert membership outcomes against the chosen ordering, and verify the
subsequent table/lobby authorization paths and existing admitted-member behavior.

## HARD-12 — Bound room discovery and resource creation

**Evidence.** [rooms.js](server/http/routes/rooms.js) generates eight hexadecimal room-code
characters from four random bytes. The router and its registration in [server.js](server.js)
do not attach room-join/creation-specific rate limiters or impose a per-account room quota.
Any signed-in account can try `/rooms/join`; only approved hosts/admins can create rooms.
The join response distinguishes an unknown code from an existing room and creates membership
for a valid code. Signup throttling does not bound later requests from an existing session.

**Risk.** Automated code probing, repeated pending requests from multiple accounts, or excessive
host room creation can consume database/server resources. A discovered open room admits a new
member by design; a gated room still requires approval. No brute-force/load test was run, and
upstream proxy/firewall limits were not inspected. A random code is not a substitute for the
existing membership checks.

**Potential fix.** Add bounded per-account/IP join and create throttles through the existing
limiter abstraction, with sensible pending-membership/room quotas and duplicate-request
handling. Validate code format early. Evaluate longer codes against actual exposure and UX
without invalidating existing codes or treating entropy alone as abuse protection. Avoid
breaking normal room-list refreshes and approval waiting.

**Acceptance.** Test repeated invalid codes, repeated same-room joins, many accounts, host
creation bursts, per-account isolation and quota recovery. Measure expected load before
selecting limits. Verify gated rooms remain inaccessible without admission.

## HARD-13 — Avatar bytes are not validated as an image on the server

**Evidence.** [public/landing.js](public/landing.js)'s `fileToAvatarDataURL` normally crops a
chosen image to a 512-pixel square JPEG. That browser conversion can be bypassed by a direct
API request. [shared/avatar.js](shared/avatar.js)'s `isBoundedImageDataURL` checks only string
type, a `data:image` prefix, and length below 512 KiB of characters. A direct call accepted
`data:image-not-an-image`. `/me/avatar` authenticates the account and enforces a body limit,
but does not decode or validate the declared format/dimensions before storing it.

**Risk and limits.** Malformed or unexpectedly expensive image payloads can enter synchronized
profile data. No script execution, browser crash, or resource-exhaustion exploit was demonstrated;
SVG or a data URL in an image context must not automatically be described as executable XSS.

**Potential fix.** Reuse a focused shared format/size contract and server-side image validation
or bounded decode/re-encode where appropriate. Allow only intended raster formats, verify actual
bytes and dimensions, and impose pixel/decode limits before processing. Preserve supported
legacy avatars or document a compatibility migration. Bound selected-file handling in the
browser too, without treating client checks as server enforcement.

**Acceptance.** Cover valid existing JPEG/PNG avatars, forged prefixes/MIME types, invalid
base64, unsupported formats, oversized bytes and pixel dimensions, and rendering/synchronization
of accepted avatars. Tests must verify contents, not merely reproduce the prefix implementation.

## HARD-14 — Pending-room retry and account lifecycle state

**Evidence.** In [public/landing.js](public/landing.js), `resolveApproved` and `resolveDeclined`
add a room code to the module-level `resolved` Set. `watchLobby` skips such codes, and repeated
resolution returns early. `stopPolling` closes current sockets/timers but does not reset that
Set or `lastStatus`; signup/login/logout can switch accounts without reloading the document.

**Potential impact.** Retrying a declined request for the same code on the same page can retain
old resolution state and suppress live admission handling. Account changes and late network
responses also need explicit lifecycle ownership. This is a client-state correctness concern;
server authorization still checks the active account. Browser reproduction remains pending.

**Potential fix.** Scope waiting state to the active account and request attempt, reset it on
appropriate transitions, and cancel/ignore responses and delayed navigation from older
generations. Reuse the generation-guard pattern already present in the account-security UI.

**Acceptance.** Decline then request the same room again, switch accounts on one page, log out
during an in-flight lobby join, and receive delayed admission after navigation. Confirm the
correct account/request is shown and redirected once, and old sockets/timers are disposed.

## HARD-15 — Reconnect can retain the previous account identity

**Evidence.** [public/client.js](public/client.js)'s connection bootstrap reads the current
account token, but first tries `client.reconnect(saved)` using `sessionStorage['tt_token:' +
code]`. Successful reconnection skips the fresh join that would use that current token.
[server/room-access.js](server/room-access.js)'s `reconnect` correctly revalidates the original
connection's stored token hash; it is not given the browser's newly selected account.
[public/landing.js](public/landing.js)'s logout clears the account token but does not clear
these per-room reconnection tokens. Deliberate table departure does clear its room token.

**Preconditions and impact.** A previous connection must still have a valid reconnect
reservation (normally 30 seconds), its original server session must remain authorized, and
the same tab must retain that room's reconnect token. An unexpected departure followed by
an account change, or failed logout revocation (HARD-09), can therefore resume the old account's
seat and private hand despite a different or absent current account token. Successful server
logout revocation blocks this path. This is conditional identity confusion, not a demonstrated
ability to forge credentials or bypass a revoked server session.

**Verification.** An isolated evaluation of the actual client bootstrap, with synthetic browser
and Colyseus stubs, selected account A's reconnect with both account B's current token and no
current token. A separate production `createRoomAccess` test with a stubbed database confirmed
that reconnect rechecks A's original token. A complete browser/framework/account-switch chain
has not been reproduced.

**Potential fix.** Clear all table reconnect credentials on account/session changes and logout;
scope reusable reconnect state to the current authenticated session. At reconnect, verify the
resumed identity against the current session using a server-enforced binding compatible with
HARD-03, rather than trusting a client-provided account ID. Preserve genuine same-account
refreshes, hand ownership and revocation. Do not copy another durable bearer token into storage
just to tag the cache.

**Acceptance.** Exercise A-to-B switching, no current login, failed/successful logout, token
expiration, another tab changing the account, and a normal refresh inside/outside the reconnect
window. Neither private state nor privileged actions may resume under an unexpected identity.

## HARD-16 — Table-loading gate can wait indefinitely

**Evidence.** [public/client.js](public/client.js)'s `finishTableLoading` loops until the local
player exists, mesh count matches received piece count, visual assets settle, and hydration stays
unchanged for 300 ms. [public/rendering/core.js](public/rendering/core.js)'s `waitForVisualAssets`
also waits without an application deadline. The caller uses `void finishTableLoading()` without
a local rejection handler; global error handling can show a toast but does not resolve this gate.
Ordinary asset failures that call the loading manager's `itemEnd` do settle; this finding must not
be interpreted as claiming every missing texture hangs the page.

**Potential impact.** A stuck load, a mesh-creation error leaving a count mismatch, or sustained
structural hydration changes can leave the loading overlay indefinitely. This is an observed
reliability/availability weakness; no malicious-client denial-of-service exploit was demonstrated.

**Potential fix.** Bound initial loading with cancellation on room departure and a recoverable
failure state. Track initial hydration separately from later room activity. Catch loading-gate
failures explicitly and provide accessible retry/return controls. Preserve authorization and
private-state boundaries; a timeout must not manufacture a successful join. Present concrete
UI examples for approval before implementing controls.

**Acceptance.** Simulate a never-settling asset, rejected mesh creation, disconnect during load,
an empty/all-hidden table, spectator entry and continuous piece additions/removals. Verify the
normal case still applies the complete table appearance before revealing it and every failure
offers a usable exit. Browser reproduction and UI design remain pending.

## HARD-17 — Group replacement can strand held pieces

**Evidence.** In [server/game/handlers/movement.js](server/game/handlers/movement.js),
`grabGroup` claims eligible pieces and replaces `room.groups[sessionId]` without releasing
the previous group's claims. `releaseGroup` subsequently releases only the replacement map.
Sending group A, then group B, then release leaves A's pieces owned by the original connection;
another participant cannot grab them. Repeating a grab of the same already-owned group can
also replace its tracking map with an empty map, since owned pieces are skipped.

The reviewed movement/physics path has no elapsed-time expiry for ordinary held-piece ownership.
[driveHeldPieces](server/game/physics-update.js) retains a valid target while ownership remains.
[stopPlayerInteraction](server/game/interaction-cleanup.js) does clear all of the connection's
claims on departure or participation restriction; a valid individual release can also recover
a stranded piece. This is not an irreversible inventory loss.

**Impact and limits.** An admitted playing client can disrupt shared interaction by leaving
pieces unavailable to other participants. This does not bypass another holder's ownership,
hidden-piece visibility, or spectator/time-out restrictions. The isolated reproduction called
the production registered handlers with synthetic state; a normal-browser sequence producing
overlapping groups and a live multiplayer demonstration remain unverified.

**Potential fix.** Define one explicit active grab lifecycle per connection, allowing the
intended multi-piece group. Reject or safely reconcile a replacement grab before replacing
its tracking state. Consider idempotent gesture identifiers and bounded stale-grab recovery,
with keepalive semantics that allow a person to hold a piece still. Cleanup must release all
claims from that gesture without throwing, accidentally absorbing inventory or disturbing
other connections. Reuse the existing interaction-cleanup behavior where appropriate.

**Acceptance.** Repeat the same group grab; replace overlapping/disjoint groups; mix single
and group grabs; omit release; and disconnect or change participation mid-grab. Verify other
participants regain pieces appropriately and ordinary stationary holds/group drags still work.

## HARD-18 — Pointer cancellation is treated as a completed action

**Evidence.** [public/table/controls.js](public/table/controls.js)'s `logical` sets
`cancelled:true` for `pointercancel`, and `attachControls` routes that event through the
release intent. [input-router.js](public/table/input-router.js)'s `endGesture` forwards the
event to `pieces.release(e)`, but [piece-drag.js](public/table/piece-drag.js)'s `release`
accepts no event and does not inspect cancellation. It executes the normal click action or
sends the stored throw velocity. Isolated production-router/controller checks using the
existing test fixture reproduced a cancelled card tap sending `flip` and a cancelled drag
sending a nonzero throw vector.

**Spatial-tool follow-up (2026-10-07).** `endGesture` also passes cancellation to
[overlays.js](public/table/overlays.js)'s `finishMeasure`, which does not inspect `cancelled`.
Using the existing test fixture with the production `createOverlays` controller, a cancelled
ruler drag from (0,0) to (3,4) emitted `overlayAdd`. This extends the same finding to unintended
shared annotations. `finishMove` also ignores cancellation, but rollback of already broadcast
movement needs a deliberate policy and was not reproduced here. In contrast, map fog's
`finish` explicitly cancels the stroke when the event is cancelled.

**Impact and limits.** An interrupted gesture can cause an unintended game-state change,
including a card flip or throw. This is input correctness and potentially accidental disclosure
through an otherwise authorized action, not a demonstrated authorization bypass. Actual
browser/OS cancellation scenarios and physical touch-device behavior remain untested.

**Potential fix.** Give cancellation an explicit path: suppress click/deferred-click actions,
release an owned piece/group with zero throw velocity, and clear gesture state and capture.
Preserve the existing delayed-deal behavior that releases a newly delivered piece after its
gesture has ended. Define cancellation for selection and other tools separately rather than
assuming every controller shares the same completion semantics.

**Acceptance.** Cancel before the drag threshold, during single/group drags, during two-finger
transforms and while a dealt item is pending. Assert no click/flip/take action or throw occurs,
ownership and camera controls recover, and normal pointer-up behavior remains intact. Include
browser pointer-capture loss and real touch interruption checks.
Include ruler/shape creation and overlay movement: cancel creation without sending `overlayAdd`,
clear remote previews, and define whether already published movement is retained or restored.

## HARD-19 — “Picked” can reveal the entire hand

**Evidence.** In [public/table/hand.js](public/table/hand.js), `bindShowControls` defines
`showHids` as `selOnly && selected.size ? [...selected] : 'all'`. Enabling Picked clears the
selection. Choosing a recipient while Picked is active and zero cards are selected therefore
sends `showStart { to: [recipient], hids: 'all' }`. The selected-card pointer handler changes
only the local selection/classes; it does not update an already-active reveal. An isolated
check of the production `createHand` controller with the existing DOM fixture reproduced both
the all-hand request and the absence of a revised request after selecting one card.

[server/game/handlers/room-features.js](server/game/handlers/room-features.js)'s `showStart`
correctly interprets `hids:'all'` as the sender's entire hand and delivers those faces to the
requested audience. It cannot infer that the sender's UI intended a narrower selection.

**Impact and limits.** Ordinary UI actions can disclose more of a private hand than intended.
The sender must choose an audience; this does not let another account retrieve an arbitrary
hand. The recipient cannot be made to forget faces already received by a later `showStop`.
The client-message sequence is reproduced; a full two-browser demonstration remains pending.

**Potential fix.** Represent “all” and “picked, currently empty” as distinct states. An empty
picked scope must reveal nothing and stop any previous reveal; merely skipping a new request
would leave the old disclosure active. Update or stop an active reveal whenever the selected
cards change, and keep status text consistent with the sent scope. Reconcile hand changes and
rearrange/select-mode transitions. Reuse the existing audience protocol and server-owned hand
lookup; any UI changes still require an approved concrete example.

**Acceptance.** Choose Picked before selecting cards, enable it while showing all, deselect the
last card, change selection during a reveal, play a shown card, and switch between rearranging
and picking. Verify the actual recipient payloads, not just labels, contain only intended cards.

## HARD-20 — Failed transfers and replacement can lose prior state

**Evidence.** [server/game/handlers/cards.js](server/game/handlers/cards.js)'s `dealToTable`
and `dealDrag` call `takeTopCard` before constructing the destination. `inspectPlace` removes
the pending inspection before placing it into the hand or table. The common
[safe-message.js](server/game/safe-message.js) boundary catches and reports exceptions but does
not roll back mutations. With an injected `spawnCardFlat` exception, the production
`dealToTable` and `inspectPlace` handlers both reported an error while leaving the card absent
from the source deck, table and pending inspection. Only synthetic state was used.

**Impact and limits.** Unexpected destination failures can lose live inventory and that state
could subsequently be saved. Capacity failures are already handled before consumption and
passed existing tests; this finding concerns exceptions after those checks, not the normal
full-table case. No attacker-controlled input or ordinary deployment failure was demonstrated
to trigger the injected exception. Other early-mutation transfers, including split/combine and
hand delivery failures, need regression coverage before claiming general atomicity.

**Potential fix.** Retain recoverable source inventory until destination creation commits,
and clean up partial destinations on failure. Separate inventory commit from notifications so
socket errors neither consume twice nor reverse a completed transfer. Reuse or carefully extend
the transaction/rollback pattern already implemented in
[deck-browsing.js](server/game/deck-browsing.js)'s `action`, with explicit variants for ordinary
draws and inspections; do not merely wrap a partially mutating operation in another catch.

**2026-10-05 library-loading extension.** The same early-mutation pattern appears at larger
scope. [server.js](server.js)'s `swapBoard` removes the old board before spawning its replacement.
[scene-persistence.js](server/game/scene-persistence.js)'s `applyScene` checks some scene
properties, then calls `clearTable` before building the replacement. `clearGameTable` clears
pieces, private hands and pending inventory, invalidates `savedScene`, and schedules a save.
An injected new-piece failure in the production scene loader left the old pieces/hand cleared,
the checkpoint null and a save scheduled. An extracted production `swapBoard` method likewise
lost the old board when replacement spawn threw. These tests used synthetic room state and
stubbed construction; they did not write to a database or demonstrate an attacker-triggerable
production exception. Starter setup also clears first in source; its failure recovery was not
separately fault-injected.

**Replacement safeguard to evaluate.** Fully validate and prepare a replacement before swapping
live state, or retain a complete recoverable snapshot with controlled save ordering until the
replacement commits. Preserve private hands/inspection inventory and clean up partially built
physics resources on failure. A browser confirmation authorizes the replacement but does not
make partial construction failure safe.

**Acceptance.** Inject failures before/after destination creation and during notification.
Count cards across deck, hand, pending inspection and table before and after each operation;
verify unchanged metadata/order on rollback, no orphan bodies, no duplicate retry, and durable
save/reload consistency. Include final-card draws and full-capacity recovery.
For replacements, inject failure at each build stage and verify the previous board/table,
private hands, checkpoint and durable save remain recoverable. Keep scene replacement's
intentional clearing behavior on success distinct from a failed attempt.

## HARD-21 — Pending inspection survives reconnect without its UI

**Evidence.** [server.js](server.js)'s `onLeave` calls `stopPlayerInteraction` with
`recoverInspection:false` while waiting for reconnection and returns early on successful
reconnect. A normal unrestricted player's pending inspection therefore remains server-side.
`onReconnect` revalidates access, syncs visibility and sends `whoami`, but does not resend the
private inspection. The client [inspection controller](public/table/inspection.js)'s `bindRoom`
listens for `inspectCard` but does not request pending inspection state, unlike hand hydration's
explicit `handSync`. [cards.js](server/game/handlers/cards.js)'s `drawInspect` rejects another
inspection while one already exists for that session.

**Potential impact and limits.** Refreshing during a private inspection and reconnecting within
the reservation window can leave a card retained privately with no restored controls to place
or return it, and block further inspections. A full departure/recovery can return the card;
this is not established permanent loss or a privacy leak. This finding is source-confirmed;
an actual browser refresh/framework-delivery reproduction remains pending.

**Potential fix.** Add a private, idempotent inspection hydration request after listeners are
installed, or explicitly return/recover the pending card during reconnection. Recheck live
authorization/visibility before delivery. Preserve capacity handling and metadata, and ensure
duplicate requests cannot consume another card or create two inventories. Reuse the existing
inspection payload/recovery helpers rather than publishing inspection state in the schema.

**Acceptance.** Refresh during a peek and reconnect inside/outside the reservation window;
repeat sync, change role/participation while disconnected, remove the source deck, and fill the
table. The card must have exactly one recoverable owner/location and only its authorized
recipient may receive its face.

## HARD-22 — “Private” library records still use publicly retrievable media

**Evidence.** [game/library.js](server/game/library.js) and
[library-queries.js](server/library-queries.js) filter private records from non-admin catalog
responses. [handlers/library.js](server/game/handlers/library.js) separately rejects loading
private records for non-admins. However, [server.js](server.js) mounts `/assets` without an
authentication middleware, and [asset-files.js](server/http/routes/asset-files.js) serves
allowlisted generated raster/GLB filenames without checking a session, record publication or
room membership. Original files receive one-year immutable caching. Filenames are generated
from nine random bytes; this review did not establish a practical guessing attack.

The existing production-router test fetched synthetic media with no credentials and received
200, while forbidden metadata/script paths returned 404. It did not use a real private catalog
record; the policy gap is established by the serving path having no record/access lookup.

**Impact and limits.** Someone who obtains a media URL can fetch its bytes without library
permission. Unpublishing the catalog entry alone does not revoke that URL or already delivered
copies. This matters if an author interprets “private” as confidential image/model storage.
It is an explicit current media-serving design, not a demonstrated bypass of the catalog
query or a way to read live deck order, hands or server-side JSON. Loading a private asset into
shared table state can intentionally expose its appearance/URL to that table's recipients.

**Potential fix or accepted policy.** Decide whether privacy promises only catalog visibility
or media confidentiality. For catalog-only privacy, document the distinction in the authoring
flow with an approved UI example. If confidentiality is required, design authorized or
appropriately scoped expiring media delivery, including thumbnail/derivative routes and cache
policy, while preserving legitimate table recipients and renderer compatibility. Retain the
existing extension/path allowlist, safe MIME types and nosniff/sandbox headers. No system can
revoke bytes a recipient already downloaded; do not promise retroactive secrecy.

**Acceptance.** Use separate signed-out, admin, admitted-member and unrelated-account clients.
Test original and derivative URLs before/after publication changes, hidden/shared placement,
URL sharing, cache reuse and revoked membership. Verify catalog filtering and live game-state
privacy independently. Derivative authorization and full browser/cache behavior remain pending.

## HARD-23 — Direct upload bodies are parsed before authorization

**Evidence.** [uploads.js](server/http/routes/uploads.js)'s `/upload` and `/upload-model`
middleware order is rate limiter, `express.raw` with a 16 MiB limit, then `requireAdmin`.
Thus an unauthenticated request admitted by the limiter can consume body-parsing/buffering
resources before rejection. The upload bucket in [server.js](server.js) permits a burst of
300 requests and refills at three per second; [makeRateLimiter](server/rate-limit.js) keys it
by IP. This limits request count, not concurrent bytes. The package router already authenticates
before its own body parsing/staging and serializes transfers within the router instance.

**Reproduction and limits.** An isolated invocation of the production upload middleware with
a 64 KiB synthetic request observed the complete Buffer inside the injected rejecting auth
function, then returned 401 without calling storage. The limiter was a pass-through fixture;
this verifies ordering, not a limiter bypass, remote denial of service, or measured peak memory.
The 16 MiB per-request cap and existing rate limit still apply. Reverse-proxy/body/time limits
and distributed/concurrent behavior were not tested.

**Potential fix.** Keep the inexpensive ingress limiter first, authenticate before parsing
large bodies, and bound aggregate concurrent uploads and bytes. Set appropriate upload timeouts
and deployment body limits. Preserve a live authorization check before storing content if
authentication is moved earlier, because privileges can change during a long upload. Reuse
the established auth and error-boundary helpers; do not replace the limiter with auth alone.

**Acceptance.** Exercise missing/invalid/non-admin credentials with slow, chunked, compressed,
near-limit and over-limit bodies. Verify rejection before application buffering/storage,
bounded authorized concurrency, aborted-request cleanup, and revocation during upload.
Measure resource use in a controlled deployment before claiming denial-of-service resistance.

## HARD-24 — File signatures are not complete media validation

**Evidence.** [imageExtension](server/assets/upload-validation.js) recognizes a small prefix
and minimum length. The direct upload router stores accepted bytes without decoding the
image or applying explicit image dimension/frame budgets. Browser `uploadImage` resizing in
[graphics.js](public/rendering/graphics.js) is useful but can be bypassed by an authenticated
caller. By contrast, [packages.js](server/assets/packages.js)'s `imageInfo` checks dimensions,
single-frame status and pixel limits with Sharp and decodes the image before accepting it,
while preserving its original bytes.

`validateGlb` checks the GLB header, first JSON chunk and external `buffers`/`images` URIs,
but does not perform complete glTF semantic validation, decode embedded images, or enforce
explicit model geometry/node/embedded-texture budgets. Package GLBs reuse that validator;
package raster-image pixel accounting does not inspect images embedded inside a GLB.

**Reproduction and limits.** A 12-byte PNG-prefix fixture was accepted by the direct production
upload middleware with injected administrator auth/storage, but rejected by package inspection.
A small GLB containing an invalid embedded PNG data URI passed `validateGlb`. No large media,
GPU workload, renderer exploit, script execution or memory exhaustion was attempted. These
tests establish incomplete validation, not successful denial of service. Uploads/imports are
admin-only, and existing byte caps, safe serving types, external-URI rejection and downstream
decoder limits remain protections. A trusted administrator can also encounter damaged or
expensive third-party assets accidentally.

**Potential fix.** Extract/reuse the package raster inspection rules for direct uploads with
explicit per-kind byte, pixel and frame budgets. Validate GLB structure and supported content,
bound model complexity and inspect embedded image resources. Preserve authored originals and
materials; validation need not destructively re-encode files. Bound validation concurrency
and preserve the external-reference rejection. Establish budgets against supported assets and
devices before selecting constants; byte limits alone do not establish rendering cost.

**Acceptance.** Compare direct and package ingestion of truncated images, misleading signatures,
excessive dimensions/frames, malformed GLB schemas/chunks, bad embedded images and complex
models. Reject before persistence where practical and verify originals/materials still round-trip.
Use controlled CPU/memory/GPU measurements for resource claims; do not infer safety from headers.

## HARD-25 — Deck forms and drafts are cleared before save confirmation

**Evidence.** [editor-panel.js](public/editor/editor-panel.js)'s `saveText`, `saveImg` and
`saveTiles` send the draft messages, then clear their forms and close the dialog without waiting
for persistence acknowledgment. `sendDeck`/`sendTileSet` send `deckBegin`, batches of
`deckAppend`, and `deckFinish`. In [handlers/library.js](server/game/handlers/library.js),
`deckFinish` deletes the draft and optionally spawns the deck before awaiting insert/update.
The error boundary reports `assetError` on database failure, but does not restore the draft.

**Reproduction and limits.** An isolated production `saveText` callback cleared/closed after
sending without receiving any reply. With an injected `insertDeck` failure in the production
handler, the draft was absent, one requested deck was already spawned, and `assetError` was
reported. No database was used. This can lose unsaved typed authoring state or leave a piece
on the table without its intended library entry. Source images may still exist locally or as
uploaded files; an existing edited record is not proven lost. Normal full-capacity checks retain
the server draft and are separately covered by existing tests. Full browser recovery and other
asset forms are not exhaustively verified.

**Potential fix.** Give save operations an explicit correlated success/failure response. Retain
the client form and server draft until persistence succeeds; allow correction/retry on failure.
For Save-and-Spawn, define commit order and report save and spawn outcomes distinctly. Prevent
duplicate inserts/spawns on retries or lost acknowledgments, and preserve live access/capacity
checks. Reuse the request/acknowledgment pattern already present for collection saves or the
HTTP package controller where compatible. Present and approve any revised form/error UI before
implementing it. This complements HARD-20's gameplay rollback concern.

**Acceptance.** Inject database rejection, disconnect and lost/duplicate acknowledgments during
text/image/tile saves, edits and Save-and-Spawn. Keep typed content, selected uploads and edit
identity recoverable; retry must not duplicate library records or physical pieces. Verify
capacity and permission changes while saving and distinguish saved-but-not-spawned outcomes.

## HARD-26 — Background saves do not capture current gameplay

**Evidence.** [room-state.js](server/game/handlers/room-state.js)'s `scheduleRoomSave` schedules
one settings write after 800 ms and coalesces requests while that timer is pending. Its
`saveRoomStateNow` clones current room settings together with `room.savedScene`; it does not
call `serializeGame`. The manual `stateSave` handler and `saveFinalRoomState` capture current
gameplay. Scene application also sets a snapshot, and reset invalidates it. Reviewed ordinary
movement/card activity has no periodic full-game snapshot timer in this lifecycle.

**Reproduction and limits.** Starting from a captured scene, a synthetic room's card position
was changed from 4 to 12 and its room note changed. The production save function wrote the new
note but retained position 4 in the scene. This verifies the payload boundary; no server was
killed and no production database was used. A successful final disposal normally captures
the latest game, so this is primarily a forced-termination/crash-window durability concern,
not proof that ordinary leaving loses progress or an authorization vulnerability.

**Potential fix or accepted policy.** Define how much gameplay may be lost on abrupt process
termination. If ongoing crash recovery is required, periodically capture a coherent full-game
snapshot using existing serializers and the ordered writer, with bounded frequency/work and
dirty tracking. Keep intentional manual checkpoints separate if they are meant to remain
fixed; the current single snapshot is also replaced by final disposal. If retaining the
current policy, clearly describe what Save Table and background saving guarantee. Any status
or wording UI change requires an approved example.

**Acceptance.** Move/deal/reorder/edit after a checkpoint, allow the intended save interval,
then forcibly terminate a disposable test instance. Reopen and verify the documented loss
window and exact private inventory. Test settings-only changes separately; a successful
settings write must not be presented as proof that current gameplay is durable.

## HARD-27 — Final-save failure or size rejection can discard the latest progress

**Evidence.** `saveFinalRoomState` in [room-state.js](server/game/handlers/room-state.js) captures
the current game but only replaces `savedScene` when `JSON.stringify(snapshot).length` is at
most `SCENE_MAX_BYTES` (2,000,000 in [server.js](server.js)). Despite the constant name, this is
a JavaScript string-length check, not a UTF-8 byte measurement. If exceeded, it writes the
previous snapshot without reporting the skipped capture. Manual Save instead reports a size
error. `TableRoom.onDispose` wraps the final write in `safeRoomTask` with `notify:false`; after
a rejection is logged, disposal removes the room from `LIVE_ROOMS` and `ROOM_WRITERS`.
No retry or durable recovery copy is created by this path. Background write failures are also
logged without a retry timer; another later save can succeed because the queue is not poisoned.

**Reproduction and limits.** A synthetic snapshot just beyond the production threshold caused
the final-save helper to resolve after writing the old scene. An extracted production
`onDispose` method with an injected failing writer completed after one logged failure and
removed its room from both registries. A separately injected background failure logged once
and scheduled no retry. These are isolated function checks, not real PostgreSQL, container
shutdown, disk-full or network-partition tests. The database error is not hidden from logs,
and manual Save does not falsely acknowledge success. The concern is recovery after the last
live state is disposed, not merely the absence of a message to departed clients.

**Potential fix.** Detect oversized/unsavable states while users are still present and expose
an accurate dirty/save-error status. Define bounded retry/backoff and shutdown handling; retain
a protected durable recovery copy or another explicit recovery mechanism when the primary
write cannot complete. Preserve the last known good save, but distinguish it from a fresh
final save. Recovery storage contains private hands/deck order and needs the same access and
retention protections as the primary snapshot. Do not block shutdown indefinitely or release
writer ownership while a retry could race a new room writer.

**Acceptance.** Exercise database rejection, zero-row updates, prolonged writes, unknown commit
outcomes, size overflow, reconnect/reopen during recovery and exhausted shutdown grace periods.
Verify recoverability of the latest inventory, visible/admin-observable save failure, bounded
resource use and write ordering. Test empty and hands-only rooms as well as populated tables.

## HARD-28 — Two saved configuration copies disagree during cold restoration

**Evidence.** [saveRoomStateNow](server/game/handlers/room-state.js) stores current table
dimensions/shape/rim and scale alongside `savedScene`, which contains its own table/scale
snapshot. Later `table` and `scaleSet` handlers change live settings and schedule a write
without refreshing those fields in the saved scene. [server.js](server.js)'s `onCreate` first
loads the top-level settings, then calls [applyScene](server/game/scene-persistence.js), which
replaces them with the older scene values.

**Reproduction and limits.** A synthetic checkpoint recorded table width 10 and scale 2. After
live settings changed to width 14 and scale 3, the production save payload contained those
new top-level values and the older nested ones. Applying the saved scene to a restoration
fixture reverted width to 10 and applied scale 2. This reproduces the precedence conflict
without a live database or process restart. A successful fresh manual/final capture normally
realigns the copies; the issue is exposed by reopening from an older scene after newer settings
were persisted, including abrupt termination or skipped final capture.

**Potential fix.** Establish one authoritative configuration representation for a durable
game save, or update both copies coherently before writing. Preserve the intentional behavior
of explicitly loading a portable scene, which may replace the table and scale, while deciding
the cold-room restoration policy. Apply any versioning/backward-compatibility changes through
the existing serializers/restore path rather than adding a competing persistence subsystem.

**Acceptance.** Save a scene, change each duplicated table/scale field, persist settings, then
reopen without a fresh full snapshot. Verify the intended values and associated physics/grid
geometry. Cover old snapshots, null scenes, explicit scene loads, final-save failure and reset.

## HARD-29 — Notes lack reliable acceptance and limit feedback

**Evidence.** [notebook.js](public/table/notebook.js) sends private notebook text after a
400 ms input debounce. [scoreboard.js](public/table/scoreboard.js) does the same for shared
room notes, also flushing on blur. The corresponding textareas in
[table.html](public/table.html) have no matching `maxlength` or limit feedback. The handlers in
[room-state.js](server/game/handlers/room-state.js) reject private text over 4,000 characters
and shared text over 8,000 without acknowledgment/error. Private notebook input has no blur
flush or controller-level departure flush. A still-visible draft is not proof of acceptance.

**Reproduction and limits.** Production handlers retained previous text and sent no response
for synthetic updates of 4,001 and 8,001 characters. An isolated notebook controller sent
nothing until its injected debounce callback fired. Actual navigation before that callback
was not browser-tested. Shared notes do flush on blur; do not attribute the private notebook's
missing blur handler to both controls. Multi-editor overwrite behavior remains untested.

**Related retention wording.** The private-notes UI says they are cleared when the user leaves,
but [server.js](server.js) deletes only session-keyed notes on departure; authenticated notes
are account-keyed and survive until that live room is disposed. This is a source-confirmed
retention-description mismatch, not demonstrated disclosure to another account. Personal
notebooks (both account-keyed and session-keyed) are not made durable by Save Table; shared room
notes are saved separately.

**Potential fix.** Align client limits with server validation, report acceptance/rejection,
and preserve rejected/unsent drafts. Define a flush/recovery policy for pending private edits
and state the actual room-lifetime retention rule. Avoid silently adding localStorage or
database retention for private notes; persistence/privacy choices need an explicit design.
Consider revisions if multiple editors/tabs must avoid overwriting each other. Any changed
status/limit/retention UI requires a concrete approved example.

**Acceptance.** Test exact limits and one character beyond, paste, fast navigation, refresh,
network failure and multiple tabs. Keep rejected text recoverable and distinguish sent,
accepted-in-memory and durable state. Verify that another account cannot synchronize the
notebook, and that leave/rejoin/room-disposal behavior matches the displayed retention policy.

## HARD-30 — Duplicate names can misattribute chat messages

**Evidence.** The chat handler in [room-features.js](server/game/handlers/room-features.js)
derives `from` from the server-held player display name, but sends only `from`, `text` and `ts`.
[server.js](server.js)'s `setName` permits changing that display name without a uniqueness
check. [chat.js](public/table/chat.js) decides whether a message is the viewer's by comparing
that name with `myName`; [chatRow](public/ui/rows.js) then renders the sender as `you`.

**Reproduction and limits.** A synthetic chat from a different authenticated account named
Alice was rendered as `you` for a viewer whose displayed name was Alice. The production handler
and row builder were used with minimal DOM/room fixtures. A caller cannot directly supply
an arbitrary `from` field in the chat payload, but can select a matching display name through
the separate name handler. This enables misleading attribution, not account takeover, role
elevation or HTML/script injection. Full browser impersonation was not exercised.

**Potential fix.** Include a server-authenticated sender identifier and compare identifiers
for self styling. Choose a stable account or appropriately scoped opaque identity that also
works for history replay/reconnects; do not disclose session credentials. Preserve display
names while visibly distinguishing collisions where needed. Any label/badge change needs an
approved UI example; name uniqueness alone should not substitute for identity-based attribution.

**Acceptance.** Use two accounts with identical names, rename during a conversation, reconnect
and replay history, and open two tabs of one account. Only the intended sender identity should
render as `you`; display-name changes must not rewrite historical authorship semantics.

## HARD-31 — Chat limits history length on the server, not traffic or live DOM growth

**Evidence.** [room-features.js](server/game/handlers/room-features.js) bounds incoming text,
normalizes it to at most 400 characters and retains 80 entries, but broadcasts every accepted
message without a chat-specific rate budget. [chat.js](public/table/chat.js) appends every
live message without trimming rows; the 80-entry server cap only bounds a history replay.
The installed Colyseus Room defaults `maxMessagesPerSecond` to `Infinity`, and the reviewed
TableRoom setup does not override it. Spectator/time-out policy intentionally still permits
communication; a gameplay time-out is not a chat mute.

**Reproduction and limits.** A bounded run of 100 sequential messages through the production
handler emitted 100 broadcasts and retained 80 server entries. Feeding them to the production
chat controller left 100 DOM rows. This establishes the uncapped paths, not a measured
denial-of-service threshold. Room admission and message-size limits still apply; this concerns
an admitted participant or a long-running busy room, not anonymous Internet access.

**Potential fix.** Add a chat-specific server-side per-account/connection and room budget,
with clear throttling feedback, and bound or virtualize client history. Reuse the existing
limiter infrastructure where compatible, keeping chat separate from high-frequency physics
messages. If moderation needs muting, define it separately from gameplay time-outs rather
than changing their communication policy incidentally.

**Acceptance.** Exercise bursts, sustained multi-client traffic, multiple tabs and reconnects;
verify bounded broadcast work, client rows/memory and fair access for other speakers. Run
controlled browser/server load tests before assigning an availability severity. Preserve plain
text rendering, history ordering and honest delivery/throttle feedback.

**Spatial-tool follow-up (2026-10-07).** This resource-budget concern also applies to
`overlayDrag` in [overlay handlers](server/game/handlers/overlays.js). The normal browser
[overlay controller](public/table/overlays.js) spaces drag previews by roughly 55 ms, but that
client-side throttle is not a server limit. A bounded production-handler fixture sent 100
valid requests and received 100 broadcast calls. Persistent overlay caps (200 per room, 40 per
session) do not bound preview traffic. Add a separate server preview budget/coalescing policy
that preserves end/cancel cleanup, and test multi-client fairness. This is an admitted active
participant path, not a spectator bypass or measured denial of service. Reuse HARD-31's
availability review rather than treating each message family as a separate vulnerability.

## HARD-32 — Whiteboard stroke eviction and visible pixels diverge

**Evidence.** The server and [whiteboard.js](public/table/whiteboard.js) both retain at most
`WHITEBOARD_LIMITS.maxStrokes` (2,000 in [overlays.js](shared/overlays.js)). The client's
`rememberStroke` shifts the oldest entry on overflow, while `pushStroke` only paints the new
stroke. It does not clear/repaint the canvas to remove evicted ink. History replay clears and
paints only retained strokes, so a current viewer and a rejoining viewer can see different
content. A later redraw can also remove apparently retained work.

**Reproduction and limits.** An instrumented canvas fixture received 2,001 production stroke
callbacks with no intervening canvas clear. Replaying the capped history cleared the canvas
and painted 2,000 strokes. This verifies drawing-call behavior, not pixel-level browser output;
identical/overlapping strokes can visually mask it. It is a bounded-history consistency issue,
not demonstrated private-content disclosure or unbounded whiteboard memory.

**Potential fix.** Decide whether overflow should evict, refuse new strokes or compact old
artwork into a bounded base layer. Keep the server replay and every live canvas consistent
under that policy. If retaining eviction, redraw after eviction with bounded work; preserve
eraser semantics and avoid reintroducing cleared ink. Any capacity warning requires an approved
UI example. Disabling the board already clears its history and should remain explicit.

**Acceptance.** Use visually distinct strokes through the exact limit and overflow, including
erasers. Compare live, refreshed and late-joining clients before/after theme redraw, disable,
clear and reconnect. Verify the selected retention policy and frame-time/memory bounds.

## HARD-33 — Member mutations can authorize against stale target privileges

**Evidence.** [members.js](server/game/handlers/members.js)'s `kick` and `setRole` handlers
read target membership, await a separate user/admin lookup, then recheck the actor's live
authority against the same previously read `membership.role`. The target's current membership
is not reloaded or locked. [database.js](server/database.js)'s `kickMember` and `setMemberRole`
then delete/update by room and user ID alone; the SQL does not condition the write on target
role or actor authority. This differs from the row-locking transactions used for time-outs in
[participation-queries.js](server/participation-queries.js).

**Reproduction.** Two isolated runs invoked the production registered handlers as a GM,
returned a copied target membership with role `player`, paused `findUserById`, then changed the
synthetic durable target to `gm` before releasing the lookup. `kick` still called deletion of
that GM; `setRole` still changed that GM to helper. An owner promotion during the pending read
is the corresponding real application interleaving. GMs normally cannot manage other GMs.

**Impact and limits.** An already privileged GM's in-flight action can override a target's
new protection, crossing the intended owner-only boundary. This does not give an ordinary
player a GM role. Existing checks correctly stop many actor demotion/revocation races; those
tests do not establish freshness of the target role. The reproduced writes used database
doubles, not a live PostgreSQL race or browser exploit. Changes to site-admin status and
concurrent publication order are related cases to test, not additional reproduced outcomes.

**Potential fix.** Move durable authorization and mutation into one transaction that locks
and checks current actor/target user and membership rows, using a consistent lock order and
the existing participation-query approach where compatible. Preserve live revocation checks,
self/owner/admin protection and post-commit propagation to every connection. Apply equivalent
atomic rules to admission where appropriate. A second ordinary read or a process-local queue
alone cannot protect against every concurrent database writer. Report whether a write actually
changed a row; reconcile committed state even if later notification fails.

**Acceptance.** Add deterministic regression cases and real database interleavings for target
promotion, actor demotion/revocation, target admin changes, membership deletion/recreation and
competing role writes. Include all tabs and pending reconnects. Require a valid serialized
outcome under current durable permissions and agreement between committed and published state.

## HARD-34 — Visual map fog is not a confidentiality boundary

**Evidence and intended behavior.** [map-fog.js](public/table/map-fog.js) draws a mask/volume
over the browser's board mesh. The existing [architecture](docs/ARCHITECTURE.md#manual-map-fog)
explicitly describes this as visual covering over downloaded artwork. The server's
[piece visibility service](server/game/piece-visibility.js) filters explicit `piece.hidden`
state, not fog-mask coverage. A covered board still delivers its props/artwork reference;
ordinary pieces under the covering still arrive in synchronized state.

**Reproduction and limits.** An isolated production `SchemaSerializer`/`StateView` round-trip
for a non-GM with fully covered enabled fog retained the board's synthetic texture path and
an ordinary token's position. An explicitly hidden token was absent from that decoded state.
This used synthetic state, no real asset fetch or browser manipulation. It verifies the
delivery distinction, not a bypass of hidden-object protection. The schema encoder expanded
its default buffer and completed successfully; that diagnostic is not a reproduced security
failure.

**Impact.** A player inspecting their downloaded state/assets can learn content concealed
only by fog. This matters if a host assumes fog keeps map artwork, token locations or ordinary
piece metadata secret. It is an existing documented design limitation, not newly broken
authorization. Hiding content later cannot revoke information already received. Direct asset
URL access is also subject to the separate HARD-22 boundary.

**Potential safeguards.** Make the distinction clear in user-facing fog/help wording through
the approved UI/documentation process. Use explicit hidden objects for pieces that must not
be delivered yet, and player-safe map artwork without secret annotations. These measures do
not make covered parts of an already downloaded image confidential. If confidential partial
maps become a requirement, design authorized server delivery of only permitted content,
including asset access, caches, previews, saves and reconnects; that is a separate feature,
not a client-opacity fix or an implicit requirement to add game-rule enforcement.

**Acceptance.** Verify the documented policy with a non-GM's actual network/state/asset view,
including spectators, role changes and reconnects. Keep explicit hidden-piece serialization
tests passing. If stronger confidentiality is implemented, test unavailable underlying data
as well as visual concealment; browser screenshots alone cannot establish it.

## HARD-35 — Pixel-ratio developer override bypasses quality bounds

**Evidence.** [core.js](public/rendering/core.js)'s `qualitySettings` accepts any finite
`parseFloat` result from the URL's `px` parameter. Startup and `setQuality` pass that value
to `renderer.setPixelRatio`, independently of the selected preset. There is no positive-range
or maximum-ratio check here. The console-only `ottPixelRatio` hook also lacks equivalent
bounds, but a URL override is the more exposed entry point.

**Reproduction and limits.** Running the exact extracted production resolver with synthetic
dependencies returned 0, -1 and 10000 unchanged for the corresponding `px` values. No renderer
or GPU allocation was attempted. Actual browser/driver behavior may clamp, fail or lose the
context; a crash or denial-of-service threshold was not measured. This is a local rendering
availability concern, potentially triggered by a crafted app link, not credential theft or
server-side privilege escalation. Switching to Low still uses the URL override.

**Potential fix.** Validate a positive bounded pixel ratio at the common renderer boundary,
including URL and console entry points. Use viewport/device limits and a maximum backing-pixel
budget; reject malformed values and provide a safe fallback. Consider exposing debug overrides
only through an explicit developer mode. Preserve normal supported quality tiers.

**Acceptance.** Test zero, negative, very small/large, non-finite and malformed parameters,
viewport resize and tier switching. Verify bounded dimensions with a renderer double before
controlled device testing; do not intentionally exhaust a user's GPU to validate rejection.

## HARD-36 — Optional preferences can abort later table setup

**Evidence.** [audio.js](public/table/audio.js)'s `readVol` and mute/shuffle accessors directly
read localStorage; setters write directly. [preferences.js](public/table/preferences.js)'s
`bindPreferences` calls these during setup and also accesses storage for appearance settings.
[client.js](public/client.js) calls it before chat/notebook/scoreboard/timer control binding
inside its joined-room initialization promise. An exception propagates to the generic exit
handler rather than allowing the remaining controls to initialize. Core quality storage and
table-shell layout storage already catch storage errors, providing existing patterns to reuse.

**Reproduction and limits.** A production `bindPreferences` call with a synthetic SFX slider
and a storage double throwing on `getItem` propagated the exception. This verifies failure
propagation; the resulting full-page/connection lifecycle under real browser storage denial
was not exercised. Write failures such as quota errors are additional source-visible paths,
not separately reproduced here. These are optional preference values, not session credentials.

**Potential fix.** Reuse a focused safe preference-storage abstraction with validated defaults
and in-memory operation when persistence is unavailable. Contain optional panel setup errors
so one feature cannot skip unrelated control binding. Keep authentication/session storage
semantics separate: this is not a proposal to ignore credential persistence failures.

**Acceptance.** Inject read and write exceptions and invalid saved values, then verify that
core table controls remain usable and local preferences work for the current visit. Exercise
actual browser storage restrictions and confirm that failed optional setup neither strands
a joined connection behind an exit screen nor reports an authentication failure.

## HARD-37 — Modal state does not consistently block background shortcuts

**Evidence.** [client.js](public/client.js) supplies `isModalActive` for notecard/aura editors
to [createInputRouter](public/table/input-router.js). The router uses it for context-menu
entry, but `onKeyDown` does not apply it before Delete/Backspace, selection commands and other
gameplay shortcuts. The typing check recognizes INPUT/TEXTAREA, not a focused modal button.
[controls.js](public/table/controls.js) installs the command listener on `window`, so bubbled
keyboard events can reach that path. Modal presence is not an authorization restriction.

**Reproduction and limits.** The existing input-router fixture, using production router and
piece-drag modules, was supplied `isModalActive: () => true` and a focused BUTTON. Delete
emitted `remove` for the fixture's hovered die. This demonstrates a background mutation
request, not a full browser modal interaction or permission bypass. Whether a specific
dialog consumes the event before it bubbles requires browser testing; server permissions
still apply to the submitted operation.

**Potential fix.** Centralize keyboard ownership: an active modal should receive its own
shortcuts and suppress unrelated tabletop commands. Preserve intentional Escape/focus behavior
and ignore editable/select/contenteditable targets and handled events where appropriate.
Apply the policy to repeated axis input as well as one-shot commands; stop existing repeats
when focus/interaction ownership changes. UI/focus behavior changes need approved examples.

**Acceptance.** Open each editor/settings dialog with selected and hovered objects behind it;
test Delete/Backspace, letters and held axes with button, input, select and editable focus.
Assert no unrelated room mutation, correct dialog keyboard operation and recovery on close.
Include real desktop/touch-keyboard testing and retain spectator/time-out server gates.

## HARD-38 — Login can create a session after its password proof becomes stale

**Evidence.** `/auth/login` in [auth.js](server/http/routes/auth.js) reads an account with
`findUserByLogin`, awaits `verifyPassword` against that returned hash, then calls `createSession`.
[database.js](server/database.js)'s `createSession` performs an unconditional session INSERT;
it does not lock/recheck the account or compare the verified password hash. In contrast,
[account-security-queries.js](server/account-security-queries.js)'s `setPassword` locks the
account, rechecks the session and expected hash, and calls `rotateAccess` in one transaction.
Recovery also rotates access transactionally, but that does not serialize the login caller.

**Reproduction and risk.** A production login handler was paused in its injected verifier
after reading the old hash. The database double then modeled a completed reset by replacing
the hash and clearing prior sessions. Resuming verification returned HTTP 200 and inserted a
new session backed by the old password. An attacker must know the old password and overlap
the login/reset window; this is not a passwordless or arbitrary-account bypass. The new session
is created after the reset's revocation and can survive it. The test establishes route ordering,
not a measured live PostgreSQL race or practical attack success rate.

**Potential fix.** Reuse the credential transaction boundary for password-based session issuance:
perform expensive hashing outside the lock, then lock the account and compare its current hash
with the verified hash before inserting the session in the same transaction. Serialize login
with password change/recovery using the same account lock. Do not merely add an unlocked read
before INSERT. If logout-all must also reject already-started logins, explicitly define that
policy and add a credential/session generation checked under the same lock; unchanged passwords
otherwise still permit subsequent valid logins.

**Acceptance.** Delay login verification across password change and recovery commits and assert
no stale-proof session is issued. Test both transaction orders: a session issued before reset
must be removed by reset; one attempting issuance afterward must fail its hash check. Preserve
valid new-password login, rollback and ordinary multi-device login. Add live PostgreSQL
concurrency coverage and verify HTTP plus room access with the resulting credentials.

## HARD-39 — Site-admin writes outlive authority and can remove the final admins

**Evidence.** [createRequireAdmin](server/http/auth-context.js) authenticates a current database
session and checks `isAdmin` at route entry. In [admin.js](server/http/routes/admin.js), account
deletion then awaits target lookup, owned-room enumeration and live-room disposal before
`purgeUser`, without rechecking the actor. Room purge and orphan purge similarly await work
after authorization. `setAdmin` and `purgeUser` in [database.js](server/database.js) receive only
the target ID, so their database mutations cannot authorize the actor atomically.

The HTTP admin-role endpoint rejects self-demotion and account deletion rejects self-deletion,
but these are not a concurrent final-administrator invariant. Two admins can authorize requests
to demote one another and both writes can succeed. The CLI's `changeAdminByLogin` already uses
an advisory transaction lock and final-admin count; HTTP `setAdmin` and `purgeUser` do not share
that guard. The endpoint also coerces `isAdmin` with `!!`, so a string such as `"false"` grants
the role; the current browser sends proper booleans, and this is not an unauthenticated grant.

**Reproduction and risk.** Production router/auth-gate checks with database doubles paused an
account deletion during target lookup, demoted the actor, then resumed: deletion succeeded;
a fresh request correctly received 403. A second check let two initially valid admins reach
cross-demotion writes together: both returned 200 and no admin remained in the double. These
require previously valid administrative authority and overlapping requests. They demonstrate
authorization/lockout races, not public access to admin routes or live SQL exploitation.

**Potential fix.** Pass actor identity and session proof into dedicated transactional admin
mutations; revalidate live authority and target invariants under consistent locks. Share the
existing admin-role serialization policy across HTTP, CLI and account deletion, including
final-admin protection and strict boolean/ID validation. Recheck access after asynchronous
reads and before privileged responses/external side effects. For deletion, design a durable
deleting state/admission barrier before disposing rooms so concurrent room creation/joins and
failed deletion cannot leave an ambiguous half-completed lifecycle; this latter scenario still
needs reproduction. Record safe actor/target/outcome audit events without credentials.

**Acceptance.** Suspend admin operations across session revocation, account deletion and
demotion; verify that stale actors cannot mutate or receive newly read privileged data.
Concurrently cross-demote/delete the last admins across HTTP and CLI and require at least one
administrator to remain. Reject non-boolean role bodies. Inject disposal/query failures and
concurrent room creation; verify documented recovery and accurate success responses. Run real
PostgreSQL concurrency and multi-browser tests in addition to route fixtures.

## HARD-40 — Trash cleanup misses variants and obscures partial completion

**Evidence.** [trashOrphans](server/asset-cleanup.js) renames each original into
`.trash/<kind>/<name>`, removes only `.texture-cache/v1/<kind>/<name>.webp`, then records the
move in its returned list. [textureAssetPaths](server/http/routes/asset-textures.js) also
creates `v1-high`, `v1-thumbnail` and `v1-sky-low/medium/high` variants. Those remain on disk.
If the standard derivative removal fails, the catch logs an error but does not count the
already-completed original move. The [admin purge route](server/http/routes/admin.js) returns
the size sum of all scan candidates as `totalBytes`, regardless of which files actually moved;
[purgeOrphans](public/admin.js) presents that number as moved bytes.

**Reproduction and impact.** A temporary sky original with six cache variants was scanned and
trashed through production helpers: five variants remained. A production derivative-route
request still returned 404 without the original, so this is retained storage, not a demonstrated
public retrieval bypass. A second fixture placed a directory at the standard cache-file path,
forcing unlink failure after rename. The original was in trash, while the production admin
route returned `{moved: 0, totalBytes: 7}`. These inconsistencies can confuse operator recovery
and disk accounting; they do not establish loss of the trashed original. Moving originals to
trash retains their disk usage until the operator deliberately removes them.

**Potential fix.** Reuse one cache-variant registry/path policy for generation and cleanup.
Record original movement separately from derivative deletion and return per-stage success,
failure and actual moved-byte totals. Support idempotent retry of cache cleanup after the
original has moved, with a recoverable manifest and unambiguous partial-result feedback.
Coordinate in-flight conversion with cleanup so a completing encoder cannot recreate a cache
after deletion; this concurrency case remains untested. Any UI changes need approved examples.

**Acceptance.** Cover every current cache variant, absent caches, failed rename, failed unlink,
partial multi-file success and retries. Verify actual filesystem state matches reported counts
and bytes; originals remain recoverable and unrelated files remain unchanged. Check that
missing originals stay inaccessible through the derivative route. Test conversion/cleanup
interleavings and restoration without writing to production asset storage.

## HARD-41 — Public derivative generation has no shared admission budget

**Evidence.** [createAssetTextureRouter](server/http/routes/asset-textures.js) is mounted in
[server.js](server.js) without authentication or a route rate limiter. Public media access is
already tracked in HARD-22; this finding concerns conversion work. On a cache miss, `pending`
coalesces requests for the same destination, but every different key immediately calls
`createTextureDerivative`. There is no application-wide active/queued-job bound here. The
admin `prebuildTextureCache` defaults to two workers and `createTexturePrebuilder` coalesces
starts, but these do not share a scheduler/deduplication map with public conversions.

**Reproduction and limits.** The unchanged production router factory was extracted to inject
a deferred encoder and filesystem-stat double. Six distinct valid cache-miss requests admitted
six conversions before any completed; a seventh request for the first key correctly shared
its job. No native encoding or memory/CPU pressure was created by this check. Actual Sharp/
libuv/native scheduling may limit execution; it does not establish an application request-queue
budget. A caller must name existing allowed sources. Bundled image paths are predictable;
uploaded paths require knowledge of their random names. Quality choices and output sizes are
bounded. Existing caches avoid conversion, and unknown/missing sources return 404.

**Risk and potential fix.** Cold-cache bursts can enqueue substantial image work and contend
with gameplay, uploads and maintenance. A damaged source can also trigger repeated failed
conversions because pending work is removed on failure and no bounded failure cooldown is
recorded. Practical resource impact remains unmeasured. Reuse a shared bounded conversion
scheduler for prebuild and public requests, retaining per-key deduplication, with finite queue
capacity, overload responses and a bounded failure cooldown. Preserve public media behavior
unless HARD-22's policy changes. Choose source pixel/frame limits with HARD-24, and measure
cache/storage budgets and gameplay latency before selecting deployment limits.

**Acceptance.** Assert active and queued bounds across different sources/qualities and concurrent
prebuild, duplicate-key sharing, safe overload responses, failure retry/cooldown and recovery.
Use controlled cold-cache and malformed-source tests to measure CPU, memory, disk and room
latency. Keep originals unchanged, path validation intact, and successful cache delivery fast.

## HARD-42 — Safe client errors do not imply safe server logs

**Evidence.** [httpErrorHandler](server/http/async-route.js) sends a generic client error, but
logs `req.originalUrl` (including query values) and the raw exception message or thrown value.
[safe-message.js](server/game/safe-message.js)'s `safeContext` omits the incoming room payload,
but `report` still appends raw exception text. [server.js](server.js)'s public `/csp-report`
handler logs the entire submitted JSON body except for its benign-eval filter. The 64 KiB
parser limit bounds each accepted report, not its schema or the total retained log volume.

**Reproduction and limits.** A loopback fixture using the production auth router/parser/error
handler logged a fake query-string secret on a malformed request while returning only a generic
error. A manually submitted CSP report preserved a fake recovery fragment and an arbitrary
extra field in logs. This demonstrates the endpoint accepts and logs those values; it does not
claim that browsers normally send recovery fragments in CSP reports. A production `safeRoomTask`
fixture logged a fake private value embedded in a thrown Error while keeping the client message
generic. The tested malformed JSON password body was NOT included in its parser message on
this runtime; no actual password, session or private game data was used or observed leaking.

**Risk.** Secrets/private values present in URLs, exception messages or telemetry can enter
logs, backups and external log processors, expanding their audience and retention. Raw
exception text can also carry misleading log content. This is a logging boundary weakness,
not evidence of remote log access or initial credential theft. Structured room context alone
does not sanitize exceptions. Redis/pool and other subsystem loggers need the same policy;
their actual error contents were not exhaustively exercised here.

**Potential fix.** Use an allowlisted structured error record: request/operation identifier,
route template or sanitized path, safe error category/code and bounded non-secret context.
Omit URL queries, bodies, headers and raw thrown objects by default; sanitize/bound any retained
diagnostics. Validate CSP report shape, retain only useful fields, strip credentials/query/
fragment values from URLs, truncate text and sample repeated reports. Coordinate its separate
budget with HARD-05. Define operator log access, retention and export policy without removing
the information needed to diagnose failures.

**Acceptance.** Exercise HTTP, room/lifecycle, parser, dependency and telemetry failures with
synthetic secrets in URLs, payloads, exception messages and non-Error throws. Assert sensitive
values never reach logs or client responses, records cannot forge extra log entries, and useful
correlation/category information remains. Test oversized/repeated reports and deployment log
shipping/retention separately; do not use real credentials in fixtures.

## HARD-43 — Expected HTTP parse failures are classified as server errors

**Evidence.** [httpErrorHandler](server/http/async-route.js) returns HTTP 500 for every error
arriving before headers are sent. It does not distinguish parser errors' safe type/status
metadata from unexpected application failures. [createAuthRouter](server/http/routes/auth.js)
uses Express JSON parsing with a 1 KiB limit; malformed JSON and excessive bodies are rejected
before the route's database work but still reach the generic 500 response.

**Reproduction and impact.** A temporary HTTP fixture mounted the production auth router and
error middleware. Malformed JSON and an oversized JSON object both returned
`500 {"error":"internal server error"}`, with zero database reads. The parser boundary itself
worked: no oversized payload bypass or crash was demonstrated. The wrong status obscures
caller mistakes, mislabels operational metrics and may provoke inappropriate client retries.
The current shared browser helper does not automatically retry these failures.

**Potential fix.** Map known parser/validation error categories to bounded public 400/413/415
responses as appropriate, retaining generic 500 for unexpected failures. Use an explicit
allowlist, not arbitrary `error.message`, `error.expose` or caller-provided status values.
Keep body caps and the headers-already-sent delegation path, and apply HARD-42's logging rules.
Preserve existing route-authored 401/403/404/409 and limiter 429/503 responses.

**Acceptance.** Test malformed, oversized, unsupported-encoding and invalid-content requests
through the real parsers, confirming expected 4xx status and no downstream mutation. Inject
unexpected database/application failures and retain generic 500 without secrets. Cover errors
after headers have been sent and browser feedback. Any changed user-facing copy needs the
repository's approved-example workflow.

## HARD-44 — Separate database roles share the running application's secret boundary

**Evidence.** [docker-compose.yml](docker-compose.yml) supplies the app with both runtime
password-file settings and `MIGRATE_DATABASE_*` owner settings, and mounts both secrets into
the same long-lived container. [runMigrations](migrate.js) closes its privileged connection
after startup, but does not remove the mounted secret. Setting `AUTO_MIGRATE=false` skips the
runner; it does not remove those mounts or permissions.

The native [installer](proxmox/install.sh) similarly writes the owner-password path into the
service environment and makes configuration files `root:open-tabletop`, mode 0640. Its service
runs as `open-tabletop`, so the owner password remains readable to the runtime identity.
The app role's CRUD grants are a useful restriction on that particular database connection,
not an isolation boundary against arbitrary code/file-read access inside the application.
CRUD alone also permits damaging row deletion and modification; schema restrictions are not
a guarantee against data destruction.

**Risk and limits.** A runtime compromise able to read local secrets can obtain the migration
credential and acquire schema-changing privileges. This requires an initial compromise; no
credential extraction or privilege escalation was performed. The exact privileges of a live
database owner, host file permissions and secret mount behavior were not probed. Bootstrap
and optional mail credentials deserve similarly narrow lifetimes/access, but are separate
from the ordinary app database password that the server legitimately needs.

**Potential fix.** Run migrations as a separate deployment step/job with the owner credential,
then start the app with only the runtime credential. Remove privileged settings and secret
mounts/read permissions from the steady-state service; disabling migration alone is insufficient.
Keep a deliberate operator-only migration/recovery path and avoid broad database-owner grants
where narrower migration privileges suffice. Preserve rollback/fail-fast behavior and document
upgrades for both Docker and native installs. Do not silently change existing installations.

**Acceptance.** Verify the runtime identity cannot read owner/bootstrap secrets or authenticate
as the migration role after startup, while normal CRUD and authorized deployment migrations
still work. Test failed migrations, recovery and secret rotation without logging values. Run
database privilege tests against an isolated real database and inspect effective deployment
permissions separately from configuration review.

## HARD-45 — Broad Docker COPY can include ignored local credentials

**Evidence.** [Dockerfile](Dockerfile) uses `COPY . .`. [.dockerignore](.dockerignore) excludes
`.env`, `secrets`, `.git`, dependencies, docs and saved assets, but has no `.env.*` exclusion or
exclusions for local assistant/session directories such as `.codex`, `.agents` and `.claude`.
[.gitignore](.gitignore) excludes `.env.*` and those directories; Git exclusion is not a Docker
build-context exclusion. A local build from a checkout containing `.env.production`, for example,
can copy it into `/app` and the resulting image. Other local logs/dumps require the same review.

**Risk and limits.** This is conditional on sensitive local files being present in a build
context and the artifact being retained, shared or published. No such files were opened, no
image was built or pushed, and no published-image credential leak is claimed. Exact `.env`
and `secrets/` already have build exclusions. The issue concerns alternate filenames and
unnecessary local material, not a bypass of those existing exclusions.

**Potential fix.** Prefer an explicit runtime source allowlist for image contents, or expand
build exclusions to local environment variants, session data, backups, dumps and development
artifacts, preserving required runtime assets/migrations. Add a synthetic-canary build check
and inspect final image contents/layers before release. Keep build-time credentials out of
COPY and image layers rather than deleting them in a later layer.

**Acceptance.** Build from a temporary context containing fake secrets in `.env`, `.env.local`,
`.env.production`, `secrets/` and local session/log directories. Assert no canary reaches the
exported context/image/layers and that startup, migrations and bundled assets still function.
Do not build from a developer's real secret-bearing workspace to test this finding.

## HARD-46 — Upgrade backups have a narrower recovery boundary than the running app

**Evidence.** [backup_database](proxmox/install.sh) creates a custom-format `pg_dump` in a
mode-0700 backup directory using `mktemp`, checks that output is nonempty and stops the
operation on dump failure. The update branch calls it before dependency preparation, release
activation and `systemctl restart`; it does not first stop admission or flush/stop live tables.
The existing mocked installer tests verify dump-before-restart and failure-before-activation.
This is a database recovery point, not evidence of a corrupt SQL dump.

[README.md](README.md) already says uploaded files must be backed up separately and rollback
needs both the matching old release and database dump. The helper itself does not copy assets,
configuration/secrets or off-host backups, nor perform a restore check. A database dump cannot
capture server-only live state that has not been saved (see HARD-26/27). Changes accepted after
the dump can also fall outside that rollback point. Compose volumes preserve data across
ordinary container replacement but are not an independent backup.

**Risk and limits.** Treating the pre-update dump as a complete recovery checkpoint can lose
recent play or leave missing image/model references if matching originals are unavailable.
A full database restore can also restore historical credential/session/recovery rows, so
post-restore invalidation policy matters. No real dump/restore or credential-reactivation test
was run; these are recovery requirements inferred from the persisted data and backup scope.
Existing backup permissions and refusal to activate after dump failure remain protections.

**Potential fix.** Define an explicit recovery point and acceptable loss window. For a complete
checkpoint, coordinate admission/write/cleanup suspension, confirmed fresh room saves and
database plus original-asset capture; a failed flush must not be reported as a successful
checkpoint. Record release/schema versions and separately protect necessary configuration
and secrets. Define off-host encrypted retention, integrity/restore checks and post-restore
session/recovery-credential invalidation or rotation. Preserve existing manual recovery options;
do not claim filesystem caches or Redis rate buckets are required durable game data.

**Acceptance.** Restore a versioned backup into an isolated environment without sending real
mail or exposing copied accounts. Verify rooms, private hands, saved state, ownership and
original assets, expected credential revocation and startup migrations. Test failed dump,
failed final save, missing assets, writes during capture and incompatible rollback versions.
Measure the actual recovery point/time; source review and a nonempty dump are insufficient.

## Existing protections to preserve

- Server-side input validation and parameterized database queries in the reviewed account paths.
- Salted scrypt password hashes, random 256-bit session tokens, and hashed server-side token storage.
- Database-enforced session expiration and current permissions on token lookup.
- Filtered account responses that omit password/token hashes; auth responses marked `no-store`.
- Ordinary signup cannot choose administrator or approved-host status. Password-based signup
  automatically creates a pending host request; a passwordless account starts with no host request.
- Host requests use the authenticated user's ID and request only `pending`; approval requires
  current administrator permission. Room creation separately checks hosting permission.
- Password changes/recovery and logout retain server revocation and live room-access invalidation.
- Credential changes/recovery lock the account and consume proofs, replace credentials and
  rotate sessions atomically; preserve those protections while extending serialization to
  login (HARD-38). Single-use email links expire after 30 minutes and exchange into 10-minute
  grants. Recovery codes are hashed; generating a set still lacks fresh proof (HARD-10).
- Recovery email uses an operator-configured origin, TLS SMTP, a bounded serial queue and an
  account cooldown. The browser removes link fragments from history and requires Continue
  before consuming them. Plaintext codes are cleared from the UI when leaving that screen.
- The admin page's browser gate is backed by server-side session/admin checks. User projections
  exclude password hashes; account deletion and admin demotion reject self-targeting.
  Account purge is transactional for database changes and preserves asset records/visibility
  while releasing ownership; live-room disposal happens outside that transaction.
- Existing CSP and safe text rendering remain necessary after cookie migration.
- Database credentials support file-based configuration and encode component passwords;
  ordinary queries use the app role while migrations use a separate connection. Docker runs
  as a non-root user; native systemd uses a dedicated user and filesystem restrictions.
  These do not remove the retained owner credential described in HARD-44.
- Each pending migration and its tracking row commit in one transaction; migration failure
  rolls back that migration and prevents listening. Bootstrap skips populated databases,
  does not recreate a lost admin implicitly, and fails on database errors. Native updates
  preserve credentials and stop before activation on backup/dependency failures.
- Configured Helmet/CSP headers are active before ordinary app routes. The checked fixture
  emitted enforced CSP, `nosniff`, `SAMEORIGIN`, `no-referrer` and HSTS; this does not prove
  deployed HTTPS/proxy behavior. Scripts are restricted to self and the approved inline hash;
  inline styles remain allowed. The stale report-only comment is not the actual CSP mode.
- HTTP async errors are forwarded to the shared handler; reviewed user-query failures reject
  rather than become empty results. Room boundaries contain sync/async failures and send
  generic client notifications, but do not supply mutation rollback (see HARD-20/27) or
  sanitize arbitrary exception text (HARD-42).
- Token buckets return 429 with `Retry-After`; store errors block downstream work with 503.
  Redis uses an atomic script/server time and expiry. Explicit production memory mode is
  permitted by code but remains process-local; deployment-wide throttling requires the
  shared store and correct proxy trust. The existing IP-only limitation remains HARD-05.
- Camera/quality/audio/appearance preferences stay local; named SFX and bundled music select
  fixed same-origin resources rather than a sender-supplied media URL. Optional preference
  storage is distinct from the account-token risk in HARD-01.
- Orphan purge rescans instead of trusting a browser-supplied file list. Database references
  come from one statement, private/live references are collected around the await, and failures
  abort scanning. The 24-hour grace period, category/filename checks and regular-file-only scan
  protect recent uploads and exclude directories/symlinks. Trash is outside served asset paths.
- Texture paths and qualities are allowlisted. Derivatives preserve originals, bound output
  dimensions and use temporary-file rename. Same-key public requests share work; admin prebuild
  has two workers and one job per process. These protections do not close HARD-40/41.
- Quality presets and shadow sizes use known choices; preserve those while bounding pixel-ratio
  overrides (HARD-35). Input axis timers stop on keyup/window blur. Existing canvas/geometry
  disposal helpers protect shared textures and release owned resources.
- Table preflight authenticates before normal matchmaking allocation; `onJoin` reauthorizes
  against the actual room. A process-local writer guard prevents duplicate durable-room writers.
- Watch requires normal admission and persists spectator policy server-side. Participation
  capability checks block gameplay independently of UI controls or room rank.
- Member-list delivery rechecks live GM access after database reads and supplies account-based
  `isSelf`. Ordinary membership operations reject self/owner/admin targets where applicable;
  preserve these checks while closing HARD-33's concurrent target-change gap.
- Time-out/self-participation writes use transactions, row locks and live checks before commit;
  room changes publish after commit and update all tracked account connections. Self-service
  return to play does not clear time-out. Seat reservations cover duplicate tabs during return.
- Spectating/time-out cleanup releases held objects, drawing/editing leases and active reveals
  while retaining seats, hands and trays. Communication and authorized administration remain
  available by policy; time-out is a gameplay restriction, not a chat mute or role removal.
- Kick revokes all tracked connections and pending reconnects in the room. It deletes membership
  (and cascading participation policy), not a durable ban; subsequent admission follows the
  room's approval policy. Ordinary departure leaves membership/time-out intact.
- Hidden pieces use per-client schema views. Hands, deck order and concealed card fronts live
  in server-only maps; hand messages target one connection. Saved hands are reclaimed by account.
- Table/scale/shared-lighting edits require active GM gameplay access; room lighting default
  replacement/reset requires owner rank. Lighting drafts preview locally until explicitly sent.
  Validators bound fields and use fixed shape/material choices; grid rendering has density caps.
- Overlay creation has room/session count limits and validated geometry; move/remove requires
  its owning session or GM rank. These protections do not imply a preview-rate budget (HARD-31).
- Manual fog edits require active GM access, current revision, bounded brush/mask/history and
  a per-client edit interval. Aura configuration checks the previous value; hidden pieces do
  not drive reveal auras. Explicit hidden-piece delivery and physics isolation remain separate
  from visual fog (HARD-34).
- Reconnect checks current access using the original session, and revocation invalidates pending
  reconnect reservations. Preserve this while addressing HARD-15's current-login mismatch.
- Movement messages validate IDs, unique bounded groups, finite world coordinates and release
  vectors; group-derived destinations are checked again. Only the holding session can move or
  release a piece. Hidden-piece checks and participation gates precede movement handlers.
- Server physics caps drag and throw speed, recovers escaped bodies and publishes transforms.
  Departure/time-out cleanup releases held pieces without a throw.
- Ordinary secret-card faces, deck order and pending inspections remain server-only until
  delivered to authorized recipients. Double-sided/open tiles intentionally publish both faces.
- `playCard` resolves the supplied hand ID within the sender's hand; clients do not submit the
  card face to play. Full-table placement retains unplaced inventory. Reordering must be a
  permutation of the existing hand.
- Deck browsing uses private previews, live access checks, exclusive expiring sessions, entry
  tokens/revisions, duplicate-action receipts and destination-failure rollback. Ordinary top-card
  inspection and permission-controlled whole-deck browsing are distinct capabilities.
- Library listing suppresses private results after admin revocation/demotion during a read.
  Saved-asset loads recheck gameplay capability and required room rank after database reads,
  then check publication/admin access and final capacity before ordinary piece creation.
- Library queries use parameterized IDs and propagate database failures instead of presenting
  outages as empty catalogs. Scene listings omit payloads; deck listings expose a catalog
  preview/count rather than the complete card array or live deck order.
- Asset authoring/curation and package transfer require site-admin permission. Generic asset
  SQL uses an internal table allowlist and parameterized values. Publishing changes catalog
  visibility; it does not revoke known media URLs (HARD-22).
- Package uploads authenticate before staging, serialize transfers within a router instance,
  enforce manifest/file/expanded-byte budgets, reject unsafe ZIP names/types/duplicates, verify
  dependency closure and hashes, and do not extract attacker-selected paths to permanent storage.
  Package responses are no-store; filesystem reads reject symlinks and unsupported references.
- Package imports create new private records and fresh media filenames. Database import uses
  a transaction and rechecks authorization before commit; definite failures clean up new files,
  while uncertain commits retain files for recovery instead of deleting potentially committed
  dependencies. Collection imports include private copies of their members.
- Manual Save requires GM gameplay access and a persistent room, rejects oversize snapshots,
  awaits the database write and rechecks access before sending `stateSaved`. Failures receive
  a sanitized `sceneError`; the browser's success indicator follows the acknowledgment.
- Room writes clone payloads at request time and serialize database completion. A failed write
  does not poison later saves, and zero-row updates reject. The process-local room-writer guard
  remains held through final-save completion; it is not a multi-process coordination mechanism.
- Full snapshots include concealed card data and account-owned hands in server/database state.
  Pending inspections are folded back into their source deck in the snapshot or retained as
  recovery cards. Restore separates face-down fronts from shared props, regenerates hand IDs,
  and reclaims hands using authenticated account identity. Empty/hands-only snapshots replace
  old populated checkpoints. Database backups/recovery copies therefore contain private content.
- Chat sender/text are rendered with `textContent`; notes use textarea values; notecard text
  is drawn with canvas `fillText`. These reviewed paths do not interpret submitted prose as HTML.
- Shared notes require GM gameplay access. Private notebook keys come from authenticated
  account/session state and replies target the requester. Whiteboard changes require the
  drawing owner or the relevant GM control; normalized stroke coordinates/history are bounded,
  and departure/time-out cleanup releases ownership.
- Notecard originals and stack contents stay server-side while concealed or edited. The
  private edit lease is bound to the connection, random token and expiry; commit revalidates
  content/destination/capacity, and hidden-piece access passes through the common visibility
  gate. Creation has request acknowledgments/deduplication. Ordinary rejection keeps a draft;
  disconnect/lease closure clears client draft pixels rather than making them durable.
- Notecard templates differ from the admin-only uploaded asset catalog: signed-in accounts can
  own templates. SQL restricts reads/mutations to public/owner/admin policy, checks the live
  admin role and uses revision checks for changes/deletion. Read responses recheck current user
  access and are private/no-store. Template copies are independent of their original.

## Work sequence and verification record

Follow the [consolidated implementation sequence](#consolidated-implementation-sequence)
and its delivery/verification gates. It replaces the initial account-only sequence and covers
all 46 findings. The entries below preserve historical evidence and checks, not completion
of the proposed work.

**2026-10-07 consolidation:** assigned every finding one primary batch, separated policy
decisions from security/data/reliability work, identified cross-batch dependencies, and prepared
concrete A1/A2/A3 handoffs. No new vulnerability, runtime fix, policy acceptance or user test is
claimed. This documentation-only pass checked ID coverage/uniqueness, register-to-batch mapping,
local links/anchors and diffs. Earlier runtime test results were not rerun or counted as fixes.

**2026-10-01 baseline:** task-directed graph/source review of the landing/account/host flow.
Graph coverage reported no recorded gaps for the evidence paths checked during that review.
The following existing suites passed all 18 tests:

```sh
node --test test/backend-http.js test/backend-access-routes.js test/backend-account-security.js
```

The HTTP test initially could not bind loopback inside the sandbox; rerunning with permitted
loopback networking passed. These tests are not a full deployment audit, complete host-approval
integration test, or proof against XSS, timing attacks, distributed abuse, or CSRF. No manual
browser walkthrough or live TLS inspection was completed for these findings. Proposed fixes
remain unimplemented and unverified.

**2026-10-01 landing-controls follow-up:** graph/source review covered the remaining lobby
controls and recovery flows. Coverage checks reported no recorded gaps for the evidence paths.
These four existing suites passed all 28 tests with permitted loopback networking:

```sh
node --test test/avatar.js test/backend-room-access.js test/backend-account-security.js test/backend-access-routes.js
```

Additional ad hoc checks used only synthetic data and did not mutate production data or send
mail: the production recovery-code handler issued codes without a password recheck using
stubbed authentication/database; the production join handler/query factory used stale policy
in a mocked interleaving; the production logout function swallowed simulated revocation failure;
and the shared avatar validator accepted a non-image prefix string. These checks are evidence
of narrow behavior, not end-to-end exploit tests. No new regression tests or runtime fixes were
added. Live database races, load/abuse capacity, complete recovery takeover, and manual
browser/device flows remain unverified. Quick Join's persistent passwordless account creation
also clarifies HARD-06's identity/email-reservation concern despite the current “No account
needed” UI wording.

**2026-10-04 table-entry follow-up:** reviewed Enter/Watch through readiness and reconnect using
task-directed graph/source evidence (generation `2026-10-04T20:24:26Z`). Coverage reported no
recorded gaps for the checked JavaScript evidence; `public/table.html` had partial parse ranges
at 1407, 1470, 1474 and 1478, which were read directly along with its entry markup/script tags.
Graph edges were checked against source imports/call sites where heuristic resolution was
ambiguous. This is bounded verification, not a complete graph or application security audit.

All 49 tests passed in the following existing suites (temporary loopback servers permitted):

```sh
node --test test/backend-security-boundaries.js test/backend-room-access.js test/piece-visibility.js test/backend-scene-persistence.js
```

These include production matchmaking with an isolated database fixture, reconnect revocation,
schema serialization of hidden pieces, and saved-hand/private-front restoration. They do not
establish browser/device readiness or a full production database/deployment audit. Documentation
link/diff checks were also run; the full runtime check suite was not needed for documentation-only
edits.

HARD-15's synthetic checks used the actual client bootstrap and access service with stubs;
they did not connect to production, use real credentials or change accounts. HARD-16 is
source-confirmed with browser failure simulation pending. No runtime fixes or new repository
tests were added. Watch's durable, cross-connection participation behavior is intentional;
role and participation are separate, so a spectating GM retains authorized observation and
administration. No new admission bypass or initial hidden-piece disclosure was established.

**2026-10-04 first-interaction follow-up:** traced raw pointer input through local selection,
piece drag, guarded movement handlers, validation, physics preparation/step/recovery, release
and interpolated rendering. Graph generation was `2026-10-04T20:24:26Z`; coverage checks reported
no recorded gaps for the evidence files and the bounded movement/physics scopes. Direct source
reads verified event wiring and callback/dependency-injection edges not reliably represented by
the graph. HARD-17/18 are reproduced with synthetic state and production functions, not live
browser or remote exploit tests. No production data, runtime code or repository tests changed.

All 77 individual tests passed with:

```sh
node --test --test-isolation=none test/backend-movement-handlers.js test/backend-physics-update.js test/backend-physics-safety.js test/backend-participation.js test/input-router.js test/piece-visibility.js
```

The initial default-isolation run reported only six passing file-level entries; it was repeated
without process isolation to obtain individual assertion results. The movement suite also passed
all seven tests when run directly. Documentation links and diffs were checked. No full runtime
check was needed for documentation-only edits; real-device cancellation, multiplayer contention,
network load and broader gameplay privacy remain unverified.

**2026-10-05 card-lifecycle follow-up:** task-directed graph/source review covered card and
hand transfer, inspection/recovery, selective sharing and deck browsing. Graph generation was
`2026-10-04T20:24:26Z`, with matching source metadata and no recorded coverage gaps for checked
evidence paths/scopes. Callback and dependency-injection edges were verified in source where
graph resolution was incomplete or ambiguous. HARD-19/20 have isolated reproductions using
production controllers/handlers and synthetic DOM/state; HARD-21 awaits browser reproduction.

All 91 existing tests passed:

```sh
node --test --test-isolation=none test/backend-card-handlers.js test/backend-placement-handlers.js test/backend-deck-browsing.js test/backend-room-feature-handlers.js test/backend-scene-persistence.js test/hand.js test/piece-visibility.js
```

These tests cover intended audience delivery, hidden fronts, capacity preservation, private
browsing access/replay/rollback, and saved inventory. Passing them does not cover the newly
identified gaps. No production data, runtime code or repository tests changed. Documentation
links/diffs were checked; a full runtime check was unnecessary for documentation-only changes.
Actual browser/remote exploitation, real-device behavior and media-serving privacy remain
unverified. Revealing a face and later hiding it cannot erase a recipient's prior knowledge.

**2026-10-05 library-loading follow-up:** reviewed catalog UI/message wiring, authorized list
queries and saved-asset loading, built-in spawning, hidden placement and destructive setup
boundaries. Generation `2026-10-04T20:24:26Z` had matching metadata and no recorded gaps for
checked evidence files. Exact source verified dynamic handlers and injected calls. Fault
injection extended HARD-20 to scene/board replacement; HARD-22 records the known-URL media
boundary as a policy decision, with no practical URL-guessing exploit claimed.

All 130 tests passed in:

```sh
node --test --test-isolation=none test/backend-library-handlers.js test/backend-library-operations.js test/backend-library-queries.js test/backend-scene-persistence.js test/backend-starters.js test/backend-piece-handlers.js test/piece-visibility.js
```

One additional existing HTTP media test passed using permitted temporary loopback networking:

```sh
node --test --test-isolation=none --test-name-pattern='asset HTTP boundary' test/backend-security-boundaries.js
```

The media test used synthetic files and no production credentials/data. The replacement checks
used production functions with injected failures and did not persist their synthetic state.
Links/diffs were checked. Runtime code and repository tests were unchanged; no full runtime
suite was required. Live database concurrency, full browser replacement/recovery, derivative
URL policy and media complexity/resource limits remain unverified.

**2026-10-05 asset-authoring follow-up:** traced direct uploads, deck/tile saves, editing and
publication, collection handler boundaries, and ZIP/legacy JSON transfer. Graph generation
`2026-10-05T14:21:59Z` reported matching metadata and no recorded gaps for checked evidence
paths. Exact source verified middleware order and dynamic/injected callbacks; ambiguous graph
edges were not treated as proof of a call. Added HARD-23/24/25 with bounded reproductions.

All 109 existing targeted tests passed:

```sh
node --test --test-isolation=none test/backend-uploads.js test/asset-packages.js test/asset-package-archives.js test/backend-library-handlers.js test/backend-library-queries.js test/backend-collections.js test/backend-asset-cleanup.js
```

The first sandboxed run could not use the HTTP fixtures' loopback listeners; the permitted
rerun passed. Tests use temporary files and synthetic/mocked database state. Additional isolated
checks exercised production upload middleware with injected auth/rate-limit/storage, package
inspection with tiny malformed media, an injected deck insert failure, and the extracted client
save callback. No production data was written and no resource-exhaustion test was attempted.
Runtime code/tests were unchanged; documentation links/diffs were checked instead of a full
runtime suite. Real browser recovery, live database failure/concurrency, proxy upload behavior,
storage quotas and model/decoder resource measurements remain pending.

**2026-10-05 persistence follow-up:** traced settings writes, manual snapshots, reset, departure,
final disposal and restoration. Graph generation `2026-10-05T14:26:48Z` had matching metadata
and no recorded gaps for checked application/test/document paths or the `server/game` scope.
Installed Colyseus files are excluded from the graph; their signal registration, graceful
shutdown and awaited `onDispose` paths were read directly. No whole-deployment durability claim
is inferred from that source. Added HARD-26/27/28; HARD-20 still covers destructive restoration
failure rather than rollback being established by a successful save.

All 34 existing targeted tests passed:

```sh
node --test --test-isolation=none test/backend-room-state-handlers.js test/backend-room-queries.js test/backend-scene-persistence.js test/backend-hand-state.js
```

Additional isolated checks reproduced stale gameplay in a settings write, duplicated-setting
restore precedence, oversize final-save fallback, lack of a background retry and disposal after
an injected final-write error. Fixtures used production functions/an extracted production
method with synthetic state, injected storage and framework dependencies. No production data,
real process termination or live database outage was involved. Documentation links/diffs were
checked; runtime code and repository tests were unchanged. Full runtime/integration suites,
browser save feedback, shutdown grace periods, backup security and crash/restart testing remain
separate verification work.

**2026-10-05 communication/writing follow-up:** traced chat, both note types, whiteboard,
notecard edit/create/commit and template access boundaries. Graph generation
`2026-10-05T15:31:24Z` had matching metadata for the checked evidence. The HTML file's reported
parse gaps (1407, 1470, 1474, 1478) and relevant controls were read directly. Installed Colyseus
Room code is graph-excluded and was read directly for its default message limit. A queried
`test/scoreboard.js` path was absent and is not test evidence. Dynamic callbacks were verified
from source rather than inferred from incomplete graph edges. Added HARD-29 through HARD-32.

All 105 existing targeted tests passed:

```sh
node --test --test-isolation=none test/backend-room-feature-handlers.js test/backend-room-state-handlers.js test/backend-overlay-handlers.js test/notecards.js test/notecard-text.js test/notecard-templates.js test/whiteboard.js test/piece-visibility.js
```

Isolated checks used production handlers/controllers and minimal DOM/canvas fixtures to verify
same-name self attribution, 100-message chat growth, silent over-limit note rejection, pending
notebook debounce and 2,001-stroke overflow/replay. No messages reached real users and no
production data was changed. Runtime code/tests were unchanged; documentation links/diffs
were checked. These are not browser pixel, high-load, live SQL, disconnect or complete template
workflow tests. Template creation quotas, full draft-recovery behavior and multi-editor
conflicts remain further review/verification work.

**2026-10-05 in-room administration follow-up:** Tier 2 graph/source verification used generation
`2026-10-05T16:13:33Z`; checked evidence paths had matching metadata and no recorded gaps.
Relevant search pagination and call traces were read; injected callbacks and message handlers
were checked in exact source rather than inferred from graph edges. Added HARD-33 with two
deterministic deferred-read production-handler reproductions. No real member was changed.

All 102 targeted tests passed (no skips):

```sh
node --test --test-isolation=none test/backend-member-handlers.js test/backend-member-service.js test/backend-participation.js test/backend-participation-queries.js test/backend-spectators.js test/backend-room-access.js test/backend-interaction-policy.js test/participation.js test/presence.js test/backend-room-state-handlers.js
```

These include a Colyseus matchmaking/reconnect test with a synthetic transport, not a real
browser session. Query tests use doubles; live PostgreSQL concurrency, multi-browser moderation,
load/queue limits and timer clock-skew behavior remain unverified. Turn advancement and shared
timer control are available to unrestricted players by current policy; reorder requires GM
and score editing helper rank. No rule-enforcement change is proposed by this review. Runtime
code/tests were unchanged; documentation links, finding IDs and diffs were checked.

**2026-10-07 table/spatial follow-up:** Tier 2 graph/source verification used generation
`2026-10-05T18:01:37Z`, with coverage metadata recorded on 2026-10-07 and matching evidence
paths; no recorded gaps in checked files/scopes. Relevant searches were fully paginated.
Exact source verified injected render callbacks and protocol registrations where graph edges
were incomplete or ambiguous. Extended HARD-18/HARD-31 and added policy finding HARD-34.

All 73 existing targeted tests passed (no skips):

```sh
node --test --test-isolation=none test/backend-room-state-handlers.js test/backend-overlay-handlers.js test/backend-table-scale.js test/room-settings.js test/lighting.js test/overlays.js test/map-fog.js test/map-fog-volume.js test/piece-visibility.js
```

Additional isolated checks reproduced cancelled ruler creation, 100 preview broadcasts for
100 valid requests, and fog-covered public data versus explicitly hidden data in production
schema serialization. Fixture setup mistakes (a missing map and passing an array instead of
the production Set dependency) were corrected before the latter checks passed; those are not
application failures. No real users/assets were accessed or changed. No runtime/test files
were modified. Documentation links/IDs/diffs were checked; browser fog rendering, GPU/load,
real touch cancellation and deployment privacy expectations remain unverified.

**2026-10-07 local-browser follow-up:** Tier 2 graph/source verification used generation
`2026-10-05T18:01:37Z`, with matching evidence metadata recorded on 2026-10-07 and no recorded
gaps in checked files/scopes. Relevant discovery searches/call traces were fully paginated;
dynamic input/render wiring and initialization order were read directly. Added HARD-35–37.

All 39 targeted tests passed (no skips):

```sh
node --test --test-isolation=none test/input-router.js test/presence.js test/room-settings.js test/rendering-resources.js
```

Isolated checks exercised the extracted quality resolver without GPU allocation, production
preference setup with storage denial, and production keyboard routing with an active-modal
flag and button focus. No live room mutation or user preference write occurred. Browser input
suite, real-device gestures, actual storage denial, GPU/context pressure and full modal behavior
were not tested. Source inspection found that `showExit` replaces the body rather than providing
central teardown of animation, window listeners, timers and audio; ordinary Lobby navigation
unloads the page. The exact same-page exit resource/error behavior needs browser profiling and
is not claimed as a measured memory leak or continued-render duration. Runtime/tests were
unchanged; documentation link/ID/diff checks passed.

**2026-10-07 account-security/site-administration follow-up:** Tier 2 graph/source verification
used generation `2026-10-05T18:01:37Z`, with matching evidence metadata recorded on 2026-10-07
and no recorded gaps for the checked paths/scopes. Relevant discovery/trace results were fully
paginated; injected database/UI calls and HTTP middleware wiring were read directly because
some graph edges were incomplete or ambiguous. Added HARD-38/39; HARD-09/10 remain open.

All 37 targeted tests passed (no skips):

```sh
node --test --test-isolation=none test/backend-auth.js test/backend-account-security.js test/backend-access-routes.js test/backend-bootstrap-admin.js test/backend-room-access.js
```

The initial sandboxed run passed 36 tests but its HTTP fixture could not bind loopback
(`EPERM`); the permitted rerun passed all 37. Additional isolated production-route checks
reproduced stale-password login issuance, account deletion after actor demotion, and concurrent
cross-demotion leaving no admins. They used deferred verifiers/reads and database doubles;
the login reset was modeled, not executed against PostgreSQL. No real accounts, messages,
SMTP delivery or persistent data were affected. Live SQL concurrency, real recovery delivery,
multi-browser session replacement, deletion failure/admission races and operator recovery
remain unverified in this review. Runtime code and repository tests were unchanged;
documentation links, finding IDs and diffs were checked instead of a full runtime suite.

**2026-10-07 administrator-maintenance follow-up:** Tier 2 graph/source verification used
generation `2026-10-05T18:01:37Z`, with matching evidence metadata recorded on 2026-10-07 and
no recorded gaps in checked paths/scopes. Relevant searches/traces were fully paginated;
dynamic router wiring, filesystem operations and injected dependencies were read directly.
Added HARD-40/41; HARD-22/24/39 remain relevant, not resolved by these maintenance controls.

All 30 targeted tests passed (no skips), with permitted temporary loopback HTTP fixtures:

```sh
node --test --test-isolation=none test/backend-asset-cleanup.js test/backend-asset-textures.js test/backend-access-routes.js test/asset-texture-url.js
```

Additional temporary-file checks reproduced five retained derivative variants and a moved
original omitted from the result after cache-removal failure. The actual derivative handler
returned 404 for the missing original. An extracted production router with a deferred encoder
and stat double admitted six unique conversions while coalescing a duplicate. No production
files, native load test, live database concurrency or actual admin browser workflow was involved.
Concurrent new database references during scanning, scan/event-loop cost at scale, conversion
versus cleanup, cache/disk budgets and manual restore remain further verification work.
Runtime code and repository tests were unchanged; documentation links/IDs/diffs were checked.

**2026-10-07 failure-handling/server-safeguards follow-up:** Tier 2 graph/source verification
used generation `2026-10-05T18:01:37Z`, with matching evidence metadata recorded on 2026-10-07
and no recorded gaps in checked paths/scopes. Relevant searches/traces were fully paginated;
HTTP registration, injected callbacks, middleware order and error propagation were read directly.
Added HARD-42/43 and extended HARD-05 for shared CSP/auth allowance. An attempted read of
`public/table/session.js` found no file; it is not evidence and client error wiring was checked
in `public/client.js` instead.

All 40 targeted tests passed (no skips):

```sh
node --test --test-isolation=none test/backend-http.js test/backend-rate-limit.js test/backend-safe-message.js test/backend-user-queries.js test/backend-table-message-boundaries.js test/browser-http.js test/backend-interaction-policy.js test/backend-movement-handlers.js
```

An additional permitted loopback fixture mounted the production auth router/parser/error
handler and extracted unchanged production Helmet/CSP/report registration. It checked actual
headers, generic 500 responses for malformed/oversized JSON, query/report logging and report
budget interference with login. A room fixture checked raw exception logging versus generic
client notification. Only synthetic secrets and in-memory storage were used; no production
requests, live database/Redis, real reverse proxy, log exporter or resource-load test was involved.
Browser CSP enforcement, deployed TLS/forwarding, dependency error contents and log retention
remain separate verification. Runtime code/tests were unchanged; documentation links/IDs/diffs
were checked. These passing tests do not establish exhaustive error handling or rollback.

**2026-10-07 deployment/recovery follow-up:** Tier 2 graph/source verification used generation
`2026-10-05T18:01:37Z` with matching indexed evidence metadata recorded on 2026-10-07. Exact
source supplemented ambiguous injected-call graph edges. `.dockerignore` had `not_tracked`
freshness and was read directly; the reported SQL parse ranges in `postgres/grants_app_role.sql`
(16–21 and 26–27) were read directly. Relevant search/trace pages were complete. Added HARD-44–46.

All 63 targeted tests passed (no skips):

```sh
node --test --test-isolation=none test/backend-database-config.js test/backend-bootstrap-admin.js test/backend-database-factory.js test/linux-installer.js
```

Installer tests use remapped temporary paths and mocked service/package/database commands;
they do not install software, change host services or exercise real PostgreSQL restoration.
No actual secret files, Docker builds, migrations, production backups or restores were run.
Runtime code/tests were unchanged; documentation links/IDs/diffs were checked. Live role
privileges, TLS to remote stores, image contents, cross-store backup consistency, restore drills,
concurrent migration runners and legacy-baseline adoption remain further verification work.
The runner checks filenames/tracking rows rather than proving complete schema compatibility;
its legacy adoption assumes the documented baseline. No concurrent-upgrade safety claim is made.

For each future walkthrough step, append evidence to an existing finding or assign a new ID.
Record the reviewed path, preconditions, possible impact, proposed fix, and acceptance checks.
Mark an issue resolved only with implementation evidence and explicit verification status;
retain accepted risks and deferred decisions with their rationale.

## Supporting guidance

- [OWASP: HTML5 storage security](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#local-storage)
- [OWASP: session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP: authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP: WebSocket security](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)
- [MDN: Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
- [Current account-security contract](docs/ACCOUNT_SECURITY.md)
