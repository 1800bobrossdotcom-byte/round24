import { useMemo, useState, useEffect } from 'react';
import { fmtHrs } from '../lib/rollups.js';
import { WO_PRIORITIES, byPriority } from './WorkOrders.jsx';
import { Avatar, IcWrench, IcClock } from '../components/ui.jsx';

// live elapsed since an ISO start, as H:MM:SS
function elapsedStr(startedAt, now) {
  const s = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// Day overview / dispatch board: who's working, where, on what — each crew's
// queue and workload, plus what's live right now (in-progress = on the clock).
// Built on the shared work-order + timer spine; realtime WO updates keep it live.
const UNASSIGNED = '__unassigned__';

export default function DayOverview({ store, navigate }) {
  const { workOrders, timers, techById, techs, setWoAssignee, liveTimers = [], availability = [] } = store;
  const go = navigate || (() => {});
  const away = availability.filter((a) => a.status === 'off' || a.status === 'pto');
  // tick once a second so live stopwatches count up
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNowMs(Date.now()), 1000); return () => clearInterval(id); }, []);
  const crew = techs.filter((t) => t.role !== 'viewer');
  const techIdByName = useMemo(() => Object.fromEntries(techs.map((t) => [t.name, t.id])), [techs]);
  const now = new Date();
  const todayISO = now.toISOString().slice(0, 10);
  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const activeWos = useMemo(() => workOrders.filter((w) => w.status === 'in_progress').sort(byPriority), [workOrders]);
  const openWos = useMemo(() => workOrders.filter((w) => w.status === 'open'), [workOrders]);

  // group the live queue (open + in-progress) by assignee
  const byOp = useMemo(() => {
    const m = new Map();
    for (const w of workOrders) {
      if (w.status !== 'open' && w.status !== 'in_progress') continue;
      const k = w.assigneeLabel || UNASSIGNED;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(w);
    }
    for (const arr of m.values()) arr.sort(byPriority);
    return m;
  }, [workOrders]);

  // hours logged today, per operator name
  const hoursToday = useMemo(() => {
    const m = new Map();
    for (const t of timers) {
      if (t.date !== todayISO) continue;
      const nm = techById[t.techId]?.name;
      if (nm) m.set(nm, (m.get(nm) || 0) + t.durationHrs);
    }
    return m;
  }, [timers, todayISO, techById]);

  const operators = [...byOp.keys()].filter((k) => k !== UNASSIGNED)
    .sort((a, b) => byOp.get(b).length - byOp.get(a).length);
  const unassigned = byOp.get(UNASSIGNED) || [];
  const totalToday = [...hoursToday.values()].reduce((a, h) => a + h, 0);

  return (
    <div>
      <div className="view-head">
        <h1>Today</h1>
        <p>{dateLabel} · who's working where, and what's live right now</p>
      </div>

      <div className="day-summary">
        <div><span className="n mono">{liveTimers.length || activeWos.length}</span><span className="k">on the clock</span></div>
        <div><span className="n mono">{openWos.length}</span><span className="k">open queue</span></div>
        <div><span className="n mono">{fmtHrs(totalToday)}</span><span className="k">hours today</span></div>
      </div>

      {/* live now — real running timers when present, else in-progress orders */}
      <div className="card" style={{ marginBottom: 'var(--gap)' }}>
        <span className="field-label"><span className="live-dot" /> On the clock now ({liveTimers.length || activeWos.length})</span>
        {liveTimers.length > 0 ? liveTimers.map((lt) => (
          <div className="row" key={lt.userId}>
            <div className="lead">
              <div className="t"><span className="live-dot" style={lt.onBreak ? { background: 'var(--text-faint)', animation: 'none' } : null} /> {lt.operatorLabel || 'Operator'} — {lt.propLabel || 'No property'}{lt.unit && lt.unit !== '—' ? ` · ${lt.unit}` : ''}</div>
              <div className="s">{lt.onBreak ? 'On break' : (lt.task || 'Working')}</div>
            </div>
            <div className="val"><div className="big mono" style={{ color: lt.onBreak ? 'var(--text-dim)' : 'var(--warn)' }}>{elapsedStr(lt.startedAt, nowMs)}</div></div>
          </div>
        )) : activeWos.length === 0 ? (
          <p className="note">Nobody's clocked onto a job right now.</p>
        ) : activeWos.map((w) => (
          <div className="row" key={w.id} onClick={() => go('wo')} style={{ cursor: 'pointer' }}>
            <div className="lead">
              <div className="t"><span className="live-dot" /> {w.assigneeLabel || 'Unassigned'} — {w.propLabel || 'No property'}{w.unit ? ` · ${w.unit}` : ''}</div>
              <div className="s">{w.task}</div>
            </div>
            <span className="chip" style={{ color: WO_PRIORITIES[w.priority ?? 3].color }}>{WO_PRIORITIES[w.priority ?? 3].label}</span>
          </div>
        ))}
      </div>

      {/* off / PTO today */}
      {away.length > 0 && (
        <div className="card" style={{ marginBottom: 'var(--gap)' }}>
          <span className="field-label">Off &amp; PTO ({away.length})</span>
          {away.map((a) => (
            <div className="row" key={a.userId}>
              <div className="lead"><div className="t">{a.label || 'Operator'}</div>{a.note && <div className="s">{a.note}</div>}</div>
              <span className="chip" style={{ color: a.status === 'pto' ? 'var(--info)' : 'var(--text-faint)' }}>{a.status === 'pto' ? 'PTO' : 'Off'}</span>
            </div>
          ))}
        </div>
      )}

      {/* per-operator queues */}
      <span className="field-label" style={{ display: 'block', margin: '0 0 8px 2px' }}>Crew &amp; workloads</span>
      {operators.length === 0 && <div className="card"><p className="note">No work orders assigned yet. Assign crew in <b>Orders</b>.</p></div>}
      {operators.map((name, i) => {
        const q = byOp.get(name);
        const live = q.find((w) => w.status === 'in_progress');
        const hrs = hoursToday.get(name) || 0;
        return (
          <div className="card" key={name} style={{ marginBottom: 'var(--gap)' }}>
            <div className="row" style={{ paddingTop: 0, cursor: techIdByName[name] ? 'pointer' : undefined }}
              onClick={techIdByName[name] ? () => go('team', { operatorId: techIdByName[name] }) : undefined}>
              <Avatar name={name} i={i} />
              <div className="lead">
                <div className="t">{name}</div>
                <div className="s">
                  {live ? <span style={{ color: 'var(--warn)', fontWeight: 700 }}><span className="live-dot" /> on {live.propLabel || 'a job'}</span> : 'idle · no active job'}
                </div>
              </div>
              <div className="val">
                <div className="big">{q.length}</div>
                <div className="small">{q.length === 1 ? 'task' : 'tasks'}{hrs > 0 ? ` · ${fmtHrs(hrs)}h today` : ''}</div>
              </div>
            </div>
            <hr className="hr" />
            <div className="queue">
              {q.map((w) => (
                <div className={'queue-item' + (w.status === 'in_progress' ? ' live' : '')} key={w.id} onClick={() => go('wo')} style={{ cursor: 'pointer' }}>
                  <span className="dot" style={{ background: WO_PRIORITIES[w.priority ?? 3].color }} />
                  <div className="qi-body">
                    <div className="qi-task">{w.task}</div>
                    <div className="qi-meta">{[w.propLabel, w.unit && `Unit ${w.unit}`, w.due && `due ${w.due}`].filter(Boolean).join(' · ')}</div>
                  </div>
                  <span className="chip sm" style={{ color: WO_PRIORITIES[w.priority ?? 3].color }}>{w.status === 'in_progress' ? 'live' : WO_PRIORITIES[w.priority ?? 3].label}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* unassigned — needs dispatch, assign right here */}
      {unassigned.length > 0 && (
        <div className="card" style={{ borderColor: '#ffb02033' }}>
          <span className="field-label" style={{ color: 'var(--warn)' }}><IcWrench width={13} height={13} style={{ verticalAlign: -2 }} /> Needs dispatch ({unassigned.length})</span>
          {unassigned.map((w) => (
            <div className="row" key={w.id}>
              <div className="lead">
                <div className="t">{w.task}</div>
                <div className="s">{[w.propLabel, w.unit && `Unit ${w.unit}`].filter(Boolean).join(' · ') || 'no property set'}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <span className="chip" style={{ color: WO_PRIORITIES[w.priority ?? 3].color }}>{WO_PRIORITIES[w.priority ?? 3].label}</span>
                <select className="dispatch-sel" defaultValue="" onChange={(e) => e.target.value && setWoAssignee(w.id, e.target.value)}>
                  <option value="" disabled>Assign…</option>
                  {crew.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
