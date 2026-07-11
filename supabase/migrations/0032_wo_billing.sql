-- ============================================================
-- Caliper — schema v32: tenant billing on work orders.
-- Replaces the spreadsheet "Service Log" columns: what we charge (service fee),
-- what the repair cost, and whether the tenant was billed. The app degrades
-- gracefully when these are absent, so applying this migration is what turns
-- billing persistence on — nothing breaks before it lands.
-- ============================================================

alter table work_orders add column if not exists service_fee  numeric(10,2);
alter table work_orders add column if not exists repair_cost   numeric(10,2);
alter table work_orders add column if not exists tenant_billed text default 'no';  -- no | billed | paid
