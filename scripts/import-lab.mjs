#!/usr/bin/env node
// Import lab — see exactly what Caliper reads out of a spreadsheet.
//
//   node scripts/import-lab.mjs                 run the built-in layout corpus (pass/fail)
//   node scripts/import-lab.mjs path/to/file.xlsx [--rentroll]   interpret a real file
//
// Nothing is uploaded anywhere; this is the same code the browser runs.
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { interpretWorkbook } from '../src/lib/excelInterpret.js';
import { interpretRentRoll } from '../src/lib/rentRollInterpret.js';
import { TIMESHEETS, RENT_ROLLS } from '../src/lib/__tests__/fixtures/gridLayouts.js';
import { checkTimesheet, checkRentRoll } from '../src/lib/__tests__/fixtures/gridChecks.js';

const r2 = (n) => Math.round(n * 100) / 100;

function runCorpus() {
  let fails = 0;
  console.log('\n== Timesheets ==');
  for (const fx of TIMESHEETS) {
    let r; try { r = checkTimesheet(fx); } catch (e) { r = { bad: [`threw: ${e.message}`], summary: '' }; }
    const ok = r.bad.length === 0; if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${fx.id.padEnd(32)} ${r.summary || ''}`);
    for (const b of r.bad) console.log(`        - ${b}`);
  }
  console.log('\n== Rent rolls ==');
  for (const fx of RENT_ROLLS) {
    let r; try { r = checkRentRoll(fx); } catch (e) { r = { bad: [`threw: ${e.message}`], summary: '' }; }
    const ok = r.bad.length === 0; if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${fx.id.padEnd(32)} ${r.summary || ''}`);
    for (const b of r.bad) console.log(`        - ${b}`);
  }
  console.log(`\n${TIMESHEETS.length + RENT_ROLLS.length - fails} passed, ${fails} failed\n`);
  process.exitCode = fails ? 1 : 0;
}

function describeFile(path, rentroll) {
  const buf = readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  if (rentroll) {
    const res = interpretRentRoll(ab);
    console.log(`engine ${res.engine} · ${res.buildingCount} buildings · ${res.units} units`);
    for (const b of res.buildings) {
      console.log(`\n${b.name} (${b.units.length} units)`);
      for (const u of b.units.slice(0, 12)) console.log(`  ${String(u.number).padEnd(8)} ${(u.tenant || '—').padEnd(22)} ${u.status.padEnd(7)} rent ${u.rent ?? '—'}  ${u.leaseStart || ''}${u.leaseEnd ? ' → ' + u.leaseEnd : ''}`);
      if (b.units.length > 12) console.log(`  … ${b.units.length - 12} more`);
    }
    return;
  }
  const wb = XLSX.read(ab, { cellDates: true });
  for (const s of interpretWorkbook(ab)) {
    const E = s.entries; const dates = E.map((e) => e.date).sort();
    const bl = new Map(); for (const e of E) for (const b of e.buildings || []) bl.set(b, (bl.get(b) || 0) + 1);
    console.log(`\n▸ ${s.name}  →  ${s.layout} · ${s.looksPayLog ? 'pay log' : 'not a pay log?'} · tech "${s.techName}"`);
    console.log(`  ${E.length} entries · ${r2(s.totalHours)}h · $${r2(s.totalPay)} · ${dates[0] || '—'} … ${dates[dates.length - 1] || '—'}${s.payLogGrid ? ` · dollar grid: ${s.payLogGrid.length} allocations` : ''}`);
    if (bl.size) console.log(`  buildings: ${[...bl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([b, n]) => `${b} (${n})`).join(', ')}`);
    const flagged = E.filter((e) => e.flag).length; if (flagged) console.log(`  ${flagged} entries flagged (${[...new Set(E.filter((e) => e.flag).map((e) => e.flag))].join(', ')})`);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[s.name], { header: 1, blankrows: false });
    console.log('  first rows:'); for (const r of rows.slice(0, 6)) console.log('   ', JSON.stringify(r).slice(0, 140));
  }
}

const args = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!args.length) runCorpus();
  else describeFile(args.find((a) => !a.startsWith('--')), args.includes('--rentroll'));
}
