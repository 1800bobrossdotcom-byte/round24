import { useState, useMemo, useRef } from 'react';
import { useAuth } from '../components/AuthGate.jsx';
import { isConfigured } from '../lib/backend/supabase.js';
import { parseLeaseWorkbook } from '../lib/leaseParser.js';
import { IcBuilding, IcImport, IcChevron } from '../components/ui.jsx';

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

export default function Leasing({ store }) {
  const { role } = useAuth();
  const canEdit = role === 'admin' || role === 'manager';
  const rows = store.leasing || [];

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState({ key: 'unit', dir: 'asc' });
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [dense, setDense] = useState(false);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const fileRef = useRef(null);

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
        <div className="kpi-c"><span className="v mono">{kpi.units}</span><span className="k">units</span></div>
        <div className="kpi-c"><span className="v mono" style={{ color: 'var(--money)' }}>{kpi.occPct}%</span><span className="k">occupied · {kpi.vac} vacant</span></div>
        <div className="kpi-c"><span className="v mono">{money0(kpi.potential)}</span><span className="k">potential / mo</span></div>
        <div className="kpi-c"><span className="v mono">{money0(kpi.billed)}</span><span className="k">billed / mo</span></div>
        <div className="kpi-c"><span className="v mono" style={{ color: 'var(--warn)' }}>{money0(kpi.loss)}</span><span className="k">vacancy loss / mo</span></div>
        <div className="kpi-c"><span className="v mono">{money0(kpi.deposits)}</span><span className="k">deposits held</span></div>
      </div>

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
                <div className="lead">
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
        const occ = units.filter((u) => u.status === 'leased').length;
        const rent = units.reduce((a, u) => a + (u.rent || 0), 0);
        const pct = units.length ? Math.round((occ / units.length) * 100) : 0;
        return (
          <div className={'card rr-bcard' + (dense ? ' dense' : '')} key={name} style={{ marginBottom: 'var(--gap)' }}>
            <button className="rr-bhead" onClick={() => toggleOne(name)} aria-expanded={isOpen}>
              <IcChevron className="rr-chev" width={14} height={14} style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }} />
              <span className="rr-bname"><IcBuilding width={13} height={13} style={{ verticalAlign: -2 }} /> {name}</span>
              <span className="rr-occbar" title={`${pct}% leased`}><span style={{ width: pct + '%', background: pct >= 90 ? 'var(--money)' : pct >= 75 ? 'var(--warn)' : 'var(--danger)' }} /></span>
              <span className="rr-bmeta mono">{occ}/{units.length} · {money0(rent)}/mo</span>
            </button>
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
                  </tr></thead>
                  <tbody>
                    {units.map((u) => {
                      const d = daysTo(u.leaseEnd);
                      const vac = u.status !== 'leased';
                      return (
                        <tr key={u.id} className={vac ? 'vac' : ''}>
                          <td className="mono"><span className="ustripe" style={{ background: statusMeta(u.status)[2] }} />{u.number}{u.furnished ? ' ·F' : ''}</td>
                          <td>{u.type === 'commercial' ? <em style={{ color: 'var(--info)' }}>{u.tenant || 'Vacant'}</em> : (u.tenant || <span style={{ color: 'var(--text-faint)' }}>vacant</span>)}</td>
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
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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
    </div>
  );
}
