-- schema.sql — the complete Open Tabletop schema in one file.
--
-- This is the flattened end state of migrations 001–010, meant for a FRESH
-- install (a new Docker volume, a clean dev DB) — run it once instead of applying
-- the four numbered migrations in sequence. Run as the OWNER role (tabletop):
--   psql -U tabletop -d tabletop -f schema.sql
-- Then create the least-privilege app role separately (superuser):
--   psql -U postgres -d tabletop -f grants_app_role.sql
--
-- For upgrading an EXISTING database, use the numbered migrations instead — the
-- per-migration backfills (e.g. publishing pre-existing assets, approving
-- existing password accounts) matter there but are no-ops on an empty DB, so
-- they're omitted here.

BEGIN;

-- ===== Users ================================================================
-- Global identity + auth. A password_hash means the account can host (create/own
-- rooms) once approved; NULL means a passwordless player. login_token_hash is the
-- durable device credential, stored HASHED (a DB leak must not hand out logins).
-- is_admin is the site-wide superuser, above every room owner. host_status gates
-- hosting: 'none' (player) / 'pending' (awaiting an admin) / 'approved'.
CREATE TABLE users (
  id                bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username          text        NOT NULL,
  email             text        NOT NULL,
  password_hash     text,                                -- set => a host account
  login_token_hash  text,                                -- device token (hashed)
  is_admin          boolean     NOT NULL DEFAULT false,
  host_status       text        NOT NULL DEFAULT 'none'
                                CHECK (host_status IN ('none', 'pending', 'approved')),
  avatar            text,                                -- persistent avatar URL
  created_at        timestamptz NOT NULL DEFAULT now()
);
-- Case-insensitive uniqueness — you sign in by username or email.
CREATE UNIQUE INDEX users_username_key ON users (lower(username));
CREATE UNIQUE INDEX users_email_key    ON users (lower(email));

-- ===== Rooms ================================================================
-- Durable, owned tables. Soft-deleted rooms keep their row (deleted_at set) until
-- an admin purges them; they're hidden from listing/joining meanwhile.
CREATE TABLE rooms (
  id                bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id          bigint      NOT NULL REFERENCES users(id),
  code              text        NOT NULL,
  name              text        NOT NULL,
  require_approval  boolean     NOT NULL DEFAULT true,  -- valid code still needs a GM to admit
  scoreboard        jsonb       NOT NULL DEFAULT '[]'::jsonb, -- durable {id,label,score} rows (helper+ edits)
  notes             text        NOT NULL DEFAULT '',    -- durable GM room notes (GM-only edits)
  table_x           real        NOT NULL DEFAULT 10,    -- play-surface half-extents (GM-resizable)
  table_z           real        NOT NULL DEFAULT 7,
  skybox            text        NOT NULL DEFAULT '',    -- durable per-room skybox URL (GM-set; '' = default)
  felt_color        text        NOT NULL DEFAULT '#2f6b4f', -- durable per-room felt color (GM-set)
  scene             jsonb,      -- GM's saved table snapshot (table size + pieces + transforms); null = none
  scale             jsonb,      -- durable per-room measurement scale { worldPerUnit, unitLabel, roundStep, cellWorld, gridStyle }; null = defaults
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
-- Only active rooms need a unique code, so a soft-deleted code frees up for reuse.
CREATE UNIQUE INDEX rooms_code_active_key ON rooms (code) WHERE deleted_at IS NULL;
CREATE INDEX rooms_owner_idx ON rooms (owner_id);

-- ===== Room membership ======================================================
-- Where ALL per-room role lives. One row per (room, user) — this is what lets
-- someone GM one table and play at another with no special-casing.
CREATE TABLE room_members (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  room_id     bigint      NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id     bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text        NOT NULL DEFAULT 'player' CHECK (role IN ('owner','gm','helper','player')),
  status      text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','admitted')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, user_id)
);
CREATE INDEX room_members_user_idx ON room_members (user_id);

-- ===== Asset library ========================================================
-- Only METADATA lives here; the image/model FILES sit on disk under ASSETS_DIR.
-- owner_id is the admin who created the asset; is_public gates who can spawn it
-- (private = admins only; public = GMs/helpers too). Editing is always admin-only.
CREATE TABLE custom_decks (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id    bigint      CONSTRAINT fk_deck_owner REFERENCES users(id),
  name        text        NOT NULL,
  type        text        NOT NULL DEFAULT 'mixed' CHECK (type IN ('text', 'image', 'mixed')),
  cards       jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- ordered array of card refs (the fronts)
  props       jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- back ref + any other render payload
  is_public   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE custom_boards (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id    bigint      CONSTRAINT fk_board_owner REFERENCES users(id),
  name        text        NOT NULL,
  type        text        NOT NULL DEFAULT 'flat' CHECK (type IN ('glb', 'image', 'flat')),
  file_url    text,                                      -- null for a plain flat board
  props       jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- model / box / w,d / tex
  is_public   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE custom_objects (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id    bigint      CONSTRAINT fk_object_owner REFERENCES users(id),
  name        text        NOT NULL,
  file_url    text        NOT NULL,                      -- a custom object is always a .glb upload
  props       jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- box, scale, tint, stand, modelScale, modelRot
  is_public   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX custom_decks_owner_idx   ON custom_decks   (owner_id);
CREATE INDEX custom_boards_owner_idx  ON custom_boards  (owner_id);
CREATE INDEX custom_objects_owner_idx ON custom_objects (owner_id);

-- Scenes: a saved whole-table setup (table size + board + pieces), curated like
-- the other library assets.
CREATE TABLE custom_scenes (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id    bigint      CONSTRAINT fk_scene_owner REFERENCES users(id),
  name        text        NOT NULL,
  props       jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- payload: { table:{x,z}, pieces:[...] }
  is_public   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX custom_scenes_owner_idx ON custom_scenes (owner_id);

-- Admin-curated skyboxes: equirectangular panorama images, applied per-room by a GM.
CREATE TABLE custom_skyboxes (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id    bigint      CONSTRAINT fk_skybox_owner REFERENCES users(id),
  name        text        NOT NULL,
  file_url    text        NOT NULL,  -- the uploaded panorama, served from /assets/sky/
  is_public   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX custom_skyboxes_owner_idx ON custom_skyboxes (owner_id);

-- ===== Migration bookkeeping ================================================
-- This baseline IS the flattened result of migrations 001–010, so record them as
-- already applied. The app's startup migrator (migrate.js) reads this table and
-- runs only the numbered files NOT listed here — so a fresh install skips them all,
-- and a later upgrade applies just the new ones. (A blank DB with no baseline has
-- an empty table, so the migrator builds the whole schema from 001 instead.)
CREATE TABLE schema_migrations (
  version    text        PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations (version) VALUES
  ('001_custom_assets.sql'), ('002_auth.sql'), ('003_asset_visibility.sql'),
  ('004_host_status.sql'),   ('005_room_board.sql'), ('006_room_table.sql'),
  ('007_scenes.sql'),        ('008_room_skybox.sql'), ('009_room_state.sql'),
  ('010_room_scale.sql');

COMMIT;
