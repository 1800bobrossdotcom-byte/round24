import { describe, it, expect } from 'vitest';
import { localISO, todayISO } from '../dates.js';

// The trap these guard against: `new Date().toISOString().slice(0, 10)` formats
// in UTC, so a timer stopped at 9pm Eastern lands on TOMORROW's date — and on a
// Friday night, in the next Saturday-start pay period.
describe('localISO — the calendar day in LOCAL time', () => {
  it('formats the local components, late evening included', () => {
    expect(localISO(new Date(2026, 8, 16, 23, 30))).toBe('2026-09-16');
    expect(localISO(new Date(2026, 0, 1, 0, 0, 1))).toBe('2026-01-01');
    expect(localISO(new Date(2026, 11, 31, 23, 59, 59))).toBe('2026-12-31');
  });
  it('zero-pads month and day', () => {
    expect(localISO(new Date(2026, 2, 5))).toBe('2026-03-05');
  });
  it('todayISO is localISO(now)', () => {
    expect(todayISO()).toBe(localISO(new Date()));
  });
});
