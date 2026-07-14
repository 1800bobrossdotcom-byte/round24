// Per-org whitelabel branding. Keyed by ORG ID so the same map serves both the
// in-app shells (store.orgId) and the pre-auth resident page (orgId from the URL,
// where we have no session/org name yet).
//
// Logo files live in public/brands/ — drop a PNG (transparent background works
// best) there and point to it here. Until the file exists the <img> 404s and the
// UI falls back to the Caliper lockup, so adding an org here never breaks anything.
export const ORG_BRANDS = {
  // Evolution24 Property Management
  '10233d8a-0d9b-4f7d-9df7-65ef915c36f3': { name: 'Evolution24 Properties', logo: '/brands/evolution24.png' },
};

export function brandFor(orgId) {
  return (orgId && ORG_BRANDS[orgId]) || null;
}
