-- ============================================================
-- Round24 — schema v14: cloud labor persistence
-- The labor spine (imported pay-log timers + derived operators + discovered
-- buildings) has lived in the browser. This stores it per org so it follows
-- the account across devices. It carries rates (pay data), so it is
-- staff-only — the same admin/manager boundary as financial decryption.
-- localStorage stays the fast local cache; this is the source of truth when
-- connected.
-- ============================================================

create table labor_state (
  org_id     uuid primary key references orgs(id) on delete cascade,
  imported   jsonb not null default '{"timers":[],"techs":[]}'::jsonb,
  props      jsonb not null default '[]'::jsonb,
  range      jsonb,
  updated_at timestamptz default now()
);
alter table labor_state enable row level security;

-- staff only: rates are pay data (crew/viewers never read others' pay)
create policy ls_staff on labor_state for all
  using (is_org_staff(org_id))
  with check (is_org_staff(org_id));
