-- Preserve the last observed occupancy across process restarts.
ALTER TABLE demo_rooms ADD COLUMN last_occupied_at timestamptz;
