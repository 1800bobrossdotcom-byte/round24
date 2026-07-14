-- ============================================================
-- Caliper — schema v48: Community Slice 1 ("Community Core")
-- Resident accounts bound to org + building + unit, an office verify queue,
-- resident-owned maintenance requests with live status, and read-only
-- announcements. Residents are a NEW auth audience with a hard wall: they can
-- see their own rows and their org's announcements — never the rent roll,
-- financials, labor, work orders, or other residents.
-- ============================================================

-- ---- residents: the identity spine (resident → building → org) ----
-- v1 binds by labels (consistent with the rest of the app); the office verifies
-- each claim against the lease. Lease-email auto-verify comes later (the rent
-- roll doesn't carry tenant emails yet).
create table if not exists residents (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  org_id         uuid not null references orgs(id) on delete cascade,
  property_label text,
  unit_label     text,
  display_name   text,
  email          text,
  status         text not null default 'pending'
                 check (status in ('pending','verified','declined','moved_out')),
  verified_by    uuid references auth.users(id),
  verified_at    timestamptz,
  created_at     timestamptz default now(),
  unique (user_id, org_id)
);
create index if not exists residents_org on residents(org_id, status);
alter table residents enable row level security;

-- a person sees + creates only their OWN residency; claims are always pending
-- (no self-update policy at all, so nobody can self-verify).
drop policy if exists res_self_select on residents;
create policy res_self_select on residents for select using (user_id = auth.uid());
drop policy if exists res_self_insert on residents;
create policy res_self_insert on residents for insert
  with check (user_id = auth.uid() and status = 'pending'
              and coalesce(length(display_name), 0) <= 120
              and coalesce(length(property_label), 0) <= 200
              and coalesce(length(unit_label), 0) <= 60);
-- office manages its org's residents (verify / decline / move-out)
drop policy if exists res_staff on residents;
create policy res_staff on residents for all
  using (is_org_staff(org_id)) with check (is_org_staff(org_id));

-- ---- announcements: office posts, residents read ----
create table if not exists org_announcements (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  title      text not null,
  body       text,
  urgent     boolean default false,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz default now()
);
create index if not exists ann_org on org_announcements(org_id, created_at desc);
alter table org_announcements enable row level security;
drop policy if exists ann_staff on org_announcements;
create policy ann_staff on org_announcements for all
  using (is_org_staff(org_id)) with check (is_org_staff(org_id));
drop policy if exists ann_resident_read on org_announcements;
create policy ann_resident_read on org_announcements for select using (
  exists (select 1 from residents r
          where r.user_id = auth.uid() and r.org_id = org_announcements.org_id
            and r.status in ('pending','verified'))
);

-- ---- requests carry their resident (nullable: anonymous intake still works) ----
alter table maintenance_requests add column if not exists
  resident_id uuid references residents(id) on delete set null;

-- guard v2: everything from 0046, plus resident_id integrity — an authed caller
-- may only stamp a residency THEY own; anonymous inserts never carry one.
create or replace function maintenance_requests_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.resident_id is not null then
    if auth.uid() is null then
      new.resident_id := null;   -- anon can't claim an identity
    elsif not exists (select 1 from residents r
                      where r.id = new.resident_id and r.user_id = auth.uid()) then
      raise exception 'resident identity mismatch';
    end if;
  end if;

  if auth.uid() is not null then return new; end if;   -- staff/residents: no anon caps

  if new.description is null or length(new.description) not between 1 and 4000 then
    raise exception 'description must be 1–4000 characters';
  end if;
  if length(coalesce(new.property_label, '')) > 200 or length(coalesce(new.unit, '')) > 60
     or length(coalesce(new.tenant_name, '')) > 200 or length(coalesce(new.tenant_contact, '')) > 200 then
    raise exception 'field too long';
  end if;
  if length(coalesce(new.photo, '')) > 1500000 then raise exception 'photo too large'; end if;
  if length(coalesce(new.voice, '')) > 2000000 then raise exception 'voice note too large'; end if;
  if new.photos is not null then
    if jsonb_typeof(new.photos) <> 'array' or jsonb_array_length(new.photos) > 6 then
      raise exception 'photos must be an array of at most 6';
    end if;
    if exists (select 1 from jsonb_array_elements_text(new.photos) p where length(p) > 1500000) then
      raise exception 'a photo is too large';
    end if;
  end if;

  perform intake_guard('mr:' || new.org_id::text, 20, 120);
  return new;
end $$;

-- ---- "My requests" with live work-order status ----
-- Residents can never read work_orders directly; this definer fn joins ONLY the
-- caller's own requests to their linked work order's status.
create or replace function get_my_requests()
returns table(id uuid, property_label text, unit text, description text,
              status text, wo_status text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select mr.id, mr.property_label, mr.unit, mr.description, mr.status,
         w.status as wo_status, mr.created_at
  from maintenance_requests mr
  left join work_orders w on w.id = mr.work_order_id
  where mr.resident_id in (select r.id from residents r where r.user_id = auth.uid())
  order by mr.created_at desc
  limit 100;
$$;
revoke all on function get_my_requests() from public, anon;
grant execute on function get_my_requests() to authenticated;
