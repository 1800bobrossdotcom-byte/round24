import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { interpretRentRoll } from '../rentRollInterpret.js';
import { looksPLSheet } from '../plSheetInterpret.js';

// build a real .xlsx array buffer from a 2-D array so we exercise the actual
// XLSX read path the importer uses in the browser.
function bookFrom(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

describe('interpretRentRoll — generic flat rent roll', () => {
  const buf = bookFrom({
    'Rent Roll': [
      ['Unit', 'Tenant', 'Rent', 'Building', 'Status'],
      ['101', 'Alice', '$1,250.00', 'Maple', 'leased'],   // currency string
      ['102', '', 1400, 'Maple', 'vacant'],               // vacant → tenant blanked
      ['201', 'Bob', 1600, 'Oak', 'occupied'],
      ['Total', '', 4250, '', ''],                        // totals row → stop
    ],
  });
  const { buildings } = interpretRentRoll(buf);
  const maple = buildings.find((b) => b.name === 'Maple');
  const oak = buildings.find((b) => b.name === 'Oak');

  it('fans rows out into buildings via the Property column', () => {
    expect(buildings.map((b) => b.name).sort()).toEqual(['Maple', 'Oak']);
    expect(maple.units).toHaveLength(2);
    expect(oak.units).toHaveLength(1);
  });
  it('coerces a "$1,250.00" string to 1250 and keeps a numeric rent', () => {
    expect(maple.units.find((u) => u.number === '101').rent).toBe(1250);
    expect(maple.units.find((u) => u.number === '102').rent).toBe(1400);
  });
  it('marks vacancy and blanks the tenant on a vacant unit', () => {
    const u102 = maple.units.find((u) => u.number === '102');
    expect(u102.status).toBe('vacant');
    expect(u102.tenant).toBe('');
    expect(maple.units.find((u) => u.number === '101').status).toBe('leased');
  });
  it('stops at the Total row (no phantom unit)', () => {
    expect(buildings.every((b) => b.units.every((u) => u.number !== 'Total'))).toBe(true);
  });
});

describe('looksPLSheet — P&L tab detection', () => {
  it('matches P&L / profit / T12 tabs, not pay-log or vendor tabs', () => {
    expect(looksPLSheet('2026 P&L')).toBe(true);
    expect(looksPLSheet('T12 Profit')).toBe(true);
    expect(looksPLSheet('Pay Log')).toBe(false);
    expect(looksPLSheet('Vendors')).toBe(false);
  });
});
