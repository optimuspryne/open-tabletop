-- Public appearance belongs to an account, never to a portable table scene.
ALTER TABLE users ADD COLUMN placard jsonb NOT NULL DEFAULT
  '{"shape":"masculine","pattern":"gradient","color":"#344759","accent":"#17212c"}'::jsonb;
