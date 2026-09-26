// src/layer1-developer/sections/Users.jsx
// Read-only directory for task02. task03 adds search + membership chips
// styling; the data (memberships, is_admin, last_sign_in) already comes
// back from layer1ListUsers().
import { useEffect, useState } from 'react';
import { layer1ListUsers } from '../../lib/backend/layer1Api.js';

export default function Users() {
  const [users, setUsers] = useState(null);
  const [q, setQ] = useState('');

  useEffect(() => { layer1ListUsers().then(setUsers); }, []);

  // email is nullable on auth.users (phone-auth / admin-created accounts)
  const rows = (users || []).filter((u) => (u.email || '').toLowerCase().includes(q.toLowerCase()));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filter by email…"
        style={{
          fontFamily: 'var(--font)', fontSize: 13, color: 'var(--text)',
          background: 'var(--surface-2)', border: '1px solid var(--line)',
          borderRadius: 'var(--r-sm)', padding: '8px 12px', maxWidth: 280,
        }}
      />
      <div className="card" style={{ padding: 0 }}>
        {!users && <p className="mono" style={{ padding: 14, color: 'var(--text-faint)' }}>···</p>}
        {users && rows.map((u) => (
          <div key={u.id} className="row" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', borderBottom: '1px solid var(--line-soft)',
          }}>
            <div>
              <div style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--text)' }}>{u.email}</div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                {u.memberships.length} membership{u.memberships.length === 1 ? '' : 's'}
                {u.last_sign_in ? ` · last seen ${new Date(u.last_sign_in).toLocaleDateString()}` : ''}
              </div>
            </div>
            {u.is_admin && (
              <span className="mono" style={{ fontSize: 10, color: 'var(--warn)', border: '1px solid var(--line)', borderRadius: 2, padding: '2px 8px' }}>
                DEVELOPER
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
