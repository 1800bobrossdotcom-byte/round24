import { useState, useEffect } from 'react';
import { useAuth } from '../components/AuthGate.jsx';
import { isConfigured, createInvite, listInvites, revokeInvite, listOrgMembers } from '../lib/backend/supabase.js';
import { IcUsers, IcX, IcCheck, IcCopy } from '../components/ui.jsx';

// office admin onboards the team: generate role-scoped invite links.
// Office roles run the operation; contractors get the crew tools only.
const ROLES = [
  { key: 'manager', label: 'Office — Manager', hint: 'Dashboards, dispatch, purchasing' },
  { key: 'admin', label: 'Office — Admin', hint: 'Full access incl. financials & access' },
  { key: 'tech', label: 'Contractor (crew)', hint: 'Field timer, orders, receipts' },
  { key: 'viewer', label: 'Viewer', hint: 'Read-only dashboards' },
];
const ROLE_LABEL = { admin: 'Office · Admin', manager: 'Office · Manager', tech: 'Contractor', viewer: 'Viewer' };
const ROLE_COLOR = { admin: 'var(--accent)', manager: 'var(--info)', tech: 'var(--money)', viewer: 'var(--text-dim)' };

const inputStyle = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)',
  color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 14, padding: 10, borderRadius: 10,
};

export default function Access({ store }) {
  const { orgId } = useAuth();
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [role, setRole] = useState('tech');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(null);
  const [err, setErr] = useState(null);

  const load = () => {
    if (!isConfigured() || !orgId) return;
    listOrgMembers().then(setMembers).catch(() => {});
    listInvites(orgId).then(setInvites).catch(() => {});
  };
  useEffect(load, [orgId]);

  const linkFor = (code) => `${window.location.origin}/?invite=${code}`;
  const generate = async () => {
    setErr(null); setBusy(true);
    try { await createInvite(orgId, { role, label: label.trim() || null }); setLabel(''); load(); }
    catch (e) { setErr(e.message || 'Could not create invite'); }
    finally { setBusy(false); }
  };
  const copy = async (code) => {
    try { await navigator.clipboard.writeText(linkFor(code)); setCopied(code); setTimeout(() => setCopied(null), 1500); } catch { /* no clipboard */ }
  };
  const revoke = async (id) => { await revokeInvite(id); load(); };

  const pending = invites.filter((i) => !i.usedAt);

  if (!isConfigured()) {
    return (
      <div>
        <div className="view-head"><h1>Access</h1><p>Invite your team and contractors</p></div>
        <div className="card"><p className="note">Connect to the cloud to invite people to your workspace.</p></div>
      </div>
    );
  }

  return (
    <div>
      <div className="view-head"><h1>Access</h1><p>Invite your team to the office side, contractors to the crew side</p></div>

      {/* generate an invite */}
      <div className="card" style={{ marginBottom: 'var(--gap)' }}>
        <span className="field-label">Invite someone</span>
        <div className="pick" style={{ marginTop: 4 }}>
          {ROLES.map((r) => (
            <button key={r.key} className={role === r.key ? 'on' : ''} onClick={() => setRole(r.key)}>{r.label}</button>
          ))}
        </div>
        <div className="note" style={{ margin: '6px 0 10px' }}>{ROLES.find((r) => r.key === role)?.hint}</div>
        <input style={inputStyle} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name or note (optional) — e.g. Gianni, painter" />
        {err && <p className="note" style={{ color: 'var(--danger)', marginTop: 6 }}>{err}</p>}
        <button className="btn grad" style={{ marginTop: 12 }} onClick={generate} disabled={busy}>{busy ? 'Generating…' : 'Generate invite link'}</button>
      </div>

      {/* pending invites */}
      {pending.length > 0 && (
        <div className="card" style={{ marginBottom: 'var(--gap)' }}>
          <span className="field-label">Pending invites ({pending.length})</span>
          {pending.map((i) => (
            <div className="row" key={i.id}>
              <div className="lead">
                <div className="t">{i.label || 'Invite'} · <span style={{ color: ROLE_COLOR[i.role] }}>{ROLE_LABEL[i.role]}</span></div>
                <div className="s mono" style={{ wordBreak: 'break-all' }}>{linkFor(i.code)}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn ghost sm" onClick={() => copy(i.code)}>{copied === i.code ? <><IcCheck width={13} height={13} /> Copied</> : <><IcCopy width={13} height={13} /> Copy</>}</button>
                <button className="btn ghost sm icon-btn" style={{ color: 'var(--text-faint)' }} onClick={() => revoke(i.id)} aria-label="Revoke"><IcX width={14} height={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* current members */}
      <div className="card">
        <span className="field-label"><IcUsers width={13} height={13} style={{ verticalAlign: -2 }} /> People with access ({members.length})</span>
        {members.length === 0 && <p className="note">Just you so far — generate an invite above to add your team.</p>}
        {members.map((m) => (
          <div className="row" key={m.userId}>
            <div className="lead"><div className="t">{m.email}</div></div>
            <span className="chip" style={{ color: ROLE_COLOR[m.role] }}>{ROLE_LABEL[m.role]}</span>
          </div>
        ))}
      </div>

      <p className="note">Share an invite link and the person creates their account through it — they land in the right portal automatically. Office roles run the operation; contractors only ever see the crew tools.</p>
    </div>
  );
}
