-- Explicit temporary identities; ordinary accounts still require an email address.
ALTER TABLE users ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_demo_identity CHECK (
  (NOT is_demo AND email IS NOT NULL) OR
  (is_demo AND email IS NULL AND password_hash IS NULL AND NOT is_admin AND host_status = 'none')
);

-- Only marked rooms are eligible for automatic expiry/purge. Secrets are hash-only.
CREATE TABLE demo_rooms (
  room_id bigint PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  invite_hash text NOT NULL UNIQUE CHECK (invite_hash ~ '^[a-f0-9]{64}$'),
  starter text NOT NULL CHECK (starter IN ('empty', 'dice', 'cards', 'chess')),
  expires_at timestamptz NOT NULL,
  idle_expires_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX demo_rooms_expiry_idx ON demo_rooms(expires_at);

-- Keep the marker after an administrator purges a room, so its orphan guests can
-- still be collected without touching ordinary accounts or shared library assets.
CREATE TABLE demo_guests (
  user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  room_id bigint REFERENCES rooms(id) ON DELETE SET NULL,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 20)
);
CREATE INDEX demo_guests_room_idx ON demo_guests(room_id);
