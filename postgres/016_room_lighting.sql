BEGIN;

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS room_lighting jsonb NOT NULL DEFAULT
    '{"preset":"neutral","azimuth":130,"elevation":55,"keyIntensity":1,"keyColor":"#ffffff","ambientIntensity":1,"ambientColor":"#ffffff","shadowSoftness":0.55}'::jsonb;

COMMIT;
