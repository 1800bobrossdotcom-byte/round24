import { useMemo } from 'react';
import { forecastExpenses } from '../lib/forecast.js';
import { isConfigured } from '../lib/backend/supabase.js';
import { DEMO_EXPENSE_HISTORY } from '../lib/demoData.js';
import { IcReceipt, IcSync, IcBuilding, IcShield, IcWrench } from '../components/ui.jsx';

const money = (n) => (n == null ? '—' : '$' + Math.round(n).toLocaleString());
const fmtDate = (iso) => { const d = new Date(`${iso}T00:00:00`); return isNaN(d.getTime()) ? iso : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' }); };
const CATCOLOR = { painting: '#a855f7', hvac: '#38bdf8', plumbing: '#22d3ee', appliance: '#ff7a18', electrical: '#ffd21a', general: '#8b93a7', other: '#8b93a7' };

export default function Forecast({ store, navigate }) {
  const { purchases = [], leasing = [] } = store;
  const go = navigate || (() => {});
  // In demo, always fold in the dated sample history so the forecast stays rich
  // even after "Load sample data" adds a few same-day receipts. Real orgs use
  // only their own approved purchases.
  const src = !isConfigured() ? [...DEMO_EXPENSE_HISTORY, ...purchases] : purchases;
  const f = useMemo(() => forecastExpenses({ purchases: src, leasing }), [src, leasing]);

  if (src.length === 0) {
    return (
      <div>
        <div className="view-head"><h1>Expense forecast</h1><p>What's coming, learned from what you buy.</p></div>
        <div className="card"><p className="note">No approved receipts yet. As the crew logs purchases — what, where, and what for — Caliper starts projecting spend, spotting recurring buys, and tracking warranties.</p></div>
      </div>
    );
  }

  const catMax = Math.max(...f.byCat.map((c) => c.total), 1);
  const soonW = f.warranties.filter((w) => w.active && w.daysLeft <= 120);

  return (
    <div>
      <div className="view-head">
        <h1>Expense forecast</h1>
        <p>What's coming next — projected from {f.sampleCount} receipts over the last {f.windowDays} days. The spend nobody sees until it hits.</p>
      </div>

      <div className="rr-kpis">
        <div className="kpi-c"><span className="v mono">{money(f.projected30)}</span><span className="k">next 30 days (est.)</span></div>
        <div className="kpi-c"><span className="v mono">{money(f.projected90)}</span><span className="k">next 90 days (est.)</span></div>
        <div className="kpi-c"><span className="v mono" style={{ color: 'var(--warn)' }}>{money(f.turnTotal)}</span><span className="k">turnover pipeline</span></div>
        <div className="kpi-c"><span className="v mono" style={{ color: soonW.length ? 'var(--danger)' : 'var(--money)' }}>{soonW.length}</span><span className="k">warranties lapsing &lt;120d</span></div>
      </div>

      {/* projected spend by category */}
      <div className="card" style={{ marginBottom: 'var(--gap)' }}>
        <span className="field-label"><IcReceipt width={13} height={13} style={{ verticalAlign: -2 }} /> Run-rate by category · ~{money(f.monthly)}/mo</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {f.byCat.map((c) => (
            <div key={c.name} style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 13, textTransform: 'capitalize', color: 'var(--text-dim)' }}>{c.name}</span>
              <span className="rr-occbar" style={{ height: 10 }}><span style={{ width: Math.max(2, (c.total / catMax) * 100) + '%', background: CATCOLOR[c.name] || 'var(--accent)' }} /></span>
              <span className="mono" style={{ fontSize: 12, minWidth: 60, textAlign: 'right' }}>{money(c.total)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* recurring buys → next predicted */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 'var(--gap)' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <span className="field-label" style={{ margin: 0 }}><IcSync width={13} height={13} style={{ verticalAlign: -2 }} /> Recurring buys — the next order</span>
        </div>
        {f.recurring.length === 0
          ? <p className="note" style={{ padding: 16, margin: 0 }}>No repeating pattern yet — a couple more cycles and the cadence shows up here.</p>
          : (
            <div className="rr-scroll">
              <table className="rr-tbl">
                <thead><tr><th>Vendor · what</th><th className="num">Every</th><th className="num">Avg</th><th>Last</th><th>Next (est.)</th><th className="num">Conf.</th></tr></thead>
                <tbody>
                  {f.recurring.map((r, i) => (
                    <tr key={i}>
                      <td><b>{r.vendor}</b> <span style={{ color: 'var(--text-dim)', textTransform: 'capitalize' }}>· {r.category}</span></td>
                      <td className="num mono">{r.cadenceDays}d</td>
                      <td className="num mono">{money(r.avgAmount)}</td>
                      <td className="mono" style={{ color: 'var(--text-dim)' }}>{fmtDate(r.lastDate)}</td>
                      <td className="mono" style={{ color: r.overdue ? 'var(--warn)' : 'var(--text)', fontWeight: 700 }}>{fmtDate(r.nextDate)}{r.overdue ? ' · due' : ''}</td>
                      <td className="num mono" style={{ color: r.confidence >= 60 ? 'var(--money)' : 'var(--text-faint)' }}>{r.confidence}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {/* turnover pipeline */}
      <div className="card" style={{ marginBottom: 'var(--gap)' }}>
        <span className="field-label"><IcWrench width={13} height={13} style={{ verticalAlign: -2 }} /> Turnover pipeline · {money(f.turnTotal)} projected</span>
        {f.turnovers.length === 0
          ? <p className="note" style={{ margin: '6px 0 0' }}>No vacancies or leases ending in the next 75 days.</p>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {f.turnovers.slice(0, 10).map((t, i) => (
                <div key={i} className="row" style={{ cursor: 'pointer' }} onClick={() => go('props', { building: t.building })}>
                  <div className="lead"><div className="t">{t.building} · Unit {t.unit}</div><div className="s">{t.reason}{t.dueDate ? ` · ${fmtDate(t.dueDate)}` : ''}</div></div>
                  <div className="val"><div className="big mono">{money(t.estCost)}</div></div>
                </div>
              ))}
            </div>
          )}
      </div>

      {/* warranty watch */}
      <div className="card">
        <span className="field-label"><IcShield width={13} height={13} style={{ verticalAlign: -2 }} /> Warranty watch — coverage lapsing</span>
        {f.warranties.length === 0
          ? <p className="note" style={{ margin: '6px 0 0' }}>No warrantied items on file. Appliances and HVAC buys are tracked automatically.</p>
          : (
            <div className="rr-scroll" style={{ marginTop: 8 }}>
              <table className="rr-tbl">
                <thead><tr><th>Item</th><th>Building</th><th>Bought</th><th>Coverage ends</th><th className="num">Status</th></tr></thead>
                <tbody>
                  {f.warranties.map((w, i) => (
                    <tr key={i}>
                      <td>{w.item}</td>
                      <td style={{ color: 'var(--text-dim)' }}>{w.building}</td>
                      <td className="mono" style={{ color: 'var(--text-dim)' }}>{fmtDate(w.purchaseDate)}</td>
                      <td className="mono">{fmtDate(w.expiry)}</td>
                      <td className="num">
                        {!w.active ? <span className="chip" style={{ color: 'var(--danger)' }}>lapsed</span>
                          : w.daysLeft <= 120 ? <span className="chip" style={{ color: 'var(--warn)' }}>{w.daysLeft}d left</span>
                            : <span className="chip" style={{ color: 'var(--money)' }}>covered</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>

      <p className="note">Projections are directional — run-rate from recent receipts, cadence from repeat buys, turnovers from the rent roll, warranties from purchase dates. They sharpen every time the crew logs what they bought and what for.</p>
    </div>
  );
}
