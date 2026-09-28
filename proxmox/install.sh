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

create_app_user() {
  if getent passwd open-tabletop >/dev/null || getent group open-tabletop >/dev/null; then
    fail 'The open-tabletop account/group already exists; inspect the previous installation before retrying'
  fi
  if [[ "$profile" == proxmox ]]; then
    groupadd --gid 1000 open-tabletop
    useradd --uid 1000 --gid 1000 --no-create-home --home-dir /var/lib/open-tabletop \
      --shell /usr/sbin/nologin open-tabletop
  else
    groupadd --system open-tabletop
    useradd --system --gid open-tabletop --no-create-home --home-dir /var/lib/open-tabletop \
      --shell "$(command -v nologin)" open-tabletop
  fi
}

configure_database_auth() {
  local hba_file hba_copy
  hba_file=$(runuser -u postgres -- psql -XAt -v ON_ERROR_STOP=1 -c 'SHOW hba_file')
  [[ -f "$hba_file" ]] || fail 'Cannot find PostgreSQL authentication configuration'
  hba_copy=$(mktemp)
  # First-match rules: constrain the new rule to this app, leaving other databases alone.
  printf 'host tabletop tabletop,tabletop_app 127.0.0.1/32 scram-sha-256\n' > "$hba_copy"
  cat "$hba_file" >> "$hba_copy"
  cp -p -- "$hba_file" "$hba_file.open-tabletop-backup"
  cat "$hba_copy" > "$hba_file"
  rm -f -- "$hba_copy"
  runuser -u postgres -- psql -X -v ON_ERROR_STOP=1 -c 'SELECT pg_reload_conf()'
}

main() {
  set -euo pipefail
  umask 077
  mode=${1:-}
  [[ "$mode" == install || "$mode" == upgrade || "$mode" == --check-platform ]] \
    || fail 'Usage: install.sh install|upgrade|--check-platform'
  profile=${OTT_INSTALL_PROFILE:-proxmox}
  source /etc/os-release
  detect_platform
  [[ -d /run/systemd/system ]] || fail 'A running systemd host is required'
  [[ "$mode" != --check-platform ]] || return 0
  [[ $EUID -eq 0 ]] || fail 'Run as root on the target host'
  [[ "${SOURCE_ID:-}" =~ ^[0-9a-f]{40}$ ]] || fail 'SOURCE_ID must be a 40-character source digest'
  source_archive=${SOURCE_ARCHIVE:-/root/open-tabletop-source.tar}
  [[ -f "$source_archive" ]] || fail 'Source archive is missing'
  [[ $(sha256sum "$source_archive" | awk '{ print substr($1, 1, 40) }') == "$SOURCE_ID" ]] \
    || fail 'Source archive digest does not match SOURCE_ID'
  if tar -tf "$source_archive" | awk '$0 ~ /^\// || $0 ~ /(^|\/)\.\.(\/|$)/ { bad = 1 } END { exit !bad }'; then
    fail 'Source archive contains an unsafe path'
  fi
  app_root=/opt/open-tabletop
  config_dir=/etc/open-tabletop
  assets_dir=/var/lib/open-tabletop/assets
  release_dir="$app_root/releases/$SOURCE_ID"

  if [[ "$mode" == install ]]; then
    [[ ! -e "$config_dir/open-tabletop.env" ]] || { printf 'Open Tabletop is already installed\n' >&2; exit 1; }
    [[ "${BOOTSTRAP_ADMIN_USERNAME:-}" =~ ^[a-zA-Z0-9_-]{3,20}$ ]] || { printf 'Invalid admin username\n' >&2; exit 1; }
    [[ "${BOOTSTRAP_ADMIN_EMAIL:-}" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]] || { printf 'Invalid admin email\n' >&2; exit 1; }

    install_packages
    initialize_postgres
    systemctl enable --now postgresql "$cache_service"
    pg_isready -q || fail 'PostgreSQL is not ready'
    "$cache_cli" ping | grep -qx PONG || fail 'Redis/Valkey is not ready'
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

    owner_password=$(openssl rand -hex 32)
    app_password=$(openssl rand -hex 32)
    admin_password=$(openssl rand -hex 24)
    runuser -u postgres -- psql -v ON_ERROR_STOP=1 <<SQL
SET password_encryption = 'scram-sha-256';
CREATE ROLE tabletop LOGIN PASSWORD '$owner_password';
CREATE ROLE tabletop_app LOGIN PASSWORD '$app_password';
SQL
    runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c 'CREATE DATABASE tabletop OWNER tabletop'
    runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d tabletop <<'SQL'
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

    if [[ "$profile" == linux ]]; then
      configure_database_auth
    fi

    install -d -m 0750 -o root -g open-tabletop "$config_dir"
    printf '%s\n' "$owner_password" > "$config_dir/owner-password"
    printf '%s\n' "$app_password" > "$config_dir/app-password"
    printf '%s\n' "$admin_password" > "$config_dir/bootstrap-admin-password"
    cat > "$config_dir/open-tabletop.env" <<EOF
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
    chown root:open-tabletop "$config_dir"/*
    chmod 0640 "$config_dir"/*
    cat > /root/open-tabletop-credentials.txt <<EOF
Open Tabletop initial administrator
Username: $BOOTSTRAP_ADMIN_USERNAME
Email: $BOOTSTRAP_ADMIN_EMAIL
Password: $admin_password

Database owner password: $owner_password
Database app password: $app_password
EOF
    chmod 0600 /root/open-tabletop-credentials.txt

    cat > /etc/systemd/system/open-tabletop.service <<EOF
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
    chmod 0644 /etc/systemd/system/open-tabletop.service
    systemctl daemon-reload
  else
    [[ -f "$config_dir/open-tabletop.env" && -L "$app_root/current" ]] \
      || { printf 'Open Tabletop is not installed\n' >&2; exit 1; }
    install -d -m 0700 /var/backups/open-tabletop
    backup=$(mktemp /var/backups/open-tabletop/tabletop-$(date -u +%Y%m%dT%H%M%SZ).XXXXXXXX.dump)
    runuser -u postgres -- pg_dump -Fc tabletop > "$backup"
    [[ -s "$backup" ]] || { printf 'Database backup is empty; upgrade stopped\n' >&2; exit 1; }
    printf 'Database backup created: %s\n' "$backup"
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

  ready=0
  for _ in {1..30}; do
    if curl -fsS -o /dev/null http://127.0.0.1:2567/; then
      ready=1
      break
    fi
    sleep 2
  done
  if [[ "$ready" != 1 ]]; then
    printf 'Open Tabletop did not become ready. Inspect: journalctl -u open-tabletop -n 100 --no-pager\n' >&2
    exit 1
  fi
  printf 'Open Tabletop is ready on port 2567 (source %s, Node %s).\n' "$SOURCE_ID" "$(node --version)"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
