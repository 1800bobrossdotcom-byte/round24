-- ============================================================
-- Field repair reports: let the crew REPORT a repair from the field as a
-- pending work order that office then triages (assign a vendor, set priority,
-- approve → open). Before this, only staff could create work orders, so a crew
-- member who found a fault had to text the office — losing the photo, the
-- history, and the vendor hand-off.
-- ============================================================

-- 1) a new 'pending' state for a crew report awaiting office triage
alter table work_orders drop constraint if exists work_orders_status_check;
alter table work_orders add constraint work_orders_status_check
  check (status in ('pending','open','in_progress','done','cancelled'));

-- 2) stamp the creator automatically so a tech can see the reports they filed
alter table work_orders alter column created_by set default auth.uid();

-- 3) a tech may CREATE a pending report for their org — but not open/assigned
--    work (that stays office's job). Constrained to status='pending', no assignee.
drop policy if exists wo_tech_report on work_orders;
create policy wo_tech_report on work_orders for insert
  with check (
    org_id in (select current_user_orgs())
    and status = 'pending'
    and assigned_operator_id is null
  );

-- 4) a tech also sees the reports they created (until office assigns them),
--    on top of the work orders assigned to them
drop policy if exists wo_tech_read on work_orders;
create policy wo_tech_read on work_orders for select
  using (
    assigned_operator_id in (select current_operator_ids())
    or created_by = auth.uid()
  );
