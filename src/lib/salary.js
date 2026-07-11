// ============================================================
// Salaried labor — enter a fixed salary once, and Caliper disperses it across
// the properties the person actually worked, by their logged-hours share. A
// salaried tech's cost still lands on the right doors in the per-door P&L,
// instead of vanishing into overhead.
// ============================================================

// days per pay basis (average month = 365.25/12)
export const SALARY_PERIODS = [
  { id: 'year', label: '/ year', days: 365.25 },
  { id: 'month', label: '/ month', days: 30.44 },
  { id: 'biweekly', label: '/ 2 weeks', days: 14 },
  { id: 'week', label: '/ week', days: 7 },
];

export const perDay = (amount, period) => {
  const p = SALARY_PERIODS.find((x) => x.id === period) || SALARY_PERIODS[0];
  return (amount || 0) / p.days;
};
export const monthlyOf = (amount, period) => perDay(amount, period) * 30.44;
export const annualOf = (amount, period) => perDay(amount, period) * 365.25;

// disperse a salary across buildings by hours share for a span of `spanDays`.
// hoursByBuilding: [{ name, hours }]. Returns { total, byBuilding:[{name,hours,share,cost}] }.
// No hours logged → the cost sits as a single "unallocated" line (honest: we
// don't invent an allocation the timers don't support).
export function disperseSalary({ amount, period }, hoursByBuilding = [], spanDays = 30.44) {
  const total = perDay(amount, period) * spanDays;
  const totalHours = hoursByBuilding.reduce((a, b) => a + (b.hours || 0), 0);
  if (!totalHours) {
    return { total, totalHours: 0, byBuilding: [{ name: 'Unallocated (no hours logged)', hours: 0, share: 1, cost: total }] };
  }
  let assigned = 0;
  const sorted = [...hoursByBuilding].filter((b) => b.hours > 0).sort((a, b) => b.hours - a.hours);
  const byBuilding = sorted.map((b, i) => {
    const share = b.hours / totalHours;
    const cost = i === sorted.length - 1 ? Math.round((total - assigned) * 100) / 100 : Math.round(total * share * 100) / 100;
    assigned += cost;
    return { name: b.name, hours: b.hours, share, cost };
  });
  return { total, totalHours, byBuilding };
}
