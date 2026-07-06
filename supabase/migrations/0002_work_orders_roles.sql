-- ============================================================
-- Caliper — schema v2: work orders + role separation
--
-- Roles (memberships.role): admin | manager | tech | viewer
--   admin/manager ("staff")  → full suite incl. financials
--   tech (contractors)       → field tools + own work orders ONLY;
--                              can never read other operators' rows,
--                              timers, or pay data (enforced here, not
--                              just in the UI)
--   viewer                   → read-only dashboards
-- ============================================================

-- link an auth login to an operator (contractor) record
alter table operators add column user_id uuid references auth.users(id);
create index operators_user on operators(user_id);

-- ---- helper: is the current user admin/manager of this org? ----
create or replace function is_org_staff(oid uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from memberships
    where org_id = oid and user_id = auth.uid() and role in ('admin','manager')
  );
$$;

-- helper: operator ids owned by the current user (security definer so
-- policies on other tables can use it without recursive RLS on operators)
create or replace function current_operator_ids()
returns setof uuid language sql stable security definer as $$
  select id from operators where user_id = auth.uid()
$$;

-- ---- work orders: the feed for the field timer ----
create table work_orders (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references orgs(id) on delete cascade,
  property_id          uuid references properties(id) on delete set null,
  property_label       text,             -- display name until properties are DB-synced
  unit                 text,
  task                 text not null,
  detail               text,
  category             text default 'general',
  assigned_operator_id uuid references operators(id) on delete set null,
  assignee_label       text,             -- display name until operators are DB-synced
  due_date             date,
  status               text not null default 'open'
                       check (status in ('open','in_progress','done','cancelled')),
  source               text default 'manual',   -- manual | voice
  voice_transcript     text,
  created_by           uuid references auth.users(id),
  created_at           timestamptz default now()
);
alter table work_orders enable row level security;

-- staff: full access to org work orders
create policy wo_staff on work_orders for all
  using (is_org_staff(org_id))
  with check (is_org_staff(org_id));

-- techs: see and update only work orders assigned to them
create policy wo_tech_read on work_orders for select
  using (assigned_operator_id in (select current_operator_ids()));
create policy wo_tech_update on work_orders for update
  using (assigned_operator_id in (select current_operator_ids()))
  with check (assigned_operator_id in (select current_operator_ids()));

create index wo_org_status on work_orders(org_id, status);
create index wo_assignee   on work_orders(assigned_operator_id);

-- ============================================================
-- TIGHTEN v1 POLICIES — v1 gave every org member full access.
-- Replace with role-aware: staff = all, tech = own rows only.
-- ============================================================

-- timers: staff all; techs only their own
drop policy timer_all on timers;
create policy timer_staff on timers for all
  using (is_org_staff(org_id))
  with check (is_org_staff(org_id));
create policy timer_tech on timers for all
  using (operator_id in (select current_operator_ids()))
  with check (
    org_id in (select current_user_orgs())
    and operator_id in (select current_operator_ids())
  );

-- operators: staff all; a tech can read only their own row
drop policy op_all on operators;
create policy op_staff on operators for all
  using (is_org_staff(org_id))
  with check (is_org_staff(org_id));
create policy op_tech_self on operators for select
  using (user_id = auth.uid());

-- rm_connections (credentials): staff only
drop policy rm_all on rm_connections;
create policy rm_staff on rm_connections for all
  using (is_org_staff(org_id))
  with check (is_org_staff(org_id));

-- properties stay org-readable (techs need the address list to log work),
-- but only staff can modify
drop policy prop_all on properties;
create policy prop_read on properties for select
  using (org_id in (select current_user_orgs()));
create policy prop_staff_write on properties for insert
  with check (is_org_staff(org_id));
create policy prop_staff_update on properties for update
  using (is_org_staff(org_id)) with check (is_org_staff(org_id));
create policy prop_staff_delete on properties for delete
  using (is_org_staff(org_id));
