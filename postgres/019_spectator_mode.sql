BEGIN;
ALTER TABLE room_participation ADD COLUMN participation text NOT NULL DEFAULT 'player'
  CHECK (participation IN ('player', 'spectator'));
COMMIT;
