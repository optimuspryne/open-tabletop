-- grants_app_role.sql
-- Least-privilege application role. The 'tabletop' owner runs migrations (DDL);
-- the running server connects as 'tabletop_app', which can only read/write the
-- data — no CREATE, DROP, TRUNCATE, or ALTER. So a leaked app credential can't
-- reshape or destroy the schema, only touch rows.
--
-- Run once, as a SUPERUSER, against the tabletop database:
--   psql -U postgres -d tabletop -f grants_app_role.sql
--
-- Then point the app's DATABASE_URL at tabletop_app (NOT the owner role).

-- 1) The application login role. Change the password.
CREATE ROLE tabletop_app WITH LOGIN PASSWORD 'change_me_app';

-- 2) Connect, and see the schema (but not create objects in it).
GRANT CONNECT ON DATABASE tabletop TO tabletop_app;
GRANT USAGE ON SCHEMA public TO tabletop_app;

-- 3) Read/write the data, nothing structural. (Identity columns need no sequence
--    grant — the INSERT privilege on the table is enough.)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tabletop_app;

-- 4) Auto-grant the same CRUD on tables that FUTURE migrations create, so you
--    never have to re-run this. FOR ROLE tabletop scopes it to tables the owner
--    creates (that's who runs migrations).
ALTER DEFAULT PRIVILEGES FOR ROLE tabletop IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tabletop_app;
