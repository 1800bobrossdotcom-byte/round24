import { useState, useEffect } from 'react';
import { supabase, isConfigured, signIn, signOut, getSession, onAuthChange, updatePassword } from '../lib/backend/supabase.js';
import { Mark } from './ui.jsx';

// Wraps the app. Three states:
//  - not configured  → demo mode (seed data), small banner, no gate
//  - configured + no session → login screen
//  - configured + session → app, with sign-out available
export function AuthGate({ children }) {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isConfigured()) { setReady(true); return; }
    getSession().then((s) => { setSession(s); setReady(true); });
    const { data } = onAuthChange(setSession);
    return () => data?.subscription?.unsubscribe();
  }, []);

  if (!ready) return null;

  // demo mode — backend not wired yet, app runs on seed data
  if (!isConfigured()) {
    return (
      <>
        <div style={{ background: '#38bdf812', borderBottom: '1px solid #38bdf833', color: 'var(--info)',
          fontSize: 12, fontWeight: 700, textAlign: 'center', padding: '7px 12px', fontFamily: 'var(--font)' }}>
          ◑ Demo mode · sample data · connect Supabase to enable secure login &amp; real data
        </div>
        {children}
      </>
    );
  }

  if (!session) return <Login />;
  return children;
}

function Login() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async () => {
    setErr(null); setBusy(true);
    try { await signIn(email, pw); }
    catch (e) { setErr(e.message || 'Sign-in failed'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', marginBottom: 8 }}>
          <Mark /> <span style={{ fontWeight: 800, fontSize: 22 }}>Caliper</span>
        </div>
        <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13, marginBottom: 24 }}>Sign in to continue</p>

        {err && <div className="offline" style={{ color: 'var(--danger)', borderColor: '#ff5a5a33', background: '#ff5a5a12' }}>{err}</div>}

        <div className="field-label">Email</div>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email"
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          style={inputStyle} />
        <div style={{ height: 14 }} />
        <div className="field-label">Password</div>
        <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" autoComplete="current-password"
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          style={inputStyle} />
        <div style={{ height: 20 }} />
        <button className="btn grad" onClick={submit} disabled={busy || !email || !pw}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="note" style={{ textAlign: 'center', marginTop: 16 }}>
          Protected by row-level security. Sensitive data is AES-256 encrypted at rest.
        </p>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%', background: 'var(--surface-2)', border: '1px solid var(--line)',
  color: 'var(--text)', fontFamily: 'var(--font)', fontSize: 15, padding: 13, borderRadius: 10,
};

export function SignOutButton() {
  if (!isConfigured()) return null;
  return (
    <button className="btn ghost sm" onClick={signOut} style={{ fontSize: 12 }}>Sign out</button>
  );
}

export function AccountButton() {
  const [open, setOpen] = useState(false);
  if (!isConfigured()) return null;
  return (
    <>
      <button className="btn ghost sm" onClick={() => setOpen(true)} style={{ fontSize: 12 }}>Account</button>
      {open && <ChangePasswordModal onClose={() => setOpen(false)} />}
    </>
  );
}

function ChangePasswordModal({ onClose }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(false);

  const mismatch = pw2 && pw !== pw2;
  const tooShort = pw && pw.length < 6;
  const canSubmit = pw.length >= 6 && pw === pw2 && !busy;

  const submit = async () => {
    setErr(null); setBusy(true);
    try { await updatePassword(pw); setDone(true); }
    catch (e) { setErr(e.message || 'Could not update password'); }
    finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 100,
      display: 'grid', placeItems: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 360,
        background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 18 }}>
          <span style={{ fontWeight: 800, fontSize: 16 }}>Change password</span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost sm" onClick={onClose} style={{ fontSize: 12 }}>✕</button>
        </div>

        {done ? (
          <>
            <p style={{ color: 'var(--text)', fontSize: 14, marginBottom: 20 }}>✓ Password updated.</p>
            <button className="btn grad" onClick={onClose}>Done</button>
          </>
        ) : (
          <>
            {err && <div className="offline" style={{ color: 'var(--danger)', borderColor: '#ff5a5a33',
              background: '#ff5a5a12', marginBottom: 14 }}>{err}</div>}

            <div className="field-label">New password</div>
            <input value={pw} onChange={(e) => setPw(e.target.value)} type="password" autoComplete="new-password"
              style={inputStyle} />
            {tooShort && <p className="note" style={{ color: 'var(--danger)', marginTop: 6 }}>At least 6 characters.</p>}
            <div style={{ height: 14 }} />
            <div className="field-label">Confirm new password</div>
            <input value={pw2} onChange={(e) => setPw2(e.target.value)} type="password" autoComplete="new-password"
              onKeyDown={(e) => e.key === 'Enter' && canSubmit && submit()}
              style={inputStyle} />
            {mismatch && <p className="note" style={{ color: 'var(--danger)', marginTop: 6 }}>Passwords don't match.</p>}
            <div style={{ height: 20 }} />
            <button className="btn grad" onClick={submit} disabled={!canSubmit}>
              {busy ? 'Updating…' : 'Update password'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
