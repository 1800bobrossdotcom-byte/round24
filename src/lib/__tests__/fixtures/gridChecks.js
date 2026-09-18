// Runs one corpus fixture through the real interpreters and lists every way the
// result differs from what the fixture expects (empty list = pass). Shared by
// the vitest layout suite and scripts/import-lab.mjs.
import { interpretWorkbook } from '../../excelInterpret.js';
import { interpretRentRoll } from '../../rentRollInterpret.js';

const r2 = (n) => Math.round(n * 100) / 100;
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

export function checkTimesheet(fx) {
  const sheets = interpretWorkbook(fx.build());
  const X = fx.expect; const bad = [];
  if (X.sheets) {
    for (const [name, want] of Object.entries(X.sheets)) {
      const s = sheets.find((x) => x.name === name);
      if (!s) { bad.push(`sheet ${name} missing`); continue; }
      if (want.entries != null && s.entryCount !== want.entries) bad.push(`${name}: ${s.entryCount} entries, want ${want.entries}`);
      if (want.payLog != null && !!s.looksPayLog !== want.payLog) bad.push(`${name}: looksPayLog=${s.looksPayLog}`);
    }
    return { bad, sheets };
  }
  const s = sheets.find((x) => x.entryCount > 0) || sheets[0];
  const E = s?.entries || [];
  const hours = r2(E.reduce((a, e) => a + (e.hours || 0), 0));
  if (X.layout && s?.layout !== X.layout) bad.push(`layout ${s?.layout}, want ${X.layout}`);
  if (X.entries != null && E.length !== X.entries) bad.push(`${E.length} entries, want ${X.entries}`);
  if (X.hours != null && Math.abs(hours - X.hours) > 0.011) bad.push(`${hours}h, want ${X.hours}h`);
  const names = new Set(E.flatMap((e) => e.buildings || []));
  for (const b of X.buildings || []) if (!names.has(b)) bad.push(`building "${b}" not found (have ${[...names].join(', ') || 'none'})`);
  for (const b of X.notBuildings || []) if (names.has(b)) bad.push(`building "${b}" wrongly allocated`);
  if (X.techs && !same(new Set(E.map((e) => e.tech)), X.techs)) bad.push(`techs ${[...new Set(E.map((e) => e.tech))].join(',')}, want ${X.techs.join(',')}`);
  if (X.dates) {
    const ds = [...new Set(E.map((e) => e.date))].sort();
    if (X.dates.length === ds.length) { if (!same(ds, X.dates)) bad.push(`dates ${ds.join(',')}, want ${X.dates.join(',')}`); }
    else if (ds[0] !== X.dates[0] || ds[ds.length - 1] !== X.dates[1]) bad.push(`date range ${ds[0]}..${ds[ds.length - 1]}, want ${X.dates.join('..')}`);
  }
  if (X.rate != null && !E.every((e) => e.rate === X.rate)) bad.push(`rates ${E.map((e) => e.rate).join(',')}, want ${X.rate}`);
  if (X.pay != null && Math.abs(r2(E.reduce((a, e) => a + (e.pay || 0), 0)) - X.pay) > 0.011) bad.push(`pay ${r2(E.reduce((a, e) => a + (e.pay || 0), 0))}, want ${X.pay}`);
  if (X.units && !same(new Set(E.map((e) => e.unit)), X.units)) bad.push(`units ${E.map((e) => e.unit).join(',')}`);
  if (X.categories && !same(new Set(E.map((e) => e.category)), X.categories)) bad.push(`categories ${E.map((e) => e.category).join(',')}`);
  if (X.weights && JSON.stringify(E[0]?.weights) !== JSON.stringify(X.weights)) bad.push(`weights ${JSON.stringify(E[0]?.weights)}`);
  if (X.grid && !(s?.payLogGrid && s.payLogGrid.length)) bad.push('no dollar grid detected');
  return { bad, sheets, summary: `${s?.layout || '-'} · ${E.length} entries · ${hours}h` };
}

export function checkRentRoll(fx) {
  const res = interpretRentRoll(fx.build());
  const X = fx.expect; const bad = [];
  const units = res.buildings.flatMap((b) => b.units.map((u) => ({ ...u, building: b.name })));
  const by = (n) => units.find((u) => u.number === String(n));
  if (X.units != null && units.length !== X.units) bad.push(`${units.length} units, want ${X.units}`);
  if (X.buildings && !same(res.buildings.map((b) => b.name), X.buildings)) bad.push(`buildings ${res.buildings.map((b) => b.name).join(' | ')}, want ${X.buildings.join(' | ')}`);
  if (X.vacant != null && units.filter((u) => u.status === 'vacant').length !== X.vacant) bad.push(`${units.filter((u) => u.status === 'vacant').length} vacant, want ${X.vacant}`);
  for (const [n, v] of Object.entries(X.leaseStart || {})) if (by(n)?.leaseStart !== v) bad.push(`unit ${n} leaseStart ${by(n)?.leaseStart}, want ${v}`);
  for (const [n, v] of Object.entries(X.leaseEnd || {})) if (by(n)?.leaseEnd !== v) bad.push(`unit ${n} leaseEnd ${by(n)?.leaseEnd}, want ${v}`);
  for (const [n, v] of Object.entries(X.rent || {})) if (by(n)?.rent !== v) bad.push(`unit ${n} rent ${by(n)?.rent}, want ${v}`);
  for (const [n, v] of Object.entries(X.tenants || {})) if (by(n)?.tenant !== v) bad.push(`unit ${n} tenant "${by(n)?.tenant}", want "${v}"`);
  for (const [n, v] of Object.entries(X.beds || {})) if (by(n)?.beds !== v) bad.push(`unit ${n} beds ${by(n)?.beds}, want ${v}`);
  for (const [n, v] of Object.entries(X.types || {})) if (by(n)?.type !== v) bad.push(`unit ${n} type ${by(n)?.type}, want ${v}`);
  if (X.unitNumbers && !same(units.map((u) => u.number), X.unitNumbers)) bad.push(`unit numbers ${units.map((u) => u.number).join(',')}`);
  return { bad, res, summary: `${res.engine} · ${res.buildings.length} bldg · ${units.length} units` };
}

