-- ============================================================
-- Round24 — schema v6: work-order priority + live task list
-- Admin reorders the queue by priority; crew task lists sort by it.
-- Realtime publication lets the crew's open app receive priority
-- changes and new assignments instantly (RLS still applies — a tech
-- only receives events for rows they can see).
-- ============================================================

alter table work_orders add column priority smallint not null default 3
  check (priority between 1 and 4);   -- 1 urgent · 2 high · 3 normal · 4 low

create index wo_priority on work_orders(org_id, status, priority);

alter publication supabase_realtime add table work_orders;
