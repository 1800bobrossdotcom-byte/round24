-- ============================================================
-- Caliper — schema v16: self-serve workspace (tenant) provisioning
-- A brand-new company owner signs up and creates their own workspace, becoming
-- its admin. This is how new whitelabel customers onboard without a manual DB
-- step. Admins can also rename their workspace.
-- ============================================================

-- create a new org and make the caller its admin, atomically.
-- SECURITY DEFINER because a not-yet-member can't insert into orgs under RLS.
create or replace function create_org(org_name text, org_slug text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid; s text;
begin
  if coalesce(trim(org_name), '') = '' then raise exception 'workspace name required'; end if;
  s := coalesce(nullif(trim(org_slug), ''), lower(regexp_replace(org_name, '[^a-zA-Z0-9]+', '-', 'g')));
  s := trim(both '-' from s);
  if s = '' then s := 'workspace'; end if;
  if exists (select 1 from orgs where slug = s) then
    s := s || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 4);
  end if;
  insert into orgs (name, slug) values (trim(org_name), s) returning id into new_id;
  insert into memberships (org_id, user_id, role) values (new_id, auth.uid(), 'admin');
  return new_id;
end $$;
grant execute on function create_org(text, text) to authenticated;

-- admins can rename / rebrand their own workspace
create policy org_admin_update on orgs for update
  using (id in (select org_id from memberships where user_id = auth.uid() and role = 'admin'))
  with check (id in (select org_id from memberships where user_id = auth.uid() and role = 'admin'));
