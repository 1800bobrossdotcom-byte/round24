-- ============================================================
-- Caliper — schema v42: resident maintenance requests → work-order pipeline
-- A tenant submits a request (with a photo) from a public link; it lands in the
-- office queue, where one tap turns it into a work order that feeds the crew +
-- timer. The resident side is intentionally unauthenticated for now (a posted
-- link / QR); a Rent Manager or Google sign-in layers on later to prefill and
-- verify identity.
-- ============================================================

create table if not exists maintenance_requests (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,
  property_label text,
  unit           text,
  tenant_name    text,
  tenant_contact text,
  description    text not null,
  photo          text,                 -- client-resized data URL; WO attachment/storage later
  status         text not null default 'new' check (status in ('new','converted','declined')),
  work_order_id  uuid references work_orders(id) on delete set null,
  created_at     timestamptz default now()
);
create index if not exists mr_org_status on maintenance_requests(org_id, status);

alter table maintenance_requests enable row level security;

-- anyone (including an unauthenticated resident) may SUBMIT a request for an org.
-- Bounded so it can't be used as a blob dump; office triages what comes in.
drop policy if exists mr_public_insert on maintenance_requests;
create policy mr_public_insert on maintenance_requests for insert
  with check (org_id is not null and coalesce(length(description), 0) between 1 and 4000);
-- office (staff) reads + triages + converts + declines.
drop policy if exists mr_staff on maintenance_requests;
create policy mr_staff on maintenance_requests for all
  using (is_org_staff(org_id)) with check (is_org_staff(org_id));

-- the anon (unauthenticated) role needs table-level INSERT before RLS is even
-- consulted; the mr_public_insert policy above is what actually bounds it.
grant insert on table maintenance_requests to anon;

do $$ begin alter publication supabase_realtime add table maintenance_requests; exception when duplicate_object then null; end $$;
