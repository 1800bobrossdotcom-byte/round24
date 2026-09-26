// ============================================================
// Round24 Excel interpreter — a layout-detecting reader for time/pay logs.
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
import { allocatePayLogPeriods } from './payLogAllocate.js';
import { localISO } from './dates.js';

// ---- header vocabulary: field → what its column header might be called ----
const HDR = {
  date: /^(date|day|work\s*date|shift\s*date|worked|service\s*date)$/i,
  hours: /^(hours?|hrs?\.?|time|qty|quantity|duration|total\s*h(ou)?rs?|labor\s*h(ou)?rs?|reg(ular)?\.?\s*(h(ou)?rs?|time)?|st\s*h(ou)?rs?)$/i,
  ot: /^(ot|o\/t|overtime|ot\s*h(ou)?rs?|overtime\s*h(ou)?rs?)$/i,
  start: /^(in|time\s*in|clock\s*in|start|start\s*time|begin|punch\s*in)$/i,
  end: /^(out|time\s*out|clock\s*out|end|end\s*time|finish|stop|punch\s*out)$/i,
  brk: /^(break|lunch|unpaid|meal|break\s*\(?\s*h(ou)?rs?\s*\)?|unpaid\s*break|lunch\s*\(?\s*h(ou)?rs?\s*\)?)$/i,
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

// tolerant date reader: Excel serial, ISO, M/D/Y(Y), or anything Date can chew.
// A Date object comes from SheetJS at LOCAL midnight, so it's read with local
// getters — toISOString() would shift it a day for anyone east of UTC.
export function toISO(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return localISO(v);
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
    // "Mon 6/8/2026" / "Monday, 6/8/2026" — drop the weekday and retry
    const wd = s.match(/^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+(.+)$/i);
    if (wd) return toISO(wd[1]);
    // "June 9, 2026", "9 June 2026", "10-Jun-2026", "Jun 10 2026"
    if (/[A-Za-z]{3}/.test(s) && /\d{4}/.test(s)) { const d = new Date(s.replace(/-/g, ' ') + ' UTC'); if (!isNaN(d.getTime())) return isoOf(d); }
  }
  return null;
}

// clock cell → hours since midnight: "7:00 AM", "3:30p", "15:30", "8", 8.5, an
// Excel time fraction (0.3125), or a Date (SheetJS hands time-only cells back
// as Dates on the 1899 epoch day)
export function parseClock(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v.getHours() + v.getMinutes() / 60;
  if (typeof v === 'number') return v >= 0 && v < 1 ? v * 24 : v >= 1 && v <= 24 ? v : null;
  if (typeof v !== 'string') return null;
  const m = v.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?$/);
  if (!m) return null;
  let h = +m[1]; const min = m[2] ? +m[2] / 60 : 0;
  if (h > 24 || min >= 1) return null;
  if (m[3] === 'p' && h < 12) h += 12;
  if (m[3] === 'a' && h === 12) h = 0;
  return h + min;
}
// break/lunch cell → hours: "0:30", "30 min", "1h", 30 (minutes), 0.5 (hours),
// an Excel fraction of a day (0.0208), or a time-only Date
export function parseBreakHours(v) {
  if (v == null || v === '') return 0;
  if (v instanceof Date && !isNaN(v.getTime())) return v.getHours() + v.getMinutes() / 60;
  if (typeof v === 'number') return v < 0.25 ? v * 24 : v <= 3 ? v : v / 60;
  const t = String(v).trim().toLowerCase();
  const hm = t.match(/^(\d{1,2}):(\d{2})$/); if (hm) return +hm[1] + (+hm[2]) / 60;
  const mm = t.match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes)\.?$/); if (mm) return +mm[1] / 60;
  const hh = t.match(/^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?)?\.?$/); if (hh) { const n = +hh[1]; return n <= 3 ? n : n / 60; }
  return 0;
}
// Time In / Time Out (− break) → hours worked; an overnight shift wraps at midnight
export function hoursBetween(tin, tout, brk) {
  const a = parseClock(tin), b = parseClock(tout);
  if (a == null || b == null) return null;
  let h = b - a; if (h < 0) h += 24;
  return round2(Math.max(0, h - parseBreakHours(brk)));
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
  .replace(/\b\d{4}\s*-\s*\d{2,4}\b|\b\d{4,8}\b/g, '') // year, year-range, or concatenated "20242025"
  .replace(/\s+/g, ' ').trim() || name;

const PERIOD_RE = /\d+\/\d+\s*-\s*\d+\/\d+/;

// find the header row + the meaning of each column. Also flags building-name
// columns (wide format) and whether those names RECUR further down (which means
// it's a matrix log, not a wide one).
function findHeader(rows) {
  let best = null;
  const scan = Math.min(rows.length, 60);
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
    let hours = M.hours != null ? parseHours(row[M.hours]) : null;
    if (hours == null && M.start != null && M.end != null) hours = hoursBetween(row[M.start], row[M.end], M.brk != null ? row[M.brk] : null);
    if (M.ot != null) { const ot = parseHours(row[M.ot]); if (ot) hours = round2((hours || 0) + ot); }
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

// ---- grid: names down the side, dates across the top ----------------------
// Covers the weekly crew sheet (Property | Mon | Tue | … | Total under a
// "Week of 6/8/2026" line), the month grid (Property | 1 | 2 | … | 31 under a
// "June 2026" title or sheet name) and the roster (Employee | 6/8 | 6/9 | …).
const WEEKDAY_RE = /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day|sday|nesday|rsday|urday)?\.?$/i;
const WD_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const MONTH_IDX = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const utcOf = (iso) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
const addDays = (iso, n) => { const d = utcOf(iso); d.setUTCDate(d.getUTCDate() + n); return isoOf(d); };
const weekdayOf = (s) => WD_INDEX[String(s).trim().toLowerCase().slice(0, 3)];

// "Week of 6/8/2026" / "Week ending 6/14/2026" / any lone date in the rows above
function weekAnchor(rows, upto) {
  for (let r = upto - 1; r >= 0; r--) {
    for (const cell of rows[r] || []) {
      if (cell == null || cell === '') continue;
      const iso = toISO(cell) || (typeof cell === 'string' ? toISO(cell.replace(/^[^\d]*/, '')) : null);
      if (iso) return { iso, ending: typeof cell === 'string' && /ending|end\b|w\/e/i.test(cell) };
    }
  }
  return null;
}
// "June 2026" / "6/2026" / "2026-06" in the rows above or the sheet name
function monthAnchor(rows, upto, sheetName) {
  const texts = [sheetName];
  for (let r = 0; r < upto; r++) for (const c of rows[r] || []) if (typeof c === 'string') texts.push(c);
  for (const t of texts) {
    const m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})\b/i);
    if (m) return { y: +m[2], m: MONTH_IDX[m[1].toLowerCase()] };
    const n = t.match(/\b(\d{1,2})\/(\d{4})\b/); if (n && +n[1] >= 1 && +n[1] <= 12) return { y: +n[2], m: +n[1] - 1 };
    const k = t.match(/\b(\d{4})-(\d{2})\b/); if (k) return { y: +k[1], m: +k[2] - 1 };
  }
  return null;
}

function findGridHeader(rows, sheetName) {
  const scan = Math.min(rows.length, 60);
  for (let r = 0; r < scan; r++) {
    const row = rows[r] || []; if (row.length < 4) continue;
    const dates = [], wds = [], nums = [];
    for (let c = 0; c < row.length; c++) {
      const v = row[c]; if (v == null || v === '') continue;
      if (typeof v === 'string' && WEEKDAY_RE.test(v.trim())) { wds.push({ c, wd: weekdayOf(v) }); continue; }
      const iso = toISO(v);
      if (iso) { dates.push({ c, iso }); continue; }
      if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 31) nums.push({ c, d: v });
    }
    let cols = null;
    if (dates.length >= 3) cols = dates;
    else if (wds.length >= 3) {
      const a = weekAnchor(rows, r);
      if (a) {
        const start = a.ending ? addDays(a.iso, -6) : a.iso;
        const startDow = utcOf(start).getUTCDay();
        cols = wds.map(({ c, wd }) => ({ c, iso: addDays(start, ((wd - startDow) + 7) % 7) }));
      }
    } else if (nums.length >= 5 && nums.every((n, i) => i === 0 || n.d === nums[i - 1].d + 1)) {
      const m = monthAnchor(rows, r, sheetName);
      if (m) cols = nums.map(({ c, d }) => ({ c, iso: isoOf(new Date(Date.UTC(m.y, m.m, d))) }));
    }
    if (!cols) continue;
    // the name column: the leftmost column before the first date that carries text below
    const firstDate = Math.min(...cols.map((x) => x.c));
    let nameCol = 0;
    for (let c = 0; c < firstDate; c++) {
      if (rows.slice(r + 1, r + 8).some((rw) => typeof (rw || [])[c] === 'string' && (rw || [])[c].trim())) { nameCol = c; break; }
    }
    // people or buildings down the side? the header says; else the names do
    const hdr = strOf(row[nameCol]) || '';
    const below = rows.slice(r + 1, r + 12).map((rw) => (rw || [])[nameCol]).filter((x) => typeof x === 'string' && x.trim() && !/^total/i.test(x));
    const kind = HDR.employee.test(hdr) ? 'tech' : HDR.property.test(hdr) ? 'building'
      : below.some((x) => looksLikeBuilding(x)) ? 'building' : 'tech';
    return { r, cols, nameCol, kind };
  }
  return null;
}

function parseGrid(rows, G, techName) {
  const entries = [];
  let big = 0, small = 0;   // an hours grid holds hour-sized numbers; a P&L with date headers doesn't
  for (let r = G.r + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const name = strOf(row[G.nameCol]);
    if (!name || /^(sub)?total|^sum\b|^grand/i.test(name) || PERIOD_RE.test(name)) continue;
    if (WEEKDAY_RE.test(name) || toISO(name)) continue;   // a repeated header row
    for (const { c, iso } of G.cols) {
      const n = numOf(row[c]);
      if (n != null) { if (n > 24) big++; else small++; }
      const h = parseHours(row[c]);
      if (!(h > 0)) continue;
      const bld = G.kind === 'building' ? name : null;
      entries.push({ tech: G.kind === 'tech' ? name : techName, date: iso, hours: h, pay: null, rate: null, period: null, note: null, category: null, unit: null, building: bld, buildings: bld ? [bld] : [], weights: null, flag: 'no-rate' });
    }
  }
  return big > small * 0.25 ? [] : entries;
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
    else if (H.map.date != null && (H.map.hours != null || H.map.ot != null || (H.map.start != null && H.map.end != null))) { general = parseColumnar(rows, H, techName); layout = 'columnar'; }
  }
  // names down the side, dates (or weekdays / day numbers) across the top
  if (!general.length) {
    const G = findGridHeader(rows, name);
    if (G) { general = parseGrid(rows, G, techName); if (general.length) layout = 'grid'; }
  }

  // prefer the richer general parse when it covers at least as much ground
  const useGeneral = general.length > 0 && general.length >= matrix.length;
  const entries = useGeneral ? general : matrix;
  if (!useGeneral) layout = matrix.length ? 'matrix' : 'none';

  // Dollar-grid pay logs carry the real allocation in the $ grid (per pay period),
  // not in the building name printed next to each day. When present, this is the
  // authoritative per-(period, building) split — it replaces the per-day building
  // guess downstream (see toTimers). Building labels stay raw; the importer's
  // matcher resolves them to properties.
  const rate = (entries.find((e) => e.rate)?.rate) || 23;
  // only a matrix log carries the $ grid — on a weekday-header hours grid the
  // day names would otherwise read as buildings over dollars
  const grid = layout === 'matrix' ? allocatePayLogPeriods(rows, null, rate) : { hasGrid: false, entries: [] };

  return {
    name, techName, layout, entries,
    payLogGrid: grid.hasGrid ? grid.entries : null,
    payLogRate: grid.hasGrid ? rate : null,
    entryCount: entries.length,
    totalHours: entries.reduce((a, e) => a + (e.hours || 0), 0),
    totalPay: entries.reduce((a, e) => a + (e.pay || 0), 0),
    // a real pay log either says so in its name, or reads as a person-and-hours
    // layout (columnar/wide). A recurring $ matrix must match by name so income /
    // expense / P&L tabs full of numbers don't masquerade as timesheets.
    looksPayLog: /pay ?log|time ?sheet|timecard|time ?log|hours|ramos/i.test(name) || layout === 'columnar' || layout === 'wide' || layout === 'grid',
  };
}

export function interpretWorkbook(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { cellDates: true });
  return wb.SheetNames.map((name) => interpretSheet(wb.Sheets[name], name));
}
