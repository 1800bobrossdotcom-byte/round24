-- ============================================================
-- Round24 — schema v1
-- multi-tenant, row-level security, encrypted sensitive fields.
-- sensitive columns (rates, PII, RM creds) are stored as ciphertext
-- (bytea) — encrypted client-side before insert, decrypted after read.
-- the DB never sees plaintext for those fields.
-- ============================================================

-- ---- orgs (tenants) ----
create table orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique not null,
  theme       jsonb default '{}'::jsonb,        -- whitelabel tokens
  created_at  timestamptz default now()
);

-- ---- membership: which auth user belongs to which org + role ----
-- auth.users is Supabase's built-in auth table.
create table memberships (
  id        uuid primary key default gen_random_uuid(),
  org_id    uuid not null references orgs(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'tech' check (role in ('admin','manager','tech','viewer')),
  created_at timestamptz default now(),
  unique (org_id, user_id)
);

-- helper: the set of org_ids the current authed user belongs to
create or replace function current_user_orgs()
returns setof uuid language sql stable security definer as $$
  select org_id from memberships where user_id = auth.uid()
$$;

-- ---- operators (techs) — name is PII → encrypted ----
create table operators (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  name_enc      bytea not null,                 -- AES-256-GCM ciphertext
  role          text default 'tech',
  rate_enc      bytea,                          -- loaded hourly rate, encrypted
  status        text default 'active',
  created_at    timestamptz default now()
);

-- ---- properties ----
create table properties (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  name          text not null,
  city          text,
  units         int default 0,
  external_src  text default 'native',          -- native | rm
  external_id   text,
  created_at    timestamptz default now()
);

-- ---- timers: the labor spine ----
create table timers (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  operator_id   uuid not null references operators(id) on delete cascade,
  property_id   uuid references properties(id) on delete set null,  -- null = unallocated
  unit          text,
  work_date     date not null,
  category      text default 'general',
  issue         text,
  duration_hrs  numeric(6,2) not null,
  rate_snapshot_enc bytea,                       -- rate at time of work, encrypted
  period        text,
  note          text,
  created_at    timestamptz default now()
);

-- ---- rm connections: credentials always encrypted ----
create table rm_connections (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  base_url      text,
  credentials_enc bytea,                         -- RM API creds, encrypted
  status        text default 'active',
  last_sync_at  timestamptz,
  created_at    timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY — every table scoped to the user's org(s)
-- deny-by-default: no policy match = no rows.
-- ============================================================
alter table orgs           enable row level security;
alter table memberships    enable row level security;
alter table operators      enable row level security;
alter table properties     enable row level security;
alter table timers         enable row level security;
alter table rm_connections enable row level security;

-- orgs: you can see an org only if you're a member
create policy org_read on orgs for select
  using (id in (select current_user_orgs()));

-- memberships: you can see your own memberships
create policy mem_read on memberships for select
  using (user_id = auth.uid());

-- generic per-table org-scoped policies
create policy op_all on operators for all
  using (org_id in (select current_user_orgs()))
  with check (org_id in (select current_user_orgs()));

create policy prop_all on properties for all
  using (org_id in (select current_user_orgs()))
  with check (org_id in (select current_user_orgs()));

create policy timer_all on timers for all
  using (org_id in (select current_user_orgs()))
  with check (org_id in (select current_user_orgs()));

create policy rm_all on rm_connections for all
  using (org_id in (select current_user_orgs()))
  with check (org_id in (select current_user_orgs()));

-- indexes for the rollup spine
create index timers_org_date   on timers(org_id, work_date);
create index timers_operator   on timers(operator_id);
create index timers_property   on timers(property_id);
create index operators_org     on operators(org_id);
create index properties_org    on properties(org_id);
