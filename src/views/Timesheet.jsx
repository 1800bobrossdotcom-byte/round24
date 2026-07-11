import { useState, useMemo, useEffect } from 'react';
import { signedFileUrl } from '../lib/backend/supabase.js';
import { IcTable, IcReceipt, IcCheck, IcX, IcTrash, IcMapPin, IcBuilding } from '../components/ui.jsx';

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
  const hrs = Math.round((Math.max(0, (end - run.start - (s.breakMs || 0)) / 1000) / 3600) * 100) / 100;
  if (!Number.isFinite(hrs)) return null; // corrupted timer (missing start) — don't poison sheet totals with NaN
  return {
    propLabel: propById[run.propId]?.name || run.propLabel || 'Unassigned',
    unit: run.unit === '—' ? '' : run.unit, category: run.category,
    hrs, rate: run.rate || 0, onBreak: !!s.onBreak, woTask: run.woTask,
  };
}

const CATS = ['plumbing', 'electrical', 'hvac', 'appliance', 'painting', 'turn', 'general', 'inspection'];
const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
const nameKey = (s) => (s || '').toLowerCase().trim();
const todayISO = () => new Date().toISOString().slice(0, 10);

const cellInput = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)',
  color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 13, padding: '6px 7px', borderRadius: 7,
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

const PERIODS = [['7', '7 days'], ['14', '2 weeks'], ['30', '30 days'], ['all', 'All']];

export default function Timesheet({ store }) {
  const { timesheet = [], purchases = [], properties = [], techById = {}, role } = store;
  const isOffice = role === 'admin' || role === 'manager';
  const [period, setPeriod] = useState('14');
  const [editId, setEditId] = useState(null); // row.id | '__new__'
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);

  // property options for the picker (rent-roll + labor buildings, de-duped)
  const propNames = useMemo(() => {
    const s = new Set(properties.map((p) => p.name));
    timesheet.forEach((r) => r.propLabel && s.add(r.propLabel));
    return [...s].filter(Boolean).sort();
  }, [properties, timesheet]);

  const rows = useMemo(() => {
    let list = [...timesheet];
    if (period !== 'all') {
      const cut = new Date(); cut.setDate(cut.getDate() - Number(period));
      const cutISO = cut.toISOString().slice(0, 10);
      list = list.filter((r) => r.date >= cutISO);
    }
    return list.sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : (b.createdAt || '').localeCompare(a.createdAt || '')));
  }, [timesheet, period]);

  const live = useLiveTimer(store.propById || {});

  const CAP = 250;
  const shown = rows.slice(0, CAP);
  const liveHrs = live ? live.hrs : 0;
  const livePay = live ? live.hrs * live.rate : 0;
  const totHrs = rows.reduce((a, r) => a + (r.durationHrs || 0), 0) + liveHrs;
  const totPay = rows.reduce((a, r) => a + (r.durationHrs || 0) * (r.rate || 0), 0) + livePay;
  const hasPay = rows.some((r) => r.rate > 0) || livePay > 0;

  // live allocation by property: filtered rows + the running timer as it accrues
  const alloc = useMemo(() => {
    const m = new Map();
    const add = (name, hrs, pay) => {
      const k = name || 'Unassigned'; const e = m.get(nameKey(k)) || { name: k, hrs: 0, pay: 0 };
      e.hrs += hrs; e.pay += pay; m.set(nameKey(k), e);
    };
    rows.forEach((r) => add(r.propLabel, r.durationHrs || 0, (r.durationHrs || 0) * (r.rate || 0)));
    if (live) add(live.propLabel, live.hrs, live.hrs * live.rate);
    return [...m.values()].sort((a, b) => b.hrs - a.hrs);
  }, [rows, live]);
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
  const startNew = () => {
    setEditId('__new__');
    setDraft({ date: todayISO(), durationHrs: 1, propLabel: propNames[0] || '', unit: '', category: 'general', note: '' });
  };
  const cancel = () => { setEditId(null); setDraft(null); };
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    const patch = {
      date: draft.date, durationHrs: Math.round((Number(draft.durationHrs) || 0) * 100) / 100,
      propLabel: draft.propLabel || 'Unassigned', unit: (draft.unit || '').trim(),
      category: draft.category, note: (draft.note || '').trim(),
    };
    if (editId === '__new__') await store.addTimesheet(patch);
    else await store.updateTimesheet(editId, patch);
    setBusy(false); cancel();
  };
  const del = async (id) => { setConfirmDel(null); await store.deleteTimesheet(id); if (editId === id) cancel(); };

  const colspan = isOffice ? 9 : 8;
  const editorCells = draft && (
    <>
      <td><input style={cellInput} type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></td>
      <td className="ts-dim">auto</td>
      <td><input style={{ ...cellInput, width: 62 }} type="number" step="0.25" min="0" inputMode="decimal" value={draft.durationHrs} onChange={(e) => setDraft({ ...draft, durationHrs: e.target.value })} /></td>
      <td>
        <select style={cellInput} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
          {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input style={{ ...cellInput, marginTop: 4 }} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="what for (note)" />
      </td>
      <td>
        <select style={cellInput} value={draft.propLabel} onChange={(e) => setDraft({ ...draft, propLabel: e.target.value })}>
          {propNames.map((n) => <option key={n} value={n}>{n}</option>)}
          {!propNames.includes(draft.propLabel) && draft.propLabel && <option value={draft.propLabel}>{draft.propLabel}</option>}
        </select>
      </td>
      <td><input style={{ ...cellInput, width: 64 }} value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} placeholder="unit" /></td>
      <td className="ts-dim">—</td>
      {isOffice && <td className="ts-dim">—</td>}
      <td>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="btn grad sm" onClick={save} disabled={busy || !(Number(draft.durationHrs) > 0)}>{busy ? '…' : 'Save'}</button>
          <button className="btn ghost sm" onClick={cancel} disabled={busy}>Cancel</button>
        </div>
      </td>
    </>
  );

  return (
    <div>
      <div className="view-head">
        <h1>Timesheet</h1>
        <p>{isOffice ? 'Every hour the crew logged — correct a run-long timer, a wrong unit, a missing note.' : 'Your logged hours. A timer ran long or landed on the wrong unit? Fix it right here.'}</p>
      </div>

      {/* period + totals + add */}
      <div className="card" style={{ marginBottom: 'var(--gap)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="pick" style={{ margin: 0 }}>
          {PERIODS.map(([v, l]) => <button key={v} className={period === v ? 'on' : ''} onClick={() => setPeriod(v)}>{l}</button>)}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
          <div><span className="mono" style={{ fontSize: 20, fontWeight: 700 }}>{Math.round(totHrs * 10) / 10}</span> <span className="s" style={{ color: 'var(--text-dim)' }}>hrs</span></div>
          {hasPay && <div><span className="mono" style={{ fontSize: 20, fontWeight: 700, color: 'var(--money)' }}>{money(totPay)}</span> <span className="s" style={{ color: 'var(--text-dim)' }}>pay</span></div>}
        </div>
        <button className="btn grad sm" onClick={startNew} disabled={editId === '__new__'}>+ Add entry</button>
      </div>

      {/* live allocation by property — updates as the timer ticks */}
      {alloc.length > 0 && (
        <div className="card" style={{ marginBottom: 'var(--gap)' }}>
          <span className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <IcBuilding width={13} height={13} /> Allocation by property{live && <span className="ts-live-dot" style={{ marginLeft: 2 }} />}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {alloc.slice(0, 8).map((a) => {
              const isLive = live && nameKey(a.name) === nameKey(live.propLabel);
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

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="rr-scroll">
          <table className="rr-tbl ts-tbl">
            <thead><tr>
              <th>Date</th><th>Time</th><th className="num">Hrs</th><th>For</th>
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
              {editId === '__new__' && <tr className="ts-edit-row">{editorCells}</tr>}
              {shown.length === 0 && editId !== '__new__' && !live && (
                <tr><td colSpan={colspan} style={{ padding: 20, textAlign: 'center', color: 'var(--text-faint)' }}>No entries in this period. Log time in the Field timer, or “+ Add entry”.</td></tr>
              )}
              {shown.map((r) => {
                if (editId === r.id) return <tr key={r.id} className="ts-edit-row">{editorCells}</tr>;
                const recs = receiptsFor(r);
                return (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.date)}</td>
                    <td className="ts-dim mono" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{timeWindow(r)}</td>
                    <td className="num mono" style={{ fontWeight: 700 }}>{r.durationHrs}</td>
                    <td>
                      <span style={{ textTransform: 'capitalize' }}>{r.category}</span>
                      {r.note && <div className="ts-dim" style={{ fontSize: 11 }}>{r.note}</div>}
                    </td>
                    <td>
                      {r.propLabel || <span className="ts-dim">—</span>}
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
    </div>
  );
}
