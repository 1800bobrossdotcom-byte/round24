-- ============================================================
-- Caliper — schema v30: verified clock-in (labor, measured true — literally).
-- Buildings get a geofence (lat/lng + radius); a crew timer captures the punch
-- location and whether it landed inside the building's fence. The verified
-- minute is the same one that flows to the owner's per-door P&L.
-- ============================================================

alter table properties add column if not exists lat numeric;
alter table properties add column if not exists lng numeric;
alter table properties add column if not exists geofence_m int default 150;  -- verify radius, meters

alter table timers add column if not exists gps_lat numeric;
alter table timers add column if not exists gps_lng numeric;
alter table timers add column if not exists verified boolean;      -- null = no fence/location; true/false = inside/outside
alter table timers add column if not exists distance_m int;        -- meters from the building pin at clock-in
