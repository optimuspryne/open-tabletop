# Dependency inventory

Baseline reviewed: **2026-10-16**, app version **0.22.0**. This is a snapshot of
repository declarations and locked artifacts, not a claim that every package is
current or free of vulnerabilities. The coordinated Colyseus upgrade below was
implemented locally after the original inventory review; rollout remains unpushed.
See the [maintenance plan](MAINTENANCE_PLAN.md) for the update process and the
[Colyseus 0.18 assessment](COLYSEUS_018_ASSESSMENT.md) for the first proposed upgrade.

## Sources of truth and scope

- Root [package.json](../package.json) declares application/runtime and development
  packages; [package-lock.json](../package-lock.json) records their resolved tree
  (253 non-root package entries, including platform-specific optional packages).
- The separate [model-authoring manifest](../tools/model-authoring/package.json)
  and [lockfile](../tools/model-authoring/package-lock.json) record 266 non-root
  entries. These are offline tools excluded from the production image.
- Browser libraries are committed files under `public/vendor/`; root npm commands
  do not update them. Asset licenses/sources remain in [ASSET_CREDITS.md](ASSET_CREDITS.md).
- Containers, CI actions, native host packages and regeneration tools have their
  own version boundaries below. Exact deployed image digests, host package versions
  and browser versions must be captured from the deployment during maintenance.
- Bundled artwork, fonts used during authoring, models and sounds are tracked by
  the asset credits and authoring guides, rather than treated as npm dependencies.
  The companion Blender asset workspace is outside this application inventory.

## Application runtime packages

Versions below come from the root lockfile, not `node_modules`. The maintenance
owner is the maintainer of the consuming subsystem; the release maintainer
coordinates packages spanning several subsystems.

| Package | Declared range | Locked version | Responsibility / update group |
| --- | --- | --- | --- |
| `@colyseus/core` | `0.18.18` | `0.18.18` | Rooms, matchmaking and synchronization; multiplayer group |
| `@colyseus/schema` | `5.0.40` | `5.0.40` | Reflected state and per-client views; multiplayer group |
| `@colyseus/ws-transport` | `0.18.4` | `0.18.4` | WebSocket transport; multiplayer group |
| `cannon-es` | `^0.20.0` | `0.20.0` | Server physics; geometry/physics group |
| `convex-hull` | `^1.0.3` | `1.0.3` | Physics hull generation; geometry/physics group |
| `express` | `^4.19.2` | `4.22.3` | HTTP routes and static serving; HTTP/security group |
| `helmet` | `^7.2.0` | `7.2.0` | Security headers and enforced CSP; HTTP/security group |
| `nodemailer` | `^10.0.12` | `10.0.14` | Optional recovery email; account-security group |
| `pg` | `^8.23.0` | `8.23.1` | PostgreSQL client; persistence group |
| `redis` | `^5.12.1` | `5.12.1` | Shared rate-limit store; admission/security group |
| `sharp` | `^0.35.4` | `0.35.5` | Media validation/derivatives; asset group |
| `yauzl` | `^3.4.0` | `3.4.0` | Portable asset ZIP reading; asset-package group |
| `yazl` | `^3.3.1` | `3.3.1` | Portable asset ZIP writing; asset-package group |

The application Redis client is not a Colyseus Redis presence/driver adapter.
Multi-instance room routing remains separate proposed work in
[PLAN_ROOM_WORKERS.md](PLAN_ROOM_WORKERS.md).

### Overrides and native code

- Root `overrides.qs` pins **6.16.0**. The historical changelog records
  GHSA-x5fp-wj9c-mxmx and GHSA-4mjr-xmp4-gh2g as its reasons. Recheck upstream
  dependency ranges and advisories before removing it; a parent upgrade alone
  does not establish that the override is obsolete.
- Root `allowScripts` contains `msgpackr-extract@3.0.4: true`; the locked package
  has an install script. Preserve/review this configuration and verify the chosen
  npm version's actual script policy. The field alone is not evidence that all
  install scripts are blocked. Docker/native installs currently run ordinary
  `npm ci --omit=dev`; the audit CI job uses `--ignore-scripts`.
- Sharp and optional MessagePack native acceleration require installation and
  runtime checks on supported image architectures. Lockfile entries for unused
  platforms do not mean those binaries are installed everywhere.

## Development packages

| Package | Declared range | Locked version | Responsibility |
| --- | --- | --- | --- |
| `@eslint/js` | `^10.0.1` | `10.0.1` | JavaScript lint rules |
| `eslint` | `^10.9.1` | `10.12.0` | Lint runner and configuration compatibility |
| `globals` | `^17.11.0` | `17.13.0` | Lint environment globals |
| `prettier` | `^3.9.6` | `3.9.9` | Formatting |

Keep formatting/lint changes separate from gameplay changes. Browser suites use
an externally installed Chrome/Chromium through
[headless.mjs](../scripts/lib/headless.mjs), rather than a browser npm package.

## Browser and generated dependencies

| Artifact | Recorded baseline | Update requirements |
| --- | --- | --- |
| [colyseus.js](../public/vendor/colyseus.js) | SDK `0.18.5`, embedded schema `5.0.8`; UMD global `Colyseus`; [provenance](../public/vendor/colyseus-README.md) | Select compatible server/schema/SDK releases together; retain self-hosting, license, reflection and strict-CSP behavior |
| [Three.js](../public/vendor/three/three.module.js) and `addons/` | Core revision `161` (`0.161.0`); addons are a committed companion set | Replace/review core and required addons as one set; test rendering, loaders, controls, resource disposal and authored models; core header alone does not independently authenticate every addon |
| [meshoptimizer decoder](../public/vendor/meshoptimizer/README.md) | `meshoptimizer@0.24.0`, reference JavaScript decoder | Preserve trusted-bundled-model boundary and non-WASM CSP compatibility; test decoder/exporter compatibility and phone cold loading |
| [Tabler sprite generator](../scripts/build-icons.mjs) | Upstream `REF = 'main'`; generated SVGs and MIT license committed | Pin a reviewed upstream release before future regeneration; no exact upstream release can be inferred from `main`. UI/icon changes retain the normal mock-up and approval requirements |

SHA-256 baselines (the Three.js digest covers the core file only):

```text
colyseus.js: 96557215f2411918b1eed792ed99983ff3df129cf9512fa12a0faf89a11410f4
three.module.js: e7348ab8c7bf7a41f7afc5fe503c20a0ed090d9536aacf1ee975d7aaee24d394
meshopt_decoder_reference.js: 2fad1a37ec276ddd0e1eaa1b389f2fcb1d57d684cbcb38de4116a95ba8925ef3
```

## Offline model-authoring packages

All declarations are exact pins in `tools/model-authoring/package.json` and agree
with that directory's lockfile. They do not need to match the app's runtime Sharp
version. See the [authoring guide](../tools/model-authoring/README.md).

| Package | Declared and locked version |
| --- | --- |
| `@gltf-transform/cli` | `4.2.1` |
| `@gltf-transform/core` | `4.2.1` |
| `@gltf-transform/extensions` | `4.2.1` |
| `@gltf-transform/functions` | `4.2.1` |
| `gltf-validator` | `2.0.0-dev.3.10` |
| `meshoptimizer` | `0.24.0` |
| `three` | `0.161.0` |
| `sharp` | `0.34.5` |

Updates must repeat lossless geometry/image and strict-CSP browser comparison
against representative originals before publishing assets. Do not recompress the
catalog or alter Blender masters as incidental dependency cleanup.

## Runtimes, services and delivery tools

| Surface | Repository baseline | Maintenance concern |
| --- | --- | --- |
| App manifest | Node `>=24`; [.nvmrc](../.nvmrc) selects major `24`; npm version not pinned | Production/development target is 24; newer distro runtimes require deployment verification |
| Development tooling | Locked ESLint accepts Node 20.19+ on 20.x, 22.13+ on 22.x, or >=24; headless harness uses Node's global WebSocket | Runtime support and contributor-tool requirements need explicit separate documentation |
| [Dockerfile](../Dockerfile) | `node:24-alpine`, production `npm ci` | Floating tag; record exact base digest, Node/npm and Alpine versions for a release |
| [CI](../.github/workflows/ci.yml) | Node `24` via `.nvmrc`, `ubuntu-latest`, runner Chrome; PostgreSQL `16-alpine`; built Alpine-image tests | Capture exact runtime/browser versions; hosted workflow execution and arm64 verification remain separate |
| [Compose](../docker-compose.yml) | `postgres:16-alpine`, `redis:7-alpine`; app example `0.22.0` | Floating service images; test patches/rebuilds, plan PostgreSQL major upgrades separately |
| [Native installer](../proxmox/install.sh) | Fresh Debian/Ubuntu installs use NodeSource `node_24.x`; installed service runtime must be major `>=24` | Upgrade rejects older service runtimes before backup/activation; Fedora/Arch retain distribution packages and Valkey |
| Native PostgreSQL | Proxmox installs PostgreSQL 16; Linux host profile uses distribution `postgresql` | Capture host versions and upgrade/restore requirements per deployment |
| CI actions | `actions/checkout@v4`, `actions/setup-node@v4` | Review action updates separately; tags are not immutable SHA pins |
| [Release actions](../.github/workflows/release.yml) | `docker/setup-qemu-action@v3`, `docker/setup-buildx-action@v3`, `docker/login-action@v3`, `docker/build-push-action@v6` | Build/publish amd64 and arm64; runner supplies Docker/Buildx/QEMU and `gh` |
| Native installation tools | Bash/systemd, Git, tar, curl, OpenSSL, distro package managers; GnuPG/APT setup where used | Host-managed dependencies; deployment inventory must record actual packages |
| Audio regeneration | Python standard library plus ffmpeg/libvorbis | Offline-only; versions are not pinned in a Python manifest |
| Model/browser QA | Node `>=24` for authoring, local Chrome/Chromium | Browser executable is external; record version and device profiles |

## Initial maintenance queue

1. Runtime alignment is implemented in source: minimum Node 24, `.nvmrc`/CI and
   Docker target 24, fresh Debian/Ubuntu provisioning selects 24, and native updates
   enforce the minimum. Node/npm patch pins remain separate work. See the
   [runtime upgrade notes](RELEASING.md#0230-node-runtime-alignment) for
   validation and remaining hosted/native/container acceptance.
2. Colyseus 0.18 is implemented locally as one server/schema/browser upgrade.
   Exact stable versions, peer constraints, transitive changes and acceptance limits
   are recorded in the linked upgrade record. Schema `defineTypes` deprecation is
   future maintenance; existing JS reflection remains supported and tested.
3. Establish exact provenance/checksums for future vendored releases, including
   the Three.js addon set; pin Tabler regeneration input.
4. Run fresh outdated/advisory reviews for both npm trees and deployed images.
   The original sandboxed registry query failed with DNS `EAI_AGAIN`; subsequent
   authorized registry access verified the selected Colyseus releases. The upgrade
   production/full audits passed with zero vulnerabilities; unrelated packages have
   not all received a fresh latest-version/migration assessment.
5. Consider proposed update-discovery automation after the manual process is in use.
   No scheduled job, bot configuration or auto-merge was enabled here.
