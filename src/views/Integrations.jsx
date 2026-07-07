import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../components/AuthGate.jsx';
import { isConfigured, triggerRmSync, getRmConnection, countExternal } from '../lib/backend/supabase.js';
import { IcBuilding, IcPlug, IcSync, IcPlay, IcCheck } from '../components/ui.jsx';

// office-only. Rent Manager read-only sync: preview runs the full pipeline
// on sample data today; live sync activates when RM access lands.
export default function Integrations({ store }) {
  const { role, orgId } = useAuth();
  const isStaff = role === 'admin' || role === 'manager';
  const [conn, setConn] = useState(null);
  const [counts, setCounts] = useState({ properties: 0, units: 0 });
  const [busy, setBusy] = useState(null);   // 'live' | 'mock'
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  const refresh = useCallback(async () => {
    if (!isConfigured() || !orgId) return;
    try {
      const [c, p, u] = await Promise.all([
        getRmConnection(orgId),
        countExternal('properties', orgId), countExternal('units', orgId),
      ]);
      setConn(c); setCounts({ properties: p, units: u });
    } catch { /* tables may predate migration; leave zeros */ }
  }, [orgId]);
  useEffect(() => { refresh(); }, [refresh]);

  const sync = async (mock) => {
    setBusy(mock ? 'mock' : 'live'); setErr(null); setMsg(null);
    try {
      const r = await triggerRmSync({ mock });
      setMsg(`${mock ? 'Preview' : 'Sync'} complete — ${r.properties} properties, ${r.units} units from location ${r.location}.`);
      await refresh();
    } catch (e) { setErr(e.message); }
    finally { setBusy(null); }
  };

  if (!isStaff) return <div className="view-head"><h1>Integrations</h1><p>Office access only.</p></div>;

  const summary = conn?.last_sync_summary;
  return (
    <div>
      <div className="view-head">
        <h1>Integrations</h1>
        <p>Connect Caliper to the systems you already run on</p>
      </div>

      {!isConfigured() && <div className="offline">◐ Connect Supabase to enable integrations.</div>}
      {err && <div className="offline" style={{ color: 'var(--danger)', borderColor: '#ff5a5a33', background: '#ff5a5a12' }}>{err}</div>}
      {msg && <div className="offline" style={{ color: 'var(--money)', borderColor: '#4ade8033', background: '#4ade8012' }}><IcCheck width={15} height={15} /> {msg}</div>}

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div style={{ color: 'var(--accent)' }}><IcBuilding width={24} height={24} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Rent Manager</div>
            <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>Accounting system of record · read-only property &amp; unit sync</div>
          </div>
          <span className="chip" style={{ color: conn?.status === 'active' ? 'var(--money)' : conn?.status === 'preview' ? 'var(--info)' : 'var(--text-faint)' }}>
            {conn?.status === 'active' ? 'connected' : conn?.status === 'preview' ? 'preview' : 'not connected'}
          </span>
        </div>

        <div className="grid g3" style={{ margin: '14px 0' }}>
          <div className="card" style={{ background: 'var(--surface-2)' }}><div className="stat"><span className="k">RM properties</span><span className="v mono sm">{counts.properties}</span></div></div>
          <div className="card" style={{ background: 'var(--surface-2)' }}><div className="stat"><span className="k">RM units</span><span className="v mono sm">{counts.units}</span></div></div>
          <div className="card" style={{ background: 'var(--surface-2)' }}><div className="stat"><span className="k">Last sync</span><span className="v mono sm" style={{ fontSize: 14 }}>{conn?.last_sync_at ? new Date(conn.last_sync_at).toLocaleString() : '—'}</span></div></div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn ghost" style={{ flex: 1, minWidth: 160 }} disabled={busy} onClick={() => sync(true)}>
            <IcPlay width={15} height={15} /> {busy === 'mock' ? 'Running…' : 'Preview with sample data'}
          </button>
          <button className="btn grad" style={{ flex: 1, minWidth: 160 }} disabled={busy} onClick={() => sync(false)}>
            <IcSync width={15} height={15} /> {busy === 'live' ? 'Syncing…' : 'Sync from Rent Manager'}
          </button>
        </div>

        {summary?.errors?.length > 0 && (
          <p className="note" style={{ color: 'var(--warn)' }}>{summary.errors.length} row(s) had issues — {summary.errors[0]}</p>
        )}

        <hr className="hr" />
        <p className="note" style={{ marginTop: 0 }}>
          <b style={{ color: 'var(--text-dim)' }}>How it works.</b> Preview runs the full pull → map → sync pipeline on
          sample data so you can see exactly what a live sync produces. Live sync activates once an API-enabled
          Rent Manager account is connected (credentials stay server-side, never in the browser). Conflict rule:
          Rent Manager is the source of truth for properties and units; Caliper owns work orders and cost.
        </p>
        <p className="note" style={{ marginTop: 6 }}>
          Base URL <span className="mono">evolution.api.rentmanager.com</span> · read-only · one direction of truth per entity.
        </p>
      </div>

      <div className="card" style={{ marginTop: 'var(--gap)', opacity: .6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ color: 'var(--text-dim)' }}><IcPlug width={24} height={24} /></div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Google SSO &amp; Calendar</div>
            <div style={{ color: 'var(--text-dim)', fontSize: 12 }}>Sign-in and scheduling</div>
          </div>
          <span className="chip">planned</span>
        </div>
      </div>
    </div>
  );
}
