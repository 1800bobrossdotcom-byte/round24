-- 0050_insurance_certificates.sql
-- Certificate of Insurance (COI) tracking — the "risk management" surface every
-- commercial-property platform has and Caliper didn't. Tracks insurance carried
-- by two kinds of holder: VENDORS (Pro's subcontractors) and TENANTS (Enterprise's
-- commercial tenants). Staff-managed; same deny-by-default org scope as the rest
-- of the app (is_org_staff, established 0002).
--
-- Coverage limits live in a jsonb so the set of coverage types (general liability,
-- auto, workers comp, umbrella, …) can grow without a migration. Nothing here is
-- tenant/resident-readable — COIs are an office/owner concern.

create table if not exists insurance_certificates (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  holder_type       text not null default 'vendor' check (holder_type in ('vendor','tenant')),
  holder_ref        uuid,              -- optional link to a vendor / unit row; name is the source of truth
  holder_name       text not null,
  building          text,             -- tenant COIs: which building/suite it covers
  unit              text,
  carrier           text,
  policy_number     text,
  coverage          jsonb not null default '{}'::jsonb,  -- { general_liability: 1000000, auto: 500000, ... }
  effective         date,
  expires           date,
  additional_insured boolean not null default false,     -- landlord/mgmt named as additional insured
  doc_url           text,             -- optional link to the stored certificate file
  notes             text,
  created_by        uuid references auth.users(id) default auth.uid(),
  created_at        timestamptz not null default now()
);
create index if not exists coi_org_expires on insurance_certificates(org_id, expires);
alter table insurance_certificates enable row level security;

drop policy if exists coi_staff on insurance_certificates;
create policy coi_staff on insurance_certificates for all
  using (is_org_staff(org_id)) with check (is_org_staff(org_id));
