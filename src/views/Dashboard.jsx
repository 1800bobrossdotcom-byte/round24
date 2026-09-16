import { useState, useMemo } from 'react';
import { BarChart, Bar, ResponsiveContainer, XAxis, Tooltip, Cell, PieChart, Pie } from 'recharts';
import { totals, byPeriod, byProp, byTech, fmtMoney, fmtHrs } from '../lib/rollups.js';
import { Stat, Avatar, IcBuilding, IcChevron } from '../components/ui.jsx';
import AllocateModal from '../components/AllocateModal.jsx';

const GRAIN = ['week', 'month'];

export default function Dashboard({ store, navigate }) {
  const [grain, setGrain] = useState('week');
  const [showUnalloc, setShowUnalloc] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [allocOpen, setAllocOpen] = useState(false);
  const { timers, propById, techById, meta } = store;
  const go = navigate || (() => {}); // drill-down navigation (no-op if absent)
  const lease = store.leasing || [];
  const port = useMemo(() => {
    // land parcels aren't rentable doors — same exclusion the rent roll and per-door P&L apply
    const rentable = lease.filter((u) => !(u.type === 'land' || u.status === 'held'));
    const occ = rentable.filter((u) => u.status === 'leased');
    return { units: rentable.length, occ: occ.length, occPct: rentable.length ? Math.round((occ.length / rentable.length) * 100) : 0, billed: occ.reduce((a, u) => a + (u.rent || 0), 0) };
  }, [lease]);

  const seed = async () => {
    setSeeding(true);
    try { await store.loadSampleData(); } finally { setSeeding(false); }
  };

  // dominant pipeline = ALLOCATED work only. Unallocated stays distinct and
  // out of the true-cost numbers unless the user toggles it in.
  const allocated = useMemo(() => timers.filter((t) => t.propId), [timers]);
  const unalloc = useMemo(() => timers.filter((t) => !t.propId), [timers]);
  const un = totals(unalloc);
  const allocCost = useMemo(() => totals(allocated).cost, [allocated]);
  const splitData = [
    { name: 'Allocated', value: Math.round(allocCost), fill: 'var(--money)' },
    { name: 'Unallocated', value: Math.round(un.cost), fill: 'var(--warn)' },
  ];
  const view = showUnalloc ? timers : allocated;

  const t = totals(view);
  const series = byPeriod(view, grain, 6);
  const props = byProp(allocated).sort((a, b) => b.cost - a.cost).slice(0, 6);
  const techs = byTech(view).sort((a, b) => b.cost - a.cost).slice(0, 5);
  const maxP = Math.max(...props.map((p) => p.cost), 1);
  const blended = t.hrs > 0 ? '$' + (t.cost / t.hrs).toFixed(2) : '$0.00';

  if (timers.length === 0) {
    return (
      <div>
        <div className="view-head">
          <h1>Labor, measured true</h1>
          <p>{meta.org} · every hour allocated to a property and unit</p>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 6 }}>No labor data yet</div>
          <p className="note" style={{ margin: '0 auto 18px', maxWidth: 380 }}>
            Import your pay logs from the <b>Import</b> tab to see true cost per building, or log time in the <b>Field</b> tab. Everything you add shows up here.
          </p>
          <button className="btn grad" style={{ maxWidth: 320, margin: '0 auto' }} onClick={seed} disabled={seeding}>
            {seeding ? 'Filling…' : 'Load sample data'}
          </button>
          <p className="note" style={{ margin: '10px auto 0', maxWidth: 380 }}>
            Populates the whole app with a realistic Evolution24 portfolio — labor, team, orders and purchases — so you can explore it live. Clear it anytime from the Import tab.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="view-head">
        <h1>Labor, measured true</h1>
        <p>{meta.org} · every hour allocated to a property and unit</p>
      </div>

      <div className="card" style={{ marginBottom: 'var(--gap)' }}>
        <Stat hero grad k="True labor cost" v={fmtMoney(t.cost)} d={`${fmtHrs(t.hrs)} hrs logged`} />
      </div>
      <div className="grid g2" style={{ marginBottom: 'var(--gap)' }}>
        <div className="card"><Stat k="Work sessions" v={t.count.toLocaleString()} d="timers closed" /></div>
        <div className="card"><Stat k="Blended rate" v={blended} d="per hour, loaded" /></div>
      </div>

      {lease.length > 0 && (
        <div className="card clk-card" onClick={() => go('leasing')} role="button" tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && go('leasing')}
          style={{ marginBottom: 'var(--gap)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span className="field-label" style={{ margin: 0 }}><IcBuilding width={12} height={12} style={{ verticalAlign: -2 }} /> Portfolio revenue</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 4, flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontSize: 24, fontWeight: 700, color: 'var(--money)' }}>{fmtMoney(port.billed)}</span>
              <span style={{ color: 'var(--text-dim)', fontSize: 13, fontWeight: 700 }}>/mo billed · {port.occPct}% of {port.units} units leased</span>
            </div>
          </div>
          <span style={{ color: 'var(--text-faint)', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none' }}>Rent roll <IcChevron width={13} height={13} /></span>
        </div>
      )}

      {un.count > 0 && (
        <div className="card" style={{ marginBottom: 'var(--gap)', borderColor: '#ffb02033', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ width: 96, height: 96, flex: 'none', position: 'relative' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={splitData} dataKey="value" innerRadius={30} outerRadius={46} paddingAngle={2} stroke="none" startAngle={90} endAngle={-270} />
                <Tooltip contentStyle={{ background: '#16161c', border: '1px solid #26262f', borderRadius: 10, fontFamily: 'Space Mono', fontSize: 12 }}
                  formatter={(v, n) => [fmtMoney(v), n]} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--warn)' }}>{Math.round((un.cost / (un.cost + allocCost || 1)) * 100)}%</span>
              <span style={{ fontSize: 8, color: 'var(--text-faint)', letterSpacing: '.05em' }}>UNALLOC</span>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="mono" style={{ fontSize: 22, fontWeight: 700, color: 'var(--warn)' }}>{fmtMoney(un.cost)}</span>
              <span style={{ color: 'var(--text-dim)', fontSize: 12, fontWeight: 700 }}>unallocated · {fmtHrs(un.hrs)} hrs</span>
            </div>
            <div className="note" style={{ margin: '4px 0 10px' }}>Not in your true-cost numbers — assign them to a building to fold them in.</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn grad sm" onClick={() => setAllocOpen(true)}>Allocate now</button>
              <button className="btn ghost sm" onClick={() => setShowUnalloc((v) => !v)}>
                {showUnalloc ? 'Hide from charts' : 'Show in charts'}
              </button>
            </div>
          </div>
        </div>
      )}
      {allocOpen && <AllocateModal store={store} onClose={() => setAllocOpen(false)} />}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span className="field-label" style={{ margin: 0 }}>Labor cost over time{showUnalloc && un.count > 0 ? ' · incl. unallocated' : ''}</span>
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
            <Bar dataKey="cost" radius={[5, 5, 0, 0]} cursor="pointer"
              onClick={(d) => { const k = d?.key || d?.payload?.key; if (k) go('cal', { month: k.slice(0, 7) }); }}>
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
                <tr key={p.key} onClick={() => go('props', { propId: p.key })} style={{ cursor: 'pointer' }}>
                  <td className="barcell"><div className="bar" style={{ width: `${(p.cost / maxP) * 100}%` }} />
                    <span className="bar-label" style={{ fontWeight: 700 }}>{propById[p.key]?.name || '—'}</span>
                    <div className="bar-label" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{propById[p.key]?.city || ''}</div>
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
            <div className="row" key={tc.key} onClick={() => go('team', { operatorId: tc.key })} style={{ cursor: 'pointer' }}>
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
