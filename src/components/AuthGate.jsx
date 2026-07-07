import { useState, useEffect, createContext, useContext } from 'react';
import { supabase, isConfigured, signIn, signOut, getSession, onAuthChange, updatePassword, fetchMembership } from '../lib/backend/supabase.js';
import { Mark } from './ui.jsx';

// role drives which tools are visible: admin/manager see the full suite
// incl. financials; tech (contractors) get field tools only; viewer is
// read-only. RLS + getdek enforce the same boundary server-side.
const AuthCtx = createContext({ session: null, role: 'admin', orgId: null });
export const useAuth = () => useContext(AuthCtx);

// Wraps the app. Three states:
//  - not configured  → demo mode (seed data), small banner, no gate
//  - configured + no session → login screen
//  - configured + session → app, with sign-out available
export function AuthGate({ children }) {
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [mem, setMem] = useState(null);       // { org_id, role }
  const [memReady, setMemReady] = useState(false);

  useEffect(() => {
    if (!isConfigured()) { setReady(true); return; }
    getSession().then((s) => { setSession(s); setReady(true); });
    const { data } = onAuthChange(setSession);
    return () => data?.subscription?.unsubscribe();
  }, []);

  useEffect(() => {
    if (!isConfigured() || !session) { setMem(null); setMemReady(false); return; }
    let on = true;
    fetchMembership()
      .then((m) => { if (on) { setMem(m); setMemReady(true); } })
      .catch(() => { if (on) { setMem(null); setMemReady(true); } }); // least privilege on failure
    return () => { on = false; };
  }, [session]);

  if (!ready) return null;

  // demo mode — backend not wired yet, app runs on seed data with full suite
  if (!isConfigured()) {
    return (
      <AuthCtx.Provider value={{ session: null, role: 'admin', orgId: null }}>
        <div style={{ background: '#38bdf812', borderBottom: '1px solid #38bdf833', color: 'var(--info)',
          fontSize: 12, fontWeight: 700, textAlign: 'center', padding: '7px 12px', fontFamily: 'var(--font)' }}>
          ◑ Demo mode · sample data · connect Supabase to enable secure login &amp; real data
        </div>
        {children}
      </AuthCtx.Provider>
    );
  }

  if (!session) return <Login />;
  if (!memReady) {
    // don't flash the wrong toolset while the role loads
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--text-faint)', fontFamily: 'var(--font)', fontSize: 13, fontWeight: 700 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Mark /> loading your workspace…</div>
      </div>
    );
  }

  // no membership row = not yet onboarded to an org → treat as tech (least privilege)
  return (
    <AuthCtx.Provider value={{ session, role: mem?.role || 'tech', orgId: mem?.org_id || null }}>
      {children}
    </AuthCtx.Provider>
  );
}

// ---- two front doors, one secure backend ----
// the portal choice themes the login; after sign-in the ROLE decides the
// actual toolset (a contractor who picks Office still lands in Crew tools).
const PORTALS = {
  crew: {
    title: 'Crew Portal',
    tagline: 'Clock in. Get your orders. Snap your receipts.',
    points: ['Your work orders', 'Job timer', 'Receipt reimbursement'],
  },
  office: {
    title: 'Office Portal',
    tagline: 'The whole operation, measured true.',
    points: ['Dashboards & financials', 'Dispatch work orders', 'Documents & purchasing'],
  },
};

function Login() {
  const [portal, setPortal] = useState(() => localStorage.getItem('caliper_portal') || null);
  const pick = (p) => { localStorage.setItem('caliper_portal', p); setPortal(p); };

  if (!portal) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 640 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', marginBottom: 6 }}>
            <Mark /> <span style={{ fontWeight: 800, fontSize: 22 }}>Caliper</span>
          </div>
          <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13, marginBottom: 26 }}>Labor, measured true. Pick your door.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            {Object.entries(PORTALS).map(([key, p]) => (
              <button key={key} onClick={() => pick(key)} className="card" style={{
                cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font)', color: 'var(--text)',
                border: '1px solid var(--line)', padding: 22,
              }}>
                <div style={{ fontSize: 26, marginBottom: 8 }}>{key === 'crew' ? '🔧' : '📊'}</div>
                <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>{p.title}</div>
                <div style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 12 }}>{p.tagline}</div>
                {p.points.map((pt) => (
                  <div key={pt} style={{ fontSize: 12, color: 'var(--text-faint)', fontWeight: 600, padding: '2px 0' }}>· {pt}</div>
                ))}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }
  return <LoginForm portal={portal} onSwitch={() => { localStorage.removeItem('caliper_portal'); setPortal(null); }} />;
}

function LoginForm({ portal, onSwitch }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const p = PORTALS[portal];

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
          <span className="chip" style={{ marginLeft: 2 }}>{portal === 'crew' ? '🔧 crew' : '📊 office'}</span>
        </div>
        <p style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: 13, marginBottom: 24 }}>{p.tagline}</p>

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
          {busy ? 'Signing in…' : `Sign in to ${p.title}`}
        </button>
        <p className="note" style={{ textAlign: 'center', marginTop: 16 }}>
          Protected by row-level security. Sensitive data is AES-256 encrypted at rest.
        </p>
        <p className="note" style={{ textAlign: 'center', marginTop: 6 }}>
          <a onClick={onSwitch} style={{ color: 'var(--info)', cursor: 'pointer' }}>
            {portal === 'crew' ? 'Office staff? Switch portal →' : 'On the crew? Switch portal →'}
          </a>
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
