#!/usr/bin/env bash
# Run on a Proxmox VE host. This is a local Community Scripts-style launcher,
# not a script published by that project.
set -euo pipefail

mode=${1:-install}

usage() {
  printf 'Usage: %s [install | update CTID]\n' "$0"
  printf 'Optional: CTID ROOTFS_STORAGE TEMPLATE_STORAGE BRIDGE IP GATEWAY CORES RAM_MB DISK_GB CT_HOSTNAME ASSETS_HOST_PATH SOURCE_REPO SOURCE_REF SOURCE_ARCHIVE INSTALLER_PATH BOOTSTRAP_ADMIN_USERNAME BOOTSTRAP_ADMIN_EMAIL\n'
}

fail() {
  printf 'Open Tabletop: %s\n' "$*" >&2
  exit 1
}

if [[ "$mode" == --help || "$mode" == -h ]]; then
  usage
  exit 0
fi
[[ "$mode" == install || "$mode" == update ]] || { usage >&2; exit 2; }
[[ $EUID -eq 0 ]] || fail 'run this script as root on a Proxmox VE host'
for tool in pct pvesh pveam pvesm pveversion tar sha256sum findmnt; do
  command -v "$tool" >/dev/null 2>&1 || fail "missing Proxmox host command: $tool"
done
pve_major=$(pveversion | sed -n 's#^pve-manager/\([0-9][0-9]*\)\..*#\1#p')
[[ "$pve_major" =~ ^[0-9]+$ && "$pve_major" -ge 9 ]] \
  || fail 'Proxmox VE 9 or newer is required for this Debian 13 container'

if [[ "$mode" == update ]]; then
  CTID=${2:-${CTID:-}}
  [[ "$CTID" =~ ^[0-9]+$ && "$CTID" -ge 100 && "$CTID" -le 999999999 ]] \
    || fail 'update requires a CTID between 100 and 999999999'
  pct config "$CTID" >/dev/null || fail "container $CTID does not exist"
  [[ $(pct status "$CTID") == *running* ]] || fail "start container $CTID before updating"
  pct exec "$CTID" -- test -f /etc/open-tabletop/open-tabletop.env \
    || fail "container $CTID is not an Open Tabletop installation"
else
  CTID=${CTID:-$(pvesh get /cluster/nextid)}
  [[ "$CTID" =~ ^[0-9]+$ && "$CTID" -ge 100 && "$CTID" -le 999999999 ]] \
    || fail 'CTID must be between 100 and 999999999'
  if pct config "$CTID" >/dev/null 2>&1; then
    fail "container $CTID already exists; use update $CTID to deploy a new commit"
  fi

  ROOTFS_STORAGE=${ROOTFS_STORAGE:-}
  if [[ -z "$ROOTFS_STORAGE" ]]; then
    pvesm status --content rootdir
    read -r -p 'Container storage [local-lvm]: ' ROOTFS_STORAGE
    ROOTFS_STORAGE=${ROOTFS_STORAGE:-local-lvm}
  fi
  pvesm status --content rootdir | awk -v storage="$ROOTFS_STORAGE" '$1 == storage { found = 1 } END { exit !found }' \
    || fail "storage $ROOTFS_STORAGE is unavailable or cannot hold containers"

  TEMPLATE_STORAGE=${TEMPLATE_STORAGE:-local}
  BRIDGE=${BRIDGE:-vmbr0}
  IP=${IP:-dhcp}
  GATEWAY=${GATEWAY:-}
  CORES=${CORES:-2}
  RAM_MB=${RAM_MB:-2048}
  DISK_GB=${DISK_GB:-12}
  CT_HOSTNAME=${CT_HOSTNAME:-open-tabletop}
  BOOTSTRAP_ADMIN_USERNAME=${BOOTSTRAP_ADMIN_USERNAME:-admin}
  BOOTSTRAP_ADMIN_EMAIL=${BOOTSTRAP_ADMIN_EMAIL:-}
  if [[ -z "$BOOTSTRAP_ADMIN_EMAIL" ]]; then
    read -r -p 'Bootstrap admin email: ' BOOTSTRAP_ADMIN_EMAIL
  fi

  [[ "$BRIDGE" =~ ^[a-zA-Z0-9_.:-]+$ ]] || fail 'invalid bridge name'
  [[ "$IP" == dhcp || "$IP" =~ ^[0-9.]+/[0-9]{1,2}$ ]] || fail 'IP must be dhcp or an IPv4 CIDR'
  [[ -z "$GATEWAY" || "$GATEWAY" =~ ^[0-9.]+$ ]] || fail 'invalid IPv4 gateway'
  [[ "$IP" != dhcp || -z "$GATEWAY" ]] || fail 'GATEWAY is only used with a static IP'
  [[ "$CORES" =~ ^[1-9][0-9]*$ && "$RAM_MB" =~ ^[1-9][0-9]*$ && "$DISK_GB" =~ ^[1-9][0-9]*$ ]] \
    || fail 'CORES, RAM_MB, and DISK_GB must be positive integers'
  [[ "$CT_HOSTNAME" =~ ^[a-z0-9][a-z0-9-]*$ && ${#CT_HOSTNAME} -le 63 ]] \
    || fail 'invalid container hostname'
  [[ "$BOOTSTRAP_ADMIN_USERNAME" =~ ^[a-zA-Z0-9_-]{3,20}$ ]] || fail 'invalid admin username'
  [[ "$BOOTSTRAP_ADMIN_EMAIL" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]] \
    || fail 'invalid admin email'
  [[ "$IP" == dhcp || -n "$GATEWAY" ]] || fail 'a static IP requires GATEWAY'

  ASSETS_HOST_PATH=${ASSETS_HOST_PATH:-}
  if [[ -n "$ASSETS_HOST_PATH" ]]; then
    [[ "$ASSETS_HOST_PATH" == /* && "$ASSETS_HOST_PATH" =~ ^/[a-zA-Z0-9_./-]+$ ]] \
      || fail 'ASSETS_HOST_PATH must be a simple absolute path without commas or spaces'
    [[ -d "$ASSETS_HOST_PATH" ]] || fail "asset directory does not exist: $ASSETS_HOST_PATH"
    ASSETS_HOST_PATH=$(realpath -e -- "$ASSETS_HOST_PATH")
    [[ "$ASSETS_HOST_PATH" =~ ^/[a-zA-Z0-9_./-]+$ ]] || fail 'resolved asset path contains unsupported characters'
    fs_type=$(findmnt -T "$ASSETS_HOST_PATH" -n -o FSTYPE)
    [[ "$fs_type" == nfs || "$fs_type" == nfs4 ]] \
      || fail "asset path is on $fs_type, not a mounted NFS export"
  fi
fi

temp_dir=$(mktemp -d /tmp/open-tabletop-source.XXXXXXXX)
trap 'rm -rf -- "$temp_dir"' EXIT

if [[ -n ${SOURCE_ARCHIVE:-} ]]; then
  [[ -f "$SOURCE_ARCHIVE" ]] || fail "source archive not found: $SOURCE_ARCHIVE"
  archive=$SOURCE_ARCHIVE
  printf 'Using local source archive: %s\n' "$archive"
else
  command -v git >/dev/null 2>&1 || fail 'git is required to fetch the app repository'
  SOURCE_REPO=${SOURCE_REPO:-https://github.com/optimuspryne/open-tabletop.git}
  SOURCE_REF=${SOURCE_REF:-main}
  [[ "$SOURCE_REF" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/-]*$ ]] || fail 'invalid SOURCE_REF'
  git -C "$temp_dir" init --quiet
  git -C "$temp_dir" remote add origin "$SOURCE_REPO"
  printf 'Fetching Open Tabletop from %s (%s)\n' "$SOURCE_REPO" "$SOURCE_REF"
  git -C "$temp_dir" fetch --depth=1 origin "$SOURCE_REF"
  source_commit=$(git -C "$temp_dir" rev-parse FETCH_HEAD)
  archive="$temp_dir/open-tabletop-source.tar"
  git -C "$temp_dir" archive --format=tar --output="$archive" "$source_commit"
  printf 'Using repository commit %s\n' "$source_commit"
fi
tar -tf "$archive" >/dev/null || fail 'source archive is not a valid tar file'
source_id=$(sha256sum "$archive" | awk '{ print substr($1, 1, 40) }')
if [[ -n ${INSTALLER_PATH:-} ]]; then
  [[ -f "$INSTALLER_PATH" ]] || fail "container installer not found: $INSTALLER_PATH"
  installer=$INSTALLER_PATH
  printf 'Using local container installer: %s\n' "$installer"
else
  installer_entries=$(tar -tf "$archive" | awk '$0 == "proxmox/install.sh" { count++ } END { print count + 0 }')
  [[ "$installer_entries" == 1 ]] \
    || fail 'source archive must contain exactly one proxmox/install.sh; set INSTALLER_PATH to override'
  installer="$temp_dir/install.sh"
  tar -xOf "$archive" proxmox/install.sh > "$installer"
  [[ -s "$installer" ]] || fail 'container installer in source archive is empty'
  printf 'Using container installer from the same source archive\n'
fi

if [[ "$mode" == install ]]; then
  pveam update
  template=$(pveam available --section system \
    | awk '$2 ~ /^debian-13-standard_.*_amd64\.tar\.zst$/ { print $2 }' \
    | sort -V | tail -n 1)
  [[ -n "$template" ]] || fail 'no Debian 13 amd64 container template is available'
  if ! pveam list "$TEMPLATE_STORAGE" | awk -v image="$TEMPLATE_STORAGE:vztmpl/$template" '$1 == image { found = 1 } END { exit !found }'; then
    pveam download "$TEMPLATE_STORAGE" "$template"
  fi

  net0="name=eth0,bridge=$BRIDGE,ip=$IP"
  [[ -z "$GATEWAY" ]] || net0+=",gw=$GATEWAY"
  printf 'Creating unprivileged Debian 13 container %s from %s\n' "$CTID" "$template"
  pct create "$CTID" "$TEMPLATE_STORAGE:vztmpl/$template" \
    --ostype debian --hostname "$CT_HOSTNAME" --unprivileged 1 \
    --rootfs "$ROOTFS_STORAGE:$DISK_GB" --memory "$RAM_MB" --cores "$CORES" \
    --net0 "$net0" --onboot 1 --start 0
  if [[ -n "$ASSETS_HOST_PATH" ]]; then
    pct set "$CTID" --mp0 "$ASSETS_HOST_PATH,mp=/var/lib/open-tabletop/assets"
  fi
  pct start "$CTID"
fi

printf 'Sending app source and installer to container %s\n' "$CTID"
pct push "$CTID" "$archive" /root/open-tabletop-source.tar
pct push "$CTID" "$installer" /root/open-tabletop-install.sh
if [[ "$mode" == install ]]; then
  pct exec "$CTID" -- env SOURCE_ID="$source_id" \
    BOOTSTRAP_ADMIN_USERNAME="$BOOTSTRAP_ADMIN_USERNAME" \
    BOOTSTRAP_ADMIN_EMAIL="$BOOTSTRAP_ADMIN_EMAIL" \
    bash /root/open-tabletop-install.sh install
else
  pct exec "$CTID" -- env SOURCE_ID="$source_id" bash /root/open-tabletop-install.sh upgrade
fi

ip_address=$(pct exec "$CTID" -- hostname -I | awk '{ print $1 }')
printf '\nOpen Tabletop: http://%s:2567\n' "${ip_address:-<container-ip>}"
printf 'Service logs: pct exec %s -- journalctl -u open-tabletop -n 100 --no-pager\n' "$CTID"
if [[ "$mode" == install ]]; then
  printf 'Admin credentials: pct exec %s -- cat /root/open-tabletop-credentials.txt\n' "$CTID"
fi
