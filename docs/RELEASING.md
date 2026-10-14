# Releasing Open Tabletop

How versions work here, and the steps to cut a release.

## Versioning

Open Tabletop follows [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`).
Because it's a self-hosted app rather than a library, treat the "public API" as
everything a self-hoster depends on to run it: the database schema and migrations,
environment variables, the compose file, and exposed ports.

- **PATCH** (`0.1.x`) — bug fixes only. No new features, nothing a self-hoster has to
  change. They pull the new image and restart.
- **MINOR** (`0.x.0`) — new, backward-compatible features. New migrations are fine as
  long as they're additive and don't break an existing database — the app applies them
  automatically on startup (see **Migrations** below), so no manual upgrade step.
- **MAJOR** (`x.0.0`) — a breaking change a self-hoster must act on: a renamed or removed
  environment variable, a required compose change, a migration with manual steps, or
  anything that breaks a running deployment on a blind `docker pull`.

While the project is pre-1.0, a minor release *may* contain breaking changes — but they
must be called out in the changelog under a clear **Breaking** note so nobody upgrades
blind.

The version lives in three places that must always agree: `package.json`, the git tag
(`vX.Y.Z`), and the Docker image tags.

## Cutting a release

Pushing a `vX.Y.Z` tag triggers **`.github/workflows/release.yml`**, which does the build,
the image push, and the GitHub release for you. So the whole hand process is now just:

1. **Update the changelog.** Move everything under `## [Unreleased]` in `CHANGELOG.md`
   into a new `## [X.Y.Z] — YYYY-MM-DD` section, and refresh the compare/release links
   at the bottom. (The workflow uses this section verbatim as the release notes, and
   **fails** if it can't find one — so this step is not optional.)
2. **Bump the version.** Set `"version"` in `package.json` and both root entries in `package-lock.json` to
   `X.Y.Z`, and pin the image
   tag in `docker-compose.yml`'s commented `image:` line (+ all `README.md` image references)
   to `:X.Y.Z`. The workflow **fails** if `package.json` doesn't match the tag, catching a
   forgotten bump.
3. **Commit + tag + push.**
   ```bash
   git commit -am "Release X.Y.Z"
   git tag -a vX.Y.Z -m "Open Tabletop X.Y.Z"
   git push && git push --tags
   ```

That's it. The workflow then builds the multi-arch image, pushes
`optimuspryne/open-tabletop:X.Y.Z` **and** `:latest`, and creates the GitHub release from the
tag with the changelog section as its notes. (Custom Postgres image is retired — one app image
only; deployments run stock `postgres` and the app migrates its own schema, see **Migrations**.)

### One-time CI setup

The release workflow needs Docker Hub credentials, added under **repo → Settings → Secrets and
variables → Actions**:

- **`DOCKERHUB_USERNAME`** — your Docker Hub username, which is also the image namespace
  (`optimuspryne`). Fork-friendly: the workflow pushes to `<username>/open-tabletop`.
- **`DOCKERHUB_TOKEN`** — a Docker Hub **access token** (Account → Security) with read/write on
  the repository. Use a token, not your password.

`.github/workflows/ci.yml` runs `npm run check`, browser input/component suites, the production
dependency audit and PostgreSQL integration tests on pushes to `main` and pull requests.

## Migrations

Schema changes are numbered SQL files in `postgres/` (`NNN_name.sql`). The app applies
them itself on startup: `migrate.js` runs any file not yet recorded in the
`schema_migrations` table, in order, as the owner role via `MIGRATE_DATABASE_URL` (never
the app's least-privilege `DATABASE_URL`). Shipping a schema change is just:

1. Add `postgres/0NN_whatever.sql` (wrap it in `BEGIN;`/`COMMIT;` like the others).
2. *Optionally* fold it into `postgres/schema.sql` (the fresh-install baseline) and add
   its filename to that file's `schema_migrations` seed — this keeps a brand-new install
   from replaying it. Not required: if you skip it, a fresh install simply applies the
   file on first boot.
3. Add a changelog line if it's user-visible.

No manual `psql -f`, and **no db-image rebuild required** — existing deployments pick it
up on their next `docker compose pull && up`. A deployment can opt out with
`AUTO_MIGRATE=false` (or by leaving `MIGRATE_DATABASE_URL` unset) and migrate by hand.

## Upgrading to 0.22.0

From 0.21.1, pull the updated image and recreate the app container, then refresh all
browsers. Source installs should run `npm ci` before restarting for the refreshed locked
dependencies. No new numbered migration, snapshot conversion, required environment variable,
service, exposed port or Compose setting is introduced. Existing accounts, assets and saved
games remain compatible. Upgrades from older versions must also follow their notes below.

This release adds bundled bridge-card artwork and selectable backs, authored Domino/Mahjong
tiles and appearance controls, 136/144-tile Mahjong walls and starters, assisted independent
stacking, 3D tile hand previews and player fans, proportional actual-card backs in player fans,
desktop hand actions, updated Wordy/pouch and other piece models, ceramic tile sounds, and
High/Ultra graphics improvements. Mahjong wall breaking, rolling and taking tiles remain
manual; no rule or scoring automation is added. High now renders at a fixed 2× pixel ratio;
Ultra is an explicit per-device choice rendering at 4× per axis. Check performance on the
target devices.

For existing Wordy rooms, reselect the board and recalibrate its height/grid, or load the
Wordy starter in a fresh game. Old Mahjong peony/lotus identities keep image fallbacks;
standard 136-tile sets and optional 144-tile sets use the new authored models. Hard-refresh
if cached artwork or sounds remain. Python/ffmpeg is needed only to regenerate audio offline.

The hardening walkthrough and room-scaling documents describe findings and proposed work;
they do not represent implemented security fixes, multi-instance support or new deployment
requirements. See [the hardening plan](../HARDENING_PLAN.md) for current status.

### Release preparation and verification

Release metadata and image references are prepared locally for 0.22.0. No tag, push, image
publication or GitHub release is part of this preparation. Validation on 2026-10-14:

- `npm run check`: passed lint, formatting, CSS checks and all 1,029 tests.
- `npm run test:input`: passed all 58 checks.
- `npm run test:integration`: passed all 25 tests against disposable PostgreSQL.
- `npm run audit`: passed with zero production dependency vulnerabilities.
- `npm run test:components`: passed desktop/touch component checks, notecard editor checks
  at 1280/390/360 px, and tile preview/mixed-back/restricted-Show checks at 1280/390/320 px.
  The existing component fixture still reports ten Mahjong thumbnail 404 paths; this is not
  evidence that those thumbnail routes were verified successfully.
- `npm run test:devices`: passed all seven documented profiles.
- `npm run test:website`: passed all 25 page/viewport checks.
- `npm run test:accounts`: passed all six full/compact desktop/touch layouts.
- Version/image consistency, historical changelog preservation, workflow release-note
  extraction, local documentation file links and `git diff --check`: passed.

The sandbox blocked local HTTP, Docker and advisory-service access; the affected suites were
rerun outside it. The restricted full-check attempt was stopped after the unrestricted run
passed. Real-device gesture feel, GPU performance, multiplayer behavior, container/multi-arch
builds and deployed upgrade acceptance remain separate manual or release-pipeline checks.

After restarting the server and refreshing clients, smoke-test:

1. Spawn blue/red 52/54-card decks, Dominoes and both Mahjong sets; inspect, play, return,
   recolor, save/reload and reconnect. Check concealed hands and restricted Show with two users.
2. Build 136/144-tile walls, load both Mahjong starters, and gently stack cards/tiles. Check
   occupied-wall rejection, offset cards remaining separate, and centered deck returns.
3. Check private-hand actions, Drop Hand choices, 3D tile previews and mixed-back player fans
   in full/compact desktop and touch layouts, including keyboard focus.
4. Reselect/recalibrate an existing Wordy board; check pouch appearance, tile sounds and
   High/Ultra rendering on representative devices.

## Upgrading to 0.21.1

From 0.21.0, pull the updated image and recreate the app container. No new migration,
dependency, environment variable, port or Compose change is required. This server-only fix
does not require a browser refresh.

Startup now checks whether any user exists before reading bootstrap settings or the password
file. Existing installations can retain those settings even when the first-boot file is missing.
Empty databases still validate configured bootstrap credentials; database lookup failures still
stop startup. If users exist but none is an administrator, recover access through
`npm run admin:grant -- <username-or-email>`.

For Compose stacks containing inline configs, prefer stack deployment with image pulling over
individual container updates so Compose recreates all generated config files. This patch
removes the bootstrap-file dependency for existing users; it does not restore other lost files.

Validation: `npm run check` passed 933 tests and `npm run test:integration` passed 25 tests,
including an ordinary existing user with a missing bootstrap password file. Live Dockhand
update verification remains pending. Upgrades from before 0.21.0 must also follow its notes below.

## Upgrading to 0.21.0

From 0.20.0, startup applies one additive migration:

| Migration | Purpose | Existing data |
| --- | --- | --- |
| `023_account_recovery.sql` | Email verification, expiring recovery tokens and single-use recovery codes | Adds account fields and recovery tables; existing accounts, assets and saved games are preserved. Existing email addresses remain unverified until explicitly verified. |

Back up the database and uploaded assets before upgrading. Keep the existing separate
migration-role connection configured, restart the server, then refresh all browsers.
If automatic migration is disabled, apply pending numbered migrations with the schema-owner
connection before starting 0.21.0. Fresh installs use the updated schema baseline.
Source installs should run `npm ci` before restart for the locked dependencies, including
Nodemailer; Docker images include them. No snapshot conversion, required new service,
required environment variable or exposed port is introduced.

Email verification and recovery are optional. Existing deployments can continue without SMTP;
users can generate and save recovery codes through Account security. To enable email, configure
`PUBLIC_ORIGIN` and the SMTP settings described in [Account security](ACCOUNT_SECURITY.md).
Docker deployments enabling SMTP must forward these optional variables and mount the password
file via a Compose override. Merely adding variables to `.env` does not forward them through an
older Compose file. Invalid or incomplete configured SMTP settings fail startup.

This release includes GM object concealment, manual map fog with adjustable thickness,
piece reveal auras, account security/recovery, native Linux installation and recovery tools,
and the standalone public website. It also fixes room admission/save ownership, unsafe asset
serving and HTML injection in action menus. Restarting and refreshing clients loads both the
server protections and browser fixes. The website is deployed separately from the game server.

User-reported gameplay and account/SMTP checks are recorded in the feature documentation.
Live native Linux distro installation, reboot, uninstall/purge and recovery acceptance remains
pending; automated installer fixtures do not establish live-host behavior. Public website
publishing and user acceptance remain pending. Demo dice safeguards and room worker isolation
are future plans, not functionality in this release.

When upgrading from before 0.20.0, also follow the earlier upgrade notes below and apply all
pending migrations in order.

## Upgrading to 0.20.0

From 0.19.0, startup applies one additive migration:

| Migration | Purpose | Existing data |
| --- | --- | --- |
| `022_notecard_templates.sql` | Account-owned private/shared notecard templates | Adds a new table; existing assets, accounts and saved games are preserved. |

Restart the server with the existing migration-role connection configured, then refresh all
browsers for the new notecard tools and Library layout. When automatic migration is disabled,
apply pending numbered migrations using the schema-owner connection before starting 0.20.0.
Fresh installs use the updated schema baseline. No scene/game snapshot conversion, new service,
environment variable or exposed port is required. Source installs should run `npm ci` before
restart; Docker images include the locked dependencies.

Existing custom tile assets move to the Library's Tiles section automatically; no reimport is
needed. Notecard templates are under Boards, Mats & Notecards. Only Helpers, GMs and room owners
can send notecards privately; regular active players can receive them and use their own editor,
hand and table placement.

When upgrading from a version older than 0.19.0, also follow the earlier upgrade notes below,
including the existing portable asset-package limits and reverse-proxy guidance.

## Upgrading to 0.19.0

From 0.18.0, startup applies these additive migrations in order:

| Migration | Purpose | Existing data |
| --- | --- | --- |
| `018_room_participation.sql` | Durable GM time-outs | Existing members remain unrestricted. |
| `019_spectator_mode.sql` | Durable player/spectator choice | Existing members remain players; time-outs are preserved. |
| `020_asset_collections.sql` | Shared custom asset collections | Existing assets remain unchanged and uncollected. |
| `021_user_placards.sql` | Account placard appearance | Accounts receive the default masculine/gradient preset; avatars are preserved. |

Restart the server with the existing migration-role connection configured, then refresh all
browsers for the appended player fields and new controls. When automatic migration is disabled,
apply any pending numbered migrations using the schema-owner connection before starting 0.19.0.
Fresh installs use the updated schema baseline. No scene/game snapshot conversion, new service,
environment variable, exposed port or runtime grant is required.

Source installs should run `npm ci` to install the updated locked dependencies before restart.
Docker images include those dependencies. Python/ffmpeg is only used to regenerate bundled tile
sounds offline and is not required to run the application.

Portable asset exports use `.ott.zip`; earlier `.ott.json` packages remain importable. Each
package supports up to 64 assets, 5,000 cards/tiles, 4,096 images and 512 MiB of original files,
with a 544 MiB transfer ceiling and 32 MiB per image. Allow sufficient temporary disk space and,
if large packages are needed, a matching upload limit on `/asset-packages` in the reverse proxy.
Only one package operation runs at a time per server process. Imports create separate private
copies, preserving existing assets. Saved dispenser definitions are included; scene ZIP exports
and live player data are outside the portable format.

### Deployment verification

On 2026-09-25, the project owner reported successful 0.19.0 deployment tests via Docker,
bare metal and Proxmox, with asset-pack uploads also working successfully. This records
manual verification of those deployment and upload scenarios.

## Rules that keep the guarantees honest

- **Never re-push a version tag.** Once `:X.Y.Z` is pushed, those bits are frozen. A fix
  means a new version number, never a re-push of an existing one.
- **`:latest` is for trying it out, not production.** Tell users to pin `:X.Y.Z` in their
  own compose.
- **Every user-visible change earns a changelog line.** Pre-1.0 is not a license for
  silent breakage.
