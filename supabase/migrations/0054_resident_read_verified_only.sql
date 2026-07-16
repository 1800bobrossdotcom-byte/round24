-- 0054_resident_read_verified_only.sql
-- SECURITY FIX (audit High #2). The resident-facing read policies admitted a
-- residency in status ('pending','verified'). Because res_self_insert (0048)
-- lets ANY authenticated user self-insert a *pending* residency for ANY org_id
-- (org UUIDs are handed out openly via /?join=<uuid>), a pending claim was
-- enough to read another org's building handbooks (emergency procedures, staff
-- contacts, access notes), announcements, and amenities — and to inject
-- amenity bookings into that org's queue. The office "verify" step gated
-- nothing that was actually read.
--
-- Fix: require status = 'verified' for every resident READ and for the
-- resident booking INSERT. A pending resident can still be created and can
-- report a maintenance request (that path checks residency identity in the
-- maintenance_requests guard), but cannot read org content until the office
-- verifies them against the lease.

-- announcements (0048)
drop policy if exists ann_resident_read on org_announcements;
create policy ann_resident_read on org_announcements for select using (
  exists (select 1 from residents r
          where r.user_id = auth.uid() and r.org_id = org_announcements.org_id
            and r.status = 'verified')
);

-- building handbooks (0051)
drop policy if exists hb_resident_read on building_handbooks;
create policy hb_resident_read on building_handbooks for select using (
  exists (select 1 from residents r
          where r.user_id = auth.uid() and r.org_id = building_handbooks.org_id
            and r.status = 'verified')
);

-- amenities: read (0052)
drop policy if exists amen_resident_read on amenities;
create policy amen_resident_read on amenities for select using (
  exists (select 1 from residents r
          where r.user_id = auth.uid() and r.org_id = amenities.org_id
            and r.status = 'verified')
);

-- amenity bookings: a resident may only request a booking once verified
drop policy if exists ambk_self_insert on amenity_bookings;
create policy ambk_self_insert on amenity_bookings for insert with check (
  created_by = auth.uid()
  and exists (select 1 from residents r
              where r.user_id = auth.uid() and r.org_id = amenity_bookings.org_id
                and r.status = 'verified')
);
