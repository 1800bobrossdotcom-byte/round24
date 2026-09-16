import { useMemo, useState, useEffect } from 'react';
import { TEMPLATES, itemsFromTemplate, scoreItems, inspectionSummary } from '../lib/inspection.js';
import { todayISO } from '../lib/dates.js';
import { useAuth } from '../components/AuthGate.jsx';
import { IcClip, IcCheck, IcX } from '../components/ui.jsx';

const inp = { width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 14, padding: 9, borderRadius: 9 };
const isLand = (u) => u.type === 'land' || u.status === 'held';
const fmtDate = (d) => (!d ? '—' : new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }));
const ST = { pass: { c: 'var(--money)', l: 'Pass' }, fail: { c: 'var(--danger)', l: 'Fail' }, na: { c: 'var(--text-faint)', l: 'N/A' } };

export default function Inspections({ store }) {
  const { inspections = [], saveInspection, removeInspection, leasing = [] } = store;
  const { role } = useAuth();
  const canEdit = role === 'admin' || role === 'manager';
  const [today] = useState(todayISO); // local-time
  const [sel, setSel] = useState(null);     // active inspection id
  const [draft, setDraft] = useState(null); // working copy of the active inspection
  const [creating, setCreating] = useState(null); // new-inspection form

  const buildings = useMemo(() => [...new Set(leasing.filter((u) => !isLand(u) && u.building).map((u) => u.building))].sort(), [leasing]);
  const sum = useMemo(() => inspectionSummary(inspections), [inspections]);
  const active = inspections.find((i) => i.id === sel) || null;
  useEffect(() => { setDraft(active ? { ...active, items: active.items.map((x) => ({ ...x })) } : null); }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const setItem = (idx, patch) => setDraft((d) => ({ ...d, items: d.items.map((it, j) => (j === idx ? { ...it, ...patch } : it)) }));
  const persist = (patch = {}) => { const next = { ...draft, ...patch }; setDraft(next); saveInspection(next); };
  const complete = () => { saveInspection({ ...draft, status: 'complete' }); setSel(null); };

  const startCreate = () => setCreating({ kind: 'move_in', building: buildings[0] || '', unit: '', inspector: '' });
  const create = () => {
    const t = TEMPLATES.find((x) => x.key === creating.kind);
    const title = `${t.name}${creating.unit ? ` — Unit ${creating.unit}` : creating.building ? ` — ${creating.building}` : ''}`;
    const id = saveInspection({ kind: creating.kind, title, building: creating.building || null, unit: creating.unit.trim() || null, inspector: creating.inspector.trim() || null, date: today, status: 'in_progress', items: itemsFromTemplate(creating.kind) });
    setCreating(null); Promise.resolve(id).then((rid) => setSel(rid));
  };

  // ---- detail: run the checklist ----
  if (active && draft) {
    const s = scoreItems(draft.items);
    return (
      <div>
        <div className="view-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <button className="lnk" onClick={() => { saveInspection(draft); setSel(null); }} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', font: 'inherit', padding: 0, marginBottom: 4 }}>← All inspections</button>
            <h1 style={{ margin: 0 }}>{draft.title}</h1>
            <p style={{ margin: '4px 0 0' }}>{[draft.building, draft.unit && `Unit ${draft.unit}`, draft.inspector, fmtDate(draft.date)].filter(Boolean).join(' · ')}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="mono" style={{ fontWeight: 800, fontSize: 20, color: s.hasFails ? 'var(--danger)' : s.complete ? 'var(--money)' : 'var(--text)' }}>{s.pass}✓ {s.fail}✗</div>
            <div className="note" style={{ margin: 0 }}>{s.done}/{s.total} · {s.pct}%</div>
          </div>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {draft.items.map((it, i) => (
            <div key={i} style={{ padding: '12px 16px', borderTop: i ? '1px solid var(--line)' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ flex: '1 1 200px', fontWeight: 600, fontSize: 14 }}>{it.label}</span>
                {canEdit && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    {['pass', 'fail', 'na'].map((v) => (
                      <button key={v} onClick={() => persist({ items: draft.items.map((x, j) => (j === i ? { ...x, status: x.status === v ? '' : v } : x)) })}
                        style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid var(--line)', cursor: 'pointer', font: 'inherit', fontSize: 12, fontWeight: 700, background: it.status === v ? ST[v].c : 'transparent', color: it.status === v ? '#fff' : 'var(--text-dim)' }}>{ST[v].l}</button>
                    ))}
                  </div>
                )}
                {!canEdit && it.status && <span style={{ color: ST[it.status].c, fontWeight: 700, fontSize: 13 }}>{ST[it.status].l}</span>}
              </div>
              {(it.status === 'fail' || it.note) && (
                <input style={{ ...inp, marginTop: 8 }} value={it.note} placeholder={it.status === 'fail' ? 'What failed? (required for follow-up)' : 'Note'}
                  onChange={(e) => setItem(i, { note: e.target.value })} onBlur={() => saveInspection(draft)} readOnly={!canEdit} />
              )}
            </div>
          ))}
        </div>

        {canEdit && (
          <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
            <button className="btn ghost sm" style={{ width: 'auto', color: 'var(--danger)' }} onClick={() => { removeInspection(draft.id); setSel(null); }}>Delete</button>
            <span style={{ flex: 1 }} />
            <button className="btn ghost" style={{ width: 'auto' }} onClick={() => { saveInspection(draft); setSel(null); }}>Save & close</button>
            <button className="btn grad" style={{ width: 'auto' }} onClick={complete} disabled={!s.complete}>{s.complete ? 'Mark complete' : `${s.total - s.done} left`}</button>
          </div>
        )}
      </div>
    );
  }

  // ---- list ----
  return (
    <div>
      <div className="view-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1>Inspections</h1>
          <p>Templated condition checklists — move-in, move-out, quarterly safety, unit turns — scored pass/fail with notes, on the record for every unit.</p>
        </div>
        {canEdit && <button className="btn grad" style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={startCreate}>+ New inspection</button>}
      </div>

      <div className="rr-kpis">
        <div className="kpi-c"><span className="v mono">{sum.open}</span><span className="k">in progress</span></div>
        <div className="kpi-c"><span className="v mono" style={{ color: 'var(--money)' }}>{sum.completed}</span><span className="k">completed</span></div>
        <div className="kpi-c"><span className="v mono" style={{ color: sum.failsOpen ? 'var(--danger)' : 'var(--text-faint)' }}>{sum.failsOpen}</span><span className="k">failed items</span></div>
      </div>

      {creating && canEdit && (
        <div className="card" style={{ border: '1px solid var(--accent)' }}>
          <div className="field-label" style={{ marginTop: 0 }}>New inspection</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <label>Checklist<select style={inp} value={creating.kind} onChange={(e) => setCreating((c) => ({ ...c, kind: e.target.value }))}>{TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</select></label>
            <label>Building
              {buildings.length ? <select style={inp} value={creating.building} onChange={(e) => setCreating((c) => ({ ...c, building: e.target.value }))}><option value="">—</option>{buildings.map((b) => <option key={b} value={b}>{b}</option>)}</select>
                : <input style={inp} value={creating.building} onChange={(e) => setCreating((c) => ({ ...c, building: e.target.value }))} />}
            </label>
            <label>Unit<input style={inp} value={creating.unit} onChange={(e) => setCreating((c) => ({ ...c, unit: e.target.value }))} placeholder="e.g. 4B or Common" /></label>
            <label>Inspector<input style={inp} value={creating.inspector} onChange={(e) => setCreating((c) => ({ ...c, inspector: e.target.value }))} /></label>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'flex-end' }}>
            <button className="btn ghost sm" onClick={() => setCreating(null)}>Cancel</button>
            <button className="btn grad sm" onClick={create}>Start checklist</button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="rr-scroll">
          <table className="rr-tbl">
            <thead><tr><th>Inspection</th><th>Where</th><th className="num">Date</th><th className="num">Result</th><th>Status</th></tr></thead>
            <tbody>
              {inspections.length === 0 && <tr><td colSpan={5}><p className="note" style={{ margin: 8 }}>No inspections yet.{canEdit ? ' Start one above.' : ''}</p></td></tr>}
              {inspections.map((i) => {
                const s = scoreItems(i.items);
                return (
                  <tr key={i.id} className="rr-link" onClick={() => setSel(i.id)}>
                    <td><IcClip width={13} height={13} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--text-faint)' }} /><b>{i.title}</b></td>
                    <td style={{ color: 'var(--text-dim)' }}>{[i.building, i.unit].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="num mono">{fmtDate(i.date)}</td>
                    <td className="num mono">
                      <span style={{ color: 'var(--money)' }}>{s.pass}✓</span>{' '}
                      <span style={{ color: s.fail ? 'var(--danger)' : 'var(--text-faint)' }}>{s.fail}✗</span>
                    </td>
                    <td>
                      {i.status === 'complete'
                        ? <span style={{ color: s.hasFails ? 'var(--warn)' : 'var(--money)', fontWeight: 700, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>{s.hasFails ? <><IcX width={13} height={13} /> issues</> : <><IcCheck width={13} height={13} /> passed</>}</span>
                        : <span style={{ color: 'var(--warn)', fontWeight: 700, fontSize: 12 }}>{s.pct}% · in progress</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
