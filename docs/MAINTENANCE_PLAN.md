# Dependency maintenance plan

Written **2026-10-16**. This document establishes the maintenance procedure and
records follow-up work. It does not enable scheduled update jobs or authorize
publication. The Node runtime prerequisite has been implemented separately below;
The coordinated Colyseus upgrade is now implemented locally; other package
upgrades and deployment acceptance remain separate work. Start with the
[dependency inventory](DEPENDENCY_INVENTORY.md); the first framework assessment is
[Colyseus 0.18](COLYSEUS_018_ASSESSMENT.md).

## Ownership and cadence

The release maintainer owns the review queue and release record. The maintainer
of each affected subsystem assesses compatibility and completes its acceptance
checks. One person may perform both roles; every batch still needs an explicit
owner and a recorded decision.

| Cadence / trigger | Work | Required outcome |
| --- | --- | --- |
| Weekly review | Advisories, upstream releases, failed CI, container/host security updates | Prioritized queue; record action, deferral reason or no actionable change |
| Monthly maintenance window | Compatible npm updates, browser-library candidates, tooling/actions and image rebuilds | Small independently reviewable changes with tests and release/deferral decision |
| Quarterly review | Breaking versions, runtime support dates, service majors, unused packages, overrides and backup restoration | Updated support policy and scoped migration assessments |
| Urgent advisory or active exploitation | Check exposure, containment and fixed releases immediately | Expedite a bounded fix and validation; document any temporary mitigation and follow-up |
| Before every release | Refresh inventory changes and unresolved risk decisions | Exact tested versions, completed checks and rollback/upgrade notes |

This cadence is a manual procedure until automation is explicitly implemented.
Security urgency depends on reachability and deployment exposure, not severity
labels alone. A deferred issue needs an owner, reason, mitigation if applicable,
and a next-review date or triggering event. Unsupported runtimes/services also
belong in this queue even when no advisory is reported.

## 1. Discover without changing versions

Inspect the working tree and preserve unrelated changes. Record the commit and
any relevant local diff used for assessment. Read manifests and lockfiles first;
installed modules and floating image tags are not an exact release inventory.

Read-only registry checks from the repository root:

```sh
npm outdated --long
npm outdated --all --json
npm audit --omit=dev --json
npm audit --json
npm --prefix tools/model-authoring outdated --long
npm --prefix tools/model-authoring audit --json
npm view @colyseus/core dist-tags engines peerDependencies --json
```

These commands require registry access and can exit nonzero for findings.
Network/advisory-service failure is an incomplete check, not an empty report.
Save reports outside the source tree or in a deliberately chosen review artifact.
For `npm outdated`, **wanted** satisfies the manifest range; **latest** is the
registry's dist-tag and may cross a breaking boundary.
[npm's command reference](https://docs.npmjs.com/cli/v11/commands/npm-outdated/)
describes the distinction. Neither value is automatically an approved target.

Also review vendored upstream releases and licenses, base/service image advisories
and digests, GitHub Actions, host package support and offline regeneration tools.
An npm audit does not cover those surfaces or prove that app authorization is safe.
Inspect full transitive lockfile changes and optional/native dependencies as well
as direct package declarations. Avoid printing credentials, private game data or
local environment files into reports.

## 2. Select a bounded update

Record each candidate using this checklist:

| Field | Required detail |
| --- | --- |
| Identity | Package/artifact, owner, consuming subsystem and source/license |
| Versions | Declared range, locked/shipped version, proposed exact release or digest |
| Reason | Advisory, correctness fix, support deadline or useful capability |
| Compatibility | Release notes, engine/peer requirements, changed APIs/protocols and data formats |
| Change scope | Manifests, lockfiles, vendored files, callers, tests and deployment/docs affected |
| Acceptance | Automated checks plus manual device/multiplayer/deployment scenarios |
| Recovery | Previous artifact, compatible data boundary and restoration procedure |
| Decision | Selected/deferred/rejected, rationale, review date and remaining uncertainty |

Group related packages by a shared contract: Colyseus core/transport/schema/browser
SDK; Three.js/addons; GLTF authoring tools/decoder; or HTTP middleware and its
transitives. Exact patch numbers within a group need not be identical; peer ranges
and actual interoperability determine compatibility.

Separate breaking upgrades from ordinary patches and from feature/refactor work.
Treat pre-1.0 minor jumps such as Colyseus 0.17 to 0.18 as migration work. Retain
intentional differences, including the offline Sharp pin. Do not use a blanket
`npm audit fix --force`, discard lockfiles, or broaden every range to latest.

## 3. Implement and prove reproducibility

Work on a `codex/` maintenance branch or suitable isolated checkout. Reuse existing
adapters and error boundaries; change behavior only where the migration needs it.
Review changed package sources, lifecycle scripts, native binaries, integrity
entries and newly added transitives. Preserve an override until the parent tree
and advisory checks justify removing it.

Update manifest and lockfile together, then verify a clean install in an isolated
environment using the intended Node/npm versions. `npm ci` installs the locked
tree and rejects manifest/lockfile disagreement; it does not select updates.
[npm ci reference](https://docs.npmjs.com/cli/v11/commands/npm-ci/).
Do not remove the user's working installation merely to demonstrate cleanliness.

For vendored files, record the exact upstream release, download source, SHA-256,
license and any local patch. Preserve self-hosted browser delivery, CSP and the
build-free app. Verify the whole Three.js addon set together. Rebuild generated
assets only when required, following existing UI approval and asset-publishing
rules. Test actual install-script policy rather than inferring it from a manifest
field. Production and offline tool trees remain separate installs.

## 4. Verification gates

Run `npm run check` for code/dependency changes, a fresh production audit, and a
review of development/offline audit reports. Use these additional gates according
to impact; a framework migration should exercise the complete multiplayer path.

| Change | Additional verification |
| --- | --- |
| Colyseus/schema/transport/SDK | Schema reflection/views, access/reconnect and save tests; real server with the shipped SDK; two-user privacy and lifecycle smoke tests; input/components/devices |
| HTTP/security/account packages | Error and permission boundaries; account browser suite; SMTP/TLS checks if mail changes; database integration when account queries change |
| PostgreSQL/client/query/migration | `npm run test:integration`; existing-data upgrade and restore on disposable copies; separate migration/runtime roles |
| Three.js/decoder/models/authoring | `npm run test:models`, components/devices/input; strict-CSP rendering, original/candidate comparisons, memory/disposal and phone/GPU checks |
| Input, DOM or layout | Respectively `test:input`, `test:components`, `test:devices`; keyboard/touch/full/compact manual checks where affected |
| Website or account page | Respectively `test:website` or `test:accounts`, plus relevant layout checks |
| Node/npm/native/image change | Clean production install and actual container startup; amd64/arm64 checks where supported; native host update path and service health |
| Documentation only | Inventory/source consistency, local links and `git diff --check`; no runtime-suite claim |

Target the production Node line in CI and test each additional line we formally
support. The app minimum is now Node 24; `.nvmrc` selects 24 for CI/development,
Docker remains on 24, and Debian/Ubuntu provisioning selects 24. Newer distro
runtimes satisfy the minimum but need separate deployment verification. A passing
helper test is insufficient when exports,
registration, protocol handling or production callers change. Existing tests using
Colyseus internal methods may need adaptation, but retain their behavior assertions.

Record command, runtime, outcome, failures/skips and remaining manual work. A
mocked reconnect or same-package decoder does not prove interoperability with the
vendored browser SDK. Automated passes do not establish gesture feel, GPU behavior,
real multiplayer privacy or recovery from a deployed failure.

## 5. Stage, release and recover

1. Test a fresh install and an upgrade using disposable copies of representative
   database/assets. Keep private data and credentials out of repository artifacts.
2. Before deployment, capture a coordinated recovery checkpoint: database, uploaded
   originals, required configuration/secrets handled securely, app version/image
   digest, and service versions. Exercise restoration rather than assuming a dump
   alone is a complete backup. Existing recovery gaps are tracked in
   [HARDENING_PLAN.md](HARDENING_PLAN.md), especially HARD-44–46.
3. For protocol changes, save active games, stop/drain sessions and deploy a
   coordinated server/client pair. Require a browser refresh; test stale cached
   clients and expired pre-restart reconnect tokens. Do not promise mixed-version
   or zero-downtime room migration without separate evidence.
4. Run a staging session long enough to exercise reconnects, saving, media loading
   and the affected subsystem; observe logs, resource use and service health. Record
   what was actually observed before release acceptance.
5. Update `CHANGELOG.md`, this inventory, relevant architecture/reference contracts
   and [RELEASING.md](RELEASING.md), including support changes and restart/refresh
   instructions. Use new numbered migrations when needed and immutable version tags.
6. Follow the release workflow only after user testing and explicit approval to
   push. Local commits are permitted; this plan supplies no push/deploy approval.

For an app-only compatible update, recovery can restore the prior app image and
matching client files, followed by restart/refresh. If data/schema/service formats
changed, validate backward compatibility or restore the matching checkpoint with
compatible service binaries. A PostgreSQL major upgrade is a separate migration;
never point an older major at a newer data directory as an assumed rollback.

## Proposed automation and initial sequence

After the manual baseline is established, configure update proposals for npm at
`/` and `/tools/model-authoring`, Docker and GitHub Actions. Dependabot supports
schedules and update groups; see its
[official options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference).
Keep framework majors separate, cap open proposals and retain human merge/release
review. Vendored files and distribution packages need an explicit review outside
those npm proposals. No automation is configured by this document.

| Order | Deliverable | Status on 2026-10-16 |
| --- | --- | --- |
| 1 | Inventory, maintenance procedure and Colyseus source assessment | Written; documentation validation recorded in the assessment |
| 2 | Reconcile Node support and add production-runtime CI coverage | Implemented: minimum/target 24, shared native gate, CI 24 and Alpine-image tests; see release notes for verification. npm patch pinning remains deferred |
| 3 | Select exact compatible Colyseus 0.18 artifacts and implement migration | Implemented locally: core 0.18.18, transport 0.18.4, schema 5.0.40, SDK 0.18.5 |
| 4 | Complete multiplayer, privacy, container and upgrade acceptance | Real-server/browser privacy/reconnect/save checks implemented; see release guide for completed local checks and remaining manual deployment/device acceptance |
| 5 | Review remaining updates in small batches; pin generation/provenance inputs | Pending fresh registry/image review |
| 6 | Enable update-discovery proposals if requested | Proposed; no bot or scheduled task enabled |
