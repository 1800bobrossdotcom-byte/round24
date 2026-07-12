-- ============================================================
-- Per-building P&L config in the cloud. The fixed P&L-statement inputs (taxes,
-- insurance, utilities, debt service, marketing, …) were localStorage-only, so
-- they couldn't be shared across the office or bulk-loaded from the Excel P&L
-- sheets. Ride the same per-org labor_state document that already carries the
-- imported spine + salaries; encrypted at rest (it reflects deal economics).
-- ============================================================

alter table labor_state add column if not exists plconfig bytea;
