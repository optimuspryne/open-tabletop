BEGIN;

CREATE TABLE user_sessions (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text        NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX user_sessions_user_idx ON user_sessions (user_id);
CREATE INDEX user_sessions_expires_idx ON user_sessions (expires_at);

-- Preserve existing browser logins during an upgrade, but put a finite bound on
-- credentials that were previously valid forever.
INSERT INTO user_sessions (user_id, token_hash, expires_at)
SELECT id, login_token_hash, now() + interval '30 days'
FROM users
WHERE login_token_hash IS NOT NULL;

ALTER TABLE users DROP COLUMN login_token_hash;

COMMIT;
