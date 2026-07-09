-- ============================================================
-- Caliper — schema v26: approved vendor / contractor list + favorite products
-- Every workspace keeps its own trusted rolodex: approved contractors (by
-- trade), specialty suppliers, and the go-to products it reorders. Used by
-- both Caliper Pro (companies) and Caliper Portfolio (owners). Any member can
-- read it (crew needs to know who's approved); staff (admin/manager, incl.
-- owner-admins) maintain it.
-- ============================================================

create table if not exists vendors (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  name         text not null,
  kind         text default 'contractor',   -- contractor | supplier
  trade        text,                         -- plumbing | electrical | hvac | roofing | general | appliance | landscaping | ... (or supplier category)
  contact_name text,
  phone        text,
  email        text,
  website      text,
  address      text,
  license      text,                         -- license / insurance note
  rating       int,                          -- 1..5
  approved     boolean default true,
  favorite     boolean default false,
  notes        text,
  created_at   timestamptz default now()
);

create table if not exists vendor_products (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  vendor_id  uuid references vendors(id) on delete set null,
  name       text not null,
  category   text,
  sku        text,
  price      numeric(10,2),
  url        text,
  favorite   boolean default true,
  notes      text,
  created_at timestamptz default now()
);

create index if not exists vendors_org on vendors(org_id);
create index if not exists vendor_products_org on vendor_products(org_id);
create index if not exists vendor_products_vendor on vendor_products(vendor_id);

alter table vendors enable row level security;
alter table vendor_products enable row level security;

-- read: any member of the org; write: staff (admin/manager, incl. owner-admins)
drop policy if exists vendors_read on vendors;
create policy vendors_read on vendors for select using (
  org_id in (select org_id from memberships where user_id = auth.uid()));
drop policy if exists vendors_write on vendors;
create policy vendors_write on vendors for all
  using (is_org_staff(org_id)) with check (is_org_staff(org_id));

drop policy if exists vendor_products_read on vendor_products;
create policy vendor_products_read on vendor_products for select using (
  org_id in (select org_id from memberships where user_id = auth.uid()));
drop policy if exists vendor_products_write on vendor_products;
create policy vendor_products_write on vendor_products for all
  using (is_org_staff(org_id)) with check (is_org_staff(org_id));

-- live edits reach every open device
do $$ begin alter publication supabase_realtime add table vendors; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table vendor_products; exception when duplicate_object then null; end $$;
