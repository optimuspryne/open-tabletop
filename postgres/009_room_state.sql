-- 009_room_state.sql — durable per-room felt colour + the GM's "Save Table State"
-- snapshot, so the felt colour persists and pieces survive an empty room.
-- Run as the OWNER role (tabletop), after 008_room_skybox.sql:
--   psql -U tabletop -d tabletop -f 009_room_state.sql

BEGIN;

-- The felt colour was already GM-settable but wasn't persisted; give it a home.
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS felt_color text NOT NULL DEFAULT '#2f6b4f';

-- A full serialized table snapshot (table size + every piece with its transform,
-- deck cards, and face-down fronts). Null until a GM saves state.
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS scene jsonb;

COMMIT;
