-- ============================================================
-- Round24 — schema v4: purchases (receipts) + documents + storage
-- Crew submits material purchases with receipt photos; office
-- reviews/approves. Documents shared org-wide or staff-only.
-- ============================================================

create table purchases (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,
  work_order_id  uuid references work_orders(id) on delete set null,
  property_label text,
  vendor         text,
  amount         numeric(10,2) not null,
  note           text,
  receipt_path   text,               -- storage object path in 'receipts' bucket
  status         text not null default 'pending'
                 check (status in ('pending','approved','rejected')),
  submitted_by_label text,           -- display name until operators are linked
  created_by     uuid references auth.users(id) default auth.uid(),
  created_at     timestamptz default now()
);
alter table purchases enable row level security;

-- staff: full access
create policy pur_staff on purchases for all
  using (is_org_staff(org_id))
  with check (is_org_staff(org_id));
-- crew: submit purchases into their org, see only their own
create policy pur_tech_insert on purchases for insert
  with check (org_id in (select current_user_orgs()) and created_by = auth.uid());
create policy pur_tech_read on purchases for select
  using (created_by = auth.uid());

create index pur_org_status on purchases(org_id, status);
create index pur_creator on purchases(created_by);

-- ---- documents ----
create table documents (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  name        text not null,
  path        text not null,          -- storage object path in 'docs' bucket
  category    text default 'general',
  visibility  text not null default 'org' check (visibility in ('org','staff')),
  uploaded_by uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz default now()
);
alter table documents enable row level security;

create policy doc_staff on documents for all
  using (is_org_staff(org_id))
  with check (is_org_staff(org_id));
-- org members see org-visible docs (insurance certs, house rules, etc.)
create policy doc_org_read on documents for select
  using (visibility = 'org' and org_id in (select current_user_orgs()));

create index doc_org on documents(org_id, category);

-- ============================================================
-- STORAGE — private buckets; object paths are '<org_id>/<filename>'
-- ============================================================
insert into storage.buckets (id, name, public)
values ('receipts','receipts', false), ('docs','docs', false)
on conflict (id) do nothing;

-- receipts: any org member may upload into their org's folder;
-- readers are the uploader or org staff
create policy "receipts upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (split_part(name, '/', 1))::uuid in (select current_user_orgs())
  );
create policy "receipts read" on storage.objects for select to authenticated
  using (
    bucket_id = 'receipts'
    and (owner = auth.uid() or is_org_staff((split_part(name, '/', 1))::uuid))
  );

-- docs: staff upload/manage; org members read
create policy "docs upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'docs' and is_org_staff((split_part(name, '/', 1))::uuid));
create policy "docs read" on storage.objects for select to authenticated
  using (bucket_id = 'docs' and (split_part(name, '/', 1))::uuid in (select current_user_orgs()));
create policy "docs delete" on storage.objects for delete to authenticated
  using (bucket_id = 'docs' and is_org_staff((split_part(name, '/', 1))::uuid));
