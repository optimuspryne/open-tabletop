-- 008_room_skybox.sql — admin-curated skyboxes (equirectangular panorama images)
-- plus the per-room current skybox. A new library asset kind (owner_id + is_public
-- like the others), and a durable per-room skybox URL that a GM sets.
-- Run as the OWNER role (tabletop), after 007_scenes.sql:
--   psql -U tabletop -d tabletop -f 008_room_skybox.sql

BEGIN;

CREATE TABLE custom_skyboxes (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id    bigint      CONSTRAINT fk_skybox_owner REFERENCES users(id),
  name        text        NOT NULL,
  file_url    text        NOT NULL,  -- the uploaded panorama, served from /assets/sky/
  is_public   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX custom_skyboxes_owner_idx ON custom_skyboxes (owner_id);

-- The room's current skybox URL (empty = the default flat background). GM-set,
-- durable, and exempt from Reset — like the board/table settings.
ALTER TABLE rooms ADD COLUMN skybox text NOT NULL DEFAULT '';

COMMIT;
