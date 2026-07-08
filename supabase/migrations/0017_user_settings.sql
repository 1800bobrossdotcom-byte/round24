-- ============================================================
-- Caliper — schema v17: personal settings & profile
-- Per-user profile, preferences, consent, and (for contractors) license /
-- insurance records. Own-row only — nobody reads anyone else's settings.
-- ============================================================

create table user_settings (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  org_id     uuid references orgs(id) on delete set null,
  data       jsonb not null default '{}'::jsonb,     -- profile, prefs, consent, certs
  updated_at timestamptz default now()
);
alter table user_settings enable row level security;
create policy us_own on user_settings for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
