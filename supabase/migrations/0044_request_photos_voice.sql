-- ============================================================
-- Caliper — schema v44: resident requests get multiple photos + a voice note
-- A resident can attach several photos (now required — a picture is the point of
-- reporting) and optionally record a voice note describing the issue. Stored as
-- data URLs on the row (the intake is unauthenticated, same as the single photo).
-- ============================================================

alter table maintenance_requests add column if not exists photos jsonb;  -- array of image data URLs
alter table maintenance_requests add column if not exists voice  text;   -- voice-note audio data URL
