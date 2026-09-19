BEGIN;
CREATE TABLE collider_presets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id bigint REFERENCES users(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  layout jsonb NOT NULL CHECK (jsonb_typeof(layout->'shapes') = 'array'
    AND jsonb_array_length(layout->'shapes') BETWEEN 1 AND 16),
  size double precision NOT NULL CHECK (size BETWEEN 0.001 AND 400),
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collider_presets_owner_idx ON collider_presets(owner_id);
COMMIT;
