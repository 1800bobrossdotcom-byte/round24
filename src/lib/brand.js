// Per-org whitelabel branding. Matched by ORG ID first (works in-app via
// store.orgId and on the pre-auth resident page via the URL orgId), then by ORG
// NAME as a resilient fallback (the in-app shells always know the org name, so a
// logo still resolves even if an id doesn't line up exactly).
//
// Logo files live in public/brands/ — drop a PNG (transparent background works
// best) there and point to it here. Until the file exists the <img> 404s and the
// UI falls back to the Caliper lockup, so adding an org here never breaks anything.
const EVOLUTION24 = { name: 'Evolution24 Properties', logo: '/brands/evolution24.png' };

export const ORG_BRANDS = {
  '10233d8a-0d9b-4f7d-9df7-65ef915c36f3': EVOLUTION24, // Evolution24 Property Management
};

// name-token → brand. Token is matched against the lowercased, whitespace-
// stripped org name (substring), so "Evolution24 Property Management" hits.
const NAME_BRANDS = [
  { token: 'evolution24', brand: EVOLUTION24 },
];

export function brandFor(orgId, orgName) {
  if (orgId && ORG_BRANDS[orgId]) return ORG_BRANDS[orgId];
  if (orgName) {
    const n = String(orgName).toLowerCase().replace(/\s+/g, '');
    for (const { token, brand } of NAME_BRANDS) if (n.includes(token)) return brand;
  }
  return null;
}
