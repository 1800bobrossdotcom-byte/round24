-- ============================================================
-- Caliper — schema v13: live presence for running timers
-- When a crew member starts their Field timer, a row here says "on the clock",
-- so the office Day board can show each person's stopwatch ticking in real
-- time. One row per user per org (upsert on start, delete on stop).
-- ============================================================

create table live_timers (
  org_id         uuid not null references orgs(id) on delete cascade,
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  operator_label text,
  work_order_id  uuid references work_orders(id) on delete set null,
  task           text,
  prop_label     text,
  unit           text,
  started_at     timestamptz not null default now(),
  on_break       boolean default false,
  updated_at     timestamptz default now(),
  primary key (org_id, user_id)
);
alter table live_timers enable row level security;

-- everyone in the org can see who's on the clock; you only write your own row
create policy lt_read on live_timers for select
  using (org_id in (select current_user_orgs()));
create policy lt_write on live_timers for all
  using (user_id = auth.uid())
  with check (org_id in (select current_user_orgs()) and user_id = auth.uid());

alter publication supabase_realtime add table live_timers;
