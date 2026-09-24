BEGIN;
-- Account restrictions are room policy, never scene/game snapshot content.
CREATE TABLE room_participation (
  room_id bigint NOT NULL,
  user_id bigint NOT NULL,
  timed_out boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (room_id, user_id),
  FOREIGN KEY (room_id, user_id) REFERENCES room_members(room_id, user_id) ON DELETE CASCADE
);
COMMIT;
