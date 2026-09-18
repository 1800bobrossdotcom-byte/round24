// ============================================================
// A corpus of spreadsheet layouts the importer must read. Each fixture builds
// a real workbook buffer (the exact bytes the browser hands XLSX.read) and
// states what a correct read looks like. Shared by the vitest layout suite and
// scripts/import-lab.mjs, so a new shape found in the wild gets added here once.
// ============================================================
import * as XLSX from 'xlsx';

// Excel serial for a date (what an unformatted numeric date cell holds)
export const serial = (iso) => (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000;
// a JS Date at LOCAL midnight — what SheetJS yields for a date-formatted cell
export const D = (iso) => new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

// sheets: { name: aoa } or { name: { aoa, merges: ['A1:D1'], dates: true } }
export function book(sheets, { bookType = 'xlsx' } = {}) {
  const wb = XLSX.utils.book_new();
  for (const [name, spec] of Object.entries(sheets)) {
    const aoa = Array.isArray(spec) ? spec : spec.aoa;
    const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
    if (!Array.isArray(spec) && spec.merges) ws['!merges'] = spec.merges.map((r) => XLSX.utils.decode_range(r));
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { type: 'array', bookType });
}
export const csv = (text) => new TextEncoder().encode(text).buffer;

const days = (from, n) => Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10) + i)); return d.toISOString().slice(0, 10); });

// ---- timesheets: what the Import view ingests ----------------------------
export const TIMESHEETS = [
  {
    id: 'columnar-basic', title: 'Plain Date | Hours | Property | Notes, serial dates',
    build: () => book({ Gianni: [
      ['Date', 'Hours', 'Property', 'Notes'],
      [serial('2026-06-08'), 8, '121 Park', 'boiler'],
      [serial('2026-06-09'), 6.5, 'Water St.', 'faucet 2B'],
      [serial('2026-06-10'), 'off', '', ''],
    ] }),
    expect: { layout: 'columnar', entries: 3, hours: 14.5, buildings: ['121 Park', 'Water St.'], techs: ['Gianni'] },
  },
  {
    id: 'columnar-title-rows', title: 'Title + blank rows above the header, merged title cell',
    build: () => book({ 'Pay Log 2026': { aoa: [
      ['Acme Maintenance — Crew Timesheet'], [], ['Prepared by office', '', 'Week 24'],
      ['Date', 'Hours', 'Building', 'Notes'],
      [serial('2026-06-08'), 8, '379 S.Main', ''],
      [serial('2026-06-09'), 4, '379 S.Main', ''],
    ], merges: ['A1:D1'] } }),
    expect: { layout: 'columnar', entries: 2, hours: 12, buildings: ['379 S.Main'] },
  },
  {
    id: 'columnar-text-dates-hm', title: 'Dates typed as 6/8/2026 text, hours as 8:30',
    build: () => book({ Bill: [
      ['Date', 'Hours', 'Location'],
      ['6/8/2026', '8:30', '121 Park'],
      ['6/9/2026', '7:15', 'Water St.'],
      ['06/10/2026', '8', '121 Park'],
    ] }),
    expect: { layout: 'columnar', entries: 3, hours: 23.75, buildings: ['121 Park', 'Water St.'] },
  },
  {
    id: 'columnar-date-objects', title: 'Date-formatted cells (Date objects after read)',
    build: () => book({ Gianni: [
      ['Date', 'Hours', 'Property'],
      [D('2026-06-08'), 8, '121 Park'],
      [D('2026-06-09'), 8, '121 Park'],
      [D('2026-12-31'), 4, 'Water St.'],
    ] }),
    expect: { layout: 'columnar', entries: 3, hours: 20, dates: ['2026-06-08', '2026-06-09', '2026-12-31'] },
  },
  {
    id: 'columnar-employee-col', title: 'One sheet, many techs: Employee | Date | Hours | Property',
    build: () => book({ Timesheet: [
      ['Employee', 'Date', 'Hours', 'Property'],
      ['Alice', serial('2026-06-08'), 8, '121 Park'],
      ['Bob', serial('2026-06-08'), 6, 'Water St.'],
      ['Alice', serial('2026-06-09'), 7, '121 Park'],
    ] }),
    expect: { layout: 'columnar', entries: 3, hours: 21, techs: ['Alice', 'Bob'] },
  },
  {
    id: 'columnar-subtotals', title: 'Weekly subtotal rows + grand total inside the table',
    build: () => book({ Gianni: [
      ['Date', 'Hours', 'Property'],
      [serial('2026-06-08'), 8, '121 Park'],
      [serial('2026-06-09'), 8, '121 Park'],
      ['Week total', 16, ''],
      [serial('2026-06-15'), 5, 'Water St.'],
      ['Subtotal', 5, ''],
      ['TOTAL', 21, ''],
    ] }),
    expect: { layout: 'columnar', entries: 3, hours: 21 },
  },
  {
    id: 'columnar-rate-pay-currency', title: 'Rate and Pay as "$" strings',
    build: () => book({ Gianni: [
      ['Date', 'Hours', 'Rate', 'Pay', 'Property'],
      [serial('2026-06-08'), 8, '$30.00', '$240.00', '121 Park'],
      [serial('2026-06-09'), 4, '$30.00', '$120.00', '121 Park'],
    ] }),
    expect: { layout: 'columnar', entries: 2, hours: 12, rate: 30, pay: 360 },
  },
  {
    id: 'columnar-offset', title: 'Table starts at C5 with blank rows between weeks',
    build: () => book({ Gianni: [
      [], [], [], [],
      [null, null, 'Date', 'Hours', 'Property'],
      [null, null, serial('2026-06-08'), 8, '121 Park'],
      [],
      [null, null, serial('2026-06-15'), 8, 'Water St.'],
    ] }),
    expect: { layout: 'columnar', entries: 2, hours: 16, buildings: ['121 Park', 'Water St.'] },
  },
  {
    id: 'columnar-header-synonyms', title: 'Work Date | Hrs | Job Site | Description',
    build: () => book({ 'Crew hours': [
      ['Work Date', 'Hrs', 'Job Site', 'Description'],
      [serial('2026-06-08'), 8, '4940 Hillcrest', 'gutters'],
      [serial('2026-06-09'), 3, '4940 Hillcrest', 'gutters'],
    ] }),
    expect: { layout: 'columnar', entries: 2, hours: 11, buildings: ['4940 Hillcrest'] },
  },
  {
    id: 'columnar-notes-mention-building', title: 'Notes mention another building; Property column wins',
    build: () => book({ Gianni: [
      ['Date', 'Hours', 'Property', 'Notes'],
      [serial('2026-06-08'), 8, '121 Park', 'picked up parts near Water St.'],
    ] }),
    expect: { layout: 'columnar', entries: 1, hours: 8, buildings: ['121 Park'], notBuildings: ['Water St.'] },
  },
  {
    id: 'columnar-reg-ot', title: 'Regular + overtime columns, no plain Hours',
    build: () => book({ Gianni: [
      ['Date', 'Reg Hours', 'OT', 'Property'],
      [serial('2026-06-08'), 8, 2, '121 Park'],
      [serial('2026-06-09'), 8, 0, '121 Park'],
    ] }),
    expect: { layout: 'columnar', entries: 2, hours: 18 },
  },
  {
    id: 'columnar-in-out', title: 'Time In / Time Out (+ unpaid break) instead of hours',
    build: () => book({ Bill: [
      ['Date', 'Time In', 'Time Out', 'Break', 'Property'],
      [serial('2026-06-08'), '7:00 AM', '3:30 PM', '0:30', '121 Park'],
      [serial('2026-06-09'), 0.3333333333, 0.6666666667, '', 'Water St.'],   // Excel time fractions 8:00 → 16:00
      [serial('2026-06-10'), '8:00', '12:00', '', '121 Park'],
    ] }),
    expect: { layout: 'columnar', entries: 3, hours: 20 },
  },
  {
    id: 'columnar-unit-category', title: 'Unit and Category columns ride along',
    build: () => book({ Gianni: [
      ['Date', 'Hours', 'Property', 'Unit', 'Category', 'Notes'],
      [serial('2026-06-08'), 3, '121 Park', '2B', 'Plumbing', 'leak'],
      [serial('2026-06-08'), 5, '121 Park', '3A', 'Electrical', 'outlet'],
    ] }),
    expect: { layout: 'columnar', entries: 2, hours: 8, units: ['2B', '3A'], categories: ['plumbing', 'electrical'] },
  },
  {
    id: 'columnar-long-preamble', title: 'Header buried under 25 preamble rows',
    build: () => book({ Gianni: [
      ...Array.from({ length: 25 }, (_, i) => [`Instruction line ${i + 1}`]),
      ['Date', 'Hours', 'Property'],
      [serial('2026-06-08'), 8, '121 Park'],
    ] }),
    expect: { layout: 'columnar', entries: 1, hours: 8 },
  },
  {
    id: 'columnar-weekday-dates', title: 'Dates like "Mon 6/8/2026" and "June 9, 2026" and "10-Jun-2026"',
    build: () => book({ Gianni: [
      ['Date', 'Hours', 'Property'],
      ['Mon 6/8/2026', 8, '121 Park'],
      ['June 9, 2026', 8, '121 Park'],
      ['10-Jun-2026', 4, '121 Park'],
    ] }),
    expect: { layout: 'columnar', entries: 3, hours: 20, dates: ['2026-06-08', '2026-06-09', '2026-06-10'] },
  },
  {
    id: 'columnar-two-periods', title: 'Two pay periods with their own labels and repeated headers',
    build: () => book({ Gianni: [
      ['Pay period 6/7 - 6/20'],
      ['Date', 'Hours', 'Property'],
      [serial('2026-06-08'), 8, '121 Park'],
      ['Pay period 6/21 - 7/4'],
      ['Date', 'Hours', 'Property'],
      [serial('2026-06-22'), 6, 'Water St.'],
    ] }),
    expect: { layout: 'columnar', entries: 2, hours: 14 },
  },
  {
    id: 'wide-hours-per-building', title: 'Wide: Date | 121 Park | Water St. | 379 S.Main (hours per building)',
    build: () => book({ Gianni: [
      ['Date', '121 Park', 'Water St.', '379 S.Main'],
      [serial('2026-06-08'), 4, 4, ''],
      [serial('2026-06-09'), '', 2, 6],
    ] }),
    expect: { layout: 'wide', entries: 4, hours: 16, buildings: ['121 Park', 'Water St.', '379 S.Main'] },
  },
  {
    id: 'wide-with-total-col', title: 'Wide grid with a trailing Total column and a totals row',
    build: () => book({ Gianni: [
      ['Date', '121 Park', 'Water St.', 'Total'],
      [serial('2026-06-08'), 4, 4, 8],
      [serial('2026-06-09'), 8, '', 8],
      ['Total', 12, 4, 16],
    ] }),
    expect: { layout: 'wide', entries: 3, hours: 16 },
  },
  {
    id: 'wide-dollar-weights', title: 'Wide: Hours column + $ per building (dollar-weighted split)',
    build: () => book({ Gianni: [
      ['Date', 'Hours', '121 Park', 'Water St.'],
      [serial('2026-06-08'), 8, 150, 50],
    ] }),
    expect: { layout: 'wide', entries: 1, hours: 8, weights: [150, 50] },
  },
  {
    id: 'weekly-grid-buildings-down', title: 'Week of 6/8: buildings down, Mon–Sun across',
    build: () => book({ Gianni: [
      ['Week of 6/8/2026'],
      ['Property', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Total'],
      ['121 Park', 4, 8, '', 8, 4, '', '', 24],
      ['Water St.', 4, '', 8, '', 4, '', '', 16],
      ['Total', 8, 8, 8, 8, 8, '', '', 40],
    ] }),
    expect: { layout: 'grid', entries: 7, hours: 40, dates: ['2026-06-08', '2026-06-12'], buildings: ['121 Park', 'Water St.'] },
  },
  {
    id: 'month-grid-dates-across', title: 'Month grid: properties down, dates across (serials)',
    build: () => book({ 'June 2026': [
      ['Property', ...days('2026-06-01', 10).map(serial), 'Total'],
      ['121 Park', 8, 8, '', '', 8, 8, 8, '', '', 4, 44],
      ['Water St.', '', '', 8, 8, '', '', '', 8, 8, 4, 36],
    ] }),
    expect: { layout: 'grid', entries: 11, hours: 80, dates: ['2026-06-01', '2026-06-10'] },
  },
  {
    id: 'weekly-grid-techs-down', title: 'Employees down, dates across (team roster week)',
    build: () => book({ 'Week 24': [
      ['Employee', D('2026-06-08'), D('2026-06-09'), D('2026-06-10'), D('2026-06-11'), D('2026-06-12')],
      ['Alice', 8, 8, 8, 8, 4],
      ['Bob', 6, 6, '', 6, 6],
    ] }),
    expect: { layout: 'grid', entries: 9, hours: 60, techs: ['Alice', 'Bob'] },
  },
  {
    id: 'matrix-legacy', title: 'Evolution24 matrix: names row over $ row, per pay period',
    build: () => book({ 'Gianni Pay Log 2026': [
      ['HOURLY: 25.00'],
      [D('2026-06-08'), 8, '', '', '121 Park', 'Water St.', '', ''],
      [null, null, null, null, 150, 50, null, null],
      [D('2026-06-09'), 8, '', '', '', '', '', ''],
      ['Total Pay Period', 16],
    ] }),
    expect: { entries: 2, hours: 16, grid: true },
  },
  {
    id: 'multi-sheet-mixed', title: 'Workbook with a tech sheet, a Summary tab and a P&L tab',
    build: () => book({
      'Gianni 2026': [['Date', 'Hours', 'Property'], [serial('2026-06-08'), 8, '121 Park']],
      Summary: [['Name', 'Hours', 'Pay'], ['Gianni', 8, 240], ['Bill', 40, 1000]],
      'P&L 2026': [['Income', 'Jan', 'Feb'], ['Rent', 12000, 12000], ['Taxes', 1500, 1500], ['NOI', 8000, 8000]],
    }),
    expect: { sheets: { 'Gianni 2026': { entries: 1, payLog: true }, Summary: { entries: 0 }, 'P&L 2026': { entries: 0 } } },
  },
  {
    id: 'csv-columnar', title: 'CSV export of a columnar timesheet',
    build: () => csv('Date,Hours,Property,Notes\n2026-06-08,8,121 Park,boiler\n2026-06-09,6.5,Water St.,\n'),
    expect: { layout: 'columnar', entries: 2, hours: 14.5 },
  },
  {
    id: 'xls-biff', title: 'Legacy .xls (BIFF8) workbook',
    build: () => book({ Gianni: [['Date', 'Hours', 'Property'], [serial('2026-06-08'), 8, '121 Park']] }, { bookType: 'xls' }),
    expect: { layout: 'columnar', entries: 1, hours: 8 },
  },
  {
    id: 'columnar-formula-hours', title: 'Hours computed by formula (cached values)',
    build: () => {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([['Date', 'In', 'Out', 'Hours', 'Property'], [serial('2026-06-08'), 0.3333333333, 0.6666666667, null, '121 Park']]);
      ws.D2 = { t: 'n', f: '(C2-B2)*24', v: 8 };
      ws['!ref'] = 'A1:E2';
      XLSX.utils.book_append_sheet(wb, ws, 'Gianni');
      return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    },
    expect: { layout: 'columnar', entries: 1, hours: 8 },
  },
  {
    id: 'not-a-grid-pl-dates', title: 'A P&L tab with month-start dates across is NOT an hours grid',
    build: () => book({ 'Cash flow': [
      ['Line', serial('2026-01-01'), serial('2026-02-01'), serial('2026-03-01'), serial('2026-04-01')],
      ['Rent', 12000, 12000, 12500, 12500],
      ['Taxes', 1500, 1500, 1500, 1500],
      ['Vacancy %', 5, 4, 6, 5],
      ['Units turned', 1, 0, 2, 1],
    ] }),
    expect: { sheets: { 'Cash flow': { entries: 0, payLog: false } } },
  },
  {
    id: 'month-grid-day-numbers', title: 'Month grid: "June 2026" title, day numbers 1..31 across',
    build: () => book({ Gianni: [
      ['June 2026 — hours by property'],
      ['Property', 1, 2, 3, 4, 5, 6, 7, 'Total'],
      ['121 Park', 8, 8, '', '', 8, 4, '', 28],
      ['Water St.', '', '', 8, 8, '', 4, '', 20],
      ['Total', 8, 8, 8, 8, 8, 8, '', 48],
    ] }),
    expect: { layout: 'grid', entries: 7, hours: 48, dates: ['2026-06-01', '2026-06-06'], buildings: ['121 Park', 'Water St.'] },
  },
  {
    id: 'weekly-grid-week-ending', title: '"Week ending 6/14/2026" anchor, Sun–Sat columns',
    build: () => book({ Gianni: [
      ['Week ending 6/14/2026'],
      ['Site', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      ['121 Park', '', 8, 8, '', '', '', ''],
    ] }),
    expect: { layout: 'grid', entries: 2, hours: 16, dates: ['2026-06-08', '2026-06-09'] },
  },
  {
    id: 'columnar-in-out-time-cells', title: 'Time In / Out as real time cells (Dates on the epoch day)',
    build: () => book({ Bill: [
      ['Date', 'Start', 'End', 'Lunch', 'Property'],
      [D('2026-06-08'), new Date(1899, 11, 30, 7, 0), new Date(1899, 11, 30, 15, 30), new Date(1899, 11, 30, 0, 30), '121 Park'],
      [D('2026-06-09'), new Date(1899, 11, 30, 22, 0), new Date(1899, 11, 30, 6, 0), '', 'Water St.'],   // overnight
    ] }),
    expect: { layout: 'columnar', entries: 2, hours: 16 },
  },
  {
    id: 'columnar-employee-blank-hours', title: 'Employee column with blank-hours rows (unpaid days) mixed in',
    build: () => book({ Crew: [
      ['Name', 'Date', 'Hours', 'Site'],
      ['Alice', serial('2026-06-08'), 8, '121 Park'],
      ['Alice', serial('2026-06-09'), '', ''],
      ['Bob', serial('2026-06-09'), 'PTO', ''],
      ['Bob', serial('2026-06-10'), 4, 'Water St.'],
    ] }),
    expect: { layout: 'columnar', entries: 3, hours: 12, techs: ['Alice', 'Bob'] },
  },
];

// ---- rent rolls: what Leasing ingests --------------------------------------
export const RENT_ROLLS = [
  {
    id: 'rr-flat', title: 'Flat: Unit | Tenant | Rent | Building | Status',
    build: () => book({ 'Rent Roll': [
      ['Unit', 'Tenant', 'Rent', 'Building', 'Status'],
      ['101', 'Alice', '$1,250.00', 'Maple', 'leased'],
      ['102', '', 1400, 'Maple', 'vacant'],
      ['201', 'Bob', 1600, 'Oak', 'occupied'],
      ['Total', '', 4250, '', ''],
    ] }),
    expect: { units: 3, buildings: ['Maple', 'Oak'], vacant: 1 },
  },
  {
    id: 'rr-title-rows-synonyms', title: 'Report title rows; Unit # | Resident | Monthly Rent | Lease Start | Lease End | Deposit',
    build: () => book({ Report: [
      ['Rent Roll as of 6/1/2026'], ['Northgate Property Co.'], [],
      ['Unit #', 'Resident', 'Monthly Rent', 'Lease Start', 'Lease End', 'Deposit'],
      [101, 'Alice', 1250, serial('2025-06-01'), '05/31/2026', 1250],
      [102, 'VACANT', 1400, '', '', ''],
    ] }),
    expect: { units: 2, vacant: 1, leaseStart: { 101: '2025-06-01' }, leaseEnd: { 101: '2026-05-31' } },
  },
  {
    id: 'rr-grouped-sections', title: 'One table, building section rows with per-building totals',
    build: () => book({ 'Rent Roll': [
      ['Unit', 'Tenant', 'Rent', 'Status'],
      ['Maple Court', '', '', ''],
      ['101', 'Alice', 1250, 'Occupied'],
      ['102', '', 1400, 'Vacant'],
      ['Total Maple Court', '', 2650, ''],
      ['Oak Street', '', '', ''],
      ['201', 'Bob', 1600, 'Occupied'],
      ['Total Oak Street', '', 1600, ''],
      ['Grand Total', '', 4250, ''],
    ] }),
    expect: { units: 3, buildings: ['Maple Court', 'Oak Street'] },
  },
  {
    id: 'rr-first-last', title: 'First / Last name columns, Bed/Bath as "2/1"',
    build: () => book({ 'Elm Street': [
      ['Apt', 'First Name', 'Last Name', 'Bed/Bath', 'Rent'],
      ['1A', 'Alice', 'Smith', '2/1', 1200],
      ['1B', '', '', 'Studio', 900],
    ] }),
    expect: { units: 2, tenants: { '1A': 'Alice Smith' }, beds: { '1A': 2, '1B': 0 }, vacant: 1 },
  },
  {
    id: 'rr-market-vs-lease-rent', title: 'Market Rent AND Lease Rent columns (lease rent must win)',
    build: () => book({ 'Rent Roll': [
      ['Unit', 'Tenant', 'Market Rent', 'Lease Rent', 'Status'],
      ['101', 'Alice', 1500, 1250, 'Occupied'],
      ['102', '', 1500, '', 'Vacant'],
    ] }),
    expect: { units: 2, rent: { 101: 1250 } },
  },
  {
    id: 'rr-per-building-sheets', title: 'One sheet per building (legacy worksheet style)',
    build: () => book({
      '121 Park 2026': [['Apartment', 'Tenant Name', 'Rent Amount', 'Lease End'], ['1', 'Alice', 1250, '05/31/2026'], ['2', 'Vacant', 1300, '']],
      'Water St 2026': [['Apartment', 'Tenant Name', 'Rent Amount', 'Lease End'], ['A', 'Bob', 1100, '12/31/2026']],
      Notes: [['remember to call the plumber']],
    }),
    expect: { units: 3, buildings: ['121 Park', 'Water St'] },
  },
  {
    id: 'rr-csv', title: 'CSV rent roll with quoted currency',
    build: () => csv('Unit,Tenant,Rent,Status\n101,Alice,"$1,250.00",Occupied\n102,,"$1,400.00",Vacant\n'),
    expect: { units: 2, rent: { 101: 1250 } },
  },
  {
    id: 'rr-header-late', title: 'Header on row 15 after a long cover block',
    build: () => book({ 'Rent Roll': [
      ...Array.from({ length: 14 }, (_, i) => [`Cover line ${i + 1}`]),
      ['Unit', 'Tenant', 'Rent'],
      ['101', 'Alice', 1250],
    ] }),
    expect: { units: 1 },
  },
  {
    id: 'rr-numeric-units-dates', title: 'Numeric unit numbers, move-in/out as text dates, phone column',
    build: () => book({ 'Rent Roll': [
      ['Unit', 'Tenant', 'Phone', 'Rent', 'Move-in', 'Move-out'],
      [101, 'Alice', '(585) 555-0100', 1250, '06/01/2025', '05/31/2026'],
      [102.0, 'Bob', '', 1300, '2025-07-01', ''],
    ] }),
    expect: { units: 2, unitNumbers: ['101', '102'], leaseStart: { 101: '2025-06-01', 102: '2025-07-01' } },
  },
  {
    id: 'rr-commercial-mixed', title: 'Mixed residential + commercial with a Type column',
    build: () => book({ 'Halsey Commons': [
      ['Unit', 'Tenant', 'Type', 'Rent'],
      ['Suite 100', 'Corner Café LLC', 'Commercial', 3200],
      ['2A', 'Alice', '1 BR', 1100],
    ] }),
    expect: { units: 2, types: { 'Suite 100': 'commercial', '2A': 'residential' } },
  },
  {
    id: 'rr-grouped-sections-vacant-lone', title: 'Sections + a vacant row that is only a unit number',
    build: () => book({ 'Rent Roll': [
      ['Unit', 'Tenant', 'Rent'],
      ['Maple Court'],
      ['101', 'Alice', 1250],
      ['103'],
      ['Oak Street'],
      ['201', 'Bob', 1600],
      ['Total'],
      ['Occupancy', '', '95%'],
    ] }),
    expect: { units: 3, buildings: ['Maple Court', 'Oak Street'], vacant: 1, unitNumbers: ['101', '103', '201'] },
  },
  {
    id: 'rr-date-cells', title: 'Lease dates as real date cells (Date objects)',
    build: () => book({ 'Rent Roll': [
      ['Unit', 'Tenant', 'Rent', 'Lease Start', 'Lease End'],
      ['101', 'Alice', 1250, D('2025-06-01'), D('2026-05-31')],
    ] }),
    expect: { units: 1, leaseStart: { 101: '2025-06-01' }, leaseEnd: { 101: '2026-05-31' } },
  },
];
