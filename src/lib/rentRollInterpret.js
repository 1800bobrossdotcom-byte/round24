// ============================================================
// Caliper rent-roll interpreter — reads a rent roll out of almost any shape.
//
// Two engines, best-coverage wins:
//   legacy  — Evolution24's per-building lease worksheets (one tab per building,
//             monthly-paid columns, fees in adjacent cells) via parseLeaseWorkbook
//   generic — a single-table rent roll in any column order, with an optional
//             Property/Building column that fans rows out into buildings
//
// Both normalize to { buildings: [{ name, city, units: [...] }] }, the shape
// importLeaseBuildings() persists. Everything is client-side.
// ============================================================

import * as XLSX from 'xlsx';
import { parseLeaseWorkbook } from './leaseParser.js';
import { localISO } from './dates.js';

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const low = (s) => norm(s).toLowerCase();
const money = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Math.abs(v) < 1e6 ? v : null;
  const raw = String(v);
  const neg = /^\s*\(.*\)\s*$/.test(raw);      // accounting negative "(500)" → -500 (was flipped to +500)
  const f = parseFloat(raw.replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(f) || Math.abs(f) >= 1e6) return null;
  return neg ? -Math.abs(f) : f;
};
const isoDate = (v) => {
  if (v instanceof Date && !isNaN(v.getTime())) return localISO(v);   // SheetJS dates are local midnight
  if (typeof v === 'number' && v > 20000 && v < 90000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  const s = norm(v);
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; const d = new Date(Date.UTC(y, +m[1] - 1, +m[2])); return (d.getUTCMonth() === +m[1] - 1 && d.getUTCDate() === +m[2]) ? d.toISOString().slice(0, 10) : null; }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // accept non-padded + validate (was fixed \d{2}, let 0000-00-00 through)
  if (m) { const y = +m[1], mo = +m[2], da = +m[3]; const d = new Date(Date.UTC(y, mo - 1, da)); return (y > 1900 && d.getUTCMonth() === mo - 1 && d.getUTCDate() === da) ? d.toISOString().slice(0, 10) : null; }
  return null;
};
const bedsNum = (s) => { const t = low(s); if (t.includes('studio')) return 0; const m = t.match(/(\d+)/); return m ? +m[1] : null; };

// header vocabulary for a generic rent roll
const RR = {
  unit: /^(unit|apt\.?|apartment|suite|space|unit\s*#|#|door|room)$/i,
  tenant: /^(tenant|tenant\s*name|resident|lessee|occupant|name|renter|leaseholder)$/i,
  first: /^first\s*name$/i, last: /^last\s*name$/i,
  rent: /^(rent|rent\s*amount|monthly\s*rent|market\s*rent|base\s*rent|lease\s*rent|price|current\s*rent)$/i,
  deposit: /^(deposit|security\s*deposit|sec(urity)?\s*dep\.?)$/i,
  lstart: /^(lease\s*start|move[\s-]*in|start\s*date|from|commence(ment)?)$/i,
  lend: /^(lease\s*end|lease\s*expiration|expiration|end\s*date|move[\s-]*out|expires?|thru|through)$/i,
  beds: /^(beds?|bedrooms?|br|bd|#\s*of\s*beds|number\s*of\s*beds|bed\s*\/?\s*bath|floorplan|type|size)$/i,
  status: /^(status|occupancy|occupied\??|vacancy)$/i, // dropped 'state' — matched an address State column
  building: /^(building|property|complex|community|site|location)$/i,
  phone: /^(phone|tel|telephone|contact|cell|mobile)$/i,
  total: /^(total|total\s*rent|total\s*due|total\s*amount|amount\s*due)$/i,
  // anchored so "Petroleum"/"Waterfront"/"Camden"/"Insurance Contact" don't pull a wrong column into fees
  pet: /^pet(\s*fee)?$/i, insurance: /^insurance(\s*fee)?$/i, water: /^(water|utilit(y|ies)|trash)(\s*fee)?$/i, cam: /^(cam|tax(es)?)(\s*fee)?$/i,
};

// when a roll carries both, the rent people actually pay beats the asking rent
const RENT_PREF = /^(lease|current|actual|contract|scheduled|effective|monthly)\s*rent$/i;
function findHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 60); r++) {
    const cells = (rows[r] || []).map(norm);
    const map = {}; let hits = 0;
    cells.forEach((h, i) => {
      if (!h) return;
      for (const [field, re] of Object.entries(RR)) {
        if (re.test(h)) { if (map[field] == null) { map[field] = i; hits++; } break; }
      }
    });
    cells.forEach((h, i) => { if (RENT_PREF.test(h)) map.rent = i; });
    // a rent roll needs a rent column plus something identifying the unit/tenant
    if (map.rent != null && (map.tenant != null || map.unit != null || map.first != null) && hits >= 2) return { r, map };
  }
  return null;
}

function vacantStatus(statusCell, tenant) {
  const s = low(statusCell);
  if (/vacant|empty|available|open|unoccupied/.test(s)) return 'vacant';
  if (/held|hold|off[\s-]?market/.test(s)) return 'held';
  if (s && /occupied|leased|current|rented|filled/.test(s)) return 'leased';
  return low(tenant) && !/vacant|empty|—|^-$/.test(low(tenant)) ? 'leased' : 'vacant';
}

function parseGeneric(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { cellDates: true });
  const byBuilding = new Map();
  const NON_DATA = /notes?vendors?|referral|leases?\s*ending|^sheet\d+$|tenant\s*referrals/i;
  const single = wb.SheetNames.length === 1;     // a CSV or one-tab export is "Sheet1" — never skip it
  for (const name of wb.SheetNames) {
    if (!single && NON_DATA.test(name)) continue;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: true, defval: '' });
    const H = findHeader(rows);
    if (!H) continue;
    const M = H.map;
    const g = (row, k) => (M[k] != null ? row[M[k]] : undefined);
    const sheetBuilding = norm(name.replace(/\b20\d\d(-20\d\d)?\b/g, '')) || name;
    let blanks = 0, section = null;
    for (let r = H.r + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const unit = norm(g(row, 'unit')).replace(/\.0$/, '');
      const tenant = M.tenant != null ? norm(g(row, 'tenant')) : `${norm(g(row, 'first'))} ${norm(g(row, 'last'))}`.trim();
      const rent = money(g(row, 'rent'));
      const ul = low(unit);
      // a section row — one lone text cell naming the building the rows below
      // belong to (how most PM exports group a multi-property roll)
      const filled = row.filter((c) => c !== '' && c != null).map(norm).filter(Boolean);
      if (filled.length === 1 && /[a-z]/i.test(filled[0]) && !/^\d+\s*[a-z]?$/i.test(filled[0])
        && !/^(sub|grand\s*)?total/i.test(filled[0]) && (filled[0].length >= 6 || filled[0].includes(' '))
        && !(M.building != null && norm(g(row, 'building')))) { section = filled[0]; continue; }
      if (/^(grand\s*)?totals?$/.test(ul) || /total\s*rent/i.test(low(tenant))) break;   // the roll's own grand total ends it
      if (/^(sub)?total\b/.test(ul) || /sqft/.test(ul)) continue;                       // a per-building subtotal: keep going
      if (!unit && !tenant && rent == null) { if (++blanks >= 3) break; continue; }
      blanks = 0;
      if (rent == null && !tenant && !unit) continue;
      const buildingName = (M.building != null && norm(g(row, 'building'))) || section || sheetBuilding;
      const bedsRaw = norm(g(row, 'beds'));
      const COMM = /\b(commercial|retail|office|storefront|shop|unit\s*type\s*:?\s*comm)\b/i;
      const commercial = COMM.test(bedsRaw) || COMM.test(unit);
      const status = vacantStatus(g(row, 'status'), tenant);
      const unitRec = {
        number: unit || String((byBuilding.get(buildingName)?.units.length || 0) + 1),
        tenant: status === 'leased' ? tenant : '', phone: M.phone != null ? norm(g(row, 'phone')) : '',
        beds: bedsNum(bedsRaw), type: commercial ? 'commercial' : 'residential',
        furnished: /furnish|-f\b|\bf$/i.test(low(unit + ' ' + bedsRaw)),
        rent, fees: { pet: money(g(row, 'pet')), insurance: money(g(row, 'insurance')), water: money(g(row, 'water')), cam: money(g(row, 'cam')) },
        total: money(g(row, 'total')), deposit: money(g(row, 'deposit')),
        leaseStart: M.lstart != null ? isoDate(g(row, 'lstart')) : null,
        leaseEnd: M.lend != null ? isoDate(g(row, 'lend')) : null,
        status, note: '',
      };
      if (!byBuilding.has(buildingName)) byBuilding.set(buildingName, { name: buildingName, city: '', units: [] });
      byBuilding.get(buildingName).units.push(unitRec);
    }
  }
  return { buildings: [...byBuilding.values()].filter((b) => b.units.length) };
}

// interpret a rent-roll workbook: run both engines, keep whichever reads more
// units. Legacy owns the Evolution24 per-building format; generic owns the flat
// single-table rent roll that any other PM tool exports.
export function interpretRentRoll(arrayBuffer) {
  let legacy = { buildings: [] }, generic = { buildings: [] };
  try { legacy = parseLeaseWorkbook(arrayBuffer); } catch { /* ignore */ }
  try { generic = parseGeneric(arrayBuffer); } catch { /* ignore */ }
  const count = (r) => r.buildings.reduce((a, b) => a + b.units.length, 0);
  // Legacy is the Evolution24 specialist: it dedupes building tabs and skips RR
  // snapshots / prior-year sheets, so its count is trustworthy when it finds a
  // real portfolio. The generic parser can double-count those same tabs, so only
  // fall back to it when legacy finds ~nothing (a foreign flat export).
  const legacyN = count(legacy), genN = count(generic);
  const useGeneric = legacyN < 3 && genN > legacyN;
  const chosen = useGeneric ? generic : legacy;
  return { ...chosen, engine: useGeneric ? 'generic' : 'legacy', units: count(chosen), buildingCount: chosen.buildings.length };
}
