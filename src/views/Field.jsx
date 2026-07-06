import { useState, useEffect, useRef } from 'react';
import { fmtHrs } from '../lib/rollups.js';
import { categoryMedian } from '../lib/rollups.js';

const CATS = ['plumbing', 'electrical', 'hvac', 'appliance', 'turn', 'general', 'inspection'];

export default function Field({ store }) {
  const { properties, allTimers } = store;
  const me = store.techs.find((t) => t.id === 't_gianni');
  const [running, setRunning] = useState(null); // {propId, unit, category, start}
  const [elapsed, setElapsed] = useState(0);
  const [prop, setProp] = useState(properties[0].id);
  const [unit, setUnit] = useState('');
  const [cat, setCat] = useState('plumbing');
  const [log, setLog] = useState([]);
  const tick = useRef();

  useEffect(() => {
    if (running) {
      tick.current = setInterval(() => setElapsed((Date.now() - running.start) / 1000), 250);
      return () => clearInterval(tick.current);
    }
  }, [running]);

  const hh = String(Math.floor(elapsed / 3600)).padStart(2, '0');
  const mm = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const ss = String(Math.floor(elapsed % 60)).padStart(2, '0');

  const start = () => { setRunning({ propId: prop, unit: unit || '—', category: cat, start: Date.now() }); setElapsed(0); };
  const stop = () => {
    const hrs = Math.max(0.05, elapsed / 3600);
    const p = properties.find((x) => x.id === running.propId);
    setLog([{ id: Date.now(), prop: p.name, unit: running.unit, category: running.category, hrs, cost: hrs * me.rate }, ...log]);
    setRunning(null); setElapsed(0);
  };

  const median = categoryMedian(allTimers, cat);

  return (
    <div>
      <div className="view-head">
        <h1>Field</h1>
        <p>{me.name} · ${me.rate}/hr · one timer per job</p>
      </div>

      <div className="offline">◐ Offline-safe — timers and photos queue on-device, sync when signal returns.</div>

      {running ? (
        <div className="timer-live">
          <div className="clock grad-text settle">{hh}:{mm}:{ss}</div>
          <div className="meta">{properties.find((p) => p.id === running.propId)?.name} · Unit {running.unit} · {running.category}</div>
          <div style={{ height: 18 }} />
          <button className="btn stop" onClick={stop}>Stop &amp; log to this job</button>
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
                <div className="val"><div className="big">{fmtHrs(l.hrs)}h</div><div className="small money">${l.cost.toFixed(2)}</div></div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
