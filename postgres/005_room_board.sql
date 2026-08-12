-- 005_room_board.sql — a durable per-room scoreboard and GM room-notes.
-- Run as the OWNER role (tabletop), after 004_host_status.sql:
--   psql -U tabletop -d tabletop -f 005_room_board.sql
-- New columns need no re-grant; tabletop_app's table privileges cover them.

BEGIN;

-- scoreboard: an ordered array of {id, label, score} rows (helper+ edits).
-- notes: free-text GM room notes (GM-only edits). Both survive restarts and are
-- exempt from the table Reset — they're campaign record, not table state.
ALTER TABLE rooms ADD COLUMN scoreboard jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE rooms ADD COLUMN notes      text  NOT NULL DEFAULT '';

COMMIT;
