import { describe, it, expect } from 'vitest';
import { disperseSalary, perDay, monthlyOf, annualOf, SALARY_PERIODS } from '../salary.js';

describe('per-basis conversion', () => {
  it('perDay divides by the basis days; monthly/annual re-multiply', () => {
    expect(perDay(3044, 'month')).toBeCloseTo(100, 5);        // 3044 / 30.44
    expect(monthlyOf(1000, 'month')).toBeCloseTo(1000, 5);
    expect(annualOf(1000, 'year')).toBeCloseTo(1000, 5);
    expect(SALARY_PERIODS.map((p) => p.id)).toContain('biweekly');
  });
});

describe('disperseSalary — spread across buildings by hours share', () => {
  it('allocates by hours share and the total is exact to the cent', () => {
    const r = disperseSalary({ amount: 3044, period: 'month' }, [
      { name: 'A', hours: 30 }, { name: 'B', hours: 10 },
    ], 30.44);
    expect(r.total).toBeCloseTo(3044, 5);
    // 75% / 25% of 3044
    expect(r.byBuilding.map((b) => b.name)).toEqual(['A', 'B']); // descending hours
    const sum = r.byBuilding.reduce((a, b) => a + b.cost, 0);
    expect(sum).toBeCloseTo(r.total, 2); // last-bucket remainder makes it exact
    expect(r.byBuilding[0].cost).toBeGreaterThan(r.byBuilding[1].cost);
  });

  it('no hours logged → a single Unallocated line carrying the whole cost', () => {
    const r = disperseSalary({ amount: 1000, period: 'month' }, [], 30.44);
    expect(r.totalHours).toBe(0);
    expect(r.byBuilding).toHaveLength(1);
    expect(r.byBuilding[0].name).toMatch(/unallocated/i);
    expect(r.byBuilding[0].cost).toBeCloseTo(r.total, 5);
  });

  it('drops zero-hour buildings without unbalancing the total', () => {
    const r = disperseSalary({ amount: 3000, period: 'month' }, [
      { name: 'A', hours: 20 }, { name: 'Z', hours: 0 },
    ], 30.44);
    expect(r.byBuilding.map((b) => b.name)).toEqual(['A']); // Z excluded
    expect(r.byBuilding[0].cost).toBeCloseTo(r.total, 2);
  });
});
