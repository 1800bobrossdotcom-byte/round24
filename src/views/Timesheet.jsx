import { useState, useMemo, useEffect, useRef } from 'react';
import { signedFileUrl } from '../lib/backend/supabase.js';
import { IcTable, IcReceipt, IcCheck, IcX, IcTrash, IcMapPin, IcBuilding, IcChevron, IcCal, IcClock, IcUsers } from '../components/ui.jsx';
import { exportTimesheetXlsx, exportTimesheetPdf } from '../lib/exportDocs.js';

// live view of the crew's running Field timer (same localStorage the timer
// persists to). Ticks once a second so hours + pay compile in real time on the
// sheet, and flow into the per-property allocation as they accrue.
const TIMER_KEY = 'caliper_field_timer_v1';
function useLiveTimer(propById) {
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  let s; try { s = JSON.parse(localStorage.getItem(TIMER_KEY) || '{}'); } catch { s = {}; }
  const run = s.running;
  if (!run) return null;
  const end = s.onBreak ? s.onBreak.start : Date.now();
  // mirror Field's elapsed exactly: add time banked before a pause (running.baseMs),
  // else a resumed job reads short on the sheet until it's stopped.
  const hrs = Math.round((Math.max(0, (end - run.start - (s.breakMs || 0) + (run.baseMs || 0)) / 1000) / 3600) * 100) / 100;
  if (!Number.isFinite(hrs)) return null; // corrupted timer (missing start) — don't poison sheet totals with NaN
  return {
    propLabel: propById[run.propId]?.name || run.propLabel || 'Unassigned',
    unit: run.unit === '—' ? '' : run.unit, category: run.category,
    hrs, rate: run.rate || 0, onBreak: !!s.onBreak, woTask: run.woTask,
    date: localISO(new Date()),
  };
}

const CATS = ['plumbing', 'electrical', 'hvac', 'appliance', 'painting', 'turn', 'general', 'inspection'];
const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
const nameKey = (s) => (s || '').toLowerCase().trim();

// --- local (not UTC) date helpers so "today" and the week never drift a day ---
function localISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const todayISO = () => localISO(new Date());
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return localISO(d); };
const WEEK_START = 6; // Saturday — matches Evolution24's pay week (and the rollup engine)
const weekStartOf = (iso) => { const d = new Date(`${iso}T00:00:00`); const diff = (d.getDay() - WEEK_START + 7) % 7; return addDays(iso, -diff); };

const cellInput = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)',
  color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 13, padding: '7px 8px', borderRadius: 8,
};

// the work window: we store duration + when it was logged, so start = logged−hours.
function timeWindow(row) {
  const end = row.createdAt ? new Date(row.createdAt) : null;
  if (!end || isNaN(end.getTime())) return '—';
  const start = new Date(end.getTime() - (row.durationHrs || 0) * 3600000);
  const fmt = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${fmt(start)}–${fmt(end)}`;
}
const fmtDate = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString([], { month: 'short', day: 'numeric', weekday: 'short' });
};
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// @-mention tokens are stored inline as @[Property Name] so a note is a single
// string that still round-trips through the labor spine + payroll.
const MENTION_RE = /@\[([^\]]+)\]/g;
const tagsOf = (note) => (String(note || '').match(MENTION_RE) || []).map((s) => s.slice(2, -1));
function renderNote(note) {
  if (!note) return null;
  const out = []; let last = 0; let m; let i = 0; MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(note))) {
    if (m.index > last) out.push(<span key={i++}>{note.slice(last, m.index)}</span>);
    out.push(<span key={i++} className="ts-mention"><IcBuilding width={9} height={9} />{m[1]}</span>);
    last = MENTION_RE.lastIndex;
  }
  if (last < note.length) out.push(<span key={i++}>{note.slice(last)}</span>);
  return out;
}

// comment field that turns "@" into a live property picker
function MentionInput({ value, onChange, options, placeholder }) {
  const ref = useRef(null);
  const [menu, setMenu] = useState(null); // { query, start, end } | null
  const [active, setActive] = useState(0);
  const detect = (el) => {
    const pos = el.selectionStart ?? el.value.length;
    const m = el.value.slice(0, pos).match(/@([^@[\]]{0,24})$/);
    if (!m) { setMenu(null); return; }
    setMenu({ query: m[1], start: pos - m[0].length, end: pos }); setActive(0);
  };
  const suggestions = useMemo(() => {
    if (!menu) return [];
    const q = menu.query.trim().toLowerCase();
    return options.filter((o) => !q || o.toLowerCase().includes(q)).slice(0, 6);
  }, [menu, options]);
  const insert = (name) => {
    if (!menu) return;
    const next = value.slice(0, menu.start) + `@[${name}] ` + value.slice(menu.end);
    onChange(next); setMenu(null);
    requestAnimationFrame(() => { const el = ref.current; if (el) { const c = menu.start + name.length + 4; el.focus(); el.setSelectionRange(c, c); } });
  };
  return (
    <div className="mention-wrap">
      <input ref={ref} style={cellInput} value={value || ''} placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); detect(e.target); }}
        onKeyUp={(e) => { if (!['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(e.key)) detect(e.target); }}
        onKeyDown={(e) => {
          if (!menu || !suggestions.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % suggestions.length); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + suggestions.length) % suggestions.length); }
          else if (e.key === 'Enter') { e.preventDefault(); insert(suggestions[active]); }
          else if (e.key === 'Escape') { setMenu(null); }
        }}
        onBlur={() => setTimeout(() => setMenu(null), 150)} />
      {menu && suggestions.length > 0 && (
        <div className="mention-menu">
          {suggestions.map((s, i) => (
            <button key={s} type="button" className={'mention-opt' + (i === active ? ' on' : '')}
              onMouseDown={(e) => { e.preventDefault(); insert(s); }}>
              <IcBuilding width={13} height={13} style={{ color: 'var(--accent)' }} /> {s}
              <span className="mo-hint">tag</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// shared entry editor — used inline in the list AND inside a day card in the week view
function TsEditor({ draft, setDraft, propNames, onSave, onCancel, busy }) {
  return (
    <div className="ts-editor">
      <div className="te-grid">
        <div><div className="field-label">Date</div>
          <input style={cellInput} type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></div>
        <div><div className="field-label">Hours</div>
          <input style={cellInput} type="number" step="0.25" min="0" inputMode="decimal" value={draft.durationHrs}
            onChange={(e) => setDraft({ ...draft, durationHrs: e.target.value })} /></div>
        <div><div className="field-label">For</div>
          <select style={cellInput} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
            {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select></div>
        <div><div className="field-label">Property</div>
          <select style={cellInput} value={draft.propLabel} onChange={(e) => setDraft({ ...draft, propLabel: e.target.value })}>
            <option value="Unassigned">Unassigned</option>
            {propNames.map((n) => <option key={n} value={n}>{n}</option>)}
            {draft.propLabel && draft.propLabel !== 'Unassigned' && !propNames.includes(draft.propLabel) && <option value={draft.propLabel}>{draft.propLabel}</option>}
          </select></div>
        <div><div className="field-label">Unit</div>
          <input style={cellInput} value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="unit" /></div>
      </div>
      <div>
        <div className="field-label">Comment — type <b style={{ color: 'var(--accent)' }}>@</b> to tag a property</div>
        <MentionInput value={draft.note} onChange={(v) => setDraft({ ...draft, note: v })} options={propNames}
          placeholder="e.g. replaced disposal @121 → tag routes the hours to that door" />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn grad sm" onClick={onSave} disabled={busy || !(Number(draft.durationHrs) > 0)}>{busy ? '…' : 'Save entry'}</button>
        <button className="btn ghost sm" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

// Split one day's hours across the properties worked — the self-serve version of
// the pay-log comment ("Water St 2.25h · Fitzhugh 1h · 301 Central 1h · …"). Each
// line saves as its own timesheet entry, so the per-property rollups build
// themselves and the office no longer hand-allocates from a comment.
const blankLine = () => ({ propLabel: 'Unassigned', hrs: '', unit: '', note: '', category: 'general', workOrderId: null });
function SplitEditor({ date0, propNames, workOrders = [], onSaveAll, onCancel, busy }) {
  const [date, setDate] = useState(date0);
  const [lines, setLines] = useState([blankLine(), blankLine()]);
  const setLine = (i, patch) => setLines((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const total = lines.reduce((a, x) => a + (Number(x.hrs) || 0), 0);
  const openWOs = useMemo(
    () => workOrders.filter((w) => w.status !== 'done' && w.status !== 'cancelled'),
    [workOrders],
  );
  const pickWO = (i, id) => {
    const w = openWOs.find((x) => x.id === id);
    if (!w) { setLine(i, { workOrderId: null }); return; }
    setLine(i, { workOrderId: w.id, propLabel: w.propLabel || 'Unassigned', unit: w.unit || lines[i].unit, category: w.category || lines[i].category, note: lines[i].note || w.task || '' });
  };
  const valid = lines.some((x) => Number(x.hrs) > 0);
  return (
    <div className="ts-editor">
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div><div className="field-label">Day</div>
          <input style={{ ...cellInput, width: 170 }} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div className="field-label" style={{ margin: 0 }}>Day total</div>
          <span className="mono" style={{ fontSize: 20, fontWeight: 700 }}>{Math.round(total * 100) / 100}</span> <span className="s" style={{ color: 'var(--text-dim)' }}>hrs</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
        {lines.map((ln, i) => (
          <div key={i} className="card" style={{ background: 'var(--surface-2)', padding: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 78px 90px auto', gap: 8, alignItems: 'end' }}>
              <div><div className="field-label">Property</div>
                <select style={cellInput} value={ln.propLabel} onChange={(e) => setLine(i, { propLabel: e.target.value })}>
                  <option value="Unassigned">Unassigned</option>
                  {propNames.map((n) => <option key={n} value={n}>{n}</option>)}
                  {ln.propLabel && ln.propLabel !== 'Unassigned' && !propNames.includes(ln.propLabel) && <option value={ln.propLabel}>{ln.propLabel}</option>}
                </select></div>
              <div><div className="field-label">Hours</div>
                <input style={cellInput} type="number" step="0.25" min="0" inputMode="decimal" value={ln.hrs} placeholder="0"
                  onChange={(e) => setLine(i, { hrs: e.target.value })} /></div>
              <div><div className="field-label">Unit</div>
                <input style={cellInput} value={ln.unit} onChange={(e) => setLine(i, { unit: e.target.value })} placeholder="—" /></div>
              <button className="btn ghost sm icon-btn" style={{ color: 'var(--text-faint)', marginBottom: 1 }} aria-label="Remove line"
                onClick={() => setLines((l) => (l.length > 1 ? l.filter((_, j) => j !== i) : l))}><IcX width={14} height={14} /></button>
            </div>
            <div style={{ marginTop: 8 }}>
              <MentionInput value={ln.note} onChange={(v) => setLine(i, { note: v })} options={propNames}
                placeholder="what you did — rounds, trash haul, floors… (@tag also routes hours)" />
            </div>
            {openWOs.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <select style={{ ...cellInput, fontSize: 12, color: 'var(--text-dim)' }} value={ln.workOrderId || ''} onChange={(e) => pickWO(i, e.target.value)}>
                  <option value="">↳ link a work order (auto-fills the property)…</option>
                  {openWOs.map((w) => <option key={w.id} value={w.id}>{[w.propLabel, w.unit && `#${w.unit}`, w.task].filter(Boolean).join(' · ').slice(0, 60)}</option>)}
                </select>
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn ghost sm" onClick={() => setLines((l) => [...l, blankLine()])} disabled={busy}>+ Add property</button>
        <div style={{ flex: 1 }} />
        <button className="btn grad sm" onClick={() => onSaveAll({ date, lines })} disabled={busy || !valid}>{busy ? 'Saving…' : (() => { const k = lines.filter((x) => Number(x.hrs) > 0).length; return `Save ${k || ''} ${k === 1 ? 'entry' : 'entries'}`.replace('  ', ' ').trim(); })()}</button>
        <button className="btn ghost sm" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}

const PERIODS = [['7', '7 days'], ['14', '2 weeks'], ['30', '30 days'], ['all', 'All']];

export default function Timesheet({ store }) {
  const { timesheet = [], purchases = [], pickProperties: properties = [], techById = {}, workOrders = [], role } = store;
  const isOffice = role === 'admin' || role === 'manager';
  const [view, setView] = useState('week');          // week | list
  const [period, setPeriod] = useState('14');
  const [weekAnchor, setWeekAnchor] = useState(todayISO());
  const [editId, setEditId] = useState(null);        // row.id | '__new__'
  const [draft, setDraft] = useState(null);
  const [splitDate, setSplitDate] = useState(null);  // day being split across properties, or null
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const [opFilter, setOpFilter] = useState('all');   // office only: 'all' (roster) | techId key

  // office reads as "Timesheets" — an index of every operator, with a master tally,
  // and you drill into one person's sheet. Crew sees only their own (level 2).
  const opKeyOf = (r) => r.techId || '__none__';
  const opNameOf = (r) => techById[r.techId]?.name || (r.techId ? 'Operator' : 'Unattributed');
  const officeIndex = isOffice && opFilter === 'all';         // level 1: the roster
  const viewingOp = isOffice && opFilter !== 'all';           // level 2 for a chosen operator
  const canAdd = !isOffice;                                    // crew log their own; office corrects existing entries

  // rows that feed the level-2 sheet (week/list): the whole org for crew's own list,
  // or one operator when office has drilled in
  const baseRows = useMemo(
    () => (viewingOp ? timesheet.filter((r) => opKeyOf(r) === opFilter) : timesheet),
    [timesheet, viewingOp, opFilter],
  );

  // property options for the picker / mentions (rent-roll + labor buildings, de-duped)
  const propNames = useMemo(() => {
    const s = new Set(properties.map((p) => p.name));
    timesheet.forEach((r) => r.propLabel && r.propLabel !== 'Unassigned' && s.add(r.propLabel));
    return [...s].filter(Boolean).sort();
  }, [properties, timesheet]);

  const periodCut = period === 'all' ? null : addDays(todayISO(), -Number(period) + 1);
  const rows = useMemo(() => {
    let list = [...baseRows];
    if (periodCut) list = list.filter((r) => r.date >= periodCut);
    return list.sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : (b.createdAt || '').localeCompare(a.createdAt || '')));
  }, [baseRows, periodCut]);

  // the office user's own live timer only belongs on a crew member's own sheet
  const liveRaw = useLiveTimer(store.propById || {});
  const live = isOffice ? null : liveRaw;

  // ---- office master roster: every operator's tally over the selected period ----
  const roster = useMemo(() => {
    if (!isOffice) return [];
    const src = periodCut ? timesheet.filter((r) => r.date >= periodCut) : timesheet;
    const m = new Map();
    src.forEach((r) => {
      const k = opKeyOf(r);
      const e = m.get(k) || { key: k, name: opNameOf(r), hrs: 0, pay: 0, entries: 0, last: '', props: new Map() };
      e.hrs += r.durationHrs || 0; e.pay += (r.durationHrs || 0) * (r.rate || 0); e.entries += 1;
      if (r.date > e.last) e.last = r.date;
      const pk = r.propLabel && r.propLabel !== 'Unassigned' ? r.propLabel : 'Unassigned';
      e.props.set(pk, (e.props.get(pk) || 0) + (r.durationHrs || 0));
      m.set(k, e);
    });
    return [...m.values()]
      .map((e) => ({ ...e, topProp: [...e.props.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '—' }))
      .sort((a, b) => b.hrs - a.hrs);
  }, [isOffice, timesheet, periodCut, techById]);
  const master = useMemo(() => roster.reduce((a, o) => ({ hrs: a.hrs + o.hrs, pay: a.pay + o.pay, entries: a.entries + o.entries }), { hrs: 0, pay: 0, entries: 0 }), [roster]);
  const masterHasPay = roster.some((o) => o.pay > 0);
  const activeOp = viewingOp ? roster.find((o) => o.key === opFilter) : null;

  // export the currently-visible timesheet (respects the operator + period filter)
  // to a formula-driven Excel workbook or a Caliper-branded PDF.
  const exportRows = () => [...rows]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((r) => ({
      date: r.date, operator: opNameOf(r), building: r.propLabel || 'Unassigned',
      unit: r.unit || '', category: r.category || 'general', task: r.note || '',
      hours: Number(r.durationHrs) || 0, rate: Number(r.rate) || 0,
    }));
  const exportMeta = () => ({
    orgName: store.meta?.org || 'Caliper',
    rangeLabel: `${viewingOp && activeOp ? `${activeOp.name} · ` : ''}${(PERIODS.find(([v]) => v === period) || [])[1] || 'All'}`,
  });
  const onExportXlsx = () => exportTimesheetXlsx(exportRows(), exportMeta());
  const onExportPdf = () => { if (!exportTimesheetPdf(exportRows(), exportMeta())) alert('Allow pop-ups for this site to export the PDF.'); };

  // ---- office per-property rollup: hours + labor $ per building over the period ----
  // The Excel "Monthly / Quarterly totals" box — every operator's allocated hours
  // summed by door, so the office reads the same number Bill used to tally by hand.
  const propRoll = useMemo(() => {
    if (!isOffice) return [];
    const src = periodCut ? timesheet.filter((r) => r.date >= periodCut) : timesheet;
    const m = new Map();
    src.forEach((r) => {
      const k = r.propLabel && r.propLabel !== 'Unassigned' ? r.propLabel : 'Unassigned';
      const e = m.get(nameKey(k)) || { name: k, hrs: 0, pay: 0 };
      e.hrs += r.durationHrs || 0; e.pay += (r.durationHrs || 0) * (r.rate || 0); m.set(nameKey(k), e);
    });
    return [...m.values()].sort((a, b) => b.hrs - a.hrs);
  }, [isOffice, timesheet, periodCut]);
  const propRollMax = Math.max(...propRoll.map((p) => p.hrs), 1);
  const propRollHasPay = propRoll.some((p) => p.pay > 0);

  // ---- the work week, scheduled out ----
  const weekStart = weekStartOf(weekAnchor);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const weekEntries = useMemo(() => {
    const set = new Set(weekDays);
    return baseRows.filter((r) => set.has(r.date));
  }, [baseRows, weekDays]);
  const byDay = useMemo(() => {
    const m = {}; weekDays.forEach((d) => { m[d] = []; });
    weekEntries.forEach((r) => { (m[r.date] = m[r.date] || []).push(r); });
    Object.values(m).forEach((arr) => arr.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')));
    return m;
  }, [weekEntries, weekDays]);
  const mdFmt = (iso) => { const d = new Date(`${iso}T00:00:00`); return isNaN(d.getTime()) ? iso : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };
  const weekLabel = `${mdFmt(weekStart)} – ${mdFmt(weekDays[6])}`; // e.g. "Jul 5 – Jul 11"

  // scope the totals + allocation to what's actually on screen
  const scopeRows = view === 'week' ? weekEntries : rows;
  const liveHrs = live ? live.hrs : 0;
  const livePay = live ? live.hrs * live.rate : 0;
  const liveInScope = live && (view === 'list' ? true : weekDays.includes(live.date));
  const totHrs = scopeRows.reduce((a, r) => a + (r.durationHrs || 0), 0) + (liveInScope ? liveHrs : 0);
  const totPay = scopeRows.reduce((a, r) => a + (r.durationHrs || 0) * (r.rate || 0), 0) + (liveInScope ? livePay : 0);
  const hasPay = scopeRows.some((r) => r.rate > 0) || (liveInScope && livePay > 0);

  const alloc = useMemo(() => {
    const m = new Map();
    const add = (name, hrs, pay) => {
      const k = name || 'Unassigned'; const e = m.get(nameKey(k)) || { name: k, hrs: 0, pay: 0 };
      e.hrs += hrs; e.pay += pay; m.set(nameKey(k), e);
    };
    scopeRows.forEach((r) => add(r.propLabel, r.durationHrs || 0, (r.durationHrs || 0) * (r.rate || 0)));
    if (liveInScope) add(live.propLabel, live.hrs, live.hrs * live.rate);
    return [...m.values()].sort((a, b) => b.hrs - a.hrs);
  }, [scopeRows, live, liveInScope]);
  const allocMax = Math.max(...alloc.map((a) => a.hrs), 1);

  // receipts filed to the same job: match the work order, else the building
  const receiptsFor = (row) => purchases.filter((p) => p.receiptPath && (
    (row.workOrderId && p.workOrderId === row.workOrderId) ||
    (p.propLabel && nameKey(p.propLabel) === nameKey(row.propLabel))
  ));
  const openReceipt = async (p) => {
    if (/^(\/|https?:)/.test(p.receiptPath)) { window.open(p.receiptPath, '_blank'); return; }
    try { window.open(await signedFileUrl('receipts', p.receiptPath), '_blank'); } catch { /* unavailable */ }
  };

  const startEdit = (row) => { setEditId(row.id); setDraft({ ...row }); };
  const startNew = (date = todayISO()) => {
    setEditId('__new__');
    setDraft({ date, durationHrs: 1, propLabel: 'Unassigned', unit: '', category: 'general', note: '' });
  };
  const cancel = () => { setEditId(null); setDraft(null); setSplitDate(null); };
  // open the split-day allocator (self-serve multi-property allocation)
  const startSplit = (date = todayISO()) => { setEditId(null); setDraft(null); setSplitDate(date); };
  const saveSplit = async ({ date, lines }) => {
    setBusy(true);
    let unsynced = false;
    for (const ln of lines) {
      const hrs = Math.round((Number(ln.hrs) || 0) * 100) / 100;
      if (hrs <= 0) continue;
      const note = (ln.note || '').trim();
      const tags = tagsOf(note);
      const propLabel = (ln.propLabel && ln.propLabel !== 'Unassigned') ? ln.propLabel : (tags[0] || 'Unassigned');
      // eslint-disable-next-line no-await-in-loop
      const res = await store.addTimesheet({ date, durationHrs: hrs, propLabel, unit: (ln.unit || '').trim(), category: ln.category || 'general', note, workOrderId: ln.workOrderId || null });
      if (res?.needsOperator) unsynced = true;
    }
    setBusy(false); cancel();
    // login not linked to an operator → the rows can't reach the shared timers table
    if (unsynced) alert('Your login isn’t linked to an operator, so these hours stay on this device only and won’t sync. Ask the office to link your account.');
  };
  // office drills into an operator — land on List (their history is usually not this week)
  // and anchor the week to their last logged day so a Week toggle is populated too
  const openOp = (o) => { setOpFilter(o.key); setView('list'); if (o.last) setWeekAnchor(o.last); cancel(); };
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    const note = (draft.note || '').trim();
    // an @-tagged property on an otherwise-unassigned entry routes those hours to that door
    const tags = tagsOf(note);
    const propLabel = (draft.propLabel && draft.propLabel !== 'Unassigned') ? draft.propLabel : (tags[0] || 'Unassigned');
    const patch = {
      date: draft.date, durationHrs: Math.round((Number(draft.durationHrs) || 0) * 100) / 100,
      propLabel, unit: (draft.unit || '').trim(), category: draft.category, note,
    };
    if (editId === '__new__') await store.addTimesheet(patch);
    else await store.updateTimesheet(editId, patch);
    setBusy(false); cancel();
  };
  const del = async (id) => { setConfirmDel(null); await store.deleteTimesheet(id); if (editId === id) cancel(); };

  const editorEl = draft && <TsEditor draft={draft} setDraft={setDraft} propNames={propNames} onSave={save} onCancel={cancel} busy={busy} />;

  const CAP = 250;
  const shown = rows.slice(0, CAP);
  const colspan = isOffice ? 9 : 8;

  return (
    <div>
      <div className="view-head">
        <h1>{isOffice ? 'Timesheets' : 'Timesheet'}</h1>
        <p>{!isOffice ? 'Your week, scheduled out. Log hours on any day, and @tag a property in the comment to route them.'
          : officeIndex ? 'Every operator’s hours — per person, with the master tally.'
          : `${activeOp?.name || 'Operator'}’s timesheet — review, correct, and tag to the right door.`}</p>
      </div>

      {/* office: operator rail — All (master roster) + one chip per person */}
      {isOffice && (
        <div className="card" style={{ marginBottom: 'var(--gap)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="field-label" style={{ margin: 0, marginRight: 2 }}>Operators</span>
          <button className={'chip' + (opFilter === 'all' ? ' on' : '')} style={{ cursor: 'pointer', border: opFilter === 'all' ? '1px solid var(--accent)' : '1px solid var(--line)' }}
            onClick={() => { setOpFilter('all'); cancel(); }}><IcUsers width={12} height={12} style={{ verticalAlign: -2, marginRight: 4 }} />All · master tally</button>
          {roster.map((o) => (
            <button key={o.key} className={'chip' + (opFilter === o.key ? ' on' : '')} style={{ cursor: 'pointer', border: opFilter === o.key ? '1px solid var(--accent)' : '1px solid var(--line)' }}
              onClick={() => openOp(o)}>{o.name} · <span className="mono">{Math.round(o.hrs * 10) / 10}h</span></button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button className="btn ghost sm" onClick={onExportXlsx} title="Export to a formula-driven Excel workbook" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><IcTable width={12} height={12} /> Excel</button>
            <button className="btn ghost sm" onClick={onExportPdf} title="Export a Caliper-branded PDF" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><IcReceipt width={12} height={12} /> PDF</button>
          </div>
        </div>
      )}

      {officeIndex ? (
        <>
          {/* master tally + period */}
          <div className="card" style={{ marginBottom: 'var(--gap)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="pick" style={{ margin: 0 }}>
              {PERIODS.map(([v, l]) => <button key={v} className={period === v ? 'on' : ''} onClick={() => setPeriod(v)}>{l}</button>)}
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', gap: 18, alignItems: 'baseline' }}>
              <div><span className="mono" style={{ fontSize: 20, fontWeight: 700 }}>{Math.round(master.hrs * 10) / 10}</span> <span className="s" style={{ color: 'var(--text-dim)' }}>hrs</span></div>
              {masterHasPay && <div><span className="mono" style={{ fontSize: 20, fontWeight: 700, color: 'var(--money)' }}>{money(master.pay)}</span> <span className="s" style={{ color: 'var(--text-dim)' }}>labor</span></div>}
              <div><span className="mono" style={{ fontSize: 20, fontWeight: 700 }}>{roster.length}</span> <span className="s" style={{ color: 'var(--text-dim)' }}>{roster.length === 1 ? 'operator' : 'operators'}</span></div>
            </div>
          </div>

          {/* per-operator index — click a row to open that person's sheet */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="rr-scroll">
              <table className="rr-tbl ts-tbl">
                <thead><tr>
                  <th>Operator</th><th className="num">Hours</th>{masterHasPay && <th className="num">Labor</th>}<th className="num">Entries</th><th>Top property</th><th>Last logged</th><th aria-label="open"></th>
                </tr></thead>
                <tbody>
                  {roster.length === 0 && <tr><td colSpan={masterHasPay ? 7 : 6} style={{ padding: 20, textAlign: 'center', color: 'var(--text-faint)' }}>No hours logged in this period.</td></tr>}
                  {roster.map((o) => (
                    <tr key={o.key} style={{ cursor: 'pointer' }} onClick={() => openOp(o)}>
                      <td style={{ fontWeight: 600 }}>{o.name}</td>
                      <td className="num mono" style={{ fontWeight: 700 }}>{Math.round(o.hrs * 10) / 10}</td>
                      {masterHasPay && <td className="num mono money">{money(o.pay)}</td>}
                      <td className="num mono ts-dim">{o.entries}</td>
                      <td className="ts-dim" style={{ fontSize: 13 }}>{o.topProp}</td>
                      <td className="ts-dim mono" style={{ fontSize: 12 }}>{o.last ? fmtDate(o.last) : '—'}</td>
                      <td><button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); openOp(o); }}>Open ›</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {/* per-property rollup — the "Monthly / Quarterly totals" box, every operator summed by door */}
          {propRoll.length > 0 && (
            <div className="card" style={{ marginTop: 'var(--gap)' }}>
              <span className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <IcBuilding width={13} height={13} /> By property · all operators, this period
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                {propRoll.map((p) => (
                  <div key={p.name} style={{ display: 'grid', gridTemplateColumns: '160px 1fr auto', gap: 10, alignItems: 'center' }}>
                    <span style={{ fontSize: 13, color: p.name === 'Unassigned' ? 'var(--text-faint)' : 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    <span className="ts-alloc-bar"><span style={{ width: Math.max(2, (p.hrs / propRollMax) * 100) + '%', background: 'var(--accent)' }} /></span>
                    <span className="mono" style={{ fontSize: 12, minWidth: 110, textAlign: 'right' }}>
                      {Math.round(p.hrs * 10) / 10}h{propRollHasPay && p.pay > 0 && <span className="money"> · {money(p.pay)}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="note"><IcTable width={12} height={12} style={{ verticalAlign: -2 }} /> Open an operator to see their week, correct an entry, or check where their hours landed. Totals here roll every operator together for the selected period.</p>
        </>
      ) : (
      <>
      {viewingOp && (
        <button className="btn ghost sm" style={{ marginBottom: 10 }} onClick={() => { setOpFilter('all'); cancel(); }}><IcChevron width={13} height={13} style={{ transform: 'rotate(180deg)', verticalAlign: -2 }} /> All timesheets</button>
      )}

      {/* view toggle + totals + add */}
      <div className="card" style={{ marginBottom: 'var(--gap)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="pick" style={{ margin: 0 }}>
          <button className={view === 'week' ? 'on' : ''} onClick={() => setView('week')}><IcCal width={12} height={12} style={{ verticalAlign: -1, marginRight: 4 }} />Week</button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}><IcTable width={12} height={12} style={{ verticalAlign: -1, marginRight: 4 }} />List</button>
        </div>
        {view === 'list' && (
          <div className="pick" style={{ margin: 0 }}>
            {PERIODS.map(([v, l]) => <button key={v} className={period === v ? 'on' : ''} onClick={() => setPeriod(v)}>{l}</button>)}
          </div>
        )}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
          <div><span className="mono" style={{ fontSize: 20, fontWeight: 700 }}>{Math.round(totHrs * 10) / 10}</span> <span className="s" style={{ color: 'var(--text-dim)' }}>{view === 'week' ? 'wk hrs' : 'hrs'}</span></div>
          {hasPay && <div><span className="mono" style={{ fontSize: 20, fontWeight: 700, color: 'var(--money)' }}>{money(totPay)}</span> <span className="s" style={{ color: 'var(--text-dim)' }}>pay</span></div>}
        </div>
        {canAdd && <button className="btn ghost sm" onClick={() => startSplit(view === 'week' ? weekDays.find((d) => d === todayISO()) || weekStart : todayISO())} disabled={!!splitDate}><IcBuilding width={12} height={12} style={{ verticalAlign: -1, marginRight: 4 }} />Split day</button>}
        {canAdd && <button className="btn grad sm" onClick={() => startNew()} disabled={editId === '__new__'}>+ Add entry</button>}
      </div>

      {/* allocation by property — updates as the timer ticks */}
      {alloc.length > 0 && (
        <div className="card" style={{ marginBottom: 'var(--gap)' }}>
          <span className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <IcBuilding width={13} height={13} /> {view === 'week' ? 'This week by property' : 'Allocation by property'}{liveInScope && <span className="ts-live-dot" style={{ marginLeft: 2 }} />}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {alloc.slice(0, 8).map((a) => {
              const isLive = liveInScope && nameKey(a.name) === nameKey(live.propLabel);
              return (
                <div key={a.name} style={{ display: 'grid', gridTemplateColumns: '150px 1fr auto', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: isLive ? 'var(--money)' : 'var(--text-dim)', fontWeight: isLive ? 700 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                  <span className="ts-alloc-bar"><span style={{ width: Math.max(2, (a.hrs / allocMax) * 100) + '%', background: isLive ? 'var(--money)' : 'var(--accent)' }} /></span>
                  <span className="mono" style={{ fontSize: 12, minWidth: 96, textAlign: 'right' }}>
                    {Math.round(a.hrs * 10) / 10}h{hasPay && a.pay > 0 && <span className="money"> · {money(a.pay)}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* split-day allocator (self-serve multi-property allocation) */}
      {splitDate && (
        <div className="card" style={{ marginBottom: 'var(--gap)', borderColor: 'var(--accent)' }}>
          <span className="field-label" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <IcBuilding width={13} height={13} /> Split a day across the properties you worked
          </span>
          <SplitEditor date0={splitDate} propNames={propNames} workOrders={workOrders} onSaveAll={saveSplit} onCancel={cancel} busy={busy} />
        </div>
      )}

      {/* new-entry editor (shared) — shown at top when adding from the list toolbar */}
      {editId === '__new__' && view === 'list' && (
        <div className="card" style={{ marginBottom: 'var(--gap)', borderColor: 'var(--accent)' }}>{editorEl}</div>
      )}

      {/* week view keeps the editor full-width above the grid — a 1/7 column is too cramped for it */}
      {view === 'week' && draft && (
        <div className="card" style={{ marginBottom: 'var(--gap)', borderColor: 'var(--accent)' }}>
          <span className="field-label" style={{ marginBottom: 8, display: 'block' }}>{editId === '__new__' ? 'Log hours' : 'Edit entry'} · {fmtDate(draft.date)}</span>
          {editorEl}
          {editId !== '__new__' && (
            <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
              {confirmDel === editId ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className="s" style={{ color: 'var(--text-dim)' }}>Delete this entry?</span>
                  <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => del(editId)}>Delete</button>
                  <button className="btn ghost sm" onClick={() => setConfirmDel(null)}>Keep</button>
                </div>
              ) : (
                <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => setConfirmDel(editId)}><IcTrash width={13} height={13} style={{ verticalAlign: -2, marginRight: 4 }} />Delete entry</button>
              )}
            </div>
          )}
        </div>
      )}

      {view === 'week' ? (
        <>
          {/* week navigator */}
          <div className="card" style={{ marginBottom: 'var(--gap)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="btn ghost sm icon-btn" onClick={() => setWeekAnchor(addDays(weekStart, -7))} aria-label="Previous week"><IcChevron width={15} height={15} style={{ transform: 'rotate(180deg)' }} /></button>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontWeight: 700 }}>{weekLabel}</div>
              <div className="s" style={{ color: 'var(--text-faint)' }}>week of {fmtDate(weekStart)}</div>
            </div>
            <button className="btn ghost sm icon-btn" onClick={() => setWeekAnchor(addDays(weekStart, 7))} aria-label="Next week"><IcChevron width={15} height={15} /></button>
            {weekStart !== weekStartOf(todayISO()) && <button className="btn ghost sm" onClick={() => setWeekAnchor(todayISO())}>This week</button>}
          </div>

          <div className="ts-week">
            {weekDays.map((iso) => {
              const entries = byDay[iso] || [];
              const isToday = iso === todayISO();
              const showLive = live && liveInScope && live.date === iso;
              const dayHrs = entries.reduce((a, r) => a + (r.durationHrs || 0), 0) + (showLive ? live.hrs : 0);
              const targetsHere = draft && draft.date === iso;   // this day is the one being added/edited
              const d = new Date(`${iso}T00:00:00`);
              return (
                <div key={iso} className={'ts-day' + (isToday ? ' today' : '') + (targetsHere ? ' today' : '')}>
                  <div className="ts-day-hd">
                    <div>
                      <div className="ts-day-dow">{DOW[d.getDay()]}{isToday && ' • today'}</div>
                      <div className="ts-day-num">{d.getDate()}</div>
                    </div>
                    {dayHrs > 0 && <div className="ts-day-tot">{Math.round(dayHrs * 10) / 10}h</div>}
                  </div>
                  <div className="ts-day-body">
                    {showLive && (
                      <div className="ts-chip" style={{ borderColor: 'color-mix(in srgb, var(--money) 45%, var(--line))' }}>
                        <div className="tc-top"><span style={{ fontSize: 11.5 }}><span className="ts-live-dot" style={{ width: 6, height: 6 }} />{live.onBreak ? 'on break' : 'running'}</span><span className="tc-hrs" style={{ color: 'var(--money)' }}>{live.hrs.toFixed(2)}h</span></div>
                        <div className="tc-prop">{live.propLabel}</div>
                      </div>
                    )}
                    {entries.map((r) => (
                      <button key={r.id} className="ts-chip" onClick={() => startEdit(r)} style={editId === r.id ? { borderColor: 'var(--accent)' } : undefined}>
                        <div className="tc-top">
                          <span style={{ fontSize: 11.5, textTransform: 'capitalize', color: 'var(--text-dim)' }}>{r.category}</span>
                          <span className="tc-hrs">{r.durationHrs}h</span>
                        </div>
                        <div className="tc-prop">
                          {r.propLabel && r.propLabel !== 'Unassigned' ? r.propLabel : <span style={{ color: 'var(--text-faint)' }}>unassigned</span>}
                          {r.verified === true && <IcMapPin width={10} height={10} style={{ color: 'var(--money)', marginLeft: 3, verticalAlign: -1 }} />}
                          {r.unit && <span className="ts-dim"> · {r.unit}</span>}
                        </div>
                        {r.note && <div style={{ fontSize: 11, marginTop: 3, lineHeight: 1.35 }}>{renderNote(r.note)}</div>}
                      </button>
                    ))}
                    {entries.length === 0 && !showLive && <div className="ts-dim" style={{ fontSize: 11.5, padding: '4px 2px' }}>—</div>}
                  </div>
                  {canAdd && <button className="ts-day-add" onClick={() => startNew(iso)}>+ log</button>}
                </div>
              );
            })}
          </div>
          <p className="note"><IcClock width={12} height={12} style={{ verticalAlign: -2 }} /> Tap any entry to fix it, <b>+ log</b> for a single job, or <b>Split day</b> to divide one day's hours across every property you worked — each line lands on its own door. Type <b style={{ color: 'var(--accent)' }}>@</b> in a comment to tag a property too.</p>
        </>
      ) : (
        <>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="rr-scroll">
              <table className="rr-tbl ts-tbl">
                <thead><tr>
                  <th>Date</th><th>Time</th><th className="num">Hrs</th><th>For / comment</th>
                  <th>Property</th><th>Unit</th><th>Receipts</th>
                  {isOffice && <th>Crew</th>}
                  <th aria-label="actions"></th>
                </tr></thead>
                <tbody>
                  {live && (
                    <tr className="ts-live-row">
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 700 }}><span className="ts-live-dot" />Now</td>
                      <td className="ts-dim mono" style={{ fontSize: 12 }}>{live.onBreak ? 'on break' : 'running'}</td>
                      <td className="num mono" style={{ fontWeight: 700, color: 'var(--money)' }}>{live.hrs.toFixed(2)}</td>
                      <td>
                        <span style={{ textTransform: 'capitalize' }}>{live.category}</span>
                        {live.rate > 0 && <span className="ts-dim" style={{ fontSize: 11 }}> @ ${live.rate}/hr · <span className="money" style={{ fontWeight: 700 }}>{money(live.hrs * live.rate)}</span></span>}
                        {live.woTask && <div className="ts-dim" style={{ fontSize: 11 }}>{live.woTask}</div>}
                      </td>
                      <td>{live.propLabel}</td>
                      <td className="mono">{live.unit || <span className="ts-dim">—</span>}</td>
                      <td className="ts-dim">—</td>
                      {isOffice && <td className="ts-dim" style={{ fontSize: 12 }}>on the clock</td>}
                      <td className="ts-dim" style={{ fontSize: 11 }}>compiling…</td>
                    </tr>
                  )}
                  {shown.length === 0 && editId !== '__new__' && !live && (
                    <tr><td colSpan={colspan} style={{ padding: 20, textAlign: 'center', color: 'var(--text-faint)' }}>{isOffice ? 'No hours logged for this operator in this period.' : 'No entries in this period. Log time in the Field timer, or “+ Add entry”.'}</td></tr>
                  )}
                  {shown.map((r) => {
                    if (editId === r.id) return <tr key={r.id} className="ts-edit-row"><td colSpan={colspan}>{editorEl}</td></tr>;
                    const recs = receiptsFor(r);
                    return (
                      <tr key={r.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.date)}</td>
                        <td className="ts-dim mono" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{(r.source === 'import' || r.category === 'imported' || r.imported) ? 'imported' : timeWindow(r)}</td>
                        <td className="num mono" style={{ fontWeight: 700 }}>{r.durationHrs}</td>
                        <td>
                          <span style={{ textTransform: 'capitalize' }}>{r.category}</span>
                          {r.note && <div className="ts-dim" style={{ fontSize: 11 }}>{renderNote(r.note)}</div>}
                        </td>
                        <td>
                          {r.propLabel && r.propLabel !== 'Unassigned' ? r.propLabel : <span className="ts-dim">—</span>}
                          {r.verified === true && <IcMapPin width={11} height={11} style={{ color: 'var(--money)', marginLeft: 4, verticalAlign: -1 }} title="verified on-site" />}
                        </td>
                        <td className="mono">{r.unit || <span className="ts-dim">—</span>}</td>
                        <td>
                          {recs.length === 0 ? <span className="ts-dim">—</span> : (
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {recs.slice(0, 2).map((p) => (
                                <button key={p.id} className="ts-rec" onClick={() => openReceipt(p)} title={`${p.vendor || 'Receipt'} — $${(p.amount || 0).toFixed(2)}`}>
                                  <IcReceipt width={11} height={11} /> ${Math.round(p.amount || 0)}
                                </button>
                              ))}
                              {recs.length > 2 && <span className="ts-dim" style={{ fontSize: 11 }}>+{recs.length - 2}</span>}
                            </div>
                          )}
                        </td>
                        {isOffice && <td className="ts-dim" style={{ fontSize: 12 }}>{techById[r.techId]?.name || '—'}</td>}
                        <td>
                          {confirmDel === r.id ? (
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="btn ghost sm icon-btn" style={{ color: 'var(--danger)' }} onClick={() => del(r.id)} aria-label="Confirm delete"><IcCheck width={14} height={14} /></button>
                              <button className="btn ghost sm icon-btn" onClick={() => setConfirmDel(null)} aria-label="Cancel"><IcX width={14} height={14} /></button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: 2 }}>
                              <button className="btn ghost sm" onClick={() => startEdit(r)}>Edit</button>
                              <button className="btn ghost sm icon-btn" style={{ color: 'var(--text-faint)' }} onClick={() => setConfirmDel(r.id)} aria-label="Delete"><IcTrash width={13} height={13} /></button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {rows.length > CAP && <p className="note">Showing the {CAP} most recent of {rows.length} entries — narrow the period to see the rest.</p>}
          <p className="note"><IcTable width={12} height={12} style={{ verticalAlign: -2 }} /> Edits flow straight to the labor spine — change an entry here and it moves the dashboards, per-door P&amp;L, and payroll together.</p>
        </>
      )}
      </>
      )}
    </div>
  );
}
