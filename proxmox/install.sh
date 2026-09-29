#!/usr/bin/env bash
# Shared native installer: the Proxmox launcher uses the default LXC profile;
# linux/open-tabletop.sh selects the Linux host profile.

fail() {
  printf 'Open Tabletop: %s\n' "$*" >&2
  exit 1
}

detect_platform() {
  cache_service=redis-server
  cache_cli=redis-cli
  if [[ "$profile" == proxmox ]]; then
    [[ "$ID" == debian && "${VERSION_ID:-}" == 13 ]] || fail 'Debian 13 is required for the Proxmox profile'
    return
  fi
  [[ "$profile" == linux ]] || fail 'Unknown installation profile'
  case "$ID" in
    debian) [[ "${VERSION_ID:-}" == 12 || "${VERSION_ID:-}" == 13 ]] || fail 'Use Debian 12 or 13' ;;
    ubuntu) [[ "${VERSION_ID:-}" == 22.04 || "${VERSION_ID:-}" == 24.04 || "${VERSION_ID:-}" == 26.04 ]] || fail 'Use Ubuntu 22.04, 24.04 or 26.04 LTS' ;;
    fedora|arch) cache_service=valkey; cache_cli=valkey-cli ;;
    *) fail 'Supported distributions: Debian, Ubuntu, Fedora and Arch Linux (systemd required)' ;;
  esac
}

apt_update() {
  local attempt
  for attempt in 1 2 3; do
    if apt-get --error-on=any update; then
      return 0
    fi
    if (( attempt < 3 )); then
      sleep 5
    fi
  done
  printf 'APT index update failed after three attempts; check network and DNS.\n' >&2
  return 1
}

install_apt_packages() {
  export DEBIAN_FRONTEND=noninteractive
  apt_update
  apt-get install -y ca-certificates curl gnupg openssl redis-server postgresql-common

  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o /etc/apt/keyrings/nodesource.gpg.key
  gpg --batch --yes --dearmor -o /etc/apt/keyrings/nodesource.gpg /etc/apt/keyrings/nodesource.gpg.key
  chmod 0644 /etc/apt/keyrings/nodesource.gpg
  cat > /etc/apt/sources.list.d/nodesource.sources <<'EOF'
Types: deb
URIs: https://deb.nodesource.com/node_26.x
Suites: nodistro
Components: main
Signed-By: /etc/apt/keyrings/nodesource.gpg
EOF
  chmod 0644 /etc/apt/sources.list.d/nodesource.sources
  local postgres_package=postgresql
  if [[ "$profile" == proxmox ]]; then
    postgres_package=postgresql-16
    install -d -m 0755 /usr/share/postgresql-common/pgdg
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
    chmod 0644 /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
    cat > /etc/apt/sources.list.d/pgdg.sources <<'EOF'
Types: deb
URIs: https://apt.postgresql.org/pub/repos/apt
Suites: trixie-pgdg
Components: main
Signed-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
EOF
    chmod 0644 /etc/apt/sources.list.d/pgdg.sources
  fi
  apt_update
  apt-get install -y nodejs "$postgres_package"
  [[ $(node -p "process.versions.node.split('.')[0]") == 26 ]] || { printf 'Node.js 26 installation failed\n' >&2; exit 1; }
}

install_packages() {
  case "$ID" in
    debian|ubuntu) install_apt_packages ;;
    fedora)
      dnf install -y ca-certificates curl openssl tar nodejs npm postgresql-server postgresql valkey util-linux shadow-utils
      ;;
    arch)
      # Never refresh Arch repositories without the matching full system upgrade.
      pacman -Syu --needed --noconfirm ca-certificates curl openssl tar nodejs npm postgresql valkey util-linux shadow
      ;;
  esac
  /usr/bin/node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)' \
    || fail 'Node.js 22.12 or newer is required; upgrade the host runtime'
}

initialize_postgres() {
  case "$ID" in
    fedora)
      if [[ ! -f /var/lib/pgsql/data/PG_VERSION ]]; then
        postgresql-setup --initdb --unit postgresql
      fi
      ;;
    arch)
      if [[ ! -f /var/lib/postgres/data/PG_VERSION ]]; then
        runuser -u postgres -- initdb --locale=C.UTF-8 --encoding=UTF8 \
          --auth-local=peer --auth-host=scram-sha-256 -D /var/lib/postgres/data
      fi
      ;;
  esac
}

validate_app_user() {
  [[ $(getent passwd open-tabletop | cut -d: -f6) == /var/lib/open-tabletop ]] \
    || fail 'Existing account has an unexpected home directory'
  [[ $(id -gn open-tabletop) == open-tabletop ]] || fail 'Existing account has an unexpected group'
  if [[ "$profile" == proxmox ]]; then
    [[ $(id -u open-tabletop) == 1000 && $(id -g open-tabletop) == 1000 ]] || fail 'Unexpected LXC UID/GID'
  fi
}

create_app_user() {
  if [[ "${mode:-install}" == resume ]] && getent passwd open-tabletop >/dev/null; then
    validate_app_user
    return
  fi
  if getent passwd open-tabletop >/dev/null; then
    fail 'The open-tabletop account/group already exists; inspect the previous installation before retrying'
  fi
  if getent group open-tabletop >/dev/null; then
    [[ "${mode:-install}" == resume ]] || fail 'The open-tabletop group already exists'
  elif [[ "$profile" == proxmox ]]; then
    groupadd --gid 1000 open-tabletop
  else
    groupadd --system open-tabletop
  fi
  if [[ "$profile" == proxmox ]]; then
    useradd --uid 1000 --gid 1000 --no-create-home --home-dir /var/lib/open-tabletop \
      --shell /usr/sbin/nologin open-tabletop
  else
    useradd --system --gid open-tabletop --no-create-home --home-dir /var/lib/open-tabletop \
      --shell "$(command -v nologin)" open-tabletop
  fi
}

configure_database_auth() {
  local hba_file hba_copy
  hba_file=$(runuser -u postgres -- psql -XAt -v ON_ERROR_STOP=1 -c 'SHOW hba_file')
  [[ -f "$hba_file" ]] || fail 'Cannot find PostgreSQL authentication configuration'
  if grep -Fxq 'host tabletop tabletop,tabletop_app 127.0.0.1/32 scram-sha-256' "$hba_file"; then return; fi
  hba_copy=$(mktemp)
  # First-match rules: constrain the new rule to this app, leaving other databases alone.
  printf 'host tabletop tabletop,tabletop_app 127.0.0.1/32 scram-sha-256\n' > "$hba_copy"
  cat "$hba_file" >> "$hba_copy"
  [[ -e "$hba_file.open-tabletop-backup" ]] || cp -p -- "$hba_file" "$hba_file.open-tabletop-backup"
  cat "$hba_copy" > "$hba_file"
  rm -f -- "$hba_copy"
  runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -c 'SELECT pg_reload_conf()'
}

# Local deployment lifecycle. Never source the application's environment file as shell code.
pg_value() {
  runuser -u postgres -- psql -XAt -v ON_ERROR_STOP=1 -d postgres -c "$1"
}

validate_local_config() {
  local expected
  [[ -f "$config_dir/open-tabletop.env" ]] || return 0
  for expected in DATABASE_HOST=127.0.0.1 DATABASE_PORT=5432 DATABASE_NAME=tabletop \
    DATABASE_USER=tabletop_app "DATABASE_PASSWORD_FILE=$config_dir/app-password" \
    MIGRATE_DATABASE_HOST=127.0.0.1 MIGRATE_DATABASE_PORT=5432 MIGRATE_DATABASE_NAME=tabletop \
    MIGRATE_DATABASE_USER=tabletop "MIGRATE_DATABASE_PASSWORD_FILE=$config_dir/owner-password" \
    "ASSETS_DIR=$assets_dir"; do
    [[ $(grep -c "^${expected%%=*}=" "$config_dir/open-tabletop.env") == 1 ]] \
      && grep -Fxq "$expected" "$config_dir/open-tabletop.env" \
      || fail 'Customized database/assets configuration requires manual recovery or removal'
  done
  if grep -Eq '^(DATABASE_URL|MIGRATE_DATABASE_URL)=' "$config_dir/open-tabletop.env"; then
    fail 'Database URL overrides require manual recovery or removal'
  fi
}

assert_unused_resources() {
  if getent passwd open-tabletop >/dev/null || getent group open-tabletop >/dev/null; then
    fail 'The open-tabletop account/group already exists; use resume for an installer-managed deployment'
  fi
  local roles
  roles=$(pg_value "SELECT rolname FROM pg_roles WHERE rolname IN ('tabletop','tabletop_app')") || fail 'Cannot inspect database roles'
  [[ -z "$roles" ]] || fail 'Database roles already exist; refusing to adopt an unrelated deployment'
  if database_exists; then fail 'Database already exists; refusing to adopt an unrelated deployment'; fi
}

database_exists() {
  local result
  result=$(pg_value "SELECT 1 FROM pg_database WHERE datname='tabletop'") || fail 'Cannot inspect database'
  [[ "$result" == 1 ]]
}

role_exists() {
  local result
  result=$(pg_value "SELECT 1 FROM pg_roles WHERE rolname='$1'") || fail 'Cannot inspect role'
  [[ "$result" == 1 ]]
}

verify_database_owner() {
  local owner
  owner=$(pg_value "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='tabletop'") || fail 'Cannot inspect database owner'
  [[ "$owner" == tabletop ]] || fail 'Unexpected database owner; refusing to modify this database'
}

prepare_password() {
  local file="$config_dir/$1"
  if [[ ! -f "$file" ]]; then
    [[ ! -f "$config_dir/open-tabletop.env" ]] || fail "Missing credential file: $file; restore it from backup"
    # Rename only complete secrets into place, before creating a role using them.
    openssl rand -hex "$2" > "$file.tmp"
    chmod 0600 "$file.tmp"
    mv -- "$file.tmp" "$file"
  fi
  saved_password=$(cat "$file")
  [[ "$saved_password" =~ ^[0-9a-f]+$ && ${#saved_password} -eq $((2 * $2)) ]] \
    || fail "Unexpected credential format: $file; manual recovery required"
}

backup_database() {
  install -d -m 0700 /var/backups/open-tabletop
  backup=$(mktemp /var/backups/open-tabletop/tabletop-$(date -u +%Y%m%dT%H%M%SZ).XXXXXXXX.dump)
  runuser -u postgres -- pg_dump -Fc tabletop > "$backup"
  [[ -s "$backup" ]] || fail 'Database backup is empty; operation stopped'
  printf 'Database backup created: %s\n' "$backup"
}

ensure_database() {
  local role password
  for role in tabletop tabletop_app; do
    password=$owner_password
    [[ "$role" != tabletop_app ]] || password=$app_password
    if ! role_exists "$role"; then
      runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d postgres >/dev/null <<SQL
SET password_encryption = 'scram-sha-256';
CREATE ROLE $role LOGIN PASSWORD '$password';
SQL
    fi
  done
  if ! database_exists; then
    pg_value 'CREATE DATABASE tabletop OWNER tabletop' >/dev/null
  fi
  verify_database_owner
  # Authenticate existing roles before applying grants; never reset their passwords on resume.
  [[ "$profile" != linux ]] || configure_database_auth
  for role in tabletop tabletop_app; do
    password=$owner_password
    [[ "$role" != tabletop_app ]] || password=$app_password
    PGPASSWORD="$password" psql -X -w -h 127.0.0.1 -p 5432 -U "$role" -d tabletop \
      -v ON_ERROR_STOP=1 -c 'SELECT 1' >/dev/null || fail "Stored credentials cannot authenticate $role"
  done
  runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -d tabletop <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO tabletop;
GRANT CONNECT ON DATABASE tabletop TO tabletop_app;
GRANT USAGE ON SCHEMA public TO tabletop_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tabletop_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tabletop_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tabletop IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tabletop_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tabletop IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO tabletop_app;
SQL
}

assert_local_tree() {
  local target="$1" part mounts fs_type
  # Reject symlinked parents too; --one-file-system does not protect bind mounts.
  part=$target
  while [[ "$part" != / ]]; do
    [[ ! -L "$part" ]] || fail "Refusing redirected path: $part"
    part=$(dirname "$part")
  done
  mounts=$(findmnt -rn -o TARGET) || fail 'Cannot inspect mounted storage'
  while IFS= read -r part; do
    [[ "$part" != "$target" && "$part" != "$target/"* ]] || fail "Refusing mounted storage: $part"
  done <<< "$mounts"
  if [[ -e "$target" ]]; then
    fs_type=$(findmnt -n -o FSTYPE -T "$target") || fail "Cannot inspect filesystem: $target"
    case "$fs_type" in
      nfs*|cifs|smb*|fuse*) fail "Refusing shared storage: $target" ;;
    esac
  fi
}

remove_database_auth() {
  local hba_file hba_copy
  hba_file=$(pg_value 'SHOW hba_file')
  [[ -f "$hba_file" ]] || fail 'Cannot find PostgreSQL authentication configuration'
  hba_copy=$(mktemp)
  # Remove only our exact rule; never restore a stale whole-file backup.
  awk '$0 != "host tabletop tabletop,tabletop_app 127.0.0.1/32 scram-sha-256"' "$hba_file" > "$hba_copy"
  cat "$hba_copy" > "$hba_file"
  rm -f -- "$hba_copy"
  pg_value 'SELECT pg_reload_conf()' >/dev/null
}

remove_installation() {
  local dry_run=${1:-} answer
  printf 'Remove service and application releases: %s\n' "$app_root"
  if [[ "$mode" == purge ]]; then
    printf 'Also remove tabletop database/roles, %s, %s, app account, and /root/open-tabletop-credentials.txt\n' "$config_dir" "${assets_dir%/assets}"
  else
    printf 'Retain database/roles, uploads, configuration, credentials and app account for reinstall.\n'
  fi
  printf 'Retain /var/backups/open-tabletop, shared packages/services and external storage.\n'
  assert_local_tree "$app_root"
  assert_local_tree /etc/systemd/system/open-tabletop.service
  if [[ "$mode" == purge ]]; then
    assert_local_tree "$config_dir"
    assert_local_tree "${assets_dir%/assets}"
    assert_local_tree /etc/systemd/system/open-tabletop.service.d
    if [[ ! -e "$config_dir" ]]; then
      [[ ! -e "$app_root" && ! -e "${assets_dir%/assets}" ]] || fail 'Missing installer state; manual cleanup required'
      printf 'No retained installation state to purge.\n'
      return
    fi
    [[ -f "$config_dir/open-tabletop.env" || -f "$config_dir/install-pending" ]] \
      || fail 'Unrecognized installation state; manual cleanup required'
    validate_local_config
    if getent passwd open-tabletop >/dev/null; then validate_app_user; fi
  fi
  [[ "$dry_run" != --dry-run ]] || { printf 'Dry run: nothing changed.\n'; return; }
  if [[ "$mode" == purge ]]; then
    read -r -p 'Type PURGE open-tabletop to permanently delete this installation and its data: ' answer \
      || fail 'Purge confirmation required'
    [[ "$answer" == 'PURGE open-tabletop' ]] || fail 'Purge cancelled'
    # Verify database access before stopping the service or removing files.
    pg_value 'SELECT 1' >/dev/null
  fi
  if [[ -f /etc/systemd/system/open-tabletop.service ]]; then
    systemctl disable --now open-tabletop
  fi
  if [[ "$mode" == purge ]]; then
    if database_exists; then
      verify_database_owner
      backup_database
      pg_value 'DROP DATABASE tabletop' >/dev/null
    fi
    # No CASCADE: dependencies in another database make role removal fail safely.
    pg_value 'DROP ROLE IF EXISTS tabletop_app' >/dev/null
    pg_value 'DROP ROLE IF EXISTS tabletop' >/dev/null
    [[ "$profile" != linux ]] || remove_database_auth
    rm -rf --one-file-system -- "${assets_dir%/assets}" /etc/systemd/system/open-tabletop.service.d
    if getent passwd open-tabletop >/dev/null; then userdel open-tabletop; fi
    if getent group open-tabletop >/dev/null; then groupdel open-tabletop; fi
    rm -f -- /root/open-tabletop-credentials.txt
    # Remove recovery state last so a failed purge can be retried.
    rm -rf --one-file-system -- "$config_dir"
  fi
  rm -f -- /etc/systemd/system/open-tabletop.service
  rm -rf --one-file-system -- "$app_root"
  systemctl daemon-reload
  printf '%s complete. Backups and host dependencies were retained.\n' "$mode"
}

main() {
  set -euo pipefail
  umask 077
  mode=${1:-}
  [[ "$mode" == install || "$mode" == resume || "$mode" == upgrade || "$mode" == uninstall || "$mode" == purge || "$mode" == --check-platform ]] \
    || fail 'Usage: install.sh install|resume|upgrade|uninstall|purge [--dry-run]|--check-platform'
  profile=${OTT_INSTALL_PROFILE:-proxmox}
  source /etc/os-release
  detect_platform
  [[ -d /run/systemd/system ]] || fail 'A running systemd host is required'
  [[ "$mode" != --check-platform ]] || return 0
  [[ $EUID -eq 0 ]] || fail 'Run as root on the target host'
  app_root=/opt/open-tabletop
  config_dir=/etc/open-tabletop
  assets_dir=/var/lib/open-tabletop/assets
  if [[ "${2:-}" != --dry-run ]]; then
    exec 9>/run/open-tabletop-installer.lock
    flock -n 9 || fail 'Another installer operation is running'
  fi
  if [[ "$mode" == uninstall || "$mode" == purge ]]; then
    [[ $# -le 2 && ( $# == 1 || "$2" == --dry-run ) ]] || fail 'Only --dry-run is accepted for removal'
    remove_installation "${2:-}"
    return
  fi
  [[ $# == 1 ]] || fail 'Unexpected arguments'
  [[ ! -L "$config_dir" && ! -L "$app_root" ]] || fail 'Redirected installation paths require manual recovery'
  [[ "${SOURCE_ID:-}" =~ ^[0-9a-f]{40}$ ]] || fail 'SOURCE_ID must be a 40-character source digest'
  source_archive=${SOURCE_ARCHIVE:-/root/open-tabletop-source.tar}
  [[ -f "$source_archive" ]] || fail 'Source archive is missing'
  [[ $(sha256sum "$source_archive" | awk '{ print substr($1, 1, 40) }') == "$SOURCE_ID" ]] \
    || fail 'Source archive digest does not match SOURCE_ID'
  if tar -tf "$source_archive" | awk '$0 ~ /^\// || $0 ~ /(^|\/)\.\.(\/|$)/ { bad = 1 } END { exit !bad }'; then
    fail 'Source archive contains an unsafe path'
  fi
  release_dir="$app_root/releases/$SOURCE_ID"

  if [[ "$mode" == install || "$mode" == resume ]]; then
    if [[ "$mode" == install ]]; then
      [[ ! -e "$config_dir/open-tabletop.env" ]] || { printf 'Open Tabletop is already installed\n' >&2; exit 1; }
      [[ "${BOOTSTRAP_ADMIN_USERNAME:-}" =~ ^[a-zA-Z0-9_-]{3,20}$ ]] || { printf 'Invalid admin username\n' >&2; exit 1; }
      [[ "${BOOTSTRAP_ADMIN_EMAIL:-}" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]] || { printf 'Invalid admin email\n' >&2; exit 1; }

      [[ ! -e "$config_dir" ]] || fail 'Previous installation state exists; use resume'
    else
      [[ -f "$config_dir/open-tabletop.env" || -f "$config_dir/install-pending" ]] \
        || fail 'No recoverable installer state; inspect any existing accounts/database before installing'
      validate_local_config
    fi
    install_packages
    initialize_postgres
    systemctl enable --now postgresql "$cache_service"
    pg_isready -q || fail 'PostgreSQL is not ready'
    "$cache_cli" ping | grep -qx PONG || fail 'Redis/Valkey is not ready'
    if [[ "$mode" == install ]]; then
      assert_unused_resources
      install -d -m 0700 "$config_dir"
      printf '%s\n' "$BOOTSTRAP_ADMIN_USERNAME" "$BOOTSTRAP_ADMIN_EMAIL" > "$config_dir/install-pending"
    elif [[ -f "$config_dir/install-pending" && ! -f "$config_dir/open-tabletop.env" ]]; then
      BOOTSTRAP_ADMIN_USERNAME=$(sed -n '1p' "$config_dir/install-pending")
      BOOTSTRAP_ADMIN_EMAIL=$(sed -n '2p' "$config_dir/install-pending")
    fi
    if [[ ! -f "$config_dir/open-tabletop.env" ]]; then
      [[ "${BOOTSTRAP_ADMIN_USERNAME:-}" =~ ^[a-zA-Z0-9_-]{3,20}$ \
        && "${BOOTSTRAP_ADMIN_EMAIL:-}" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]] \
        || fail 'Invalid bootstrap identity in recovery state'
    fi
    prepare_password owner-password 32
    owner_password=$saved_password
    prepare_password app-password 32
    app_password=$saved_password
    prepare_password bootstrap-admin-password 24
    admin_password=$saved_password
    if database_exists; then
      verify_database_owner
      backup_database
    elif [[ -f "$config_dir/open-tabletop.env" && ! -f "$config_dir/install-pending" ]]; then
      fail 'Existing installation database is missing; restore it before reinstalling'
    fi
    create_app_user
    install -d -m 0750 -o root -g open-tabletop /var/lib/open-tabletop
    mkdir -p "$assets_dir"
    if ! mountpoint -q "$assets_dir"; then
      chown open-tabletop:open-tabletop "$assets_dir"
      chmod 0750 "$assets_dir"
    fi
    write_test=$(runuser -u open-tabletop -- mktemp "$assets_dir/.open-tabletop-write.XXXXXXXX") || {
      printf 'Asset path must be writable by UID %s/GID %s. Prepare mounted storage ownership before retrying.\n' \
        "$(id -u open-tabletop)" "$(id -g open-tabletop)" >&2
      if [[ "$profile" == proxmox ]]; then
        printf 'For the default unprivileged LXC map, prepare the host/NFS path for 101000:101000.\n' >&2
      fi
      exit 1
    }
    rm -f -- "$write_test"

    ensure_database

    install -d -m 0750 -o root -g open-tabletop "$config_dir"
    if [[ ! -f "$config_dir/open-tabletop.env" ]]; then
    cat > "$config_dir/open-tabletop.env.tmp" <<EOF
NODE_ENV=production
PORT=2567
DATABASE_HOST=127.0.0.1
DATABASE_PORT=5432
DATABASE_NAME=tabletop
DATABASE_USER=tabletop_app
DATABASE_PASSWORD_FILE=$config_dir/app-password
MIGRATE_DATABASE_HOST=127.0.0.1
MIGRATE_DATABASE_PORT=5432
MIGRATE_DATABASE_NAME=tabletop
MIGRATE_DATABASE_USER=tabletop
MIGRATE_DATABASE_PASSWORD_FILE=$config_dir/owner-password
AUTO_MIGRATE=true
REDIS_URL=redis://127.0.0.1:6379
RATE_LIMIT_STORE=redis
BOOTSTRAP_ADMIN_USERNAME=$BOOTSTRAP_ADMIN_USERNAME
BOOTSTRAP_ADMIN_EMAIL=$BOOTSTRAP_ADMIN_EMAIL
BOOTSTRAP_ADMIN_PASSWORD_FILE=$config_dir/bootstrap-admin-password
ASSETS_DIR=$assets_dir
TRUST_PROXY_HOPS=0
EOF
    mv -- "$config_dir/open-tabletop.env.tmp" "$config_dir/open-tabletop.env"
    fi
    chown root:open-tabletop "$config_dir"/*
    chmod 0640 "$config_dir"/*
    if [[ ! -f /root/open-tabletop-credentials.txt && -f "$config_dir/install-pending" ]]; then
    BOOTSTRAP_ADMIN_USERNAME=$(sed -n '1p' "$config_dir/install-pending")
    BOOTSTRAP_ADMIN_EMAIL=$(sed -n '2p' "$config_dir/install-pending")
    cat > /root/open-tabletop-credentials.txt.tmp <<EOF
Open Tabletop initial administrator
Username: $BOOTSTRAP_ADMIN_USERNAME
Email: $BOOTSTRAP_ADMIN_EMAIL
Password: $admin_password

Database owner password: $owner_password
Database app password: $app_password
EOF
    chmod 0600 /root/open-tabletop-credentials.txt.tmp
    mv -- /root/open-tabletop-credentials.txt.tmp /root/open-tabletop-credentials.txt
    fi
    [[ "${BASH_SOURCE[0]}" -ef "$config_dir/installer.sh" ]] \
      || install -m 0700 "${BASH_SOURCE[0]}" "$config_dir/installer.sh"

    if [[ ! -f /etc/systemd/system/open-tabletop.service ]]; then
    cat > /etc/systemd/system/open-tabletop.service.tmp <<EOF
[Unit]
Description=Open Tabletop
After=network-online.target postgresql.service $cache_service.service
Wants=network-online.target
Requires=postgresql.service $cache_service.service

[Service]
Type=simple
User=open-tabletop
Group=open-tabletop
WorkingDirectory=/opt/open-tabletop/current
EnvironmentFile=/etc/open-tabletop/open-tabletop.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/open-tabletop/assets

[Install]
WantedBy=multi-user.target
EOF
    chmod 0644 /etc/systemd/system/open-tabletop.service.tmp
    mv -- /etc/systemd/system/open-tabletop.service.tmp /etc/systemd/system/open-tabletop.service
    fi
    systemctl daemon-reload
  else
    [[ -f "$config_dir/open-tabletop.env" && -L "$app_root/current" ]] \
      || { printf 'Open Tabletop is not installed\n' >&2; exit 1; }
    backup_database
  fi

  install -d -m 0755 "$app_root/releases"
  if [[ ! -d "$release_dir" ]]; then
    staging=$(mktemp -d "$app_root/releases/.staging.XXXXXXXX")
    tar -xf "$source_archive" -C "$staging" --no-same-owner
    [[ -f "$staging/package-lock.json" && -f "$staging/server.js" ]] \
      || { printf 'Archive is missing app files\n' >&2; exit 1; }
    (cd "$staging" && npm ci --omit=dev)
    chmod -R a+rX "$staging"
    mv -- "$staging" "$release_dir"
  fi

  ln -sfnT "$release_dir" "$app_root/.current-next"
  mv -Tf -- "$app_root/.current-next" "$app_root/current"
  systemctl enable open-tabletop
  systemctl restart open-tabletop

  local_port=$(sed -n 's/^PORT=//p' "$config_dir/open-tabletop.env")
  [[ "$local_port" =~ ^[0-9]+$ && "$local_port" -ge 1 && "$local_port" -le 65535 ]] || fail 'Invalid configured PORT'
  ready=0
  for _ in {1..30}; do
    if curl -fsS -o /dev/null "http://127.0.0.1:$local_port/"; then
      ready=1
      break
    fi
    sleep 2
  done
  if [[ "$ready" != 1 ]]; then
    printf 'Open Tabletop did not become ready. Inspect: journalctl -u open-tabletop -n 100 --no-pager\n' >&2
    exit 1
  fi
  rm -f -- "$config_dir/install-pending"
  printf 'Open Tabletop is ready on port %s (source %s, Node %s).\n' "$local_port" "$SOURCE_ID" "$(node --version)"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
