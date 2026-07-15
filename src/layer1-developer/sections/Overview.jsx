// src/layer1-developer/sections/Overview.jsx
import { useEffect, useState } from 'react';
import { layer1Overview } from '../../lib/backend/layer1Api.js';

const STAT_ROWS = [
  [
    ['orgs', 'Workspaces'],
    ['members', 'Staff members'],
    ['residents', 'Residents'],
  ],
  [
    ['open_work_orders', 'Open work orders'],
    ['pending_workspace_requests', 'Pending requests'],
    ['pending_deletion_requests', 'Deletion requests'],
  ],
];

export default function Overview() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let on = true;
    layer1Overview()
      .then((d) => { if (on) setData(d); })
      .catch((e) => { if (on) setErr(e.message || String(e)); });
    return () => { on = false; };
  }, []);

  if (err) {
    return <p style={{ fontFamily: 'var(--font)', color: 'var(--danger)' }}>{err}</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {data?.live_support_sessions > 0 && (
        <div className="card" style={{
          borderColor: 'var(--warn)', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', padding: 14,
        }}>
          <span style={{ fontFamily: 'var(--font)', color: 'var(--text)', fontSize: 13 }}>
            {data.live_support_sessions} live support session{data.live_support_sessions === 1 ? '' : 's'} right now
          </span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--warn)' }}>AUDITED</span>
        </div>
      )}

      {STAT_ROWS.map((row, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {row.map(([key, label]) => (
            <div key={key} className="card" style={{ padding: 18 }}>
              <div className="mono" style={{ fontSize: 28, color: 'var(--text)', fontWeight: 700 }}>
                {data ? (data[key] ?? '—') : '···'}
              </div>
              <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
                {label}
              </div>
            </div>
          ))}
        </div>
      ))}

      <p style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--text-faint)' }}>
        Every number here comes from admin_platform_overview() — one gated read, no client-side aggregation.
      </p>
    </div>
  );
}
