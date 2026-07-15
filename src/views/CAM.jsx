import { useMemo, useState } from 'react';
import { camReconcile, camBuildings } from '../lib/cam.js';
import { IcBuilding } from '../components/ui.jsx';

const money0 = (n) => (n == null ? '—' : (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString());
const pct1 = (n) => (n == null ? '—' : n.toFixed(1) + '%');
const sf = (n) => (n ? Number(n).toLocaleString() + ' sf' : '—');

// Caliper Enterprise — CAM reconciliation. Allocates a building's MEASURED
// operating cost (labor + materials) pro-rata by rentable SF across its
// commercial tenants, then trues it up against the CAM each was billed.
export default function CAM({ store }) {
  const { leasing = [], allTimers = [], purchases = [], propById = {} } = store;

  const buildings = useMemo(() => camBuildings(leasing), [leasing]);
  const [building, setBuilding] = useState(() => buildings[0] || '');
  const [months, setMonths] = useState(12);

  const active = buildings.includes(building) ? building : buildings[0] || '';
  const r = useMemo(
    () => (active ? camReconcile({ building: active, leasing, timers: allTimers, purchases, propById, months }) : null),
    [active, leasing, allTimers, purchases, propById, months],
  );

  if (buildings.length === 0) {
    return (
      <div>
        <div className="view-head"><h1>CAM reconciliation</h1><p>Allocate a building's measured operating cost across its commercial tenants — pro-rata, auditable, defensible.</p></div>
        <div className="card"><p className="note">No commercial buildings yet. Mark a suite as <b>commercial</b> (or add a CAM charge to its lease) in the rent roll, and this fills in automatically — the recoverable pool is the same measured labor and materials your per-door P&amp;L already tracks.</p></div>
      </div>
    );
  }

  const seg = (val, label) => (
    <button onClick={() => setMonths(val)} className={months === val ? 'on' : ''}
      style={{ background: months === val ? 'var(--accent)' : 'transparent', color: months === val ? '#fff' : 'var(--text-dim)', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 12px', font: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{label}</button>
  );

  return (
    <div>
      <div className="view-head no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1>CAM reconciliation</h1>
          <p>Every tenant's share of the building's <b>measured</b> operating cost — labor from the crew's verified timers, materials from approved receipts. The one CAM statement nobody can argue with.</p>
        </div>
        <button className="btn ghost no-print" onClick={() => window.print()} style={{ width: 'auto', whiteSpace: 'nowrap' }}>Print statement</button>
      </div>

      {/* building + period controls */}
      <div className="card no-print" style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <div className="field-label">Building</div>
          <select value={active} onChange={(e) => setBuilding(e.target.value)}
            style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 15, padding: 10, borderRadius: 10 }}>
            {buildings.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div>
          <div className="field-label">Reconciliation period</div>
          <div style={{ display: 'flex', gap: 8 }}>{seg(12, 'Annual')}{seg(6, 'Half-year')}{seg(3, 'Quarter')}</div>
        </div>
      </div>

      {/* the recoverable pool — measured, = the building's P&L opex */}
      <div className="print-title" style={{ display: 'none' }}>CAM reconciliation — {active} · {months}-month period</div>
      <div className="rr-kpis">
        <div className="kpi-c"><span className="v mono">{money0(r.pool.total)}</span><span className="k">recoverable pool</span></div>
        <div className="kpi-c"><span className="v mono">{money0(r.pool.labor)}</span><span className="k">measured labor</span></div>
        <div className="kpi-c"><span className="v mono">{money0(r.pool.materials)}</span><span className="k">materials</span></div>
        <div className="kpi-c"><span className="v mono">{r.totalSqft ? sf(r.totalSqft) : r.unitCount}</span><span className="k">{r.totalSqft ? 'rentable area' : 'suites'}</span></div>
        <div className="kpi-c"><span className="v mono" style={{ color: r.totalDelta >= 0 ? 'var(--money)' : 'var(--warn)' }}>{money0(r.totalDelta)}</span><span className="k">net trued up</span></div>
      </div>

      {r.basis === 'equal' && (
        <p className="note" style={{ color: 'var(--warn)', margin: '2px 2px 12px' }}>No rentable SF on these suites yet — shares are split evenly. Add each suite's square footage to the rent roll for exact, area-based CAM shares.</p>
      )}

      {/* per-tenant reconciliation */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="rr-scroll">
          <table className="rr-tbl">
            <thead><tr>
              <th>Suite</th><th>Tenant</th><th className="num">Rentable</th><th className="num">Share</th>
              <th className="num">CAM billed</th><th className="num">Measured share</th><th className="num">Reconciliation</th>
            </tr></thead>
            <tbody>
              {r.tenants.map((t) => (
                <tr key={t.unit}>
                  <td><b>{t.unit}</b></td>
                  <td>{t.tenant}</td>
                  <td className="num mono">{sf(t.sqft)}</td>
                  <td className="num mono">{pct1(t.sharePct)}</td>
                  <td className="num mono">{money0(t.billed)}</td>
                  <td className="num mono">{money0(t.allocated)}</td>
                  <td className="num mono" style={{ color: Math.round(t.delta) === 0 ? 'var(--text-faint)' : t.delta > 0 ? 'var(--money)' : 'var(--warn)', fontWeight: 700 }}>
                    {Math.round(t.delta) === 0 ? 'even' : (t.delta > 0 ? 'owes ' : 'credit ') + money0(Math.abs(t.delta))}
                  </td>
                </tr>
              ))}
              {r.vacant.map((v) => (
                <tr key={v.unit} style={{ color: 'var(--text-faint)' }}>
                  <td><b>{v.unit}</b></td>
                  <td><i>vacant — landlord absorbs</i></td>
                  <td className="num mono">{sf(v.sqft)}</td>
                  <td className="num mono">{pct1(v.sharePct)}</td>
                  <td className="num mono">—</td>
                  <td className="num mono">{money0(v.allocated)}</td>
                  <td className="num mono">—</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--line)', fontWeight: 700 }}>
                <td colSpan={4}>Recovered from tenants</td>
                <td className="num mono">{money0(r.totalBilled)}</td>
                <td className="num mono">{money0(r.allocatedToTenants)}</td>
                <td className="num mono" style={{ color: r.totalDelta >= 0 ? 'var(--money)' : 'var(--warn)' }}>{money0(r.totalDelta)}</td>
              </tr>
              {Math.round(r.landlordAbsorbed) !== 0 && (
                <tr style={{ color: 'var(--text-faint)' }}>
                  <td colSpan={5}>Landlord absorbed (vacancy share)</td>
                  <td className="num mono">{money0(r.landlordAbsorbed)}</td>
                  <td></td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      </div>

      <p className="note">Shares are pro-rata by rentable square footage. The pool is the building's <b>measured</b> operating cost — the same labor and materials the per-door P&amp;L reconciles — so the number is auditable to the timer and the receipt. Vacant space is absorbed by the owner, not pushed onto tenants.</p>
    </div>
  );
}
