-- ============================================================
-- Caliper — schema v38: persist a receipt's actual purchase date
-- The OCR reads the date printed on the receipt, but until now only the row's
-- insert timestamp (created_at) was stored. The monthly P&L then attributed a
-- receipt to the month it was ENTERED, not the month it was PURCHASED — so a
-- receipt scanned days later landed in the wrong month. Keep the real date.
-- Nullable: legacy rows and rows with no scanned date fall back to created_at.
-- ============================================================

alter table purchases add column if not exists purchase_date date;
