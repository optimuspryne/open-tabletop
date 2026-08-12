-- 003_asset_visibility.sql — public/private flag for library assets.
-- Run as the OWNER role (tabletop), after 002_auth.sql:
--   psql -U tabletop -d tabletop -f 003_asset_visibility.sql
-- Adding a column needs no re-grant; tabletop_app's table-level privileges cover it.

BEGIN;

-- New assets default to PRIVATE (admins only until published).
ALTER TABLE custom_decks   ADD COLUMN is_public boolean NOT NULL DEFAULT false;
ALTER TABLE custom_boards  ADD COLUMN is_public boolean NOT NULL DEFAULT false;
ALTER TABLE custom_objects ADD COLUMN is_public boolean NOT NULL DEFAULT false;

-- Backfill: everything already in the library was spawnable by GMs/helpers, so
-- publish it — otherwise it would silently vanish from their reach on upgrade.
UPDATE custom_decks   SET is_public = true;
UPDATE custom_boards  SET is_public = true;
UPDATE custom_objects SET is_public = true;

COMMIT;
