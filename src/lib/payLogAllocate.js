// ============================================================
// Dollar-grid pay-log allocation.
//
// Some operators (e.g. Gianni) keep a matrix pay log: a daily total-hours column,
// and a per-pay-period grid of building names with the DOLLARS allocated to each
// (name row in cols E–H, dollars on the row beneath). That dollar grid — NOT the
// building name printed next to a given day — is the real allocation: it's what
// the sheet's own "Monthly / Quarterly totals" box sums, and what the office pays.
//
// The old importer attributed each day to the first building NAME in that day's
// grid row (or spread it across all four named buildings, most of which got $0),
// so hours landed on the wrong doors. This reads the dollars instead: per pay
// period, hours(building) = dollars(building) / rate, dated into that pay week.
// The result reproduces the sheet's totals box to the cent.
// ============================================================

const num = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
const isDate = (v) => v instanceof Date && !isNaN(v);
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// a building-name cell: has letters, isn't a pure number, isn't a header/label word.
// Label words are matched as a prefix; MONTH names are anchored to the whole cell
// (optionally a trailing year) so a real building like "May Street" or "March Lane"
// is NOT mistaken for a month header and dropped from the allocation.
const LABEL_RE = /^\s*(total|paid|owed|overpay|deduction|monthly|quarterly)\b/i;
const MONTH_RE = /^\s*(january|february|march|april|may|june|july|august|september|october|november|december)(\s+\d{2,4})?\s*$/i;
export const isName = (v) => typeof v === 'string' && /[a-z]/i.test(v)
  && !/^-?[\d.,$\s]+$/.test(v)
  && !LABEL_RE.test(v) && !MONTH_RE.test(v);

// Does this sheet carry a dollar-allocation grid? (≥1 name row over cols 4–7 with
// a dollar row beneath). Cheap gate so columnar/other pay logs skip this path.
export function hasDollarGrid(rows) {
  const cols = [4, 5, 6, 7];
  for (let i = 0; i < rows.length - 1; i++) {
    const r = rows[i] || [];
    if (cols.filter((c) => isName(r[c])).length >= 2) {
      const dr = rows[i + 1] || [];
      if (cols.some((c) => isName(r[c]) && num(dr[c]) > 0)) return true;
    }
  }
  return false;
}

// Segment the sheet into pay periods (split on "Total Pay Period" rows). For each
// period return { start, weights } — start = first dated day (the pay-week anchor),
// weights = { rawBuildingLabel: dollars } summed from the grid within that period.
function periodsOf(rows) {
  const cols = [4, 5, 6, 7];
  const out = [];
  let cur = { start: null, weights: {} };
  const flush = () => { if (cur.start || Object.keys(cur.weights).length) out.push(cur); cur = { start: null, weights: {} }; };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    if (typeof r[0] === 'string' && /total\s*pay\s*period/i.test(r[0])) { flush(); continue; }
    if (isDate(r[0]) && !cur.start) cur.start = isoOf(r[0]);
    if (cols.filter((c) => isName(r[c])).length >= 2) {
      const dr = rows[i + 1] || [];
      for (const c of cols) {
        if (isName(r[c])) { const d = num(dr[c]); if (d > 0) { const k = r[c].trim(); cur.weights[k] = (cur.weights[k] || 0) + d; } }
      }
    }
  }
  flush();
  return out;
}

// Allocate an operator's dollar-grid pay log → per-(period, building) entries.
//   rows   : sheet as a 2-D array (header:1)
//   match  : (rawLabel) => canonicalBuildingName | null   (rent-roll matcher)
//   rate   : $/hr (from the "HOURLY: NN" header or a parsed entry)
// Returns { hasGrid, entries:[{date, building, dollars, hours}], unmatched:Set }.
// `building` is the canonical name when matched, else the raw label (so nothing is
// silently dropped — an unmatched building still shows, just unlinked).
export function allocatePayLogPeriods(rows, match, rate) {
  if (!hasDollarGrid(rows)) return { hasGrid: false, entries: [], unmatched: new Set() };
  const r = rate > 0 ? rate : 23;
  const entries = []; const unmatched = new Set();
  for (const p of periodsOf(rows)) {
    if (!p.start) continue;                         // future/blank period, no dated day
    for (const [label, dollars] of Object.entries(p.weights)) {
      if (!(dollars > 0)) continue;
      const canon = match ? match(label) : null;
      if (!canon) unmatched.add(label);
      entries.push({
        date: p.start, building: canon || label, dollars,
        hours: Math.round((dollars / r) * 100) / 100,
      });
    }
  }
  return { hasGrid: true, entries, unmatched };
}
