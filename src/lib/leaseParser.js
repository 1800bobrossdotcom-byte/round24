import * as XLSX from 'xlsx';

// Parse a lease-worksheet workbook into { buildings:[{name,city,units:[...]}] }.
// Auto-detects which sheets are per-building worksheets (a header row with
// "rent amount" + a tenant/unit column), skips rent-roll snapshots, notes,
// prior-year, and scratch sheets. Normalizes the messy reality: mixed date
// formats, names split across first/last, fees in adjacent columns, flags
// ("Commercial", "F"/furnished) buried in text, totals rows inside the list.

const low = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const money = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Math.abs(v) < 1e6 ? v : null;
  const raw = String(v);
  const neg = /^\s*\(.*\)\s*$/.test(raw); // accounting-style negative, e.g. "(500)"
  const f = parseFloat(raw.replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(f) || Math.abs(f) >= 1e6) return null;
  return neg ? -Math.abs(f) : f;
};
const isoDate = (v) => {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  // Excel serial date (days since 1899-12-30) when the cell wasn't date-formatted
  if (typeof v === 'number' && v > 20000 && v < 90000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  const s = norm(v);
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let y = +m[3]; y = y < 100 ? 2000 + y : y;
    const dt = new Date(Date.UTC(y, +m[1] - 1, +m[2]));
    return dt.getUTCMonth() === +m[1] - 1 ? dt.toISOString().slice(0, 10) : null;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : null;
};
const noteOf = (v) => { if (v instanceof Date) return ''; const s = norm(v); return s && !isoDate(s) ? s : ''; };

const SKIP = /rr\s*\d|\brr\b|rent roll|as of|notesvendors|notes|referral|leases ending|^sheet\d+|biltmore|^rge$/i;
const DIR = new Set(['st', 'street', 'ave', 'avenue', 'rd', 'road', 'dr', 'drive', 'ln', 'lane', 'n', 's', 'e', 'w', 'north', 'south', 'east', 'west', 'the']);
// dedupe key: leading street number + first distinctive word (so "168-176 N
// Water St 2026" and "168 N Water Street" collapse to one building).
function dedupeKey(name) {
  const num = (name.match(/\d+/) || [''])[0];
  const word = name.toLowerCase().split(/[^a-z0-9]+/).find((w) => w.length >= 3 && !DIR.has(w) && !/^\d+$/.test(w)) || '';
  return `${num}|${word}`;
}

function findHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 8); r++) {
    const cells = (rows[r] || []).map(low);
    const j = cells.join(' ');
    if (j.includes('rent amount') &&
      (j.includes('tenant name') || j.includes('first name') || j.includes('last name') || j.includes('apartment') || cells[0] === 'unit')) {
      return { r, cells };
    }
  }
  return null;
}
function colmap(hdr) {
  const m = {};
  hdr.forEach((h, i) => {
    if ((h.includes('apartment') || h === 'unit' || h === 'unit #') && m.unit == null) m.unit = i;
    else if (h.includes('tenant name')) m.tenant = i;
    else if (h.includes('first name')) m.first = i;
    else if (h.includes('last name')) m.last = i;
    else if (h.startsWith('rent amount') && m.rent == null) m.rent = i;
    else if (h.includes('total amount due')) m.total = i;
    else if (h.includes('security deposit')) m.dep = i;
    else if (h.includes('lease end')) m.lend = i;
    else if (h.includes('lease start')) m.lstart = i;
    else if (h.includes('# of beds') || h === 'beds') m.beds = i;
    else if (h.includes('phone')) m.phone = i;
    else if (h.startsWith('pet')) m.pet = i;
    else if (h.includes('insurance')) m.ins = i;
    else if ((h.includes('water') && h.includes('trash')) || h.includes('utility/trash') || h.startsWith('trash')) { if (m.water == null) m.water = i; }
    else if (h.includes('cam') || h.includes('tax/')) m.cam = i;
  });
  if (m.unit == null) m.unit = 0;
  return m;
}
function bedsNum(s) {
  const t = low(s);
  if (t.includes('studio')) return 0;
  const m = t.match(/(\d+)/); return m ? +m[1] : null;
}

export function parseLeaseWorkbook(dataArrayBuffer) {
  const wb = XLSX.read(dataArrayBuffer, { cellDates: true });
  const candidates = [];
  for (const name of wb.SheetNames) {
    if (SKIP.test(name)) continue;
    if (/\b2024\b/.test(name) && !/\b2026\b/.test(name)) continue; // prior year only
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: true, defval: '' });
    const hdr = findHeader(rows);
    if (!hdr) continue;
    const cm = colmap(hdr.cells);
    const units = []; let blanks = 0;
    for (let r = hdr.r + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const g = (k) => (k in cm ? row[cm[k]] : undefined);
      const unit = g('unit');
      const tenant = 'tenant' in cm ? g('tenant') : `${norm(g('first'))} ${norm(g('last'))}`.trim();
      const us = low(unit), ts = low(tenant), rent = money(g('rent'));
      if (us.startsWith('total') || us.includes('sqft') || ts.includes('total rent')) break;
      if (us === '' && ts === '' && rent == null) { if (++blanks >= 4) break; continue; }
      blanks = 0;
      if (rent == null && ts === '') continue;
      const vacant = ts.includes('vacant');
      const beds = norm(g('beds')); const commercial = beds.toLowerCase().includes('commercial');
      const uNum = norm(unit).replace(/\.0$/, '');
      units.push({
        number: uNum, tenant: vacant ? '' : tenant, phone: 'phone' in cm ? norm(g('phone')) : '',
        beds: bedsNum(beds), type: commercial ? 'commercial' : 'residential',
        furnished: /furnish|-f\b|\bf$/i.test((uNum + ' ' + beds).toLowerCase()),
        rent, fees: { pet: money(g('pet')), insurance: money(g('ins')), water: money(g('water')), cam: money(g('cam')) },
        total: money(g('total')), deposit: money(g('dep')),
        leaseStart: 'lstart' in cm ? isoDate(g('lstart')) : null,
        leaseEnd: 'lend' in cm ? isoDate(g('lend')) : null,
        status: vacant ? 'vacant' : 'leased', note: 'lend' in cm ? noteOf(g('lend')) : '',
      });
    }
    if (units.length) {
      candidates.push({ key: dedupeKey(name), year2026: /\b2026\b/.test(name),
        name: norm(name.replace(/\b20\d\d(-20\d\d)?\b/g, '')) || name, units });
    }
  }
  // one building per key: prefer the sheet carrying a 2026 label, then the one
  // with the most units (the fullest/current worksheet over a stale snapshot).
  const best = new Map();
  for (const c of candidates) {
    const cur = best.get(c.key);
    if (!cur || (c.year2026 && !cur.year2026) || (c.year2026 === cur.year2026 && c.units.length > cur.units.length)) {
      best.set(c.key, c);
    }
  }
  return { buildings: [...best.values()].map(({ name, city = 'Rochester', units }) => ({ name, city, units })) };
}
