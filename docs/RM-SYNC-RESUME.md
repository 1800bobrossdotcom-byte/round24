# Rent Manager sync — RESUME HERE when access lands

Status: **our-side scaffolding built & deployed. Blocked only on RM
API-enabled account credentials** (owner is in contact with the RM team,
July 2026). Preview/sample-data path is live and demoable now.

## What's already built
- **Schema** (migration 0008): `units` table, `external_src/external_id`
  upsert keys on properties + units, `rm_connections` sync bookkeeping.
- **Edge function `rm-sync`** (deployed): staff-only; `{mock:true}` runs
  the full map→upsert pipeline on sample data; live path authenticates to
  RM, discovers location, pulls Properties + Units, upserts as `rm`.
- **Office → Integrations tab**: Preview + Sync buttons, status, counts,
  last-sync summary.

## To go live (≈10 minutes once creds exist)
1. Owner creates an **API-enabled RM user** in Rent Manager (see RM's
   "API Enabled User Account Setup.docx"). Get username + password.
2. Set Supabase edge-function secrets (Management API or dashboard):
   - `CALIPER_RM_USERNAME`, `CALIPER_RM_PASSWORD`
   - `CALIPER_RM_BASE_URL` = `https://evolution.api.rentmanager.com` (default)
   - `CALIPER_RM_LOCATION_ID` — optional; auto-discovered if unset
3. In the app: **Integrations → Sync from Rent Manager**.
4. **Validate the field mappings** in `rm-sync/index.ts` (`mapProperty`,
   `mapUnit`) against real responses via the API Test Client at
   evolution.api.rentmanager.com — RM's exact field names (PropertyID,
   Name, Addresses[].City, UnitID, Bedrooms, UnitStatus…) aren't in the
   getting-started PDF, so the mappers use conventional names + fallbacks
   and may need one tightening pass.

## Design constraints baked in (from build brief + API doc)
- Read-only first; RM push (completed WOs + costs) is post-launch.
- Conflict rule: **RM wins on properties/units; Caliper wins on work orders.**
- Creds server-side only (secrets), never browser — same as getdek/KMS.
- Re-auth on 401 (tokens idle out after 15 min); respect 500 req/min.
- Multi-tenant later: move per-org creds into `rm_connections.credentials_enc`
  (encrypted via KMS DEK) instead of global secrets.

## Follow-ups unblocked once RM units are synced
- **Unit-level import allocation.** Excel import currently allocates rows to
  a *building* (matched against the org's property list). Once RM units are
  synced, extend the matcher in `src/views/Import.jsx` (`buildMatcher`) to
  also resolve a **unit** from the row's text cells against the real RM unit
  names, so imported hours land at unit level, not just building. Decision
  (Jul 2026): deferred until RM units exist — don't guess a unit format.

## Partnership/funding note
The preview path is deliberately demoable without RM access — it shows
the integration producing real synced rows, useful for the RM partnership
conversation and investor demos before credentials are granted. See
`docs/CALIPER-BUILD-BRIEF.md` for the wedge→flywheel→moat narrative.
