-- ============================================================
-- Round24 — schema v39: let crew add a vendor from the field (pending approval)
-- A vendor often shows up on-site while the crew is there. Allow any org member
-- to INSERT a vendor, but only as PENDING (approved = false); the office still
-- owns update/approve/delete via the existing staff-only vendors_write policy.
-- Reads are already open to all org members (vendors_read).
-- ============================================================

drop policy if exists vendors_member_insert on vendors;
create policy vendors_member_insert on vendors for insert
  with check (
    org_id in (select org_id from memberships where user_id = auth.uid())
    and approved = false
  );
