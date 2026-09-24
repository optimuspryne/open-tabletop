-- Shared site-admin-curated groups. Membership never grants asset access.
CREATE TABLE asset_collections (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id bigint REFERENCES users(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  is_public boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE asset_collection_items (
  collection_id bigint NOT NULL REFERENCES asset_collections(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('deck','board','mat','prop','scene','sky','dice')),
  asset_id bigint NOT NULL,
  -- Generated targets give typed references real foreign keys and automatic deletion cleanup.
  deck_id bigint GENERATED ALWAYS AS (CASE WHEN kind = 'deck' THEN asset_id END) STORED REFERENCES custom_decks(id) ON DELETE CASCADE,
  board_id bigint GENERATED ALWAYS AS (CASE WHEN kind = 'board' THEN asset_id END) STORED REFERENCES custom_boards(id) ON DELETE CASCADE,
  mat_id bigint GENERATED ALWAYS AS (CASE WHEN kind = 'mat' THEN asset_id END) STORED REFERENCES custom_mats(id) ON DELETE CASCADE,
  prop_id bigint GENERATED ALWAYS AS (CASE WHEN kind = 'prop' THEN asset_id END) STORED REFERENCES custom_objects(id) ON DELETE CASCADE,
  scene_id bigint GENERATED ALWAYS AS (CASE WHEN kind = 'scene' THEN asset_id END) STORED REFERENCES custom_scenes(id) ON DELETE CASCADE,
  sky_id bigint GENERATED ALWAYS AS (CASE WHEN kind = 'sky' THEN asset_id END) STORED REFERENCES custom_skyboxes(id) ON DELETE CASCADE,
  dice_id bigint GENERATED ALWAYS AS (CASE WHEN kind = 'dice' THEN asset_id END) STORED REFERENCES custom_dice(id) ON DELETE CASCADE,
  PRIMARY KEY (collection_id, kind, asset_id)
);
CREATE INDEX asset_collection_items_asset_idx ON asset_collection_items(kind, asset_id);
