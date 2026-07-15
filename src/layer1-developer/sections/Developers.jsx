// src/layer1-developer/sections/Developers.jsx
// The allowlist roster itself — who besides you and Gianni can ever see this
// console. Deliberately the smallest, plainest section: add by email, remove
// with a confirm, guarded server-side against removing yourself or the last admin.
import { useEffect, useState } from 'react';
import { layer1ListDevelopers, layer1AddDeveloper, layer1RemoveDeveloper } from '../../lib/backend/layer1Api.js';

export default function Developers() {
  const [admins, setAdmins] = useState(null);
  const [email, setEmail] = useState('');
  const [err, setErr] = useState(null);

  const load = () => layer1ListDevelopers().then(setAdmins);
  useEffect(() => { load(); }, []);

  const add = async () => {
    setErr(null);
    try {
      await layer1AddDeveloper(email.trim());
      setEmail('');
      await load();
    } catch (e) {
      setErr(e.message || String(e));
    }
  };

  const remove = async (a) => {
    if (!confirm(`Remove ${a.email} from the developer allowlist?`)) return;
    try {
      await layer1RemoveDeveloper(a.email);
      await load();
    } catch (e) {
      setErr(e.message || String(e));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 480 }}>
      <div className="card" style={{ padding: 0 }}>
        {!admins && <p className="mono" style={{ padding: 14, color: 'var(--text-faint)' }}>···</p>}
        {/* keyed by email: user_id is null for allowlisted emails with no account yet */}
        {admins?.map((a) => (
          <div key={a.email} className="row" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', borderBottom: '1px solid var(--line-soft)',
          }}>
            <span style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--text)' }}>{a.email}</span>
            <button className="btn ghost sm" onClick={() => remove(a)}>Remove</button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="new-admin@example.com"
          style={{
            flex: 1, fontFamily: 'var(--font)', fontSize: 13, color: 'var(--text)',
            background: 'var(--surface-2)', border: '1px solid var(--line)',
            borderRadius: 'var(--r-sm)', padding: '8px 12px',
          }}
        />
        <button className="btn grad sm" onClick={add} disabled={!email.trim()}>Add</button>
      </div>
      {err && <p style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--danger)' }}>{err}</p>}
    </div>
  );
}
