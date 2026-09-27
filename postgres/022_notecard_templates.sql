-- Account-owned reusable notecard documents, separate from room/game inventories.
CREATE TABLE notecard_templates (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id bigint REFERENCES users(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  is_public boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notecard_templates_owner_idx ON notecard_templates(owner_id);
