-- ============================================================
-- Round24 — schema v27: security hardening from the red/blue/white/grey audit
--  1. docs storage read must honor visibility (staff-only docs were readable)
--  2. read-only viewers must not be able to submit purchases
--  3. workspace_requests insert re-bound (not forgeable / pre-approvable)
--  4. invites get a default expiry
--  5. redeem_invite binds an addressed invite to its named recipient
--  6. invite_info stops leaking org name to anon (validity + kind only)
--  7. is_platform_admin requires a CONFIRMED account matched by uid (no email-claim spoof)
--  8. platform-admin cross-tenant actions are now audit-logged
-- ============================================================

-- 1. docs storage read must honor documents.visibility ---------------------
drop policy if exists "docs read" on storage.objects;
create policy "docs read" on storage.objects for select to authenticated
  using (
    bucket_id = 'docs' and (
      is_org_staff((split_part(name, '/', 1))::uuid)
      or exists (
        select 1 from documents d
        where d.path = storage.objects.name
          and d.visibility = 'org'
          and d.org_id in (select current_user_orgs())
      )
    )
  );

-- 2. purchases: only field roles (admin/manager/tech), never a read-only viewer
drop policy if exists pur_tech_insert on purchases;
create policy pur_tech_insert on purchases for insert
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from memberships m
      where m.org_id = purchases.org_id and m.user_id = auth.uid()
        and m.role in ('admin', 'manager', 'tech')
    )
  );

-- 3. workspace_requests: public waitlist, but not forgeable / self-approvable
drop policy if exists wr_insert on workspace_requests;
create policy wr_insert on workspace_requests for insert
  with check (
    email is not null
    and (requester_id is null or requester_id = auth.uid())
    and coalesce(status, 'pending') = 'pending'
    and org_id is null and invite_code is null and decided_by is null
  );

-- 4. invites default to a 14-day expiry (admin functions omit it → default applies)
alter table invites alter column expires_at set default (now() + interval '14 days');

-- 5. redeem_invite: an addressed invite is only redeemable by that address
create or replace function redeem_invite(invite_code text)
returns table(org_id uuid, role text)
language plpgsql security definer set search_path = public as $$
declare inv invites;
begin
  select * into inv from invites where code = invite_code;
  if inv.id is null then raise exception 'invalid invite'; end if;
  if inv.expires_at is not null and inv.expires_at < now() then raise exception 'invite expired'; end if;

  if exists (select 1 from memberships m where m.org_id = inv.org_id and m.user_id = auth.uid()) then
    update invites set used_by = auth.uid(), used_at = now() where id = inv.id and used_at is null;
    return query select inv.org_id, inv.role; return;
  end if;

  if inv.used_at is not null then raise exception 'invite already used'; end if;
  -- addressed invite → only the named recipient may claim it
  if inv.email is not null and lower(inv.email) <> lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'invite is for a different email';
  end if;
  insert into memberships (org_id, user_id, role) values (inv.org_id, auth.uid(), inv.role);
  update invites set used_by = auth.uid(), used_at = now() where id = inv.id;
  return query select inv.org_id, inv.role;
end $$;
grant execute on function redeem_invite(text) to authenticated;

-- 6. invite_info: no org-name oracle for anon; return validity + kind only
drop function if exists invite_info(text);
create or replace function invite_info(p_code text)
returns table(valid boolean, kind text)
language sql security definer set search_path = public as $$
  select
    (i.id is not null and i.used_at is null and (i.expires_at is null or i.expires_at > now())) as valid,
    o.kind
  from invites i join orgs o on o.id = i.org_id
  where upper(i.code) = upper(trim(p_code))
  limit 1;
$$;
grant execute on function invite_info(text) to anon, authenticated;

-- 7. platform-admin gate: match the CALLER (auth.uid()) to an allowlisted email
--    via a CONFIRMED auth.users row. Closes the "sign up as the admin email
--    without confirming" spoof and never trusts a raw JWT email claim.
create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from platform_admins pa
    join auth.users u on lower(u.email) = lower(pa.email)
    where u.id = auth.uid() and u.email_confirmed_at is not null
  );
$$;

-- 8. platform-admin audit trail (cross-tenant provisioning was unlogged)
create table if not exists platform_audit (
  id     bigint generated always as identity primary key,
  at     timestamptz default now(),
  actor  text,
  action text not null,
  detail text
);
alter table platform_audit enable row level security;
drop policy if exists platform_audit_read on platform_audit;
create policy platform_audit_read on platform_audit for select using (is_platform_admin());

create or replace function public.admin_create_workspace(p_name text, p_owner_email text, p_kind text default 'company')
returns table(org_id uuid, invite_code text)
language plpgsql security definer set search_path = public as $function$
declare v_org uuid; v_code text; v_slug text;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  v_slug := trim(both '-' from regexp_replace(lower(coalesce(p_name,'workspace')), '[^a-z0-9]+', '-', 'g')) || '-' || substr(md5(random()::text),1,4);
  insert into orgs(name, slug, kind) values (p_name, v_slug, coalesce(nullif(p_kind,''),'company')) returning id into v_org;
  v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  insert into invites(org_id, code, role, label, email)
    values (v_org, v_code, 'admin', coalesce(p_owner_email, 'workspace owner'), p_owner_email);
  insert into platform_audit(actor, action, detail)
    values (auth.jwt() ->> 'email', 'create_workspace',
            p_name || ' [' || coalesce(p_kind,'company') || ']' || coalesce(' -> ' || p_owner_email, ''));
  return query select v_org, v_code;
end $function$;

create or replace function public.admin_decide_request(p_id uuid, p_approve boolean)
returns table(org_id uuid, invite_code text)
language plpgsql security definer set search_path = public as $function$
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
    insert into platform_audit(actor, action, detail)
      values (auth.jwt() ->> 'email', 'approve_request', coalesce(r.org_name,'') || ' -> ' || coalesce(r.email,''));
    return query select v_org, v_code;
  else
    update workspace_requests set status = 'denied', decided_at = now(),
      decided_by = auth.jwt() ->> 'email' where id = p_id;
    insert into platform_audit(actor, action, detail)
      values (auth.jwt() ->> 'email', 'deny_request', coalesce(r.org_name,'') || ' / ' || coalesce(r.email,''));
    return query select null::uuid, null::text;
  end if;
end $function$;
