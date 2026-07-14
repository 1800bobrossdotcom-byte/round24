import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { looksLikeBuilding, parseSheet, parseWorkbook } from '../importParser.js';

// Excel serial for a UTC date (epoch 1899-12-30) — what raw sheet_to_json yields
const serial = (iso) => (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000;

describe('looksLikeBuilding — the heuristic that discovers buildings from a pay log', () => {
  it.each([
    ['379 S.Main', true],
    ['31 Genesee', true],
    ['Water St.', true],
    ['121 Park', true],
    ['4940 Hillcrest', true],
    ['8 hrs overtime', false],     // time note, not a building
    ['40 hours', false],
    ['5 sick days', false],
    ['Water St.- 4 / St.Paul-1', false], // allocation note, not a name
    ['Total', false],
    ['ok', false],                  // too short
  ])('%s → %s', (input, expected) => {
    expect(looksLikeBuilding(input)).toBe(expected);
  });
});

describe('parseSheet — a pay-log sheet becomes timecard entries', () => {
  const sheetFor = (rows) => XLSX.utils.aoa_to_sheet(rows);

  it('extracts date, hours, and derives rate from pay ÷ hours', () => {
    const ws = sheetFor([
      ['Gianni Pay Log'],
      [serial('2026-06-08'), 4, 120],          // 4h, $120 → $30/hr
      [serial('2026-06-09'), 2.5, 75],
    ]);
    const { techName, entries } = parseSheet(ws, 'Gianni 2026');
    expect(entries).toHaveLength(2);
    expect(entries[0].date).toBe('2026-06-08');
    expect(entries[0].hours).toBe(4);
    expect(entries[0].rate).toBe(30);
    expect(techName).toBe('Gianni');           // year stripped from sheet name
  });

  it('skips TOTAL rows and treats "off" as zero hours', () => {
    const ws = sheetFor([
      [serial('2026-06-08'), 'off'],
      ['Total', 40, 1200],
      [serial('2026-06-09'), 6, 180],
    ]);
    const { entries } = parseSheet(ws, 'Bill');
    expect(entries.map((e) => e.hours)).toEqual([0, 6]);
  });

  it('an implausible implied rate is not trusted', () => {
    // $5,000 for 2h → 2500/hr, way outside the sane band → no silent bad rate
    const ws = sheetFor([[serial('2026-06-08'), 2, 5000]]);
    const [e] = parseSheet(ws, 'X').entries;
    expect(e.rate == null || (e.rate >= 10 && e.rate <= 60)).toBe(true);
  });

  it('a building column allocates the row', () => {
    const ws = sheetFor([
      ['Date', 'Building', 'Hours', 'Pay'],
      [serial('2026-06-08'), '121 Park', 3, 90],
    ]);
    const [e] = parseSheet(ws, 'Gianni').entries;
    expect(e.building).toBe('121 Park');
  });
});

describe('parseWorkbook — whole-file entry point', () => {
  it('round-trips a written workbook', () => {
    const ws = XLSX.utils.aoa_to_sheet([[serial('2026-06-08'), 4, 120]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Gianni');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const parsed = parseWorkbook(buf);
    const g = parsed.sheets ? parsed.sheets : parsed; // tolerate either return shape
    expect(JSON.stringify(g)).toContain('2026-06-08');
  });
});
