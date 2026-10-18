BEGIN;

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS room_environment text NOT NULL DEFAULT 'standard'
    CHECK (room_environment IN ('standard', 'cozy'));

COMMIT;
