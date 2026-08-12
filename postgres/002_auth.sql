-- 002_auth.sql — accounts, durable rooms, and per-room membership.
-- Run as the OWNER role (tabletop), after 001_custom_assets.sql:
--   psql -U tabletop -d tabletop -f 002_auth.sql
-- New tables auto-grant CRUD to tabletop_app via the ALTER DEFAULT PRIVILEGES set
-- up in grants_app_role.sql — no need to re-run grants.

BEGIN;

-- Users: global identity + auth. A password_hash means "GM account" (can create
-- and own rooms); NULL means a passwordless player. login_token_hash is the
-- durable device credential, stored HASHED (a DB leak must not hand out logins).
-- is_admin is the site-wide superuser, above every room owner.
CREATE TABLE users (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username          text        NOT NULL,
  email             text        NOT NULL,
  password_hash     text,                              -- set => can create/own rooms
  login_token_hash  text,                              -- device token (hashed)
  is_admin          boolean     NOT NULL DEFAULT false,
  avatar            text,                              -- persistent avatar URL
  created_at        timestamptz NOT NULL DEFAULT now()
);
-- Case-insensitive uniqueness — you sign in by username or email.
CREATE UNIQUE INDEX users_username_key ON users (lower(username));
CREATE UNIQUE INDEX users_email_key    ON users (lower(email));

-- Rooms: durable, owned tables. Soft-deleted rooms keep their row (deleted_at set)
-- until an admin purges them; they're hidden from listing/joining meanwhile.
CREATE TABLE rooms (
  id                bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id          bigint      NOT NULL REFERENCES users(id),
  code              text        NOT NULL,
  name              text        NOT NULL,
  require_approval  boolean     NOT NULL DEFAULT true,  -- valid code still needs a GM to admit
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
-- Only active rooms need a unique code, so a soft-deleted code frees up for reuse.
CREATE UNIQUE INDEX rooms_code_active_key ON rooms (code) WHERE deleted_at IS NULL;
CREATE INDEX rooms_owner_idx ON rooms (owner_id);

-- Room membership: where ALL per-room role lives. One row per (room, user) — this
-- is what lets someone GM one table and play at another with no special-casing.
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

-- Now that users exist, wire the asset library's owner_id (added nullable in 001)
-- to it. Stays nullable — pre-auth rows have no owner and read as global.
ALTER TABLE custom_decks   ADD CONSTRAINT fk_deck_owner   FOREIGN KEY (owner_id) REFERENCES users(id);
ALTER TABLE custom_boards  ADD CONSTRAINT fk_board_owner  FOREIGN KEY (owner_id) REFERENCES users(id);
ALTER TABLE custom_objects ADD CONSTRAINT fk_object_owner FOREIGN KEY (owner_id) REFERENCES users(id);

COMMIT;
