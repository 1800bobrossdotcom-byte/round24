import { useMemo, useState, useEffect } from 'react';
import { fmtHrs, cost } from '../lib/rollups.js';
import { IcBuilding, IcWrench, IcClock, IcCal } from '../components/ui.jsx';

// Portfolio calendar: lease expirations, move-ins, work-order due dates, and
// labor — day / week / month panels shown together as modular data-viz.
const DOW = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const WEEK_START = 6; // Saturday, to match the pay period
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const KIND = {
  lease_end: { label: 'Lease ends', color: 'var(--warn)', Icon: IcCal },
  move_in: { label: 'Move-in', color: 'var(--money)', Icon: IcBuilding },
  wo_due: { label: 'Work order due', color: 'var(--accent)', Icon: IcWrench },
};
const monthName = (ym) => new Date(ym + '-01T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const shortM = (ym) => new Date(ym + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short' });
const prettyDay = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

export default function Calendar({ store, focus, navigate }) {
  const { allTimers, workOrders = [], leasing = [], techById, propById } = store;
  const go = navigate || (() => {});
  const todayISO = iso(new Date());

  // ---- unified event stream ----
  const events = useMemo(() => {
    const ev = [];
    for (const u of leasing) {
      if (u.leaseEnd) ev.push({ date: u.leaseEnd, kind: 'lease_end', title: `${u.tenant || 'Vacant'} — lease ends`, sub: `${u.building} ${u.number}`.trim(), u });
      if (u.leaseStart && u.leaseStart >= todayISO) ev.push({ date: u.leaseStart, kind: 'move_in', title: `${u.tenant || 'New tenant'} — move-in`, sub: `${u.building} ${u.number}`.trim(), u });
    }
    for (const w of workOrders) if (w.due) ev.push({ date: w.due, kind: 'wo_due', title: w.task, sub: [w.propLabel, w.unit && `Unit ${w.unit}`].filter(Boolean).join(' · '), w });
    return ev;
  }, [leasing, workOrders, todayISO]);

  const evByDay = useMemo(() => { const m = new Map(); for (const e of events) { if (!m.has(e.date)) m.set(e.date, []); m.get(e.date).push(e); } return m; }, [events]);
  const laborByDay = useMemo(() => {
    const m = new Map();
    for (const t of allTimers) { const d = m.get(t.date) || { hrs: 0, cost: 0, entries: [] }; d.hrs += t.durationHrs; d.cost += cost(t); d.entries.push(t); m.set(t.date, d); }
    return m;
  }, [allTimers]);

  const [ym, setYm] = useState(todayISO.slice(0, 7));
  const [selDay, setSelDay] = useState(todayISO);
  // drill-in from elsewhere ("On calendar" on a unit) jumps to that day
  useEffect(() => {
    if (focus?.day) { setSelDay(focus.day); setYm(focus.day.slice(0, 7)); }
    else if (focus?.month) setYm(focus.month);
  }, [focus]);
  const [y, mo] = ym.split('-').map(Number);
  const navMonth = (d) => { const nd = new Date(y, mo - 1 + d, 1); setYm(`${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}`); };

  // ---- data-viz: expirations over the next 6 months ----
  const expBars = useMemo(() => {
    const buckets = [];
    for (let i = 0; i < 6; i++) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + i); buckets.push({ ym: iso(d).slice(0, 7), n: 0 }); }
    for (const e of events) if (e.kind === 'lease_end') { const b = buckets.find((x) => x.ym === e.date.slice(0, 7)); if (b) b.n++; }
    return buckets;
  }, [events]);
  const expMax = Math.max(1, ...expBars.map((b) => b.n));

  const in30 = events.filter((e) => e.date >= todayISO && e.date <= iso(addDays(new Date(), 30)));
  const cnt = (list, k) => list.filter((e) => e.kind === k).length;

  // ---- month grid ----
  const daysInMonth = new Date(y, mo, 0).getDate();
  const lead = (new Date(y, mo - 1, 1).getDay() - WEEK_START + 7) % 7;
  const cells = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => { const date = `${ym}-${String(i + 1).padStart(2, '0')}`; return { day: i + 1, date }; }),
  ];
  const maxHrs = Math.max(1, ...cells.map((c) => (c && laborByDay.get(c.date)?.hrs) || 0));

  // ---- week strip: the Sat-start week containing selDay ----
  const weekDays = useMemo(() => {
    const base = new Date(selDay + 'T00:00:00');
    const start = addDays(base, -(((base.getDay() - WEEK_START + 7) % 7)));
    return Array.from({ length: 7 }, (_, i) => iso(addDays(start, i)));
  }, [selDay]);

  const dayEvents = (evByDay.get(selDay) || []).slice().sort((a, b) => a.kind.localeCompare(b.kind));
  const dayLabor = laborByDay.get(selDay);

  const openEvent = (e) => {
    if (e.kind === 'wo_due') go('wo');
    else if (e.u) go('leasing', { unitId: e.u.id });
    else go('leasing');
  };

  return (
    <div>
      <div className="view-head"><h1>Calendar</h1><p>Lease expirations, move-ins, work orders, and labor — day, week and month on one board</p></div>

      {/* data-viz summary */}
      <div className="cal-summary">
        <div className="cal-chips">
          <div className="cal-chip"><span className="v mono" style={{ color: 'var(--warn)' }}>{cnt(in30, 'lease_end')}</span><span className="k">leases ending · 30d</span></div>
          <div className="cal-chip"><span className="v mono" style={{ color: 'var(--money)' }}>{cnt(in30, 'move_in')}</span><span className="k">move-ins · 30d</span></div>
          <div className="cal-chip"><span className="v mono" style={{ color: 'var(--accent)' }}>{cnt(in30, 'wo_due')}</span><span className="k">work orders due · 30d</span></div>
        </div>
        <div className="cal-expchart">
          <div className="field-label" style={{ margin: '0 0 8px' }}>Lease expirations — next 6 months</div>
          <div className="cal-bars">
            {expBars.map((b) => (
              <button key={b.ym} className={'cal-bar' + (b.ym === ym ? ' on' : '')} onClick={() => setYm(b.ym)} title={`${b.n} in ${monthName(b.ym)}`}>
                <span className="cal-bar-track"><span style={{ height: Math.round((b.n / expMax) * 100) + '%' }} /></span>
                <span className="cal-bar-n mono">{b.n}</span>
                <span className="cal-bar-m">{shortM(b.ym)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* month + day panels, side by side */}
      <div className="cal-layout">
        <div className="card cal-monthcard">
          <div className="cal-monthhead">
            <button className="btn ghost sm" onClick={() => navMonth(-1)}>‹</button>
            <span style={{ fontWeight: 800, fontSize: 16 }}>{monthName(ym)}</span>
            <button className="btn ghost sm" onClick={() => navMonth(1)}>›</button>
          </div>
          <div className="cal-grid">
            {DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
            {cells.map((c, i) => {
              if (!c) return <div key={'b' + i} />;
              const evs = evByDay.get(c.date) || [];
              const lab = laborByDay.get(c.date);
              const kinds = [...new Set(evs.map((e) => e.kind))];
              const isToday = c.date === todayISO;
              return (
                <button key={c.date}
                  className={'cal-cell2' + (selDay === c.date ? ' sel' : '') + (isToday ? ' today' : '')}
                  style={lab ? { '--heat': Math.max(0.1, lab.hrs / maxHrs) } : undefined}
                  onClick={() => setSelDay(c.date)}>
                  <span className="d">{c.day}</span>
                  {evs.length > 0 && (
                    <span className="cal-dots">
                      {kinds.slice(0, 3).map((k) => <span key={k} className="cal-dot" style={{ background: KIND[k].color }} />)}
                    </span>
                  )}
                  {evs.length > 0 && <span className="cal-cnt mono">{evs.length}</span>}
                </button>
              );
            })}
          </div>
          <div className="cal-legend">
            {Object.entries(KIND).map(([k, v]) => <span key={k}><span className="cal-dot" style={{ background: v.color }} /> {v.label}</span>)}
            <span className="cal-heatnote">· cell shading = labor hours</span>
          </div>
        </div>

        {/* day agenda */}
        <div className="card cal-daycard">
          <div className="cal-dayhead">
            <span className="field-label" style={{ margin: 0 }}>{prettyDay(selDay)}</span>
            {selDay !== todayISO && <button className="btn ghost sm" onClick={() => { setSelDay(todayISO); setYm(todayISO.slice(0, 7)); }}>Today</button>}
          </div>
          {dayEvents.length === 0 && !dayLabor && <p className="note" style={{ padding: '18px 0', textAlign: 'center' }}>Nothing scheduled.</p>}
          {dayEvents.map((e, i) => {
            const K = KIND[e.kind];
            return (
              <div className="row cal-evrow" key={i} onClick={() => openEvent(e)} style={{ cursor: 'pointer' }}>
                <span className="cal-evbar" style={{ background: K.color }} />
                <div className="lead">
                  <div className="t">{e.title}</div>
                  <div className="s">{K.label}{e.sub ? ` · ${e.sub}` : ''}</div>
                </div>
                <K.Icon width={15} height={15} style={{ color: K.color, flex: 'none' }} />
              </div>
            );
          })}
          {dayLabor && (
            <div className="row" style={{ borderTop: dayEvents.length ? '1px solid var(--line-soft)' : 'none', marginTop: dayEvents.length ? 6 : 0 }}>
              <span className="cal-evbar" style={{ background: 'var(--info)' }} />
              <div className="lead"><div className="t"><IcClock width={12} height={12} style={{ verticalAlign: -1 }} /> {fmtHrs(dayLabor.hrs)}h labor logged</div>
                <div className="s">{dayLabor.entries.length} {dayLabor.entries.length === 1 ? 'entry' : 'entries'} · {dayLabor.entries.slice(0, 3).map((t) => techById?.[t.techId]?.name || '?').join(', ')}</div></div>
            </div>
          )}
        </div>
      </div>

      {/* week strip */}
      <div className="card" style={{ marginTop: 'var(--gap)' }}>
        <span className="field-label">This week{selDay !== todayISO ? ' (selected)' : ''}</span>
        <div className="cal-week">
          {weekDays.map((d) => {
            const evs = evByDay.get(d) || [];
            const lab = laborByDay.get(d);
            const dt = new Date(d + 'T00:00:00');
            return (
              <button key={d} className={'cal-wday' + (d === selDay ? ' sel' : '') + (d === todayISO ? ' today' : '')} onClick={() => { setSelDay(d); setYm(d.slice(0, 7)); }}>
                <div className="cal-wtop"><span className="dow">{DOW[(dt.getDay() - WEEK_START + 7) % 7]}</span><span className="dnum mono">{dt.getDate()}</span></div>
                <div className="cal-wbody">
                  {evs.slice(0, 4).map((e, i) => <span key={i} className="cal-wchip" style={{ borderColor: KIND[e.kind].color, color: KIND[e.kind].color }}>{e.kind === 'wo_due' ? e.title : (e.u?.tenant || (e.kind === 'move_in' ? 'Move-in' : 'Vacant'))}</span>)}
                  {evs.length > 4 && <span className="cal-wmore">+{evs.length - 4}</span>}
                  {lab && <span className="cal-wlab mono">{fmtHrs(lab.hrs)}h</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
