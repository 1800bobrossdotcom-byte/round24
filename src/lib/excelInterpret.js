// ============================================================
// Caliper Excel interpreter — a layout-detecting reader for time/pay logs.
//
// Real shops keep hours in wildly different spreadsheet shapes. Instead of one
// hard-coded format, this classifies each sheet and extracts a normalized set
// of entries { date, hours, pay, rate, buildings[], weights[], note, … } that
// the importer maps straight to timers. Strategies, best-coverage wins:
//
//   columnar  — a header row (Date | Hours | Property | Notes | …), any order
//   wide      — one column per property, hours (or $) under each, one row/day
//   matrix    — Evolution24-style recurring name rows above $ rows (delegated)
//
// Everything is client-side; the workbook never leaves the browser.
// ============================================================

import * as XLSX from 'xlsx';
import { parseSheet as parseMatrix, looksLikeBuilding } from './importParser.js';

// ---- header vocabulary: field → what its column header might be called ----
const HDR = {
  date: /^(date|day|work\s*date|shift\s*date|worked|service\s*date)$/i,
  hours: /^(hours?|hrs?\.?|time|qty|quantity|duration|total\s*h(ou)?rs?|labor\s*h(ou)?rs?|reg\s*h(ou)?rs?)$/i,
  pay: /^(pay|amount|payment|earnings?|wages?|total\s*pay|gross|\$\s*(paid)?)$/i,
  rate: /^(rate|hourly|hourly\s*rate|pay\s*rate|\$\s*\/\s*hr|per\s*hour)$/i,
  property: /^(propert(y|ies)|building|bldg\.?|location|site|address|project|job\s*site|job#?|complex|premises|community)$/i,
  unit: /^(unit|apt\.?|apartment|room|suite|space)$/i,
  note: /^(notes?|description|comments?|memo|details?|task|work\s*(performed|done)|scope|activity)$/i,
  category: /^(category|type|trade|work\s*type|service|classification|craft)$/i,
  employee: /^(employee|tech(nician)?|name|worker|crew|staff|person|labor(er)?)$/i,
};

const RATE_MIN = 8, RATE_MAX = 80;
const sane = (r) => (r != null && r >= RATE_MIN && r <= RATE_MAX ? r : null);
const round2 = (n) => Math.round(n * 100) / 100;
const numOf = (v) => {
  if (typeof v === 'number') return Number.isNaN(v) ? null : v;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const neg = /^\(.*\)$/.test(s);              // accounting negative, e.g. "(500)"
  if (!neg && !/^-?\$?\d/.test(s)) return null;
  const f = parseFloat(s.replace(/[$,()]/g, ''));
  if (!Number.isFinite(f)) return null;
  return neg ? -Math.abs(f) : f;
};
const strOf = (v) => (typeof v === 'string' ? v.trim() : v != null && typeof v !== 'object' ? String(v) : null);
const isoOf = (d) => d.toISOString().slice(0, 10);

// tolerant date reader: Excel serial, ISO, M/D/Y(Y), or anything Date can chew
export function toISO(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return isoOf(v);
  if (typeof v === 'number' && v > 20000 && v < 80000) return isoOf(new Date(Date.UTC(1899, 11, 30) + v * 86400000));
  if (typeof v === 'string') {
    const s = v.trim();
    const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // accept non-padded (2024-3-5) and validate
    if (iso) {
      const yr = +iso[1], mo = +iso[2], da = +iso[3];
      const d = new Date(Date.UTC(yr, mo - 1, da));
      // reject placeholders/impossible dates (0000-00-00, 2024-13-45) the old slice let through
      return yr > 1900 && d.getUTCMonth() === mo - 1 && d.getUTCDate() === da ? isoOf(d) : null;
    }
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      const mo = +m[1], da = +m[2], yr = +m[3] < 100 ? +m[3] + 2000 : +m[3];
      const d = new Date(Date.UTC(yr, mo - 1, da));
      // reject impossible dates (e.g. 25/12/2024 D-M-Y, or 2/30) instead of emitting a bogus ISO
      if (d.getUTCMonth() === mo - 1 && d.getUTCDate() === da) return isoOf(d);
      return null;
    }
    if (/[A-Za-z]{3}/.test(s) && /\d{4}/.test(s)) { const d = new Date(s + ' UTC'); if (!isNaN(d.getTime())) return isoOf(d); }
  }
  return null;
}

// tolerant hours reader: number, "8h", "8:30", or an OFF/PTO/SICK marker (→ 0)
export function parseHours(v) {
  if (typeof v === 'number') return v >= 0 && v <= 100 ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.trim().toLowerCase();
  if (!t) return null;
  if (/^(off|sick|pto|vac(ation)?|holiday|n\/?a|absent|—|-)$/.test(t)) return 0;
  const hm = t.match(/^(\d{1,2}):(\d{2})$/);
  if (hm) return round2(+hm[1] + (+hm[2]) / 60);
  const m = t.match(/(\d+(\.\d+)?)/);
  if (m) { const n = parseFloat(m[1]); if (n >= 0 && n <= 100) return n; }
  return null;
}

const techNameFromSheet = (name) => name
  .replace(/pay ?log|time ?sheet|timecard|hours/ig, '')
  .replace(/\d{4}\s*-\s*\d{2,4}|\b\d{4}\b/g, '')
  .replace(/\s+/g, ' ').trim() || name;

const PERIOD_RE = /\d+\/\d+\s*-\s*\d+\/\d+/;

// find the header row + the meaning of each column. Also flags building-name
// columns (wide format) and whether those names RECUR further down (which means
// it's a matrix log, not a wide one).
function findHeader(rows) {
  let best = null;
  const scan = Math.min(rows.length, 20);
  for (let r = 0; r < scan; r++) {
    const row = rows[r] || [];
    const map = {}; let hits = 0; const nameCols = [];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (looksLikeBuilding(cell)) nameCols.push(c);
      if (typeof cell !== 'string') continue;
      const t = cell.trim(); if (!t) continue;
      for (const [field, re] of Object.entries(HDR)) {
        if (re.test(t)) { if (map[field] == null) { map[field] = c; hits++; } break; }
      }
    }
    const score = hits + (nameCols.length >= 2 ? nameCols.length : 0);
    const usable = map.date != null || (map.hours != null && hits >= 2) || nameCols.length >= 2;
    if (usable && (!best || score > best.score)) best = { r, map, nameCols, score };
  }
  if (best && best.nameCols.length >= 2) {
    // do those building names recur below the header? if so it's a matrix log.
    let recur = 0;
    for (let r = best.r + 1; r < rows.length; r++) {
      if (best.nameCols.some((c) => looksLikeBuilding((rows[r] || [])[c]))) recur++;
    }
    best.recurringNames = recur > 2;
  }
  return best;
}

function parseColumnar(rows, H, techName) {
  const M = H.map; const entries = []; let period = null;
  for (let r = H.r + 1; r < rows.length; r++) {
    const row = rows[r] || []; const first = row[0];
    if (typeof first === 'string' && PERIOD_RE.test(first)) { period = first.trim(); continue; }
    if (typeof first === 'string' && /^total/i.test(first)) continue;
    const iso = toISO(row[M.date]); if (!iso) continue;
    const hours = parseHours(M.hours != null ? row[M.hours] : null);
    if (hours == null) continue;
    const pay = M.pay != null ? numOf(row[M.pay]) : null;
    // sane() rejects an implausible rate cell (e.g. a mis-keyed annual salary) so it can't
    // inflate pay; a rate derived from real pay/hours below is trusted as-is
    let rate = M.rate != null ? sane(numOf(row[M.rate])) : null;
    if (rate == null && pay && hours > 0) rate = round2(pay / hours);
    const prop = M.property != null ? strOf(row[M.property]) : null;
    const cleanProp = prop && !/^total/i.test(prop) ? prop : null;
    entries.push({
      tech: (M.employee != null ? strOf(row[M.employee]) : null) || techName,
      date: iso, hours,
      pay: pay ?? (rate ? round2(hours * rate) : null),
      rate: rate || null,
      period, note: M.note != null ? strOf(row[M.note]) : null,
      category: M.category != null ? (strOf(row[M.category]) || '').toLowerCase() || null : null,
      unit: M.unit != null ? strOf(row[M.unit]) : null,
      building: cleanProp, buildings: cleanProp ? [cleanProp] : [], weights: null,
      flag: rate ? null : 'no-rate',
    });
  }
  return entries;
}

function parseWide(rows, H, techName) {
  const M = H.map;
  const names = H.nameCols.map((c) => ({ col: c, name: (strOf((rows[H.r] || [])[c]) || '').trim() }));
  const dateCol = M.date != null ? M.date : 0;
  const hoursCol = M.hours;
  const entries = []; let period = null;
  for (let r = H.r + 1; r < rows.length; r++) {
    const row = rows[r] || []; const first = row[0];
    if (typeof first === 'string' && PERIOD_RE.test(first)) { period = first.trim(); continue; }
    const iso = toISO(row[dateCol]); if (!iso) continue;
    const vals = names.map((n) => numOf(row[n.col]) || 0);
    if (hoursCol != null && names.every((n) => n.col !== hoursCol)) {
      // a total-hours column + per-building $ weights → one weighted entry
      const hours = parseHours(row[hoursCol]); if (hours == null || hours <= 0) continue;
      const active = names.filter((_, i) => vals[i] > 0);
      if (!active.length) { entries.push({ tech: techName, date: iso, hours, pay: null, rate: null, period, note: null, category: null, unit: null, building: null, buildings: [], weights: null, flag: 'no-rate' }); continue; }
      const w = active.map((n) => vals[names.indexOf(n)]);
      entries.push({ tech: techName, date: iso, hours, pay: null, rate: null, period, note: null, category: null, unit: null, building: active[0].name, buildings: active.map((n) => n.name), weights: w.some((x) => x > 0) ? w : null, flag: 'no-rate' });
    } else {
      // each building column carries that building's hours for the day
      names.forEach((n, i) => {
        const h = vals[i];
        if (h > 0) entries.push({ tech: techName, date: iso, hours: h, pay: null, rate: null, period, note: null, category: null, unit: null, building: n.name, buildings: [n.name], weights: null, flag: 'no-rate' });
      });
    }
  }
  return entries;
}

// interpret ONE worksheet: pick the strategy with the best coverage. The proven
// matrix parser is the floor — a new strategy only wins when it reads MORE rows.
export function interpretSheet(ws, name) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false });
  const techName = techNameFromSheet(name);
  const matrix = parseMatrix(ws, name).entries;
  const H = findHeader(rows);

  let general = [], layout = 'matrix';
  if (H && !H.recurringNames) {
    if (H.nameCols.length >= 2) { general = parseWide(rows, H, techName); layout = 'wide'; }
    else if (H.map.date != null && H.map.hours != null) { general = parseColumnar(rows, H, techName); layout = 'columnar'; }
  }

  // prefer the richer general parse when it covers at least as much ground
  const useGeneral = general.length > 0 && general.length >= matrix.length;
  const entries = useGeneral ? general : matrix;
  if (!useGeneral) layout = matrix.length ? 'matrix' : 'none';

  return {
    name, techName, layout, entries,
    entryCount: entries.length,
    totalHours: entries.reduce((a, e) => a + (e.hours || 0), 0),
    totalPay: entries.reduce((a, e) => a + (e.pay || 0), 0),
    // a real pay log either says so in its name, or reads as a person-and-hours
    // layout (columnar/wide). A recurring $ matrix must match by name so income /
    // expense / P&L tabs full of numbers don't masquerade as timesheets.
    looksPayLog: /pay ?log|time ?sheet|timecard|time ?log|hours|ramos/i.test(name) || layout === 'columnar' || layout === 'wide',
  };
}

export function interpretWorkbook(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { cellDates: true });
  return wb.SheetNames.map((name) => interpretSheet(wb.Sheets[name], name));
}
