-- 007_scenes.sql — admin-curated "scenes": a saved whole-table setup (table size,
-- board, and every piece), loadable into any room. A new library asset kind, so it
-- carries owner_id + is_public like the others.
-- Run as the OWNER role (tabletop), after 006_room_table.sql:
--   psql -U tabletop -d tabletop -f 007_scenes.sql

BEGIN;

CREATE TABLE custom_scenes (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id    bigint      CONSTRAINT fk_scene_owner REFERENCES users(id),
  name        text        NOT NULL,
  props       jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- the scene payload: { table:{x,z}, pieces:[...] }
  is_public   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX custom_scenes_owner_idx ON custom_scenes (owner_id);

COMMIT;
