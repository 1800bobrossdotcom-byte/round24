// Anonymized sample portfolio for demo / "Load sample data" — no real tenant
// data ships in the bundle. A believable small owner's book: a handful of
// buildings (with details) and a full rent roll across them. Real portfolios
// live only in each tenant's RLS-protected account.
//
// One source of truth (PORTFOLIO) fans out into three shapes:
//   BUILDING_INFO   name → { city, type, yearBuilt, address, note }  (Properties "About")
//   DEMO_LEASING    flat normalized rows (matches backend listLeasing) for demo mode
//   DEMO_PORTFOLIO  { name, city, units:[…] } for importLeaseBuildings() cloud seeding

// unit: [number, beds, type, status, tenant, phone, rent, fees, start, end, renewal, sqft?]
// sqft (12th, optional) is the rentable area — commercial suites set it so CAM
// can allocate pro-rata by floor area; residential units leave it off.
const PORTFOLIO = [
  {
    name: 'Parkview Lofts', city: 'Rochester', type: 'Mixed-use', yearBuilt: 1998,
    address: '184 Park Ave, Rochester, NY 14607',
    note: 'Four residential lofts over a ground-floor café. Owner-managed since 2019.',
    units: [
      ['1A', 1, 'residential', 'leased', 'Jordan Ellis', '(585) 555-0142', 1295, { insurance: 55 }, '2025-08-01', '2026-07-31', null],
      ['1B', 2, 'residential', 'leased', 'Priya Nadeem', '(585) 555-0188', 1650, { pet: 50, insurance: 55 }, '2025-09-01', '2026-08-31', 'pending'],
      ['2A', 2, 'residential', 'vacant', '', '', 1695, { water: 35 }, null, null, null],
      ['2B', 1, 'residential', 'leased', 'Marcus Cole', '(585) 555-0119', 1350, {}, '2026-01-06', '2027-01-05', null],
      ['C1', null, 'commercial', 'leased', 'Riverbend Coffee LLC', '(585) 555-0200', 2400, { cam: 180 }, '2024-05-01', '2029-04-30', null],
    ],
  },
  {
    name: 'Elm Street Apartments', city: 'Rochester', type: 'Residential', yearBuilt: 1974,
    address: '52 Elm St, Rochester, NY 14604',
    note: 'Brick 4-unit walk-up. Fully separately metered; tenants pay electric.',
    units: [
      ['3', 1, 'residential', 'leased', 'Dana Whitfield', '(585) 555-0161', 1180, { insurance: 55, water: 35 }, '2025-10-01', '2026-09-30', 'renewed'],
      ['4', 0, 'residential', 'leased', 'Sam Okafor', '(585) 555-0174', 995, {}, '2025-06-15', '2026-08-15', 'pending'],
      ['5', 2, 'residential', 'turning', '', '', 1420, { water: 35 }, null, null, null],
      ['6', 2, 'residential', 'leased', 'Lena Hart', '(585) 555-0133', 1475, { pet: 50 }, '2024-11-01', '2026-10-31', null],
    ],
  },
  {
    name: 'Highland Court', city: 'Rochester', type: 'Residential', yearBuilt: 2006,
    address: '9 Highland Ct, Rochester, NY 14620',
    note: 'Newer 4-plex near the park. Low turnover, in-unit laundry.',
    units: [
      ['A', 2, 'residential', 'leased', 'Toby Rees', '(585) 555-0155', 1550, { insurance: 55 }, '2025-05-01', '2026-04-30', 'renewed'],
      ['B', 2, 'residential', 'leased', 'Grace Lim', '(585) 555-0177', 1575, {}, '2025-07-01', '2026-06-30', null],
      ['C', 3, 'residential', 'leased', 'The Alvarados', '(585) 555-0102', 1950, { pet: 50 }, '2025-09-15', '2026-09-14', null],
      ['D', 1, 'residential', 'vacant', '', '', 1295, {}, null, null, null],
    ],
  },
  {
    name: '210 Water Street', city: 'Geneva', type: 'Residential', yearBuilt: 1989,
    address: '210 Water St, Geneva, NY 14456',
    note: 'Lakeside triplex. Seasonal demand — strong summer renewals.',
    units: [
      ['1', 1, 'residential', 'leased', 'Nia Brooks', '(315) 555-0148', 1150, { water: 35 }, '2025-08-01', '2026-07-31', 'pending'],
      ['2', 2, 'residential', 'leased', 'Owen Pratt', '(315) 555-0193', 1395, {}, '2026-03-01', '2027-02-28', null],
      ['3', 2, 'residential', 'vacant', '', '', 1450, { water: 35 }, null, null, null],
    ],
  },
  {
    name: '88 Maple Row', city: 'Canandaigua', type: 'Duplex', yearBuilt: 1962,
    address: '88 Maple Row, Canandaigua, NY 14424',
    note: 'Side-by-side duplex on a double lot. Long-term tenants.',
    units: [
      ['Left', 3, 'residential', 'leased', 'The Okonkwos', '(585) 555-0166', 1725, { pet: 50 }, '2024-09-01', '2026-08-31', 'pending'],
      ['Right', 2, 'residential', 'leased', 'Ivy Sandoval', '(585) 555-0121', 1490, {}, '2025-11-01', '2026-10-31', null],
    ],
  },
  {
    name: '12 Lakeview Drive', city: 'Canandaigua', type: 'Single-family', yearBuilt: 2011,
    address: '12 Lakeview Dr, Canandaigua, NY 14424',
    note: 'Single-family rental home, 3bd/2ba with an attached garage.',
    units: [
      ['House', 3, 'residential', 'leased', 'The Bennetts', '(585) 555-0138', 2650, { insurance: 65 }, '2025-06-01', '2026-05-31', 'renewed'],
    ],
  },
  {
    // a small mixed-commercial building — the Caliper Enterprise / CAM demo.
    // Commercial suites carry rentable SF (12th tuple slot) + a monthly CAM fee;
    // the reconciliation allocates the building's MEASURED operating cost
    // (see DEMO_PORTFOLIO_LABOR below) pro-rata by SF against what each was billed.
    name: 'Halsey Commons', city: 'Rochester', type: 'Commercial', yearBuilt: 1991,
    address: '48 Halsey St, Rochester, NY 14607',
    note: 'Two-story mixed-commercial building — ground-floor retail over professional office suites. Tenants on triple-net leases with CAM.',
    units: [
      // number, beds, type, status, tenant, phone, rent, fees, start, end, renewal, sqft
      ['101', null, 'commercial', 'leased', 'Basin & Co Coffee', '(585) 555-0311', 3900, { cam: 220 }, '2023-04-01', '2028-03-31', null, 3200],
      ['102', null, 'commercial', 'leased', 'Northline Design Co', '(585) 555-0327', 3100, { cam: 195 }, '2024-01-01', '2027-12-31', 'renewed', 2400],
      ['201', null, 'commercial', 'leased', 'Verdant Health PT', '(585) 555-0344', 2450, { cam: 110 }, '2025-02-01', '2028-01-31', null, 1800],
      ['202', null, 'commercial', 'leased', 'Copperfield Legal', '(585) 555-0358', 1750, { cam: 95 }, '2024-07-01', '2027-06-30', 'pending', 1200],
      ['203', null, 'commercial', 'vacant', '', '', 1900, { cam: 105 }, null, null, null, 1400],
    ],
  },
  {
    name: 'Ridge Road Parcel', city: 'Canandaigua', type: 'Undeveloped land', yearBuilt: null,
    size: 6.2, zoning: 'R-1-20 residential',
    address: 'Ridge Rd (parcel 084.-1-12.100), Canandaigua, NY 14424',
    note: 'Undeveloped ~6.2-acre parcel held for future development. Road frontage on Ridge Rd; no utilities run to the site yet. Annual taxes ~$1,240.',
    units: [
      ['Parcel', null, 'land', 'held', '', '', 0, {}, null, null, null],
    ],
  },
];

const feesTotal = (rent, fees) => rent + Object.values(fees).reduce((a, b) => a + (b || 0), 0);

// name → building details, for the Properties "About this building" card
export const BUILDING_INFO = Object.fromEntries(
  PORTFOLIO.map((b) => [b.name, {
    city: b.city, type: b.type, yearBuilt: b.yearBuilt, address: b.address, note: b.note,
    units: b.units.length, size: b.size || null, zoning: b.zoning || null,
    land: b.units.every((u) => u[2] === 'land'),
  }]),
);

// flat normalized rows (demo mode) — same shape as backend listLeasing()
export const DEMO_LEASING = PORTFOLIO.flatMap((b, bi) =>
  b.units.map(([number, beds, type, status, tenant, phone, rent, fees, start, end, renewal, sqft], ui) => ({
    id: `d${bi}_${ui}`, leaseId: `dl_${bi}_${ui}`, building: b.name, number, beds,
    type, furnished: false, sort: ui, acres: type === 'land' ? (b.size || null) : null,
    sqft: sqft ?? null,
    status, tenant: status === 'leased' ? tenant : '', phone: status === 'leased' ? phone : '',
    rent, fees, total: feesTotal(rent, fees),
    deposit: status === 'leased' ? rent : 0,
    leaseStart: start, leaseEnd: end, renewalStatus: renewal, notes: '',
  })),
);

// importLeaseBuildings() shape — persists to units + leases in a real workspace
export const DEMO_PORTFOLIO = PORTFOLIO.map((b) => ({
  name: b.name, city: b.city,
  units: b.units.map(([number, beds, type, status, tenant, phone, rent, fees, start, end, renewal, sqft]) => ({
    number, beds, type, furnished: false, status, sqft: sqft ?? null,
    tenant: status === 'leased' ? tenant : '', phone: status === 'leased' ? phone : '',
    rent, fees, total: feesTotal(rent, fees),
    deposit: status === 'leased' ? rent : 0,
    leaseStart: start, leaseEnd: end, renewalStatus: renewal,
    note: type === 'land' && b.size ? `Undeveloped ~${b.size} acres · ${b.zoning || ''}`.trim() : undefined,
  })),
}));

// building names in the sample portfolio — used to route sample maintenance /
// expenses onto real buildings for the owner persona.
export const DEMO_PORTFOLIO_BUILDINGS = PORTFOLIO.map((b) => ({ name: b.name, city: b.city }));

// geofence pins for the sample buildings (real-ish NY coords) so verified
// clock-in demonstrates out of the box. name → { lat, lng, geofence }
export const BUILDING_GEO = {
  'Parkview Lofts': { lat: 43.1570, lng: -77.6080, geofence: 150 },
  'Elm Street Apartments': { lat: 43.1612, lng: -77.6155, geofence: 150 },
  'Highland Court': { lat: 43.1340, lng: -77.6010, geofence: 150 },
  '210 Water Street': { lat: 42.8690, lng: -76.9780, geofence: 150 },
  '88 Maple Row': { lat: 42.8872, lng: -77.2820, geofence: 150 },
  '12 Lakeview Drive': { lat: 42.8820, lng: -77.2900, geofence: 150 },
  'Halsey Commons': { lat: 43.1548, lng: -77.5990, geofence: 150 },
};

// a little verified crew labor logged against the portfolio, so the per-door
// P&L and the "% verified on-site" stat populate in demo. Same shape as the
// labor spine; verified=true means the punch landed inside the building fence.
const L = (propLabel, unit, category, hrs, rate, verified, day) => ({
  id: `dl_${propLabel}_${unit}_${day}`.replace(/\W+/g, '_'),
  techId: 't_demo_crew', techName: 'Marco Rossi', propId: null, propLabel, unit,
  date: `2026-07-${String(day).padStart(2, '0')}`, category, issue: `${category} work`,
  durationHrs: hrs, rate, verified,
});
// per-building fixed P&L inputs (debt service, utilities, insurance, taxes) so
// the statement generator produces a complete NOI/DSCR out of the box. Rent,
// labor, and repairs fill in automatically from the connected data.
export const DEMO_PL_CONFIG = {
  'Parkview Lofts': { debtService: 2450, insurance: 305, taxes: 760, internet: 60, trash: 95, electricGas: 640, waterSewer: 180, legal: 40, mgmtPct: 9 },
  'Elm Street Apartments': { debtService: 1680, insurance: 210, taxes: 520, internet: 57, trash: 70, electricGas: 380, waterSewer: 120, mgmtPct: 9 },
  'Highland Court': { debtService: 1720, insurance: 240, taxes: 560, trash: 80, electricGas: 410, waterSewer: 130, mgmtPct: 9 },
};

export const DEMO_PORTFOLIO_LABOR = [
  L('Parkview Lofts', '2A', 'painting', 6.5, 32, true, 2),
  L('Parkview Lofts', '2A', 'general', 3.0, 32, true, 3),
  L('Elm Street Apartments', '5', 'turn', 5.5, 32, true, 4),
  L('Highland Court', 'D', 'plumbing', 2.5, 38, true, 5),
  L('210 Water Street', '3', 'hvac', 4.0, 45, true, 6),
  L('88 Maple Row', 'Left', 'general', 1.5, 32, false, 7), // one off-site punch
  // Halsey Commons — common-area maintenance (the CAM-recoverable pool). Logged
  // to the building, not a suite, because it's shared area — exactly what CAM
  // recovers. This measured labor is what the reconciliation allocates pro-rata.
  L('Halsey Commons', 'Common', 'hvac', 60, 45, true, 9),        // rooftop RTU overhaul
  L('Halsey Commons', 'Common', 'cleaning', 80, 28, true, 12),   // lobby + common deep clean
  L('Halsey Commons', 'Common', 'landscaping', 50, 30, true, 15),// grounds / season
  L('Halsey Commons', 'Common', 'general', 48, 32, true, 18),    // parking lot + exterior
  L('Halsey Commons', 'Common', 'electrical', 22, 38, true, 21), // common-area lighting
];
