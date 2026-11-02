BEGIN;

ALTER TABLE rooms DROP CONSTRAINT rooms_room_environment_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_room_environment_check
  CHECK (room_environment IN ('standard', 'cozy', 'poker-night', 'medieval-tavern', 'modern-bar', '1920s-speakeasy', 'ancient-temple', 'starship-lounge', 'victorian-study', 'mountain-cabin', 'pirate-captains-cabin', 'wizards-workshop', 'cyberpunk-back-room', 'japanese-game-cafe', 'garden-conservatory', 'orbital-observation-deck'));

COMMIT;
