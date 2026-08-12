-- 001_custom_assets.sql
-- First migration: move the deck / board / prop libraries out of the JSON
-- sidecar files and into Postgres. No auth yet, so owner_id is present for
-- later but stays NULL until the users table exists; its foreign-key
-- constraint gets added in that migration. Requires PostgreSQL 10+.

begin;

create table custom_decks (
  id          bigint generated always as identity primary key,
  owner_id    bigint,                                    -- -> users.id (constraint added with auth)
  name        text        not null,
  type        text        not null default 'mixed'
                          check (type in ('text', 'image', 'mixed')),
  cards       jsonb       not null default '[]'::jsonb,  -- ordered array of card refs (the fronts)
  props       jsonb       not null default '{}'::jsonb,  -- back ref + any other render payload
  created_at  timestamptz not null default now()
);

create table custom_boards (
  id          bigint generated always as identity primary key,
  owner_id    bigint,
  name        text        not null,
  type        text        not null default 'flat'
                          check (type in ('glb', 'image', 'flat')),
  file_url    text,                                      -- null for a plain flat board
  props       jsonb       not null default '{}'::jsonb,  -- model / box / w,d / tex
  created_at  timestamptz not null default now()
);

create table custom_objects (
  id          bigint generated always as identity primary key,
  owner_id    bigint,
  name        text        not null,
  file_url    text        not null,                      -- a custom object is always a .glb upload
  props       jsonb       not null default '{}'::jsonb,  -- box, scale, tint, stand, modelScale, modelRot
  created_at  timestamptz not null default now()
);

-- Pays off once the library is filtered by owner (post-auth); harmless before then.
create index custom_decks_owner_idx   on custom_decks   (owner_id);
create index custom_boards_owner_idx  on custom_boards  (owner_id);
create index custom_objects_owner_idx on custom_objects (owner_id);

commit;

-- To roll this back:
--   begin;
--   drop table if exists custom_objects, custom_boards, custom_decks;
--   commit;
