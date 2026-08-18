-- 010_room_scale.sql — durable per-room measurement scale: a display/snap layer
-- over the FIXED world scale. One jsonb bag { worldPerUnit, unitLabel, roundStep,
-- cellWorld, gridStyle }. Null until a GM sets it; the server seeds defaults.
-- Run as the OWNER role (tabletop), after 009_room_state.sql:
--   psql -U tabletop -d tabletop -f 010_room_scale.sql

BEGIN;

ALTER TABLE rooms ADD COLUMN IF NOT EXISTS scale jsonb;

COMMIT;
