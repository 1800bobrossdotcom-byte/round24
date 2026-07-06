// ============================================================
// import parser — reads real Evolution24 pay-log spreadsheets.
// handles two dialects observed in the wild:
//   A: [date | hours | pay]  with "TOTAL Pay Period" markers, "*25/hr" overrides
//   B: "HOURLY: 23.00" header, [date | _ | hours], property allocation grid
// derives per-entry rate from pay/hours when no explicit rate given.
// everything stays client-side — the file never leaves the browser.
// ============================================================

import * as XLSX from 'xlsx';

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;
const isNum = (v) => typeof v === 'number' && !Number.isNaN(v);

// Excel serial or JS date → ISO
function toISO(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (isNum(v) && v > 40000 && v < 60000) {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return d.toISOString().slice(0, 10);
  }
  if (typeof v === 'string' && DATE_RE.test(v)) return v.slice(0, 10);
  return null;
}

function detectRate(rows) {
  for (const row of rows.slice(0, 6)) {
    for (const cell of row) {
      if (typeof cell === 'string' && /hourly/i.test(cell) && cell.includes(':')) {
        const n = parseFloat(cell.split(':')[1]);
        if (!Number.isNaN(n)) return n;
      }
    }
  }
  return null;
}

// pull a clean tech name out of a sheet title
function techNameFromSheet(name) {
  return name
    .replace(/pay ?log/i, '')
    .replace(/\d{4}\s*-\s*\d{2,4}/g, '')   // "20242025", "2025-2026", "2024 2025"
    .replace(/\b\d{4}\b/g, '')             // any lone 4-digit year
    .replace(/\s+/g, ' ')
    .trim() || name;
}

// plausible loaded maintenance rate band — anything outside is suspect
const RATE_MIN = 10, RATE_MAX = 60;
const sane = (rate) => (rate != null && rate >= RATE_MIN && rate <= RATE_MAX ? rate : null);

// parse ONE sheet into timecard entries
export function parseSheet(ws, sheetName) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false });
  const headerRate = detectRate(rows);
  const techName = techNameFromSheet(sheetName);

  const entries = [];
  let periodTag = null;

  for (const row of rows) {
    if (!row || !row.length) continue;
    const first = row[0];

    // period label like "7/13 - 7/19"
    if (typeof first === 'string' && /\d+\/\d+\s*-\s*\d+\/\d+/.test(first)) {
      periodTag = first.trim();
      continue;
    }
    // skip TOTAL rows (we recompute totals ourselves)
    if (typeof first === 'string' && /total/i.test(first)) continue;

    const iso = toISO(first);
    if (!iso) continue;

    // find hours: first numeric after the date that's a plausible hour value (0–24)
    // and pay: a larger numeric if present
    let hours = null, pay = null, note = null, override = null;
    for (let i = 1; i < row.length; i++) {
      const c = row[i];
      if (typeof c === 'string') {
        if (/off/i.test(c)) { hours = 0; }
        else if (/\*\s*(\d+(\.\d+)?)\s*\/?hr/i.test(c)) { override = parseFloat(c.match(/(\d+(\.\d+)?)/)[1]); }
        else if (c.trim() && !/paid by/i.test(c)) { note = c.trim(); }
        continue;
      }
      if (isNum(c)) {
        if (hours === null && c >= 0 && c <= 24) hours = c;
        else if (pay === null && c > 24) pay = c;
        else if (hours !== null && pay === null && c >= 0) pay = c;
      }
    }
    if (hours === null) continue;

    // derive rate: explicit override > sane(pay/hours) > sane(header)
    let rate = sane(override);
    let flag = null;
    if (rate == null && pay && hours > 0) rate = sane(Math.round((pay / hours) * 100) / 100);
    if (rate == null) rate = sane(headerRate);
    if (rate == null) flag = 'no-rate';               // needs a rate assigned in review
    // pay present but wildly off implied (date-total leaked into a cell)
    if (pay != null && hours > 0 && pay / hours > RATE_MAX * 2) { pay = null; flag = flag || 'bad-pay'; }

    entries.push({
      tech: techName,
      date: iso,
      hours,
      pay: pay ?? (rate ? Math.round(hours * rate * 100) / 100 : null),
      rate,
      period: periodTag,
      note,
      flag,
    });
  }

  return { techName, headerRate, entries };
}

// parse a whole workbook — returns per-sheet results + which look like pay logs
export function parseWorkbook(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { cellDates: true });
  const sheets = [];
  for (const name of wb.SheetNames) {
    // heuristic: pay logs mention "pay log" or a person's name; skip P&L / accounting tabs
    const looksPayLog = /pay ?log/i.test(name) || /ramos/i.test(name);
    const parsed = parseSheet(wb.Sheets[name], name);
    sheets.push({
      name,
      looksPayLog,
      techName: parsed.techName,
      headerRate: parsed.headerRate,
      entryCount: parsed.entries.length,
      entries: parsed.entries,
      totalHours: parsed.entries.reduce((a, e) => a + e.hours, 0),
      totalPay: parsed.entries.reduce((a, e) => a + (e.pay || 0), 0),
    });
  }
  return sheets;
}

// map imported entries → Caliper timer shape
export function toTimers(sheets, selectedNames) {
  const timers = [];
  let id = 0;
  for (const s of sheets) {
    if (!selectedNames.includes(s.name)) continue;
    for (const e of s.entries) {
      if (e.hours <= 0) continue; // skip OFF days
      id++;
      timers.push({
        id: `imp_${id}`,
        techName: e.tech,
        date: e.date,
        durationHrs: e.hours,
        rate: e.rate || 0,
        category: 'imported',
        issue: e.note || 'imported from pay log',
        propId: null, // unallocated — user assigns, mirrors the real gap
        unit: '—',
        period: e.period,
      });
    }
  }
  return timers;
}
