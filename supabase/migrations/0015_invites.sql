-- ============================================================
-- Round24 — schema v15: invite-based onboarding
-- An org admin/manager generates a role-scoped invite; the invitee signs up
-- through it and is placed into the org with that role (office vs contractor).
-- Whitelabel: invite links use the client's own domain.
-- ============================================================

create table invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  code        text not null unique,
  role        text not null check (role in ('admin', 'manager', 'tech', 'viewer')),
  label       text,                                   -- name / note for the seat
  email       text,                                   -- optional intended recipient
  created_by  uuid references auth.users(id) default auth.uid(),
  used_by     uuid references auth.users(id),
  used_at     timestamptz,
  expires_at  timestamptz,
  created_at  timestamptz default now()
);
alter table invites enable row level security;

-- staff manage invites for their org; the invitee redeems via the function below
create policy inv_staff on invites for all
  using (is_org_staff(org_id)) with check (is_org_staff(org_id));

-- redeem an invite → create a membership for the current user with its role.
-- SECURITY DEFINER so a not-yet-member can be placed into the org safely; the
-- code is the gate. One-time use, honors expiry, idempotent if already a member.
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
  insert into memberships (org_id, user_id, role) values (inv.org_id, auth.uid(), inv.role);
  update invites set used_by = auth.uid(), used_at = now() where id = inv.id;
  return query select inv.org_id, inv.role;
end $$;
grant execute on function redeem_invite(text) to authenticated;

-- staff: list everyone with access to my org (email + role)
create or replace function org_members()
returns table(user_id uuid, email text, role text, joined timestamptz)
language sql security definer set search_path = public as $$
  select m.user_id, u.email::text, m.role, m.created_at
  from memberships m join auth.users u on u.id = m.user_id
  where m.org_id in (select org_id from memberships
                     where user_id = auth.uid() and role in ('admin', 'manager'))
  order by m.created_at
$$;
grant execute on function org_members() to authenticated;
