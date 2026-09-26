// ============================================================
// Round24 document export — timesheets (and any tabular labor view) out to a
// formula-driven .xlsx and a Round24-branded print-to-PDF.
//
// The Excel is "optimized": per-row Pay is a live formula (Hours × Rate), the
// totals are SUMs, and the Summary tab rolls up by building and operator with
// SUMIF against the detail sheet — so the recipient can re-sort, filter, or edit
// hours and every number recomputes. (SheetJS community writes formulas, number
// formats, widths, and merges; cell fills/bold are Pro-only, so the visual brand
// lives in the PDF.)
// ============================================================
import * as XLSX from 'xlsx';

const money = '$#,##0.00';
const hrsFmt = '0.00';

// A1 address for a 0-based row/col
const A1 = (r, c) => XLSX.utils.encode_cell({ r, c });

// two-decimal local date → keep the sheet's own string, but a stable label for headers
function todayLabel() {
  const d = new Date();
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// rows: [{ date, operator, building, unit, category, task, hours, rate }]
// meta: { orgName, rangeLabel }
export function exportTimesheetXlsx(rows, meta = {}) {
  const org = meta.orgName || 'Round24';
  const HEAD = ['Date', 'Operator', 'Building', 'Unit', 'Category', 'Task', 'Hours', 'Rate', 'Pay'];
  const titleRows = [
    ['ROUND24'],
    [`${org} · Timesheet`],
    [`${meta.rangeLabel || 'All logged time'} · Generated ${todayLabel()}`],
    [],
  ];
  const firstDataRow = titleRows.length + 1;       // 1-based row of the first entry (after header)
  const headerRow0 = titleRows.length;             // 0-based row index of the header

  // build the detail sheet as an array-of-arrays, then patch in formulas/formats
  const aoa = [...titleRows, HEAD];
  rows.forEach((r) => aoa.push([
    r.date || '', r.operator || 'Unattributed', r.building || 'Unassigned',
    r.unit || '', r.category || 'general', r.task || '',
    Number(r.hours) || 0, Number(r.rate) || 0, 0, // Pay filled with a formula below
  ]));
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  const n = rows.length;
  const dataStart = headerRow0 + 1;                // 0-based first data row
  const dataEnd = dataStart + n - 1;               // 0-based last data row
  // formula cells MUST carry a cached value `v` — SheetJS drops a formula-only
  // cell on write, and the `v` is what non-recalculating previews (Quick Look,
  // Google, Numbers) display until the recipient edits and Excel recomputes.
  for (let i = 0; i < n; i++) {
    const r0 = dataStart + i, xl = r0 + 1;          // xl = 1-based Excel row
    const h = Number(rows[i].hours) || 0, rt = Number(rows[i].rate) || 0;
    ws[A1(r0, 6)].z = hrsFmt;                        // Hours
    ws[A1(r0, 7)].z = money;                         // Rate
    ws[A1(r0, 8)] = { t: 'n', f: `G${xl}*H${xl}`, v: h * rt, z: money }; // Pay = Hours × Rate
  }
  // totals row
  if (n > 0) {
    const tr0 = dataEnd + 1, s = dataStart + 1, e = dataEnd + 1;
    const totH = rows.reduce((a, r) => a + (Number(r.hours) || 0), 0);
    const totP = rows.reduce((a, r) => a + (Number(r.hours) || 0) * (Number(r.rate) || 0), 0);
    ws[A1(tr0, 5)] = { t: 's', v: 'TOTAL' };
    ws[A1(tr0, 6)] = { t: 'n', f: `SUM(G${s}:G${e})`, v: totH, z: hrsFmt };
    ws[A1(tr0, 8)] = { t: 'n', f: `SUM(I${s}:I${e})`, v: totP, z: money };
    // grow the sheet range to include the totals row
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: tr0, c: 8 } });
  }
  ws['!cols'] = [{ wch: 12 }, { wch: 18 }, { wch: 20 }, { wch: 8 }, { wch: 12 }, { wch: 30 }, { wch: 8 }, { wch: 10 }, { wch: 11 }];
  ws['!merges'] = [0, 1, 2].map((r) => ({ s: { r, c: 0 }, e: { r, c: 8 } }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Timesheet');

  // ---- Summary tab: live SUMIF rollups against the detail sheet ----
  if (n > 0) {
    const gS = `Timesheet!$G$${dataStart + 1}:$G$${dataEnd + 1}`;
    const iS = `Timesheet!$I$${dataStart + 1}:$I$${dataEnd + 1}`;
    // per-building / per-operator cached totals (so the SUMIF cells write + preview)
    const bH = {}, bP = {}, oH = {}, oP = {};
    rows.forEach((r) => {
      const h = Number(r.hours) || 0, p = h * (Number(r.rate) || 0);
      const b = r.building || 'Unassigned', o = r.operator || 'Unattributed';
      bH[b] = (bH[b] || 0) + h; bP[b] = (bP[b] || 0) + p; oH[o] = (oH[o] || 0) + h; oP[o] = (oP[o] || 0) + p;
    });
    const buildings = [...new Set(rows.map((r) => r.building || 'Unassigned'))].sort();
    const operators = [...new Set(rows.map((r) => r.operator || 'Unattributed'))].sort();
    const sum = [['ROUND24'], [`${org} · Timesheet summary`], [`${meta.rangeLabel || 'All logged time'} · Generated ${todayLabel()}`], [], ['By building', 'Hours', 'Pay']];
    buildings.forEach((b) => sum.push([b, 0, 0]));
    sum.push([], ['By operator', 'Hours', 'Pay']);
    operators.forEach((o) => sum.push([o, 0, 0]));
    const sws = XLSX.utils.aoa_to_sheet(sum);
    // patch SUMIF formulas onto the two blocks
    let r0 = 5; // 0-based first building row
    const bCol = `Timesheet!$C$${dataStart + 1}:$C$${dataEnd + 1}`;
    for (const b of buildings) { const xl = r0 + 1; sws[A1(r0, 1)] = { t: 'n', f: `SUMIF(${bCol},A${xl},${gS})`, v: bH[b], z: hrsFmt }; sws[A1(r0, 2)] = { t: 'n', f: `SUMIF(${bCol},A${xl},${iS})`, v: bP[b], z: money }; r0++; }
    r0 += 2; // blank + "By operator" header
    const oCol = `Timesheet!$B$${dataStart + 1}:$B$${dataEnd + 1}`;
    for (const o of operators) { const xl = r0 + 1; sws[A1(r0, 1)] = { t: 'n', f: `SUMIF(${oCol},A${xl},${gS})`, v: oH[o], z: hrsFmt }; sws[A1(r0, 2)] = { t: 'n', f: `SUMIF(${oCol},A${xl},${iS})`, v: oP[o], z: money }; r0++; }
    sws['!cols'] = [{ wch: 24 }, { wch: 10 }, { wch: 12 }];
    sws['!merges'] = [0, 1, 2].map((r) => ({ s: { r, c: 0 }, e: { r, c: 2 } }));
    XLSX.utils.book_append_sheet(wb, sws, 'Summary');
  }

  const safe = (meta.rangeLabel || 'all').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '');
  XLSX.writeFile(wb, `Round24-Timesheet-${safe || 'export'}.xlsx`);
}

// Branded print-to-PDF: open a new window with a Round24-styled report and fire
// the browser's print dialog (Save as PDF). Triggered by a button click so the
// popup isn't blocked.
export function exportTimesheetPdf(rows, meta = {}) {
  const org = meta.orgName || 'Round24';
  const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const money0 = (nn) => '$' + (Number(nn) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const hrs0 = (nn) => (Math.round((Number(nn) || 0) * 100) / 100).toLocaleString('en-US');
  let totH = 0, totP = 0;
  const body = rows.map((r) => {
    const h = Number(r.hours) || 0, p = h * (Number(r.rate) || 0); totH += h; totP += p;
    return `<tr><td>${esc(r.date)}</td><td>${esc(r.operator)}</td><td>${esc(r.building)}</td><td>${esc(r.unit)}</td><td>${esc(r.category)}</td><td class="tsk">${esc(r.task)}</td><td class="n">${hrs0(h)}</td><td class="n">${money0(r.rate)}</td><td class="n">${money0(p)}</td></tr>`;
  }).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Round24 Timesheet</title><style>
    @page{ size:letter; margin:0.55in; }
    :root{ --ink:#16211E; --muted:#586863; --faint:#6b6b6b; --line:#D6DBD2; --tick:#C4CABF; --tick-major:#9FA89E; --accent:#0C9C6B; --accent-ink:#0A7A54; --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace; --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; }
    *{ box-sizing:border-box; } body{ margin:0; font-family:var(--sans); color:var(--ink); font-size:9.5pt; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    header{ display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid var(--ink); padding-bottom:8px; }
    .brand{ font-weight:800; font-size:17pt; letter-spacing:-0.03em; } .brand b{ color:var(--accent); }
    .tag{ font-family:var(--mono); font-size:7pt; letter-spacing:.14em; text-transform:uppercase; color:var(--faint); margin-top:4px; }
    .meta{ text-align:right; font-family:var(--mono); font-size:8pt; color:var(--muted); line-height:1.7; }
    .rule{ height:12px; position:relative; margin:8px 0 12px; }
    .rule::before{ content:""; position:absolute; inset:0; background-image:repeating-linear-gradient(90deg,var(--tick) 0 1px,transparent 1px 9px); background-position:0 60%; background-size:auto 46%; background-repeat:repeat-x; }
    table{ width:100%; border-collapse:collapse; } th,td{ text-align:left; padding:5px 7px; border-bottom:1px solid var(--line); vertical-align:top; }
    thead th{ font-family:var(--mono); font-size:6.8pt; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); border-bottom:1.5px solid var(--tick-major); }
    td.n,th.n{ text-align:right; font-family:var(--mono); } td.tsk{ color:var(--muted); }
    tbody tr:nth-child(even){ background:#0c9c6b08; }
    tfoot td{ font-weight:800; border-top:1.5px solid var(--ink); border-bottom:0; padding-top:7px; } tfoot td.n{ color:var(--accent-ink); }
    footer{ margin-top:14px; font-family:var(--mono); font-size:7pt; color:var(--faint); }
  </style></head><body>
    <header><div><div class="brand">Round<b>24</b></div><div class="tag">Property maintenance, around the clock</div></div>
      <div class="meta"><b>${esc(org)} · Timesheet</b><br>${esc(meta.rangeLabel || 'All logged time')}<br>Generated ${todayLabel()}</div></header>
    <div class="rule"></div>
    <table><thead><tr><th>Date</th><th>Operator</th><th>Building</th><th>Unit</th><th>Category</th><th>Task</th><th class="n">Hours</th><th class="n">Rate</th><th class="n">Pay</th></tr></thead>
      <tbody>${body || '<tr><td colspan="9" style="color:#6b6b6b">No entries in range.</td></tr>'}</tbody>
      <tfoot><tr><td colspan="6">TOTAL · ${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}</td><td class="n">${hrs0(totH)}</td><td></td><td class="n">${money0(totP)}</td></tr></tfoot>
    </table>
    <footer>Round24 · round24.app · Confidential</footer>
  </body></html>`;
  const w = window.open('', '_blank');
  if (!w) return false;                 // popup blocked
  w.document.write(html); w.document.close(); w.focus();
  setTimeout(() => { try { w.print(); } catch { /* user can print manually */ } }, 350);
  return true;
}
