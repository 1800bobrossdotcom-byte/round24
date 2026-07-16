import { useMemo, useState } from 'react';
import { coiSummary, coiStatus, daysToExpiry } from '../lib/coi.js';
import { todayISO } from '../lib/dates.js';
import { useAuth } from '../components/AuthGate.jsx';
import { IcShield, IcCheck } from '../components/ui.jsx';

const fmtLimit = (n) => (!n ? '—' : n >= 1e6 ? `$${(n / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 })}M` : `$${Number(n).toLocaleString()}`);
const fmtDate = (d) => (!d ? '—' : new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }));

const STATUS = {
  active: { label: 'Active', color: 'var(--money)' },
  expiring: { label: 'Expiring', color: 'var(--warn)' },
  expired: { label: 'Expired', color: 'var(--danger)' },
  unknown: { label: 'No date', color: 'var(--text-faint)' },
};
const COVERAGE_TYPES = [
  ['general_liability', 'General liability'], ['auto', 'Auto'],
  ['workers_comp', "Workers' comp"], ['umbrella', 'Umbrella'], ['professional', 'Professional'],
];

const inp = { width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 14, padding: 9, borderRadius: 9 };

// Certificate of Insurance tracking — vendors (Pro's subs) + tenants (Enterprise).
// The "risk management" surface: who's insured, for how much, and what's lapsing.
export default function COI({ store }) {
  const { cois = [], vendors = [], leasing = [], saveCoi, removeCoi } = store;
  const { role } = useAuth();
  const canEdit = role === 'admin' || role === 'manager';
  const [today] = useState(todayISO); // local-time, stable per mount
  const [filter, setFilter] = useState('all'); // all | vendor | tenant | attention
  const [edit, setEdit] = useState(null); // null | draft

  const sum = useMemo(() => coiSummary(cois, today), [cois, today]);
  const rows = useMemo(() => {
    let r = sum.certs;
    if (filter === 'vendor' || filter === 'tenant') r = r.filter((c) => c.holderType === filter);
    if (filter === 'attention') r = r.filter((c) => c.status !== 'active');
    return [...r].sort((a, b) => (a._days == null ? Infinity : a._days) - (b._days == null ? Infinity : b._days));
  }, [sum.certs, filter]);

  const tenantNames = useMemo(() => [...new Set(leasing.filter((u) => u.tenant).map((u) => u.tenant))], [leasing]);
  const vendorNames = useMemo(() => [...new Set(vendors.map((v) => v.name))], [vendors]);

  const startAdd = () => setEdit({ holderType: 'vendor', holderName: '', building: '', unit: '', carrier: '', policyNumber: '', coverage: {}, effective: '', expires: '', additionalInsured: false, notes: '' });
  const startEdit = (c) => setEdit({ ...c, building: c.building || '', unit: c.unit || '', carrier: c.carrier || '', policyNumber: c.policyNumber || '', effective: c.effective || '', expires: c.expires || '', notes: c.notes || '', coverage: { ...c.coverage } });
  const dset = (k, v) => setEdit((e) => ({ ...e, [k]: v }));
  const cset = (k, v) => setEdit((e) => ({ ...e, coverage: { ...e.coverage, [k]: v === '' ? undefined : Number(v) } }));
  const save = () => {
    const d = edit;
    saveCoi({
      ...d, holderName: d.holderName.trim(),
      building: d.building.trim() || null, unit: d.unit.trim() || null,
      carrier: d.carrier.trim() || null, policyNumber: d.policyNumber.trim() || null,
      effective: d.effective || null, expires: d.expires || null, notes: d.notes.trim() || null,
    });
    setEdit(null);
  };

  const chip = (id, label, n) => (
    <button className={'pill' + (filter === id ? ' on' : '')} onClick={() => setFilter(id)}
      style={{ padding: '6px 12px', borderRadius: 999, border: '1px solid var(--line)', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 600, background: filter === id ? 'var(--accent)' : 'transparent', color: filter === id ? '#fff' : 'var(--text-dim)' }}>
      {label}{n != null && <span style={{ opacity: 0.7, marginLeft: 5 }}>{n}</span>}
    </button>
  );

  return (
    <div>
      <div className="view-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h1>Insurance · COI</h1>
          <p>Certificates of insurance for your vendors and commercial tenants — who's covered, for how much, and what's about to lapse. A vendor with a lapsed COI shouldn't be on your property.</p>
        </div>
        {canEdit && <button className="btn grad" style={{ width: 'auto', whiteSpace: 'nowrap' }} onClick={startAdd}>+ Certificate</button>}
      </div>

      <div className="rr-kpis">
        <div className="kpi-c"><span className="v mono">{sum.count.total}</span><span className="k">on file</span></div>
        <div className="kpi-c"><span className="v mono" style={{ color: 'var(--money)' }}>{sum.count.active}</span><span className="k">active</span></div>
        <div className="kpi-c"><span className="v mono" style={{ color: 'var(--warn)' }}>{sum.count.expiring}</span><span className="k">expiring ≤30d</span></div>
        <div className="kpi-c"><span className="v mono" style={{ color: 'var(--danger)' }}>{sum.count.expired}</span><span className="k">expired</span></div>
        <div className="kpi-c"><span className="v mono" style={{ color: sum.count.unknown ? 'var(--warn)' : 'var(--text-faint)' }}>{sum.count.unknown}</span><span className="k">no date on file</span></div>
      </div>

      {(sum.count.expired > 0 || sum.count.expiring > 0) && (
        <p className="note" style={{ color: 'var(--warn)', margin: '2px 2px 12px' }}>
          <IcShield width={13} height={13} style={{ verticalAlign: -2, marginRight: 4 }} />
          {sum.count.expired} lapsed · {sum.count.expiring} expiring within 30 days — {sum.attention[0]?.holderName} is soonest.
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0 0 14px' }}>
        {chip('all', 'All', sum.count.total)}
        {chip('vendor', 'Vendors', cois.filter((c) => c.holderType === 'vendor').length)}
        {chip('tenant', 'Tenants', cois.filter((c) => c.holderType === 'tenant').length)}
        {chip('attention', 'Needs attention', sum.attention.length)}
      </div>

      {edit && (
        <div className="card" style={{ border: '1px solid var(--accent)' }}>
          <div className="field-label" style={{ marginTop: 0 }}>{edit.id ? 'Edit certificate' : 'New certificate'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <label>Holder type
              <select style={inp} value={edit.holderType} onChange={(e) => dset('holderType', e.target.value)}>
                <option value="vendor">Vendor / contractor</option><option value="tenant">Tenant</option>
              </select>
            </label>
            <label>Holder name
              <input style={inp} list="coi-holders" value={edit.holderName} onChange={(e) => dset('holderName', e.target.value)} placeholder="Company or tenant" />
              <datalist id="coi-holders">{(edit.holderType === 'tenant' ? tenantNames : vendorNames).map((n) => <option key={n} value={n} />)}</datalist>
            </label>
            {edit.holderType === 'tenant' && <label>Building<input style={inp} value={edit.building} onChange={(e) => dset('building', e.target.value)} /></label>}
            {edit.holderType === 'tenant' && <label>Suite<input style={inp} value={edit.unit} onChange={(e) => dset('unit', e.target.value)} /></label>}
            <label>Carrier<input style={inp} value={edit.carrier} onChange={(e) => dset('carrier', e.target.value)} /></label>
            <label>Policy #<input style={inp} value={edit.policyNumber} onChange={(e) => dset('policyNumber', e.target.value)} /></label>
            <label>Effective<input type="date" style={inp} value={edit.effective} onChange={(e) => dset('effective', e.target.value)} /></label>
            <label>Expires<input type="date" style={inp} value={edit.expires} onChange={(e) => dset('expires', e.target.value)} /></label>
            <label>General liability<input type="number" style={inp} value={edit.coverage.general_liability ?? ''} onChange={(e) => cset('general_liability', e.target.value)} placeholder="e.g. 1000000" /></label>
            <label>Workers' comp<input type="number" style={inp} value={edit.coverage.workers_comp ?? ''} onChange={(e) => cset('workers_comp', e.target.value)} placeholder="—" /></label>
          </div>
          <label className="rr-check" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <input type="checkbox" checked={edit.additionalInsured} onChange={(e) => dset('additionalInsured', e.target.checked)} /> Landlord / management named as additional insured
          </label>
          <label style={{ display: 'block', marginTop: 10 }}>Notes<input style={inp} value={edit.notes} onChange={(e) => dset('notes', e.target.value)} placeholder="Optional" /></label>
          <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
            {edit.id && <button className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => { removeCoi(edit.id); setEdit(null); }}>Delete</button>}
            <span style={{ flex: 1 }} />
            <button className="btn ghost sm" onClick={() => setEdit(null)}>Cancel</button>
            <button className="btn grad sm" onClick={save} disabled={!edit.holderName.trim()}>Save</button>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="rr-scroll">
          <table className="rr-tbl">
            <thead><tr>
              <th>Holder</th><th>Carrier</th><th className="num">Gen. liability</th><th className="num">Expires</th><th>AI</th><th>Status</th>{canEdit && <th aria-label="edit"></th>}
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={canEdit ? 7 : 6}><p className="note" style={{ margin: 8 }}>No certificates{filter !== 'all' ? ' in this view' : ' yet'}.</p></td></tr>}
              {rows.map((c) => {
                const st = STATUS[c.status]; const d = daysToExpiry(c, today);
                return (
                  <tr key={c.id} className={canEdit ? 'rr-link' : ''} onClick={canEdit ? () => startEdit(c) : undefined}>
                    <td>
                      <b>{c.holderName}</b>
                      <span className="chip" style={{ marginLeft: 8, fontSize: 10, opacity: 0.8 }}>{c.holderType}</span>
                      {c.holderType === 'tenant' && c.unit && <span style={{ color: 'var(--text-faint)', fontSize: 12, marginLeft: 6 }}>{c.building} · {c.unit}</span>}
                    </td>
                    <td style={{ color: 'var(--text-dim)' }}>{c.carrier || '—'}</td>
                    <td className="num mono">{fmtLimit(c.coverage?.general_liability)}</td>
                    <td className="num mono">{fmtDate(c.expires)}{d != null && d >= 0 && d <= 30 && <span style={{ color: 'var(--warn)', fontSize: 11, marginLeft: 5 }}>{d}d</span>}</td>
                    <td>{c.additionalInsured ? <IcCheck width={14} height={14} style={{ color: 'var(--money)' }} /> : <span style={{ color: 'var(--text-faint)' }}>—</span>}</td>
                    <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: st.color }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: st.color }} />{st.label}</span></td>
                    {canEdit && <td className="num"><span className="lnk" style={{ color: 'var(--text-faint)', fontSize: 12 }}>edit</span></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="note">Certificates cover your approved vendors and commercial tenants. Caliper flags anything lapsed or within 30 days of expiring, so a contractor with no current insurance never quietly ends up on your property.</p>
    </div>
  );
}
