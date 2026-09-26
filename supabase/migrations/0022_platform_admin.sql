-- ============================================================
-- Round24 — schema v22: platform superadmin + workspace requests
-- A superadmin sits ABOVE org roles: they provision workspaces and approve
-- requests so the beta stays invite/approval-gated. Allowlisted by email so
-- it works before that account has even signed up. All cross-tenant power is
-- funneled through SECURITY DEFINER functions gated on is_platform_admin() —
-- there are no broad RLS grants, and no way to self-promote.
-- ============================================================

create table if not exists platform_admins (
  email     text primary key,
  added_at  timestamptz default now()
);
insert into platform_admins(email) values ('1800bobrossdotcom@gmail.com') on conflict do nothing;
alter table platform_admins enable row level security;  -- no policies: unreadable except via definer fns

create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from platform_admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- a signed-in user without a workspace can request one; a superadmin approves
create table if not exists workspace_requests (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid references auth.users(id) default auth.uid(),
  email         text,
  org_name      text not null,
  note          text,
  status        text not null default 'pending',   -- pending | approved | denied
  org_id        uuid references orgs(id) on delete set null,
  invite_code   text,
  created_at    timestamptz default now(),
  decided_at    timestamptz,
  decided_by    text
);
alter table workspace_requests enable row level security;
create policy wr_insert on workspace_requests for insert with check (requester_id = auth.uid());
create policy wr_read   on workspace_requests for select using (requester_id = auth.uid() or is_platform_admin());
create policy wr_admin  on workspace_requests for update using (is_platform_admin()) with check (is_platform_admin());

-- ---- superadmin operations (all gated) ----
create or replace function admin_list_orgs()
returns table(id uuid, name text, created_at timestamptz, members bigint)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.created_at,
         (select count(*) from memberships m where m.org_id = o.id)
  from orgs o
  where is_platform_admin()
  order by o.created_at desc;
$$;

create or replace function admin_create_workspace(p_name text, p_owner_email text)
returns table(org_id uuid, invite_code text)
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_code text; v_slug text;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  v_slug := trim(both '-' from regexp_replace(lower(coalesce(p_name,'workspace')), '[^a-z0-9]+', '-', 'g')) || '-' || substr(md5(random()::text),1,4);
  insert into orgs(name, slug) values (p_name, v_slug) returning id into v_org;
  v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  insert into invites(org_id, code, role, label, email)
    values (v_org, v_code, 'admin', coalesce(p_owner_email, 'workspace owner'), p_owner_email);
  return query select v_org, v_code;
end $$;

create or replace function admin_decide_request(p_id uuid, p_approve boolean)
returns table(org_id uuid, invite_code text)
language plpgsql security definer set search_path = public as $$
declare r workspace_requests; v_org uuid; v_code text; v_slug text;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select * into r from workspace_requests where id = p_id;
  if not found then raise exception 'request not found'; end if;
  if p_approve then
    v_slug := trim(both '-' from regexp_replace(lower(coalesce(r.org_name,'workspace')), '[^a-z0-9]+', '-', 'g')) || '-' || substr(md5(random()::text),1,4);
    insert into orgs(name, slug) values (r.org_name, v_slug) returning id into v_org;
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    insert into invites(org_id, code, role, label, email)
      values (v_org, v_code, 'admin', coalesce(r.email, 'workspace owner'), r.email);
    update workspace_requests set status = 'approved', org_id = v_org, invite_code = v_code,
      decided_at = now(), decided_by = auth.jwt() ->> 'email' where id = p_id;
    return query select v_org, v_code;
  else
    update workspace_requests set status = 'denied', decided_at = now(),
      decided_by = auth.jwt() ->> 'email' where id = p_id;
    return query select null::uuid, null::text;
  end if;
end $$;
