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

1. **Update the changelog.** Move everything under `## [Unreleased]` in `CHANGELOG.md`
   into a new `## [X.Y.Z] — YYYY-MM-DD` section, and refresh the compare/release links
   at the bottom.
2. **Bump the version.** Set `"version"` in `package.json` to `X.Y.Z`, then commit both
   files: `git commit -am "Release X.Y.Z"`.
3. **Tag it.** `git tag -a vX.Y.Z -m "Open Tabletop X.Y.Z"`, then `git push && git push --tags`.
4. **Build and push the app image** — multi-arch, an immutable version tag plus the moving
   `latest`:
   ```bash
   docker buildx build \
     -t optimuspryne/open-tabletop:X.Y.Z \
     -t optimuspryne/open-tabletop:latest \
     --push .
   ```
   There's just the one image now — the custom Postgres image is retired (deployments use
   stock `postgres`; the app builds and migrates its own schema, see **Migrations**).
5. **Pin the compose file.** Update `docker-compose.yml` to reference `:X.Y.Z` (not
   `:latest`) so `git checkout vX.Y.Z && docker compose up` brings up a matching stack.
6. **Cut the GitHub release** from the `vX.Y.Z` tag and paste that version's changelog
   section into the notes.

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

## Rules that keep the guarantees honest

- **Never re-push a version tag.** Once `:X.Y.Z` is pushed, those bits are frozen. A fix
  means a new version number, never a re-push of an existing one.
- **`:latest` is for trying it out, not production.** Tell users to pin `:X.Y.Z` in their
  own compose.
- **Every user-visible change earns a changelog line.** Pre-1.0 is not a license for
  silent breakage.

## Later: automate it

Once these steps feel routine, a GitHub Actions workflow triggered on `v*` tags can build
and push both images and create the GitHub release automatically — leaving `git tag` as
the only thing you do by hand. Worth setting up after a few hand-cut releases, when you
know the shape of it.
