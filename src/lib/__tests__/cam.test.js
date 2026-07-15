import { describe, it, expect } from 'vitest';
import { camReconcile, camBuildings } from '../cam.js';

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

describe('camBuildings — only commercial / CAM-bearing buildings', () => {
  it('lists the commercial building, not the residential one', () => {
    const list = camBuildings(leasing);
    expect(list).toContain('Tower');
    expect(list).not.toContain('House');
  });
});
