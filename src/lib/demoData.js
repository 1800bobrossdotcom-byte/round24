// ============================================================
// demo data — the ONE sample universe every demo surface shares.
//
// Everything a fresh org or an unconfigured build shows — labor spine, crew,
// buildings, work orders, purchases, expense history — is generated here on top
// of the same fictional portfolio the rent roll, CAM, inspections, handbook and
// amenities already use (leaseDemo.js). One universe means the per-door P&L,
// Today board, timesheets and calendar all agree with each other, and no real
// customer data ships in the bundle.
//
// Two properties of the generator matter for a demo:
//   · DETERMINISTIC — a seeded PRNG, so the numbers don't jump on every reload.
//   · RELATIVE DATES — the spine always ends today, so "Today", "this week" and
//     "last 2 weeks" are never empty no matter when the demo is opened.
// ============================================================

import { DEMO_PORTFOLIO_BUILDINGS, BUILDING_INFO, DEMO_LEASING } from '../data/leaseDemo.js';

export const DEMO_ORG = 'Northgate Property Co.';

// buildings labor can land on: the sample portfolio minus land parcels
export const DEMO_PROPERTIES = DEMO_PORTFOLIO_BUILDINGS
  .filter((b) => !BUILDING_INFO[b.name]?.land)
  .map((b) => ({ label: b.name, city: b.city }));

// the commercial building — its common-area labor is the CAM-recoverable pool
const COMMERCIAL = DEMO_PORTFOLIO_BUILDINGS.find((b) => BUILDING_INFO[b.name]?.type === 'Commercial')?.name || 'Halsey Commons';

// real unit numbers per building, so labor lands on units the rent roll knows
const UNITS_BY_BUILDING = DEMO_LEASING.reduce((m, u) => {
  if (u.type === 'land') return m;
  (m[u.building] ||= []).push(String(u.number));
  return m;
}, {});

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
// common-area work on the commercial building (shared space, not a suite)
const COMMON_WORK = [
  ['hvac', 'rooftop RTU service', 6, 45],
  ['cleaning', 'lobby + common deep clean', 8, 28],
  ['landscaping', 'grounds + walkways', 5, 30],
  ['general', 'parking lot + exterior', 5, 32],
  ['electrical', 'common-area lighting', 3, 38],
];

// ---- deterministic randomness (mulberry32 seeded from a string) ----------
function rng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (const ch of seedStr) { h = Math.imul(h ^ ch.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const round25 = (n) => Math.round(n * 4) / 4;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// ---- local-day helpers (never UTC — see lib/dates.js) ---------------------
const pad2 = (n) => String(n).padStart(2, '0');
const localISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const daysAgoISO = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return localISO(d); };
// the demo's labor window: the trailing N weeks, ending today
export function demoRange(weeks = 8) { return { from: daysAgoISO(weeks * 7 - 1), to: daysAgoISO(0) }; }

// iterate calendar days inclusively (pure string/UTC arithmetic — no tz drift)
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
export function buildDemoTimers({ from, to } = demoRange()) {
  const rand = rng(`labor|${from}|${to}`);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const rows = [];
  let dayIdx = 0;
  for (const { iso, dow } of eachDay(from, to)) {
    dayIdx += 1;
    if (dow === 0) continue;                                   // no Sundays
    for (const op of DEMO_OPERATORS) {
      if (dow === 6 && rand() > 0.35) continue;               // light Saturdays
      if (rand() > 0.85) continue;                            // occasional day off
      const hours = round25(5 + rand() * 4);                  // 5–9 hrs, .25 steps
      const cat = pick(CATEGORIES);
      const unalloc = rand() < 0.08;                          // ~8% needs allocation
      const building = unalloc ? null : pick(DEMO_PROPERTIES).label;
      rows.push({
        techName: op.name,
        propLabel: building,
        unit: building ? pick(UNITS_BY_BUILDING[building] || ['—']) : '—',
        date: iso, category: cat, issue: ISSUES[cat] || 'general maintenance',
        durationHrs: hours, rate: op.rate,
        verified: building ? rand() < 0.92 : null,            // punch inside the fence
      });
    }
    // twice a week, one operator works the commercial building's common areas
    if (dow === 2 || dow === 4) {
      const [cat, issue, hrs, rate] = COMMON_WORK[dayIdx % COMMON_WORK.length];
      rows.push({
        techName: DEMO_OPERATORS[dayIdx % DEMO_OPERATORS.length].name,
        propLabel: COMMERCIAL, unit: 'Common', date: iso, category: cat, issue,
        durationHrs: round25(hrs + rand() * 2), rate, verified: true,
      });
    }
  }
  return rows;
}

// the whole demo spine, in the store's own shapes — properties, crew, timers.
// Ids are stable across reloads (slugs), so drill-downs and links keep working.
export function buildDemoSpine(range = demoRange()) {
  const properties = DEMO_PROPERTIES.map((p) => ({ id: 'p_demo_' + slug(p.label), name: p.label, city: p.city, units: 0, external_src: 'demo' }));
  const propId = Object.fromEntries(properties.map((p) => [p.name, p.id]));
  const techs = DEMO_OPERATORS.map((o) => ({ id: 't_demo_' + slug(o.name), name: o.name, rate: o.rate, role: o.role }));
  const techId = Object.fromEntries(techs.map((t) => [t.name, t.id]));
  const timers = buildDemoTimers(range).map((r, i) => ({
    id: `dm_${i + 1}`, techId: techId[r.techName], propId: r.propLabel ? propId[r.propLabel] : null,
    propLabel: r.propLabel || null, unit: r.unit, date: r.date, category: r.category, issue: r.issue,
    durationHrs: r.durationHrs, rate: r.rate, verified: r.verified,
  }));
  return { properties, techs, timers, range };
}

// work orders in the addWorkOrder() shape (propLabel strings, not ids)
export const DEMO_WORK_ORDERS = [
  { task: 'Café entry door won’t latch', detail: 'Temp fix by aligning the strike plate, but the closer is worn — the door won’t hold shut after hours.', propLabel: 'Parkview Lofts', unit: 'C1', category: 'doors', priority: 2, status: 'pending', source: 'field' },
  { task: 'Kitchen faucet leaking under sink', propLabel: 'Parkview Lofts', unit: '1B', category: 'plumbing', assigneeLabel: 'Gianni Arone', priority: 1, status: 'in_progress', source: 'voice', transcript: 'unit 1B leaking faucet for Gianni at Parkview' },
  { task: 'Replace hallway smoke detectors (2)', propLabel: 'Elm Street Apartments', unit: '—', category: 'electrical', assigneeLabel: 'Dawn Whitfield', priority: 2, status: 'open', source: 'manual' },
  { task: 'Furnace not igniting — no heat', propLabel: '210 Water Street', unit: '2', category: 'hvac', assigneeLabel: 'Brent Kowalski', priority: 1, status: 'open', source: 'manual' },
  { task: 'Turnover paint + patch, unit vacant', propLabel: 'Highland Court', unit: 'D', category: 'painting', assigneeLabel: 'Marco Rossi', priority: 3, status: 'open', source: 'manual' },
  { task: 'Dishwasher swap — tenant provided unit', propLabel: 'Elm Street Apartments', unit: '6', category: 'appliance', assigneeLabel: 'Luis Fernandez', priority: 3, status: 'in_progress', source: 'manual', serviceFee: 120, repairCost: 0, tenantBilled: 'billed' },
  { task: 'Lobby door closer adjustment', propLabel: 'Halsey Commons', unit: 'Common', category: 'general', assigneeLabel: 'Tyrone Banks', priority: 4, status: 'done', source: 'manual', serviceFee: 85, repairCost: 40, tenantBilled: 'paid' },
];

// purchases in the addPurchase() shape (status is set to pending by the store;
// a demo tags the first two as approved so materials show in the P&L)
export const DEMO_PURCHASES = [
  { vendor: 'Home Depot', amount: 77.88, propLabel: 'Parkview Lofts', note: 'faucet cartridge + supply lines', submittedBy: 'Gianni Arone', receiptPath: '/mock/receipt-homedepot.png',
    lineItems: [
      { description: 'SharkBite 1/2" coupling', qty: 1, unitPrice: 8.47, amount: 8.47 },
      { description: 'Fluidmaster supply line 20"', qty: 1, unitPrice: 9.98, amount: 9.98 },
      { description: 'Teflon tape 3pk', qty: 1, unitPrice: 3.27, amount: 3.27 },
      { description: 'Moen 1225 cartridge', qty: 1, unitPrice: 24.97, amount: 24.97 },
      { description: 'Water heater element 4500W', qty: 1, unitPrice: 18.44, amount: 18.44 },
      { description: 'Shop towels 2pk', qty: 1, unitPrice: 6.98, amount: 6.98 },
    ] },
  { vendor: 'Sherwin-Williams', amount: 112.07, propLabel: 'Highland Court', note: '2 gal eggshell + roller kit', submittedBy: 'Marco Rossi', receiptPath: '/mock/receipt-sherwin.png',
    lineItems: [
      { description: 'ProMar 200 eggshell 1gal', qty: 2, unitPrice: 38.99, amount: 77.98 },
      { description: 'Premium roller covers 3pk', qty: 1, unitPrice: 12.49, amount: 12.49 },
      { description: 'Blue painter tape 1.88"', qty: 1, unitPrice: 7.64, amount: 7.64 },
      { description: '9" roller frame', qty: 1, unitPrice: 8.99, amount: 8.99 },
      { description: 'Drop cloth 9x12 canvas', qty: 1, unitPrice: 14.98, amount: 14.98 },
    ] },
  { vendor: 'Ferguson', amount: 318.0, propLabel: '210 Water Street', note: 'furnace igniter + flame sensor', submittedBy: 'Brent Kowalski' },
  { vendor: 'Lowe\'s', amount: 449.0, propLabel: 'Elm Street Apartments', note: 'dishwasher', submittedBy: 'Luis Fernandez' },
  { vendor: 'Grainger', amount: 61.2, propLabel: 'Halsey Commons', note: 'smoke detectors 4-pack', submittedBy: 'Dawn Whitfield' },
];

// dated expense history (approved) so the expense forecast has something to
// learn from: recurring buys on a cadence, plus warrantied appliances/HVAC whose
// coverage lapses down the road. Dated relative to today so the cadences and
// warranty windows always read live.
const X = (vendor, amount, propLabel, note, daysAgo, warrantyMonths) => ({
  id: `dx_${daysAgo}_${vendor}`.replace(/\W+/g, '_'), vendor, amount, propLabel, note,
  date: daysAgoISO(daysAgo), createdAt: `${daysAgoISO(daysAgo)}T15:00:00.000Z`, status: 'approved', submittedBy: 'Gianni Arone',
  ...(warrantyMonths ? { warrantyMonths } : {}),
});
export const DEMO_EXPENSE_HISTORY = [
  // recurring HVAC filters (~monthly, Grainger) on the commercial building
  X('Grainger', 46.8, 'Halsey Commons', 'HVAC filters 20x25 case', 158),
  X('Grainger', 48.2, 'Halsey Commons', 'HVAC filters 20x25 case', 128),
  X('Grainger', 46.8, 'Halsey Commons', 'HVAC filters 20x25 case', 98),
  X('Grainger', 49.9, 'Halsey Commons', 'HVAC filters 20x25 case', 66),
  X('Grainger', 47.5, 'Halsey Commons', 'HVAC filters 20x25 case', 38),
  X('Grainger', 48.2, 'Halsey Commons', 'HVAC filters 20x25 case', 8),
  // recurring turnover paint (Sherwin-Williams)
  X('Sherwin-Williams', 112.07, 'Highland Court', '2 gal eggshell + roller kit', 190),
  X('Sherwin-Williams', 98.4, 'Parkview Lofts', 'unit turn paint', 120),
  X('Sherwin-Williams', 120.5, 'Elm Street Apartments', 'unit turn paint + supplies', 62),
  // recurring plumbing consumables (Home Depot)
  X('Home Depot', 77.88, 'Parkview Lofts', 'faucet cartridge + supply lines', 175),
  X('Home Depot', 63.25, 'Elm Street Apartments', 'wax rings + supply lines', 110),
  X('Home Depot', 54.1, '88 Maple Row', 'p-trap + sharkbite fittings', 45),
  // warrantied capital items
  X('Ferguson', 318.0, '210 Water Street', 'furnace igniter + flame sensor', 220, 120),
  X('Lowe’s', 449.0, 'Elm Street Apartments', 'dishwasher — GE 24"', 150, 12),
  X('Ferguson', 519.0, 'Halsey Commons', 'water heater 50gal', 100, 72),
  X('Home Depot', 610.0, 'Highland Court', 'refrigerator — Whirlpool', 75, 12),
  X('Grainger', 61.2, 'Elm Street Apartments', 'smoke detectors 4-pack', 170),
  // an older appliance whose 1-yr coverage lapses soon — the warranty watch
  X('Lowe’s', 429.0, '88 Maple Row', 'dishwasher — Frigidaire 24"', 320, 12),
];
