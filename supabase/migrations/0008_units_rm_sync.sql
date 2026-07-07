-- ============================================================
-- Caliper — schema v8: units + Rent Manager sync scaffolding
-- Read-only RM pull lands here. Conflict rule (locked): RM wins on
-- properties/units, Caliper wins on work orders. external_src/external_id
-- carry provenance so native-mode (non-RM) shops still work.
-- ============================================================

-- ---- units: real per-unit entities (RM's value is per-unit cost truth) ----
create table units (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  property_id  uuid references properties(id) on delete set null,
  name         text not null,                 -- "3C", "4B"
  beds         numeric,
  baths        numeric,
  sqft         int,
  status       text,                           -- occupied | vacant | notice
  external_src text default 'native',          -- native | rm
  external_id  text,
  created_at   timestamptz default now()
);
alter table units enable row level security;

-- org members read units (crew needs the unit list to log work);
-- only staff mutate (RM sync runs as service role, bypassing this)
create policy unit_read on units for select
  using (org_id in (select current_user_orgs()));
create policy unit_staff_write on units for insert with check (is_org_staff(org_id));
create policy unit_staff_update on units for update using (is_org_staff(org_id)) with check (is_org_staff(org_id));
create policy unit_staff_delete on units for delete using (is_org_staff(org_id));

create index units_org on units(org_id);
create index units_property on units(property_id);

-- ---- external-source upsert keys (dedupe RM rows on re-sync) ----
-- NULLs are distinct in Postgres, so many native rows (external_id null) coexist.
create unique index properties_ext on properties(org_id, external_src, external_id);
create unique index units_ext on units(org_id, external_src, external_id);

-- ---- rm_connections: one connection per org + sync bookkeeping ----
alter table rm_connections add column rm_location_id  text;
alter table rm_connections add column last_sync_summary jsonb;
create unique index rm_conn_org on rm_connections(org_id);
