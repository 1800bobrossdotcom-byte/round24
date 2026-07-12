-- ============================================================
-- Deactivate operators who no longer work here (e.g. left the company) without
-- erasing their labor history. A set of operator ids { "<techId>": true } that
-- rides the same per-org labor_state document. Their past timers still count in
-- every historical rollup (Team, dashboards, per-door P&L); they're just dropped
-- from the ACTIVE roster — no new assignments, DMs, or availability. Reversible.
-- Unlike the pay-bearing blobs alongside it, this is only ids → plain jsonb.
-- ============================================================

alter table labor_state add column if not exists inactive_ops jsonb;
