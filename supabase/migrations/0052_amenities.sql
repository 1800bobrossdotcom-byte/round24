-- 0052_amenities.sql
-- Amenity Reservations — bookable shared spaces (conference room, roof deck,
-- laundry, community room…) and the bookings against them. Staff define the
-- spaces and confirm requests; residents/tenants read the spaces and request
-- their own bookings. Same org-scoped, deny-by-default model as the rest.

create table if not exists amenities (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  building          text,
  name              text not null,
  description       text,
  capacity          int,
  hours             text,                 -- freeform, e.g. "7:00a–10:00p"
  requires_approval boolean not null default true,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);
create index if not exists amenities_org on amenities(org_id);
alter table amenities enable row level security;

drop policy if exists amen_staff on amenities;
create policy amen_staff on amenities for all
  using (is_org_staff(org_id)) with check (is_org_staff(org_id));

drop policy if exists amen_resident_read on amenities;
create policy amen_resident_read on amenities for select using (
  exists (select 1 from residents r
          where r.user_id = auth.uid() and r.org_id = amenities.org_id
            and r.status in ('pending','verified'))
);

create table if not exists amenity_bookings (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  amenity_id  uuid not null references amenities(id) on delete cascade,
  resident_id uuid references residents(id) on delete set null,
  booked_by   text,                 -- name (denormalized; staff may book on behalf)
  building    text,
  unit        text,
  date        date not null,
  start_time  text,                 -- 'HH:MM'
  end_time    text,
  status      text not null default 'pending' check (status in ('pending','confirmed','declined','cancelled')),
  notes       text,
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists ambk_org_date on amenity_bookings(org_id, date);
alter table amenity_bookings enable row level security;

-- staff manage every booking in their org
drop policy if exists ambk_staff on amenity_bookings;
create policy ambk_staff on amenity_bookings for all
  using (is_org_staff(org_id)) with check (is_org_staff(org_id));

-- a resident reads and creates only their own requests (created_by = self),
-- and only in an org where they actually hold a residency. Staff confirm them.
drop policy if exists ambk_self_read on amenity_bookings;
create policy ambk_self_read on amenity_bookings for select using (created_by = auth.uid());

drop policy if exists ambk_self_insert on amenity_bookings;
create policy ambk_self_insert on amenity_bookings for insert with check (
  created_by = auth.uid()
  and exists (select 1 from residents r
              where r.user_id = auth.uid() and r.org_id = amenity_bookings.org_id
                and r.status in ('pending','verified'))
);
