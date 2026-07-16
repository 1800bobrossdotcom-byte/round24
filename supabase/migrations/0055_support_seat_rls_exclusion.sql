-- 0055_support_seat_rls_exclusion.sql
-- SECURITY FIX (audit Medium #12). Migration 0049 time-boxed layer1 "support"
-- seats inside current_user_orgs()/is_org_staff(), but several policies query
-- `memberships` INLINE and still honored an EXPIRED support seat (a real
-- memberships row with role='admin', is_support=true, support_expires in the
-- past) until platform_sweep_support() physically deleted it — and that sweep
-- only ran on console load / admin_join_workspace, so on a quiet deployment an
-- expired seat could retain tenant read/write for hours.
--
-- Fix: add the same expiry exclusion to EVERY inline memberships predicate, so
-- an expired support session grants nothing, immediately. A real seat has
-- is_support = false; a live support seat has a future support_expires.
-- (Definitions below reproduce each live policy exactly, plus the exclusion.)

drop policy if exists leases_read on leases;
create policy leases_read on leases for select using (
  org_id in (select org_id from memberships
             where user_id = auth.uid()
               and role = any (array['admin','manager','viewer'])
               and (is_support = false or support_expires > now())));

drop policy if exists org_admin_update on orgs;
create policy org_admin_update on orgs for update
  using (id in (select org_id from memberships
                where user_id = auth.uid() and role = 'admin'
                  and (is_support = false or support_expires > now())))
  with check (id in (select org_id from memberships
                     where user_id = auth.uid() and role = 'admin'
                       and (is_support = false or support_expires > now())));

drop policy if exists pur_tech_insert on purchases;
create policy pur_tech_insert on purchases for insert with check (
  created_by = auth.uid()
  and exists (select 1 from memberships m
              where m.org_id = purchases.org_id and m.user_id = auth.uid()
                and m.role = any (array['admin','manager','tech'])
                and (m.is_support = false or m.support_expires > now())));

drop policy if exists units_owner_read on units;
create policy units_owner_read on units for select using (
  org_id in (select org_id from memberships
             where user_id = auth.uid() and role = 'viewer'
               and (is_support = false or support_expires > now())));

drop policy if exists vendor_products_read on vendor_products;
create policy vendor_products_read on vendor_products for select using (
  org_id in (select org_id from memberships
             where user_id = auth.uid()
               and (is_support = false or support_expires > now())));

drop policy if exists vendors_read on vendors;
create policy vendors_read on vendors for select using (
  org_id in (select org_id from memberships
             where user_id = auth.uid()
               and (is_support = false or support_expires > now())));

drop policy if exists vendors_member_insert on vendors;
create policy vendors_member_insert on vendors for insert with check (
  org_id in (select org_id from memberships
             where user_id = auth.uid()
               and (is_support = false or support_expires > now()))
  and approved = false);
