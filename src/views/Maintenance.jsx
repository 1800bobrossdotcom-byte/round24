import { useState, useMemo } from 'react';
import ConfirmButton from '../components/ConfirmButton.jsx';
import { IcCal, IcWrench, IcCheck, IcX, IcTrash, IcBuilding, IcPlay, IcClock } from '../components/ui.jsx';
import { categoryForText, tagSegments } from '../lib/taskTags.js';

const CATS = ['plumbing', 'electrical', 'hvac', 'appliance', 'painting', 'turn', 'general', 'inspection'];
// cadence presets → interval in days
const FREQ = [['1', 'Daily'], ['7', 'Weekly'], ['14', 'Every 2 weeks'], ['30', 'Monthly'], ['60', 'Every 2 months'], ['91', 'Quarterly'], ['182', 'Every 6 months'], ['365', 'Annual']];
const freqLabel = (days) => (FREQ.find(([d]) => Number(d) === Number(days)) || [])[1] || `Every ${days} days`;

function todayISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function fmtDate(iso) { return iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''; }
function daysBetween(a, b) { return Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000); }

const inputStyle = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)',
  color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 14, padding: 9, borderRadius: 9,
};
const blank = () => ({ task: '', propLabel: '', unit: '', category: 'general', intervalDays: '30', nextDue: todayISO(), assigneeLabel: '', priority: 3, active: true });

export default function Maintenance({ store }) {
  const { maintSchedules = [], setSchedule, removeSchedule, generateFromSchedule,
    pickProperties: properties = [], activeTechs = [], role } = store;
  const isOffice = role === 'admin' || role === 'manager';
  const [edit, setEdit] = useState(null);   // schedule draft being added/edited
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null); // transient "work order created" note

  const today = todayISO();
  const sorted = useMemo(() => [...maintSchedules].sort((a, b) => (a.nextDue < b.nextDue ? -1 : a.nextDue > b.nextDue ? 1 : 0)), [maintSchedules]);
  const due = sorted.filter((s) => s.active && s.nextDue <= today);
  const upcoming = sorted.filter((s) => !(s.active && s.nextDue <= today));

  const onTask = (v) => setEdit((e) => ({ ...e, task: v, ...(categoryForText(v) ? { category: categoryForText(v) } : {}) }));
  const save = async () => {
    if (!edit.task.trim() || !edit.nextDue) return;
    setBusy(true);
    await setSchedule({ ...edit, task: edit.task.trim(), intervalDays: Number(edit.intervalDays) || 30, priority: Number(edit.priority) || 3 });
    setBusy(false); setEdit(null);
  };
  const gen = async (s) => {
    setBusy(true);
    const wo = await generateFromSchedule(s);
    setBusy(false);
    setFlash(`Work order created — ${s.task}${s.propLabel ? ` · ${s.propLabel}` : ''}. Next due ${fmtDate(genNext(s))}.`);
    setTimeout(() => setFlash(null), 6000);
    return wo;
  };
  const genAll = async () => { for (const s of due) { /* eslint-disable-next-line no-await-in-loop */ await generateFromSchedule(s); } setFlash(`${due.length} work order${due.length === 1 ? '' : 's'} created from due schedules.`); setTimeout(() => setFlash(null), 6000); };
  // preview the advanced next-due (mirrors the store's skip-missed logic)
  const genNext = (s) => { let nd = s.nextDue; const iv = Number(s.intervalDays) || 30; do { nd = addDays(nd, iv); } while (nd <= today); return nd; };
  function addDays(iso, n) { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

  if (!isOffice) {
    return (
      <div>
        <div className="view-head"><h1>Maintenance schedule</h1></div>
        <div className="card"><p className="note">Recurring maintenance is planned by the office. The work orders it creates show up in your <b>Orders</b> and <b>Field</b> tabs like any other job.</p></div>
      </div>
    );
  }

  const scheduleRow = (s, isDue) => (
    <div className="row" key={s.id} style={{ alignItems: 'center', opacity: s.active ? 1 : 0.55 }}>
      <div className="lead">
        <div className="t">{s.task}
          {isDue && <span className="chip" style={{ marginLeft: 8, color: 'var(--warn)' }}>due {daysBetween(s.nextDue, today) > 0 ? `${daysBetween(s.nextDue, today)}d ago` : 'today'}</span>}
          {!s.active && <span className="chip" style={{ marginLeft: 8, color: 'var(--text-dim)' }}>paused</span>}
        </div>
        <div className="s">{[s.propLabel || 'Any building', s.unit && `Unit ${s.unit}`, freqLabel(s.intervalDays), `next ${fmtDate(s.nextDue)}`, s.assigneeLabel].filter(Boolean).join(' · ')}</div>
      </div>
      {isDue && <button className="btn grad sm" onClick={() => gen(s)} disabled={busy}><IcPlay width={13} height={13} /> Generate WO</button>}
      <button className="btn ghost sm" onClick={() => setEdit({ ...s, intervalDays: String(s.intervalDays) })}>Edit</button>
      <button className="btn ghost sm" onClick={() => setSchedule({ id: s.id, active: !s.active })} title={s.active ? 'Pause' : 'Resume'}>{s.active ? 'Pause' : 'Resume'}</button>
      <ConfirmButton className="btn ghost sm icon-btn" style={{ color: 'var(--danger)' }} label="Delete schedule?" yes="Delete" onConfirm={() => removeSchedule(s.id)} aria-label="Delete schedule"><IcTrash width={13} height={13} /></ConfirmButton>
    </div>
  );

  return (
    <div>
      <div className="view-head">
        <h1>Maintenance schedule</h1>
        <p>Recurring preventive maintenance — set a cadence and Caliper spawns the work order when it comes due.</p>
      </div>

      {flash && <div className="card" style={{ marginBottom: 'var(--gap)', borderColor: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 8 }}><IcCheck width={15} height={15} style={{ color: 'var(--accent)' }} /><span>{flash}</span></div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--gap)' }}>
        {!edit && <button className="btn grad sm" onClick={() => setEdit(blank())}>+ New recurring task</button>}
      </div>

      {edit && (
        <div className="card" style={{ marginBottom: 'var(--gap)', borderColor: 'var(--accent)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="field-label" style={{ margin: 0 }}>{edit.id ? 'Edit recurring task' : 'New recurring task'}</span>
            <button className="btn ghost sm" onClick={() => setEdit(null)}><IcX width={13} height={13} /></button>
          </div>
          <div style={{ marginTop: 10 }}>
            <div className="field-label">Task</div>
            <input style={inputStyle} value={edit.task} onChange={(e) => onTask(e.target.value)} placeholder="e.g. Change HVAC filters — # to tag" autoCapitalize="sentences" />
            {edit.task && tagSegments(edit.task).some((s) => s.tag) && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                {tagSegments(edit.task).filter((s) => s.tag).map((s, i) => <span key={i} className="chip" style={{ color: 'var(--accent)' }}>#{s.text}</span>)}
              </div>
            )}
          </div>
          <div className="grid g2" style={{ gap: 10, marginTop: 10 }}>
            <div><div className="field-label">Building</div>
              <select style={inputStyle} value={edit.propLabel} onChange={(e) => setEdit({ ...edit, propLabel: e.target.value })}>
                <option value="">Any / unassigned</option>
                {properties.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select></div>
            <div><div className="field-label">Unit (optional)</div><input style={inputStyle} value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} placeholder="e.g. 4B" /></div>
            <div><div className="field-label">Category</div>
              <select style={inputStyle} value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>
                {CATS.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
              </select></div>
            <div><div className="field-label">Frequency</div>
              <select style={inputStyle} value={edit.intervalDays} onChange={(e) => setEdit({ ...edit, intervalDays: e.target.value })}>
                {FREQ.map(([d, l]) => <option key={d} value={d}>{l}</option>)}
              </select></div>
            <div><div className="field-label">First due</div><input style={inputStyle} type="date" value={edit.nextDue} onChange={(e) => setEdit({ ...edit, nextDue: e.target.value })} /></div>
            <div><div className="field-label">Assign to (optional)</div>
              <select style={inputStyle} value={edit.assigneeLabel} onChange={(e) => setEdit({ ...edit, assigneeLabel: e.target.value })}>
                <option value="">Unassigned</option>
                {activeTechs.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select></div>
          </div>
          <div className="field-label" style={{ marginTop: 10 }}>Detail (optional)</div>
          <textarea style={{ ...inputStyle, minHeight: 44 }} value={edit.detail || ''} onChange={(e) => setEdit({ ...edit, detail: e.target.value })} placeholder="Anything the crew should know each time…" />
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 10 }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active</label>
            <button className="btn grad sm" style={{ marginLeft: 'auto' }} onClick={save} disabled={busy || !edit.task.trim() || !edit.nextDue}>{busy ? '…' : 'Save schedule'}</button>
          </div>
        </div>
      )}

      {due.length > 0 && (
        <div className="card" style={{ marginBottom: 'var(--gap)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span className="field-label" style={{ margin: 0, color: 'var(--warn)', display: 'inline-flex', alignItems: 'center', gap: 5 }}><IcClock width={13} height={13} /> Due now ({due.length})</span>
            {due.length > 1 && <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={genAll} disabled={busy}>Generate all {due.length}</button>}
          </div>
          {due.map((s) => scheduleRow(s, true))}
        </div>
      )}

      <div className="card">
        <span className="field-label" style={{ display: 'block', marginBottom: 4 }}>{upcoming.length ? `Upcoming (${upcoming.length})` : 'Recurring tasks'}</span>
        {upcoming.length === 0 && due.length === 0
          ? <p className="note">No recurring maintenance yet. Add turns, filter changes, gutter cleaning, fire-safety checks — anything that repeats — and Caliper will surface it and spin up the work order when it’s due.</p>
          : upcoming.map((s) => scheduleRow(s, false))}
      </div>

      <p className="note" style={{ marginTop: 12 }}>Generating a task creates a work order (assigned if you set an operator) and rolls the schedule to its next date, skipping any it missed. <IcWrench width={11} height={11} style={{ verticalAlign: -1 }} /> The work order then flows to the crew and the timer like any other.</p>
    </div>
  );
}
