// src/layer1-developer/sections/Audit.jsx
// Last 200 platform_audit rows. Every admin_* call in layer1Api.js writes one
// of these server-side (see _platform_log in the migration) — this section
// just reads them back.
import { useEffect, useState } from 'react';
import { layer1ListAudit } from '../../lib/backend/layer1Api.js';

export default function Audit() {
  const [rows, setRows] = useState(null);

  useEffect(() => { layer1ListAudit(200).then(setRows); }, []);

  return (
    <div className="card" style={{ padding: 0 }}>
      {!rows && <p className="mono" style={{ padding: 14, color: 'var(--text-faint)' }}>···</p>}
      {rows?.length === 0 && <p style={{ padding: 14, fontFamily: 'var(--font)', color: 'var(--text-faint)' }}>No actions logged yet.</p>}
      {rows?.map((r) => (
        <div key={r.id} className="row" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 14px', borderBottom: '1px solid var(--line-soft)',
        }}>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text)', whiteSpace: 'nowrap' }}>{r.action}</span>
          <span className="mono" style={{
            fontSize: 11, color: 'var(--text-dim)', flex: 1, margin: '0 12px',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right',
          }}>
            {/* pre-0049 rows carry text `detail`; new rows carry jsonb `target` */}
            {r.detail || (r.target ? JSON.stringify(r.target) : '')}
          </span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
            {new Date(r.at).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}
