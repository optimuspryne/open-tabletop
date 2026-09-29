# Wiki accuracy audit

Reviewed September 29, 2026 against working source based on commit
`54c12d0d87f3ca7e466aa75426f79c035dc789fa`, including the existing uncommitted website.
All 17 wiki articles and their sections were reviewed. This is a documentation/source review,
not a claim that every installation and gameplay procedure was performed on a live server.

## Method and evidence

Read the complete changelog, the README, account/security and release instructions, and the
wiki content. Surveyed the documentation corpus listed below, including implementation-status
checkpoints and historical plans. Cross-checked relevant architecture/reference contracts,
gestures and device notes with current markup, handlers, configuration and installer scripts.
Historical changelog entries and proposed features were not treated as current UI instructions.

Code discovery used the Tier 2 graph at generation `2026-09-28T21:30:17Z`, then exact snippets,
caller traces and direct source reads. Final coverage used generation `2026-09-29T14:06:02Z`.
Coverage was checked for implementation evidence paths
and the docs/wiki scopes. The table markup, grants SQL and several wiki pages had partial parser
coverage; their relevant source and reported ranges were read directly. Package-lock metadata
was not tracked by the graph, so dependency engine declarations were read directly. A clean
graph coverage result is not proof of completeness.

Every article now links to its specific source files and records the review date. Remote `main`
links can advance independently of this audit; this record identifies the local baseline.

## Page-by-page results

| Page | Sections checked and resulting changes | Primary implementation evidence |
| --- | --- | --- |
| `wiki/index.html` | Orientation, scope, installation paths, versions, unavailable demo. Explicitly distinguish Unreleased recovery/concealment/fog/Linux installer from pinned 0.20.0. | `CHANGELOG.md`, `docs/ROADMAP.md`, `package.json` |
| `wiki/first-game.html` | Account/join, hosting, admission, setup, play and save. Add role restrictions, room-code location and starter replacement consequences. | `public/landing.js`, `server/http/routes/rooms.js`, `public/client.js`, `server.js` |
| `wiki/docker.html` | Fresh-install commands, bootstrap, volumes, migrations, published image and admin recovery. Put secret-file access instructions before startup and link explicit Compose overrides. | `docker-compose.yml`, `Dockerfile`, `server/bootstrap-admin.js` |
| `wiki/node.html` | Reorder source/dependencies, role/database grants, configuration, bootstrap, startup and storage. Include future-table privileges and avoid the copied partial-bootstrap startup failure. Use Node 24, matching the container, rather than assuming the package's 20.9 engine floor covers all current CLI/tool requirements. | `package.json`, `package-lock.json`, `postgres/grants_app_role.sql`, `migrate.js`, `server/database-config.js`, `server/bootstrap-admin.js` |
| `wiki/linux.html` | Distro checks, source selection/archive, users, storage, environment, update and acceptance limits. Replace development-only phrasing and require saving/leaving before update backups. | `linux/open-tabletop.sh`, `proxmox/install.sh` |
| `wiki/proxmox.html` | Host/LXC requirements, source pinning, networking retry, credentials, NFS identity and update. Correct automatic CTID selection, remove stale "after this code is pushed", and make update revision selection explicit. | `proxmox/open-tabletop.sh`, `proxmox/install.sh` |
| `wiki/portainer.html` | Stack variables/YAML, roles, configs, bootstrap, masks, NFS and legacy-config fallback. Clarify safe characters for passwords interpolated into SQL/URLs and explicit SMTP forwarding/version requirements. | `README.md`, `Dockerfile`, `server/database-config.js`, `server/bootstrap-admin.js`, `docker-compose.yml` |
| `wiki/configuration.html` | Environment locations, values, migrations, Redis and restarts. Add missing Compose forwarding for proxy/session/migration options; specify proxy range and explicit memory-store exception. | `.env.example`, `docker-compose.yml`, `server/*-config.js`, `server/rate-limit.js`, `proxmox/install.sh` |
| `wiki/accounts.html` | Quick join, hosting, roles, participation, password/recovery, CLI promotion. Distinguish setting a password from host approval, current password limits, owner-only GM role changes and native CLI environment loading. Promotion is not password recovery. | `server/permissions.js`, `server/http/routes/rooms.js`, `public/landing.js`, `server/bootstrap-admin.js`, `scripts/admin-role.mjs`, `docs/ACCOUNT_SECURITY.md` |
| `wiki/email.html` | SMTP variables, TLS behavior, file contents, bare-metal/Compose setup, enrollment and reset. Add native systemd environment instructions, file readability and Unreleased/023 qualification. | `server/recovery-mail.js`, `docker-compose.yml`, `proxmox/install.sh`, `docs/ACCOUNT_SECURITY.md` |
| `wiki/networking.html` | LAN/proxy/WebSocket path, trust, origin, troubleshooting. Link required Compose forwarding and document package request-size/temp-space requirements. | `server/redis-config.js`, `docker-compose.yml`, `docs/RELEASING.md` |
| `wiki/controls.html` | Camera, held pieces, cards/decks, private hand, selection and keyboard access. Clarify card keyboard menus, sorting only in Rearrange, contextual camera keys, highlights, labels and hidden controls under the expanded touch hand. | `docs/GESTURES.md`, `public/table.html`, `public/table/input-router.js`, `public/table/piece-ui.js`, `public/table/table-shell.js` |
| `wiki/pieces.html` | Dice, cards, props, boards/grids, notecards, concealment and tools. Replace broad feature descriptions with actual action paths; add browsing, template ownership/passing, stack limits, fog/aura controls, public tiles, and transient tool-state boundaries. | `public/table.html`, `public/table/piece-ui.js`, `public/table/trays.js`, `public/table/notecard-templates.js`, `server/game/notecards.js`, `server/game/handlers/room-state.js`, `docs/GESTURES.md`, `docs/REFERENCE.md` |
| `wiki/assets.html` | Library access/filtering, all upload forms, edit/publish, save/load scenes, collections/packages. Retain verified upload instructions, add the template exception, all category names, exact export scope, and scene replacement/omission details. | `public/editor/editor-panel.js`, `public/table.html`, `server/game/handlers/library.js`, `server/game/scene-persistence.js`, `docs/REFERENCE.md` |
| `wiki/saving.html` | Checkpoint, autosave, return/reassignment, scenes and backups. Detail durable confirmation, account/tab identity, session-only tools, omitted scene settings, and reset/starter/load clearing hands and checkpoints. | `server.js`, `server/game/scene-persistence.js`, `server/game/handlers/room-state.js`, `docs/ARCHITECTURE.md` |
| `wiki/maintenance.html` | Backup scope, update methods, migrations, rollback and smoke checks. Add the older Compose secret migration path; retain source/release migration distinction and separate asset backup. | `docs/RELEASING.md`, `CHANGELOG.md`, `proxmox/install.sh`, `README.md` |
| `wiki/troubleshooting.html` | Startup, connection, Redis, admin/recovery, assets and hands. Add role/participation/filter checks, piece/notecard limits, package failures and Compose forwarding/secret access. | Same implementation evidence as the corresponding guides; `SECURITY.md` for private reporting |

## Documentation corpus considered

- `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `AGENTS.md`, and
  `secrets/README.md`: installation, release history, contribution/verification rules,
  reporting and secret handling. No secret-file contents were read.
- `docs/ACCOUNT_SECURITY.md`, `docs/RELEASING.md`, `docs/GESTURES.md`,
  `docs/DEVICE_MATRIX.md`, `docs/DEVICE_QA.md`: current setup/interaction requirements and
  boundaries between automated coverage and manual acceptance.
- `docs/ARCHITECTURE.md`, `docs/REFERENCE.md`: relevant permissions, library, persistence,
  account, notecard, input, deployment and fog contracts.
- `docs/ROADMAP.md`, `docs/DESIGN_next_features.md`, `docs/DESIGN_future_backlog.md`,
  `docs/DESIGN_concealment.md`, `docs/DESIGN_notecards.md`,
  `docs/DESIGN_placards_sounds.md`, `docs/EASY_WINS.md`: compare proposed work with subsequent
  implementation checkpoints. Older labels and plans do not override current controls.
- `docs/CLIENT_REFACTOR.md`, `docs/DRY_CLEANUP.md`: identify relocated behavior and distinguish
  historical module plans from current source; these are not new gameplay features.
- `docs/ASSET_CREDITS.md`: retain mixed-license attribution instead of treating all bundled art
  as CC0. `docs/licenses/tabler-icons-LICENSE` remains the linked upstream license text.
- `docs/SECURITY_AUDIT_2026-09-28.md`: distinguish the preserved original findings from the
  completed remediation and its reported verification. No new security certification is made.

## Changed files and implementation scope

This audit changes all 17 `wiki/*.html` files listed above, `website/README.md`, this audit
record, `README.md`, `CHANGELOG.md`, `docs/GESTURES.md`, `docs/ARCHITECTURE.md`, and
`docs/REFERENCE.md`. Existing website structure, styles, assets and test helpers are reused.
No production functions/helpers, routes, permissions, gameplay, schema or deployment behavior
were added, changed or removed. Historical changelog entries are preserved.

The supporting README corrects the old Save Table State/right-click-shuffle language,
password-versus-host distinction, initial setup order and Compose configuration caveats.
The gesture guide corrects the obsolete Interactions menu path to Seat. Architecture and
reference notes link this review without changing implementation contracts.

## Verification and limits

- `node test/website.js`: both static suites passed across the landing page and all 17 guides;
  local links/fragments, metadata, inactive demo, and absence of em/en dashes checked.
- Browser harness expanded temporarily to all 18 pages at 1440px mouse, 760px mouse, 1024px
  touch, 390px touch and 320px touch: 90 checks passed, including navigation visibility,
  keyboard disclosure, no page overflow, loaded images and no browser errors/missing assets.
- Syntax-only checks passed for 25 fenced shell examples and four YAML examples. All 70
  source-footer links resolve to files in this checkout. These checks do not execute installs.
- `git diff --check` passed. No runtime suite was required for documentation-only changes.

No new Linux/Proxmox/Compose installation, SMTP delivery, live multiplayer scenario,
physical-device gesture or complete backup restoration was performed in this audit. Existing
manual acceptance recorded in project docs remains separate. Refresh the website to read the
updates; the app does not need a restart. No commit, push or publication was performed.
