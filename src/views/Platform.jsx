import { useState, useEffect } from 'react';
import { isConfigured, adminListOrgs, adminCreateWorkspace, listWorkspaceRequests, decideWorkspaceRequest } from '../lib/backend/supabase.js';
import { IcBuilding, IcCheck, IcX, IcCopy } from '../components/ui.jsx';

const inputStyle = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)',
  color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 14, padding: 10, borderRadius: 10,
};
const linkFor = (code) => `${window.location.origin}/?invite=${code}`;

export default function Platform() {
  const [orgs, setOrgs] = useState([]);
  const [reqs, setReqs] = useState([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [kind, setKind] = useState('company');
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState(null); // { code } after creating
  const [copied, setCopied] = useState(null);
  const [err, setErr] = useState(null);

  const load = () => {
    if (!isConfigured()) return;
    adminListOrgs().then(setOrgs).catch(() => {});
    listWorkspaceRequests().then(setReqs).catch(() => {});
  };
  useEffect(load, []);

  const create = async () => {
    setErr(null); setBusy(true); setMade(null);
    try {
      const { code } = await adminCreateWorkspace(name.trim(), email.trim() || null, kind);
      setMade({ code, name: name.trim() }); setName(''); setEmail(''); load();
    } catch (e) { setErr(e.message || 'Could not create workspace'); }
    finally { setBusy(false); }
  };
  const decide = async (id, approve) => {
    try { await decideWorkspaceRequest(id, approve); load(); } catch { /* ignore */ }
  };
  const copy = async (code) => { try { await navigator.clipboard.writeText(linkFor(code)); setCopied(code); setTimeout(() => setCopied(null), 1500); } catch { /* no clipboard */ } };

  const pending = reqs.filter((r) => r.status === 'pending');

  if (!isConfigured()) {
    return <div><div className="view-head"><h1>Platform</h1></div><div className="card"><p className="note">Connect to the cloud to manage the platform.</p></div></div>;
  }

  return (
    <div>
      <div className="view-head"><h1>Platform</h1><p>Superadmin — provision workspaces, approve requests, and see every tenant. This sits above org roles.</p></div>

      {/* create a workspace for someone */}
      <div className="card" style={{ marginBottom: 'var(--gap)' }}>
        <span className="field-label">Create a workspace</span>
        <div className="pick" style={{ marginTop: 6 }}>
          <button className={kind === 'company' ? 'on' : ''} onClick={() => setKind('company')}>Company + crew</button>
          <button className={kind === 'owner' ? 'on' : ''} onClick={() => setKind('owner')}>Property owner</button>
        </div>
        <div className="grid g2" style={{ marginTop: 10, gap: 10 }}>
          <div><div className="field-label">Company / workspace name</div>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Genesee Valley Maintenance" /></div>
          <div><div className="field-label">Owner email (gets an admin invite)</div>
            <input style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@company.com" inputMode="email" /></div>
        </div>
        {err && <p className="note" style={{ color: 'var(--danger)', marginTop: 6 }}>{err}</p>}
        <button className="btn grad" style={{ marginTop: 12 }} onClick={create} disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create workspace + invite'}</button>
        {made && (
          <div className="card" style={{ marginTop: 12, borderColor: '#4ade8033', background: 'var(--money-dim)' }}>
            <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}><IcCheck width={14} height={14} /> {made.name} created</div>
            <div className="note" style={{ margin: '4px 0 8px' }}>Send the owner this invite link — they create their account through it and land as admin.</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontSize: 12, wordBreak: 'break-all', flex: 1, minWidth: 180 }}>{linkFor(made.code)}</span>
              <button className="btn ghost sm" onClick={() => copy(made.code)}>{copied === made.code ? <><IcCheck width={13} height={13} /> Copied</> : <><IcCopy width={13} height={13} /> Copy</>}</button>
            </div>
          </div>
        )}
      </div>

      {/* pending requests */}
      {pending.length > 0 && (
        <div className="card" style={{ marginBottom: 'var(--gap)', borderColor: '#ffb02033' }}>
          <span className="field-label" style={{ color: 'var(--warn)' }}>Workspace requests ({pending.length})</span>
          {pending.map((r) => (
            <div className="row" key={r.id}>
              <div className="lead">
                <div className="t">{r.orgName} <span className="chip" style={{ color: r.kind === 'owner' ? 'var(--money)' : 'var(--info)' }}>{r.kind === 'owner' ? 'owner' : 'company'}</span></div>
                <div className="s">{[r.contactName, r.email, r.note].filter(Boolean).join(' · ') || 'no details'}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn grad sm" onClick={() => decide(r.id, true)}>Approve</button>
                <button className="btn ghost sm" style={{ color: 'var(--text-faint)' }} onClick={() => decide(r.id, false)} aria-label="Deny"><IcX width={14} height={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* all workspaces */}
      <div className="card">
        <span className="field-label"><IcBuilding width={13} height={13} style={{ verticalAlign: -2 }} /> All workspaces ({orgs.length})</span>
        {orgs.length === 0 && <p className="note">No workspaces yet.</p>}
        {orgs.map((o) => (
          <div className="row" key={o.id}>
            <div className="lead"><div className="t">{o.name}</div><div className="s">created {new Date(o.createdAt).toLocaleDateString()}</div></div>
            <span className="chip">{o.members} {o.members === 1 ? 'member' : 'members'}</span>
          </div>
        ))}
      </div>

      <p className="note">Superadmin access is allowlisted by email and enforced server-side — every action here runs through a gated function, so it can't be reached by an ordinary org admin.</p>
    </div>
  );
}
