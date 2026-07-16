// src/layer1-developer/DeveloperShell.jsx
// Layer 1 — Developer console. Restricted to platform_admins (Gianni + you).
//
// The real gate is server-side: every function in layer1Api.js checks
// is_platform_admin() and raises if the caller isn't one. The isPlatformAdmin()
// check below just avoids flashing the console at someone who'd get RPC
// errors anyway — it is not the security boundary, so don't rely on it as one.
//
// Mounted via a hash check (#developer) in App.jsx — see
// TASK02-CLAUDE-CODE-PROMPT.md for the two-line integration snippet. Deliberately
// NOT wired through AuthGate's product/portal picker state or its AuthCtx
// value — that's exactly where the last patch collided with Gianni's resident
// work. This is a parallel entry point that doesn't touch those lines at all.
//
// task02c: the no-session branch used to be a dead end ("go back and sign in
// as usual"). It's now a real sign-in form, right here, so a platform admin
// can authenticate directly at #developer. Signing in with a non-admin
// account is allowed at the auth layer (Supabase can't pre-screen emails at
// sign-in) but is immediately signed back out the moment isPlatformAdmin()
// comes back false — no non-admin session is ever left standing at this
// route, which is what actually keeps this to Gianni + you in practice.

import { useEffect, useState } from 'react';
import './theme.css';
import { isPlatformAdmin, getSession, signIn, signOut, layer1SweepSupport } from '../lib/backend/layer1Api.js';
import { Mark } from '../components/ui.jsx';

import Overview from './sections/Overview.jsx';
import GlobalUI from './sections/GlobalUI.jsx';
import Workspaces from './sections/Workspaces.jsx';
import Users from './sections/Users.jsx';
import Developers from './sections/Developers.jsx';
import Audit from './sections/Audit.jsx';

const SECTIONS = [
  { id: 'overview', label: 'Overview', Component: Overview },
  { id: 'workspaces', label: 'Workspaces', Component: Workspaces },
  { id: 'users', label: 'Users', Component: Users },
  { id: 'globalui', label: 'Global UI', Component: GlobalUI },
  { id: 'developers', label: 'Developers', Component: Developers },
  { id: 'audit', label: 'Audit', Component: Audit },
];

function DevSignIn({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      const ok = await isPlatformAdmin();
      if (!ok) {
        await signOut();
        setErr("Signed in, but this account isn't on the developer allowlist.");
        setPassword('');
        return;
      }
      onSignedIn();
    } catch (e2) {
      setErr(e2.message || 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 260, marginTop: 20 }}>
      <input
        type="email"
        autoComplete="username"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        required
        style={{
          fontFamily: 'var(--font)', fontSize: 13, color: 'var(--text)',
          background: 'var(--surface-2)', border: '1px solid var(--line)',
          borderRadius: 'var(--r-sm)', padding: '9px 12px',
        }}
      />
      <input
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        required
        style={{
          fontFamily: 'var(--font)', fontSize: 13, color: 'var(--text)',
          background: 'var(--surface-2)', border: '1px solid var(--line)',
          borderRadius: 'var(--r-sm)', padding: '9px 12px',
        }}
      />
      <button type="submit" className="btn grad sm" disabled={busy || !email.trim() || !password}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      {err && <p style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--danger)', margin: 0 }}>{err}</p>}
    </form>
  );
}

export default function DeveloperShell({ onExit }) {
  const [allowed, setAllowed] = useState(null); // null = still checking
  const [signedIn, setSignedIn] = useState(null); // null = still checking
  const [section, setSection] = useState('overview');

  const recheck = () => {
    setAllowed(null);
    setSignedIn(null);
    getSession().then((s) => setSignedIn(!!s)).catch(() => setSignedIn(false));
    isPlatformAdmin().then(setAllowed);
  };

  useEffect(() => {
    let on = true;
    // fire-and-forget: clear any expired support seats so a dead session
    // can't linger as a half-live membership (see platform_sweep_support).
    layer1SweepSupport().catch(() => {});
    getSession().then((s) => { if (on) setSignedIn(!!s); }).catch(() => { if (on) setSignedIn(false); });
    isPlatformAdmin().then((v) => { if (on) setAllowed(v); });
    return () => { on = false; };
  }, []);

  if (allowed === null || signedIn === null) return <div className="layer1-root" />;

  if (!allowed) {
    return (
      <div className="layer1-root" style={{ display: 'grid', placeItems: 'center', padding: 40 }}>
        <div style={{ textAlign: 'center', maxWidth: 360, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <p style={{ fontFamily: 'var(--font)', color: 'var(--text)', fontWeight: 600, margin: 0 }}>
            {signedIn ? 'Not authorized' : 'Developer sign-in'}
          </p>
          <p style={{ fontFamily: 'var(--font)', color: 'var(--text-dim)', fontSize: 13, marginTop: 8 }}>
            {signedIn
              ? "This console is restricted to platform admins. If that's wrong, ask an existing admin to add you from the Developers tab."
              : 'Restricted to platform admins.'}
          </p>
          {!signedIn && <DevSignIn onSignedIn={recheck} />}
          <button className="btn ghost sm" style={{ marginTop: 16 }} onClick={onExit}>Back to Caliper</button>
        </div>
      </div>
    );
  }

  const Active = SECTIONS.find((s) => s.id === section)?.Component ?? Overview;

  return (
    <div className="layer1-root">
      <div className="layer1-strip" />
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '18px 24px', borderBottom: '1px solid var(--line)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Mark />
          <span style={{ fontFamily: 'var(--font)', fontWeight: 700, color: 'var(--text)' }}>Caliper</span>
          <span style={{
            fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-faint)',
            border: '1px solid var(--line)', borderRadius: 999, padding: '2px 8px',
          }}>
            DEVELOPER
          </span>
        </div>
        <button className="btn ghost sm" onClick={onExit}>Exit to Caliper</button>
      </header>

      <nav style={{ padding: '16px 24px 0' }}>
        <div className="layer1-seg" role="tablist" aria-label="Developer console sections">
          {SECTIONS.map((s) => (
            <button key={s.id} role="tab" aria-selected={section === s.id} onClick={() => setSection(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      </nav>

      <main style={{ padding: 24 }}>
        <Active />
      </main>
    </div>
  );
}
