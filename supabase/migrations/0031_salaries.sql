-- ============================================================
-- Caliper — schema v31: salaried operators.
-- A fixed salary per operator, dispersed across doors by logged-hours share.
-- Stored on the per-org labor_state document as an encrypted blob (it carries
-- pay), alongside the imported spine. The app degrades gracefully when this
-- column is absent, so applying the migration is what turns on cross-device
-- sync — nothing breaks before it lands.
-- ============================================================

alter table labor_state add column if not exists salaries bytea;  -- AES-256-GCM { techId: {amount, period} }
