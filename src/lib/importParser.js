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

// where does this sheet record the building each row belongs to?
// Supports both a per-row column ("Property" / "Building" / "Location" /
// "Address" header) and a sheet-level header ("Property: 123 Main St").
// This is what lets a shop with NO integration and NO buildings yet import
// — the buildings are discovered from the sheet.
const BUILDING_HDR = /\b(propert(?:y|ies)|building|bldg|location|site|address|complex|apt\b|apartments?)\b/i;
// stricter: the WHOLE cell must be a building header, so "Email Address" or a
// note that merely mentions "site" isn't mistaken for the building column.
const BUILDING_COL_HDR = /^\s*(propert(?:y|ies)|building|bldg\.?|location|site|complex)\s*$/i;

// recognize a building name inside the allocation grid (Evolution24 logs write
// building names as cells above their dollar columns: "379 S.Main", "Water St.",
// "St.Paul", "121 Park", "440 Armstrong", "31 Genesee", "4940 Hillcrest"…).
const STREET_WORD = /\b(st|street|ave|avenue|rd|road|dr|drive|blvd|ln|lane|park|square|sq|ct|court|place|pl|hill|hillcrest|way|circle|cir)\b/i;
export function looksLikeBuilding(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (t.length < 3 || t.length > 30) return false;
  if (t.includes('/')) return false;                              // notes: "Water St.- 4 / St.Paul-1"
  if (/^(total|off|paid by|hourly|pay period|monthly)/i.test(t)) return false;
  // time/count note cells ("8 hrs overtime", "40 hours", "5 sick days", "2 units")
  // look like "number + words" but are NOT buildings — exclude them.
  if (/\b(hrs?|hours?|days?|wks?|weeks?|units?|sick|pto|vac(ation)?|overtime|\bot\b|mins?|minutes?|jobs?)\b/i.test(t)) return false;
  const words = t.split(/\s+/).length;
  if (/^\d{1,5}\s*[A-Za-z]/.test(t) && words <= 3) return true;    // 379 S.Main, 31 Genesee, 357Alexander
  if (STREET_WORD.test(t) && words <= 3) return true;             // Water St., 121 Park, St.Paul
  return false;
}

function detectBuilding(rows) {
  let buildingCol = -1, sheetBuilding = null;
  for (const row of rows.slice(0, 12)) {
    if (!row) continue;
    for (let i = 0; i < row.length; i++) {
      const c = row[i];
      if (typeof c !== 'string') continue;
      const m = c.match(/^\s*(propert(?:y|ies)|building|bldg|location|site|complex)\s*[:=]\s*(.+)$/i);
      if (m && m[2].trim()) { sheetBuilding = m[2].trim(); }
      else if (buildingCol < 0 && BUILDING_COL_HDR.test(c)) { buildingCol = i; }
    }
  }
  return { buildingCol, sheetBuilding };
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
  const { buildingCol, sheetBuilding } = detectBuilding(rows);

  const entries = [];
  let periodTag = null;
  let lastBuildings = [];      // building names from the most recent grid header row
  let lastBuildingCols = [];   // [{ col, name }] — where each of those names sits

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
    // and pay: a larger numeric if present. texts collects every string cell so
    // the importer can detect the building this row was allocated to.
    let hours = null, pay = null, note = null, override = null;
    const texts = [];
    for (let i = 1; i < row.length; i++) {
      const c = row[i];
      if (typeof c === 'string') {
        if (/\boff\b/i.test(c)) { hours = 0; }   // whole word — not "Office", "Offset", …
        else if (/\*\s*(\d+(\.\d+)?)\s*\/?hr/i.test(c)) { override = parseFloat(c.match(/(\d+(\.\d+)?)/)[1]); }
        else if (c.trim() && !/paid by/i.test(c)) { note = c.trim(); texts.push(c.trim()); }
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

    // building allocation for this row. Priority:
    //   1. explicit Property/Building column
    //   2. building names written in the grid cells on this row
    //   3. the nearest grid header row above (dollar rows inherit the names)
    //   4. a sheet-level "Property: X" header
    let colBuilding = null;
    if (buildingCol >= 0 && typeof row[buildingCol] === 'string') {
      const v = row[buildingCol].trim();
      if (v && !BUILDING_HDR.test(v) && !/total/i.test(v)) colBuilding = v;
    }
    const gridBuildings = [];
    const gridCols = [];
    for (let i = 1; i < row.length; i++) {
      if (looksLikeBuilding(row[i])) { gridBuildings.push(row[i].trim()); gridCols.push(i); }
    }
    if (gridBuildings.length) {
      lastBuildings = gridBuildings;
      lastBuildingCols = gridBuildings.map((name, k) => ({ col: gridCols[k], name }));
    }

    let buildings = [];
    let inheritsCols = false;
    if (colBuilding) buildings = [colBuilding];
    else if (gridBuildings.length) buildings = gridBuildings;
    else if (lastBuildings.length) { buildings = lastBuildings; inheritsCols = true; }
    else if (sheetBuilding) buildings = [sheetBuilding];
    buildings = [...new Set(buildings)];

    // dollar-weighted allocation: a row that inherits a header's columns often
    // carries the per-building dollar spend in those same columns. Weight this
    // row's hours by that spend so a building with $0 doesn't absorb hours it
    // never earned. Falls back to an even split when no dollars are present.
    let weights = null;
    if (inheritsCols && buildings.length > 1 && lastBuildingCols.length) {
      const w = buildings.map((b) => {
        const bc = lastBuildingCols.find((x) => x.name === b);
        const v = bc ? row[bc.col] : null;
        return isNum(v) && v > 0 ? v : 0;
      });
      if (w.some((x) => x > 0)) weights = w;
    }

    entries.push({
      tech: techName,
      date: iso,
      hours,
      pay: pay ?? (rate ? Math.round(hours * rate * 100) / 100 : null),
      rate,
      period: periodTag,
      note,
      texts,          // all string cells
      building: colBuilding || buildings[0] || null,
      buildings,      // every building this row is allocated across
      weights,        // parallel to buildings: dollar spend when known, else null
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

// map imported entries → Caliper timer shape.
// resolveBuildings(names[]) → [propId] (already-created, deduped). A day's
// hours are split evenly across the buildings it's allocated to (one timer
// each). Rows that resolve to NO building are still ingested as a single
// UNALLOCATED timer (propId null, unallocated:true) so nothing is lost — the
// office allocates them later. Returns { timers, allocated, unallocated }.
export function toTimers(sheets, selectedNames, resolveBuildings) {
  const timers = [];
  let id = 0, allocated = 0, unallocated = 0;
  for (const s of sheets) {
    if (!selectedNames.includes(s.name)) continue;
    for (const e of s.entries) {
      if (e.hours <= 0) continue; // skip OFF days
      const names = e.buildings || [];
      // resolve each name → property id, accumulating dollar weight per id so
      // duplicate names or names that collapse to one property merge cleanly.
      const weightById = new Map();
      const order = [];
      names.forEach((nm, k) => {
        const rid = resolveBuildings ? resolveBuildings([nm])[0] : null;
        if (!rid) return;
        if (!weightById.has(rid)) order.push(rid);
        const w = e.weights && e.weights[k] > 0 ? e.weights[k] : 0;
        weightById.set(rid, (weightById.get(rid) || 0) + w);
      });
      const base = {
        techName: e.tech, date: e.date, rate: e.rate || 0,
        category: e.category || 'imported', issue: e.note || 'imported from pay log',
        unit: e.unit || '—', period: e.period,
      };
      if (order.length) {
        const totalW = order.reduce((a, rid) => a + weightById.get(rid), 0);
        // dollar-weighted fractions when we have spend, else even split
        const fracs = totalW > 0
          ? order.map((rid) => weightById.get(rid) / totalW)
          : order.map(() => 1 / order.length);
        let assigned = 0;
        order.forEach((propId, k) => {
          id++; allocated++;
          // last split takes the exact remainder so hours sum precisely
          const hrs = k === order.length - 1
            ? Math.round((e.hours - assigned) * 100) / 100
            : Math.round((e.hours * fracs[k]) * 100) / 100;
          assigned += hrs;
          timers.push({ id: `imp_${id}`, ...base, durationHrs: hrs, propId });
        });
      } else {
        id++; unallocated++;
        timers.push({ id: `imp_${id}`, ...base, durationHrs: e.hours, propId: null, unallocated: true });
      }
    }
  }
  return { timers, allocated, unallocated };
}
