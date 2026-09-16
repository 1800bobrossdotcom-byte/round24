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

// ---- the reconciliation period ------------------------------------------------
// The pool must cover the SAME span the tenants were billed for: billed is
// `monthlyCam × months`, so the pool is the labor + materials dated inside the
// trailing `months` months ending `asOf` (today unless given). Without this,
// switching Annual → Quarter divided the billed side by four while the pool
// stayed the whole history — every statement showed a phantom balance due.
const pad2 = (n) => String(n).padStart(2, '0');
const localISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayISO = () => localISO(new Date());
const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return localISO(new Date(y, m - 1, d + n)); };
// shift a YYYY-MM-DD by whole months (local), clamping to the target month's
// end so Mar 31 − 1 month is Feb 28/29 — never "Feb 31" rolling into March.
function shiftMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const first = new Date(y, m - 1 + n, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return localISO(new Date(first.getFullYear(), first.getMonth(), Math.min(d, last)));
}
// inclusive [from, to] window for a `months`-long period ending `asOf`
export function camWindow(months = 12, asOf = null) {
  const to = asOf || todayISO();
  return { from: addDays(shiftMonths(to, -months), 1), to };
}
// an entry's calendar day, or null when it carries none
const dayOf = (v) => (typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : null);
// undated entries are KEPT: a cost the office logged must never silently vanish
// from a statement because it lacks a date (timers always carry work_date;
// receipts fall back to created_at — this is a belt-and-suspenders default).
const inWindow = (day, w) => day == null || (day >= w.from && day <= w.to);

// One building's CAM reconciliation for a period (default a 12-month year
// ending today). `asOf` pins the period end (YYYY-MM-DD) — used by tests and
// by statements re-run for a past period.
export function camReconcile({ building, leasing = [], timers = [], purchases = [], propById = {}, months = 12, asOf = null } = {}) {
  if (!building) return null;

  const window = camWindow(months, asOf);
  const periodTimers = timers.filter((t) => inWindow(dayOf(t.date), window));
  const periodPurchases = purchases.filter((p) => inWindow(dayOf(p.date || p.createdAt), window));

  // recoverable pool = the building's MEASURED operating cost for the period.
  // Reuse the P&L so the CAM number is literally the same labor + materials
  // the P&L shows for those entries.
  const pnl = buildingPnl(building, { leasing, timers: periodTimers, purchases: periodPurchases, propById });
  const labor = pnl?.labor || 0;
  const materials = pnl?.materials || 0;
  const pool = labor + materials;

  // rentable units in this building (land parcels aren't rentable area)
  const units = leasing.filter((u) => key(u.building) === key(building) && !isLand(u));

  // pro-rata basis: rentable SF when EVERY suite has it, else an equal split.
  // Mixing SF and non-SF suites can't produce an honest pro-rata share (a suite
  // with no SF would get share 0 — a free ride — while the rest are over-billed
  // against a too-small denominator), so if any rentable suite is missing SF we
  // equal-split the whole building and flag it 'mixed', surfacing the suites
  // that need SF entered. Only when SF is complete do we bill by area.
  const anySqft = units.some((u) => Number(u.sqft) > 0);
  const needsSqft = anySqft ? units.filter((u) => !(Number(u.sqft) > 0)).map((u) => u.number) : [];
  const useSqft = anySqft && needsSqft.length === 0;
  const basis = !anySqft ? 'equal' : (needsSqft.length ? 'mixed' : 'sqft');
  const basisOf = (u) => (useSqft ? (Number(u.sqft) || 0) : 1);
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
    building, months, window,
    pool: { labor, materials, total: pool },
    basis, needsSqft,
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
