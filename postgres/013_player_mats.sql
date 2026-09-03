BEGIN;

-- Player mats (ROADMAP: double-sided tiles phase 4). A mat is a large, single-faced,
-- movable SURFACE that other tiles/pieces rest on — a per-player profession board that
-- is NOT the singleton table `board`. Stored like custom_boards: file_url is the uploaded
-- mat image (served from /assets/mats/), props carries its sized geometry { geom }.
-- Spawned as a `mat` piece; this table is the reusable library.
CREATE TABLE custom_mats (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id    bigint      CONSTRAINT fk_mat_owner REFERENCES users(id),
  name        text        NOT NULL,
  file_url    text        NOT NULL,  -- the uploaded mat image, served from /assets/mats/
  props       jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- { geom: {w,h,t,round,shape} }
  is_public   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX custom_mats_owner_idx ON custom_mats (owner_id);

COMMIT;
