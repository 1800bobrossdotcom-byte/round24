import { describe, it, expect } from 'vitest';
import { isName, hasDollarGrid, allocatePayLogPeriods } from '../payLogAllocate.js';

describe('isName — building-name cell detection', () => {
  it('accepts real building labels, including month-lookalikes', () => {
    expect(isName('379 S.Main')).toBe(true);
    expect(isName('May Street')).toBe(true);   // NOT the month "May" — the fix
    expect(isName('March Lane')).toBe(true);
    expect(isName('Parkview Lofts')).toBe(true);
  });
  it('rejects numbers, money, and header/label/month cells', () => {
    expect(isName('1250')).toBe(false);
    expect(isName('$1,250.00')).toBe(false);
    expect(isName('Total')).toBe(false);
    expect(isName('May')).toBe(false);         // a bare month cell
    expect(isName('May 2026')).toBe(false);    // month + year
    expect(isName('Quarterly')).toBe(false);
    expect(isName(42)).toBe(false);
  });
});

// two named buildings over cols 4–5 with a dollar row beneath, one pay period.
const D = (y, m, d) => new Date(y, m, d);
const rows = [
  [D(2026, 0, 5), 8, null, null, 'May Street', '379 S.Main', null, null],
  [null, null, null, null, 300, 200, null, null],
  ['Total Pay Period', null, null, null, null, null, null, null],
];

describe('hasDollarGrid', () => {
  it('detects a name-over-dollars grid, ignores a plain columnar sheet', () => {
    expect(hasDollarGrid(rows)).toBe(true);
    expect(hasDollarGrid([[D(2026, 0, 5), 8, 'plumbing', 'leak']])).toBe(false);
  });
});

describe('allocatePayLogPeriods — dollars/rate → hours on the right door', () => {
  const match = (label) => (label === 'May Street' ? 'May Street' : null); // 379 S.Main unmatched
  const r = allocatePayLogPeriods(rows, match, 25);

  it('emits one dated entry per building, hours = dollars / rate', () => {
    expect(r.hasGrid).toBe(true);
    const may = r.entries.find((e) => e.building === 'May Street');
    const main = r.entries.find((e) => e.dollars === 200);
    expect(may).toMatchObject({ date: '2026-01-05', dollars: 300, hours: 12 });   // 300/25
    expect(main).toMatchObject({ date: '2026-01-05', dollars: 200, hours: 8 });   // 200/25
  });
  it('keeps unmatched labels (unlinked, not dropped) and reports them', () => {
    expect(r.entries.find((e) => e.building === '379 S.Main')).toBeTruthy();
    expect([...r.unmatched]).toEqual(['379 S.Main']);
  });
  it('reproduces the grid dollar total to the cent', () => {
    const sum = r.entries.reduce((a, e) => a + e.dollars, 0);
    expect(sum).toBe(500);
  });
  it('falls back to a $23 rate when rate <= 0', () => {
    const r0 = allocatePayLogPeriods(rows, match, 0);
    expect(r0.entries.find((e) => e.dollars === 300).hours).toBeCloseTo(300 / 23, 2);
  });
  it('non-grid sheet → hasGrid false, no entries', () => {
    expect(allocatePayLogPeriods([[D(2026, 0, 5), 8]], match, 25)).toMatchObject({ hasGrid: false, entries: [] });
  });
});
