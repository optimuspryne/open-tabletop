BEGIN;

-- Custom dice finishes: a host-uploaded seamless image used as a die's surface
-- material (ROADMAP §9 phase 2). Mirrors custom_skyboxes — the file_url is the
-- uploaded texture, served from /assets/dice/. Applied to a die via its
-- `finish = 'custom'` + `finishImg` prop; this table is the reusable library.
CREATE TABLE custom_dice (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id    bigint      CONSTRAINT fk_dice_owner REFERENCES users(id),
  name        text        NOT NULL,
  file_url    text        NOT NULL,  -- the uploaded texture, served from /assets/dice/
  is_public   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX custom_dice_owner_idx ON custom_dice (owner_id);

COMMIT;
