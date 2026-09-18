import { describe, it, expect } from 'vitest';
import { toISO, parseHours, parseClock, parseBreakHours, hoursBetween } from '../excelInterpret.js';

describe('toISO — every way a spreadsheet writes a date', () => {
  it.each([
    ['2026-06-08', '2026-06-08'],
    ['2026-6-8', '2026-06-08'],
    ['6/8/2026', '2026-06-08'],
    ['06/08/26', '2026-06-08'],
    ['Mon 6/8/2026', '2026-06-08'],
    ['Monday, 6/8/2026', '2026-06-08'],
    ['June 9, 2026', '2026-06-09'],
    ['10-Jun-2026', '2026-06-10'],
    ['Jun 10 2026', '2026-06-10'],
    [46181, '2026-06-08'],                 // Excel serial
    ['2/30/2026', null],                   // impossible
    ['0000-00-00', null],
    ['Total', null],
    [8, null],                             // an hours cell is not a date
  ])('%s → %s', (input, expected) => {
    expect(toISO(input)).toBe(expected);
  });
  it('reads a Date object as its LOCAL calendar day (SheetJS hands back local midnight)', () => {
    expect(toISO(new Date(2026, 5, 8))).toBe('2026-06-08');
    expect(toISO(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('parseHours', () => {
  it.each([[8, 8], ['8', 8], ['8h', 8], ['8:30', 8.5], ['7:15', 7.25], ['off', 0], ['PTO', 0], ['', null], ['n/a', 0], [150, null]])('%s → %s', (v, want) => {
    expect(parseHours(v)).toBe(want);
  });
});

describe('time in / time out', () => {
  it.each([
    ['7:00 AM', 7], ['3:30 PM', 15.5], ['3:30p', 15.5], ['12:00 AM', 0], ['12:15 PM', 12.25], ['15:30', 15.5], ['8', 8], [8.5, 8.5],
    [0.3125, 7.5],                               // Excel time fraction
    [new Date(1899, 11, 30, 16, 45), 16.75],     // time-only cell as a Date
    ['lunch', null],
  ])('parseClock(%s) → %s', (v, want) => {
    expect(parseClock(v)).toBe(want);
  });
  it.each([['0:30', 0.5], ['30 min', 0.5], ['45m', 0.75], ['1h', 1], [30, 0.5], [0.5, 0.5], [0.0208333, 0.5], ['', 0], [null, 0]])('parseBreakHours(%s) → %s', (v, want) => {
    expect(parseBreakHours(v)).toBeCloseTo(want, 2);
  });
  it('hoursBetween subtracts the break and wraps an overnight shift', () => {
    expect(hoursBetween('7:00 AM', '3:30 PM', '0:30')).toBe(8);
    expect(hoursBetween('10:00 PM', '6:00 AM', null)).toBe(8);
    expect(hoursBetween(0.3333333333, 0.6666666667, '')).toBe(8);
    expect(hoursBetween('junk', '5:00 PM', null)).toBeNull();
  });
});
