-- 004_host_status.sql — host access requires admin approval.
-- Run as the OWNER role (tabletop), after 003_asset_visibility.sql:
--   psql -U tabletop -d tabletop -f 004_host_status.sql
-- New column needs no re-grant; tabletop_app's table-level privileges cover it.

BEGIN;

-- none = passwordless player; pending = asked to host, awaiting an admin;
-- approved = may create/own rooms. (Admins may host regardless of this.)
ALTER TABLE users ADD COLUMN host_status text NOT NULL DEFAULT 'none'
  CHECK (host_status IN ('none', 'pending', 'approved'));

-- Backfill: everyone who already has a password is hosting today — approve them,
-- so the change doesn't yank hosting from existing accounts.
UPDATE users SET host_status = 'approved' WHERE password_hash IS NOT NULL;

COMMIT;
