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

## Rules that keep the guarantees honest

- **Never re-push a version tag.** Once `:X.Y.Z` is pushed, those bits are frozen. A fix
  means a new version number, never a re-push of an existing one.
- **`:latest` is for trying it out, not production.** Tell users to pin `:X.Y.Z` in their
  own compose.
- **Every user-visible change earns a changelog line.** Pre-1.0 is not a license for
  silent breakage.
