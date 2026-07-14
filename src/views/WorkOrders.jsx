import { useState, useRef, useMemo, useEffect } from 'react';
import { fmtMoneyC } from '../lib/rollups.js';
import { categoryForText } from '../lib/taskTags.js';
import { IcMic, IcX, IcPlay, IcReceipt, IcCamera, IcDoc, IcClip, IcSparkle, IcCheck } from '../components/ui.jsx';
import StoredImage from '../components/StoredImage.jsx';
import Lightbox from '../components/Lightbox.jsx';
import { FileChip } from '../components/FileChip.jsx';

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
    const first = (tech.name.split(' ')[0] || '').toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // escape regex metachars in names
    if (first && new RegExp(`\\b${first}\\b`).test(t)) {
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

const CATS = ['plumbing', 'electrical', 'hvac', 'appliance', 'doors', 'painting', 'turn', 'general', 'inspection'];
const STATUS_COLORS = { pending: 'var(--accent)', open: 'var(--info)', in_progress: 'var(--warn)', done: 'var(--money)', cancelled: 'var(--text-faint)' };
const STATUS_LABEL = { pending: 'reported', open: 'open', in_progress: 'in progress', done: 'done', cancelled: 'cancelled' };
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

export default function WorkOrders({ store, focus }) {
  // only ACTIVE operators are assignable; departed ones keep their history but
  // can't take new work (falls back to techs so nothing breaks pre-status-tag).
  const { workOrders, addWorkOrder, setWoStatus, setWoPriority, setWoAssignee, setWoBilling, addWoAttachment, setWoChecklist, checklistTemplates = [], addTimesheet, pickProperties: properties = [], activeTechs, techs: allTechs = [], role, woBackend, purchases = [], vendors = [] } = store;
  const techs = activeTechs || allTechs;
  // typing a #tag in the task auto-sets the category bucket (#mopping → turn)
  const setTask = (v) => setDraft((d) => { const c = categoryForText(v); return { ...d, task: v, ...(c ? { category: c } : {}) }; });
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
  const canReport = role === 'tech';   // crew report a repair from the field → a pending WO
  const open = useMemo(
    () => workOrders.filter((w) => w.status === 'open' || w.status === 'in_progress').sort(byPriority),
    [workOrders]
  );
  const pending = useMemo(() => workOrders.filter((w) => w.status === 'pending').sort(byPriority), [workOrders]);
  const closed = useMemo(() => workOrders.filter((w) => w.status === 'done' || w.status === 'cancelled'), [workOrders]);

  // crew: ask once so priority changes can reach the phone as notifications
  useEffect(() => {
    if (role === 'tech' && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, [role]);

  // drill-down from a unit ("New work order for this unit") → open a prefilled draft
  useEffect(() => {
    if (focus?.newFor) setDraft((d) => { if (d?.photoPreview) URL.revokeObjectURL(d.photoPreview); return { task: '', detail: '', source: 'manual', priority: 3, ...focus.newFor }; });
  }, [focus]);

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
    try { rec.start(); } catch { setListening(false); }
  };
  const stopVoice = () => recRef.current?.stop();

  // dictate straight into one form field (What's wrong / Details) — hands-free
  // fill-out for gloves-on field reports. Appends to whatever's already there.
  const [dictating, setDictating] = useState(null); // 'task' | 'detail' | null
  const dictRef = useRef(null);
  const startDictation = (field) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setVoiceErr('Voice needs Chrome, Edge, or Android.'); return; }
    if (dictating) { dictRef.current?.stop(); return; }
    setVoiceErr(null); setDictating(field);
    const rec = new SR(); dictRef.current = rec;
    rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = false;
    const base = (draft[field] || '').trim();
    rec.onresult = (e) => {
      let text = ''; for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      text = text.replace(/\s+/g, ' ').trim();
      setDraft((d) => ({ ...d, [field]: base ? `${base} ${text}` : text }));
    };
    rec.onerror = (e) => { setVoiceErr(e.error === 'not-allowed' ? 'Microphone permission denied.' : 'Voice error: ' + e.error); setDictating(null); };
    rec.onend = () => setDictating(null);
    try { rec.start(); } catch { setDictating(null); } // start throws if a recognizer is still winding down — don't stick "Listening…"
  };
  // stop any live recognizer when leaving the view (mic off, no setState-after-unmount)
  useEffect(() => () => { try { recRef.current?.stop(); } catch { /* */ } try { dictRef.current?.stop(); } catch { /* */ } }, []);

  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const wo = await addWorkOrder(draft);
      // a field report requires a photo — attach it to the new work order
      if (draft.photoFile && wo?.id) { try { await addWoAttachment(wo.id, draft.photoFile); } catch { /* WO still created */ } }
      // logged pivot work: land the hours as a timesheet entry tied to this WO,
      // so the office approves the work and its labor together
      if (draft.logWork && Number(draft.hours) > 0 && addTimesheet) {
        try {
          const res = await addTimesheet({
            date: new Date().toISOString().slice(0, 10),
            propLabel: draft.propLabel || 'Unassigned', unit: draft.unit || '',
            category: draft.category || 'general', note: draft.task || '',
            durationHrs: Number(draft.hours), workOrderId: wo?.id || null,
          });
          // login not linked to an operator → the hours can't sync (timers.operator_id
          // is required). The work order still saved; tell them so the labor isn't lost.
          if (res?.needsOperator) alert('Work order saved, but your login isn’t linked to an operator, so the logged hours stay on this device only. Ask the office to link your account to sync them.');
        } catch { /* WO still created; hours can be added from the timesheet */ }
      }
      if (draft.photoPreview) URL.revokeObjectURL(draft.photoPreview);
      setDraft(null); setLiveText('');
    } finally { setSaving(false); }
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

      {/* crew: report a repair, or log unplanned work they pivoted to — both land
          as a pending work order the office approves (log work carries its hours). */}
      {canReport && !draft && (
        <div className="card" style={{ marginBottom: 'var(--gap)' }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn grad" style={{ flex: 1, minWidth: 150 }} onClick={() => setDraft({ task: '', detail: '', category: 'general', source: 'field', status: 'pending', priority: 3, report: true })}>
              + Report a repair
            </button>
            <button className="btn ghost" style={{ flex: 1, minWidth: 150 }} onClick={() => setDraft({ task: '', detail: '', category: 'general', source: 'field_log', status: 'pending', priority: 3, logWork: true, hours: '' })}>
              + Log work I did
            </button>
          </div>
          <p className="note" style={{ marginTop: 8, marginBottom: 0 }}>Found something to fix? <b>Report a repair</b> — office assigns the vendor. Pivoted to a job with no order? <b>Log work I did</b> — it routes to the office for approval, with your hours.</p>
        </div>
      )}

      {draft && (
        <div className="card" style={{ marginBottom: 'var(--gap)' }}>
          <span className="field-label">{draft.report ? 'Report a repair' : draft.logWork ? 'Log work I did' : draft.source === 'voice' ? 'Heard it — check the details' : 'New work order'}</span>
          {draft.transcript && (
            <p className="note" style={{ marginTop: 2, marginBottom: 12, fontStyle: 'italic', maxHeight: 72, overflowY: 'auto' }}>“{draft.transcript}”</p>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="field-label" style={{ margin: 0 }}>{draft.report ? 'What’s wrong' : draft.logWork ? 'What you did' : 'Task'}</span>
            <button className={'btn sm ' + (dictating === 'task' ? 'stop' : 'ghost')} style={{ width: 'auto' }} onClick={() => startDictation('task')}>
              <IcMic width={13} height={13} /> {dictating === 'task' ? 'Listening…' : 'Speak'}
            </button>
          </div>
          <input style={inputStyle} value={draft.task} onChange={(e) => setTask(e.target.value)} placeholder={draft.report ? 'e.g. garage door won’t shut' : draft.logWork ? 'e.g. #mopping + #trash haul, 2nd floor' : 'what needs doing — # to tag'} />
          <div style={{ height: 12 }} />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="field-label" style={{ margin: 0 }}>Details {draft.report ? '· what you saw / tried' : '(optional)'}</span>
            <button className={'btn sm ' + (dictating === 'detail' ? 'stop' : 'ghost')} style={{ width: 'auto' }} onClick={() => startDictation('detail')}>
              <IcMic width={13} height={13} /> {dictating === 'detail' ? 'Listening…' : 'Speak'}
            </button>
          </div>
          <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={draft.detail || ''} onChange={(e) => setDraft({ ...draft, detail: e.target.value })}
            placeholder={draft.report ? 'e.g. temp shut by aligning the photo-eye sensors, but it needs a real look' : 'anything the tech should know'} />
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
            {!draft.report && (
              <div>
                <div className="field-label">Assign to</div>
                <select style={inputStyle} value={draft.assigneeLabel || ''} onChange={(e) => setDraft({ ...draft, assigneeLabel: e.target.value || null })}>
                  <option value="">— unassigned —</option>
                  {techs.length > 0 && (
                    <optgroup label="Crew">
                      {techs.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                    </optgroup>
                  )}
                  {(() => {
                    // approved contractors, trade-matching the chosen category first
                    const want = draft.category === 'painting' ? 'paint' : draft.category;
                    const cons = vendors.filter((v) => v.approved && v.kind === 'contractor')
                      .sort((a, b) => (Number(b.trade === want) - Number(a.trade === want)) || a.name.localeCompare(b.name));
                    return cons.length > 0 && (
                      <optgroup label="Approved contractors">
                        {cons.map((v) => <option key={v.id} value={v.name}>{v.name}{v.trade ? ` · ${v.trade}` : ''}</option>)}
                      </optgroup>
                    );
                  })()}
                </select>
              </div>
            )}
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

          {draft.logWork && (
            <>
              <div className="field-label" style={{ marginTop: 12 }}>Hours worked</div>
              <input style={{ ...inputStyle, maxWidth: 160 }} type="number" step="0.25" min="0" inputMode="decimal"
                value={draft.hours || ''} onChange={(e) => setDraft({ ...draft, hours: e.target.value })} placeholder="e.g. 1.5" />
              <p className="note" style={{ margin: '6px 0 0' }}>These hours route to the office with the work order — approved together.</p>
            </>
          )}

          <div className="field-label" style={{ marginTop: 12 }}>Priority</div>
          <div className="pick">
            {Object.entries(WO_PRIORITIES).map(([v, p]) => (
              <button key={v} className={(draft.priority ?? 3) === Number(v) ? 'on' : ''} onClick={() => setDraft({ ...draft, priority: Number(v) })}
                style={(draft.priority ?? 3) === Number(v) ? { color: p.color, borderColor: p.color } : undefined}>{p.label}</button>
            ))}
          </div>

          {/* photo — required on a field report (a picture is the whole point of reporting) */}
          <div className="field-label" style={{ marginTop: 12 }}>Photo {draft.report ? <span style={{ color: 'var(--danger)' }}>· required</span> : '(optional)'}</div>
          {draft.photoFile ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px' }}>
              <img src={draft.photoPreview} alt="attachment" style={{ width: 46, height: 46, objectFit: 'cover', borderRadius: 8 }} />
              <span className="s" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{draft.photoFile.name || 'photo attached'}</span>
              <button className="btn ghost sm" onClick={() => { if (draft.photoPreview) URL.revokeObjectURL(draft.photoPreview); setDraft({ ...draft, photoFile: null, photoPreview: null }); }}>Remove</button>
            </div>
          ) : (
            <label className="btn ghost" style={{ width: 'auto', cursor: 'pointer', display: 'inline-flex' }}>
              <IcCamera width={16} height={16} /> Take / attach a photo
              <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => {
                const f = e.target.files?.[0] || null; e.target.value = '';
                if (draft.photoPreview) URL.revokeObjectURL(draft.photoPreview);
                setDraft({ ...draft, photoFile: f, photoPreview: f ? URL.createObjectURL(f) : null });
              }} />
            </label>
          )}

          {/* crew report: surface who office would likely call, from the approved rolodex */}
          {draft.report && (() => {
            const want = draft.category === 'painting' ? 'paint' : draft.category;
            const v = vendors.filter((x) => x.approved && x.kind === 'contractor').find((x) => x.trade === want);
            return v ? (
              <p className="note" style={{ marginTop: 12, marginBottom: 0 }}>
                <IcSparkle width={12} height={12} style={{ verticalAlign: -2 }} /> Likely vendor for {draft.category}: <b>{v.name}</b>{v.phone ? ` · ${v.phone}` : ''} — office confirms & dispatches.
              </p>
            ) : null;
          })()}

          {draft.report && !draft.photoFile && <p className="note" style={{ marginTop: 10, marginBottom: 0, color: 'var(--text-faint)' }}>Add a photo to send — it’s how office sees what you’re looking at.</p>}
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button className="btn ghost" style={{ width: 'auto', flex: 1 }} onClick={() => { if (draft.photoPreview) URL.revokeObjectURL(draft.photoPreview); setDraft(null); }}>Cancel</button>
            <button className="btn grad" style={{ flex: 2 }} onClick={save} disabled={saving || !draft.task?.trim() || (draft.report && !draft.photoFile)}>
              {saving ? 'Sending…' : draft.report ? 'Send report to office' : 'Create work order'}
            </button>
          </div>
        </div>
      )}

      {/* tenant-billing summary (office) */}
      {isStaff && (() => {
        let charged = 0, collected = 0, n = 0;
        for (const w of workOrders) if (w.serviceFee > 0) { charged += w.serviceFee; n++; if (w.tenantBilled === 'paid') collected += w.serviceFee; }
        if (!n) return null;
        return (
          <div className="rr-kpis" style={{ marginBottom: 'var(--gap)' }}>
            <div className="kpi-c"><span className="v mono">{fmtMoneyC(charged)}</span><span className="k">tenant charges · {n}</span></div>
            <div className="kpi-c"><span className="v mono" style={{ color: 'var(--money)' }}>{fmtMoneyC(collected)}</span><span className="k">collected</span></div>
            <div className="kpi-c"><span className="v mono" style={{ color: 'var(--warn)' }}>{fmtMoneyC(charged - collected)}</span><span className="k">outstanding</span></div>
          </div>
        );
      })()}

      {/* ---- pending: crew reports awaiting office triage ---- */}
      {pending.length > 0 && (
        <div className="card" style={{ marginBottom: 'var(--gap)', borderColor: 'color-mix(in srgb, var(--accent) 40%, var(--line))' }}>
          <span className="field-label">
            {isStaff ? `Reported from the field — needs triage (${pending.length})` : `Your reports — waiting on office (${pending.length})`}
          </span>
          {pending.map((w) => (
            <WoRow key={w.id} w={w} setWoStatus={setWoStatus} setWoPriority={setWoPriority} setWoAssignee={setWoAssignee} setWoBilling={setWoBilling}
              isStaff={isStaff} canRun={canRun} canAttach={isStaff || role === 'tech'} addWoAttachment={addWoAttachment} receipts={receiptsByWo[w.id]}
              vendors={vendors} techs={techs} templates={checklistTemplates} setChecklist={setWoChecklist} canCheckList={isStaff || canRun} canEditList={isStaff} />
          ))}
        </div>
      )}

      {/* ---- open ---- */}
      <div className="card">
        <span className="field-label">Open ({open.length}) — sorted by priority</span>
        {open.length === 0 && <p className="note">Nothing open. {isStaff ? 'Create one above — or just say it out loud.' : 'Nothing assigned to you right now.'}</p>}
        {open.map((w) => <WoRow key={w.id} w={w} setWoStatus={setWoStatus} setWoPriority={setWoPriority} setWoBilling={setWoBilling} isStaff={isStaff} canRun={canRun} canAttach={isStaff || role === 'tech'} addWoAttachment={addWoAttachment} receipts={receiptsByWo[w.id]} templates={checklistTemplates} setChecklist={setWoChecklist} canCheckList={isStaff || canRun} canEditList={isStaff} />)}
      </div>

      {closed.length > 0 && (
        <div className="card" style={{ marginTop: 'var(--gap)' }}>
          <span className="field-label">Closed ({closed.length})</span>
          {closed.map((w) => <WoRow key={w.id} w={w} setWoStatus={setWoStatus} setWoPriority={setWoPriority} setWoBilling={setWoBilling} isStaff={isStaff} canRun={canRun} canAttach={isStaff || role === 'tech'} addWoAttachment={addWoAttachment} receipts={receiptsByWo[w.id]} templates={checklistTemplates} setChecklist={setWoChecklist} canCheckList={isStaff || canRun} canEditList={isStaff} done />)}
        </div>
      )}
    </div>
  );
}

const BILL_LABEL = { no: 'not billed', billed: 'billed', paid: 'paid' };
const BILL_COLOR = { no: 'var(--text-faint)', billed: 'var(--warn)', paid: 'var(--money)' };

function WoRow({ w, setWoStatus, setWoPriority, setWoAssignee, setWoBilling, isStaff, canRun, canAttach, addWoAttachment, done, receipts = [], vendors = [], techs = [], templates = [], setChecklist, canCheckList, canEditList }) {
  const pr = WO_PRIORITIES[w.priority ?? 3];
  const [open, setOpen] = useState(false);
  const [billOpen, setBillOpen] = useState(false);
  const [attOpen, setAttOpen] = useState(false);
  const [clOpen, setClOpen] = useState(false);
  const checklist = Array.isArray(w.checklist) ? w.checklist : null;
  const clDone = checklist ? checklist.filter((i) => i.done).length : 0;
  const [upBusy, setUpBusy] = useState(false);
  const [lb, setLb] = useState(null); // lightbox start index
  const photos = w.photos || [];
  const files = w.files || [];
  const nAtt = photos.length + files.length;
  const lbItems = photos.map((p) => ({ bucket: 'attachments', ...(/^(data:|https?:|\/)/.test(p) ? { data: p } : { path: p }), name: 'Job photo' }));
  const matTotal = receipts.filter((r) => r.status === 'approved').reduce((a, r) => a + (r.amount || 0), 0);
  const pickFile = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    setUpBusy(true);
    try { await addWoAttachment(w.id, f); } finally { setUpBusy(false); }
  };
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
            {nAtt > 0
              ? <> · <a onClick={() => setAttOpen((o) => !o)} style={{ color: 'var(--info)', cursor: 'pointer' }}><IcClip width={11} height={11} style={{ verticalAlign: -1 }} /> {nAtt}</a></>
              : (canAttach && addWoAttachment) && <> · <a onClick={() => setAttOpen(true)} style={{ color: 'var(--text-faint)', cursor: 'pointer' }}><IcClip width={11} height={11} style={{ verticalAlign: -1 }} /> add photo</a></>}
            {setChecklist && (checklist
              ? <> · <a onClick={() => setClOpen((o) => !o)} style={{ color: clDone === checklist.length && checklist.length ? 'var(--money)' : 'var(--warn)', cursor: 'pointer' }}><IcCheck width={11} height={11} style={{ verticalAlign: -1 }} /> {clDone}/{checklist.length}</a></>
              : (canEditList && <> · <a onClick={() => setClOpen(true)} style={{ color: 'var(--text-faint)', cursor: 'pointer' }}><IcCheck width={11} height={11} style={{ verticalAlign: -1 }} /> checklist</a></>))}
            {isStaff && setWoBilling && <> · <a onClick={() => setBillOpen((o) => !o)} style={{ color: w.serviceFee > 0 ? BILL_COLOR[w.tenantBilled || 'no'] : 'var(--text-faint)', cursor: 'pointer' }}>
              {w.serviceFee > 0 ? <>{fmtMoneyC(w.serviceFee)} · {BILL_LABEL[w.tenantBilled || 'no']}</> : 'bill tenant'}</a></>}
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
          <span className="chip" style={{ color: STATUS_COLORS[w.status] }}>{STATUS_LABEL[w.status] || w.status.replace('_', ' ')}</span>
          {canRun && w.status === 'open' && <button className="btn ghost sm" onClick={() => setWoStatus(w.id, 'in_progress')}>Start</button>}
          {canRun && w.status === 'in_progress' && <button className="btn ghost sm" onClick={() => setWoStatus(w.id, 'done')}>Done</button>}
          {isStaff && !done && w.status !== 'pending' && <button className="btn ghost sm icon-btn" style={{ color: 'var(--text-faint)' }} onClick={() => setWoStatus(w.id, 'cancelled')} aria-label="Cancel"><IcX width={14} height={14} /></button>}
        </div>
      </div>

      {/* office triage of a field report: confirm the vendor, then approve → open */}
      {isStaff && w.status === 'pending' && (
        <div style={{ marginTop: 8, padding: 10, background: 'var(--surface-2)', borderRadius: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {w.detail && <div className="s" style={{ width: '100%', color: 'var(--text-dim)', marginBottom: 2 }}>“{w.detail}”</div>}
          {setWoAssignee && (
            <select value={w.assigneeLabel || ''} onChange={(e) => setWoAssignee(w.id, e.target.value || null)}
              style={{ background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 12, padding: '6px 8px', borderRadius: 8, flex: 1, minWidth: 150 }}>
              <option value="">— assign a vendor / crew —</option>
              {(() => {
                const want = w.category === 'painting' ? 'paint' : w.category;
                const cons = vendors.filter((v) => v.approved && v.kind === 'contractor')
                  .sort((a, b) => (Number(b.trade === want) - Number(a.trade === want)) || (a.name || '').localeCompare(b.name || ''));
                return (
                  <>
                    {cons.length > 0 && <optgroup label="Approved contractors">{cons.map((v) => <option key={v.id} value={v.name}>{v.name}{v.trade ? ` · ${v.trade}` : ''}</option>)}</optgroup>}
                    {techs.length > 0 && <optgroup label="Crew">{techs.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}</optgroup>}
                  </>
                );
              })()}
            </select>
          )}
          <button className="btn grad sm" onClick={() => setWoStatus(w.id, 'open')}><IcCheck width={13} height={13} /> Approve → open</button>
          <button className="btn ghost sm" onClick={() => setWoStatus(w.id, 'cancelled')}>Dismiss</button>
        </div>
      )}
      {billOpen && isStaff && setWoBilling && <WoBilling w={w} matTotal={matTotal} onSave={(patch) => setWoBilling(w.id, patch)} />}

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

      {attOpen && (
        <div style={{ paddingBottom: 12 }}>
          {photos.length > 0 && (
            <div className="photo-strip">
              {photos.map((p, i) => {
                const isData = /^(data:|https?:|\/)/.test(p);
                return <StoredImage key={i} bucket="attachments" path={isData ? null : p} data={isData ? p : null} alt="Job photo" onOpen={() => setLb(i)} />;
              })}
            </div>
          )}
          {files.length > 0 && (
            <div className="file-list">
              {files.map((f, i) => {
                const isData = /^(data:|https?:|\/)/.test(f.path);
                return <FileChip key={i} path={isData ? null : f.path} data={isData ? f.path : null} name={f.name} />;
              })}
            </div>
          )}
          {canAttach && addWoAttachment && (
            <label className={'upload-tile compact' + (upBusy ? ' busy' : '')} style={{ marginTop: (photos.length || files.length) ? 10 : 0 }}>
              <span className="ut-ic"><IcCamera width={17} height={17} /></span>
              <span className="ut-main">
                <span className="ut-title">{upBusy ? 'Uploading…' : (photos.length || files.length) ? 'Add another' : 'Add photo or file'}</span>
                <span className="ut-sub">Photos, PDFs — document the job</span>
              </span>
              <input type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.heic" onChange={pickFile} />
            </label>
          )}
        </div>
      )}
      {clOpen && setChecklist && <WoChecklist w={w} checklist={checklist} templates={templates} canCheck={canCheckList} canEdit={canEditList} onChange={(next) => setChecklist(w.id, next)} />}
      {lb !== null && lbItems.length > 0 && <Lightbox items={lbItems} index={lb} onClose={() => setLb(null)} />}
    </div>
  );
}

// templated task list on a work order. Office applies a template or adds items;
// crew (and office) check them off as the job gets done. Progress rides the row.
const clId = () => 'ci_' + Math.random().toString(36).slice(2, 9);
function WoChecklist({ checklist, templates = [], canCheck, canEdit, onChange }) {
  const [adding, setAdding] = useState('');
  const items = Array.isArray(checklist) ? checklist : [];
  const relevant = templates.filter((t) => t.kind === 'any' || t.kind === 'workorder');
  const toggle = (id) => onChange(items.map((i) => (i.id === id ? { ...i, done: !i.done, doneAt: !i.done ? new Date().toISOString() : null } : i)));
  const removeItem = (id) => onChange(items.filter((i) => i.id !== id));
  const addItem = () => { const t = adding.trim(); if (!t) return; onChange([...items, { id: clId(), text: t, done: false }]); setAdding(''); };
  const applyTemplate = (tmpl) => {
    if (!tmpl) return;
    const add = (tmpl.items || []).map((text) => ({ id: clId(), text, done: false }));
    onChange([...items, ...add]);
  };
  const pct = items.length ? Math.round((items.filter((i) => i.done).length / items.length) * 100) : 0;
  return (
    <div className="pur-items" style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span className="field-label" style={{ margin: 0 }}>Checklist</span>
        {items.length > 0 && <span className="mono" style={{ fontSize: 11, color: pct === 100 ? 'var(--money)' : 'var(--text-dim)' }}>{pct}%</span>}
        {canEdit && relevant.length > 0 && (
          <select onChange={(e) => { const t = relevant.find((x) => x.id === e.target.value); applyTemplate(t); e.target.value = ''; }} defaultValue=""
            style={{ marginLeft: 'auto', background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 12, padding: '5px 7px', borderRadius: 8 }}>
            <option value="" disabled>+ Apply template…</option>
            {relevant.map((t) => <option key={t.id} value={t.id}>{t.name} ({(t.items || []).length})</option>)}
          </select>
        )}
      </div>
      {items.length > 0 && (
        <div style={{ height: 4, background: 'var(--surface-2)', borderRadius: 3, overflow: 'hidden', marginBottom: 10 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? 'var(--money)' : 'var(--accent)', transition: 'width .2s' }} />
        </div>
      )}
      {items.length === 0 && <p className="note" style={{ margin: '0 0 8px' }}>No items yet.{canEdit ? ' Apply a template or add steps below.' : ''}</p>}
      {items.map((i) => (
        <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 0' }}>
          <input type="checkbox" checked={!!i.done} disabled={!canCheck} onChange={() => toggle(i.id)} style={{ width: 17, height: 17, flex: 'none', cursor: canCheck ? 'pointer' : 'default' }} />
          <span style={{ flex: 1, fontSize: 13, textDecoration: i.done ? 'line-through' : 'none', color: i.done ? 'var(--text-dim)' : 'var(--text)' }}>{i.text}</span>
          {canEdit && <button className="btn ghost sm icon-btn" style={{ color: 'var(--text-faint)' }} onClick={() => removeItem(i.id)} aria-label="Remove item"><IcX width={12} height={12} /></button>}
        </div>
      ))}
      {canEdit && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }} placeholder="Add a step…"
            style={{ flex: 1, background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 13, padding: 8, borderRadius: 8 }} />
          <button className="btn ghost sm" onClick={addItem} disabled={!adding.trim()}>Add</button>
        </div>
      )}
    </div>
  );
}

// tenant billing on a work order — replaces the spreadsheet Service Log columns:
// what we charge (service fee), what it cost (repair cost), and billed state.
const billInput = { width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: 14, padding: 8, borderRadius: 8 };
function WoBilling({ w, matTotal = 0, onSave }) {
  const [fee, setFee] = useState(w.serviceFee ?? '');
  const [cost, setCost] = useState(w.repairCost ?? '');
  const num = (v) => { if (v === '' || v == null) return null; const n = Math.round(parseFloat(v) * 100) / 100; return Number.isFinite(n) ? n : null; };
  const feeN = num(fee) || 0;
  const costN = num(cost) ?? matTotal;   // default cost to logged materials (NaN → materials, never NaN margin)
  const margin = feeN - costN;
  const STATES = [['no', 'Not billed'], ['billed', 'Billed'], ['paid', 'Paid']];
  return (
    <div className="pur-items" style={{ padding: 12 }}>
      <span className="field-label" style={{ margin: '0 0 8px' }}>Tenant billing</span>
      <div className="grid g2" style={{ gap: 8 }}>
        <div>
          <div className="field-label" style={{ marginTop: 0 }}>Service fee (charge)</div>
          <input style={billInput} type="number" step="1" min="0" inputMode="decimal" value={fee}
            onChange={(e) => setFee(e.target.value)} onBlur={() => onSave({ serviceFee: num(fee) })} placeholder="0.00" />
        </div>
        <div>
          <div className="field-label" style={{ marginTop: 0 }}>Repair cost</div>
          <input style={billInput} type="number" step="1" min="0" inputMode="decimal" value={cost}
            onChange={(e) => setCost(e.target.value)} onBlur={() => onSave({ repairCost: num(cost) })}
            placeholder={matTotal ? `${matTotal.toFixed(2)} (materials)` : '0.00'} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
        <div className="pick" style={{ margin: 0 }}>
          {STATES.map(([v, l]) => <button key={v} className={(w.tenantBilled || 'no') === v ? 'on' : ''} onClick={() => onSave({ tenantBilled: v })}>{l}</button>)}
        </div>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 12, color: margin >= 0 ? 'var(--money)' : 'var(--danger)' }}>
          margin {margin < 0 ? '-$' : '$'}{Math.abs(margin).toFixed(2)}
        </span>
      </div>
      <p className="note" style={{ margin: '8px 0 0' }}>Charge the tenant a service fee, track it against what the repair cost — and whether they've paid. Replaces the Service Log's billing columns.</p>
    </div>
  );
}
