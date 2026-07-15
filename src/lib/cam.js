// ============================================================
// CAM reconciliation — Caliper Enterprise's moat calc for commercial estates.
//
// Common Area Maintenance: a commercial building's operating cost is recovered
// from its tenants pro-rata. The perennial fight is that the landlord's number
// is an estimate nobody can audit. Caliper's is MEASURED — the recoverable pool
// is the same labor (from crew timers) + approved materials the per-door P&L
// already reconciles. We allocate that measured pool by each suite's share of
// rentable floor area, then true it up against what the tenant was billed.
//
//   share_i      = rentable_sf_i / total_rentable_sf         (standard method)
//   allocated_i  = share_i * measured_recoverable_pool
//   billed_i     = monthly_cam_fee_i * months
//   delta_i      = allocated_i - billed_i   (+ tenant owes, - tenant is credited)
//
// Vacant suites keep their share of the denominator, so their portion is NOT
// pushed onto occupied tenants — the landlord absorbs vacancy (the honest,
// non-grossed-up method). We surface that absorbed amount explicitly.
// ============================================================

import { buildingPnl } from './pnl.js';

const key = (s) => (s || '').toLowerCase().trim();
const isLand = (u) => u.type === 'land' || u.status === 'held';

// One building's CAM reconciliation for a period (default a 12-month year).
export function camReconcile({ building, leasing = [], timers = [], purchases = [], propById = {}, months = 12 } = {}) {
  if (!building) return null;

  // recoverable pool = the building's MEASURED operating cost. Reuse the P&L so
  // the CAM number is literally the same labor + materials the P&L shows.
  const pnl = buildingPnl(building, { leasing, timers, purchases, propById });
  const labor = pnl?.labor || 0;
  const materials = pnl?.materials || 0;
  const pool = labor + materials;

  // rentable units in this building (land parcels aren't rentable area)
  const units = leasing.filter((u) => key(u.building) === key(building) && !isLand(u));

  // pro-rata basis: rentable SF when we have it, else an equal split across
  // suites — flagged, so a statement is never silently wrong when SF is missing.
  const anySqft = units.some((u) => Number(u.sqft) > 0);
  const basisOf = (u) => (anySqft ? (Number(u.sqft) || 0) : 1);
  const totalBasis = units.reduce((a, u) => a + basisOf(u), 0);
  const totalSqft = units.reduce((a, u) => a + (Number(u.sqft) || 0), 0);

  const share = (u) => (totalBasis ? basisOf(u) / totalBasis : 0);

  const tenants = units
    .filter((u) => u.status === 'leased' && (u.tenant || '').trim())
    .map((u) => {
      const sharePct = share(u) * 100;
      const allocated = share(u) * pool;
      const monthlyCam = Number(u.fees?.cam) || 0;
      const billed = monthlyCam * months;
      return {
        unit: u.number, tenant: u.tenant,
        sqft: Number(u.sqft) || null, sharePct,
        monthlyCam, billed, allocated,
        delta: allocated - billed, // + owes, - credit
      };
    })
    .sort((a, b) => b.sharePct - a.sharePct);

  const vacant = units
    .filter((u) => !(u.status === 'leased' && (u.tenant || '').trim()))
    .map((u) => ({ unit: u.number, sqft: Number(u.sqft) || null, sharePct: share(u) * 100, allocated: share(u) * pool }));

  const allocatedToTenants = tenants.reduce((a, t) => a + t.allocated, 0);
  const landlordAbsorbed = pool - allocatedToTenants; // vacancy share the owner eats
  const totalBilled = tenants.reduce((a, t) => a + t.billed, 0);
  const totalDelta = allocatedToTenants - totalBilled;

  return {
    building, months,
    pool: { labor, materials, total: pool },
    basis: anySqft ? 'sqft' : 'equal',
    totalSqft, unitCount: units.length,
    tenants, vacant,
    allocatedToTenants, landlordAbsorbed,
    totalBilled, totalDelta,
  };
}

// Which buildings are worth reconciling — any with a commercial suite or a CAM
// fee on the rent roll. Returns building names, most commercial suites first.
export function camBuildings(leasing = []) {
  const m = new Map();
  for (const u of leasing) {
    if (isLand(u)) continue;
    const commercial = u.type === 'commercial' || Number(u.fees?.cam) > 0;
    if (!commercial) continue;
    m.set(u.building, (m.get(u.building) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}
