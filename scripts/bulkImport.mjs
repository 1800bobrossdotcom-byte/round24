#!/usr/bin/env node
// ============================================================
// One-shot bulk import: port the Evolution24 Excel workbooks into a live Round24
// org — rent roll (units + leases), the labor spine (imported pay logs), and the
// per-building P&L config. Runs the SAME interpreters the app uses.
//
// DRY RUN by default: prints exactly what it would write + a reconciliation +
// any building names that didn't match across sources, and writes NOTHING.
// Add --commit (with --url + --key service-role) to actually load the org.
//
//   node scripts/bulkImport.mjs \
//     --org <ORG_UUID> \
//     --leases <lease_workbook.xlsx> \
//     --labor  <pay_log_workbook.xlsx> \
//     --pl     <pl_sheets_workbook.xlsx> \
//     [--url https://xxx.supabase.co --key <SERVICE_ROLE_KEY> --commit]
//
// Fields are written as legacy PLAINTEXT (units/leases tenant, the labor + plconfig
// blobs). Round24 reads these dual-mode; the next in-app save re-encrypts them.
// ============================================================

import { readFileSync } from 'fs';
import * as XLSX from 'xlsx';
import { interpretRentRoll } from '../src/lib/rentRollInterpret.js';
import { interpretWorkbook } from '../src/lib/excelInterpret.js';
import { interpretPLWorkbook } from '../src/lib/plSheetInterpret.js';
import { allocatePayLogPeriods } from '../src/lib/payLogAllocate.js';

// --- split a lease tab that stacks two buildings (e.g. "31 Genesee St" then
// "379 Main St", each with its own header + units + TOTAL) into separate buildings ---
const ADDR = /^\s*\d+[- \d]*\s+[a-z].*(st|street|ave|avenue|rd|road|dr|drive|main|paul|park|water|genes|alexander|central|fitzhugh|james|armstrong)/i;
function splitStackedBuildings(file, onlySheets = /gen.*main|31\s*gen/i) {
  const wb = XLSX.read(readFileSync(file), { cellDates: true });
  const out = [];
  for (const name of wb.SheetNames) {
    if (!onlySheets.test(name)) continue;          // only the known stacked tab(s)
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: null });
    // a stacked sheet has >1 building-header row (col0 an address, col1 empty)
    const heads = rows.map((r, i) => ({ i, r })).filter(({ r }) => r && ADDR.test(String(r[0] || '')) && !r[1]);
    if (heads.length < 2) continue;
    for (let h = 0; h < heads.length; h++) {
      const start = heads[h].i, end = h + 1 < heads.length ? heads[h + 1].i : rows.length;
      const bname = String(rows[start][0]).trim();
      const units = [];
      for (let i = start + 1; i < end; i++) {
        const r = rows[i] || []; const num = r[0];
        if (num == null || /^(unit|total)/i.test(String(num))) continue;
        const rent = Number(String(r[3] ?? '').replace(/[^0-9.]/g, ''));
        units.push({ number: String(num), tenant: r[1] && !/vacant/i.test(String(r[1])) ? String(r[1]).trim() : null,
          phone: r[2] ? String(r[2]) : null, rent: Number.isFinite(rent) && rent > 0 ? rent : null,
          status: r[1] && !/vacant/i.test(String(r[1])) ? 'leased' : 'vacant', type: 'residential' });
      }
      if (units.length) out.push({ name: bname, sheet: name, units });
    }
  }
  return out;
}

// --- dollar-grid building allocation from the matrix pay logs: name rows carry
// building labels in cols 4-7, the next row the $ allocated to each. Sum → weights. ---
function gridWeights(rows) {
  const w = {};
  const isName = (v) => typeof v === 'string' && /[a-z]/i.test(v) && !/^-?[\d.,$\s]+$/.test(v); // has letters, not a pure number
  for (let i = 0; i < rows.length - 1; i++) {
    const nr = rows[i] || [], dr = rows[i + 1] || [];
    const cols = [4, 5, 6, 7];
    const named = cols.filter((c) => isName(nr[c])).length;
    if (named < 2) continue;                       // not a building-name row
    for (const c of cols) {
      const label = nr[c]; const d = Number(String(dr[c] ?? '').replace(/[^0-9.\-]/g, ''));
      if (isName(label) && Number.isFinite(d) && d > 0) w[label.trim()] = (w[label.trim()] || 0) + d;
    }
  }
  return w;
}

// ---- args ----
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) { const k = a.slice(2); const v = process.argv[i + 1]; if (v && !v.startsWith('--')) { args[k] = v; i++; } else args[k] = true; }
}
const COMMIT = !!args.commit;
const need = (k) => { if (!args[k]) { console.error(`missing --${k}`); process.exit(1); } return args[k]; };
const ORG = need('org');

// ---- building-name matcher: link labor/P&L names to the rent-roll's canonical names ----
const STOP = new Set(['st', 'street', 'ave', 'avenue', 'rd', 'road', 'dr', 'drive', 'ln', 'lane', 'blvd', 'ct', 'court', 'pl', 'place', 'sq', 'square', 'way', 'apt', 'apts', 'apartment', 'apartments', 'unit', 'units', 'n', 's', 'e', 'w', 'north', 'south', 'east', 'west', 'roc', 'syr', 'geneva']);
const normBldg = (s) => String(s || '').toLowerCase().replace(/[.,#()\-–/]/g, ' ')
  .replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2')   // split "357alexander" / "gen379"
  .replace(/\s+/g, ' ').trim();
const firstNum = (s) => (normBldg(s).match(/\b(\d+)\b/) || [''])[0];
const alphaWords = (s) => normBldg(s).split(' ').filter((w) => /[a-z]/.test(w) && !/\d/.test(w) && !STOP.has(w));

function buildMatcher(canonicalNames) {
  const canon = canonicalNames.map((name) => ({ name, num: firstNum(name), words: alphaWords(name) }));
  return (label) => {
    const num = firstNum(label); const words = alphaWords(label);
    if (!words.length) return null;
    // 1) same leading number AND a shared street word (e.g. "168-172 N Water" ↔ "168-176 N Water St")
    let hit = canon.find((c) => c.num && c.num === num && c.words.some((w) => words.includes(w)));
    if (hit) return hit.name;
    // 2) shorthand with no/other number ("Water St.", "St Paul"): the street word is unique
    const w = words[0];
    const ws = canon.filter((c) => c.words.includes(w));
    if (ws.length === 1) return ws[0].name;
    return null;
  };
}

// ---- parse everything ----
console.log(`\n=== Round24 bulk import  (org ${ORG})  ${COMMIT ? '*** COMMIT ***' : 'DRY RUN'} ===`);

const rr = interpretRentRoll(readFileSync(need('leases')));
// split any stacked "two buildings on one tab" sheet (31 Genesee + 379 Main) into two
const stacked = splitStackedBuildings(need('leases'));
if (stacked.length) {
  const stackedSheets = new Set(stacked.map((s) => s.sheet));
  // drop the merged building(s) the interpreter produced from a stacked sheet, add the split ones
  rr.buildings = rr.buildings.filter((b) => !/gen.*main|31\s*gen/i.test(b.name));
  for (const s of stacked) rr.buildings.push({ name: s.name, city: '', units: s.units });
  console.log(`  (split ${stacked.length} stacked buildings from ${stackedSheets.size} tab: ${stacked.map((s) => s.name).join(' + ')})`);
}
// extra buildings (in the labor/P&L but not the lease workbook) — created as
// properties with no units yet, so labor allocates to them. e.g. --extra "Charlotte Square,440 Armstrong"
const extra = String(args.extra || '').split(',').map((s) => s.trim()).filter(Boolean);
const canonical = [...rr.buildings.map((b) => b.name), ...extra];
if (extra.length) console.log(`  (+${extra.length} extra buildings, no units: ${extra.join(', ')})`);
const match = buildMatcher(canonical);
let unitN = 0; rr.buildings.forEach((b) => { unitN += b.units.length; });
console.log(`\nRENT ROLL: ${rr.buildings.length} buildings, ${unitN} units`);
rr.buildings.forEach((b) => console.log(`  ${b.name.padEnd(26)} ${String(b.units.length).padStart(3)} units`));

// labor — daily hours (accurate total + dates) allocated to buildings by the
// dollar-grid weights in each pay log (the "building tags in the comments").
const laborWb = args.labor ? XLSX.read(readFileSync(args.labor), { cellDates: true }) : null;
const rawRows = (sheet) => XLSX.utils.sheet_to_json(laborWb.Sheets[sheet], { header: 1, blankrows: false, defval: null });
const laborSheets = args.labor ? interpretWorkbook(readFileSync(args.labor)).filter((s) => s.looksPayLog && s.entryCount > 0) : [];
const unmatchedLabor = new Set();
const techs = []; const timers = []; const techByName = new Map();
let ti = 0;
for (const s of laborSheets) {
  const name = String(s.techName || 'Operator').trim();
  const sheetRows = rawRows(s.name);
  const rate = (s.entries.find((e) => e.rate)?.rate) || 23;
  let tech = techByName.get(name.toLowerCase());
  if (!tech) { tech = { id: 't_imp_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''), name, rate: rate || 0, role: 'tech', imported: true }; techByName.set(name.toLowerCase(), tech); techs.push(tech); }

  // Dollar-grid pay logs (Gianni-style matrix): the real allocation is the $ grid,
  // not the building name printed by a given day. Allocate per pay period by dollars
  // — hours(building) = $/rate — which reproduces the sheet's own totals box exactly.
  const alloc = allocatePayLogPeriods(sheetRows, match, rate);
  if (alloc.hasGrid) {
    for (const a of alloc.entries) {
      timers.push({ id: `imp_${++ti}`, techId: tech.id, propLabelRaw: a.building, unit: '—', date: a.date,
        category: 'imported', issue: `imported from pay log · $${a.dollars.toFixed(2)}`,
        durationHrs: a.hours, rate, period: null, imported: true });
    }
    alloc.unmatched.forEach((u) => unmatchedLabor.add(u));
  } else {
    // other layouts (columnar, one building per row): keep the daily entries, and
    // fall back to $-grid bin-packing only when a grid exists but wasn't period-shaped.
    const mine = s.entries.map((e) => ({ id: `imp_${++ti}`, techId: tech.id, propLabelRaw: null, unit: e.unit || '—', date: e.date, category: e.category || 'imported', issue: e.note || 'imported from pay log', durationHrs: e.hours || 0, rate: e.rate || 0, period: e.period || null, imported: true }));
    const weights = gridWeights(sheetRows);
    const matchedW = {}; let sumMatched = 0;
    for (const [label, d] of Object.entries(weights)) { const c = match(label); if (c) { matchedW[c] = (matchedW[c] || 0) + d; sumMatched += d; } else unmatchedLabor.add(label); }
    const H = mine.reduce((a, t) => a + t.durationHrs, 0);
    if (sumMatched > 0 && H > 0) {
      const targets = Object.entries(matchedW).map(([b, d]) => ({ b, need: H * (d / sumMatched) })).sort((a, z) => z.need - a.need);
      let bi = 0;
      for (const t of mine) {
        while (bi < targets.length && targets[bi].need <= 0.01) bi++;
        if (bi >= targets.length) break;            // matched weight exhausted → rest stay unallocated
        t.propLabelRaw = targets[bi].b; targets[bi].need -= t.durationHrs;
      }
    }
    timers.push(...mine);
  }
}
const laborHrs = timers.reduce((a, t) => a + (t.durationHrs || 0), 0);
console.log(`\nLABOR: ${techs.length} operators, ${timers.length} entries, ${Math.round(laborHrs * 10) / 10} hrs`);
techs.forEach((t) => { const h = timers.filter((x) => x.techId === t.id).reduce((a, x) => a + x.durationHrs, 0); console.log(`  ${t.name.padEnd(16)} ${Math.round(h * 10) / 10} hrs`); });
const allocH = timers.filter((t) => t.propLabelRaw).reduce((a, t) => a + t.durationHrs, 0);
console.log(`  hours allocated to a building: ${Math.round(allocH)} / ${Math.round(laborHrs)}` + (unmatchedLabor.size ? `   (buildings not in rent roll: ${[...unmatchedLabor].join(', ')})` : ''));

// P&L — pick ONE sheet per building (skip T12/T6/prior-year duplicates: prefer 'PL 2026')
const plRaw = args.pl ? interpretPLWorkbook(readFileSync(args.pl)) : [];
const plByBuilding = new Map();
const unmatchedPL = new Set();
for (const p of plRaw) {
  const canon = match(p.building);
  if (!canon) { unmatchedPL.add(p.building); continue; }
  const cur = plByBuilding.get(canon);
  const score = (/\b2026\b/.test(p.sheet) ? 2 : 0) + (/t12|t6/i.test(p.sheet) ? -1 : 0) + p.months / 100;
  if (!cur || score > cur.score) plByBuilding.set(canon, { ...p, canon, score });
}
const plconfig = {};
for (const [canon, p] of plByBuilding) plconfig[canon] = p.config;
console.log(`\nP&L CONFIG: ${plByBuilding.size} buildings matched`);
for (const [canon, p] of plByBuilding) console.log(`  ${canon.padEnd(26)} ← "${p.sheet}"  (${p.lines} lines)`);
if (unmatchedPL.size) console.log(`  UNMATCHED P&L sheets: ${[...unmatchedPL].join(', ')}`);

if (!COMMIT) {
  console.log('\n(DRY RUN — nothing written. Re-run with --url --key --commit to load.)\n');
  process.exit(0);
}

// ---- commit ----
const { createClient } = await import('@supabase/supabase-js');
const supa = createClient(need('url'), need('key'), { auth: { persistSession: false } });

console.log('\nWriting… (rent roll: replace)');
await supa.from('units').delete().eq('org_id', ORG);
const propId = new Map();
// look up an existing property by exact (case-insensitive) name, tolerating the
// case where duplicates already exist — maybeSingle() throws on >1 row, which is
// what silently grew the dupes every re-run; take the first match instead.
const findProp = async (name) => {
  const { data } = await supa.from('properties').select('id').eq('org_id', ORG).ilike('name', name).limit(1);
  return data?.[0] || null;
};
for (const b of rr.buildings) {
  let p = await findProp(b.name);
  if (!p) ({ data: p } = await supa.from('properties').insert({ org_id: ORG, name: b.name, city: b.city || null, units: b.units.length }).select('id').single());
  propId.set(b.name, p.id);
  let sort = 0;
  for (const u of b.units) {
    const { data: nu } = await supa.from('units').insert({ org_id: ORG, property_id: p.id, building: b.name, name: u.number, beds: u.beds ?? null, unit_type: u.type || 'residential', furnished: !!u.furnished, status: u.status || 'vacant', sort: sort++ }).select('id').single();
    if (nu) await supa.from('leases').insert({ org_id: ORG, unit_id: nu.id, tenant_name: u.tenant || null, tenant_phone: u.phone || null, rent: u.rent ?? null, deposit: u.deposit ?? null, lease_start: u.leaseStart || null, lease_end: u.leaseEnd || null, active: true });
  }
}
// create the extra buildings (no units) so labor can land on them
for (const name of extra) {
  let p = await findProp(name);
  if (!p) ({ data: p } = await supa.from('properties').insert({ org_id: ORG, name, units: 0 }).select('id').single());
  propId.set(name, p.id);
}
// resolve labor propId now that properties exist
for (const t of timers) { const canon = t.propLabelRaw && match(t.propLabelRaw); t.propId = canon ? propId.get(canon) : null; t.propLabel = canon || null; delete t.propLabelRaw; }
const range = timers.length ? { from: timers.reduce((a, t) => t.date && t.date < a ? t.date : a, '9999'), to: timers.reduce((a, t) => t.date && t.date > a ? t.date : a, '0000') } : { from: '2026-01-01', to: '2026-12-31' };
await supa.from('labor_state').upsert({ org_id: ORG, imported: { timers, techs }, props: [], range, plconfig, updated_at: new Date().toISOString() }, { onConflict: 'org_id' });

console.log('\nDONE. Rent roll, labor spine, and P&L config written. Open Round24 as office to verify.\n');
