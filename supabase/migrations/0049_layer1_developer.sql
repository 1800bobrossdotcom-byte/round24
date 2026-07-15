-- 0049_layer1_developer.sql
-- Layer 1 — Developer layer (task02: fresh build per the task01 3-layer
-- restructure). This supersedes the old 0046 two-layer patch, which never
-- merged — nothing here reuses that patch's migration.
--
-- Numbered 0049 because 0046-0048 are already taken on main as of this
-- writing (0046_public_intake_guardrails, 0047_public_org_properties,
-- 0048_residents_slice1). Confirm that's still true before applying —
-- rename if main has moved again.
--
-- Security model (unchanged from 0022/0027): no broad RLS grants. Every
-- cross-tenant read/write is a SECURITY DEFINER function gated on
-- is_platform_admin() (already exists on main — reused, not redefined here),
-- and every gated call writes to platform_audit.
--
-- ***SCHEMA NOTES (verified against migrations 0001-0048 before commit)***
-- The original draft was written from GitHub reads, not a live `\d`. These
-- corrections were applied after checking the real schema:
--   * workspace_requests: name was correct as drafted (0022/0023).
--   * platform_admins is keyed by EMAIL (0022: email text primary key), not
--     user_id — the four allowlist functions below are email-based.
--   * platform_audit ALREADY EXISTS (0027: id, at, actor text, action,
--     detail text) — reused with one added `target jsonb` column instead of
--     the drafted new table; actor stays the caller's email (0027 convention)
--     and ordering uses `at`, not `created_at`.
--   * current_user_orgs() (0001) and is_org_staff() (0002) would have counted
--     an expired is_support row as a real seat — redefined below with the
--     exclusion, as would the mem_read policy (0001) that feeds the client's
--     fetchMembership().
--   * "open" work orders = status in ('open','in_progress'); the drafted
--     `<> 'done'` would have counted cancelled orders (0002 status domain).
--   * _platform_log / platform_sweep_support get explicit revokes — Supabase
--     default-grants EXECUTE on new functions to anon+authenticated, which
--     would have let anyone forge audit rows (0046 intake_guard precedent).

-- ---------------------------------------------------------------------------
-- 1. Support sessions (time-boxed cross-tenant seats)
-- ---------------------------------------------------------------------------
alter table memberships add column if not exists is_support boolean not null default false;
alter table memberships add column if not exists support_expires timestamptz;
create index if not exists memberships_support on memberships(support_expires) where is_support;

-- An expired (or expiry-less) support row must never count as a seat. These
-- two helpers back most RLS policies, so redefining them covers the bulk of
-- the app; mem_read below covers the client's own-membership reads
-- (fetchMembership). KNOWN RESIDUAL: a handful of older policies/functions
-- query memberships directly (org_admin_update 0016, vendors 0026/0039,
-- pur_tech_insert 0027, leases 0021, org_members 0015, log_audit 0018,
-- ai_quota_bump 0028) and only stop honoring an expired seat once
-- platform_sweep_support() physically deletes the row — rebinding those
-- belongs in a dedicated follow-up migration, not this delivery.
-- Bodies otherwise identical to 0001/0002, plus the search_path pin 0027
-- established for definer functions.
create or replace function current_user_orgs()
returns setof uuid language sql stable security definer set search_path = public as $$
  select org_id from memberships
  where user_id = auth.uid()
    and (is_support = false or support_expires > now())
$$;

create or replace function is_org_staff(oid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships
    where org_id = oid and user_id = auth.uid() and role in ('admin','manager')
      and (is_support = false or support_expires > now())
  );
$$;

drop policy if exists mem_read on memberships;
create policy mem_read on memberships for select
  using (user_id = auth.uid() and (is_support = false or support_expires > now()));

-- Sweep is belt-and-suspenders: the exclusions above already fail closed, this
-- just clears the dead rows. Runs at the top of admin_join_workspace and on
-- console load. Null-expiry support rows are treated as already expired.
create or replace function platform_sweep_support()
returns void
language sql
security definer set search_path = public
as $$
  delete from memberships where is_support and (support_expires is null or support_expires <= now());
$$;

-- ---------------------------------------------------------------------------
-- 2. platform_flags — global UI/UX control (this is Layer 1's "design" surface)
-- ---------------------------------------------------------------------------
create table if not exists platform_flags (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);
alter table platform_flags enable row level security;

drop policy if exists platform_flags_read on platform_flags;
create policy platform_flags_read on platform_flags
  for select to anon, authenticated using (true);
-- deliberately no insert/update/delete policy — writes only via
-- admin_set_platform_flag() below, so every change is audited. Anon-readable
-- by design: never put secrets in this table.

-- ---------------------------------------------------------------------------
-- 3. platform_audit — reuse 0027's cross-tenant audit trail
--    (distinct from log_audit/audit_log, which is per-org). The table and its
--    admin-read policy already exist; we only add a structured target column.
-- ---------------------------------------------------------------------------
alter table platform_audit add column if not exists target jsonb;

create or replace function _platform_log(p_action text, p_target jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into platform_audit (actor, action, target) values (auth.jwt() ->> 'email', p_action, p_target);
$$;

-- ---------------------------------------------------------------------------
-- 4. Gated, audited, cross-tenant functions
--    is_platform_admin() already exists — reused as the single gate everywhere.
-- ---------------------------------------------------------------------------

create or replace function admin_platform_overview()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select jsonb_build_object(
    'orgs', (select count(*) from orgs),
    'members', (select count(*) from memberships where is_support = false),
    'residents', (select count(*) from residents),
    'open_work_orders', (select count(*) from work_orders where status in ('open','in_progress')),
    'pending_workspace_requests', (select count(*) from workspace_requests where status = 'pending'),
    'pending_deletion_requests', (select count(*) from deletion_requests where status = 'pending'),
    'live_support_sessions', (select count(*) from memberships where is_support = true and support_expires > now())
  ) into r;
  perform _platform_log('view_overview');
  return r;
end $$;

-- drop + recreate: return shape is richer than 0022's (id, name, created_at,
-- members). Existing caller (Platform.jsx via adminListOrgs) reads only those
-- four fields, so this stays source-compatible; ordering kept from 0022.
-- Every table in the correlated subqueries is aliased because the
-- returns-table columns (created_at, ...) are plpgsql variables and would
-- make unqualified references ambiguous.
drop function if exists admin_list_orgs();
create function admin_list_orgs()
returns table (
  id uuid, name text, kind text, created_at timestamptz,
  members bigint, properties bigint, open_orders bigint, last_activity timestamptz
) language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  perform _platform_log('list_orgs');
  return query
    select o.id, o.name, o.kind, o.created_at,
      (select count(*) from memberships m where m.org_id = o.id and m.is_support = false),
      (select count(*) from properties p where p.org_id = o.id),
      (select count(*) from work_orders w where w.org_id = o.id and w.status in ('open','in_progress')),
      (select max(x.ts) from (
        select max(w2.created_at) ts from work_orders w2 where w2.org_id = o.id
        union all select max(ms.created_at) from messages ms where ms.org_id = o.id
      ) x)
    from orgs o
    order by o.created_at desc;
end $$;

create or replace function admin_org_detail(p_org uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select jsonb_build_object(
    'org', (select to_jsonb(o) from orgs o where o.id = p_org),
    'members', (select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'role', m.role, 'is_support', m.is_support,
        'support_expires', m.support_expires, 'email', u.email
      )), '[]'::jsonb)
      from memberships m join auth.users u on u.id = m.user_id where m.org_id = p_org)
  ) into r;
  perform _platform_log('view_org_detail', jsonb_build_object('org_id', p_org));
  return r;
end $$;

-- role/removal management applies to real seats only — support seats are
-- owned exclusively by admin_join_workspace / admin_leave_workspace.
create or replace function admin_set_member_role(p_org uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if p_role not in ('admin','manager','tech','viewer') then raise exception 'invalid role'; end if;
  update memberships set role = p_role
    where org_id = p_org and user_id = p_user and is_support = false;
  perform _platform_log('set_member_role', jsonb_build_object('org_id', p_org, 'user_id', p_user, 'role', p_role));
end $$;

create or replace function admin_remove_member(p_org uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  delete from memberships where org_id = p_org and user_id = p_user and is_support = false;
  perform _platform_log('remove_member', jsonb_build_object('org_id', p_org, 'user_id', p_user));
end $$;

create or replace function admin_create_invite(p_org uuid, p_role text, p_email text default null, p_label text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  insert into invites (org_id, role, email, label, code) values (p_org, p_role, p_email, p_label, v_code);
  perform _platform_log('create_invite', jsonb_build_object('org_id', p_org, 'role', p_role));
  return v_code;
end $$;

create or replace function admin_join_workspace(p_org uuid, p_hours int default 4)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_hours int; v_expires timestamptz;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  perform platform_sweep_support();
  if exists (select 1 from memberships where org_id = p_org and user_id = auth.uid() and is_support = false) then
    raise exception 'you already hold a real seat in this org — no support session needed';
  end if;
  v_hours := greatest(1, least(24, coalesce(p_hours, 4)));
  v_expires := now() + (v_hours || ' hours')::interval;
  -- the WHERE on the upsert means a real seat can never be converted to a
  -- support seat, even if one appears between the check above and here.
  insert into memberships (org_id, user_id, role, is_support, support_expires)
    values (p_org, auth.uid(), 'admin', true, v_expires)
    on conflict (org_id, user_id) do update
      set is_support = true, role = 'admin', support_expires = excluded.support_expires
      where memberships.is_support = true;
  perform _platform_log('join_workspace_support', jsonb_build_object('org_id', p_org, 'expires', v_expires));
  return jsonb_build_object('org_id', p_org, 'expires', v_expires);
end $$;

create or replace function admin_leave_workspace(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  -- deliberately ungated: deletes only the caller's own support row — a
  -- no-op for anyone else, and logged only when it actually did something.
  delete from memberships where org_id = p_org and user_id = auth.uid() and is_support = true;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform _platform_log('leave_workspace_support', jsonb_build_object('org_id', p_org));
  end if;
end $$;

create or replace function admin_list_users()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', u.id, 'email', u.email, 'confirmed', u.email_confirmed_at is not null,
      'last_sign_in', u.last_sign_in_at,
      'is_admin', exists(select 1 from platform_admins pa where lower(pa.email) = lower(u.email)),
      'memberships', (select coalesce(jsonb_agg(jsonb_build_object('org_id', m.org_id, 'role', m.role)), '[]'::jsonb)
        from memberships m where m.user_id = u.id)
    )), '[]'::jsonb) into r
  from auth.users u;
  perform _platform_log('list_users');
  return r;
end $$;

-- The allowlist itself. Left join: a seeded email with no confirmed account
-- yet still shows on the roster (user_id null, active false).
create or replace function admin_list_platform_admins()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', u.id, 'email', pa.email, 'added_at', pa.added_at,
      'active', u.id is not null and u.email_confirmed_at is not null
    )), '[]'::jsonb) into r
  from platform_admins pa left join auth.users u on lower(u.email) = lower(pa.email);
  return r;
end $$;

create or replace function admin_add_platform_admin(p_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  -- typo guard; is_platform_admin() only activates on a confirmed user anyway
  if not exists (select 1 from auth.users u where lower(u.email) = lower(p_email)) then
    raise exception 'no user with that email';
  end if;
  insert into platform_admins (email) values (lower(p_email)) on conflict do nothing;
  perform _platform_log('add_platform_admin', jsonb_build_object('email', lower(p_email)));
end $$;

create or replace function admin_remove_platform_admin(p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare v_active int; v_sessions int;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if lower(p_email) = lower(coalesce((select u.email from auth.users u where u.id = auth.uid()), '')) then
    raise exception 'cannot remove yourself';
  end if;
  -- serialize removals: without this, two admins removing each other
  -- concurrently would both pass the count below and lock everyone out.
  lock table platform_admins in share row exclusive mode;
  -- lockout guard counts ACTIVE admins (confirmed accounts), not raw allowlist
  -- rows — a dead seed email must not satisfy the "someone is left" check.
  select count(*) into v_active
    from platform_admins pa
    join auth.users u on lower(u.email) = lower(pa.email) and u.email_confirmed_at is not null
    where lower(pa.email) <> lower(p_email);
  if v_active < 1 then raise exception 'cannot remove the last active platform admin'; end if;
  delete from platform_admins where lower(email) = lower(p_email);
  -- revoking the allowlist seat must also cut any live support sessions the
  -- removed admin still holds — otherwise they keep tenant-admin RLS access
  -- until those seats expire. Real (is_support = false) seats are untouched.
  delete from memberships m
    using auth.users u
    where m.user_id = u.id and lower(u.email) = lower(p_email) and m.is_support;
  get diagnostics v_sessions = row_count;
  perform _platform_log('remove_platform_admin',
    jsonb_build_object('email', lower(p_email), 'support_sessions_ended', v_sessions));
end $$;

create or replace function admin_set_platform_flag(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  insert into platform_flags (key, value, updated_by) values (p_key, p_value, auth.uid())
    on conflict (key) do update set value = p_value, updated_at = now(), updated_by = auth.uid();
  perform _platform_log('set_platform_flag', jsonb_build_object('key', p_key));
end $$;

create or replace function admin_list_audit(p_limit int default 200)
returns setof platform_audit language sql stable security definer set search_path = public as $$
  select * from platform_audit
  where is_platform_admin()
  order by at desc limit greatest(1, least(1000, coalesce(p_limit, 200)));
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants — explicit per-function, nothing blanket. The revokes matter:
--    Supabase default-grants EXECUTE on new public functions to anon and
--    authenticated, so without them _platform_log would be a public
--    audit-forgery endpoint (same reasoning as 0046's intake_guard revoke).
-- ---------------------------------------------------------------------------
revoke execute on function _platform_log(text, jsonb) from public, anon, authenticated;
revoke execute on function platform_sweep_support() from public, anon;

grant execute on function admin_platform_overview() to authenticated;
grant execute on function admin_list_orgs() to authenticated;
grant execute on function admin_org_detail(uuid) to authenticated;
grant execute on function admin_set_member_role(uuid, uuid, text) to authenticated;
grant execute on function admin_remove_member(uuid, uuid) to authenticated;
grant execute on function admin_create_invite(uuid, text, text, text) to authenticated;
grant execute on function admin_join_workspace(uuid, int) to authenticated;
grant execute on function admin_leave_workspace(uuid) to authenticated;
grant execute on function admin_list_users() to authenticated;
grant execute on function admin_list_platform_admins() to authenticated;
grant execute on function admin_add_platform_admin(text) to authenticated;
grant execute on function admin_remove_platform_admin(text) to authenticated;
grant execute on function admin_set_platform_flag(text, jsonb) to authenticated;
grant execute on function admin_list_audit(int) to authenticated;
grant execute on function platform_sweep_support() to authenticated;
