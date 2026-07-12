#!/usr/bin/env node
// ============================================================
// One-shot bulk import: port the Evolution24 Excel workbooks into a live Caliper
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
// blobs). Caliper reads these dual-mode; the next in-app save re-encrypts them.
// ============================================================

import { readFileSync } from 'fs';
import { interpretRentRoll } from '../src/lib/rentRollInterpret.js';
import { interpretWorkbook } from '../src/lib/excelInterpret.js';
import { interpretPLWorkbook } from '../src/lib/plSheetInterpret.js';

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
console.log(`\n=== Caliper bulk import  (org ${ORG})  ${COMMIT ? '*** COMMIT ***' : 'DRY RUN'} ===`);

const rr = interpretRentRoll(readFileSync(need('leases')));
const canonical = rr.buildings.map((b) => b.name);
const match = buildMatcher(canonical);
let unitN = 0; rr.buildings.forEach((b) => { unitN += b.units.length; });
console.log(`\nRENT ROLL: ${rr.buildings.length} buildings, ${unitN} units`);
rr.buildings.forEach((b) => console.log(`  ${b.name.padEnd(26)} ${String(b.units.length).padStart(3)} units`));

// labor
const laborSheets = args.labor ? interpretWorkbook(readFileSync(args.labor)).filter((s) => s.looksPayLog && s.entryCount > 0) : [];
const unmatchedLabor = new Set();
const techs = []; const timers = []; const techByName = new Map();
let ti = 0;
for (const s of laborSheets) {
  const name = String(s.techName || 'Operator').trim();
  let tech = techByName.get(name.toLowerCase());
  if (!tech) { tech = { id: 't_imp_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''), name, rate: 0, role: 'tech', imported: true }; techByName.set(name.toLowerCase(), tech); techs.push(tech); }
  for (const e of s.entries) {
    const bldg = (e.building || (e.buildings && e.buildings[0]) || '').trim();
    const canon = bldg ? match(bldg) : null;
    if (bldg && !canon) unmatchedLabor.add(bldg);
    timers.push({ id: `imp_${++ti}`, techId: tech.id, propLabelRaw: canon || bldg || null, unit: e.unit || '—', date: e.date, category: e.category || 'imported', issue: e.note || 'imported from pay log', durationHrs: e.hours || 0, rate: e.rate || 0, period: e.period || null, imported: true });
  }
}
const laborHrs = timers.reduce((a, t) => a + (t.durationHrs || 0), 0);
console.log(`\nLABOR: ${techs.length} operators, ${timers.length} entries, ${Math.round(laborHrs * 10) / 10} hrs`);
techs.forEach((t) => { const h = timers.filter((x) => x.techId === t.id).reduce((a, x) => a + x.durationHrs, 0); console.log(`  ${t.name.padEnd(16)} ${Math.round(h * 10) / 10} hrs`); });
const allocN = timers.filter((t) => t.propLabelRaw && match(t.propLabelRaw)).length;
console.log(`  allocated to a building: ${allocN} / ${timers.length}` + (unmatchedLabor.size ? `   UNMATCHED buildings: ${[...unmatchedLabor].join(', ')}` : ''));

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
for (const b of rr.buildings) {
  let { data: p } = await supa.from('properties').select('id').eq('org_id', ORG).ilike('name', b.name).limit(1).maybeSingle();
  if (!p) ({ data: p } = await supa.from('properties').insert({ org_id: ORG, name: b.name, city: b.city || null, units: b.units.length }).select('id').single());
  propId.set(b.name, p.id);
  let sort = 0;
  for (const u of b.units) {
    const { data: nu } = await supa.from('units').insert({ org_id: ORG, property_id: p.id, building: b.name, name: u.number, beds: u.beds ?? null, unit_type: u.type || 'residential', furnished: !!u.furnished, status: u.status || 'vacant', sort: sort++ }).select('id').single();
    if (nu) await supa.from('leases').insert({ org_id: ORG, unit_id: nu.id, tenant_name: u.tenant || null, tenant_phone: u.phone || null, rent: u.rent ?? null, deposit: u.deposit ?? null, lease_start: u.leaseStart || null, lease_end: u.leaseEnd || null, active: true });
  }
}
// resolve labor propId now that properties exist
for (const t of timers) { const canon = t.propLabelRaw && match(t.propLabelRaw); t.propId = canon ? propId.get(canon) : null; t.propLabel = canon || null; delete t.propLabelRaw; }
const range = timers.length ? { from: timers.reduce((a, t) => t.date && t.date < a ? t.date : a, '9999'), to: timers.reduce((a, t) => t.date && t.date > a ? t.date : a, '0000') } : { from: '2026-01-01', to: '2026-12-31' };
await supa.from('labor_state').upsert({ org_id: ORG, imported: { timers, techs }, props: [], range, plconfig, updated_at: new Date().toISOString() }, { onConflict: 'org_id' });

console.log('\nDONE. Rent roll, labor spine, and P&L config written. Open Caliper as office to verify.\n');
