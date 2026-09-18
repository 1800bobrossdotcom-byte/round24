import { describe, it, expect } from 'vitest';
import { TIMESHEETS, RENT_ROLLS } from './fixtures/gridLayouts.js';
import { checkTimesheet, checkRentRoll } from './fixtures/gridChecks.js';

// Every layout in the corpus goes through the same code the browser runs
// (XLSX.read on real workbook bytes → interpreter). A failure lists exactly
// what was read wrong. Add a new shape to fixtures/gridLayouts.js and it is
// covered here and in `node scripts/import-lab.mjs`.
describe('timesheet layouts the Import view must read', () => {
  it.each(TIMESHEETS.map((f) => [f.id, f]))('%s', (_id, fx) => {
    expect(checkTimesheet(fx).bad).toEqual([]);
  });
});

describe('rent-roll layouts Leasing must read', () => {
  it.each(RENT_ROLLS.map((f) => [f.id, f]))('%s', (_id, fx) => {
    expect(checkRentRoll(fx).bad).toEqual([]);
  });
});
