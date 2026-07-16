import { useMemo, useState } from 'react';
import { portfolioPnl } from '../lib/pnl.js';
import { IcBuilding, IcChevron } from '../components/ui.jsx';

const money0 = (n) => (n == null ? '—' : (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString());
const nameKey = (s) => (s || '').toLowerCase().trim();

export default function Economics({ store, navigate }) {
  const { leasing = [], allTimers = [], purchases = [], propById = {} } = store;
  const go = navigate || (() => {});
  const [sort, setSort] = useState('noiPerDoor'); // noiPerDoor | costPerDoor | rentBilled | labor

  const { rows, tot, unmatched = [] } = useMemo(
    () => portfolioPnl({ leasing, timers: allTimers, purchases, propById }),
    [leasing, allTimers, purchases, propById],
  );

  const sorted = useMemo(() => {
    const s = [...rows];
    s.sort((a, b) => (b[sort] || 0) - (a[sort] || 0));
    return s;
  }, [rows, sort]);

  const maxOpex = Math.max(...rows.map((r) => r.opex), 1);
  const th = (k, label) => (
    <button className={'lnk' + (sort === k ? ' on' : '')} onClick={() => setSort(k)}
      style={{ background: 'none', border: 'none', color: sort === k ? 'var(--accent)' : 'var(--text-faint)', cursor: 'pointer', font: 'inherit', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase' }}>{label}</button>
  );

  if (rows.length === 0) {
    return (
      <div>
        <div className="view-head"><h1>Per-door P&amp;L</h1><p>Real economics per building — rent in, minus the labor and materials your crew actually logged.</p></div>
        <div className="card"><p className="note">No rent roll yet. Add units in the Portfolio, and log labor + receipts against buildings — this fills in automatically.</p></div>
      </div>
    );
  }

  return (
    <div>
      <div className="view-head">
        <h1>Per-door P&amp;L</h1>
        <p>Every building's real bottom line: rent in, minus the <b>verified labor</b> and materials logged against it. The one number nobody else can produce — because nobody else measures the labor.</p>
      </div>

      {/* portfolio KPIs */}
      <div className="rr-kpis">
        <div className="kpi-c"><span className="v mono">{tot.units}</span><span className="k">doors</span></div>
        <div className="kpi-c"><span className="v mono">{money0(tot.rentBilled)}</span><span className="k">rent / mo</span></div>
        <div className="kpi-c"><span className="v mono" style={{ color: 'var(--danger)' }}>{money0(tot.opex)}</span><span className="k">labor + materials</span></div>
        <div className="kpi-c"><span className="v mono" style={{ color: 'var(--money)' }}>{money0(tot.noi)}</span><span className="k">net / mo (est.)</span></div>
        <div className="kpi-c"><span className="v mono">{money0(tot.costPerDoor)}</span><span className="k">avg cost / door</span></div>
        {tot.verifiedPct != null && (
          <div className="kpi-c"><span className="v mono" style={{ color: tot.verifiedPct >= 80 ? 'var(--money)' : 'var(--warn)' }}>{tot.verifiedPct}%</span><span className="k">labor verified on-site</span></div>
        )}
      </div>

      <p className="note" style={{ margin: '2px 2px 14px' }}>Rent is monthly; labor + materials are the maintenance spend captured to date. Net is illustrative — it shows how measured labor flows to per-door economics.</p>

      {unmatched.length > 0 && (
        <div className="card" style={{ marginBottom: 'var(--gap)', borderColor: 'color-mix(in srgb, var(--warn) 45%, var(--line))' }}>
          <span className="field-label" style={{ color: 'var(--warn)', display: 'block' }}>⚠ Labor logged to buildings not on the rent roll</span>
          <p className="note" style={{ margin: '4px 0 8px' }}>These names carry {money0(unmatched.reduce((a, u) => a + u.opex, 0))} of measured cost that’s in your totals but has <b>no per-door P&amp;L</b> — usually a spelling drift between the timer/receipt and the rent roll. Rename to match a building on the roll to reconcile it.</p>
          {unmatched.map((u) => (
            <div key={u.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0' }}>
              <span style={{ color: 'var(--text-dim)' }}>{u.name}</span>
              <span className="mono">{money0(u.opex)}</span>
            </div>
          ))}
        </div>
      )}

      {/* per-building */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="field-label" style={{ margin: 0 }}>Sort by</span>
          {th('noiPerDoor', 'Net / door')}{th('costPerDoor', 'Cost / door')}{th('rentBilled', 'Rent')}{th('labor', 'Labor')}
        </div>
        <div className="rr-scroll">
          <table className="rr-tbl">
            <thead><tr>
              <th>Building</th><th className="num">Doors</th><th className="num">Rent / mo</th>
              <th className="num">Labor</th><th className="num">Materials</th>
              <th className="num">Cost / door</th><th className="num">Net / door</th><th aria-label="open"></th>
            </tr></thead>
            <tbody>
              {sorted.map((b) => (
                <tr key={b.name} className="rr-link" onClick={() => go('props', { building: b.name })}>
                  <td>
                    <span className="ustripe" style={{ background: b.noi >= 0 ? 'var(--money)' : 'var(--danger)' }} />
                    <b>{b.name}</b>
                    <span className="rr-occbar" style={{ marginLeft: 8, verticalAlign: 'middle', display: 'inline-block', width: 46 }} title={`${b.occPct}% leased`}>
                      <span style={{ width: b.occPct + '%', background: b.occPct >= 90 ? 'var(--money)' : b.occPct >= 75 ? 'var(--warn)' : 'var(--danger)' }} />
                    </span>
                  </td>
                  <td className="num mono">{b.units}</td>
                  <td className="num mono">{money0(b.rentBilled)}</td>
                  <td className="num mono" style={{ color: b.labor ? 'var(--text)' : 'var(--text-faint)' }}>{b.labor ? money0(b.labor) : '—'}</td>
                  <td className="num mono" style={{ color: b.materials ? 'var(--text)' : 'var(--text-faint)' }}>{b.materials ? money0(b.materials) : '—'}</td>
                  <td className="num mono">{money0(b.costPerDoor)}</td>
                  <td className="num mono" style={{ color: b.noiPerDoor >= 0 ? 'var(--money)' : 'var(--danger)', fontWeight: 700 }}>{money0(b.noiPerDoor)}</td>
                  <td className="num"><IcChevron width={13} height={13} style={{ color: 'var(--text-faint)' }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* spend-per-door bars */}
      <div className="card" style={{ marginTop: 'var(--gap)' }}>
        <span className="field-label"><IcBuilding width={13} height={13} style={{ verticalAlign: -2 }} /> Maintenance spend by building</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {sorted.map((b) => (
            <div key={b.name} style={{ display: 'grid', gridTemplateColumns: '150px 1fr auto', gap: 10, alignItems: 'center', cursor: 'pointer' }} onClick={() => go('props', { building: b.name })}>
              <span style={{ fontSize: 13, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
              <span className="rr-occbar" style={{ height: 10 }}><span style={{ width: Math.max(2, (b.opex / maxOpex) * 100) + '%', background: 'var(--accent)' }} /></span>
              <span className="mono" style={{ fontSize: 12, minWidth: 64, textAlign: 'right' }}>{money0(b.opex)}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="note">Labor comes straight from the crew's verified timers; materials from approved receipts. Change a rate or log a job and every door's P&amp;L moves — the connected ledger, end to end.</p>
    </div>
  );
}
