#!/bin/sh
# Runs once on first DB init, right after 01-schema.sql. Creates the least-privilege
# role the server logs in as: CRUD on data, but no CREATE/DROP/ALTER/TRUNCATE — so a
# leaked app credential can touch rows but never reshape or destroy the schema.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE ROLE tabletop_app LOGIN PASSWORD '${APP_DB_PASSWORD}';
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO tabletop_app;
  GRANT USAGE, SELECT               ON ALL SEQUENCES IN SCHEMA public TO tabletop_app;
EOSQL
