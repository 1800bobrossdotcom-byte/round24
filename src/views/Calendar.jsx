import { useMemo, useState } from 'react';
import { fmtMoney, fmtHrs, cost } from '../lib/rollups.js';

// month calendar of labor intensity — weeks start Saturday to match the
// Evolution24 pay period. cell heat = hours worked that day.
const DOW = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const WEEK_START = 6; // Saturday

export default function Calendar({ store }) {
  const { allTimers, techById, propById } = store;

  const byDay = useMemo(() => {
    const m = new Map();
    for (const t of allTimers) {
      if (!m.has(t.date)) m.set(t.date, { hrs: 0, cost: 0, entries: [] });
      const d = m.get(t.date);
      d.hrs += t.durationHrs; d.cost += cost(t); d.entries.push(t);
    }
    return m;
  }, [allTimers]);

  const latestDate = useMemo(
    () => allTimers.reduce((a, t) => (t.date > a ? t.date : a),
      allTimers.length ? '1970-01-01' : new Date().toISOString().slice(0, 10)),
    [allTimers]
  );
  const [ym, setYm] = useState(latestDate.slice(0, 7));
  const [selDay, setSelDay] = useState(null);

  const [y, m] = ym.split('-').map(Number);
  const monthLabel = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const nav = (d) => {
    const nd = new Date(y, m - 1 + d, 1);
    setYm(`${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}`);
    setSelDay(null);
  };

  // build the grid: leading blanks to align day 1 with its weekday column
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstDow = new Date(y, m - 1, 1).getDay();
  const lead = (firstDow - WEEK_START + 7) % 7;
  const cells = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const date = `${ym}-${String(i + 1).padStart(2, '0')}`;
      return { day: i + 1, date, data: byDay.get(date) };
    }),
  ];
  const maxHrs = Math.max(...cells.map((c) => c?.data?.hrs || 0), 1);
  const monthTotal = cells.reduce(
    (a, c) => c?.data ? { hrs: a.hrs + c.data.hrs, cost: a.cost + c.data.cost, days: a.days + 1 } : a,
    { hrs: 0, cost: 0, days: 0 }
  );

  const sel = selDay && byDay.get(selDay);

  return (
    <div>
      <div className="view-head">
        <h1>Calendar</h1>
        <p>Labor by day — imported pay logs and live timers on one grid</p>
      </div>

      <div className="grid g3" style={{ marginBottom: 'var(--gap)' }}>
        <div className="card"><div className="stat"><span className="k">{monthLabel} hours</span><span className="v mono sm">{fmtHrs(monthTotal.hrs)}</span></div></div>
        <div className="card"><div className="stat"><span className="k">Labor cost</span><span className="v mono sm money">{fmtMoney(monthTotal.cost)}</span></div></div>
        <div className="card"><div className="stat"><span className="k">Active days</span><span className="v mono sm">{monthTotal.days}</span></div></div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <button className="btn ghost sm" onClick={() => nav(-1)}>‹</button>
          <span style={{ fontWeight: 800, fontSize: 16 }}>{monthLabel}</span>
          <button className="btn ghost sm" onClick={() => nav(1)}>›</button>
        </div>

        <div className="cal-grid">
          {DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
          {cells.map((c, i) => c ? (
            <button
              key={c.date}
              className={'cal-cell' + (selDay === c.date ? ' sel' : '') + (c.data ? ' has' : '')}
              style={c.data ? { '--heat': Math.max(0.12, c.data.hrs / maxHrs) } : undefined}
              onClick={() => setSelDay(selDay === c.date ? null : c.date)}
            >
              <span className="d">{c.day}</span>
              {c.data && <span className="h mono">{fmtHrs(c.data.hrs)}h</span>}
            </button>
          ) : <div key={'b' + i} />)}
        </div>
        <p className="note">Heat = hours worked that day. Tap a day for the full log.</p>
      </div>

      {sel && (
        <div className="card" style={{ marginTop: 'var(--gap)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="field-label" style={{ margin: 0 }}>
              {new Date(selDay + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </span>
            <span className="mono money" style={{ fontWeight: 700 }}>{fmtMoney(sel.cost)} · {fmtHrs(sel.hrs)}h</span>
          </div>
          {sel.entries.map((t) => (
            <div className="row" key={t.id}>
              <div className="lead">
                <div className="t">{techById[t.techId]?.name || '?'} — {propById[t.propId]?.name || 'Unallocated'}{t.unit && t.unit !== '—' ? ` · ${t.unit}` : ''}</div>
                <div className="s">{t.category}{t.issue ? ` · ${t.issue}` : ''}</div>
              </div>
              <div className="val">
                <div className="big">{fmtHrs(t.durationHrs)}h</div>
                <div className="small money">{fmtMoney(t.durationHrs * t.rate)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
