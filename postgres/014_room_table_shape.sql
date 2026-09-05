-- 014_room_table_shape.sql — durable per-room table SHAPE (the play-surface outline).
-- Run as the OWNER role (tabletop), after 013_player_mats.sql:
--   psql -U tabletop -d tabletop -f 014_room_table_shape.sql

BEGIN;

-- The play-surface shape: 'rect' (default, today's behaviour), 'round', 'oval', 'hex'
-- or 'roundedRect'. Interpreted against the existing table_x/table_z half-extents
-- (round/hex use table_x). Like table_x/table_z, this survives restarts and is
-- exempt from the table Reset.
ALTER TABLE rooms ADD COLUMN table_shape text NOT NULL DEFAULT 'rect';

COMMIT;
