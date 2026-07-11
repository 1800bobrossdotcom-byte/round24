// ============================================================
// demo data — one-tap "fill the site" sample set for a fresh org.
// Mirrors the shape addImported()/addWorkOrder()/addPurchase() expect so it
// flows through the app's own write paths (localStorage labor spine + DB work
// orders/purchases). Realistic Evolution24-style portfolio so the dashboard,
// team, properties, orders and purchases all read as a live operation.
// ============================================================

export const DEMO_PROPERTIES = [
  { label: '179-189 St Paul', city: 'Rochester' },
  { label: '301 Central Ave', city: 'Rochester' },
  { label: '440 Armstrong', city: 'Rochester' },
  { label: '31 Genesee', city: 'Rochester' },
  { label: '145 Fitzhugh', city: 'Rochester' },
  { label: '379 S Main', city: 'Geneva' },
  { label: '561 S Main', city: 'Geneva' },
  { label: 'Water St', city: 'Geneva' },
  { label: '121 Park', city: 'Canandaigua' },
  { label: '2215 James St', city: 'Syracuse' },
  { label: '357 Alexander', city: 'Rochester' },
  { label: '4940 Hillcrest', city: 'Canandaigua' },
];

export const DEMO_OPERATORS = [
  { name: 'Gianni Arone', rate: 27, role: 'tech' },
  { name: 'Brent Kowalski', rate: 25, role: 'tech' },
  { name: 'Marco Rossi', rate: 24, role: 'tech' },
  { name: 'Luis Fernandez', rate: 23, role: 'tech' },
  { name: 'Dawn Whitfield', rate: 26, role: 'tech' },
  { name: 'Tyrone Banks', rate: 22, role: 'tech' },
];

const CATEGORIES = ['plumbing', 'electrical', 'hvac', 'painting', 'turn', 'appliance', 'general'];
const ISSUES = {
  plumbing: 'faucet + drain repair',
  electrical: 'outlet / fixture replacement',
  hvac: 'furnace service call',
  painting: 'unit turn — paint',
  turn: 'make-ready turnover',
  appliance: 'appliance swap',
  general: 'general maintenance',
};
const UNITS = ['1A', '1B', '2A', '2B', '3C', '4B', '5A', 'B', 'C', '—'];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const round25 = (n) => Math.round(n * 4) / 4;

// iterate calendar days inclusively in UTC so the ISO date never drifts by tz
function* eachDay(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const cur = new Date(Date.UTC(fy, fm - 1, fd));
  const [ty, tm, td] = to.split('-').map(Number);
  const stop = new Date(Date.UTC(ty, tm - 1, td));
  while (cur <= stop) {
    yield { iso: cur.toISOString().slice(0, 10), dow: cur.getUTCDay() };
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

// generate labor rows in the addImported() shape. propLabel is a building name
// (resolved to a propId by the caller) or null for an unallocated entry.
export function buildDemoTimers({ from = '2026-05-11', to = '2026-07-04' } = {}) {
  const rows = [];
  for (const { iso, dow } of eachDay(from, to)) {
    if (dow === 0) continue;                       // no Sundays
    for (const op of DEMO_OPERATORS) {
      if (dow === 6 && Math.random() > 0.35) continue;   // light Saturdays
      if (Math.random() > 0.85) continue;                // occasional day off
      const hours = round25(5 + Math.random() * 4);      // 5–9 hrs, .25 steps
      const cat = pick(CATEGORIES);
      const unalloc = Math.random() < 0.08;              // ~8% needs allocation
      rows.push({
        techName: op.name,
        propLabel: unalloc ? null : pick(DEMO_PROPERTIES).label,
        unit: unalloc ? '—' : pick(UNITS),
        date: iso,
        category: cat,
        issue: ISSUES[cat] || 'general maintenance',
        durationHrs: hours,
        rate: op.rate,
      });
    }
  }
  return rows;
}

// work orders in the addWorkOrder() shape (propLabel strings, not ids)
export const DEMO_WORK_ORDERS = [
  { task: 'Kitchen faucet leaking under sink', propLabel: '179-189 St Paul', unit: '3C', category: 'plumbing', assigneeLabel: 'Gianni Arone', priority: 1, status: 'in_progress', source: 'voice', transcript: 'unit 3C leaking faucet for Gianni at 179 St Paul' },
  { task: 'Replace hallway smoke detectors (2)', propLabel: '301 Central Ave', unit: '—', category: 'electrical', assigneeLabel: 'Dawn Whitfield', priority: 2, status: 'open', source: 'manual' },
  { task: 'Furnace not igniting — no heat', propLabel: '440 Armstrong', unit: '2B', category: 'hvac', assigneeLabel: 'Brent Kowalski', priority: 1, status: 'open', source: 'manual' },
  { task: 'Turnover paint + patch, unit vacant', propLabel: '121 Park', unit: '5A', category: 'painting', assigneeLabel: 'Marco Rossi', priority: 3, status: 'open', source: 'manual' },
  { task: 'Dishwasher swap — tenant provided unit', propLabel: '31 Genesee', unit: '1A', category: 'appliance', assigneeLabel: 'Luis Fernandez', priority: 3, status: 'in_progress', source: 'manual' },
  { task: 'Front entry door closer adjustment', propLabel: '145 Fitzhugh', unit: '—', category: 'general', assigneeLabel: 'Tyrone Banks', priority: 4, status: 'done', source: 'manual' },
];

// purchases in the addPurchase() shape (status is set to pending by the store;
// we tag a couple as pre-decided by inserting them then flipping status)
export const DEMO_PURCHASES = [
  { vendor: 'Home Depot', amount: 77.88, propLabel: '179-189 St Paul', note: 'faucet cartridge + supply lines', submittedBy: 'Gianni Arone', receiptPath: '/mock/receipt-homedepot.png',
    lineItems: [
      { description: 'SharkBite 1/2" coupling', qty: 1, unitPrice: 8.47, amount: 8.47 },
      { description: 'Fluidmaster supply line 20"', qty: 1, unitPrice: 9.98, amount: 9.98 },
      { description: 'Teflon tape 3pk', qty: 1, unitPrice: 3.27, amount: 3.27 },
      { description: 'Moen 1225 cartridge', qty: 1, unitPrice: 24.97, amount: 24.97 },
      { description: 'Water heater element 4500W', qty: 1, unitPrice: 18.44, amount: 18.44 },
      { description: 'Shop towels 2pk', qty: 1, unitPrice: 6.98, amount: 6.98 },
    ] },
  { vendor: 'Sherwin-Williams', amount: 112.07, propLabel: '121 Park', note: '2 gal eggshell + roller kit', submittedBy: 'Marco Rossi', receiptPath: '/mock/receipt-sherwin.png',
    lineItems: [
      { description: 'ProMar 200 eggshell 1gal', qty: 2, unitPrice: 38.99, amount: 77.98 },
      { description: 'Premium roller covers 3pk', qty: 1, unitPrice: 12.49, amount: 12.49 },
      { description: 'Blue painter tape 1.88"', qty: 1, unitPrice: 7.64, amount: 7.64 },
      { description: '9" roller frame', qty: 1, unitPrice: 8.99, amount: 8.99 },
      { description: 'Drop cloth 9x12 canvas', qty: 1, unitPrice: 14.98, amount: 14.98 },
    ] },
  { vendor: 'Ferguson', amount: 318.0, propLabel: '440 Armstrong', note: 'furnace igniter + flame sensor', submittedBy: 'Brent Kowalski' },
  { vendor: 'Lowe\'s', amount: 449.0, propLabel: '31 Genesee', note: 'dishwasher', submittedBy: 'Luis Fernandez' },
  { vendor: 'Grainger', amount: 61.2, propLabel: '301 Central Ave', note: 'smoke detectors 4-pack', submittedBy: 'Dawn Whitfield' },
];
