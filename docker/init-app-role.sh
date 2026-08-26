#!/bin/sh
# Runs once on first DB init, right after 01-schema.sql. Creates the least-privilege
# role the server logs in as: CRUD on data, but no CREATE/DROP/ALTER/TRUNCATE — so a
# leaked app credential can touch rows but never reshape or destroy the schema.
set -e
if [ -z "${APP_DB_PASSWORD_FILE:-}" ] || [ ! -r "$APP_DB_PASSWORD_FILE" ]; then
  echo "APP_DB_PASSWORD_FILE must point to a readable Docker secret" >&2
  exit 1
fi
app_db_password=$(cat "$APP_DB_PASSWORD_FILE")
if [ -z "$app_db_password" ]; then
  echo "The app database password secret is empty" >&2
  exit 1
fi
psql -v ON_ERROR_STOP=1 --set=app_db_password="$app_db_password" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-'EOSQL'
  CREATE ROLE tabletop_app LOGIN PASSWORD :'app_db_password';
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO tabletop_app;
  GRANT USAGE, SELECT               ON ALL SEQUENCES IN SCHEMA public TO tabletop_app;
  -- Auto-grant the same on objects that FUTURE migrations create (the app's startup
  -- migrator runs as $POSTGRES_USER, so scope the default privileges to that owner) —
  -- without this, a new table from a later migration would be invisible to tabletop_app.
  ALTER DEFAULT PRIVILEGES FOR ROLE "$POSTGRES_USER" IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO tabletop_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE "$POSTGRES_USER" IN SCHEMA public
    GRANT USAGE, SELECT               ON SEQUENCES TO tabletop_app;
EOSQL
unset app_db_password
