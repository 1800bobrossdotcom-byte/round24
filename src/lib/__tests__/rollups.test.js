import { describe, it, expect } from 'vitest';
import { fmtMoney, fmtMoneyC, cost, periodKey, rollup, byPeriod, byTech, byProp } from '../rollups.js';

const T = (over = {}) => ({ techId: 't1', propId: 'p1', date: '2026-07-13', durationHrs: 2, rate: 30, ...over });

describe('formatters never leak NaN to the DOM', () => {
  it('fmtMoney', () => {
    expect(fmtMoney(1234.6)).toBe('$1,235');
    expect(fmtMoney(NaN)).toBe('$0');
    expect(fmtMoney(Infinity)).toBe('$0');
    expect(fmtMoney(undefined)).toBe('$0');
  });
  it('fmtMoneyC', () => {
    expect(fmtMoneyC(12.5)).toBe('$12.50');
    expect(fmtMoneyC(NaN)).toBe('$0.00');
  });
});

describe('cost', () => {
  it('hours × rate', () => expect(cost(T())).toBe(60));
  it('missing rate → 0, never NaN', () => expect(cost(T({ rate: undefined }))).toBe(0));
  it('missing hours → 0', () => expect(cost(T({ durationHrs: null }))).toBe(0));
});

describe('periodKey', () => {
  it('day/month/year grains', () => {
    expect(periodKey('2026-07-13', 'day')).toBe('2026-07-13');
    expect(periodKey('2026-07-13', 'month')).toBe('2026-07');
    expect(periodKey('2026-07-13', 'year')).toBe('2026');
  });
  it('week rolls back to the configured start day (Sat=6, Evolution24)', () => {
    // 2026-07-13 is a Monday; the Saturday-start week began 2026-07-11
    expect(periodKey('2026-07-13', 'week', 6)).toBe(periodKey('2026-07-11', 'week', 6));
    // and Friday 2026-07-10 belongs to the PREVIOUS Sat-start week
    expect(periodKey('2026-07-10', 'week', 6)).not.toBe(periodKey('2026-07-11', 'week', 6));
  });
  it('a date on the start day keys to itself', () => {
    const k = periodKey('2026-07-11', 'week', 6); // a Saturday
    expect(k).toContain('2026-07-11');
  });
});

describe('rollup reconciliation — buckets must sum to the whole', () => {
  const timers = [
    T({ propId: 'a', techId: 'g', durationHrs: 3, rate: 30, date: '2026-07-06' }),
    T({ propId: 'a', techId: 'b', durationHrs: 2, rate: 25, date: '2026-07-07' }),
    T({ propId: 'b', techId: 'g', durationHrs: 1.5, rate: 30, date: '2026-07-13' }),
    T({ propId: 'c', techId: 'g', durationHrs: 4, rate: 30, date: '2026-07-14' }),
  ];
  const total = timers.reduce((a, t) => a + cost(t), 0);
  const hoursTotal = timers.reduce((a, t) => a + t.durationHrs, 0);

  it('byProp buckets reconcile to the total (the allocation-engine invariant)', () => {
    const buckets = byProp(timers);
    expect(buckets.reduce((a, b) => a + b.cost, 0)).toBeCloseTo(total, 6);
    expect(buckets.reduce((a, b) => a + b.hrs, 0)).toBeCloseTo(hoursTotal, 6);
  });
  it('byTech reconciles too', () => {
    expect(byTech(timers).reduce((a, b) => a + b.cost, 0)).toBeCloseTo(total, 6);
  });
  it('byPeriod (week) reconciles and splits across weeks', () => {
    const weeks = byPeriod(timers, 'week', 6);
    expect(weeks.reduce((a, b) => a + b.cost, 0)).toBeCloseTo(total, 6);
    expect(weeks.length).toBeGreaterThan(1); // Jul 6–7 vs Jul 13–14 are different Sat-weeks
  });
  it('rollup keys and counts', () => {
    const byP = rollup(timers, (t) => t.propId);
    expect(byP.find((b) => b.key === 'a').count).toBe(2);
  });
});
