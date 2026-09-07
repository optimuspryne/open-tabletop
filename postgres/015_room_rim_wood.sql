-- 015_room_rim_wood.sql — durable per-room table RIM wood (the wooden border texture).
-- Run as the OWNER role (tabletop), after 014_room_table_shape.sql:
--   psql -U tabletop -d tabletop -f 015_room_rim_wood.sql

BEGIN;

-- The wooden rim's texture: 'mahogany' (default), 'walnut', 'birch' or 'green'. GM-set, durable,
-- Reset-exempt, like the table shape and felt colour.
ALTER TABLE rooms ADD COLUMN table_rim_wood text NOT NULL DEFAULT 'mahogany';

COMMIT;
