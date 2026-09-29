#!/usr/bin/env bash
# Run on the target Linux host; shares the native installer with Proxmox.

usage() {
  cat <<'EOF'
Usage: sudo bash linux/open-tabletop.sh [install|update|reinstall|resume|uninstall|purge] [--dry-run]
uninstall preserves data/configuration; purge requires typed confirmation and retains backups.
--dry-run is available for uninstall/purge. Removal uses a local installer without fetching source.
reinstall/resume reuse existing installer state and credentials; neither resets the database.
Supported: Debian 12/13, Ubuntu 22.04/24.04/26.04 LTS, Fedora, Arch Linux.
Requires a running systemd host. Arch installation performs a full pacman -Syu.
Optional environment: SOURCE_REPO SOURCE_REF SOURCE_ARCHIVE
                      BOOTSTRAP_ADMIN_USERNAME BOOTSTRAP_ADMIN_EMAIL
Defaults: https://github.com/optimuspryne/open-tabletop.git, main, admin
SOURCE_ARCHIVE uses a trusted local git archive instead of downloading source.
EOF
}

fail() {
  printf 'Open Tabletop: %s\n' "$*" >&2
  exit 1
}

prepare_source() {
  if [[ -n ${SOURCE_ARCHIVE:-} ]]; then
    [[ -f "$SOURCE_ARCHIVE" ]] || fail "Source archive not found: $SOURCE_ARCHIVE"
    archive=$(realpath -e -- "$SOURCE_ARCHIVE")
  else
    command -v git >/dev/null || fail 'Install git first, or set SOURCE_ARCHIVE'
    SOURCE_REPO=${SOURCE_REPO:-https://github.com/optimuspryne/open-tabletop.git}
    SOURCE_REF=${SOURCE_REF:-main}
    [[ "$SOURCE_REF" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/-]*$ ]] || fail 'Invalid SOURCE_REF'
    git -C "$temp_dir" init --quiet
    git -C "$temp_dir" remote add origin "$SOURCE_REPO"
    git -C "$temp_dir" fetch --depth=1 origin "$SOURCE_REF"
    archive="$temp_dir/open-tabletop-source.tar"
    git -C "$temp_dir" archive --format=tar --output="$archive" FETCH_HEAD
    printf 'Using repository commit %s\n' "$(git -C "$temp_dir" rev-parse FETCH_HEAD)"
  fi
  tar -tf "$archive" > "$temp_dir/entries" || fail 'Invalid source archive'
  local entry
  for entry in proxmox/install.sh package.json package-lock.json server.js; do
    [[ $(awk -v entry="$entry" '$0 == entry { count++ } END { print count + 0 }' "$temp_dir/entries") == 1 ]] \
      || fail "Source archive must contain exactly one $entry"
  done
  source_id=$(sha256sum "$archive" | awk '{ print substr($1, 1, 40) }')
  # Match the installer to the app revision, including when testing an unpushed archive.
  tar -xOf "$archive" proxmox/install.sh > "$temp_dir/install.sh"
  [[ -s "$temp_dir/install.sh" ]] || fail 'Source installer is empty'
}

main() {
  set -euo pipefail
  umask 077
  local mode=${1:-install}
  if [[ "$mode" == --help || "$mode" == -h ]]; then
    usage
    return
  fi
  case "$mode" in
    uninstall|purge)
      [[ $# -le 2 && ( $# -le 1 || "$2" == --dry-run ) ]] || { usage >&2; exit 2; }
      ;;
    install|update|reinstall|resume) [[ $# -le 1 ]] || { usage >&2; exit 2; } ;;
    *) usage >&2; exit 2 ;;
  esac
  [[ $EUID -eq 0 ]] || fail 'Run this script as root on the target Linux host'
  [[ -d /run/systemd/system ]] || fail 'A running systemd host is required'
  if [[ "$mode" == uninstall || "$mode" == purge ]]; then
    local companion
    companion="$(dirname "$(realpath -- "${BASH_SOURCE[0]}")")/../proxmox/install.sh"
    [[ -f "$companion" ]] || companion=/etc/open-tabletop/installer.sh
    [[ -f "$companion" ]] || fail 'Use a current repository checkout to remove this older installation'
    env OTT_INSTALL_PROFILE=linux bash "$companion" "$@"
    return
  fi
  if [[ "$mode" == install ]]; then
    [[ ! -e /etc/open-tabletop/open-tabletop.env ]] || fail 'Already installed; use update'
    BOOTSTRAP_ADMIN_USERNAME=${BOOTSTRAP_ADMIN_USERNAME:-admin}
    BOOTSTRAP_ADMIN_EMAIL=${BOOTSTRAP_ADMIN_EMAIL:-}
    if [[ -z "$BOOTSTRAP_ADMIN_EMAIL" ]]; then
      read -r -p 'Bootstrap admin email: ' BOOTSTRAP_ADMIN_EMAIL
    fi
    [[ "$BOOTSTRAP_ADMIN_USERNAME" =~ ^[a-zA-Z0-9_-]{3,20}$ ]] || fail 'Invalid admin username'
    [[ "$BOOTSTRAP_ADMIN_EMAIL" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]] || fail 'Invalid admin email'
    export BOOTSTRAP_ADMIN_USERNAME BOOTSTRAP_ADMIN_EMAIL
  elif [[ "$mode" == update ]]; then
    [[ -f /etc/open-tabletop/open-tabletop.env && -L /opt/open-tabletop/current ]] || fail 'Open Tabletop is not installed'
    mode=upgrade
  else
    [[ -f /etc/open-tabletop/open-tabletop.env || -f /etc/open-tabletop/install-pending ]] \
      || fail 'No recoverable installer state; inspect the previous installation before retrying'
    mode=resume
  fi
  temp_dir=$(mktemp -d /tmp/open-tabletop-source.XXXXXXXX)
  trap 'rm -rf -- "$temp_dir"' EXIT
  prepare_source
  env OTT_INSTALL_PROFILE=linux bash "$temp_dir/install.sh" --check-platform \
    || fail 'Selected installer cannot provision this Linux host; select a Linux-capable revision'
  env OTT_INSTALL_PROFILE=linux SOURCE_ID="$source_id" SOURCE_ARCHIVE="$archive" \
    bash "$temp_dir/install.sh" "$mode"
  printf '\nOpen Tabletop: http://<host-ip>:2567\n'
  printf 'Service logs: journalctl -u open-tabletop -n 100 --no-pager\n'
  if [[ "$mode" == install ]]; then
    printf 'Admin credentials: /root/open-tabletop-credentials.txt\n'
  fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
