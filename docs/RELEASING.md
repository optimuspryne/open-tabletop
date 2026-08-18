# Releasing Open Tabletop

How versions work here, and the steps to cut a release.

## Versioning

Open Tabletop follows [Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`).
Because it's a self-hosted app rather than a library, treat the "public API" as
everything a self-hoster depends on to run it: the database schema and migrations,
environment variables, the compose file, and exposed ports.

- **PATCH** (`0.1.x`) — bug fixes only. No new features, nothing a self-hoster has to
  change. They pull the new image and restart.
- **MINOR** (`0.x.0`) — new, backward-compatible features. New migrations are allowed
  only if they auto-apply and don't break an existing database.
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
4. **Build and push the images** — multi-arch, an immutable version tag plus the moving
   `latest`:
   ```bash
   docker buildx build --platform linux/amd64,linux/arm64 \
     -t optimuspryne/open-tabletop:X.Y.Z \
     -t optimuspryne/open-tabletop:latest \
     --push .
   ```
   Rebuild the db image the same way **only if** the schema or init scripts changed,
   tagging it with the same `X.Y.Z`.
5. **Pin the compose file.** Update `docker-compose.yml` to reference `:X.Y.Z` (not
   `:latest`) so `git checkout vX.Y.Z && docker compose up` brings up a matching stack.
6. **Cut the GitHub release** from the `vX.Y.Z` tag and paste that version's changelog
   section into the notes.

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
