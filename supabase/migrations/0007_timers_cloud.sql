-- ============================================================
-- Round24 — schema v7: cloud-persisted field timers
-- Crew timer sessions write to the timers table so management sees
-- hours without touching the crew's device. Property stays a label
-- until properties are RM-synced; the work-order link is the start
-- of true job cost (labor + materials per WO).
-- ============================================================

alter table timers add column property_label text;
alter table timers add column work_order_id uuid references work_orders(id) on delete set null;
alter table timers add column source text default 'timer';   -- timer | import | manual

create index timers_wo on timers(work_order_id);
