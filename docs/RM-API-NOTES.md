# Rent Manager API — integration notes (Evolution account)

Distilled from "API Getting Started" (July 2026). RM is the accounting
system of record; Round24 pulls read-only (properties/units) first —
push of completed WOs + costs is post-launch (see build brief §6).

## Connection
- **Base URL:** `https://evolution.api.rentmanager.com`
- **Docs + test client:** same host (API Web Portal; needs an
  API-enabled RM user account — see "API Enabled User Account Setup.docx")
- **Support:** apisupport@rentmanager.com

## Auth
- `POST /Authentication/AuthorizeUser` with body
  `{ "UserName": "...", "Password": "..." }` → token
- Token life: **24h**, but dies after **15 min of inactivity** → design
  the sync to re-auth on 401 rather than assume token validity
- Max **10 concurrent valid tokens** per user ("User is already logged
  in maximum number of times") — reuse one token per service, don't
  auth per request
- `POST /Authentication/Deauthorize?token={token}` to release
- Every request: header `x-rm12api-apitoken: {token}`

## Locations
- Locations = **separate databases**; IDs (PropertyID etc.) are only
  unique *within* a location
- Header `x-rm12api-locationid: {id}` on every request (omit on the
  first `/Current/Locations` call to discover)
- `GET /Current/Locations` → locations visible to the API user
- One location per request — multi-location = loop

## Rate limits
- **500 requests / rolling minute**, 429 when exceeded
- Monitor `x-ratelimit-remaining` / `x-ratelimit-reset` headers

## Error handling
- 204 = success but empty — usually **user permissions**, not a bug
- Always capture response bodies on failure (`DeveloperMessage` /
  `Message` fields carry the real reason)
- Gateway timeout is 5 min

## Round24 integration sketch (when creds arrive)
1. Edge function `rm-sync` (server-side; RM creds live in Supabase
   secrets, never the browser — same pattern as getdek)
2. Pull `/Properties` + `/Units` for the location → upsert into
   Round24 `properties` with `external_src='rm'`, `external_id`
3. Conflict rule (locked): **RM wins on properties/units; Round24 wins
   on work orders**
4. Store RM credentials encrypted in `rm_connections` (already in
   schema, staff-only RLS)

**Open item from the brief:** RM API licensing cost — call the RM rep.
