import { useState, useMemo, useRef } from 'react';
import { useAuth } from '../components/AuthGate.jsx';
import { isConfigured } from '../lib/backend/supabase.js';
import { parseLeaseWorkbook } from '../lib/leaseParser.js';
import { fmtMoney } from '../lib/rollups.js';
import { IcBuilding, IcImport, IcCheck } from '../components/ui.jsx';

const UNIT_STATUS = [['leased', 'Leased', 'var(--money)'], ['vacant', 'Vacant', 'var(--warn)'], ['turning', 'Turning', 'var(--info)']];
const RENEWAL = [['undecided', 'Undecided'], ['renewed', 'Renewed'], ['not_renewing', 'Not renewing'], ['mtm', 'Month-to-month']];
const feeSum = (f) => Object.values(f || {}).reduce((a, b) => a + (b || 0), 0);
const daysTo = (d) => (d ? Math.ceil((new Date(d) - Date.now()) / 86400000) : null);
const money0 = (n) => (n == null ? '—' : '$' + Math.round(n).toLocaleString());

export default function Leasing({ store }) {
  const { role } = useAuth();
  const canEdit = role === 'admin' || role === 'manager';
  const rows = store.leasing || [];
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const fileRef = useRef(null);

  const kpi = useMemo(() => {
    const res = rows.filter((u) => u.type !== 'commercial');
    const occ = rows.filter((u) => u.status === 'leased');
    const potential = rows.reduce((a, u) => a + (u.rent || 0), 0);
    const billed = occ.reduce((a, u) => a + (u.rent || 0), 0);
    const deposits = rows.reduce((a, u) => a + (u.deposit || 0), 0);
    return {
      units: rows.length, occ: occ.length, vac: rows.length - occ.length,
      occPct: rows.length ? Math.round((occ.length / rows.length) * 100) : 0,
      potential, billed, loss: potential - billed, deposits, res: res.length,
    };
  }, [rows]);

  const byBuilding = useMemo(() => {
    const m = new Map();
    for (const u of rows) { const k = u.building || 'Unassigned'; if (!m.has(k)) m.set(k, []); m.get(k).push(u); }
    return [...m.entries()];
  }, [rows]);

  const renewals = useMemo(() =>
    rows.filter((u) => u.leaseEnd && daysTo(u.leaseEnd) <= 120).sort((a, b) => new Date(a.leaseEnd) - new Date(b.leaseEnd)),
    [rows]);

  const onImport = async (file) => {
    if (!file) return;
    setMsg(null); setBusy('parse');
    try {
      const buf = await file.arrayBuffer();
      const { buildings } = parseLeaseWorkbook(buf);
      const n = buildings.reduce((a, b) => a + b.units.length, 0);
      if (!n) { setMsg({ e: true, t: 'No lease worksheets found in that file.' }); setBusy(null); return; }
      setBusy('load');
      const res = await store.importLeases(buildings);
      setMsg({ t: `Imported ${res.units} units across ${res.buildings} buildings.` });
    } catch (e) { setMsg({ e: true, t: e.message || 'Could not import that workbook.' }); }
    finally { setBusy(null); }
  };

  return (
    <div>
      <div className="view-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div><h1>Rent roll</h1><p>Your portfolio, live — the spreadsheet, replaced. {canEdit ? 'Edit inline; everyone sees it instantly.' : 'Read-only.'}</p></div>
        {msg && <span className="chip" style={{ color: msg.e ? 'var(--danger)' : 'var(--money)', maxWidth: 240 }}>{msg.t}</span>}
      </div>

      {/* KPIs */}
      <div className="rr-kpis">
        <div className="kpi-c"><span className="v mono">{kpi.units}</span><span className="k">units</span></div>
        <div className="kpi-c"><span className="v mono" style={{ color: 'var(--money)' }}>{kpi.occPct}%</span><span className="k">occupied · {kpi.vac} vacant</span></div>
        <div className="kpi-c"><span className="v mono">{money0(kpi.potential)}</span><span className="k">potential / mo</span></div>
        <div className="kpi-c"><span className="v mono">{money0(kpi.billed)}</span><span className="k">billed / mo</span></div>
        <div className="kpi-c"><span className="v mono" style={{ color: 'var(--warn)' }}>{money0(kpi.loss)}</span><span className="k">vacancy loss / mo</span></div>
        <div className="kpi-c"><span className="v mono">{money0(kpi.deposits)}</span><span className="k">deposits held</span></div>
      </div>

      {/* empty state / import */}
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
      {renewals.length > 0 && (
        <div className="card" style={{ marginBottom: 'var(--gap)', borderColor: '#ffb02033' }}>
          <span className="field-label" style={{ color: 'var(--warn)' }}>Leases ending in 120 days ({renewals.length})</span>
          {renewals.map((u) => {
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
        </div>
      )}

      {/* rent roll by building */}
      {byBuilding.map(([name, units]) => {
        const occ = units.filter((u) => u.status === 'leased').length;
        const rent = units.reduce((a, u) => a + (u.rent || 0), 0);
        return (
          <div className="card" key={name} style={{ marginBottom: 'var(--gap)' }}>
            <div className="rr-bhead">
              <span className="field-label" style={{ margin: 0 }}><IcBuilding width={13} height={13} style={{ verticalAlign: -2 }} /> {name}</span>
              <span className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>{occ}/{units.length} leased · {money0(rent)}/mo</span>
            </div>
            <div className="rr-scroll">
              <table className="rr-tbl">
                <thead><tr><th>Unit</th><th>Tenant</th><th>Bd</th><th className="num">Rent</th><th className="num">Fees</th><th className="num">Total</th><th>Status</th></tr></thead>
                <tbody>
                  {units.map((u) => (
                    <tr key={u.id}>
                      <td className="mono">{u.number}{u.furnished ? ' ·F' : ''}</td>
                      <td>{u.type === 'commercial' ? <em style={{ color: 'var(--info)' }}>{u.tenant || 'Vacant'} </em> : (u.tenant || <span style={{ color: 'var(--text-faint)' }}>vacant</span>)}</td>
                      <td className="mono">{u.type === 'commercial' ? 'C' : (u.beds ?? '—')}</td>
                      <td className="num">
                        {canEdit
                          ? <input className="rr-num" type="number" defaultValue={u.rent ?? ''} onBlur={(e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v) && v !== u.rent) store.setLeaseField(u.id, { rent: v }); }} />
                          : <span className="mono">{money0(u.rent)}</span>}
                      </td>
                      <td className="num mono" style={{ color: 'var(--text-dim)' }}>{feeSum(u.fees) ? money0(feeSum(u.fees)) : '—'}</td>
                      <td className="num mono">{money0((u.rent || 0) + feeSum(u.fees))}</td>
                      <td>
                        {canEdit
                          ? <select className="rr-sel" value={u.status} onChange={(e) => store.setLeaseField(u.id, { status: e.target.value })}>
                              {UNIT_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                          : <span className="chip" style={{ color: (UNIT_STATUS.find((s) => s[0] === u.status) || [])[2] }}>{(UNIT_STATUS.find((s) => s[0] === u.status) || [])[1]}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

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
