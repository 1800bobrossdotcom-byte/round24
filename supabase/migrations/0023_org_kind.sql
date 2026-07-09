-- ============================================================
-- Caliper — schema v23: org kind (company vs owner)
-- Two personas share one secure backend:
--   'company' — office + crews (Evolution24): full operations suite
--   'owner'   — a landlord with a handful of properties: a streamlined
--               portfolio experience (rent roll, calendar, maintenance,
--               expenses) with no crew/dispatch/team apparatus.
-- The owner is still 'admin' of their own small workspace; kind only shapes
-- the UI. Defaults to 'company' so existing tenants are unchanged.
-- ============================================================

alter table orgs add column if not exists kind text not null default 'company';
alter table workspace_requests add column if not exists kind text default 'company';
alter table workspace_requests add column if not exists contact_name text;

-- beta-invite requests can come from anyone, even before they have an account
-- (a public waitlist the superadmin approves). Email is required; superadmin
-- reads them all. Authenticated no-org users use the same path.
drop policy if exists wr_insert on workspace_requests;
create policy wr_insert on workspace_requests for insert with check (email is not null);

-- provisioning carries the chosen kind through
drop function if exists admin_create_workspace(text, text);
create or replace function admin_create_workspace(p_name text, p_owner_email text, p_kind text default 'company')
returns table(org_id uuid, invite_code text)
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_code text; v_slug text;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  v_slug := trim(both '-' from regexp_replace(lower(coalesce(p_name,'workspace')), '[^a-z0-9]+', '-', 'g')) || '-' || substr(md5(random()::text),1,4);
  insert into orgs(name, slug, kind) values (p_name, v_slug, coalesce(nullif(p_kind,''),'company')) returning id into v_org;
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
    insert into orgs(name, slug, kind) values (r.org_name, v_slug, coalesce(r.kind,'company')) returning id into v_org;
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
