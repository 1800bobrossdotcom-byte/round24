-- ============================================================
-- Round24 — schema v21: the leasing spine (replaces the lease spreadsheet)
-- Extends the existing `units` table (from RM-sync scaffolding) with the
-- fields the lease worksheet carries, and adds `leases`: a unit has at most
-- one active lease with tenant, rent, fees, deposit, term, renewal status.
-- The living, role-scoped source of truth the workbook stood in for.
-- Office (admin/manager) edits; viewers/owners read; field crew never see it.
-- ============================================================

alter table units add column if not exists unit_type text default 'residential';  -- residential | commercial
alter table units add column if not exists furnished boolean default false;
alter table units add column if not exists building text;      -- denormalized name for import/display
alter table units add column if not exists sort int default 0;

create table if not exists leases (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  unit_id       uuid references units(id) on delete cascade,
  tenant_name   text,
  tenant_phone  text,
  rent          numeric(10,2),
  fees          jsonb default '{}',                -- {pet,insurance,water,cam}
  total         numeric(10,2),
  deposit       numeric(10,2),
  lease_start   date,
  lease_end     date,
  renewal_status text,                             -- undecided | renewed | not_renewing | mtm
  notes         text,
  active        boolean default true,
  created_at    timestamptz default now()
);

create index if not exists leases_unit on leases(unit_id);
create index if not exists leases_end  on leases(org_id, lease_end);

alter table leases enable row level security;

-- owners (viewer role) can read the rent roll; office already can via unit_read.
-- Additive permissive policies — they OR with whatever exists.
drop policy if exists units_owner_read on units;
create policy units_owner_read on units for select using (
  org_id in (select org_id from memberships where user_id = auth.uid() and role = 'viewer'));

drop policy if exists leases_read on leases;
create policy leases_read on leases for select using (
  org_id in (select org_id from memberships where user_id = auth.uid() and role in ('admin','manager','viewer')));
drop policy if exists leases_write on leases;
create policy leases_write on leases for all
  using (is_org_staff(org_id)) with check (is_org_staff(org_id));

-- live edits reach every open office device (ignore if already published)
do $$ begin
  alter publication supabase_realtime add table leases;
exception when duplicate_object then null; end $$;
