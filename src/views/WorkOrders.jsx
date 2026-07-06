import { useState, useRef, useMemo } from 'react';

// ---- voice → structured work order ----------------------------------
// "create work order unit 4B leaking faucet for Gianni tomorrow at 301 Central"
// → { unit: '4B', task: 'leaking faucet…', assignee, due, property, category }
const CAT_HINTS = {
  plumbing: /leak|faucet|toilet|drain|pipe|plumb|water heater/i,
  electrical: /outlet|light|breaker|electric|wiring/i,
  hvac: /heat|furnace|\bac\b|hvac|thermostat|cooling/i,
  appliance: /fridge|refrigerator|stove|oven|washer|dryer|dishwasher|appliance/i,
  turn: /turnover|turn\b|vacant|make.?ready/i,
  inspection: /inspect/i,
};
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function parseVoice(text, properties, techs) {
  const out = { task: text.trim(), category: 'general' };
  const t = ' ' + text.toLowerCase() + ' ';

  const unitM = t.match(/\b(?:unit|apartment|apt\.?)\s*#?\s*([a-z]?\d+[a-z]?|\d+)/i);
  if (unitM) out.unit = unitM[1].toUpperCase();

  for (const p of properties) {
    const streetNum = p.name.match(/^\d+/)?.[0];
    if (t.includes(p.name.toLowerCase()) || (streetNum && new RegExp(`\\b${streetNum}\\b`).test(t))) {
      out.propLabel = p.name; break;
    }
  }
  for (const tech of techs) {
    if (new RegExp(`\\b${tech.name.split(' ')[0].toLowerCase()}\\b`).test(t)) {
      out.assigneeLabel = tech.name; break;
    }
  }
  const day = 86400000, today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const wd = WEEKDAYS.findIndex((w) => t.includes(w));
  if (/\btomorrow\b/.test(t)) out.due = iso(new Date(today.getTime() + day));
  else if (/\btoday\b/.test(t)) out.due = iso(today);
  else if (wd >= 0) {
    const diff = ((wd - today.getDay()) + 7) % 7 || 7;
    out.due = iso(new Date(today.getTime() + diff * day));
  }
  for (const [c, re] of Object.entries(CAT_HINTS)) if (re.test(t)) { out.category = c; break; }
  return out;
}

const CATS = ['plumbing', 'electrical', 'hvac', 'appliance', 'turn', 'general', 'inspection'];
const STATUS_COLORS = { open: 'var(--info)', in_progress: 'var(--warn)', done: 'var(--money)', cancelled: 'var(--text-faint)' };

const inputStyle = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)',
  color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 14, padding: 11, borderRadius: 10,
};

export default function WorkOrders({ store }) {
  const { workOrders, addWorkOrder, setWoStatus, properties, techs, role, woBackend } = store;
  const [draft, setDraft] = useState(null);   // form state when creating
  const [listening, setListening] = useState(false);
  const [liveText, setLiveText] = useState('');
  const [voiceErr, setVoiceErr] = useState(null);
  const recRef = useRef(null);

  const isStaff = role === 'admin' || role === 'manager';
  const open = useMemo(() => workOrders.filter((w) => w.status === 'open' || w.status === 'in_progress'), [workOrders]);
  const closed = useMemo(() => workOrders.filter((w) => w.status === 'done' || w.status === 'cancelled'), [workOrders]);

  const startVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setVoiceErr('Voice input needs Chrome, Edge, or Safari.'); return; }
    setVoiceErr(null); setLiveText(''); setListening(true);
    const rec = new SR();
    recRef.current = rec;
    rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true;
    let finalText = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      setLiveText((finalText + ' ' + interim).trim());
    };
    rec.onerror = (e) => { setVoiceErr(e.error === 'not-allowed' ? 'Microphone permission denied.' : 'Voice error: ' + e.error); setListening(false); };
    rec.onend = () => {
      setListening(false);
      const text = finalText.trim();
      if (text) setDraft({ ...parseVoice(text, properties, techs), transcript: text, source: 'voice' });
    };
    rec.start();
  };
  const stopVoice = () => recRef.current?.stop();

  const save = async () => {
    await addWorkOrder(draft);
    setDraft(null); setLiveText('');
  };

  return (
    <div>
      <div className="view-head">
        <h1>Work orders</h1>
        <p>What feeds the timer — create by voice or by hand, assign, track to done</p>
      </div>

      {woBackend === 'local' && (
        <div className="offline">◐ Stored on this device — syncs to the cloud once the work-orders migration is applied.</div>
      )}
      {voiceErr && <div className="offline" style={{ color: 'var(--danger)', borderColor: '#ff5a5a33', background: '#ff5a5a12' }}>{voiceErr}</div>}

      {/* ---- create ---- */}
      {isStaff && !draft && (
        <div className="card" style={{ marginBottom: 'var(--gap)' }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn grad" style={{ flex: 1 }} onClick={() => setDraft({ task: '', category: 'general', source: 'manual' })}>
              + New work order
            </button>
            <button className={'btn ' + (listening ? 'stop' : 'ghost')} style={{ flex: 1 }} onClick={listening ? stopVoice : startVoice}>
              {listening ? '◉ Listening… tap to finish' : '🎤 Speak a work order'}
            </button>
          </div>
          {listening && (
            <p className="note" style={{ marginTop: 12, fontFamily: 'var(--mono)', color: 'var(--text)' }}>
              {liveText || 'Say e.g. “unit 4B leaking faucet for Gianni at 301 Central, tomorrow”'}
            </p>
          )}
        </div>
      )}

      {draft && (
        <div className="card" style={{ marginBottom: 'var(--gap)' }}>
          <span className="field-label">{draft.source === 'voice' ? 'Heard it — check the details' : 'New work order'}</span>
          {draft.transcript && (
            <p className="note" style={{ marginTop: 2, marginBottom: 12, fontStyle: 'italic' }}>“{draft.transcript}”</p>
          )}

          <div className="field-label">Task</div>
          <input style={inputStyle} value={draft.task} onChange={(e) => setDraft({ ...draft, task: e.target.value })} placeholder="what needs doing" />
          <div style={{ height: 12 }} />

          <div className="grid g2">
            <div>
              <div className="field-label">Property</div>
              <select style={inputStyle} value={draft.propLabel || ''} onChange={(e) => setDraft({ ...draft, propLabel: e.target.value || null })}>
                <option value="">— pick property —</option>
                {properties.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <div className="field-label">Unit</div>
              <input style={inputStyle} value={draft.unit || ''} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="4B" />
            </div>
            <div>
              <div className="field-label">Assign to</div>
              <select style={inputStyle} value={draft.assigneeLabel || ''} onChange={(e) => setDraft({ ...draft, assigneeLabel: e.target.value || null })}>
                <option value="">— unassigned —</option>
                {techs.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <div className="field-label">Due date</div>
              <input style={inputStyle} type="date" value={draft.due || ''} onChange={(e) => setDraft({ ...draft, due: e.target.value || null })} />
            </div>
          </div>
          <div style={{ height: 12 }} />

          <div className="field-label">Category</div>
          <div className="pick">
            {CATS.map((c) => (
              <button key={c} className={draft.category === c ? 'on' : ''} onClick={() => setDraft({ ...draft, category: c })}>{c}</button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button className="btn ghost" style={{ width: 'auto', flex: 1 }} onClick={() => setDraft(null)}>Cancel</button>
            <button className="btn grad" style={{ flex: 2 }} onClick={save} disabled={!draft.task?.trim()}>Create work order</button>
          </div>
        </div>
      )}

      {/* ---- open ---- */}
      <div className="card">
        <span className="field-label">Open ({open.length})</span>
        {open.length === 0 && <p className="note">Nothing open. {isStaff ? 'Create one above — or just say it out loud.' : 'Nothing assigned to you right now.'}</p>}
        {open.map((w) => <WoRow key={w.id} w={w} setWoStatus={setWoStatus} isStaff={isStaff} />)}
      </div>

      {closed.length > 0 && (
        <div className="card" style={{ marginTop: 'var(--gap)' }}>
          <span className="field-label">Closed ({closed.length})</span>
          {closed.map((w) => <WoRow key={w.id} w={w} setWoStatus={setWoStatus} isStaff={isStaff} done />)}
        </div>
      )}
    </div>
  );
}

function WoRow({ w, setWoStatus, isStaff, done }) {
  return (
    <div className="row">
      <div className="lead">
        <div className="t" style={done ? { color: 'var(--text-dim)', textDecoration: w.status === 'cancelled' ? 'line-through' : 'none' } : undefined}>
          {w.task}
        </div>
        <div className="s">
          {[w.propLabel, w.unit && `Unit ${w.unit}`, w.category, w.assigneeLabel && `→ ${w.assigneeLabel}`, w.due && `due ${w.due}`]
            .filter(Boolean).join(' · ')}
          {w.source === 'voice' && ' · 🎤'}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span className="chip" style={{ color: STATUS_COLORS[w.status] }}>{w.status.replace('_', ' ')}</span>
        {w.status === 'open' && <button className="btn ghost sm" onClick={() => setWoStatus(w.id, 'in_progress')}>Start</button>}
        {w.status === 'in_progress' && <button className="btn ghost sm" onClick={() => setWoStatus(w.id, 'done')}>Done</button>}
        {isStaff && !done && <button className="btn ghost sm" style={{ color: 'var(--text-faint)' }} onClick={() => setWoStatus(w.id, 'cancelled')}>✕</button>}
      </div>
    </div>
  );
}
