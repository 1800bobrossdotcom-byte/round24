import { useState, useMemo } from 'react';
import ConfirmButton from '../components/ConfirmButton.jsx';
import { IcBuilding, IcWrench, IcX, IcTrash, IcCheck, IcClip, IcChevron } from '../components/ui.jsx';

// the make-ready / turnover pipeline. A vacant unit moves left → right until it's
// leased again; each stage is lost rent until it does. Office planning surface.
const STAGES = [
  ['notice', 'Notice', 'var(--info)'],
  ['vacant', 'Vacant', 'var(--warn)'],
  ['make_ready', 'Make-ready', 'var(--accent)'],
  ['ready', 'Ready to lease', 'var(--money)'],
  ['leased', 'Leased', 'var(--text-dim)'],
];
const STAGE_LABEL = Object.fromEntries(STAGES.map(([k, l]) => [k, l]));
const STAGE_COLOR = Object.fromEntries(STAGES.map(([k, , c]) => [k, c]));
const nextStage = (s) => { const i = STAGES.findIndex(([k]) => k === s); return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1][0] : s; };

function todayISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function fmtDate(iso) { return iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; }
function daysSince(iso) { return iso ? Math.round((new Date(`${todayISO()}T00:00:00`) - new Date(`${iso}T00:00:00`)) / 86400000) : null; }
const clId = () => 'ci_' + Math.random().toString(36).slice(2, 9);

const inp = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)',
  color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 14, padding: 9, borderRadius: 3,
};
const blankTurn = () => ({ propLabel: '', unit: '', stage: 'notice', moveOut: '', targetReady: '', assigneeLabel: '', marketRent: '', notes: '', checklist: null });

export default function Turns({ store, navigate }) {
  const { unitTurns = [], setTurn, removeTurn, createTurnWorkOrder,
    checklistTemplates = [], setTemplate, removeTemplate,
    pickProperties: properties = [], activeTechs = [], role } = store;
  const isOffice = role === 'admin' || role === 'manager';
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showTmpl, setShowTmpl] = useState(false);
  const [expanded, setExpanded] = useState(null); // turn id whose checklist is open

  const active = useMemo(() => unitTurns.filter((t) => t.stage !== 'leased'), [unitTurns]);
  const byStage = useMemo(() => {
    const m = {}; for (const [k] of STAGES) m[k] = [];
    for (const t of unitTurns) (m[t.stage] || (m[t.stage] = [])).push(t);
    return m;
  }, [unitTurns]);
  // lost rent riding in the pipeline = market rent of every not-yet-leased turn
  const lostRent = useMemo(() => active.reduce((a, t) => a + (Number(t.marketRent) || 0), 0), [active]);

  if (!isOffice) {
    return (
      <div>
        <div className="view-head"><h1>Make-ready</h1></div>
        <div className="card"><p className="note">Unit turns are planned by the office. Make-ready work orders show up in your <b>Orders</b> and <b>Field</b> tabs like any other job.</p></div>
      </div>
    );
  }

  const save = async () => {
    if (!edit.propLabel && !edit.unit) return;
    setBusy(true);
    await setTurn({ ...edit, marketRent: edit.marketRent === '' ? null : Number(edit.marketRent) });
    setBusy(false); setEdit(null);
  };
  const advance = (t) => { const ns = nextStage(t.stage); setTurn({ id: t.id, stage: ns, ...(ns === 'ready' ? { actualReady: todayISO() } : {}) }); };
  const makeWO = async (t) => { setBusy(true); const wo = await createTurnWorkOrder(t); setBusy(false); if (wo && navigate) navigate('wo'); };
  const setChecklist = (t, next) => setTurn({ id: t.id, checklist: next });

  const card = (t) => {
    const days = daysSince(t.moveOut);
    const cl = Array.isArray(t.checklist) ? t.checklist : null;
    const clDone = cl ? cl.filter((i) => i.done).length : 0;
    const late = t.targetReady && t.stage !== 'ready' && t.stage !== 'leased' && t.targetReady < todayISO();
    return (
      <div className="card" key={t.id} style={{ marginBottom: 10, padding: 12, borderLeft: `3px solid ${STAGE_COLOR[t.stage]}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>{t.propLabel || 'Unit'}{t.unit ? ` · ${t.unit}` : ''}</div>
            <div className="s" style={{ marginTop: 2 }}>
              {[t.moveOut && `out ${fmtDate(t.moveOut)}`, t.targetReady && `ready by ${fmtDate(t.targetReady)}`, days != null && days >= 0 && `${days}d in turn`, t.assigneeLabel]
                .filter(Boolean).join(' · ')}
              {late && <span className="chip" style={{ marginLeft: 6, color: 'var(--danger)' }}>past target</span>}
            </div>
            {t.marketRent > 0 && <div className="s" style={{ color: 'var(--warn)' }}>${Number(t.marketRent).toLocaleString()}/mo at risk</div>}
          </div>
          <ConfirmButton className="btn ghost sm icon-btn" style={{ color: 'var(--text-faint)' }} label="Delete turn?" yes="Delete" onConfirm={() => removeTurn(t.id)} aria-label="Delete"><IcTrash width={12} height={12} /></ConfirmButton>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
          {cl && <a onClick={() => setExpanded((e) => (e === t.id ? null : t.id))} style={{ fontSize: 12, cursor: 'pointer', color: clDone === cl.length && cl.length ? 'var(--money)' : 'var(--warn)' }}><IcCheck width={11} height={11} style={{ verticalAlign: -1 }} /> {clDone}/{cl.length}</a>}
          {!cl && <a onClick={() => setExpanded((e) => (e === t.id ? null : t.id))} style={{ fontSize: 12, cursor: 'pointer', color: 'var(--text-faint)' }}><IcCheck width={11} height={11} style={{ verticalAlign: -1 }} /> checklist</a>}
          <span style={{ flex: 1 }} />
          {t.workOrderId
            ? <span className="chip" style={{ color: 'var(--money)' }}><IcWrench width={11} height={11} style={{ verticalAlign: -1 }} /> WO</span>
            : <button className="btn ghost sm" onClick={() => makeWO(t)} disabled={busy}><IcWrench width={12} height={12} /> WO</button>}
          <button className="btn ghost sm" onClick={() => setEdit({ ...t, marketRent: t.marketRent ?? '' })}>Edit</button>
          {t.stage !== 'leased' && <button className="btn grad sm" onClick={() => advance(t)}>{t.stage === 'ready' ? 'Mark leased' : `→ ${STAGE_LABEL[nextStage(t.stage)]}`}</button>}
        </div>
        {expanded === t.id && <TurnChecklist checklist={cl} templates={checklistTemplates} onChange={(next) => setChecklist(t, next)} />}
      </div>
    );
  };

  return (
    <div>
      <div className="view-head">
        <h1>Make-ready board</h1>
        <p>Every vacant unit from notice to leased — track the turn, run the make-ready checklist, and spin up the crew work order. Each open turn is lost rent until it's back on the market.</p>
      </div>

      <div className="rr-kpis" style={{ marginBottom: 'var(--gap)' }}>
        <div className="kpi-c"><span className="v mono">{active.length}</span><span className="k">units in turn</span></div>
        <div className="kpi-c"><span className="v mono" style={{ color: 'var(--accent)' }}>{byStage.make_ready?.length || 0}</span><span className="k">in make-ready</span></div>
        <div className="kpi-c"><span className="v mono" style={{ color: 'var(--money)' }}>{byStage.ready?.length || 0}</span><span className="k">ready to lease</span></div>
        {lostRent > 0 && <div className="kpi-c"><span className="v mono" style={{ color: 'var(--warn)' }}>${lostRent.toLocaleString()}</span><span className="k">rent/mo at risk</span></div>}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 'var(--gap)' }}>
        <button className="btn ghost sm" onClick={() => setShowTmpl((s) => !s)}><IcClip width={13} height={13} /> Checklist templates</button>
        {!edit && <button className="btn grad sm" onClick={() => setEdit(blankTurn())}>+ New turn</button>}
      </div>

      {showTmpl && <TemplateManager templates={checklistTemplates} setTemplate={setTemplate} removeTemplate={removeTemplate} />}

      {edit && (
        <div className="card" style={{ marginBottom: 'var(--gap)', borderColor: 'var(--accent)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="field-label" style={{ margin: 0 }}>{edit.id ? 'Edit turn' : 'New turn'}</span>
            <button className="btn ghost sm" onClick={() => setEdit(null)}><IcX width={13} height={13} /></button>
          </div>
          <div className="grid g2" style={{ gap: 10, marginTop: 10 }}>
            <div><div className="field-label">Building</div>
              <select style={inp} value={edit.propLabel} onChange={(e) => setEdit({ ...edit, propLabel: e.target.value })}>
                <option value="">— pick building —</option>
                {properties.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select></div>
            <div><div className="field-label">Unit</div><input style={inp} value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} placeholder="e.g. 4B" /></div>
            <div><div className="field-label">Stage</div>
              <select style={inp} value={edit.stage} onChange={(e) => setEdit({ ...edit, stage: e.target.value })}>
                {STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></div>
            <div><div className="field-label">Assign to</div>
              <select style={inp} value={edit.assigneeLabel} onChange={(e) => setEdit({ ...edit, assigneeLabel: e.target.value })}>
                <option value="">Unassigned</option>
                {activeTechs.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select></div>
            <div><div className="field-label">Move-out</div><input style={inp} type="date" value={edit.moveOut || ''} onChange={(e) => setEdit({ ...edit, moveOut: e.target.value })} /></div>
            <div><div className="field-label">Target ready</div><input style={inp} type="date" value={edit.targetReady || ''} onChange={(e) => setEdit({ ...edit, targetReady: e.target.value })} /></div>
            <div><div className="field-label">Market rent ($/mo)</div><input style={inp} type="number" inputMode="decimal" value={edit.marketRent} onChange={(e) => setEdit({ ...edit, marketRent: e.target.value })} placeholder="0" /></div>
          </div>
          <div className="field-label" style={{ marginTop: 10 }}>Notes</div>
          <textarea style={{ ...inp, minHeight: 44 }} value={edit.notes || ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} placeholder="Damage, scope, anything the crew should know…" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <button className="btn grad sm" onClick={save} disabled={busy || (!edit.propLabel && !edit.unit)}>{busy ? '…' : 'Save turn'}</button>
          </div>
        </div>
      )}

      {/* board: a column per stage, horizontally scrollable on narrow screens */}
      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
        {STAGES.map(([k, label, color]) => (
          <div key={k} style={{ flex: '1 0 260px', minWidth: 260 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: 3, background: color }} />
              <span className="field-label" style={{ margin: 0 }}>{label}</span>
              <span className="chip" style={{ marginLeft: 'auto', color: 'var(--text-faint)' }}>{(byStage[k] || []).length}</span>
            </div>
            {(byStage[k] || []).length === 0
              ? <p className="note" style={{ opacity: 0.6, fontSize: 12 }}>—</p>
              : byStage[k].map(card)}
          </div>
        ))}
      </div>

      {unitTurns.length === 0 && (
        <div className="card" style={{ marginTop: 'var(--gap)' }}>
          <p className="note"><IcBuilding width={13} height={13} style={{ verticalAlign: -2 }} /> No turns yet. Add a unit the moment a tenant gives notice — Round24 tracks it from notice to leased, runs the make-ready checklist, and spins up the crew work order.</p>
        </div>
      )}
    </div>
  );
}

// checklist on a turn — same shape as a work-order checklist, shared templates.
function TurnChecklist({ checklist, templates = [], onChange }) {
  const [adding, setAdding] = useState('');
  const items = Array.isArray(checklist) ? checklist : [];
  const relevant = templates.filter((t) => t.kind === 'any' || t.kind === 'turn');
  const toggle = (id) => onChange(items.map((i) => (i.id === id ? { ...i, done: !i.done, doneAt: !i.done ? new Date().toISOString() : null } : i)));
  const addItem = () => { const t = adding.trim(); if (!t) return; onChange([...items, { id: clId(), text: t, done: false }]); setAdding(''); };
  const applyTemplate = (tmpl) => { if (!tmpl) return; onChange([...items, ...(tmpl.items || []).map((text) => ({ id: clId(), text, done: false }))]); };
  const pct = items.length ? Math.round((items.filter((i) => i.done).length / items.length) * 100) : 0;
  return (
    <div style={{ marginTop: 10, padding: 10, background: 'var(--surface-2)', borderRadius: 3 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span className="field-label" style={{ margin: 0 }}>Make-ready checklist</span>
        {items.length > 0 && <span className="mono" style={{ fontSize: 11, color: pct === 100 ? 'var(--money)' : 'var(--text-dim)' }}>{pct}%</span>}
        {relevant.length > 0 && (
          <select onChange={(e) => { const t = relevant.find((x) => x.id === e.target.value); applyTemplate(t); e.target.value = ''; }} defaultValue=""
            style={{ marginLeft: 'auto', background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 12, padding: '5px 7px', borderRadius: 3 }}>
            <option value="" disabled>+ Template…</option>
            {relevant.map((t) => <option key={t.id} value={t.id}>{t.name} ({(t.items || []).length})</option>)}
          </select>
        )}
      </div>
      {items.map((i) => (
        <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 0' }}>
          <input type="checkbox" checked={!!i.done} onChange={() => toggle(i.id)} style={{ width: 16, height: 16, flex: 'none', cursor: 'pointer' }} />
          <span style={{ flex: 1, fontSize: 13, textDecoration: i.done ? 'line-through' : 'none', color: i.done ? 'var(--text-dim)' : 'var(--text)' }}>{i.text}</span>
          <button className="btn ghost sm icon-btn" style={{ color: 'var(--text-faint)' }} onClick={() => onChange(items.filter((x) => x.id !== i.id))} aria-label="Remove"><IcX width={12} height={12} /></button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }} placeholder="Add a step…"
          style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--line)', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 13, padding: 8, borderRadius: 3 }} />
        <button className="btn ghost sm" onClick={addItem} disabled={!adding.trim()}>Add</button>
      </div>
    </div>
  );
}

// reusable checklist templates — create named lists once, stamp them onto turns
// and work orders. Shared surface, opened from the board.
function TemplateManager({ templates = [], setTemplate, removeTemplate }) {
  const [draft, setDraft] = useState(null); // { name, kind, itemsText }
  const startNew = () => setDraft({ name: '', kind: 'any', itemsText: '' });
  const startEdit = (t) => setDraft({ id: t.id, name: t.name, kind: t.kind || 'any', itemsText: (t.items || []).join('\n') });
  const save = async () => {
    const items = draft.itemsText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!draft.name.trim() || !items.length) return;
    await setTemplate({ id: draft.id, name: draft.name.trim(), kind: draft.kind, items });
    setDraft(null);
  };
  const KINDS = [['any', 'Any'], ['turn', 'Turns'], ['workorder', 'Work orders']];
  return (
    <div className="card" style={{ marginBottom: 'var(--gap)' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span className="field-label" style={{ margin: 0 }}>Checklist templates</span>
        {!draft && <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={startNew}>+ New template</button>}
      </div>
      {draft ? (
        <div style={{ background: 'var(--surface-2)', borderRadius: 3, padding: 12 }}>
          <div className="grid g2" style={{ gap: 10 }}>
            <div><div className="field-label">Name</div><input style={inp} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Standard turn" /></div>
            <div><div className="field-label">Applies to</div>
              <select style={inp} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
                {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></div>
          </div>
          <div className="field-label" style={{ marginTop: 10 }}>Steps — one per line</div>
          <textarea style={{ ...inp, minHeight: 120, fontFamily: 'var(--mono)', fontSize: 13 }} value={draft.itemsText} onChange={(e) => setDraft({ ...draft, itemsText: e.target.value })}
            placeholder={'Change locks\nPatch + paint walls\nDeep clean\nReplace HVAC filter\nTest smoke / CO detectors\nFinal walkthrough'} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
            <button className="btn ghost sm" onClick={() => setDraft(null)}>Cancel</button>
            <button className="btn grad sm" onClick={save} disabled={!draft.name.trim() || !draft.itemsText.trim()}>Save template</button>
          </div>
        </div>
      ) : templates.length === 0 ? (
        <p className="note">No templates yet. Build reusable lists — "Standard turn", "Move-out inspection", "HVAC PM" — then stamp them onto any turn or work order in one tap.</p>
      ) : (
        templates.map((t) => (
          <div className="row" key={t.id} style={{ alignItems: 'center' }}>
            <div className="lead">
              <div className="t">{t.name} <span className="chip" style={{ color: 'var(--text-faint)' }}>{t.kind}</span></div>
              <div className="s">{(t.items || []).length} steps · {(t.items || []).slice(0, 3).join(', ')}{(t.items || []).length > 3 ? '…' : ''}</div>
            </div>
            <button className="btn ghost sm" onClick={() => startEdit(t)}>Edit</button>
            <ConfirmButton className="btn ghost sm icon-btn" style={{ color: 'var(--danger)' }} label="Delete template?" yes="Delete" onConfirm={() => removeTemplate(t.id)} aria-label="Delete"><IcTrash width={13} height={13} /></ConfirmButton>
          </div>
        ))
      )}
    </div>
  );
}
