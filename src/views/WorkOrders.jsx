import { useState, useRef, useMemo, useEffect } from 'react';
import { fmtMoneyC } from '../lib/rollups.js';
import { IcMic, IcX, IcPlay, IcReceipt } from '../components/ui.jsx';

// ---- voice → structured work order ----------------------------------
// "create work order unit 4B leaking faucet for Gianni tomorrow at 301 Central"
// → { unit: '4B', task: 'leaking faucet…', assignee, due, property, category }
const CAT_HINTS = {
  plumbing: /leak|faucet|toilet|drain|pipe|plumb|water heater/i,
  electrical: /outlet|light|breaker|electric|wiring/i,
  hvac: /heat|furnace|\bac\b|hvac|thermostat|cooling/i,
  appliance: /fridge|refrigerator|stove|oven|washer|dryer|dishwasher|appliance/i,
  painting: /paint/i,
  turn: /turnover|turn\b|vacant|make.?ready/i,
  inspection: /inspect/i,
};
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
// street-type words don't identify a property ("st", "ave"…)
const ADDR_STOP = new Set(['st', 'street', 'ave', 'avenue', 'rd', 'road', 'dr', 'drive', 'ln', 'lane', 's', 'n', 'e', 'w', 'south', 'north', 'east', 'west']);

export function parseVoice(text, properties, techs) {
  const out = { task: text.trim(), category: 'general' };
  const t = ' ' + text.toLowerCase().replace(/\s+/g, ' ') + ' ';

  // unit: "unit 4B" / "apt 12" — or a bare token like "3C"
  const unitM = t.match(/\b(?:unit|apartment|apt\.?)\s*#?\s*([a-z]?\d+[a-z]?)\b/i)
    || t.match(/\b(\d{1,3}[a-z])\b/i);
  if (unitM) out.unit = unitM[1].toUpperCase();

  // property: score by distinctive words ("paul", "central"…) + street number
  let best = null, bestScore = 0, bestWords = [];
  for (const p of properties) {
    const words = p.name.toLowerCase().split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !ADDR_STOP.has(w) && !/^\d+$/.test(w));
    const hit = words.filter((w) => t.includes(w));
    let score = hit.length;
    const streetNum = p.name.match(/^\d+/)?.[0];
    if (streetNum && new RegExp(`\\b${streetNum}\\b`).test(t)) score += 2;
    if (score > bestScore) { bestScore = score; best = p; bestWords = words; }
  }
  if (best && bestScore > 0) out.propLabel = best.name;

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

  // distill the task: drop filler + everything we already extracted
  let task = ' ' + text + ' ';
  task = task
    .replace(/\b(hey|hi|okay|ok|please|thanks|thank you)\b/gi, ' ')
    .replace(/\b(can|could|would) you\b/gi, ' ')
    .replace(/\bassign\b/gi, ' ')
    .replace(/\bto do\b/gi, ' ');
  if (out.assigneeLabel) task = task.replace(new RegExp(`\\b${out.assigneeLabel.split(' ')[0]}\\b`, 'gi'), ' ');
  if (out.propLabel) {
    for (const w of best.name.split(/[^a-zA-Z0-9]+/).filter(Boolean)) {
      task = task.replace(new RegExp(`\\b${w}\\b`, 'gi'), ' ');
    }
  }
  if (out.unit) task = task.replace(new RegExp(`\\b(unit\\s*)?${out.unit}\\b`, 'gi'), ' ');
  task = task.replace(/\b(tomorrow|today)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  // shed dangling connectors: "painting over at" → "painting"
  const CONN = /^(and|or|over|at|in|on|for|to|the|a)\s+|\s+(and|or|over|at|in|on|for|to|the|a)$/i;
  let prev;
  do { prev = task; task = task.replace(CONN, ' ').trim(); } while (task !== prev && task);
  out.task = task || text.trim();
  return out;
}

const CATS = ['plumbing', 'electrical', 'hvac', 'appliance', 'painting', 'turn', 'general', 'inspection'];
const STATUS_COLORS = { open: 'var(--info)', in_progress: 'var(--warn)', done: 'var(--money)', cancelled: 'var(--text-faint)' };
export const WO_PRIORITIES = {
  1: { label: 'urgent', color: 'var(--danger)' },
  2: { label: 'high', color: 'var(--warn)' },
  3: { label: 'normal', color: 'var(--info)' },
  4: { label: 'low', color: 'var(--text-faint)' },
};
export const byPriority = (a, b) =>
  (a.priority ?? 3) - (b.priority ?? 3) || String(a.due || '9999').localeCompare(String(b.due || '9999'));

const inputStyle = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)',
  color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 14, padding: 11, borderRadius: 10,
};

export default function WorkOrders({ store }) {
  const { workOrders, addWorkOrder, setWoStatus, setWoPriority, properties, techs, role, woBackend, purchases = [] } = store;
  const receiptsByWo = useMemo(() => {
    const m = {};
    for (const p of purchases) if (p.workOrderId) (m[p.workOrderId] ||= []).push(p);
    return m;
  }, [purchases]);
  const [draft, setDraft] = useState(null);   // form state when creating
  const [listening, setListening] = useState(false);
  const [liveText, setLiveText] = useState('');
  const [voiceErr, setVoiceErr] = useState(null);
  const recRef = useRef(null);

  const isStaff = role === 'admin' || role === 'manager';
  // only the field crew starts/stops a job. Office dispatches & prioritizes.
  const canRun = role === 'tech';
  const open = useMemo(
    () => workOrders.filter((w) => w.status === 'open' || w.status === 'in_progress').sort(byPriority),
    [workOrders]
  );
  const closed = useMemo(() => workOrders.filter((w) => w.status === 'done' || w.status === 'cancelled'), [workOrders]);

  // crew: ask once so priority changes can reach the phone as notifications
  useEffect(() => {
    if (role === 'tech' && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, [role]);

  const startVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setVoiceErr('Voice input needs Chrome, Edge, or Safari.'); return; }
    setVoiceErr(null); setLiveText(''); setListening(true);
    const rec = new SR();
    recRef.current = rec;
    // single utterance: Android Chrome re-delivers the whole result set on
    // every event in continuous mode, so we rebuild the transcript from
    // scratch each time instead of appending (appending = duplicate storm)
    rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = false;
    let latest = '';
    rec.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      latest = text.replace(/\s+/g, ' ').trim();
      setLiveText(latest);
    };
    rec.onerror = (e) => { setVoiceErr(e.error === 'not-allowed' ? 'Microphone permission denied.' : 'Voice error: ' + e.error); setListening(false); };
    rec.onend = () => {
      setListening(false);
      if (latest) setDraft({ ...parseVoice(latest, properties, techs), transcript: latest, source: 'voice' });
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
              <IcMic width={16} height={16} /> {listening ? 'Listening… tap to finish' : 'Speak a work order'}
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
            <p className="note" style={{ marginTop: 2, marginBottom: 12, fontStyle: 'italic', maxHeight: 72, overflowY: 'auto' }}>“{draft.transcript}”</p>
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
        <span className="field-label">Open ({open.length}) — sorted by priority</span>
        {open.length === 0 && <p className="note">Nothing open. {isStaff ? 'Create one above — or just say it out loud.' : 'Nothing assigned to you right now.'}</p>}
        {open.map((w) => <WoRow key={w.id} w={w} setWoStatus={setWoStatus} setWoPriority={setWoPriority} isStaff={isStaff} canRun={canRun} receipts={receiptsByWo[w.id]} />)}
      </div>

      {closed.length > 0 && (
        <div className="card" style={{ marginTop: 'var(--gap)' }}>
          <span className="field-label">Closed ({closed.length})</span>
          {closed.map((w) => <WoRow key={w.id} w={w} setWoStatus={setWoStatus} setWoPriority={setWoPriority} isStaff={isStaff} canRun={canRun} receipts={receiptsByWo[w.id]} done />)}
        </div>
      )}
    </div>
  );
}

function WoRow({ w, setWoStatus, setWoPriority, isStaff, canRun, done, receipts = [] }) {
  const pr = WO_PRIORITIES[w.priority ?? 3];
  const [open, setOpen] = useState(false);
  const matTotal = receipts.filter((r) => r.status === 'approved').reduce((a, r) => a + (r.amount || 0), 0);
  return (
    <div className="pur-item">
      <div className="row">
        <div className="lead">
          <div className="t" style={done ? { color: 'var(--text-dim)', textDecoration: w.status === 'cancelled' ? 'line-through' : 'none' } : undefined}>
            {!done && <span style={{ color: pr.color, marginRight: 6 }}>●</span>}{w.task}
          </div>
          <div className="s">
            {[w.propLabel, w.unit && `Unit ${w.unit}`, w.category, w.assigneeLabel && `to ${w.assigneeLabel}`, w.due && `due ${w.due}`]
              .filter(Boolean).join(' · ')}
            {w.source === 'voice' && <IcMic width={11} height={11} style={{ marginLeft: 5, verticalAlign: '-1px' }} />}
            {receipts.length > 0 && <> · <a onClick={() => setOpen((o) => !o)} style={{ color: 'var(--money)', cursor: 'pointer' }}><IcReceipt width={11} height={11} style={{ verticalAlign: -1 }} /> {fmtMoneyC(matTotal)} materials ({receipts.length})</a></>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {isStaff && !done ? (
            <select
              value={w.priority ?? 3}
              onChange={(e) => setWoPriority(w.id, Number(e.target.value))}
              style={{ background: 'var(--surface-2)', border: '1px solid var(--line)', color: pr.color,
                fontFamily: 'var(--font)', fontWeight: 700, fontSize: 11, padding: '5px 6px', borderRadius: 8 }}>
              {Object.entries(WO_PRIORITIES).map(([v, p]) => <option key={v} value={v}>{p.label}</option>)}
            </select>
          ) : !done && (
            <span className="chip" style={{ color: pr.color }}>{pr.label}</span>
          )}
          <span className="chip" style={{ color: STATUS_COLORS[w.status] }}>{w.status.replace('_', ' ')}</span>
          {canRun && w.status === 'open' && <button className="btn ghost sm" onClick={() => setWoStatus(w.id, 'in_progress')}>Start</button>}
          {canRun && w.status === 'in_progress' && <button className="btn ghost sm" onClick={() => setWoStatus(w.id, 'done')}>Done</button>}
          {isStaff && !done && <button className="btn ghost sm icon-btn" style={{ color: 'var(--text-faint)' }} onClick={() => setWoStatus(w.id, 'cancelled')} aria-label="Cancel"><IcX width={14} height={14} /></button>}
        </div>
      </div>
      {open && receipts.length > 0 && (
        <div className="pur-items">
          {receipts.map((r) => (
            <div className="pur-item-row" key={r.id}>
              <span className="pi-desc">{r.vendor || 'Purchase'}{r.note ? ` · ${r.note}` : ''}</span>
              <span className="pi-qty mono" style={{ textTransform: 'capitalize' }}>{r.status}</span>
              <span className="pi-amt mono money">{fmtMoneyC(r.amount || 0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
