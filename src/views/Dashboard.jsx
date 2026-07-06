import { useState } from 'react';
import { BarChart, Bar, ResponsiveContainer, XAxis, Tooltip, Cell } from 'recharts';
import { totals, byPeriod, byProp, byTech, fmtMoney, fmtHrs } from '../lib/rollups.js';
import { Stat, Avatar } from '../components/ui.jsx';

const GRAIN = ['week', 'month'];

export default function Dashboard({ store }) {
  const [grain, setGrain] = useState('week');
  const { timers, propById, techById, meta } = store;
  const t = totals(timers);
  const series = byPeriod(timers, grain, 6);
  const props = byProp(timers).sort((a, b) => b.cost - a.cost).slice(0, 6);
  const techs = byTech(timers).sort((a, b) => b.cost - a.cost).slice(0, 5);
  const maxP = Math.max(...props.map((p) => p.cost), 1);

  return (
    <div>
      <div className="view-head">
        <h1>Labor, measured true</h1>
        <p>{meta.org} · every hour allocated to a property and unit</p>
      </div>

      <div className="grid g3" style={{ marginBottom: 'var(--gap)' }}>
        <div className="card"><Stat hero grad k="True labor cost" v={fmtMoney(t.cost)} d={`${fmtHrs(t.hrs)} hrs logged`} /></div>
        <div className="card"><Stat k="Work sessions" v={t.count.toLocaleString()} d="timers closed" /></div>
        <div className="card"><Stat k="Blended rate" v={'$' + (t.cost / t.hrs).toFixed(2)} d="per hour, loaded" /></div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span className="field-label" style={{ margin: 0 }}>Labor cost over time</span>
          <div className="seg">
            {GRAIN.map((g) => (
              <button key={g} className={grain === g ? 'on' : ''} onClick={() => setGrain(g)}>{g}</button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={series} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="label" tick={{ fill: '#63636f', fontSize: 10, fontFamily: 'Space Mono' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <Tooltip cursor={{ fill: '#ffffff08' }} contentStyle={{ background: '#16161c', border: '1px solid #26262f', borderRadius: 10, fontFamily: 'Space Mono', fontSize: 12 }}
              formatter={(v) => [fmtMoney(v), 'labor']} labelStyle={{ color: '#a0a0ad' }} />
            <Bar dataKey="cost" radius={[5, 5, 0, 0]}>
              {series.map((_, i) => <Cell key={i} fill="url(#barGrad)" />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <svg width="0" height="0"><defs>
          <linearGradient id="barGrad" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#ff7a18" stopOpacity=".5" /><stop offset="1" stopColor="#a855f7" stopOpacity=".9" />
          </linearGradient>
        </defs></svg>
      </div>

      <div className="grid g2" style={{ marginTop: 'var(--gap)' }}>
        <div className="card">
          <span className="field-label">Top labor-eating properties</span>
          <table className="tbl">
            <tbody>
              {props.map((p) => (
                <tr key={p.key}>
                  <td className="barcell"><div className="bar" style={{ width: `${(p.cost / maxP) * 100}%` }} />
                    <span className="bar-label" style={{ fontWeight: 700 }}>{propById[p.key]?.name || 'Unallocated (imported)'}</span>
                    <div className="bar-label" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{propById[p.key]?.city || 'needs property tagging'}</div>
                  </td>
                  <td className="num money" style={{ fontWeight: 700 }}>{fmtMoney(p.cost)}<div style={{ color: 'var(--text-dim)', fontWeight: 400, fontSize: 11 }}>{fmtHrs(p.hrs)}h</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <span className="field-label">Labor by operator</span>
          {techs.map((tc, i) => (
            <div className="row" key={tc.key}>
              <Avatar name={techById[tc.key]?.name || '?'} i={i} />
              <div className="lead">
                <div className="t">{techById[tc.key]?.name}</div>
                <div className="s">{fmtHrs(tc.hrs)} hrs · {tc.count} jobs · ${techById[tc.key]?.rate}/hr</div>
              </div>
              <div className="val"><div className="big money">{fmtMoney(tc.cost)}</div></div>
            </div>
          ))}
        </div>
      </div>

      <p className="note">Replaces the tangle of per-tech and per-property pay-log tabs — same numbers, reconciled automatically, allocated the moment a timer closes.</p>
    </div>
  );
}
