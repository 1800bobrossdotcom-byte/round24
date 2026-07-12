// ============================================================
// P&L sheet interpreter — reads the per-building monthly P&L tabs (e.g.
// "561 S Main St PL 2026", "301 Central PL 2026") and distills them into the
// fixed per-building inputs Caliper's P&L statement consumes (PL_INPUTS): a
// representative MONTHLY figure per line, averaged over the months that carry
// real data. Rent + labor + materials come from the live spine, so those lines
// are ignored here — this only fills the static overhead (taxes, insurance,
// utilities, debt service, marketing, …) the operational data can't produce.
// ============================================================

import * as XLSX from 'xlsx';

const MONTHS = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t)?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/i;
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const low = (s) => norm(s).toLowerCase();

// a P&L tab, not a pay log / accounting / notes tab
export const looksPLSheet = (name) => /\bpl\b|p&l|p and l|profit|t12|t6/i.test(name) && !/accounting|pay ?log|notes|vendors/i.test(name);

// parse "$1,234.50", "(500)" accounting-negative, "-" blank, numbers
function num(v) {
  if (v == null || v === '' || v === '-') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v);
  if (!/\d/.test(s)) return null;                 // "Escrowed w Mortgage", "-", text → skip
  const neg = /^\s*\(.*\)\s*$/.test(s);
  const f = parseFloat(s.replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(f)) return null;
  return neg ? -Math.abs(f) : f;
}

// label (col 0) → PL_INPUTS key. Rent/gross/opex/NOI/management/repairs/capex are
// intentionally NOT mapped — Caliper derives those from the rent roll + labor + purchases.
const LINE_MAP = [
  ['airbnb', /air ?b|short.?term/i],
  ['otherIncome', /^other income/i],
  ['conversion', /conversion|furnish/i],
  ['marketing', /marketing|advertis/i],
  ['cleaning', /cleaning/i],
  ['internet', /internet/i],
  ['trash', /trash|refuse/i],
  ['electricGas', /electric|^gas|gas$/i],
  ['waterSewer', /water|sewer/i],
  ['legal', /legal|accounting|admin/i],
  ['secDeposit', /security deposit/i],
  ['cam', /^cam\b|common area/i],
  ['insurance', /insurance/i],
  ['taxes', /\btax(es)?\b/i],
  ['debtService', /debt service|1st mortgage|^mortgage/i],
];
const keyForLabel = (label) => {
  const l = low(label);
  for (const [key, re] of LINE_MAP) if (re.test(l)) return key;
  return null;
};

// clean the P&L "Property Name" value to a building label ("561 S Main St - Geneva"
// → "561 S Main St"): drop a trailing " - City" and any "(LLC)" parenthetical.
const buildingFromName = (raw, sheetName) => {
  let n = norm(raw).replace(/\([^)]*\)/g, '').trim();
  n = n.split(/\s+[-–]\s+/)[0].trim();            // strip " - Geneva" / " - ROC"
  if (n) return n;
  return norm(sheetName).replace(/\b(pl|p&l|t12|t6|20\d\d(-?20\d\d)?)\b/ig, '').replace(/\s+/g, ' ').trim();
};

// interpret one worksheet (2D rows) → { building, units, purchasePrice, months, config }
function interpretSheet(rows, sheetName) {
  if (!rows.length) return null;
  // header row = the one whose col0 says "Income"; its cells name the columns
  let hr = -1;
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    if (/^income\b/i.test(low((rows[i] || [])[0]))) { hr = i; break; }
  }
  if (hr === -1) return null;
  const header = rows[hr] || [];
  // value columns = those whose header names a month (skips BUDGET / PACE / annual cols)
  const monthCols = [];
  for (let c = 1; c < header.length; c++) if (MONTHS.test(norm(header[c]))) monthCols.push(c);
  if (!monthCols.length) return null;

  // meta from the top rows
  let building = '', units = null, purchasePrice = null;
  for (let i = 0; i < hr; i++) {
    const r = rows[i] || []; const l = low(r[0]);
    if (/property name/.test(l)) building = buildingFromName(r[1], sheetName);
    else if (/number of units/.test(l)) units = num(r[1]);
    else if (/purchase price/.test(l)) purchasePrice = num(r[1]);
  }
  if (!building) building = buildingFromName('', sheetName);

  // for each mapped line, average the populated month values → representative monthly
  const config = {}; const hits = {};
  for (let i = hr + 1; i < rows.length; i++) {
    const r = rows[i] || []; const key = keyForLabel(r[0]);
    if (!key) continue;
    const vals = monthCols.map((c) => num(r[c])).filter((v) => v != null);
    if (!vals.length) continue;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    // keep the larger-magnitude read if a key matches twice (rare)
    if (hits[key] == null || Math.abs(avg) > Math.abs(hits[key])) { hits[key] = avg; config[key] = Math.round(avg * 100) / 100; }
  }
  return { building, units, purchasePrice, months: monthCols.length, lines: Object.keys(config).length, config };
}

// interpret a workbook buffer → [{ building, units, purchasePrice, months, lines, config }]
export function interpretPLWorkbook(buf) {
  const wb = XLSX.read(buf, { cellDates: true });
  const out = [];
  for (const name of wb.SheetNames) {
    if (!looksPLSheet(name)) continue;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: null });
    const res = interpretSheet(rows, name);
    if (res && res.lines > 0) out.push({ sheet: name, ...res });
  }
  return out;
}
