-- ============================================================
-- Round24 — schema v41: cross-device field-timer state
-- The running job + parked (paused) jobs + break state used to live only in a
-- single device's localStorage, so a crew member's phone and desktop didn't
-- agree and the office couldn't see parked work. This is one authoritative row
-- per operator, synced in real time: any device they're signed into (and the
-- office) reflects the same running + paused state. localStorage stays the
-- offline cache; this is the shared source of truth when there's signal.
-- ============================================================

create table if not exists field_timer_state (
  org_id     uuid not null references orgs(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  state      jsonb not null default '{}'::jsonb,   -- { running, paused[], onBreak, breakMs, …, rev }
  updated_at timestamptz default now(),
  primary key (org_id, user_id)
);
alter table field_timer_state enable row level security;

-- read your own row; office (staff) reads everyone's, to see the crew's live +
-- parked work on the day board.
drop policy if exists fts_read on field_timer_state;
create policy fts_read on field_timer_state for select
  using (user_id = auth.uid() or is_org_staff(org_id));
-- write only your own row.
drop policy if exists fts_write on field_timer_state;
create policy fts_write on field_timer_state for all
  using (user_id = auth.uid())
  with check (org_id in (select current_user_orgs()) and user_id = auth.uid());

do $$ begin alter publication supabase_realtime add table field_timer_state; exception when duplicate_object then null; end $$;
