-- 0053_inspections.sql
-- Inspections — templated condition checklists (move-in, move-out, quarterly
-- safety, unit turn) run against a building/unit and scored pass / fail / n-a.
-- Staff-only (not resident-readable). Items live in a jsonb array so a checklist
-- can be any length; templates themselves live in the app (src/lib/inspection.js)
-- and are copied into an inspection when it's started.

create table if not exists inspections (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  building    text,
  unit        text,
  title       text not null,
  kind        text not null default 'custom',   -- template key
  status      text not null default 'in_progress' check (status in ('scheduled','in_progress','complete')),
  items       jsonb not null default '[]'::jsonb, -- [{ label, status: pass|fail|na|'', note }]
  inspector   text,
  date        date,
  notes       text,
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists inspections_org on inspections(org_id, date);
alter table inspections enable row level security;

drop policy if exists insp_staff on inspections;
create policy insp_staff on inspections for all
  using (is_org_staff(org_id)) with check (is_org_staff(org_id));
