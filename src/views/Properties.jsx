import { useState } from 'react';
import { byProp, byUnit, byCategory, totals, fmtMoney, fmtHrs } from '../lib/rollups.js';
import { IcChevron } from '../components/ui.jsx';

export default function Properties({ store }) {
  const { timers, properties, propById } = store;
  const [sel, setSel] = useState(null);
  const rows = byProp(timers).sort((a, b) => b.cost - a.cost);
  const max = Math.max(...rows.map((r) => r.cost), 1);

  if (sel) {
    const pt = timers.filter((t) => t.propId === sel);
    const t = totals(pt);
    const units = byUnit(pt).sort((a, b) => b.cost - a.cost);
    const cats = byCategory(pt).sort((a, b) => b.cost - a.cost);
    const p = propById[sel];
    const umax = Math.max(...units.map((u) => u.cost), 1);
    return (
      <div>
        <button className="btn ghost sm" onClick={() => setSel(null)} style={{ marginBottom: 14 }}><IcChevron width={14} height={14} style={{ transform: 'rotate(180deg)' }} /> All properties</button>
        <div className="view-head"><h1>{p.name}</h1><p>{p.city} · {p.units} units</p></div>
        <div className="grid g3" style={{ marginBottom: 'var(--gap)' }}>
          <div className="card"><div className="stat"><span className="k">Labor cost</span><span className="v mono grad-text settle sm">{fmtMoney(t.cost)}</span></div></div>
          <div className="card"><div className="stat"><span className="k">Hours</span><span className="v mono sm">{fmtHrs(t.hrs)}</span></div></div>
          <div className="card"><div className="stat"><span className="k">Jobs</span><span className="v mono sm">{t.count}</span></div></div>
        </div>
        <div className="grid g2">
          <div className="card">
            <span className="field-label">Labor by unit</span>
            <table className="tbl"><tbody>
              {units.map((u) => (
                <tr key={u.key}>
                  <td className="barcell"><div className="bar" style={{ width: `${(u.cost / umax) * 100}%` }} />
                    <span className="bar-label" style={{ fontWeight: 700 }}>Unit {u.key.split('|')[1]}</span></td>
                  <td className="num">{fmtHrs(u.hrs)}h</td>
                  <td className="num money" style={{ fontWeight: 700 }}>{fmtMoney(u.cost)}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
          <div className="card">
            <span className="field-label">By work category</span>
            <table className="tbl"><tbody>
              {cats.map((c) => (
                <tr key={c.key}><td style={{ fontWeight: 700, textTransform: 'capitalize' }}>{c.key}</td>
                  <td className="num">{c.count}</td><td className="num">{fmtHrs(c.hrs)}h</td>
                  <td className="num money" style={{ fontWeight: 700 }}>{fmtMoney(c.cost)}</td></tr>
              ))}
            </tbody></table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="view-head"><h1>Properties</h1><p>Labor cost per building — tap to drill into units</p></div>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Property</th><th className="num">Jobs</th><th className="num">Hours</th><th className="num">Labor cost</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} onClick={() => setSel(r.key)} style={{ cursor: 'pointer' }}>
                <td className="barcell"><div className="bar" style={{ width: `${(r.cost / max) * 100}%` }} />
                  <span className="bar-label" style={{ fontWeight: 700 }}>{propById[r.key]?.name || '—'}</span>
                  <div className="bar-label" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{propById[r.key]?.city || ''}</div></td>
                <td className="num">{r.count}</td>
                <td className="num">{fmtHrs(r.hrs)}</td>
                <td className="num money" style={{ fontWeight: 700 }}>{fmtMoney(r.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">This is the allocation Gianni does by hand in the pay-log grid — splitting hours across 379 S.Main, Water St, St.Paul, Armstrong — except here it reconciles automatically instead of drifting into "overpay" and negative balances.</p>
    </div>
  );
}
