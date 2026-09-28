-- Existing emails are deliberately NOT verified by migration.
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
ALTER TABLE users ADD COLUMN recovery_mail_sent_at timestamptz;
CREATE TABLE account_recovery_tokens (
  token_hash text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify', 'recover', 'grant')),
  email text NOT NULL,
  expires_at timestamptz NOT NULL,
  UNIQUE (user_id, purpose)
);
CREATE TABLE account_recovery_codes (
  code_hash text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX account_recovery_codes_user_idx ON account_recovery_codes(user_id);
