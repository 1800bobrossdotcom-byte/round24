// ============================================================
// P&L statement generator — assembles a per-property monthly P&L in the exact
// shape of Evolution24's sheets (Income → Operating Expenses → NOI → DSCR).
//
// Three lines come straight from Caliper's connected data and can't be forgotten
// or fudged:  Rent (rent roll) · Maintenance Labor (the crew's timers) ·
// Repairs & Supplies (approved receipts).  Management/Payroll is a % of gross.
// The rest (utilities, insurance, taxes, debt service, short-term income) are
// fixed inputs entered once per property. Pure + dependency-free.
// ============================================================

export const MGMT_DEFAULT = 9; // management/payroll as % of gross income

// fixed inputs the office enters once per property (monthly baseline)
export const PL_INPUTS = [
  { key: 'airbnb', label: 'Air BnB / short-term', group: 'income' },
  { key: 'otherIncome', label: 'Other income', group: 'income' },
  { key: 'conversion', label: 'Apartment conversion / furnish', group: 'expense' },
  { key: 'marketing', label: 'Marketing / advertising', group: 'expense' },
  { key: 'cleaning', label: 'Cleaning (short-term)', group: 'expense' },
  { key: 'internet', label: 'Internet', group: 'expense' },
  { key: 'trash', label: 'Trash / refuse', group: 'expense' },
  { key: 'electricGas', label: 'Electric & gas', group: 'expense' },
  { key: 'waterSewer', label: 'Water / sewer', group: 'expense' },
  { key: 'legal', label: 'Legal / accounting / admin', group: 'expense' },
  { key: 'secDeposit', label: 'Security deposit refunds', group: 'expense' },
  { key: 'cam', label: 'CAM', group: 'expense' },
  { key: 'insurance', label: 'Insurance', group: 'expense' },
  { key: 'taxes', label: 'Property / school taxes', group: 'expense' },
  { key: 'debtService', label: 'Debt service', group: 'debt' },
];

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function buildStatement({ rent = 0, laborCost = 0, repairsCost = 0, config = {} } = {}) {
  const c = (k) => n(config[k]);
  const mgmtPct = config.mgmtPct != null ? n(config.mgmtPct) : MGMT_DEFAULT;

  const income = [
    { key: 'rent', label: 'Rent', value: Math.round(rent), auto: true },
    { key: 'airbnb', label: 'Air BnB / short-term', value: c('airbnb'), edit: true },
    { key: 'otherIncome', label: 'Other income', value: c('otherIncome'), edit: true },
  ];
  const gross = income.reduce((a, l) => a + l.value, 0);
  const mgmt = Math.round((gross * mgmtPct) / 100);

  const expenses = [
    { key: 'conversion', label: 'Apartment conversion / furnish', value: c('conversion'), edit: true },
    { key: 'marketing', label: 'Marketing / advertising', value: c('marketing'), edit: true },
    { key: 'cleaning', label: 'Cleaning (short-term)', value: c('cleaning'), edit: true },
    { key: 'maintenanceLabor', label: 'Maintenance labor', value: Math.round(laborCost), auto: true },
    { key: 'internet', label: 'Internet', value: c('internet'), edit: true },
    { key: 'trash', label: 'Trash / refuse', value: c('trash'), edit: true },
    { key: 'electricGas', label: 'Electric & gas', value: c('electricGas'), edit: true },
    { key: 'waterSewer', label: 'Water / sewer', value: c('waterSewer'), edit: true },
    { key: 'legal', label: 'Legal / accounting / admin', value: c('legal'), edit: true },
    { key: 'secDeposit', label: 'Security deposit refunds', value: c('secDeposit'), edit: true },
    { key: 'repairs', label: 'Repairs & supplies', value: Math.round(repairsCost), auto: true },
    { key: 'cam', label: 'CAM', value: c('cam'), edit: true },
    { key: 'mgmt', label: `Management / payroll (${mgmtPct}%)`, value: mgmt, auto: true },
    { key: 'insurance', label: 'Insurance', value: c('insurance'), edit: true },
    { key: 'taxes', label: 'Property / school taxes', value: c('taxes'), edit: true },
  ];
  const opex = expenses.reduce((a, l) => a + l.value, 0);
  const noi = gross - opex;
  const debtService = c('debtService');
  const btcf = noi - debtService;
  const dscr = debtService > 0 ? Math.round((noi / debtService) * 100) / 100 : null;

  return { income, gross, expenses, opex, noi, debtService, btcf, dscr, mgmtPct };
}
