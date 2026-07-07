-- ============================================================
-- Caliper — schema v11: persist the AI itemized breakdown on a purchase
-- When a receipt is scanned, keep its line items on the purchase so the
-- itemized breakdown (and any price flags) is viewable later, not just at
-- capture time.
-- ============================================================

alter table purchases add column if not exists line_items jsonb;
