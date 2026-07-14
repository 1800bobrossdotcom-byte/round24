import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';

// Regression guard for the export bug class we hit in production: SheetJS drops
// formula-only cells unless a cached value rides along. If an xlsx upgrade ever
// changes this behavior, this test flags it before an exported timesheet loses
// its Pay column.
describe('xlsx formula cells keep formula + cached value through write/read', () => {
  it('round-trips f and v', () => {
    const ws = XLSX.utils.aoa_to_sheet([['Hours', 'Rate', 'Pay'], [2, 30, null]]);
    ws['C2'] = { t: 'n', f: 'A2*B2', v: 60 };
    ws['!ref'] = 'A1:C2';
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'T');
    const back = XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array', cellFormula: true });
    expect(back.Sheets.T.C2.f).toBe('A2*B2');
    expect(back.Sheets.T.C2.v).toBe(60);
  });
});
