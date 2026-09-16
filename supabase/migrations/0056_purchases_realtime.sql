-- ============================================================
-- Caliper — schema v56: purchases join the realtime publication.
-- A receipt a crew member snaps in the field should ping the office the moment
-- it lands ("$318 from Ferguson awaiting review"), the same way a new work
-- order or resident request already does. RLS still scopes every row the
-- subscription delivers to the caller's org.
-- ============================================================
do $$ begin
  alter publication supabase_realtime add table purchases;
exception when duplicate_object then null; end $$;
