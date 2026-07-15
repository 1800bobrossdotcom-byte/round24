-- 0051_building_handbook.sql
-- Building Handbook — a branded, per-building digital manual (the ETS flagship
-- reimagined). Staff author it; residents and commercial tenants read it. One
-- handbook per building, its sections stored as an ordered jsonb array so the
-- section set can grow (info, policies, emergency prep, amenities, contacts…)
-- without a migration.

create table if not exists building_handbooks (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  building    text not null,
  sections    jsonb not null default '[]'::jsonb,  -- [{ id, title, body, icon }]
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) default auth.uid(),
  unique (org_id, building)
);
create index if not exists handbook_org on building_handbooks(org_id);
alter table building_handbooks enable row level security;

-- staff author + manage
drop policy if exists hb_staff on building_handbooks;
create policy hb_staff on building_handbooks for all
  using (is_org_staff(org_id)) with check (is_org_staff(org_id));

-- residents/tenants read their own org's handbooks (same gate as announcements)
drop policy if exists hb_resident_read on building_handbooks;
create policy hb_resident_read on building_handbooks for select using (
  exists (select 1 from residents r
          where r.user_id = auth.uid() and r.org_id = building_handbooks.org_id
            and r.status in ('pending','verified'))
);
