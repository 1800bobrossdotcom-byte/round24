import { useState, useMemo, useRef, useEffect } from 'react';
import { useAuth } from '../components/AuthGate.jsx';
import { isConfigured } from '../lib/backend/supabase.js';
import { parseLeaseWorkbook } from '../lib/leaseParser.js';
import { IcBuilding, IcImport, IcChevron, IcX, IcWrench, IcReceipt, IcCal, IcCheck } from '../components/ui.jsx';

const UNIT_STATUS = [['leased', 'Leased', 'var(--money)'], ['vacant', 'Vacant', 'var(--warn)'], ['turning', 'Turning', 'var(--info)']];
const RENEWAL = [['undecided', 'Undecided'], ['renewed', 'Renewed'], ['not_renewing', 'Not renewing'], ['mtm', 'Month-to-month']];
const statusMeta = (s) => UNIT_STATUS.find((x) => x[0] === s) || UNIT_STATUS[0];
const feeSum = (f) => Object.values(f || {}).reduce((a, b) => a + (b || 0), 0);
const daysTo = (d) => (d ? Math.ceil((new Date(d) - Date.now()) / 86400000) : null);
const money0 = (n) => (n == null ? '—' : '$' + Math.round(n).toLocaleString());

// natural sort for mixed unit labels: 2, 2-F, 4B, 101, 206IL
function natUnit(a, b) {
  const pa = String(a).match(/\d+|\D+/g) || [], pb = String(b).match(/\d+|\D+/g) || [];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '', y = pb[i] ?? '';
    const nx = parseInt(x, 10), ny = parseInt(y, 10);
    if (!isNaN(nx) && !isNaN(ny)) { if (nx !== ny) return nx - ny; }
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

const FILTERS = [['all', 'All'], ['leased', 'Leased'], ['vacant', 'Vacant'], ['ending', 'Ending ≤120d'], ['commercial', 'Commercial']];

export default function Leasing({ store, navigate, focus }) {
  const { role } = useAuth();
  const go = navigate || (() => {});
  const canEdit = role === 'admin' || role === 'manager';
  const rows = store.leasing || [];
  const [detail, setDetail] = useState(null); // unitId for the drill-down drawer
  useEffect(() => {
    if (focus?.unitId) setDetail(focus.unitId);
    if (focus?.building) setQuery(focus.building);
  }, [focus]);
  const detailUnit = detail ? rows.find((u) => u.id === detail) : null;

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState({ key: 'unit', dir: 'asc' });
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [dense, setDense] = useState(false);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [editRow, setEditRow] = useState(null); // { id, draft }
  const fileRef = useRef(null);

  const dset = (k, v) => setEditRow((e) => ({ ...e, draft: { ...e.draft, [k]: v } }));
  const beginEdit = (u) => setEditRow({ id: u.id, draft: {
    number: u.number || '', beds: u.beds ?? '', type: u.type || 'residential', furnished: !!u.furnished,
    tenant: u.tenant || '', phone: u.phone || '', rent: u.rent ?? '', deposit: u.deposit ?? '',
    leaseStart: u.leaseStart || '', leaseEnd: u.leaseEnd || '', status: u.status || 'vacant',
  } });
  const saveEdit = () => {
    const d = editRow.draft;
    store.setLeaseField(editRow.id, {
      number: String(d.number).trim(), beds: d.beds === '' ? null : parseInt(d.beds, 10), type: d.type, furnished: !!d.furnished,
      tenant: d.tenant.trim(), phone: d.phone.trim(),
      rent: d.rent === '' ? null : parseFloat(d.rent), deposit: d.deposit === '' ? null : parseFloat(d.deposit),
      leaseStart: d.leaseStart || null, leaseEnd: d.leaseEnd || null, status: d.status,
    });
    setEditRow(null);
  };
  const delRow = (u) => { if (window.confirm(`Delete unit ${u.number || ''}${u.tenant ? ` — ${u.tenant}` : ''}? This removes the unit and its lease.`)) { store.removeUnit(u.id); setEditRow(null); } };
  const addUnitTo = async (building) => {
    const id = await store.addUnit(building);
    setCollapsed((s) => { const x = new Set(s); x.delete(building); return x; });
    setEditRow({ id, draft: { number: '', beds: '', type: 'residential', furnished: false, tenant: '', phone: '', rent: '', deposit: '', leaseStart: '', leaseEnd: '', status: 'vacant' } });
  };

  const kpi = useMemo(() => {
    const occ = rows.filter((u) => u.status === 'leased');
    const potential = rows.reduce((a, u) => a + (u.rent || 0), 0);
    const billed = occ.reduce((a, u) => a + (u.rent || 0), 0);
    return {
      units: rows.length, occ: occ.length, vac: rows.length - occ.length,
      occPct: rows.length ? Math.round((occ.length / rows.length) * 100) : 0,
      potential, billed, loss: potential - billed,
      deposits: rows.reduce((a, u) => a + (u.deposit || 0), 0),
    };
  }, [rows]);

  const q = query.trim().toLowerCase();
  const passes = (u) => {
    if (q && !((u.tenant || '').toLowerCase().includes(q) || String(u.number).toLowerCase().includes(q) || (u.building || '').toLowerCase().includes(q))) return false;
    if (filter === 'leased') return u.status === 'leased';
    if (filter === 'vacant') return u.status !== 'leased';
    if (filter === 'commercial') return u.type === 'commercial';
    if (filter === 'ending') return u.leaseEnd && daysTo(u.leaseEnd) <= 120;
    return true;
  };

  const sortVal = (u) => ({
    tenant: (u.tenant || '~~~').toLowerCase(), beds: u.beds ?? -1, rent: u.rent ?? -1,
    total: (u.rent || 0) + feeSum(u.fees), ends: u.leaseEnd || '9999-99', status: u.status,
  }[sort.key]);
  const cmp = (a, b) => {
    let r;
    if (sort.key === 'unit') r = natUnit(a.number, b.number);
    else { const va = sortVal(a), vb = sortVal(b); r = va < vb ? -1 : va > vb ? 1 : 0; }
    return sort.dir === 'asc' ? r : -r;
  };
  const sortBy = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  const buildings = useMemo(() => {
    const m = new Map();
    for (const u of rows) { if (!passes(u)) continue; const k = u.building || 'Unassigned'; if (!m.has(k)) m.set(k, []); m.get(k).push(u); }
    return [...m.entries()].map(([name, us]) => [name, [...us].sort(cmp)]).sort((a, b) => b[1].length - a[1].length);
  }, [rows, q, filter, sort]);

  // true per-building occupancy from ALL units (not the filtered view), so the
  // header stays honest when a filter is applied.
  const fullStats = useMemo(() => {
    const m = new Map();
    for (const u of rows) {
      const k = u.building || 'Unassigned';
      const s = m.get(k) || { units: 0, occ: 0, rent: 0 };
      s.units++; if (u.status === 'leased') { s.occ++; s.rent += u.rent || 0; }
      m.set(k, s);
    }
    return m;
  }, [rows]);

  const shownUnits = buildings.reduce((a, [, us]) => a + us.length, 0);
  const renewals = useMemo(() =>
    rows.filter((u) => u.leaseEnd && daysTo(u.leaseEnd) <= 120).sort((a, b) => new Date(a.leaseEnd) - new Date(b.leaseEnd)),
    [rows]);

  const allCollapsed = buildings.length > 0 && buildings.every(([n]) => collapsed.has(n));
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(buildings.map(([n]) => n)));
  const toggleOne = (n) => setCollapsed((s) => { const x = new Set(s); x.has(n) ? x.delete(n) : x.add(n); return x; });

  const onImport = async (file) => {
    if (!file) return;
    setMsg(null); setBusy('parse');
    try {
      const { buildings: parsed } = parseLeaseWorkbook(await file.arrayBuffer());
      const n = parsed.reduce((a, b) => a + b.units.length, 0);
      if (!n) { setMsg({ e: true, t: 'No lease worksheets found in that file.' }); setBusy(null); return; }
      setBusy('load');
      const res = await store.importLeases(parsed);
      setMsg({ t: `Imported ${res.units} units across ${res.buildings} buildings.` });
    } catch (e) { setMsg({ e: true, t: e.message || 'Could not import that workbook.' }); }
    finally { setBusy(null); }
  };

  const SortTh = ({ k, children, num }) => (
    <th className={'sortable' + (num ? ' num' : '')} onClick={() => sortBy(k)} aria-sort={sort.key === k ? sort.dir : 'none'}>
      {children}<span className="sarr">{sort.key === k ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
    </th>
  );

  return (
    <div>
      <div className="view-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div><h1>Rent roll</h1><p>Your portfolio, live — the spreadsheet, replaced. {canEdit ? 'Edit inline; everyone sees it instantly.' : 'Read-only.'}</p></div>
        {msg && <span className="chip" style={{ color: msg.e ? 'var(--danger)' : 'var(--money)', maxWidth: 240 }}>{msg.t}</span>}
      </div>

      <div className="rr-kpis">
        <button className={'kpi-c clk' + (filter === 'all' ? ' on' : '')} onClick={() => setFilter('all')} title="Show all units"><span className="v mono">{kpi.units}</span><span className="k">units</span></button>
        <button className={'kpi-c clk' + (filter === 'leased' ? ' on' : '')} onClick={() => setFilter('leased')} title="Filter to leased"><span className="v mono" style={{ color: 'var(--money)' }}>{kpi.occPct}%</span><span className="k">occupied · {kpi.vac} vacant</span></button>
        <div className="kpi-c"><span className="v mono">{money0(kpi.potential)}</span><span className="k">potential / mo</span></div>
        <button className={'kpi-c clk' + (filter === 'leased' ? ' on' : '')} onClick={() => setFilter('leased')} title="Filter to billed (leased)"><span className="v mono">{money0(kpi.billed)}</span><span className="k">billed / mo</span></button>
        <button className={'kpi-c clk' + (filter === 'vacant' ? ' on' : '')} onClick={() => setFilter('vacant')} title="Filter to vacant"><span className="v mono" style={{ color: 'var(--warn)' }}>{money0(kpi.loss)}</span><span className="k">vacancy loss / mo</span></button>
        <div className="kpi-c"><span className="v mono">{money0(kpi.deposits)}</span><span className="k">deposits held</span></div>
      </div>

      {rows.length > 0 && (
        <div className="rr-occsum">
          <div className="rr-occbar-lg" role="img" aria-label={`${kpi.occPct}% leased, ${100 - kpi.occPct}% vacant`}>
            <span className="leased" style={{ width: kpi.occPct + '%' }} />
            <span className="vacant" style={{ width: (100 - kpi.occPct) + '%' }} />
          </div>
          <div className="rr-occlegend">
            <button className="rr-occitem" onClick={() => setFilter('leased')}><i className="dot" style={{ background: 'var(--money)' }} /> Leased <b className="mono">{kpi.occ}</b> · <span className="mono" style={{ color: 'var(--money)' }}>{kpi.occPct}%</span></button>
            <button className="rr-occitem" onClick={() => setFilter('vacant')}><i className="dot" style={{ background: 'var(--warn)' }} /> Vacant <b className="mono">{kpi.vac}</b> · <span className="mono" style={{ color: 'var(--warn)' }}>{100 - kpi.occPct}%</span></button>
            <span className="rr-occitem" style={{ marginLeft: 'auto', cursor: 'default' }}><b className="mono">{kpi.units}</b> units total</span>
          </div>
        </div>
      )}

      {rows.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 28 }}>
          <IcBuilding width={26} height={26} style={{ opacity: .5 }} />
          <p style={{ fontWeight: 700, marginTop: 8 }}>No rent roll yet</p>
          <p className="note" style={{ maxWidth: 380, margin: '4px auto 14px' }}>
            {isConfigured() ? 'Import your lease worksheet workbook — Caliper reads every building sheet, normalizes it, and turns it into a living rent roll.' : 'Connect to the cloud to import and manage your rent roll.'}
          </p>
          {canEdit && isConfigured() && (
            <button className="btn grad" onClick={() => fileRef.current?.click()} disabled={busy}>
              <IcImport width={15} height={15} /> {busy === 'parse' ? 'Reading…' : busy === 'load' ? 'Importing…' : 'Import lease workbook'}
            </button>
          )}
        </div>
      )}

      {/* renewals pipeline */}
      {renewals.length > 0 && filter !== 'ending' && (
        <div className="card" style={{ marginBottom: 'var(--gap)', borderColor: '#ffb02033' }}>
          <span className="field-label" style={{ color: 'var(--warn)' }}>Leases ending in 120 days ({renewals.length}) · <a onClick={() => setFilter('ending')} style={{ cursor: 'pointer', color: 'var(--info)' }}>focus</a></span>
          {renewals.slice(0, 6).map((u) => {
            const d = daysTo(u.leaseEnd);
            return (
              <div className="row" key={u.id}>
                <div className="lead rr-link" onClick={() => setDetail(u.id)}>
                  <div className="t">{u.tenant || 'Vacant'} <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>· {u.building} {u.number}</span></div>
                  <div className="s">ends {u.leaseEnd} · <span style={{ color: d < 0 ? 'var(--danger)' : d <= 30 ? 'var(--warn)' : 'var(--text-dim)' }}>{d < 0 ? `${-d}d ago` : `${d}d`}</span></div>
                </div>
                {canEdit
                  ? <select className="rr-sel" value={u.renewalStatus || 'undecided'} onChange={(e) => store.setLeaseField(u.id, { renewalStatus: e.target.value })}>
                      {RENEWAL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  : <span className="chip">{(RENEWAL.find((r) => r[0] === (u.renewalStatus || 'undecided')) || [])[1]}</span>}
              </div>
            );
          })}
          {renewals.length > 6 && <p className="note" style={{ margin: '6px 0 0' }}>+{renewals.length - 6} more — <a onClick={() => setFilter('ending')} style={{ cursor: 'pointer', color: 'var(--info)' }}>show all</a></p>}
        </div>
      )}

      {/* toolbar: search · filters · density · collapse */}
      {rows.length > 0 && (
        <div className="rr-toolbar">
          <input className="rr-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tenant, unit, building…" />
          <div className="rr-filters">
            {FILTERS.map(([v, l]) => <button key={v} className={'rr-fchip' + (filter === v ? ' on' : '')} onClick={() => setFilter(v)}>{l}</button>)}
          </div>
          <div className="rr-tools">
            <button className={'rr-fchip' + (dense ? ' on' : '')} onClick={() => setDense((d) => !d)} title="Compact rows">⇋ Compact</button>
            <button className="rr-fchip" onClick={toggleAll}>{allCollapsed ? 'Expand all' : 'Collapse all'}</button>
          </div>
        </div>
      )}
      {rows.length > 0 && (q || filter !== 'all') && (
        <p className="note" style={{ margin: '0 0 10px 2px' }}>{shownUnits} of {rows.length} units{filter !== 'all' ? ` · ${(FILTERS.find((f) => f[0] === filter) || [])[1]}` : ''}{q ? ` · “${query}”` : ''}</p>
      )}

      {/* rent roll by building */}
      {buildings.map(([name, units]) => {
        const isOpen = !collapsed.has(name) || !!q;
        const fs = fullStats.get(name) || { units: units.length, occ: 0, rent: 0 };
        const occ = fs.occ, rent = fs.rent;
        const pct = fs.units ? Math.round((occ / fs.units) * 100) : 0;
        const editUnit = editRow ? units.find((u) => u.id === editRow.id) : null;
        return (
          <div className={'card rr-bcard' + (dense ? ' dense' : '')} key={name} style={{ marginBottom: 'var(--gap)' }}>
            <div className="rr-bhead-wrap">
              <button className="rr-bhead" onClick={() => toggleOne(name)} aria-expanded={isOpen}>
                <IcChevron className="rr-chev" width={14} height={14} style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }} />
                <span className="rr-bname"><IcBuilding width={13} height={13} style={{ verticalAlign: -2 }} /> {name}</span>
                <span className="rr-occbar" title={`${pct}% leased`}><span style={{ width: pct + '%', background: pct >= 90 ? 'var(--money)' : pct >= 75 ? 'var(--warn)' : 'var(--danger)' }} /></span>
                <span className="rr-bmeta mono">{occ}/{fs.units} · {pct}% · {money0(rent)}/mo</span>
              </button>
              {canEdit && <button className="rr-add" onClick={() => addUnitTo(name)} title="Add a unit">+ Unit</button>}
            </div>
            {isOpen && (
              <div className="rr-scroll">
                <table className="rr-tbl">
                  <thead><tr>
                    <SortTh k="unit">Unit</SortTh>
                    <SortTh k="tenant">Tenant</SortTh>
                    <SortTh k="beds">Bd</SortTh>
                    <SortTh k="rent" num>Rent</SortTh>
                    <th className="num">Fees</th>
                    <SortTh k="total" num>Total</SortTh>
                    <SortTh k="ends">Ends</SortTh>
                    <SortTh k="status">Status</SortTh>
                    {canEdit && <th aria-label="actions"></th>}
                  </tr></thead>
                  <tbody>
                    {units.map((u) => {
                      const d = daysTo(u.leaseEnd);
                      const vac = u.status !== 'leased';
                      const isEd = editRow && editRow.id === u.id;
                      return (
                        <tr key={u.id} className={vac ? 'vac' : ''}>
                          <td className="mono rr-link" onClick={() => setDetail(u.id)}><span className="ustripe" style={{ background: statusMeta(u.status)[2] }} />{u.number}{u.furnished ? ' ·F' : ''}</td>
                          <td className="rr-link" onClick={() => setDetail(u.id)}>{u.type === 'commercial' ? <em style={{ color: 'var(--info)' }}>{u.tenant || 'Vacant'}</em> : (u.tenant || <span style={{ color: 'var(--text-faint)' }}>vacant</span>)}</td>
                          <td className="mono">{u.type === 'commercial' ? 'C' : (u.beds ?? '—')}</td>
                          <td className="num">
                            {canEdit
                              ? <input className="rr-num" type="number" defaultValue={u.rent ?? ''} onBlur={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v) && v !== u.rent) store.setLeaseField(u.id, { rent: v }); }} />
                              : <span className="mono">{money0(u.rent)}</span>}
                          </td>
                          <td className="num mono" style={{ color: 'var(--text-dim)' }}>{feeSum(u.fees) ? money0(feeSum(u.fees)) : '—'}</td>
                          <td className="num mono">{money0((u.rent || 0) + feeSum(u.fees))}</td>
                          <td className="mono" style={{ fontSize: 12 }}>
                            {u.leaseEnd
                              ? <span title={u.leaseEnd} className={'ends-chip' + (d < 0 ? ' over' : d <= 60 ? ' soon' : '')}>{d < 0 ? `${-d}d ago` : `${d}d`}</span>
                              : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                          </td>
                          <td>
                            {canEdit
                              ? <select className="rr-sel" value={u.status} onChange={(e) => store.setLeaseField(u.id, { status: e.target.value })}>
                                  {UNIT_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                </select>
                              : <span className="chip" style={{ color: statusMeta(u.status)[2] }}>{statusMeta(u.status)[1]}</span>}
                          </td>
                          {canEdit && <td className="rr-actions"><button className="rr-edit" onClick={() => (isEd ? setEditRow(null) : beginEdit(u))}>{isEd ? 'Close' : 'Edit'}</button></td>}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {isOpen && editUnit && (
              <div className="rr-editpanel">
                <div className="field-label" style={{ marginTop: 0 }}>Edit unit {editUnit.number || '(new)'}</div>
                <div className="rr-edit-grid">
                  <label>Unit #<input value={editRow.draft.number} onChange={(e) => dset('number', e.target.value)} autoFocus /></label>
                  <label>Beds<input type="number" value={editRow.draft.beds} onChange={(e) => dset('beds', e.target.value)} placeholder="—" /></label>
                  <label>Type<select value={editRow.draft.type} onChange={(e) => dset('type', e.target.value)}><option value="residential">Residential</option><option value="commercial">Commercial</option></select></label>
                  <label className="rr-check"><input type="checkbox" checked={editRow.draft.furnished} onChange={(e) => dset('furnished', e.target.checked)} /> Furnished</label>
                  <label className="wide">Tenant<input value={editRow.draft.tenant} onChange={(e) => dset('tenant', e.target.value)} placeholder="Vacant" /></label>
                  <label>Phone<input value={editRow.draft.phone} onChange={(e) => dset('phone', e.target.value)} inputMode="tel" /></label>
                  <label>Rent<input type="number" value={editRow.draft.rent} onChange={(e) => dset('rent', e.target.value)} /></label>
                  <label>Deposit<input type="number" value={editRow.draft.deposit} onChange={(e) => dset('deposit', e.target.value)} /></label>
                  <label>Lease start<input type="date" value={editRow.draft.leaseStart} onChange={(e) => dset('leaseStart', e.target.value)} /></label>
                  <label>Lease end<input type="date" value={editRow.draft.leaseEnd} onChange={(e) => dset('leaseEnd', e.target.value)} /></label>
                  <label>Status<select value={editRow.draft.status} onChange={(e) => dset('status', e.target.value)}>{UNIT_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                </div>
                <div className="rr-edit-actions">
                  <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => delRow(editUnit)}>Delete unit</button>
                  <span style={{ flex: 1 }} />
                  <button className="btn ghost sm" onClick={() => setEditRow(null)}>Cancel</button>
                  <button className="btn grad sm" onClick={saveEdit}>Save</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {rows.length > 0 && buildings.length === 0 && <div className="card"><p className="note">No units match “{query}”{filter !== 'all' ? ` in ${(FILTERS.find((f) => f[0] === filter) || [])[1]}` : ''}.</p></div>}

      {rows.length > 0 && canEdit && isConfigured() && (
        <p className="note" style={{ marginTop: 4 }}>
          <a onClick={() => fileRef.current?.click()} style={{ color: 'var(--info)', cursor: 'pointer' }}>
            <IcImport width={12} height={12} style={{ verticalAlign: -2 }} /> Import another lease workbook
          </a> — new buildings are added; existing ones stay.
        </p>
      )}
      <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(e) => { onImport(e.target.files?.[0]); e.target.value = ''; }} />

      {detailUnit && (
        <UnitDetail u={detailUnit} store={store} canEdit={canEdit} go={go}
          onClose={() => setDetail(null)}
          onEdit={() => { setDetail(null); setCollapsed((s) => { const x = new Set(s); x.delete(detailUnit.building); return x; }); beginEdit(detailUnit); }}
          onRenewal={(v) => store.setLeaseField(detailUnit.id, { renewalStatus: v })} />
      )}
    </div>
  );
}

const sameBuild = (a, b) => (a || '').toLowerCase().trim() === (b || '').toLowerCase().trim();

// drill-down: a unit is a doorway to its lease, work orders, purchases + actions
function UnitDetail({ u, store, canEdit, go, onClose, onEdit, onRenewal }) {
  const wos = (store.workOrders || []).filter((w) => sameBuild(w.propLabel, u.building) && String(w.unit || '').toLowerCase() === String(u.number).toLowerCase());
  const purchases = (store.purchases || []).filter((p) => sameBuild(p.propLabel, u.building));
  const d = daysTo(u.leaseEnd);
  const fees = Object.entries(u.fees || {}).filter(([, v]) => v);
  return (
    <div className="udrawer-back" onClick={onClose}>
      <div className="udrawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Unit ${u.number}`}>
        <div className="udrawer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ud-unit">Unit {u.number}{u.furnished ? ' · Furnished' : ''}{u.type === 'commercial' ? ' · Commercial' : ''}</div>
            <div className="ud-bldg"><IcBuilding width={12} height={12} style={{ verticalAlign: -2 }} /> {u.building}</div>
          </div>
          <span className="chip" style={{ color: statusMeta(u.status)[2] }}>{statusMeta(u.status)[1]}</span>
          <button className="btn ghost sm icon-btn" onClick={onClose} aria-label="Close"><IcX width={16} height={16} /></button>
        </div>

        <div className="ud-sec">
          <div className="ud-label">Tenant</div>
          {u.tenant
            ? <><div className="ud-tenant">{u.tenant}</div>{u.phone && <a href={`tel:${u.phone.replace(/[^0-9+]/g, '')}`} className="ud-phone">{u.phone}</a>}</>
            : <div className="note" style={{ margin: 0 }}>Vacant — no active tenant</div>}
        </div>

        <div className="ud-sec">
          <div className="ud-label">Lease</div>
          <div className="ud-money">
            <div><span>Rent</span><b className="mono">{money0(u.rent)}</b></div>
            {fees.map(([k, v]) => <div key={k}><span style={{ textTransform: 'capitalize' }}>{k}</span><b className="mono">{money0(v)}</b></div>)}
            <div className="ud-total"><span>Total / mo</span><b className="mono">{money0((u.rent || 0) + feeSum(u.fees))}</b></div>
            <div><span>Deposit held</span><b className="mono">{money0(u.deposit)}</b></div>
            <div><span>Annualized rent</span><b className="mono">{money0((u.rent || 0) * 12)}</b></div>
          </div>
          <div className="ud-term">
            {(u.leaseStart || u.leaseEnd)
              ? <>{u.leaseStart || '—'} → {u.leaseEnd || '—'} {u.leaseEnd && <span className={'ends-chip' + (d < 0 ? ' over' : d <= 60 ? ' soon' : '')} style={{ marginLeft: 6 }}>{d < 0 ? `${-d}d ago` : `${d}d left`}</span>}</>
              : 'No lease term on file'}
          </div>
          {u.leaseEnd && canEdit && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="ud-label" style={{ margin: 0 }}>Renewal</span>
              <select className="rr-sel" value={u.renewalStatus || 'undecided'} onChange={(e) => onRenewal(e.target.value)}>{RENEWAL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </div>
          )}
        </div>

        <div className="ud-sec">
          <div className="ud-label"><IcWrench width={11} height={11} style={{ verticalAlign: -1 }} /> Work orders at this unit ({wos.length})</div>
          {wos.length === 0 && <div className="note" style={{ margin: 0 }}>None logged for this unit yet.</div>}
          {wos.map((w) => (
            <div className="ud-row" key={w.id} onClick={() => { onClose(); go('wo'); }}>
              <span className="t">{w.task}</span><span className="chip sm" style={{ color: 'var(--text-dim)' }}>{w.status.replace('_', ' ')}</span>
            </div>
          ))}
        </div>

        {purchases.length > 0 && (
          <div className="ud-sec">
            <div className="ud-label"><IcReceipt width={11} height={11} style={{ verticalAlign: -1 }} /> Purchases at {u.building} ({purchases.length})</div>
            {purchases.slice(0, 5).map((p) => (
              <div className="ud-row" key={p.id} onClick={() => { onClose(); go('pur'); }}>
                <span className="t">{p.vendor || 'Purchase'}{p.note ? ` · ${p.note}` : ''}</span><span className="mono money">{money0(p.amount)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="ud-actions">
          {canEdit && <button className="btn ghost sm" onClick={onEdit}>Edit unit</button>}
          <button className="btn ghost sm" onClick={() => { onClose(); go('wo', { newFor: { propLabel: u.building, unit: u.number === '—' ? '' : u.number, category: 'general' } }); }}><IcWrench width={13} height={13} /> New work order</button>
          {u.leaseEnd && <button className="btn ghost sm" onClick={() => { onClose(); go('cal', { day: u.leaseEnd }); }}><IcCal width={13} height={13} /> On calendar</button>}
        </div>
      </div>
    </div>
  );
}
