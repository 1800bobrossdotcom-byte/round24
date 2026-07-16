import { describe, it, expect } from 'vitest';
import { portfolioPnl, buildingPnl } from '../pnl.js';

// Alpha: 2 units (1 leased @1000, 1 vacant @1200). Ghost: no rent-roll unit but
// carries labor (name drift). Land parcel excluded from doors.
const leasing = [
  { building: 'Alpha', rent: 1000, status: 'leased', type: 'residential' },
  { building: 'Alpha', rent: 1200, status: 'vacant', type: 'residential' },
  { building: 'Ridge', rent: 0, status: 'held', type: 'land' },
];
const timers = [
  { propLabel: 'Alpha', durationHrs: 10, rate: 30, verified: true },   // $300 labor, verified
  { propLabel: 'Ghost', durationHrs: 5, rate: 20, verified: false },   // $100 on an unmatched building
];
const purchases = [
  { propLabel: 'Alpha', amount: 150, status: 'approved' },
  { propLabel: 'Alpha', amount: 999, status: 'pending' },              // NOT approved → excluded
];
const args = { leasing, timers, purchases, propById: {} };

describe('portfolioPnl — per-building economics', () => {
  const { rows, tot, unmatched } = portfolioPnl(args);
  const alpha = rows.find((r) => r.name === 'Alpha');

  it('rolls rent, occupancy, verified labor and approved materials per door', () => {
    expect(alpha.units).toBe(2);
    expect(alpha.occ).toBe(1);
    expect(alpha.rentBilled).toBe(1000);
    expect(alpha.rentPotential).toBe(2200);
    expect(alpha.labor).toBe(300);
    expect(alpha.materials).toBe(150);   // pending $999 excluded
    expect(alpha.opex).toBe(450);
    expect(alpha.vacancyLoss).toBe(1200);
    expect(alpha.noi).toBe(550);          // 1000 - 450
  });

  it('excludes land parcels from doors, and rows only show counted buildings', () => {
    expect(rows.map((r) => r.name)).toEqual(['Alpha']); // Ghost (0 units) and Ridge (land) not shown
  });

  it('surfaces the unmatched-building bucket (name drift) instead of hiding it', () => {
    expect(unmatched).toEqual([{ name: 'Ghost', labor: 100, materials: 0, opex: 100 }]);
  });

  it('folds unmatched cost into the totals — sum(rows.opex)+unmatched === tot.opex', () => {
    const rowsOpex = rows.reduce((a, r) => a + r.opex, 0);
    const unOpex = unmatched.reduce((a, u) => a + u.opex, 0);
    expect(rowsOpex + unOpex).toBe(tot.opex);
    expect(tot.opex).toBe(550); // 450 Alpha + 100 Ghost
    expect(tot.labor).toBe(400);
  });

  it('verifiedPct = verified/judged hours, null when nothing judged', () => {
    expect(tot.verifiedPct).toBe(67); // 10 verified of 15 judged
    expect(portfolioPnl({ leasing, timers: [], purchases: [] }).tot.verifiedPct).toBe(null);
  });
});

describe('buildingPnl', () => {
  it('returns one building by (case-insensitive) name, or null', () => {
    expect(buildingPnl('alpha', args).rentBilled).toBe(1000);
    expect(buildingPnl('Nope', args)).toBe(null);
  });
});
