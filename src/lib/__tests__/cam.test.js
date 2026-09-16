import { describe, it, expect } from 'vitest';
import { camReconcile, camBuildings, camWindow } from '../cam.js';

// A tiny commercial building: three suites (two leased, one vacant) with SF and
// monthly CAM fees, plus measured labor logged to the building's common area.
const leasing = [
  { building: 'Tower', number: '1', type: 'commercial', status: 'leased', tenant: 'Acme', sqft: 5000, rent: 4000, fees: { cam: 100 } },
  { building: 'Tower', number: '2', type: 'commercial', status: 'leased', tenant: 'Beta', sqft: 3000, rent: 2500, fees: { cam: 300 } },
  { building: 'Tower', number: '3', type: 'commercial', status: 'vacant', tenant: '', sqft: 2000, rent: 2200, fees: { cam: 120 } },
  { building: 'House', number: 'A', type: 'residential', status: 'leased', tenant: 'Cara', sqft: null, rent: 1500, fees: {} },
];
// labor resolved to the building by propLabel: 100h @ $50 = $5,000 pool
const timers = [{ propLabel: 'Tower', durationHrs: 100, rate: 50, verified: true }];
const purchases = [{ propLabel: 'Tower', amount: 1000, status: 'approved' }]; // materials
const args = { building: 'Tower', leasing, timers, purchases, propById: {}, months: 12 };

describe('camReconcile — pool is the measured operating cost', () => {
  it('pool = measured labor + approved materials', () => {
    const r = camReconcile(args);
    expect(r.pool.labor).toBe(5000);
    expect(r.pool.materials).toBe(1000);
    expect(r.pool.total).toBe(6000);
  });

  it('unapproved receipts are excluded from the pool', () => {
    const r = camReconcile({ ...args, purchases: [{ propLabel: 'Tower', amount: 1000, status: 'pending' }] });
    expect(r.pool.materials).toBe(0);
    expect(r.pool.total).toBe(5000);
  });
});

describe('camReconcile — pro-rata by rentable SF', () => {
  it('allocates each occupied suite its SF share of the pool', () => {
    const r = camReconcile(args); // total SF 10,000; pool 6,000
    const acme = r.tenants.find((t) => t.tenant === 'Acme');
    const beta = r.tenants.find((t) => t.tenant === 'Beta');
    expect(acme.sharePct).toBeCloseTo(50);   // 5000/10000
    expect(acme.allocated).toBeCloseTo(3000); // 50% * 6000
    expect(beta.sharePct).toBeCloseTo(30);   // 3000/10000
    expect(beta.allocated).toBeCloseTo(1800); // 30% * 6000
  });

  it('trues up allocated vs billed (+ owes, - credit)', () => {
    const r = camReconcile(args);
    const acme = r.tenants.find((t) => t.tenant === 'Acme');
    const beta = r.tenants.find((t) => t.tenant === 'Beta');
    expect(acme.billed).toBe(1200);          // 100 * 12
    expect(acme.delta).toBeCloseTo(1800);    // owes 3000 - 1200
    expect(beta.billed).toBe(3600);          // 300 * 12
    expect(beta.delta).toBeCloseTo(-1800);   // credited 1800 - 3600
  });

  it('landlord absorbs the vacant suite share — not pushed onto tenants', () => {
    const r = camReconcile(args); // vacant suite = 2000/10000 = 20% of 6000 = 1200
    expect(r.allocatedToTenants).toBeCloseTo(4800); // 3000 + 1800
    expect(r.landlordAbsorbed).toBeCloseTo(1200);
    // occupied + absorbed must equal the whole pool (nothing lost or double-counted)
    expect(r.allocatedToTenants + r.landlordAbsorbed).toBeCloseTo(r.pool.total);
  });
});

describe('camReconcile — SF fallback', () => {
  it('equal-splits and flags basis when no suite has SF', () => {
    const noSf = leasing.map((u) => (u.building === 'Tower' ? { ...u, sqft: null } : u));
    const r = camReconcile({ ...args, leasing: noSf });
    expect(r.basis).toBe('equal');
    // 3 rentable suites → each 1/3; two occupied → 2/3 of pool to tenants
    expect(r.allocatedToTenants).toBeCloseTo(4000); // 2/3 * 6000
    expect(r.landlordAbsorbed).toBeCloseTo(2000);   // vacant 1/3
  });
});

describe('camReconcile — mixed SF (some suites missing) falls back to equal, never silently mis-bills', () => {
  it('one suite missing SF → basis "mixed", equal split, no free-ride 0-share', () => {
    const mixed = leasing.map((u) => (u.building === 'Tower' && u.number === '2' ? { ...u, sqft: null } : u));
    const r = camReconcile({ ...args, leasing: mixed });
    expect(r.basis).toBe('mixed');
    expect(r.needsSqft).toContain('2');
    // 3 rentable suites, equal split → each 1/3; two occupied → 2/3 of 6000 pool
    const acme = r.tenants.find((t) => t.tenant === 'Acme');
    const beta = r.tenants.find((t) => t.tenant === 'Beta');
    expect(acme.sharePct).toBeCloseTo(33.33, 1);
    expect(beta.sharePct).toBeCloseTo(33.33, 1); // NOT 0 — the bug was Beta getting a free credit
    expect(r.allocatedToTenants).toBeCloseTo(4000);
    expect(r.landlordAbsorbed).toBeCloseTo(2000);
  });
  it('full SF present → still bills by area (basis "sqft", no needsSqft)', () => {
    const r = camReconcile(args);
    expect(r.basis).toBe('sqft');
    expect(r.needsSqft).toEqual([]);
  });
});

describe('camBuildings — only commercial / CAM-bearing buildings', () => {
  it('lists the commercial building, not the residential one', () => {
    const list = camBuildings(leasing);
    expect(list).toContain('Tower');
    expect(list).not.toContain('House');
  });
});

describe('camReconcile — the pool covers the SAME period the tenants were billed for', () => {
  const asOf = '2026-09-16';
  const dated = [
    { propLabel: 'Tower', durationHrs: 10, rate: 50, date: '2026-06-16' }, // day before a quarter window opens
    { propLabel: 'Tower', durationHrs: 10, rate: 50, date: '2026-06-17' }, // first day in
    { propLabel: 'Tower', durationHrs: 10, rate: 50, date: '2026-09-16' }, // last day in (asOf itself)
    { propLabel: 'Tower', durationHrs: 10, rate: 50, date: '2026-09-17' }, // after asOf
    { propLabel: 'Tower', durationHrs: 10, rate: 50, date: '2025-01-05' }, // long ago
  ];

  it('quarter: only labor dated inside the trailing 3 months feeds the pool', () => {
    const r = camReconcile({ ...args, timers: dated, purchases: [], months: 3, asOf });
    expect(r.window).toEqual({ from: '2026-06-17', to: '2026-09-16' });
    expect(r.pool.labor).toBe(1000); // 2 entries × 10h × $50
  });

  it('annual: the same entries widen to everything in the trailing 12 months', () => {
    const r = camReconcile({ ...args, timers: dated, purchases: [], months: 12, asOf });
    expect(r.window).toEqual({ from: '2025-09-17', to: '2026-09-16' });
    expect(r.pool.labor).toBe(1500); // 06-16, 06-17, 09-16
  });

  it('billed and pool now move together when the period changes', () => {
    const annual = camReconcile({ ...args, timers: dated, purchases: [], months: 12, asOf });
    const quarter = camReconcile({ ...args, timers: dated, purchases: [], months: 3, asOf });
    const acmeA = annual.tenants.find((t) => t.tenant === 'Acme');
    const acmeQ = quarter.tenants.find((t) => t.tenant === 'Acme');
    expect(acmeA.billed).toBe(1200);  // $100 × 12
    expect(acmeQ.billed).toBe(300);   // $100 × 3
    expect(acmeA.allocated).toBeCloseTo(750); // 50% of 1500
    expect(acmeQ.allocated).toBeCloseTo(500); // 50% of 1000 — not 50% of all history
  });

  it('materials use the receipt date, fall back to createdAt, and keep undated receipts', () => {
    const purchases = [
      { propLabel: 'Tower', amount: 100, status: 'approved', date: '2026-08-01' },                 // in
      { propLabel: 'Tower', amount: 200, status: 'approved', createdAt: '2026-01-05T12:00:00Z' }, // out of the quarter
      { propLabel: 'Tower', amount: 400, status: 'approved' },                                      // undated → never dropped
    ];
    const r = camReconcile({ ...args, timers: [], purchases, months: 3, asOf });
    expect(r.pool.materials).toBe(500);
  });

  it('camWindow clamps month-end anchors instead of overflowing into the next month', () => {
    expect(camWindow(1, '2026-03-31')).toEqual({ from: '2026-03-01', to: '2026-03-31' });   // Feb 28 + 1 day
    expect(camWindow(12, '2028-02-29')).toEqual({ from: '2027-03-01', to: '2028-02-29' });  // Feb 28 2027 + 1 day
    expect(camWindow(6, '2026-09-16')).toEqual({ from: '2026-03-17', to: '2026-09-16' });
  });
});
