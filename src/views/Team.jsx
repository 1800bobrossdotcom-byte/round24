import { useState, useEffect, useRef } from 'react';
import { byTech, byPeriod, totals, fmtMoney, fmtHrs, periodKey } from '../lib/rollups.js';
import { Avatar } from '../components/ui.jsx';

const GRAINS = ['day', 'week', 'month', 'year'];

export default function Team({ store, focus }) {
  const { timers, techById, techs } = store;
  const [grain, setGrain] = useState('week');
  const [hl, setHl] = useState(null); // operator highlighted from a drill-down
  const cardRefs = useRef({});
  const rows = byTech(timers).sort((a, b) => b.cost - a.cost);

  // opening from a Dashboard drill-down: scroll to the operator and flash it
  useEffect(() => {
    const id = focus?.operatorId;
    if (!id) return;
    setHl(id);
    const el = cardRefs.current[id];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(() => setHl(null), 2400);
    return () => clearTimeout(t);
  }, [focus]);

  return (
    <div>
      <div className="view-head"><h1>Team</h1><p>Hours &amp; labor cost per operator</p></div>

      <div className="rangebar">
        <span className="lbl">Totals by</span>
        <div className="seg">
          {GRAINS.map((g) => <button key={g} className={grain === g ? 'on' : ''} onClick={() => setGrain(g)}>{g}</button>)}
        </div>
        <span className="lbl" style={{ marginLeft: 'auto' }}>week starts Saturday · matches your pay period</span>
      </div>

      {rows.map((r, i) => {
        const tt = timers.filter((t) => t.techId === r.key);
        const periods = byPeriod(tt, grain, 6);
        const t = totals(tt);
        const tech = techById[r.key] || { name: 'Unknown operator', role: 'tech', rate: 0 };
        const maxc = Math.max(...periods.map((p) => p.cost), 1);
        return (
          <div className="card" key={r.key} ref={(el) => { cardRefs.current[r.key] = el; }}
            style={{ marginBottom: 'var(--gap)', transition: 'border-color .3s, box-shadow .3s',
              ...(hl === r.key ? { borderColor: 'var(--accent, #a855f7)', boxShadow: '0 0 0 1px var(--accent, #a855f7)' } : null) }}>
            <div className="row" style={{ paddingTop: 0 }}>
              <Avatar name={tech.name} i={i} />
              <div className="lead"><div className="t">{tech.name}</div><div className="s" style={{ textTransform: 'capitalize' }}>{tech.role} · ${tech.rate}/hr</div></div>
              <div className="val"><div className="big money">{fmtMoney(t.cost)}</div><div className="small">{fmtHrs(t.hrs)} hrs · {t.count} jobs</div></div>
            </div>
            <hr className="hr" />
            <table className="tbl">
              <thead><tr><th>{grain[0].toUpperCase() + grain.slice(1)}</th><th className="num">Jobs</th><th className="num">Hours</th><th className="num">Labor cost</th></tr></thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.key}>
                    <td className="barcell"><div className="bar" style={{ width: `${(p.cost / maxc) * 100}%` }} />
                      <span className="bar-label mono" style={{ fontSize: 12 }}>{p.label}</span></td>
                    <td className="num">{p.count}</td>
                    <td className="num">{fmtHrs(p.hrs)}</td>
                    <td className="num money" style={{ fontWeight: 700 }}>{fmtMoney(p.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      <p className="note">Every operator's tab in one place — daily through yearly, no per-person spreadsheet, no "PAID BY BRENT" reconciliation notes. Export to payroll is one tap (coming in the build).</p>
    </div>
  );
}
