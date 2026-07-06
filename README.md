# Caliper

Labor, measured true. Mobile-first field timer + desktop analytics portal for
property maintenance — every hour allocated to a property and unit, reconciled
automatically. Built with Vite + React + vanilla CSS.

Seeded with a realistic model of the Evolution24 operation (real properties,
crew, weekly Saturday pay period).

## Run locally
```bash
npm install
npm run dev        # → http://localhost:5173
```

## Build
```bash
npm run build      # → dist/
npm run preview
```

## Deploy to Vercel
1. Push this folder to a GitHub repo.
2. In Vercel: New Project → import the repo. Framework preset: **Vite**
   (build `vite build`, output `dist`). Deploy.
3. Settings → Domains → add `caliper.solutions`.
4. In Namecheap → Advanced DNS, set:
   - A `@` → `76.76.21.21`  (use the IP Vercel shows if different)
   - CNAME `www` → `cname.vercel-dns.com.`
   Turn OFF Namecheap Domain Parking. SSL auto-issues in minutes.

## Architecture notes
- `src/styles/tokens.css` — the ONLY place colors live. Whitelabel theming =
  swap this token block per tenant. Carries the brand language: black surface,
  rainbow measurement gradient, Space Mono for all data, VHS scanline, glitch-settle.
- `src/lib/rollups.js` — the query spine. Every view (tech / property / unit /
  period at day–year grain) is one reduce over the same timer set. Allocation
  provably reconciles: sum(by-property) === grand total.
- `src/lib/store.js` — data + range filtering (swap seed.json for a real API).
- `src/views/` — Dashboard, Field (live timer, offline-safe), Properties
  (drill to unit), Team (per-operator, pay-period grain).

## Next build steps
- receipt OCR → material cost on the same allocation spine (true job cost)
- pay-period lock + payroll CSV export + Excel import wizard
- warranty catcher, dispute packet
- Rent Manager read-only sync to replace seed properties/units
- PWA service worker (vite-plugin-pwa) for the real offline queue
