BEGIN;

ALTER TABLE rooms DROP CONSTRAINT rooms_room_environment_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_room_environment_check
  CHECK (room_environment IN ('standard', 'cozy', 'poker-night'));

COMMIT;
