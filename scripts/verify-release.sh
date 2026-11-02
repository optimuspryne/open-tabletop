#!/usr/bin/env bash
set -euo pipefail

# checkout must fetch full history and remote branches (fetch-depth: 0).
if [[ ! "${GITHUB_REF_NAME:-}" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  echo '::error::Stable releases require a vX.Y.Z tag; development and prerelease tags cannot publish.' >&2
  exit 1
fi

if ! git rev-parse --verify 'refs/remotes/origin/main^{commit}' >/dev/null 2>&1; then
  echo '::error::Cannot verify origin/main; fetch full history before releasing.' >&2
  exit 1
fi

if ! git merge-base --is-ancestor HEAD refs/remotes/origin/main; then
  echo '::error::The release commit must be merged into main before publishing.' >&2
  exit 1
fi
