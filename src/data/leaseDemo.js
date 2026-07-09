// Anonymized sample rent roll for demo mode — no real tenant data ships in the
// bundle. Same normalized shape as backend listLeasing(). Real portfolios live
// only in each tenant's RLS-protected account.
const U = (id, building, number, beds, type, status, tenant, phone, rent, fees, deposit, start, end, renewal) => ({
  id, leaseId: 'dl_' + id, building, number, beds, type, furnished: false, sort: 0,
  status, tenant: status === 'vacant' ? '' : tenant, phone: status === 'vacant' ? '' : phone,
  rent, fees, total: rent + Object.values(fees).reduce((a, b) => a + (b || 0), 0),
  deposit, leaseStart: start, leaseEnd: end, renewalStatus: renewal, notes: '',
});

export const DEMO_LEASING = [
  U('d1', 'Parkview Lofts', '1A', 1, 'residential', 'leased', 'Jordan Ellis', '(585) 555-0142', 1295, { insurance: 55 }, 1295, '2025-08-01', '2026-07-31', null),
  U('d2', 'Parkview Lofts', '1B', 2, 'residential', 'leased', 'Priya Nadeem', '(585) 555-0188', 1650, { pet: 50, insurance: 55 }, 1650, '2025-09-01', '2026-08-31', null),
  U('d3', 'Parkview Lofts', '2A', 2, 'residential', 'vacant', '', '', 1695, { water: 35 }, 0, null, null, null),
  U('d4', 'Parkview Lofts', '2B', 1, 'residential', 'leased', 'Marcus Cole', '(585) 555-0119', 1350, {}, 1350, '2026-01-06', '2027-01-05', null),
  U('d5', 'Parkview Lofts', 'C1', null, 'commercial', 'leased', 'Riverbend Coffee LLC', '(585) 555-0200', 2400, { cam: 180 }, 4800, '2024-05-01', '2029-04-30', null),
  U('d6', 'Elm Street Apartments', '3', 1, 'residential', 'leased', 'Dana Whitfield', '(585) 555-0161', 1180, { insurance: 55, water: 35 }, 1180, '2025-10-01', '2026-09-30', 'renewed'),
  U('d7', 'Elm Street Apartments', '4', 0, 'residential', 'leased', 'Sam Okafor', '(585) 555-0174', 995, {}, 995, '2025-06-15', '2026-08-15', null),
  U('d8', 'Elm Street Apartments', '5', 2, 'residential', 'turning', '', '', 1420, { water: 35 }, 0, null, null, null),
  U('d9', 'Elm Street Apartments', '6', 2, 'residential', 'leased', 'Lena Hart', '(585) 555-0133', 1475, { pet: 50 }, 1475, '2024-11-01', '2026-10-31', null),
  U('d10', 'Elm Street Apartments', '7', 1, 'residential', 'leased', 'Toby Rees', '(585) 555-0155', 1210, { insurance: 55 }, 1210, '2026-02-01', '2027-01-31', null),
];
