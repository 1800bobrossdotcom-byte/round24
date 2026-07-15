// Sample Certificates of Insurance for demo mode — vendor certs (Pro's
// contractors) and tenant certs (Enterprise's Halsey Commons commercial
// tenants). Dates are spread around the demo "today" (2026-07-15) so every
// status shows: active, expiring soon, expired, and a no-date gap.
const C = (id, holderType, holderName, o = {}) => ({
  id, holderType, holderName,
  building: o.building || null, unit: o.unit || null,
  carrier: o.carrier || null, policyNumber: o.policyNumber || null,
  coverage: o.coverage || {}, effective: o.effective || null, expires: o.expires || null,
  additionalInsured: o.additionalInsured ?? false, notes: o.notes || null,
});

const GL = (v) => ({ general_liability: v });

export const DEMO_COIS = [
  // ---- vendor / contractor certs ----
  C('coi1', 'vendor', 'Rapids Plumbing Co.', { carrier: 'The Hartford', policyNumber: 'GL-4471902', coverage: { general_liability: 2000000, workers_comp: 1000000 }, effective: '2026-03-01', expires: '2027-03-01', additionalInsured: true }),
  C('coi2', 'vendor', 'Voltage Bros Electric', { carrier: 'Travelers', policyNumber: 'TR-88120-GL', coverage: { general_liability: 1000000, workers_comp: 500000 }, effective: '2025-08-05', expires: '2026-08-05', additionalInsured: true, notes: 'Renewal requested — awaiting updated cert.' }),
  C('coi3', 'vendor', 'TrueClimate Heating & Air', { carrier: 'Nationwide', policyNumber: 'NW-33410', coverage: { general_liability: 2000000, auto: 1000000, workers_comp: 1000000 }, effective: '2025-12-15', expires: '2026-12-15', additionalInsured: true }),
  C('coi4', 'vendor', 'GreenScape Lawn & Snow', { carrier: 'Erie Insurance', policyNumber: 'ER-90218', coverage: { general_liability: 1000000 }, effective: '2025-05-30', expires: '2026-05-30', additionalInsured: false, notes: 'Lapsed — do not dispatch until renewed.' }),
  C('coi5', 'vendor', 'Handy Hands General Contracting', { carrier: 'The Hartford', policyNumber: 'HF-71220', coverage: { general_liability: 2000000, workers_comp: 1000000 }, effective: '2026-01-20', expires: '2027-01-20', additionalInsured: true }),

  // ---- tenant certs (Halsey Commons — commercial leases require CGL + AI) ----
  C('coi6', 'tenant', 'Basin & Co Coffee', { building: 'Halsey Commons', unit: '101', carrier: 'Cincinnati Insurance', policyNumber: 'CI-2201', coverage: GL(2000000), effective: '2026-04-01', expires: '2027-04-30', additionalInsured: true }),
  C('coi7', 'tenant', 'Northline Design Co', { building: 'Halsey Commons', unit: '102', carrier: 'Chubb', policyNumber: 'CH-5540', coverage: GL(1000000), effective: '2025-08-01', expires: '2026-07-31', additionalInsured: true, notes: 'Expires end of month — request renewal.' }),
  C('coi8', 'tenant', 'Verdant Health PT', { building: 'Halsey Commons', unit: '201', carrier: 'The Doctors Company', policyNumber: 'DC-1187', coverage: { general_liability: 1000000, professional: 1000000 }, effective: '2026-02-28', expires: '2027-02-28', additionalInsured: true }),
  C('coi9', 'tenant', 'Copperfield Legal', { building: 'Halsey Commons', unit: '202', carrier: null, policyNumber: null, coverage: {}, effective: null, expires: null, additionalInsured: false, notes: 'No certificate on file — follow up before renewal.' }),
];
