# ROUND24 — Build Brief & Handoff
*Master context doc for continued development in Claude Code. Last updated July 6, 2026.*

---

## 0. What Round24 is (one paragraph)

Round24 is a mobile-first field app + desktop analytics portal that runs the
maintenance side of a property-management company: labor timing, work orders,
equipment history, receipts, and **true cost per unit / property / project**.
It integrates with Rent Manager (RM stays the accounting system of record;
Round24 owns everything maintenance) and is built multi-tenant + whitelabel from
day one. Positioning: *everyone else coordinates vendors — Round24 accounts for
in-house crews and tells you what maintenance truly costs.*

**Live:** round24.app (Vercel + Cloudflare, encrypted). Stack: Vite +
React + vanilla CSS. Backend: Supabase (Postgres + auth + RLS), AES-256-GCM
field encryption, AWS KMS envelope keys.

---

## 1. Current state (as built)

**Deployed & live:** round24.app — Vite/React/vanilla-CSS frontend,
Supabase backend, AES-256 encryption active, auth gate live.

**Views shipped:**
- Dashboard — true labor cost, weekly/monthly trend, top labor-eating
  properties, labor by operator
- Field — live per-job timer, offline-safe, job measured vs category median
- Properties — per-building labor, drill to per-unit + per-category cost
- Team — every operator, daily/weekly/monthly/yearly grain, matched pay period
- Import — Excel wizard reading real pay-log tabs, flags missing rates,
  backfills history

**Backend/security:**
- Multi-tenant schema with Row-Level Security (deny-by-default, org-scoped)
- AES-256-GCM field encryption (rates, operator PII, RM creds) — fail-closed
- Server-side key delivery via Edge Function; AWS KMS per-tenant envelope keys
- Supabase auth (email/password; Google SSO next)

**Design system:** black surface, rainbow "measurement" gradient, Space Mono
for all data/numbers, VHS scanline overlay, glitch-settle on figures, Raleway
body. All colors in one token file → whitelabel = token swap per tenant.

**Data model spine:** every timer carries org + operator + property + unit +
date + rate. Every rollup (by any dimension, any time grain) is one reduce over
that set. Allocation reconciles to the penny (verified).

---

## 2. Build roadmap (priority order)

### v1 — "the app that finds money" (LAUNCH scope)
Core substrate (built): work orders, timers, QR assets, offline media queue,
unit photos/inspections, RM read-only sync.
Launch headliners (differentiators — ship these, never pitch plumbing):
1. **True job cost** — receipt OCR (AWS Textract) → review queue →
   cost_allocations. Labor (timers) + materials (receipts) = cost per unit /
   project / property, backed by original images.
2. **Warranty catcher** — check warranty status at work-order assignment;
   covered work flags "file a claim, don't pay." Track recovered $ as headline.
3. **Deposit dispute packet** — one tap compiles move-in/out photos (auto-paired),
   work orders, itemized costs → court-ready, tamper-evident PDF.
Plus: whitelabel theming, **published pricing page** (transparent pricing as
brand — nobody in the category has public pricing).

### v2 — "runs the crew" (fast follow)
- Repair-vs-replace engine (heuristic; owner-facing capex one-pagers)
- RM push (completed WOs + material costs into RM accounting)
- Voice-to-work-order (field adoption)
- Turn optimizer (vacancy-cost-per-day clock; but differentiate by attaching
  true cost per turn, not just days — Accolade already does turn *tracking*)
- Vehicles registry + clocked-in dispatch map + one telematics connector
  (integrate Samsara/Verizon/Bouncie — never build OBD hardware)
- Vendor entity + scorecards (callback detection)

### v3 — "knows what maintenance should cost" (the moat)
- **Parts price intelligence** — cross-tenant receipt benchmarks. OPT-IN,
  anonymized, k-anonymity floor (no benchmark shown unless ≥N tenants). Consent
  architecture ships BEFORE the feature. Item normalization is the hard part.
- **Predictive maintenance** — asset age × category × service pattern → fleet-
  level risk windows. Heuristics before ML.
- **AI photo triage** — resident photo → category/severity/likely parts; track
  prediction accuracy from day one.
- **Owner portal** — read-only owner logins showing true cost transparency.
- **Native mode** — full property/unit management without RM for non-RM shops.

### Immediate next builds (smallest valuable increments)
- **Property-allocation tagger** — turn imported unallocated hours into true
  cost-per-building (automates the hand-split the operator does today)
- **Pay-period lock + payroll CSV export** — anti-spreadsheet integrity:
  locked periods immutable, corrections as audited adjustments, versioned rates
- **Timecard analytics depth** — utilization (timer-time / clocked-time),
  billable vs idle, job-vs-median flags

---

## 3. Full feature inventory (everything discussed)

**Labor & time:** clock-in timecards, per-job task timers, daily/weekly/monthly/
yearly rollups by operator/job/unit/property, utilization, versioned operator
rates, pay-period locking, payroll CSV export, Excel import wizard.

**Work & assets:** work orders (create/assign/status/photos/notes, append-only
event log), QR asset registry + scan-to-history, asset service log.

**Cost truth:** receipt OCR (scan + email intake + upload), receipt line items,
cost_allocations spine, projects (multi-WO capital work), true cost per
unit/project/property, warranty catcher, repair-vs-replace.

**Evidence:** unit photos (timestamp + GPS + tamper-evident hash), structured
inspections (move-in/out/periodic/turn), deposit dispute packet PDF.

**Field ops:** offline-first PWA (queue photos/timers/receipts, sync on signal),
voice-to-work-order, vehicles registry, clocked-in-only dispatch map + telematics.

**Integrations:** Rent Manager (read-only pull: properties/units/availability;
push: completed WOs + costs), Google SSO + Calendar, Shippo (delivery later).

**Platform:** multi-tenant RLS, per-tenant KMS keys, whitelabel theming,
published per-door pricing, owner portal, parts price intelligence, predictive
maintenance, native (RM-free) mode.

**Security:** AES-256-GCM field encryption, AWS KMS envelope (per-tenant keys,
cryptographic shredding on offboard), fail-closed, RLS deny-by-default.

---

## 4. Market analysis

### The gap Round24 exploits
Every competitor is **vendor-dispatch centric** (built for PMs who outsource
repairs) OR **enterprise-multifamily** (centralized 500+ unit portfolios).
Nobody owns the **in-house-crew, small/mid, mixed-portfolio** operator — which
is most owner-operators. Round24's wedge: true job cost (labor + materials),
whitelabel, transparent pricing, built for W2 maintenance staff.

### Competitor map
**Coordination software (closest):**
- **Property Meld** — leader for small-mid PMCs; work orders, response-time
  tracking, vendor/resident comms, spend-per-unit from invoices. Acquired Mezo
  (AI resident intake). Reference competitor.
- **Latchel / Lula / Vendoroo** — outsourced coordination + contractor networks;
  AI coordinators. Vendoroo is a recent RM partner.

**Enterprise multifamily (funded, converging):**
- **Accolade (accoladehq.com)** — MOST serious overlap. "Operations
  centralization for multifamily," agentic-AI framing, RM partner (May 2026).
  Ships: skill/location-based scheduling, inspection templates → auto work
  orders, turn tracking, labor-to-payroll, offline mobile app (EN/ES), AI
  scheduler + geofencing, AI triage, warranty/manual surfacing, "NextDay"
  onboarding. ICP = institutional/centralized (NOT small/mixed). No visible:
  receipt/material cost, whitelabel, dispute packets, published pricing.
  Early-stage (no disclosed funding, quote-only pricing, "deal-meridian" URL
  suggests a rebrand).
- **AppWork** — multifamily maintenance, technician productivity, backlog
  elimination. Raised ~$20M ($13M Series A 2025 + ~$7M). RM integration. Watch
  for materials-cost capture — if they ship it, Round24's window narrows.

**Adjacent / RM ecosystem:** NetVendor (vendor compliance, 7 PMS), zInspector,
Breezeway (inspections). **RM native:** rmAppSuite Pro (tech check-in/out, Make
Ready Boards) — the incumbent inside RM's base.

### Positioning line
*"Accolade centralizes the enterprise. AppWork speeds up techs. Round24 tells
you what every unit truly costs — and finds the money you're leaving on the
table."* Target: small/mid operators + owner-operators on Rent Manager, mixed
portfolios (incl. scattered single-family the enterprise players ignore).

### Why now
Proptech capital chasing maintenance/procurement optimization; ~300K US
third-party PMCs (long tail runs in-house crews); AI-era OCR + vision make
receipt-level cost truth cheap to build for the first time; RM's open API +
integration marketplace = installed base to sell into without a rip-and-replace.

### Standing competitive guardrails
- Never pitch features Accolade/AppWork already ship as differentiators — lead
  with cost truth, found money, evidence.
- Quarterly re-check: Accolade (downmarket move? funding?), AppWork (materials
  cost?), Property Meld (Mezo expanding into cost tools?).
- Published pricing stays published. The moment you go "contact sales," you're
  one of them.

---

## 5. Business model
- **SaaS priced per door** — transparent published pricing (brand signal;
  nobody else in category publishes).
- **Whitelabel licensing** — management companies resell under their own brand;
  config not rebuild (multi-tenant + per-tenant crypto from day one).
- **Data compounds** — labor-per-ticket + cross-tenant parts pricing → benchmark
  intelligence no incumbent can reconstruct.
- **Customer zero = our own operation** (Evolution24) — live case study,
  zero-CAC proof, every report demoable on real data.
- **GTM:** dogfood → Rent Manager marketplace wedge → whitelabel flywheel.

---

## 6. Key decisions locked (don't relitigate)
- **RM as connector, not foundation** — schema doesn't assume RM exists;
  `external_source` field keeps native-mode door open.
- **Conflict rules:** RM wins on properties/units; Round24 wins on work orders.
  One direction of truth per entity, no merge logic.
- **RM push is post-launch** — read-only integration first de-risks the RM
  dependency.
- **Differentiators ship at launch** — plumbing (work orders/timers) is never
  the pitch; Accolade+AppWork own that lane.
- **Offline queue built once** — shared by receipts, unit photos, inspections.
- **Encryption:** use vetted AES-256-GCM + KMS; never roll custom crypto.
  Fail-closed always.
- **Telematics: integrate, don't build** OBD hardware.
- **Location tracking: clocked-in only** — compliance + retention; needs signed
  policy per state.
- **Parts intelligence: consent architecture before the feature.**
- **Brand:** name = Round24 (precision/measurement = the thesis). Domain
  round24.app. Design = cbuy language (black, rainbow gradient, Space
  Mono, VHS scanline, glitch-settle); all tokens swappable for whitelabel.

---

## 7. Real operational context (customer zero)
Built from Evolution24 Property Management's actual workbook (44 sheets):
- ~8-9 operators, varied hourly rates ($20-26), some mid-log overrides
- ~11+ properties across Rochester, Geneva, Syracuse, Manlius
- Weekly pay period, **week starts Saturday** (must match, or payroll disagrees)
- Real pain observed: labor hand-allocated across properties in spreadsheet
  grids, reconciliation drift ("overpay," negative balances), "PAID BY BRENT"
  off-sheet reconciliation, 44 tangled tabs mixing pay logs / P&Ls / service
  logs / inventories. This IS the problem Round24 solves.

---

## 8. Open questions to resolve while building
- RM API licensing cost (call the RM rep — affects pricing)
- Resident-facing intake? (portal/QR in unit — changes PII surface)
- Which telematics provider first (check what's already in the trucks)
- Location-tracking policy per operating state (legal review before dispatch map)
- Native-mode pricing (tier or included for non-RM shops)
- Dispute remedy when escrow/direct-transfer (from cbuy pattern — N/A unless
  Round24 adds payments)
