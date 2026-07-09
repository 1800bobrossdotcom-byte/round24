import { useState, useEffect, useMemo } from 'react';
import { byProp, byUnit, byCategory, totals, fmtMoney, fmtHrs, fmtMoneyC } from '../lib/rollups.js';
import { IcChevron, IcReceipt, IcBuilding, IcWrench } from '../components/ui.jsx';

const nameKey = (s) => (s || '').toLowerCase().trim();
const money0 = (n) => (n == null ? '—' : '$' + Math.round(n).toLocaleString());

export default function Properties({ store, focus, navigate }) {
  const { timers, properties, propById, purchases = [], leasing = [], workOrders = [] } = store;
  const go = navigate || (() => {});
  const [sel, setSel] = useState(null); // building name

  // one building record merges labor + occupancy + rent + open work orders,
  // so a building becomes a single hub for everything happening there.
  const buildings = useMemo(() => {
    const map = new Map();
    const ensure = (name, city, propId) => {
      const k = nameKey(name); if (!k) return null;
      if (!map.has(k)) map.set(k, { key: k, name, city: city || '', propId: propId || null, cost: 0, hrs: 0, jobs: 0, units: 0, occ: 0, rent: 0, openWo: 0 });
      const b = map.get(k); if (propId && !b.propId) b.propId = propId; if (city && !b.city) b.city = city; return b;
    };
    for (const p of properties) ensure(p.name, p.city, p.id);
    for (const r of byProp(timers)) { const p = propById[r.key]; if (p) { const b = ensure(p.name, p.city, r.key); if (b) { b.cost = r.cost; b.hrs = r.hrs; b.jobs = r.count; } } }
    for (const u of leasing) { const b = ensure(u.building, 'Rochester'); if (b) { b.units++; if (u.status === 'leased') { b.occ++; b.rent += u.rent || 0; } } }
    for (const w of workOrders) if (w.status === 'open' || w.status === 'in_progress') { const b = map.get(nameKey(w.propLabel)); if (b) b.openWo++; }
    return [...map.values()].sort((a, b) => (b.rent - a.rent) || (b.cost - a.cost));
  }, [properties, timers, leasing, workOrders, propById]);

  useEffect(() => {
    if (focus?.building) setSel(focus.building);
    else if (focus?.propId) { const p = propById[focus.propId]; if (p) setSel(p.name); }
  }, [focus]);

  // ---------- building detail: the hub ----------
  if (sel) {
    const b = buildings.find((x) => x.key === nameKey(sel)) || { name: sel, city: '', units: 0, occ: 0, rent: 0 };
    const prop = properties.find((p) => nameKey(p.name) === nameKey(sel));
    const pt = timers.filter((t) => prop && t.propId === prop.id);
    const t = totals(pt);
    const units = byUnit(pt).sort((a, c) => c.cost - a.cost);
    const cats = byCategory(pt).sort((a, c) => c.cost - a.cost);
    const umax = Math.max(...units.map((u) => u.cost), 1);
    const lunits = leasing.filter((u) => nameKey(u.building) === nameKey(sel));
    const vac = lunits.filter((u) => u.status !== 'leased').length;
    const deposits = lunits.reduce((a, u) => a + (u.deposit || 0), 0);
    const openWos = workOrders.filter((w) => nameKey(w.propLabel) === nameKey(sel) && (w.status === 'open' || w.status === 'in_progress'));
    const mats = purchases.filter((pu) => nameKey(pu.propLabel) === nameKey(sel));
    const matTotal = mats.filter((pu) => pu.status === 'approved').reduce((a, pu) => a + (pu.amount || 0), 0);

    return (
      <div>
        <button className="btn ghost sm" onClick={() => setSel(null)} style={{ marginBottom: 14 }}><IcChevron width={14} height={14} style={{ transform: 'rotate(180deg)' }} /> All buildings</button>
        <div className="view-head"><h1>{b.name}</h1><p>{[b.city, b.units ? `${b.units} units` : null].filter(Boolean).join(' · ')}</p></div>

        <div className="grid g3" style={{ marginBottom: 'var(--gap)' }}>
          {b.units > 0 && <button className="card clk-card" onClick={() => go('leasing', { building: b.name })}><div className="stat"><span className="k">Occupancy</span><span className="v mono sm" style={{ color: 'var(--money)' }}>{Math.round((b.occ / b.units) * 100)}%</span></div></button>}
          {b.rent > 0 && <button className="card clk-card" onClick={() => go('leasing', { building: b.name })}><div className="stat"><span className="k">Billed rent / mo</span><span className="v mono sm">{money0(b.rent)}</span></div></button>}
          <div className="card"><div className="stat"><span className="k">Labor cost</span><span className="v mono grad-text settle sm">{fmtMoney(t.cost)}</span></div></div>
        </div>

        {/* rent roll summary → drill to the live rent roll */}
        {lunits.length > 0 && (
          <div className="card clk-card" style={{ marginBottom: 'var(--gap)' }} onClick={() => go('leasing', { building: b.name })}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span className="field-label" style={{ margin: 0 }}><IcBuilding width={13} height={13} style={{ verticalAlign: -2 }} /> Rent roll · {b.units} units</span>
              <span style={{ color: 'var(--text-faint)', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>Open <IcChevron width={13} height={13} /></span>
            </div>
            <div className="grid g3" style={{ marginTop: 10 }}>
              <div className="stat"><span className="k">Leased</span><span className="v mono sm">{b.occ}/{b.units}</span></div>
              <div className="stat"><span className="k">Vacant</span><span className="v mono sm" style={{ color: vac ? 'var(--warn)' : undefined }}>{vac}</span></div>
              <div className="stat"><span className="k">Deposits held</span><span className="v mono sm">{money0(deposits)}</span></div>
            </div>
          </div>
        )}

        {/* open work orders here */}
        <div className="card" style={{ marginBottom: 'var(--gap)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span className="field-label" style={{ margin: 0 }}><IcWrench width={13} height={13} style={{ verticalAlign: -2 }} /> Open work orders ({openWos.length})</span>
            <button className="btn ghost sm" onClick={() => go('wo', { newFor: { propLabel: b.name, unit: '', category: 'general' } })}>+ New</button>
          </div>
          {openWos.length === 0 && <p className="note" style={{ margin: '6px 0 0' }}>Nothing open here right now.</p>}
          {openWos.map((w) => (
            <div className="row" key={w.id} onClick={() => go('wo')} style={{ cursor: 'pointer' }}>
              <div className="lead"><div className="t">{w.task}</div><div className="s">{[w.unit && `Unit ${w.unit}`, w.assigneeLabel && `to ${w.assigneeLabel}`, w.due && `due ${w.due}`].filter(Boolean).join(' · ') || w.category}</div></div>
              <span className="chip" style={{ color: w.status === 'in_progress' ? 'var(--warn)' : 'var(--info)' }}>{w.status.replace('_', ' ')}</span>
            </div>
          ))}
        </div>

        {/* labor detail (only when there's labor here) */}
        {pt.length > 0 && (
          <div className="grid g2">
            <div className="card">
              <span className="field-label">Labor by unit</span>
              <table className="tbl"><tbody>
                {units.map((u) => (
                  <tr key={u.key}>
                    <td className="barcell"><div className="bar" style={{ width: `${(u.cost / umax) * 100}%` }} />
                      <span className="bar-label" style={{ fontWeight: 700 }}>Unit {u.key.split('|')[1]}</span></td>
                    <td className="num">{fmtHrs(u.hrs)}h</td>
                    <td className="num money" style={{ fontWeight: 700 }}>{fmtMoney(u.cost)}</td>
                  </tr>
                ))}
              </tbody></table>
            </div>
            <div className="card">
              <span className="field-label">By work category</span>
              <table className="tbl"><tbody>
                {cats.map((c) => (
                  <tr key={c.key}><td style={{ fontWeight: 700, textTransform: 'capitalize' }}>{c.key}</td>
                    <td className="num">{c.count}</td><td className="num">{fmtHrs(c.hrs)}h</td>
                    <td className="num money" style={{ fontWeight: 700 }}>{fmtMoney(c.cost)}</td></tr>
                ))}
              </tbody></table>
            </div>
          </div>
        )}

        {mats.length > 0 && (
          <div className="card" style={{ marginTop: 'var(--gap)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="field-label" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}><IcReceipt width={13} height={13} /> Materials &amp; receipts</span>
              <span className="mono money" style={{ fontWeight: 700 }}>{fmtMoneyC(matTotal)}<span style={{ color: 'var(--text-dim)', fontWeight: 400, fontSize: 11 }}> approved</span></span>
            </div>
            {mats.map((pu) => <MatRow key={pu.id} pu={pu} />)}
          </div>
        )}
      </div>
    );
  }

  // ---------- building list ----------
  const maxCost = Math.max(...buildings.map((b) => b.cost), 1);
  return (
    <div>
      <div className="view-head"><h1>Buildings</h1><p>Every building — occupancy, rent, labor and open work in one place. Tap to drill in.</p></div>
      <div className="card">
        <div className="rr-scroll">
          <table className="tbl prop-tbl">
            <thead><tr><th>Building</th><th className="num">Occ</th><th className="num">Rent/mo</th><th className="num">Labor</th><th className="num">Open</th></tr></thead>
            <tbody>
              {buildings.map((b) => (
                <tr key={b.key} onClick={() => setSel(b.name)} style={{ cursor: 'pointer' }}>
                  <td className="barcell"><div className="bar" style={{ width: `${(b.cost / maxCost) * 100}%` }} />
                    <span className="bar-label" style={{ fontWeight: 700 }}>{b.name}</span>
                    <div className="bar-label" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{b.city}</div></td>
                  <td className="num mono">{b.units ? `${Math.round((b.occ / b.units) * 100)}%` : '—'}</td>
                  <td className="num mono">{b.rent ? money0(b.rent) : '—'}</td>
                  <td className="num money" style={{ fontWeight: 700 }}>{b.cost ? fmtMoney(b.cost) : '—'}</td>
                  <td className="num">{b.openWo ? <span className="chip" style={{ color: 'var(--info)' }}>{b.openWo}</span> : <span style={{ color: 'var(--text-faint)' }}>0</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="note">One row per building, pulling from the rent roll, the labor spine, and the work-order board — reconciled automatically instead of living in separate pay-log tabs.</p>
    </div>
  );
}

// one material receipt on a building, with an optional itemized expand
function MatRow({ pu }) {
  const [open, setOpen] = useState(false);
  const items = pu.lineItems || [];
  const STATUS = { pending: 'var(--warn)', approved: 'var(--money)', rejected: 'var(--danger)' };
  return (
    <div className="pur-item">
      <div className="row">
        <div className="lead">
          <div className="t">{pu.vendor || 'Purchase'} — <span className="mono money">{fmtMoneyC(pu.amount || 0)}</span></div>
          <div className="s">
            {[pu.workOrderId && 'on a work order', pu.note, new Date(pu.createdAt).toLocaleDateString()].filter(Boolean).join(' · ')}
            {items.length > 0 && <> · <a onClick={() => setOpen((o) => !o)} style={{ color: 'var(--accent)', cursor: 'pointer' }}>{open ? 'hide items' : `${items.length} items`}</a></>}
          </div>
        </div>
        <span className="chip" style={{ color: STATUS[pu.status] }}>{pu.status}</span>
      </div>
      {open && items.length > 0 && (
        <div className="pur-items">
          {items.map((li, i) => (
            <div className="pur-item-row" key={i}>
              <span className="pi-desc">{li.description}</span>
              <span className="pi-qty mono">{li.qty || 1} × {fmtMoneyC(li.unitPrice || 0)}</span>
              <span className="pi-amt mono money">{fmtMoneyC(li.amount || 0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
