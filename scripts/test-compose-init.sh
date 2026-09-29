#!/bin/sh
# Exercise the real first-run init script without touching any existing database.
set -eu
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
fixture=$(mktemp -d)
container="open-tabletop-init-test-$(basename "$fixture")"
cleanup() {
  docker rm -f -v "$container" >/dev/null 2>&1 || true
  rm -rf "$fixture"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Deliberately include SQL/shell-sensitive characters in the owner and password.
owner='init owner'
password="test'password\$(literal)"
printf '%s\n' "$password" > "$fixture/password"
printf '%s\n' 'CREATE TABLE existing_item (id bigserial PRIMARY KEY, value text);' > "$fixture/schema.sql"
chmod 644 "$fixture/password" "$fixture/schema.sql"

docker run -d --name "$container" \
  -e "POSTGRES_USER=$owner" -e POSTGRES_PASSWORD=disposable_owner_password \
  -e POSTGRES_DB=compose_init_test \
  -e APP_DB_PASSWORD_FILE=/run/secrets/app_password \
  -v "$fixture/password:/run/secrets/app_password:ro" \
  -v "$fixture/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql:ro" \
  -v "$repo_root/docker/init-app-role.sh:/docker-entrypoint-initdb.d/02-app-role.sh:ro" \
  postgres:16-alpine >/dev/null

# TCP becomes available only after the entrypoint finishes its initialization server.
attempt=0
until docker exec "$container" pg_isready -h 127.0.0.1 -U "$owner" -d compose_init_test >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 40 ]; then
    docker logs "$container"
    exit 1
  fi
  sleep 1
done

docker exec "$container" psql -U "$owner" -d compose_init_test -v ON_ERROR_STOP=1 \
  -c 'CREATE TABLE future_item (id bigserial PRIMARY KEY, value text);'
docker exec -i -e "PGPASSWORD=$password" "$container" \
  psql -h 127.0.0.1 -U tabletop_app -d compose_init_test -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO existing_item(value) VALUES ('existing');
INSERT INTO future_item(value) VALUES ('future');
UPDATE existing_item SET value = 'updated';
UPDATE future_item SET value = 'updated';
SELECT * FROM existing_item;
SELECT * FROM future_item;
DELETE FROM existing_item;
DELETE FROM future_item;
SQL
if docker exec -e "PGPASSWORD=$password" "$container" \
  psql -h 127.0.0.1 -U tabletop_app -d compose_init_test -v ON_ERROR_STOP=1 \
  -c 'CREATE TABLE forbidden_item (id integer);' > "$fixture/denied" 2>&1; then
  echo 'FAIL: application role could create a table' >&2
  exit 1
fi
grep -q 'permission denied for schema public' "$fixture/denied"
echo 'PASS: real init script, quoted credentials, current/future CRUD and sequences, DDL denied'
