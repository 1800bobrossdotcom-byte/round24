-- ============================================================
-- Operator hourly rate. Timer entries don't carry a pay rate, so the timesheet
-- couldn't turn logged hours into dollars. Give each operator a settable hourly
-- rate here — loaded via listOperators (RLS: an operator reads their own, staff
-- read all), so labor $ populates in both the crew and office views without
-- exposing anyone else's rate. Plaintext numeric, protected by the operators
-- row policies (name/PII stays in the encrypted columns).
-- ============================================================

alter table operators add column if not exists hourly_rate numeric;
