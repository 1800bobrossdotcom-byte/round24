-- ============================================================
-- Caliper — schema v12: per-property credit cards
-- Each building has its own card, so a scanned receipt can auto-file to the
-- right property by matching the card's last 4. Staff manage the mapping;
-- every org member can read it (so a crew scan can auto-match too).
-- ============================================================

create table property_cards (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,
  last4          text not null,
  brand          text,                         -- Visa / Mastercard / Amex…
  property_label text not null,                -- the building this card belongs to
  label          text,                         -- optional friendly name
  created_at     timestamptz default now()
);
alter table property_cards enable row level security;

-- staff manage the card map; all org members can read it (crew auto-match)
create policy pc_staff on property_cards for all
  using (is_org_staff(org_id)) with check (is_org_staff(org_id));
create policy pc_read on property_cards for select
  using (org_id in (select current_user_orgs()));

create index pc_org_last4 on property_cards(org_id, last4);
