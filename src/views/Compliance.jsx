import { useState, useEffect } from 'react';
import { useAuth } from '../components/AuthGate.jsx';
import { isConfigured, orgMemberCompliance, listAudit } from '../lib/backend/supabase.js';
import { IcClip, IcCheck, IcActivity } from '../components/ui.jsx';

const ROLE_LABEL = { admin: 'Admin', manager: 'Manager', tech: 'Contractor', viewer: 'Viewer' };
const daysTo = (d) => Math.ceil((new Date(d) - Date.now()) / 86400000);
const ACTION_LABEL = {
  approve_purchase: 'Approved purchase', reject_purchase: 'Rejected purchase',
  export_data: 'Exported personal data', create_invite: 'Created invite',
  revoke_invite: 'Revoked invite', rename_workspace: 'Renamed workspace',
};

export default function Compliance() {
  const { orgId } = useAuth();
  const [rows, setRows] = useState([]);
  const [audit, setAudit] = useState([]);
  useEffect(() => {
    if (!isConfigured() || !orgId) return;
    orgMemberCompliance().then(setRows).catch(() => {});
    listAudit(orgId, 80).then(setAudit).catch(() => {});
  }, [orgId]);

  // flatten certs with an expiry that's expired or within 60 days
  const flags = [];
  for (const m of rows) {
    for (const c of (m.certs || [])) {
      if (!c.expiry) continue;
      const d = daysTo(c.expiry);
      if (d <= 60) flags.push({ who: m.email, name: c.name, number: c.number, expiry: c.expiry, days: d });
    }
  }
  flags.sort((a, b) => a.days - b.days);

  // contractors missing paperwork
  const missing = rows.filter((m) => m.role === 'tech').map((m) => ({
    email: m.email,
    w9: !(m.tax && m.tax.w9SignedAt),
    emergency: !(m.emergency && m.emergency.name),
  })).filter((x) => x.w9 || x.emergency);

  if (!isConfigured()) {
    return <div><div className="view-head"><h1>Compliance</h1></div><div className="card"><p className="note">Connect to the cloud to view compliance.</p></div></div>;
  }

  return (
    <div>
      <div className="view-head"><h1>Compliance</h1><p>Credential expiry, contractor paperwork, and a record of sensitive actions</p></div>

      {/* expiring / expired credentials */}
      <div className="card" style={{ marginBottom: 'var(--gap)' }}>
        <span className="field-label"><IcClip width={13} height={13} style={{ verticalAlign: -2 }} /> Credentials expiring soon</span>
        {flags.length === 0 && <p className="note">Nothing expiring in the next 60 days.</p>}
        {flags.map((f, i) => (
          <div className="row" key={i}>
            <div className="lead">
              <div className="t">{f.name}{f.number ? ` · ${f.number}` : ''}</div>
              <div className="s">{f.who}</div>
            </div>
            <span className="chip" style={{ color: f.days < 0 ? 'var(--danger)' : f.days <= 30 ? 'var(--warn)' : 'var(--text-dim)' }}>
              {f.days < 0 ? `Expired ${-f.days}d ago` : `${f.days}d left`}
            </span>
          </div>
        ))}
      </div>

      {/* missing contractor paperwork */}
      {missing.length > 0 && (
        <div className="card" style={{ marginBottom: 'var(--gap)', borderColor: '#ffb02033' }}>
          <span className="field-label" style={{ color: 'var(--warn)' }}>Contractor paperwork needed ({missing.length})</span>
          {missing.map((m) => (
            <div className="row" key={m.email}>
              <div className="lead"><div className="t">{m.email}</div></div>
              <div style={{ display: 'flex', gap: 5 }}>
                {m.w9 && <span className="chip warn">W-9</span>}
                {m.emergency && <span className="chip warn">Emergency contact</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* audit log */}
      <div className="card">
        <span className="field-label"><IcActivity width={13} height={13} style={{ verticalAlign: -2 }} /> Audit log</span>
        {audit.length === 0 && <p className="note">No recorded actions yet. Approvals, invites, exports and renames land here.</p>}
        {audit.map((a) => (
          <div className="row" key={a.id}>
            <div className="lead">
              <div className="t">{ACTION_LABEL[a.action] || a.action}{a.target ? <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}> — {a.target}</span> : null}</div>
              <div className="s">{a.actor || 'someone'} · {new Date(a.at).toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>

      <p className="note">The audit log is append-only and unforgeable — every entry is stamped with the signed-in user server-side. Contractor tax details are staff-only and we never store full TIN/SSN.</p>
    </div>
  );
}
