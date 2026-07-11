// ============================================================
// Per-door P&L — the moat calc. Rolls the SAME labor spine the crew fills into
// each building's real economics: rent in, minus verified labor + materials.
// Nobody else can produce cost-per-door from actual measured labor.
//
// Timeframe note: rent is monthly; labor + materials are the maintenance spend
// captured to date. The UI labels both so the NOI figure is read honestly.
// ============================================================

const key = (s) => (s || '').toLowerCase().trim();
const isLand = (u) => u.type === 'land' || u.status === 'held';

export function portfolioPnl({ leasing = [], timers = [], purchases = [], propById = {} } = {}) {
  const map = new Map(); // building name → row
  const ensure = (name) => {
    const k = key(name); if (!k) return null;
    if (!map.has(k)) map.set(k, { name, units: 0, occ: 0, rentBilled: 0, rentPotential: 0, labor: 0, materials: 0 });
    return map.get(k);
  };

  // rent + occupancy from the rent roll (land parcels excluded — not rentable)
  for (const u of leasing) {
    if (isLand(u)) continue;
    const b = ensure(u.building); if (!b) continue;
    b.units++; b.rentPotential += u.rent || 0;
    if (u.status === 'leased') { b.occ++; b.rentBilled += u.rent || 0; }
  }
  // verified labor cost — the timers the crew logged, resolved to their building
  let verifiedHrs = 0, judgedHrs = 0; // judged = punch had a fence to check against
  for (const t of timers) {
    const p = propById[t.propId]; const name = p?.name || t.propLabel;
    const b = name ? ensure(name) : null;
    if (b) b.labor += (t.durationHrs || 0) * (t.rate || 0);
    if (t.verified != null) { judgedHrs += t.durationHrs || 0; if (t.verified) verifiedHrs += t.durationHrs || 0; }
  }
  // materials — approved receipts filed to the building
  for (const pu of purchases) {
    if (pu.status && pu.status !== 'approved') continue;
    const b = ensure(pu.propLabel); if (b) b.materials += pu.amount || 0;
  }

  const rows = [...map.values()]
    .filter((b) => b.units > 0)
    .map((b) => {
      const opex = b.labor + b.materials;
      const vacancyLoss = b.rentPotential - b.rentBilled;
      const noi = b.rentBilled - opex;
      return {
        ...b, opex, vacancyLoss, noi,
        occPct: b.units ? Math.round((b.occ / b.units) * 100) : 0,
        rentPerDoor: b.units ? b.rentBilled / b.units : 0,
        costPerDoor: b.units ? opex / b.units : 0,
        noiPerDoor: b.units ? noi / b.units : 0,
      };
    })
    .sort((a, b) => b.noi - a.noi);

  const tot = rows.reduce((a, b) => ({
    units: a.units + b.units, occ: a.occ + b.occ,
    rentBilled: a.rentBilled + b.rentBilled, rentPotential: a.rentPotential + b.rentPotential,
    labor: a.labor + b.labor, materials: a.materials + b.materials,
    vacancyLoss: a.vacancyLoss + b.vacancyLoss, noi: a.noi + b.noi,
  }), { units: 0, occ: 0, rentBilled: 0, rentPotential: 0, labor: 0, materials: 0, vacancyLoss: 0, noi: 0 });
  tot.opex = tot.labor + tot.materials;
  tot.costPerDoor = tot.units ? tot.opex / tot.units : 0;
  tot.noiPerDoor = tot.units ? tot.noi / tot.units : 0;
  tot.rentPerDoor = tot.units ? tot.rentBilled / tot.units : 0;
  tot.verifiedHrs = verifiedHrs;
  tot.judgedHrs = judgedHrs;
  tot.verifiedPct = judgedHrs ? Math.round((verifiedHrs / judgedHrs) * 100) : null;

  return { rows, tot };
}

// one building's per-door economics (for the Properties detail drawer)
export function buildingPnl(name, args) {
  const { rows } = portfolioPnl(args);
  return rows.find((r) => key(r.name) === key(name)) || null;
}
