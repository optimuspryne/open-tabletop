-- 006_room_table.sql — durable per-room table size (the play surface, not boards).
-- Run as the OWNER role (tabletop), after 005_room_board.sql:
--   psql -U tabletop -d tabletop -f 006_room_table.sql

BEGIN;

-- Half-extents of the play surface, GM-resizable. Defaults match the built-in
-- TABLE constant (10 x 7). Like the scoreboard/notes, this survives restarts and
-- is exempt from the table Reset.
ALTER TABLE rooms ADD COLUMN table_x real NOT NULL DEFAULT 10;
ALTER TABLE rooms ADD COLUMN table_z real NOT NULL DEFAULT 7;

COMMIT;
