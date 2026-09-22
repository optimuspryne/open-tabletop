#!/usr/bin/env bash
# Runs as root inside the Debian 13 LXC created by open-tabletop.sh.
set -euo pipefail
umask 077

mode=${1:-}
[[ "$mode" == install || "$mode" == upgrade ]] || { printf 'Usage: install.sh install|upgrade\n' >&2; exit 2; }
[[ $EUID -eq 0 ]] || { printf 'Run as root inside the container\n' >&2; exit 1; }
source /etc/os-release
[[ "$ID" == debian && "$VERSION_ID" == 13 ]] || { printf 'Debian 13 is required\n' >&2; exit 1; }
[[ "${SOURCE_ID:-}" =~ ^[0-9a-f]{40}$ ]] || { printf 'SOURCE_ID must be a 40-character source digest\n' >&2; exit 1; }
[[ -f /root/open-tabletop-source.tar ]] || { printf 'Source archive is missing\n' >&2; exit 1; }
[[ $(sha256sum /root/open-tabletop-source.tar | awk '{ print substr($1, 1, 40) }') == "$SOURCE_ID" ]] \
  || { printf 'Source archive digest does not match SOURCE_ID\n' >&2; exit 1; }
if tar -tf /root/open-tabletop-source.tar | awk '$0 ~ /^\// || $0 ~ /(^|\/)\.\.(\/|$)/ { bad = 1 } END { exit !bad }'; then
  printf 'Source archive contains an unsafe path\n' >&2
  exit 1
fi

app_root=/opt/open-tabletop
config_dir=/etc/open-tabletop
assets_dir=/var/lib/open-tabletop/assets
release_dir="$app_root/releases/$SOURCE_ID"

if [[ "$mode" == install ]]; then
  [[ ! -e "$config_dir/open-tabletop.env" ]] || { printf 'Open Tabletop is already installed\n' >&2; exit 1; }
  [[ "${BOOTSTRAP_ADMIN_USERNAME:-}" =~ ^[a-zA-Z0-9_-]{3,20}$ ]] || { printf 'Invalid admin username\n' >&2; exit 1; }
  [[ "${BOOTSTRAP_ADMIN_EMAIL:-}" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]] || { printf 'Invalid admin email\n' >&2; exit 1; }

  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl gnupg openssl redis-server postgresql-common

  install -d -m 0755 /etc/apt/keyrings /usr/share/postgresql-common/pgdg
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o /etc/apt/keyrings/nodesource.gpg.key
  gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg /etc/apt/keyrings/nodesource.gpg.key
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  chmod 0644 /etc/apt/keyrings/nodesource.gpg /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  cat > /etc/apt/sources.list.d/nodesource.sources <<'EOF'
Types: deb
URIs: https://deb.nodesource.com/node_26.x
Suites: nodistro
Components: main
Signed-By: /etc/apt/keyrings/nodesource.gpg
EOF
  cat > /etc/apt/sources.list.d/pgdg.sources <<'EOF'
Types: deb
URIs: https://apt.postgresql.org/pub/repos/apt
Suites: trixie-pgdg
Components: main
Signed-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
EOF
  chmod 0644 /etc/apt/sources.list.d/nodesource.sources /etc/apt/sources.list.d/pgdg.sources
  apt-get update
  apt-get install -y nodejs postgresql-16
  [[ $(node -p "process.versions.node.split('.')[0]") == 26 ]] || { printf 'Node.js 26 installation failed\n' >&2; exit 1; }
  systemctl enable --now postgresql redis-server
  pg_isready -q || { printf 'PostgreSQL is not ready\n' >&2; exit 1; }
  redis-cli ping | grep -qx PONG || { printf 'Redis is not ready\n' >&2; exit 1; }

  groupadd --gid 1000 open-tabletop
  useradd --uid 1000 --gid 1000 --no-create-home --home-dir /var/lib/open-tabletop \
    --shell /usr/sbin/nologin open-tabletop
  install -d -m 0750 -o root -g open-tabletop /var/lib/open-tabletop
  mkdir -p "$assets_dir"
  if ! mountpoint -q "$assets_dir"; then
    chown open-tabletop:open-tabletop "$assets_dir"
    chmod 0750 "$assets_dir"
  fi
  write_test=$(runuser -u open-tabletop -- mktemp "$assets_dir/.open-tabletop-write.XXXXXXXX") || {
    printf 'Asset path is not writable by UID 1000/GID 1000. For the default unprivileged LXC map, prepare the host/NFS path for 101000:101000.\n' >&2
    exit 1
  }
  rm -f -- "$write_test"

  owner_password=$(openssl rand -hex 32)
  app_password=$(openssl rand -hex 32)
  admin_password=$(openssl rand -hex 24)
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 <<SQL
CREATE ROLE tabletop LOGIN PASSWORD '$owner_password';
CREATE ROLE tabletop_app LOGIN PASSWORD '$app_password';
SQL
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c 'CREATE DATABASE tabletop OWNER tabletop'
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d tabletop <<'SQL'
GRANT CONNECT ON DATABASE tabletop TO tabletop_app;
GRANT USAGE ON SCHEMA public TO tabletop_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tabletop_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tabletop_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tabletop IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tabletop_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tabletop IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO tabletop_app;
SQL

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

  cat > /etc/systemd/system/open-tabletop.service <<'EOF'
[Unit]
Description=Open Tabletop
After=network-online.target postgresql.service redis-server.service
Wants=network-online.target
Requires=postgresql.service redis-server.service

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
  tar -xf /root/open-tabletop-source.tar -C "$staging" --no-same-owner
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
