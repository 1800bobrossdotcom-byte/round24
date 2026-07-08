-- ============================================================
-- Caliper — schema v18: availability, audit log, compliance visibility
-- - availability: crew set on-shift / off / PTO; office sees it on the board.
-- - audit_log: append-only record of sensitive actions (staff-readable).
-- - org_member_compliance(): lets staff see contractor certs / W-9 / emergency
--   contact for payroll & compliance (own settings stay private otherwise).
-- ============================================================

-- ---- availability (who's working / off / PTO) ----
create table availability (
  org_id     uuid not null references orgs(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label      text,
  status     text not null default 'active' check (status in ('active', 'off', 'pto')),
  note       text,
  updated_at timestamptz default now(),
  primary key (org_id, user_id)
);
alter table availability enable row level security;
create policy av_read on availability for select using (org_id in (select current_user_orgs()));
create policy av_write on availability for all
  using (user_id = auth.uid())
  with check (org_id in (select current_user_orgs()) and user_id = auth.uid());
alter publication supabase_realtime add table availability;

-- ---- audit log (append-only; inserted only via the function below) ----
create table audit_log (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  user_id    uuid references auth.users(id),
  actor      text,
  action     text not null,
  target     text,
  meta       jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
alter table audit_log enable row level security;
create policy audit_read on audit_log for select using (is_org_staff(org_id));
-- no insert policy → only the SECURITY DEFINER function can write (unforgeable actor)

create or replace function log_audit(p_org uuid, p_action text, p_target text, p_actor text default null, p_meta jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_org not in (select org_id from memberships where user_id = auth.uid()) then return; end if;
  insert into audit_log (org_id, user_id, actor, action, target, meta)
  values (p_org, auth.uid(), p_actor, p_action, p_target, coalesce(p_meta, '{}'::jsonb));
end $$;
grant execute on function log_audit(uuid, text, text, text, jsonb) to authenticated;

-- ---- staff compliance visibility over contractor records ----
create or replace function org_member_compliance()
returns table(user_id uuid, email text, role text, certs jsonb, tax jsonb, emergency jsonb, updated timestamptz)
language sql security definer set search_path = public as $$
  select m.user_id, u.email::text, m.role,
    coalesce(us.data -> 'certs', '[]'::jsonb),
    coalesce(us.data -> 'tax', 'null'::jsonb),
    coalesce(us.data -> 'emergency', 'null'::jsonb),
    us.updated_at
  from memberships m
  join auth.users u on u.id = m.user_id
  left join user_settings us on us.user_id = m.user_id
  where m.org_id in (select org_id from memberships
                     where user_id = auth.uid() and role in ('admin', 'manager'))
  order by m.created_at
$$;
grant execute on function org_member_compliance() to authenticated;
