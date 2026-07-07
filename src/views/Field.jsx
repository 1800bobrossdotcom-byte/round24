import { useState, useEffect, useRef } from 'react';
import { fmtHrs } from '../lib/rollups.js';
import { categoryMedian } from '../lib/rollups.js';
import { WO_PRIORITIES, byPriority } from './WorkOrders.jsx';

const CATS = ['plumbing', 'electrical', 'hvac', 'appliance', 'painting', 'turn', 'general', 'inspection'];

// contractor-friendly pacing: nudge a break after 3h straight, and around
// lunch. breaks pause the clock — break time never bills to the job.
const BREAK_AFTER_S = 3 * 3600;
const foodUrl = (p) =>
  'https://www.google.com/maps/search/' + encodeURIComponent(`food near ${p ? p.name + ' ' + (p.city || '') : 'me'}`);

// the running timer survives reloads/crashes: start timestamps live in
// localStorage, elapsed is recomputed from them, so the clock stays
// accurate even if the phone died mid-job.
const TIMER_KEY = 'caliper_field_timer_v1';
function loadTimer() {
  try { return JSON.parse(localStorage.getItem(TIMER_KEY)) || {}; }
  catch { return {}; }
}

export default function Field({ store }) {
  const { properties, allTimers, workOrders, setWoStatus } = store;
  const me = store.techs.find((t) => t.id === 't_gianni');
  const [running, setRunning] = useState(() => loadTimer().running ?? null); // {propId, unit, category, start, woId}
  const [elapsed, setElapsed] = useState(() => {
    const s = loadTimer();
    if (!s.running) return 0;
    const end = s.onBreak ? s.onBreak.start : Date.now();
    return Math.max(0, (end - s.running.start - (s.breakMs || 0)) / 1000);
  });
  const [prop, setProp] = useState(properties[0].id);
  const [unit, setUnit] = useState('');
  const [cat, setCat] = useState('plumbing');
  const [log, setLog] = useState(() => loadTimer().log ?? []);
  const tick = useRef();

  // break machinery: while on break the work clock freezes
  const [onBreak, setOnBreak] = useState(() => loadTimer().onBreak ?? null); // { start }
  const [breakMs, setBreakMs] = useState(() => loadTimer().breakMs ?? 0);
  const [breakNow, setBreakNow] = useState(0);    // live seconds of current break
  const [lastNudge, setLastNudge] = useState(() => loadTimer().lastNudge ?? 0); // work-seconds when last nudged
  const [lunchNudged, setLunchNudged] = useState(() => loadTimer().lunchNudged ?? false);

  // persist everything the clock needs to reconstruct itself
  useEffect(() => {
    localStorage.setItem(TIMER_KEY, JSON.stringify({ running, log, onBreak, breakMs, lastNudge, lunchNudged }));
  }, [running, log, onBreak, breakMs, lastNudge, lunchNudged]);

  const myWos = workOrders.filter((w) => w.status === 'open' || w.status === 'in_progress').sort(byPriority);

  // start the timer straight from a work order — property/unit/category prefilled
  const startFromWo = (w) => {
    const p = properties.find((x) => x.name === w.propLabel);
    setWoStatus(w.id, 'in_progress');
    setRunning({
      propId: p?.id || properties[0].id, unit: w.unit || '—',
      category: w.category || 'general', start: Date.now(), woId: w.id, woTask: w.task,
    });
    setElapsed(0);
  };

  useEffect(() => {
    if (running) {
      tick.current = setInterval(() => {
        const end = onBreak ? onBreak.start : Date.now();
        setElapsed(Math.max(0, (end - running.start - breakMs) / 1000));
        if (onBreak) setBreakNow((Date.now() - onBreak.start) / 1000);
      }, 250);
      return () => clearInterval(tick.current);
    }
  }, [running, onBreak, breakMs]);

  const startBreak = () => { setOnBreak({ start: Date.now() }); setBreakNow(0); };
  const endBreak = () => { setBreakMs((b) => b + (Date.now() - onBreak.start)); setOnBreak(null); setLastNudge(elapsed); };

  const hour = new Date().getHours();
  const lunchTime = hour >= 11 && hour < 14;
  const nudge = running && !onBreak && (
    elapsed - lastNudge >= BREAK_AFTER_S ? 'stretch'
    : (lunchTime && elapsed > 3600 && !lunchNudged ? 'lunch' : null)
  );

  const hh = String(Math.floor(elapsed / 3600)).padStart(2, '0');
  const mm = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const ss = String(Math.floor(elapsed % 60)).padStart(2, '0');

  const resetBreaks = () => { setOnBreak(null); setBreakMs(0); setBreakNow(0); setLastNudge(0); setLunchNudged(false); };
  const start = () => { setRunning({ propId: prop, unit: unit || '—', category: cat, start: Date.now() }); setElapsed(0); resetBreaks(); };
  const stop = async () => {
    const hrs = Math.round(Math.max(0.05, elapsed / 3600) * 100) / 100;
    const p = properties.find((x) => x.id === running.propId);
    const entryId = Date.now();
    setLog([{ id: entryId, prop: p.name, unit: running.unit, category: running.category, hrs, cost: hrs * me.rate, sync: 'saving' }, ...log]);
    setRunning(null); setElapsed(0); resetBreaks();
    // land the hours in the cloud so management sees them — queued if offline
    const sync = await store.addTimerEntry({
      propLabel: p.name, unit: running.unit === '—' ? null : running.unit,
      date: new Date().toISOString().slice(0, 10), category: running.category,
      durationHrs: hrs, note: running.woTask || null, workOrderId: running.woId || null,
      issue: running.woTask || null,
    });
    setLog((l) => l.map((e) => (e.id === entryId ? { ...e, sync } : e)));
  };

  const median = categoryMedian(allTimers, cat);

  return (
    <div>
      <div className="view-head">
        <h1>Field</h1>
        <p>{me.name} · ${me.rate}/hr · one timer per job</p>
      </div>

      <div className="offline">◐ Offline-safe — timers and photos queue on-device, sync when signal returns.</div>

      {!running && myWos.length > 0 && (
        <div className="card" style={{ marginBottom: 'var(--gap)' }}>
          <span className="field-label">Work orders ({myWos.length})</span>
          {myWos.map((w) => (
            <div className="row" key={w.id}>
              <div className="lead">
                <div className="t"><span style={{ color: WO_PRIORITIES[w.priority ?? 3].color, marginRight: 6 }}>●</span>{w.task}</div>
                <div className="s">{[WO_PRIORITIES[w.priority ?? 3].label, w.propLabel, w.unit && `Unit ${w.unit}`, w.category, w.due && `due ${w.due}`].filter(Boolean).join(' · ')}</div>
              </div>
              <button className="btn ghost sm" onClick={() => startFromWo(w)}>▶ Start</button>
            </div>
          ))}
        </div>
      )}

      {running && onBreak ? (
        <div className="timer-live" style={{ borderColor: '#4ade8044' }}>
          <div style={{ fontSize: 30 }}>☕</div>
          <div className="clock mono" style={{ color: 'var(--money)' }}>
            {String(Math.floor(breakNow / 60)).padStart(2, '0')}:{String(Math.floor(breakNow % 60)).padStart(2, '0')}
          </div>
          <div className="meta">On break — the job clock is paused at {hh}:{mm}:{ss}. Break time never bills.</div>
          <div style={{ height: 14 }} />
          <a className="btn ghost" style={{ display: 'block', textDecoration: 'none', textAlign: 'center', marginBottom: 10 }}
            href={foodUrl(properties.find((p) => p.id === running.propId))} target="_blank" rel="noreferrer">
            🍔 Food near the job site
          </a>
          <button className="btn grad" onClick={endBreak}>▶ Back to work</button>
        </div>
      ) : running ? (
        <div className="timer-live">
          {nudge && (
            <div className="offline" style={{ textAlign: 'left', color: 'var(--money)', borderColor: '#4ade8033', background: '#4ade8012' }}>
              {nudge === 'lunch' ? '🍔 Lunchtime — grab a bite?' : `💪 ${Math.floor(elapsed / 3600)}h straight — stretch those legs?`}
              <span style={{ flex: 1 }} />
              <button className="btn ghost sm" onClick={startBreak}>Take a break</button>
              <button className="btn ghost sm" style={{ color: 'var(--text-faint)' }}
                onClick={() => { setLastNudge(elapsed); if (nudge === 'lunch') setLunchNudged(true); }}>Later</button>
            </div>
          )}
          <div className="clock grad-text settle">{hh}:{mm}:{ss}</div>
          <div className="meta">
            {running.woTask ? `${running.woTask} · ` : ''}{properties.find((p) => p.id === running.propId)?.name} · Unit {running.unit} · {running.category}
            {breakMs > 0 && <> · {Math.round(breakMs / 60000)}m of breaks (unbilled)</>}
          </div>
          <div style={{ height: 18 }} />
          <button className="btn stop" onClick={stop}>Stop &amp; log to this job</button>
          <button className="btn ghost" style={{ marginTop: 10 }} onClick={startBreak}>☕ Take a break</button>
          {running.woId && (
            <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => { setWoStatus(running.woId, 'done'); stop(); }}>
              ✓ Stop &amp; mark work order done
            </button>
          )}
        </div>
      ) : (
        <div className="card">
          <div className="field-label">Property</div>
          <select className="rangebar" value={prop} onChange={(e) => setProp(e.target.value)}
            style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text)', fontFamily: 'var(--font)', fontWeight: 700, fontSize: 14, padding: 12, borderRadius: 10, marginBottom: 16 }}>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.city}</option>)}
          </select>

          <div className="field-label">Unit</div>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. 4B"
            style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 14, padding: 12, borderRadius: 10, marginBottom: 16 }} />

          <div className="field-label">Category</div>
          <div className="pick" style={{ marginBottom: 8 }}>
            {CATS.map((c) => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}
          </div>
          <p className="note" style={{ marginTop: 4 }}>Typical {cat} job runs {fmtHrs(median)} hrs here — you'll see this job measured against that when you stop.</p>

          <div style={{ height: 16 }} />
          <button className="btn grad" onClick={start}>▶ Start timer</button>
        </div>
      )}

      {log.length > 0 && (
        <div className="card" style={{ marginTop: 'var(--gap)' }}>
          <span className="field-label">Logged this session</span>
          {log.map((l) => {
            const med = categoryMedian(allTimers, l.category);
            const delta = med ? l.hrs - med : 0;
            return (
              <div className="row" key={l.id}>
                <div className="lead">
                  <div className="t">{l.prop} · {l.unit}</div>
                  <div className="s">{l.category}
                    {med > 0 && <> · {delta > 0.15 ? <span style={{ color: 'var(--warn)' }}>{fmtHrs(delta)}h over normal</span> : delta < -0.15 ? <span className="money">{fmtHrs(-delta)}h under</span> : 'on pace'}</>}
                  </div>
                </div>
                <div className="val">
                  <div className="big">{fmtHrs(l.hrs)}h</div>
                  <div className="small money">${l.cost.toFixed(2)}</div>
                  {l.sync && <div className="small" style={{ color: l.sync === 'synced' ? 'var(--money)' : 'var(--text-faint)' }}>
                    {l.sync === 'synced' ? '✓ synced' : l.sync === 'queued' ? '◐ syncs when online' : l.sync === 'saving' ? '…' : '· this device'}
                  </div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
