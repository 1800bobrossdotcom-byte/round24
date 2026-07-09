// Anonymized sample portfolio for demo / "Load sample data" — no real tenant
// data ships in the bundle. A believable small owner's book: a handful of
// buildings (with details) and a full rent roll across them. Real portfolios
// live only in each tenant's RLS-protected account.
//
// One source of truth (PORTFOLIO) fans out into three shapes:
//   BUILDING_INFO   name → { city, type, yearBuilt, address, note }  (Properties "About")
//   DEMO_LEASING    flat normalized rows (matches backend listLeasing) for demo mode
//   DEMO_PORTFOLIO  { name, city, units:[…] } for importLeaseBuildings() cloud seeding

// unit: [number, beds, type, status, tenant, phone, rent, fees, start, end, renewal]
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
];

const feesTotal = (rent, fees) => rent + Object.values(fees).reduce((a, b) => a + (b || 0), 0);

// name → building details, for the Properties "About this building" card
export const BUILDING_INFO = Object.fromEntries(
  PORTFOLIO.map((b) => [b.name, {
    city: b.city, type: b.type, yearBuilt: b.yearBuilt, address: b.address, note: b.note, units: b.units.length,
  }]),
);

// flat normalized rows (demo mode) — same shape as backend listLeasing()
export const DEMO_LEASING = PORTFOLIO.flatMap((b, bi) =>
  b.units.map(([number, beds, type, status, tenant, phone, rent, fees, start, end, renewal], ui) => ({
    id: `d${bi}_${ui}`, leaseId: `dl_${bi}_${ui}`, building: b.name, number, beds,
    type, furnished: false, sort: ui,
    status, tenant: status === 'leased' ? tenant : '', phone: status === 'leased' ? phone : '',
    rent, fees, total: feesTotal(rent, fees),
    deposit: status === 'leased' ? rent : 0,
    leaseStart: start, leaseEnd: end, renewalStatus: renewal, notes: '',
  })),
);

// importLeaseBuildings() shape — persists to units + leases in a real workspace
export const DEMO_PORTFOLIO = PORTFOLIO.map((b) => ({
  name: b.name, city: b.city,
  units: b.units.map(([number, beds, type, status, tenant, phone, rent, fees, start, end, renewal]) => ({
    number, beds, type, furnished: false, status,
    tenant: status === 'leased' ? tenant : '', phone: status === 'leased' ? phone : '',
    rent, fees, total: feesTotal(rent, fees),
    deposit: status === 'leased' ? rent : 0,
    leaseStart: start, leaseEnd: end, renewalStatus: renewal,
  })),
}));

// building names in the sample portfolio — used to route sample maintenance /
// expenses onto real buildings for the owner persona.
export const DEMO_PORTFOLIO_BUILDINGS = PORTFOLIO.map((b) => ({ name: b.name, city: b.city }));
